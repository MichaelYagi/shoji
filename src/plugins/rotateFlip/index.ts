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
 */
function transformFor(flipH: boolean, flipV: boolean, rotationDeg: number): string {
  if (!flipH && !flipV && rotationDeg === 0) return 'none';
  return `scaleX(${flipH ? -1 : 1}) scaleY(${flipV ? -1 : 1}) rotate(${rotationDeg}deg)`;
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
    function apply(animate: boolean): void {
      const media = gallery.getActiveMedia();
      if (!media) return;
      const transform = transformFor(visualFlipH, visualFlipV, visualRotation);
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

    rotateLeftBtn.addEventListener('click', () => update({ rotation: state.rotation - 90 }, -90));
    rotateRightBtn.addEventListener('click', () => update({ rotation: state.rotation + 90 }, 90));
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
