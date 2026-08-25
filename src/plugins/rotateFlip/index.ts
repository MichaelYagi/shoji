import type { PluginContext, ShojiPlugin } from '../../core/plugin';
import { normalizeRotateFlip, type RotateFlipState } from '../../core/rotateFlipNormalize';
import { waitForTransitionEnd } from '../../core/zoomTransition';
import { FLIP_H_ICON, FLIP_V_ICON, ROTATE_LEFT_ICON, ROTATE_RIGHT_ICON } from './icons';

const NEUTRAL: RotateFlipState = { flipH: false, flipV: false, rotation: 0 };

/**
 * Flip axes apply to the *currently visible* (already-rotated) orientation,
 * not the original unrotated image — `scaleX`/`scaleY` listed before
 * `rotate()` in the transform string is what makes that true: CSS transform
 * functions apply right-to-left, so `rotate()` (rightmost) affects the
 * content first, and the flip (leftmost) acts on that already-rotated
 * result.
 *
 * `flipH`/`flipV`/`rotationDeg` here are the *raw, uncanonicalized* visual
 * values (see `visualFlipH`/`visualFlipV`/`visualRotation` below) — never
 * `state`'s own normalized ones. Two real bugs came from feeding the
 * normalized state directly into this animated transform instead:
 *
 * 1. `rotationDeg` must be unbounded, not wrapped to `[0, 360)`: animating
 *    straight to a wrapped value (e.g. 270° → 0° after a fourth
 *    rotate-right click, instead of continuing on to 360°) makes the
 *    browser interpolate a 270° *decrease*, spinning backward almost a
 *    full turn instead of continuing the same 90° forward step being
 *    clicked through.
 * 2. `flipH`/`flipV` must stay two independent, literal booleans, never
 *    collapsed the way `normalizeRotateFlip` collapses `flipH && flipV`
 *    into `rotation + 180`: flipping horizontal then vertical while
 *    already flipped horizontal would otherwise animate `scaleX` back to
 *    1 *and* `rotate` up to 180° simultaneously (both values are in the
 *    transform-function list, so the browser interpolates each
 *    independently) — a compound squish-and-spin instead of the plain
 *    vertical-flip motion "Flip vertical" implies. Keeping the raw
 *    booleans means only `scaleY` ever changes for that click, since
 *    flipping both axes is algebraically identical to a 180° rotation
 *    regardless of what rotation is already applied — the *end* look
 *    always matches the canonical state either way, only the *animated
 *    path* differs.
 *
 * `rotationDeg === 0` is still a safe, unambiguous "truly neutral" check
 * for the shortcut below — every rotate click adds ±90, so it only lands
 * back on exactly `0` at genuine reset/initial state, never a masked
 * multiple of 360.
 *
 * `fitScale` (see `fitScaleFor` below) is folded directly into `scaleX`/
 * `scaleY` — a single uniform factor commutes with everything else already
 * in this transform (rotate, and flip's own -1), so multiplying it in here
 * is exactly equivalent to a separate trailing `scale()` function, without
 * adding a fourth transform function for the browser to interpolate.
 */
function transformFor(
  flipH: boolean,
  flipV: boolean,
  rotationDeg: number,
  fitScale: number,
): string {
  if (!flipH && !flipV && rotationDeg === 0 && fitScale === 1) return 'none';
  const scaleX = (flipH ? -1 : 1) * fitScale;
  const scaleY = (flipV ? -1 : 1) * fitScale;
  return `scaleX(${scaleX}) scaleY(${scaleY}) rotate(${rotationDeg}deg)`;
}

/**
 * DESIGN.md §4.5 — shrinks the *visible photo* exactly as much as needed to
 * keep it from getting its edges clipped away when rotated, and grows it
 * back up to fill newly-available space on rotation, but never past its
 * own native pixel resolution.
 *
 * **A real bug in the previous version of this fix, caught from real usage
 * on the docs site itself: it assumed `.shoji-slide-img` always scales to
 * *touch* the container on at least one axis (`object-fit: contain`'s
 * usual behavior), which is wrong.** The actual CSS is `max-width: 100%;
 * max-height: 100%` — a *cap*, not a forced fill (documented in
 * `shoji.css`'s own comment: real photos are assumed bigger than the
 * slide area, so never growing past natural size is the correct default).
 * A small placeholder photo, comfortably smaller than the dialog, simply
 * renders at its own native size — untouching every edge, nothing scaled.
 * The previous formula didn't know this: it computed an imagined
 * "as if `object-fit: contain` always scales to fill" pre-rotation size
 * (e.g. an 800×600 photo hypothetically stretched to ~1267×950 in a
 * 1920×950 window), then shrank *from that invented size* — a real,
 * visible shrink relative to what was actually on screen a moment
 * earlier, even though nothing should have changed at all. Confirmed
 * directly: measuring the real `<img>` on the real deployed docs page
 * showed it rendered at exactly its 800×600 native size, not the
 * "contain-fit" size the old formula assumed.
 *
 * **The fix: compute the photo's real render scale at each orientation
 * the same way the browser's own CSS does, then compare the two —
 * instead of computing an idealized target size and separately capping
 * it.** `scaleAt0`/`scaleAt90` are each `Math.min(1, mediaWidth /
 * relevantNaturalWidth, mediaHeight / relevantNaturalHeight)` — exactly
 * mirroring `max-width/max-height: 100%`'s own "shrink to fit, never grow
 * past native size" rule, once for the current (unrotated) orientation
 * and once for the rotated one (natural width/height swapped). The result
 * is simply their ratio: how much *more* (or less) of its own native
 * resolution the rotated orientation can use compared to what's already
 * on screen. This single ratio does everything the old two-step
 * idealFit-then-cap formula tried to do, correctly and for free: neither
 * `scaleAt0` nor `scaleAt90` can ever exceed `1` (native resolution is
 * never exceeded, in *either* orientation, not just relative to a
 * possibly-wrong assumed starting point), and whichever one is more
 * constrained by the container — rather than by native resolution —
 * still shrinks or grows the ratio exactly as far as that constraint
 * requires.
 *
 * `1` (a no-op) for 0°/180° — a rectangle's own bounding box is unchanged
 * by a half-turn, nothing to re-fit — and whenever either media dimension
 * isn't known yet (not yet laid out) or the photo's own natural dimensions
 * aren't known at all (video, or an image that hasn't decoded) — skipped
 * entirely rather than guessing.
 */
function fitScaleFor(
  mediaWidth: number,
  mediaHeight: number,
  rotationDeg: number,
  naturalWidth: number | undefined,
  naturalHeight: number | undefined,
): number {
  if (!mediaWidth || !mediaHeight || !naturalWidth || !naturalHeight) return 1;
  if ((rotationDeg / 90) % 2 === 0) return 1;
  const scaleAt0 = Math.min(1, mediaWidth / naturalWidth, mediaHeight / naturalHeight);
  const scaleAt90 = Math.min(1, mediaWidth / naturalHeight, mediaHeight / naturalWidth);
  return scaleAt90 / scaleAt0;
}

/**
 * DESIGN.md §4 — rotate ±90°/flip H/V of the *view*: a CSS transform on the
 * active `.shoji-slide-media`, non-destructive, resets to neutral on every
 * `afterOpen`/`afterSlide` (per-slide, not per-gallery — DESIGN.md's own
 * wording). Emits `rotateFlipChange` on every change so a host that wants
 * this to persist can store it themselves and re-apply later (e.g. by
 * feeding a starting orientation back in some other way) — this plugin
 * itself has no persistence of its own, matching "resets per slide".
 *
 * Distinct from the (unbuilt) Editor plugin's own rotate/flip (§8), which
 * is destructive/persisted server-side via `item.edits`. Both share the
 * same composition math (`normalizeRotateFlip`, `src/core/`) rather than
 * each re-deriving flip+rotate's non-commutative composition — a real bug
 * class CLAUDE.md calls out by name.
 */
export const RotateFlip: ShojiPlugin = {
  name: 'rotateFlip',

  init(ctx: PluginContext): () => void {
    const { gallery } = ctx;
    const locale = (gallery.options.locale ?? {}) as Record<string, string>;
    const rotateLeftLabel = locale.rotateLeft ?? 'Rotate left';
    const rotateRightLabel = locale.rotateRight ?? 'Rotate right';
    const flipHLabel = locale.flipHorizontal ?? 'Flip horizontal';
    const flipVLabel = locale.flipVertical ?? 'Flip vertical';

    let state: RotateFlipState = { ...NEUTRAL };
    /** Unbounded — never wrapped like `state.rotation` is. Drives only the CSS transform's rotate() degrees, so every rotate click continues smoothly in the same direction (90, 180, 270, 360, 450, ...) instead of snapping backward whenever the normalized state wraps past 0/360. See `transformFor`'s own doc comment for the full reasoning. */
    let visualRotation = 0;
    /** Raw, independent toggles — never collapsed into a rotation the way `state.flipH`/`state.flipV` are. See `transformFor`'s own doc comment. */
    let visualFlipH = false;
    let visualFlipV = false;

    /**
     * `animate` mirrors the Zoom plugin's own "discrete jumps animate"
     * pattern (`zoom/index.ts`'s `withTransition`) — a button click is a
     * one-shot state change, not a continuous gesture, so it eases instead
     * of snapping. `reset()` stays unanimated: the viewer never rotated the
     * new slide, so there's nothing to visibly animate *from*. The
     * transition is cleared once it ends so it doesn't linger onto the
     * open/close zoom transition's own later use of this same element's
     * `transform` (`zoomTransition.ts`, `.shoji-slide-media`).
     */
    /** `item.width`/`height` when known, else the active image's own natural dimensions — same fallback order the zoom transition (§2.3b) uses for its own aspect ratio, just sourced from the slide itself rather than the origin thumbnail, and kept as a real width/height pair (not collapsed to a ratio) since `fitScaleFor` needs the actual pixel counts for its resolution ceiling, not just their proportion. `undefined` for anything else (video, an image not yet decoded) — `fitScaleFor` treats that as nothing to fit, not a guess. */
    function resolveNaturalSize(media: HTMLElement): { width: number; height: number } | undefined {
      const item = gallery.items[gallery.currentIndex];
      if (item?.width && item.height) return { width: item.width, height: item.height };
      const img = media.querySelector('img');
      if (img?.naturalWidth && img.naturalHeight) {
        return { width: img.naturalWidth, height: img.naturalHeight };
      }
      return undefined;
    }

    function apply(animate: boolean): void {
      const media = gallery.getActiveMedia();
      if (!media) return;
      const natural = resolveNaturalSize(media);
      const fitScale = fitScaleFor(
        media.clientWidth,
        media.clientHeight,
        visualRotation,
        natural?.width,
        natural?.height,
      );
      const transform = transformFor(visualFlipH, visualFlipV, visualRotation, fitScale);
      if (!animate) {
        media.style.transform = transform;
        return;
      }
      media.style.transition = 'transform var(--shoji-duration) var(--shoji-easing)';
      media.style.transform = transform;
      waitForTransitionEnd(media, () => {
        media.style.transition = '';
      });
    }

    function buildButton(icon: string, label: string): HTMLButtonElement {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'shoji-toolbar-button';
      button.innerHTML = icon;
      button.setAttribute('aria-label', label);
      button.title = label;
      return button;
    }

    const rotateLeftBtn = buildButton(ROTATE_LEFT_ICON, rotateLeftLabel);
    const rotateRightBtn = buildButton(ROTATE_RIGHT_ICON, rotateRightLabel);
    const flipHBtn = buildButton(FLIP_H_ICON, flipHLabel);
    const flipVBtn = buildButton(FLIP_V_ICON, flipVLabel);
    flipHBtn.setAttribute('aria-pressed', 'false');
    flipVBtn.setAttribute('aria-pressed', 'false');

    /**
     * `visualRotationDelta`, when given, is a rotate click's own known
     * direction (±90) — applied as-is to the unbounded `visualRotation`.
     * Flip clicks omit it entirely: `visualFlipH`/`visualFlipV` are toggled
     * directly at each call site instead, completely independent of
     * `state`'s own canonicalized rotation/flip collapse (`transformFor`'s
     * doc comment has the full reasoning for why the two must stay
     * decoupled).
     */
    function update(patch: Partial<RotateFlipState>, visualRotationDelta?: number): void {
      state = normalizeRotateFlip({ ...state, ...patch });
      if (visualRotationDelta !== undefined) visualRotation += visualRotationDelta;
      apply(true);
      flipHBtn.setAttribute('aria-pressed', String(state.flipH));
      flipVBtn.setAttribute('aria-pressed', String(state.flipV));
      ctx.emit('rotateFlipChange', { index: gallery.currentIndex, ...state });
    }

    /**
     * A real bug, reported from real usage: with exactly one flip axis
     * active, "Rotate right" visually spun the image counter-clockwise
     * instead — a `+90` raw `rotate()` delta composed with a single
     * `scaleX(-1)`/`scaleY(-1)` mirror reverses the rotation's visual
     * handedness (a mirror is a reflection — determinant -1 — so a
     * clockwise turn *inside* it reads as counter-clockwise once mirrored
     * back onto the screen). Flipping *both* axes doesn't have this problem
     * — two reflections compose back into a rotation (determinant +1, same
     * as no flip at all), which is exactly why `normalizeRotateFlip`
     * already collapses that combination into a plain 180° rotation.
     * Inverting the raw delta whenever `visualFlipH !== visualFlipV` (XOR —
     * "exactly one axis flipped") makes the buttons always spin the image
     * the way they're visually labeled, regardless of flip state; `state`
     * (the canonicalized, emitted value) gets the same inverted delta, so
     * it stays an accurate description of what's actually on screen.
     */
    function rotateDelta(clockwise: boolean): number {
      const flippedOnOneAxis = visualFlipH !== visualFlipV;
      return clockwise !== flippedOnOneAxis ? 90 : -90;
    }

    /** Shared by the rotate-left toolbar button and `requestRotateLeft` below. */
    function rotateLeft(): void {
      const delta = rotateDelta(false);
      update({ rotation: state.rotation + delta }, delta);
    }
    /** Shared by the rotate-right toolbar button and `requestRotateRight` below. */
    function rotateRight(): void {
      const delta = rotateDelta(true);
      update({ rotation: state.rotation + delta }, delta);
    }
    /** Shared by the flip-horizontal toolbar button and `requestFlipHorizontal` below. */
    function flipHorizontal(): void {
      visualFlipH = !visualFlipH;
      update({ flipH: !state.flipH });
    }
    /** Shared by the flip-vertical toolbar button and `requestFlipVertical` below. */
    function flipVertical(): void {
      visualFlipV = !visualFlipV;
      update({ flipV: !state.flipV });
    }

    rotateLeftBtn.addEventListener('click', rotateLeft);
    rotateRightBtn.addEventListener('click', rotateRight);
    flipHBtn.addEventListener('click', flipHorizontal);
    flipVBtn.addEventListener('click', flipVertical);

    function reset(): void {
      state = { ...NEUTRAL };
      visualRotation = 0;
      visualFlipH = false;
      visualFlipV = false;
      apply(false);
      flipHBtn.setAttribute('aria-pressed', 'false');
      flipVBtn.setAttribute('aria-pressed', 'false');
    }

    /**
     * DESIGN.md §2.5/§4.5 — a real bug: clicking next/prev on a
     * rotated/flipped slide snapped it back to neutral *before* the slide
     * transition started, instead of un-rotating as part of it.
     * `beforeSlide`'s own `reset()` (below) still has to stay unanimated and
     * still has to run before `SlideManager.render()` reparents the
     * outgoing slide (the sixth real bug above) — that constraint doesn't
     * go away. What changes: the transform about to be wiped is captured
     * here first and handed to `SlideTransition` via
     * `registerSlideLeaveDecorator()` (Zoom registers its own, for the same
     * reason) — the decorator runs once, right after the ghost clones the
     * outgoing slide (the real node's already been reset by then, so the
     * clone alone wouldn't carry it), freezes the captured transform onto
     * that clone, and animates it back to neutral over the same window the
     * ghost itself is leaving in. Only the ghost animates away from it now.
     */
    let pendingLeaveTransform: string | null = null;
    function captureLeaveTransform(): void {
      const media = gallery.getActiveMedia();
      const transform = media?.style.transform;
      pendingLeaveTransform = transform && transform !== 'none' ? transform : null;
    }

    // 'right' — registered in this order, so they cluster left-to-right as
    // rotateLeft, rotateRight, flipH, flipV, then whatever later plugin (or
    // the close button) follows (DESIGN.md §3.1).
    const removeButtons = [rotateLeftBtn, rotateRightBtn, flipHBtn, flipVBtn].map((button) =>
      ctx.ui.toolbar('right', button),
    );

    /**
     * A generic command surface, requested directly (DESIGN.md §4.5), so a
     * *custom* (host-authored) plugin's own button can rotate/flip without
     * importing this plugin at all — same "events over inheritance"
     * decoupling every other listener here already uses.
     * `GalleryEvents` (`core/types.ts`) already extends `Record<string,
     * unknown>`, so `ctx.emit('requestRotateLeft', {})` from any plugin —
     * official or custom — type-checks with zero core changes; this is
     * just the listening half. Each mirrors its real toolbar button
     * exactly — same functions, same behavior.
     */
    const offRequestRotateLeft = ctx.on('requestRotateLeft', rotateLeft);
    const offRequestRotateRight = ctx.on('requestRotateRight', rotateRight);
    const offRequestFlipHorizontal = ctx.on('requestFlipHorizontal', flipHorizontal);
    const offRequestFlipVertical = ctx.on('requestFlipVertical', flipVertical);
    const offOpen = ctx.on('afterOpen', reset);
    // Un-animated, and on beforeSlide rather than only afterSlide below —
    // same fix, same reasoning, as the Zoom plugin's own identical bug
    // (zoom/index.ts's own beforeSlide handler): SlideManager.render()
    // (called synchronously between the two) reuses a still-cached slide's
    // node via a plain reparent (moveIn(), no state clearing of its own)
    // into whichever pool slot its new offset needs — there is no code
    // path afterward that can still find *this* slide to reset it.
    // Reported from real usage: rotate, click next — the old, still-
    // rotated slide, now reparented into the (unclipped, per shoji.css)
    // neighboring slot, visibly bled into the new slide instead of
    // sitting invisibly off-screen the way an unrotated one always does.
    // Resetting here, while getActiveMedia() still resolves to the
    // about-to-move slide, clears it before that reparent ever happens.
    // afterSlide (below) still separately resets whichever *incoming*
    // slide becomes active — it may carry its own stale rotation from an
    // earlier visit, unrelated to whatever the outgoing slide had.
    // captureLeaveTransform() (see its own doc comment) runs first, while
    // the about-to-be-cleared transform is still readable.
    const offBeforeSlide = ctx.on('beforeSlide', () => {
      captureLeaveTransform();
      reset();
    });
    const offSlide = ctx.on('afterSlide', reset);
    const unregisterLeaveDecorator = gallery.registerSlideLeaveDecorator((clonedMedia) => {
      if (!pendingLeaveTransform) return;
      const transform = pendingLeaveTransform;
      pendingLeaveTransform = null;
      clonedMedia.style.transform = transform;
      return () => {
        clonedMedia.style.transition = 'transform var(--shoji-duration) var(--shoji-easing)';
        clonedMedia.style.transform = 'none';
      };
    });

    return () => {
      for (const remove of removeButtons) remove();
      offRequestRotateLeft();
      offRequestRotateRight();
      offRequestFlipHorizontal();
      offRequestFlipVertical();
      offOpen();
      offBeforeSlide();
      offSlide();
      unregisterLeaveDecorator();
    };
  },
};
