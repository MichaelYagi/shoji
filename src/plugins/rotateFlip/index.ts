import type { PluginContext, ShojiPlugin } from '../../core/plugin';
import { normalizeRotateFlip, type RotateFlipState } from '../../core/rotateFlipNormalize';
import { containedBox, waitForTransitionEnd } from '../../core/zoomTransition';
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
 * own native pixel resolution. `.shoji-slide-media` is always its full box
 * (`width`/`height`: 100%) — the photo inside is usually *smaller*,
 * letterboxed to its own aspect ratio by `object-fit: contain` — and
 * rotate/flip is applied to that full container (not the `<img>` itself —
 * unlike the Zoom plugin, §4.6, which deliberately targets the image so
 * the two nest without conflicting), so rotating swaps its own footprint's
 * width/height: a photo that was already filling most of the container
 * can end up clipped once swapped, while a smaller, more letterboxed
 * photo's swapped footprint often still fits without any help at all.
 *
 * **The cap is on native resolution, not on "did it already fit" — a real,
 * reported correction to a real, reported correction.** The first version
 * of this always recomputed the photo's *ideal* best-fit size for its new
 * orientation, uncapped, which could grow *any* letterboxed photo — small
 * or large — to fill newly-available space; reported back as surprising
 * for small photos specifically (visibly growing on rotation reads as a
 * glitch). The fix after that instead capped growth at `1` outright — never
 * scale up, full stop — which *did* fix small photos, but was too blunt:
 * reported back a second time, this time for a large one. A 6144×8160
 * photo, letterboxed on a 1080p monitor before rotating (its portrait
 * shape doesn't match a landscape screen), was capped from growing to fill
 * the newly-available width after rotating — even though a photo with
 * that much native resolution has far more pixels than a 1080p screen
 * could ever need, so growing it costs nothing in quality. The two capped
 * cases (`1`) looked identical by that formula — "was it already filling
 * the screen" — even though the *reason* not to grow only applies to one
 * of them: a 170×222 photo can't grow without exceeding its own native
 * pixel size (visibly blurring, real upscaling past native resolution),
 * while the 6144×8160 one has orders of magnitude of headroom before that
 * ever becomes a concern. "How much of the screen it fills" and "how much
 * resolution it has" are different questions; the previous fix conflated
 * them into one binary cap.
 *
 * `resCeiling` computes the largest scale that keeps the rotated photo's
 * rendered size, in real device pixels (`window.devicePixelRatio`, so a
 * HiDPI/Retina screen doesn't get a bigger free pass than its physical
 * pixel density actually allows), at or under `naturalWidth`/`naturalHeight`
 * in *both* axes — beyond that is genuine upscaling, not free. Floored at
 * `1`: if the photo is already being upscaled even at its current,
 * pre-rotation size (a very low-res photo displayed at a much larger
 * layout size — unrelated to rotation, already true beforehand), this
 * isn't the place to *additionally* shrink it back down to native size;
 * the floor means it only ever caps *further* growth, never forces a new
 * shrink. `Math.min(idealFit, resCeiling)`: grows up to whichever is more
 * restrictive — the container's own available space, or the photo's own
 * resolution ceiling — and still shrinks by `idealFit` alone whenever it's
 * below `1` (avoiding clipping), completely unaffected by `resCeiling`'s
 * floor.
 *
 * Both computed from the photo's own contain-fit box (`containedBox`,
 * `zoomTransition.ts` — the same "object-fit: contain" math the open/close
 * zoom transition already relies on, reused rather than re-derived), not
 * the container's raw dimensions — a separate, earlier correction: an
 * intermediate version used the container's own shape instead, which is
 * always "safe" (can never overflow) but shrinks based on the *container's*
 * shape, margins included, not the photo's actual (usually much less
 * extreme) one, so it over-shrank large near-full-bleed photos. The
 * container's own margins *can* still paint outside `.shoji-slides` with
 * this fix — confirmed harmless: `.shoji-slides`' `overflow: hidden`
 * already clips them (they're invisible, nothing to see), and the page
 * itself no longer grows from it either, handled independently by locking
 * `<html>`'s own `overflow` (`src/core/bodyScrollLock.ts`) while the
 * lightbox is open.
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
  const photo = containedBox(
    { left: 0, top: 0, width: mediaWidth, height: mediaHeight },
    naturalWidth / naturalHeight,
  );
  if (!photo.width || !photo.height) return 1;
  const idealFit = Math.min(mediaWidth / photo.height, mediaHeight / photo.width);
  const dpr = window.devicePixelRatio || 1;
  // Rotated+scaled-by-S, the photo's rendered box is (photo.height*S) wide
  // by (photo.width*S) tall (swapped) — in CSS px; multiplying by dpr
  // converts to real device px, comparable against naturalWidth/Height.
  const resCeiling = Math.max(
    1,
    Math.min(naturalWidth / (photo.height * dpr), naturalHeight / (photo.width * dpr)),
  );
  return Math.min(idealFit, resCeiling);
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

    rotateLeftBtn.addEventListener('click', () => {
      const delta = rotateDelta(false);
      update({ rotation: state.rotation + delta }, delta);
    });
    rotateRightBtn.addEventListener('click', () => {
      const delta = rotateDelta(true);
      update({ rotation: state.rotation + delta }, delta);
    });
    flipHBtn.addEventListener('click', () => {
      visualFlipH = !visualFlipH;
      update({ flipH: !state.flipH });
    });
    flipVBtn.addEventListener('click', () => {
      visualFlipV = !visualFlipV;
      update({ flipV: !state.flipV });
    });

    function reset(): void {
      state = { ...NEUTRAL };
      visualRotation = 0;
      visualFlipH = false;
      visualFlipV = false;
      apply(false);
      flipHBtn.setAttribute('aria-pressed', 'false');
      flipVBtn.setAttribute('aria-pressed', 'false');
    }

    // 'right' — registered in this order, so they cluster left-to-right as
    // rotateLeft, rotateRight, flipH, flipV, then whatever later plugin (or
    // the close button) follows (DESIGN.md §3.1).
    const removeButtons = [rotateLeftBtn, rotateRightBtn, flipHBtn, flipVBtn].map((button) =>
      ctx.ui.toolbar('right', button),
    );

    const offOpen = ctx.on('afterOpen', reset);
    const offSlide = ctx.on('afterSlide', reset);

    return () => {
      for (const remove of removeButtons) remove();
      offOpen();
      offSlide();
    };
  },
};
