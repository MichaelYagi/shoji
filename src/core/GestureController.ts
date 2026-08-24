import {
  GestureEngine,
  type GestureDirection,
  type GestureEngineOptions,
} from '../gestures/GestureEngine';
import type { SlideManager } from './SlideManager';
import { waitForTransitionEnd, type FrozenDragTransform } from './zoomTransition';

/** DESIGN.md §2.4 — the drag-released settle easing, distinct from `--shoji-easing`'s open/close/zoom curve. */
const DRAG_SETTLE_TRANSITION = 'transform var(--shoji-duration) var(--shoji-momentum-easing)';
const DRAG_FEEDBACK_TRANSITION =
  'transform var(--shoji-duration) var(--shoji-momentum-easing), opacity var(--shoji-duration) var(--shoji-momentum-easing)';
/** px of vertical drag at which live close-feedback maxes out — independent of `swipeThreshold`, which decides actual completion. */
const VERTICAL_FEEDBACK_DISTANCE = 160;

/**
 * A real interactive control, plus `.shoji-caption` — a click/drag starting
 * there should select/scroll its text natively, not get captured as a
 * gesture. Also used by `Gallery.ts`'s `isBackdropClick`, which used to have
 * its own narrower list (missing select/input/textarea/a[href]) — a
 * plugin-mounted non-button control got misread as a backdrop click and
 * closed the gallery. One shared selector so that can't recur.
 *
 * `.shoji-caption-modal` (DESIGN.md §2.3a) — a real bug, reported from real
 * usage: `GestureEngine`'s own tap recognition (`ignore` gates it before
 * any pointer tracking starts, `GestureEngine.ts`) runs entirely on
 * pointer events, independent of whatever a click listener's own
 * `stopPropagation()` does — a tap anywhere inside the caption modal
 * (its content area specifically; the close button was already covered as
 * a real `<button>`) still read as a legitimate tap on the dialog and fired
 * the `tap` bus event, which the Autoplay plugin listens to for its own
 * tap-to-toggle-play/pause. Excluding the whole modal here is what
 * actually stops that, not anything at the click-event layer.
 */
export const INTERACTIVE_CONTROL_SELECTOR =
  'button, video, input, select, textarea, a[href], [data-shoji-no-drag], .shoji-caption, .shoji-caption-modal, .shoji-toolbar-overflow-panel';

/**
 * `INTERACTIVE_CONTROL_SELECTOR` minus `video` — everything else there still
 * needs a real click/drag to behave natively (select/scroll caption text,
 * a plugin's own control, etc.), same reasoning as that selector's own doc
 * comment. `video` is carved out separately, below: unlike those, a native
 * `<video controls>`'s own interactive surface (tap-to-toggle, the
 * scrub-bar drag) isn't the *whole* element — DESIGN.md §2.4/§4.3's
 * swipe-to-navigate-video-slides feature needs gestures to reach the rest
 * of it, not be blocked outright the way the shared selector above still
 * blocks it for backdrop-click/caption-selection purposes.
 */
const GESTURE_IGNORE_SELECTOR =
  'button, input, select, textarea, a[href], [data-shoji-no-drag], .shoji-caption, .shoji-caption-modal, .shoji-toolbar-overflow-panel';

/**
 * A native `<video controls>`'s own scrub-bar/tap-to-toggle chrome is
 * browser-rendered, not real DOM Shoji can measure — there's no element to
 * exclude by selector the way `GESTURE_IGNORE_SELECTOR` excludes a real
 * `<button>`. Approximated instead as a fixed bottom margin
 * (`--shoji-video-gesture-margin`, shoji.css), reserved for the browser's
 * own touch handling; a touch starting above it is fair game for Shoji's
 * own gestures, same as anywhere on a photo slide.
 */
function isInVideoControlsMargin(event: PointerEvent, video: HTMLVideoElement): boolean {
  const rect = video.getBoundingClientRect();
  const margin = parseFloat(
    getComputedStyle(video).getPropertyValue('--shoji-video-gesture-margin'),
  );
  return event.clientY >= rect.bottom - (Number.isFinite(margin) ? margin : 0);
}

/**
 * `.shoji-caption--video` (shoji.css, DESIGN.md §2.3a/§4-video) sets
 * `pointer-events: none` on a video slide's caption, letting a click reach
 * the video/provider controls underneath it — which also means it never
 * appears in `event.composedPath()` there at all, so
 * `GESTURE_IGNORE_SELECTOR`'s selector-based check can't see it, the same
 * gap `Gallery.ts`'s `isBackdropClick()` already solves the same way:
 * checked by coordinates instead, the one place this function has to be.
 * A real bug this fixes: swipe-to-navigate/drag-to-close over a provider
 * video's own letterboxed margins (below) would otherwise engage right
 * through the caption sitting over them.
 */
function isOverVideoCaption(event: PointerEvent, caption: HTMLElement): boolean {
  if (caption.hidden || !caption.classList.contains('shoji-caption--video')) return false;
  const rect = caption.getBoundingClientRect();
  return (
    event.clientX >= rect.left &&
    event.clientX <= rect.right &&
    event.clientY >= rect.top &&
    event.clientY <= rect.bottom
  );
}

/** A click/drag starting on a real control (or, on a video slide, its click-through caption — see `isOverVideoCaption`) shouldn't also be captured as a gesture — see `GESTURE_IGNORE_SELECTOR`/`isInVideoControlsMargin`. */
function shouldIgnoreGesture(event: PointerEvent, caption: HTMLElement): boolean {
  if (isOverVideoCaption(event, caption)) return true;
  const path = event.composedPath();
  const video = path.find((node): node is HTMLVideoElement => node instanceof HTMLVideoElement);
  if (video) return isInVideoControlsMargin(event, video);
  return path.some((node) => node instanceof Element && node.matches(GESTURE_IGNORE_SELECTOR));
}

/** What `GestureController` needs from `Gallery` — narrow on purpose, so this module never reaches into Gallery internals beyond this contract. */
export interface GestureControllerHost {
  dialog: HTMLElement;
  /** Read live, not snapshotted — `shouldIgnoreGesture()` needs its current bounding box/visibility on every gesture start, not whatever it was when `GestureController` was constructed. See `isOverVideoCaption`. */
  caption: HTMLElement;
  slides: SlideManager;
  canGoNext(): boolean;
  canGoPrev(): boolean;
  next(): void;
  prev(): void;
  close(): void;
  /** Same effect as `close()`, but for a completed vertical swipe — skips the separate controls-fade pause in front of the zoom-out (see `finishVerticalDrag`). */
  closeFromSwipe(frozenDrag: FrozenDragTransform): void;
  /** Live, reversible — crossing the close threshold mid-drag hides the toolbar/nav/counter/caption (a "let go now and this closes" cue); dragging back under it before release reveals them again. See `applyVerticalDragFeedback`. */
  setControlsHiddenForDrag(hidden: boolean): void;
  /** `closable: false` (GalleryOptions) — false suspends vertical drag-to-close entirely: no live feedback, release never calls `close()`. */
  canClose(): boolean;
  onActivity(): void;
  /** DESIGN.md §4-zoom — true while zoomed; suspends drag-to-navigate/close. */
  isZoomed(): boolean;
}

/** Relays for gestures core has no built-in behavior for — DESIGN.md §2.4; the zoom plugin (§4-zoom) consumes these via the gallery event bus. */
export interface GestureRelayCallbacks {
  onTap(x: number, y: number): void;
  onDoubleTap(x: number, y: number): void;
  onPinchStart(centerX: number, centerY: number): void;
  onPinchMove(scale: number, centerX: number, centerY: number): void;
  onPinchEnd(): void;
  onWheelZoom(deltaScale: number, x: number, y: number): void;
}

/**
 * DESIGN.md §2.4 — owns the gesture-driven side of the lightbox: horizontal
 * drag-to-navigate and vertical drag-to-close, built on `GestureEngine`
 * (`src/gestures/`) plus the live-feedback/settle-animation mechanics
 * specific to this lightbox's DOM. Split out of `Gallery.ts` (CLAUDE.md:
 * files ≤ ~400 lines) — `Gallery` only constructs this, forwards the host
 * callbacks it needs, and relays no-built-in-effect gestures onto its bus.
 */
export class GestureController {
  private readonly engine: GestureEngine;
  /** Same distance `GestureEngine` itself uses to decide a release would complete the close — reused here so the live controls-hide cue in `applyVerticalDragFeedback` actually means what it visually claims. */
  private readonly controlsHideThreshold: number;
  private controlsHiddenForDrag = false;
  private lastDragDelta = 0;

  constructor(
    private readonly host: GestureControllerHost,
    relay: GestureRelayCallbacks,
    options?: Partial<GestureEngineOptions>,
  ) {
    this.controlsHideThreshold = options?.swipeThreshold ?? 50;
    this.engine = new GestureEngine(
      host.dialog,
      {
        ignore: (event) => shouldIgnoreGesture(event, host.caption),
        shouldCapture: () => !host.isZoomed(),
        onDragStart: () => host.onActivity(),
        onDragMove: this.onDragMove,
        onDragEnd: this.onDragEnd,
        onTap: (x, y) => relay.onTap(x, y),
        onDoubleTap: (x, y) => relay.onDoubleTap(x, y),
        onPinchStart: (centerX, centerY) => relay.onPinchStart(centerX, centerY),
        onPinchMove: (scale, centerX, centerY) => relay.onPinchMove(scale, centerX, centerY),
        onPinchEnd: () => relay.onPinchEnd(),
        onWheelZoom: (deltaScale, x, y) => relay.onWheelZoom(deltaScale, x, y),
      },
      options,
    );
  }

  destroy(): void {
    this.engine.destroy();
  }

  /** Horizontal follows the finger 1:1; vertical drives close-feedback instead. Axis-locked, one branch per drag. */
  private readonly onDragMove = (direction: GestureDirection, delta: number): void => {
    if (this.host.isZoomed()) return; // the zoom plugin owns pan while zoomed
    if (direction === 'horizontal') {
      this.host.slides.setDragOffset(delta, null);
    } else if (this.host.canClose()) {
      this.applyVerticalDragFeedback(delta);
    }
  };

  private readonly onDragEnd = (
    direction: GestureDirection,
    delta: number,
    _velocity: number,
    completed: boolean,
  ): void => {
    if (this.host.isZoomed()) return;
    if (direction === 'horizontal') {
      this.finishHorizontalDrag(delta, completed);
    } else {
      this.finishVerticalDrag(completed);
    }
  };

  /** `completed` decides intent; `canGoNext`/`canGoPrev` guard whether that's actually possible (`loop: false` at an end item). */
  private finishHorizontalDrag(delta: number, completed: boolean): void {
    const goingNext = delta < 0;
    const canMove = goingNext ? this.host.canGoNext() : this.host.canGoPrev();

    if (!completed || delta === 0 || !canMove) {
      this.settleDragOffset(0, () => {});
      return;
    }

    const width = this.host.dialog.getBoundingClientRect().width || 1;
    const target = goingNext ? -width : width;
    this.settleDragOffset(target, () => {
      // Instant, untransitioned reset in the same synchronous tick as the
      // index change — same FLIP-family trick as zoomTransition.ts's
      // instant-jump: the slot that just animated into the center position
      // is about to receive that exact same "new current" item's content
      // (its structural offset already matches, since preload keeps it
      // rendered), so resetting to offset 0 while simultaneously swapping
      // content is visually seamless, not a jump.
      this.host.slides.setDragOffset(0, null);
      if (goingNext) this.host.next();
      else this.host.prev();
    });
  }

  private settleDragOffset(targetPx: number, onSettled: () => void): void {
    const settleEl = this.host.slides.getSlotRoot(0);
    this.host.slides.setDragOffset(targetPx, DRAG_SETTLE_TRANSITION);
    if (!settleEl) {
      onSettled();
      return;
    }
    waitForTransitionEnd(settleEl, onSettled);
  }

  /**
   * Purely presentational — scales/fades the *image* as it's dragged away,
   * without closing until release decides. Applied to `host.slides.element`,
   * not `host.dialog` — requested directly: toolbar/nav/counter/caption are
   * siblings, not descendants, so they stay anchored, not moving with it.
   */
  private applyVerticalDragFeedback(delta: number): void {
    const progress = Math.min(Math.abs(delta) / VERTICAL_FEEDBACK_DISTANCE, 1);
    const slides = this.host.slides.element;
    this.lastDragDelta = delta;
    slides.style.transition = '';
    slides.style.transform = `translateY(${delta}px) scale(${1 - progress * 0.15})`;
    slides.style.opacity = String(1 - progress * 0.6);

    // Requested directly: past the same distance a release would close,
    // controls disappear — a "let go now" cue, distinct from the image's own
    // dim above (capped at 0.4, never fully hides). Reversible: retreating
    // under it before release reveals them. Only on a crossing, not every move.
    const pastThreshold = Math.abs(delta) >= this.controlsHideThreshold;
    if (pastThreshold !== this.controlsHiddenForDrag) {
      this.controlsHiddenForDrag = pastThreshold;
      this.host.setControlsHiddenForDrag(pastThreshold);
    }
  }

  private clearVerticalDragFeedback(animate: boolean): void {
    const slides = this.host.slides.element;
    slides.style.transition = animate ? DRAG_FEEDBACK_TRANSITION : '';
    slides.style.transform = '';
    slides.style.opacity = '';
  }

  private finishVerticalDrag(completed: boolean): void {
    const wasHiddenForDrag = this.controlsHiddenForDrag;
    this.controlsHiddenForDrag = false;
    if (completed && this.host.canClose()) {
      this.host.closeFromSwipe(this.takeFrozenDragTransform());
    } else {
      // Not completed, or closable: false suspended the drag entirely (no
      // feedback was ever applied by onDragMove) — either way, a clean
      // reset (harmless no-op in the suspended case, nothing to clear).
      this.clearVerticalDragFeedback(true);
      // Not closing — controls must come back if the cue above left them
      // hidden, regardless of exactly where release landed (e.g.
      // swipeVelocity deciding "not completed" past this threshold).
      if (wasHiddenForDrag) this.host.setControlsHiddenForDrag(false);
    }
  }

  /**
   * Reads the drag's last live appearance, instantly resets `.shoji-slides`
   * back to neutral (nothing left on it to visibly snap — `Gallery` bakes
   * these same values onto the photo itself in the same synchronous tick,
   * so the rendered result is unchanged, just re-homed), and returns them
   * for that hand-off. Translate is the raw, unclamped drag distance —
   * requested directly: the close animation must continue from exactly
   * where the drag left off, full stop, not recenter first. (A previous
   * version clamped this to the same 160px the dim/scale feedback ramps
   * over, to bound how far away the close animation could start — but
   * clamping is itself an instant correction: for any drag past that
   * distance, release visibly snapped the photo from wherever it actually
   * was back to the clamped point, before the real shrink-to-thumbnail
   * motion continued from there. That snap — not the shrink itself — is
   * what reads as "jumps to a small image in the middle of the screen."
   * Reported from real usage, confirmed on video: released past the clamp,
   * the photo visibly jumped from off-screen back to near-center in a
   * single frame.)
   */
  private takeFrozenDragTransform(): FrozenDragTransform {
    const progress = Math.min(Math.abs(this.lastDragDelta) / VERTICAL_FEEDBACK_DISTANCE, 1);
    const frozen: FrozenDragTransform = {
      translateY: this.lastDragDelta,
      scale: 1 - progress * 0.15,
      opacity: 1 - progress * 0.6,
    };
    this.clearVerticalDragFeedback(false);
    return frozen;
  }
}
