import {
  GestureEngine,
  type GestureDirection,
  type GestureEngineOptions,
} from '../gestures/GestureEngine';
import type { SlideManager } from './SlideManager';
import { waitForTransitionEnd } from './zoomTransition';

/** DESIGN.md §2.4 — the drag-released settle easing, distinct from `--shoji-easing`'s open/close/zoom curve. */
const DRAG_SETTLE_TRANSITION = 'transform var(--shoji-duration) var(--shoji-momentum-easing)';
const DRAG_FEEDBACK_TRANSITION =
  'transform var(--shoji-duration) var(--shoji-momentum-easing), opacity var(--shoji-duration) var(--shoji-momentum-easing)';
/** px of vertical drag at which live close-feedback maxes out — independent of `swipeThreshold`, which decides actual completion. */
const VERTICAL_FEEDBACK_DISTANCE = 160;

/** A click/drag starting on a real control shouldn't also be captured as a gesture — buttons/inputs/links keep their native behavior, `<video>` keeps its own native touch controls, and `data-shoji-no-drag` is an explicit host/plugin escape hatch (CLAUDE.md's `data-shoji-*` prefix). */
function shouldIgnoreGesture(event: PointerEvent): boolean {
  return event
    .composedPath()
    .some(
      (node) =>
        node instanceof Element &&
        node.matches('button, video, input, select, textarea, a[href], [data-shoji-no-drag]'),
    );
}

/** What `GestureController` needs from `Gallery` — narrow on purpose, so this module never reaches into Gallery internals beyond this contract. */
export interface GestureControllerHost {
  dialog: HTMLElement;
  slides: SlideManager;
  canGoNext(): boolean;
  canGoPrev(): boolean;
  next(): void;
  prev(): void;
  close(): void;
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

  constructor(
    private readonly host: GestureControllerHost,
    relay: GestureRelayCallbacks,
    options?: Partial<GestureEngineOptions>,
  ) {
    this.engine = new GestureEngine(
      host.dialog,
      {
        ignore: shouldIgnoreGesture,
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
    } else {
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

  /** Purely presentational drag feedback — scales/fades the dialog toward `close()`'s target state as the viewer drags, without closing until release decides the outcome. */
  private applyVerticalDragFeedback(delta: number): void {
    const progress = Math.min(Math.abs(delta) / VERTICAL_FEEDBACK_DISTANCE, 1);
    const dialog = this.host.dialog;
    dialog.style.transition = '';
    dialog.style.transform = `translateY(${delta}px) scale(${1 - progress * 0.15})`;
    dialog.style.opacity = String(1 - progress * 0.6);
  }

  private clearVerticalDragFeedback(animate: boolean): void {
    const dialog = this.host.dialog;
    dialog.style.transition = animate ? DRAG_FEEDBACK_TRANSITION : '';
    dialog.style.transform = '';
    dialog.style.opacity = '';
  }

  private finishVerticalDrag(completed: boolean): void {
    if (completed) {
      // No settle animation of its own — clear the feedback instantly and
      // let close()'s own zoom-out transition (zoomTransition.ts) take over
      // as the single visible closing animation, rather than stacking two.
      this.clearVerticalDragFeedback(false);
      this.host.close();
    } else {
      this.clearVerticalDragFeedback(true);
    }
  }
}
