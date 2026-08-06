import type { PluginContext, ShojiPlugin } from '../../core/plugin';
import { normalizeRotateFlip, type RotateFlipState } from '../../core/rotateFlipNormalize';
import { FLIP_H_ICON, FLIP_V_ICON, ROTATE_LEFT_ICON, ROTATE_RIGHT_ICON } from './icons';

const NEUTRAL: RotateFlipState = { flipH: false, flipV: false, rotation: 0 };

/** Flip axes apply to the *currently visible* (already-rotated) orientation, not the original unrotated image — `scaleX`/`scaleY` listed before `rotate()` in the transform string is what makes that true: CSS transform functions apply right-to-left, so `rotate()` (rightmost) affects the content first, and the flip (leftmost) acts on that already-rotated result. */
function transformFor(state: RotateFlipState): string {
  if (!state.flipH && !state.flipV && state.rotation === 0) return 'none';
  return `scaleX(${state.flipH ? -1 : 1}) scaleY(${state.flipV ? -1 : 1}) rotate(${state.rotation}deg)`;
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

    function apply(): void {
      const media = gallery.getActiveMedia();
      if (media) media.style.transform = transformFor(state);
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

    function update(patch: Partial<RotateFlipState>): void {
      state = normalizeRotateFlip({ ...state, ...patch });
      apply();
      flipHBtn.setAttribute('aria-pressed', String(state.flipH));
      flipVBtn.setAttribute('aria-pressed', String(state.flipV));
      ctx.emit('rotateFlipChange', { index: gallery.currentIndex, ...state });
    }

    rotateLeftBtn.addEventListener('click', () => update({ rotation: state.rotation - 90 }));
    rotateRightBtn.addEventListener('click', () => update({ rotation: state.rotation + 90 }));
    flipHBtn.addEventListener('click', () => update({ flipH: !state.flipH }));
    flipVBtn.addEventListener('click', () => update({ flipV: !state.flipV }));

    function reset(): void {
      state = { ...NEUTRAL };
      apply();
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
