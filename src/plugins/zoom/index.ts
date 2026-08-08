import type { PluginContext, ShojiPlugin } from '../../core/plugin';
import { waitForTransitionEnd } from '../../core/zoomTransition';
import { ZOOM_ACTUAL_SIZE_ICON, ZOOM_IN_ICON, ZOOM_OUT_ICON } from './icons';
import { clampPan, clampScale, zoomTowardPoint, type PanOffset, type ZoomBox } from './zoomMath';
import './zoom.css';

export interface ZoomOptions {
  /** Multiplier cap for pinch/wheel/button zoom. "Actual size" can exceed this deliberately — it's an explicit action, not continuous gesture zoom. Default 4. */
  maxScale?: number;
  /** Scale a double-tap/double-click jumps to; a second one while already zoomed resets to 1 instead. Default 2. */
  doubleTapScale?: number;
  /** Multiplier applied per zoom-in/zoom-out toolbar button click. Default 1.5. */
  buttonStep?: number;
}

const ZOOM_EPSILON = 1.001; // treat "just barely above 1" as unzoomed — avoids float residue pinning isZoomed() true forever

/** A click/drag starting on a real control shouldn't engage pan — same exclusion list GestureController's shouldIgnoreGesture uses, duplicated rather than imported since that function isn't part of core's exported surface. */
function isRealControl(event: PointerEvent): boolean {
  return event
    .composedPath()
    .some(
      (node) =>
        node instanceof Element &&
        node.matches('button, video, input, select, textarea, a[href], [data-shoji-no-drag]'),
    );
}

/**
 * DESIGN.md §4-zoom — pinch, double-tap/click, wheel+ctrl, and three toolbar
 * buttons (zoom in/out/actual-size) all drive a single `scale`/pan state on
 * the active slide's `<img>` — never `.shoji-slide-media` itself, which the
 * rotateFlip plugin (§4) already transforms; nesting on the inner element
 * instead of fighting over the same transform string means a rotated *and*
 * zoomed photo behaves correctly for free (the outer rotate carries the
 * inner pan/scale along with it as a rigid unit, which is also the visually
 * expected result — see DESIGN.md's note on this plugin for the full
 * reasoning). Pinch/double-tap/wheel are core's own gesture relay (§2.4) —
 * scaffolding that existed specifically for this plugin to consume, not
 * reimplemented here. Pan (single-pointer drag while zoomed) is the one
 * piece core's relay doesn't cover — core's own drag-to-navigate/
 * drag-to-close would otherwise fight over the same drag — so this plugin
 * registers a zoom gate (`Gallery.registerZoomGate`, §4-zoom) that suspends
 * core's drag handling entirely while zoomed, and tracks pan with its own
 * minimal raw pointer listeners instead of reusing `GestureEngine` (whose
 * axis-locked model — pick horizontal *or* vertical per gesture — is the
 * wrong shape for a 2D pan that needs both at once).
 */
export const Zoom: ShojiPlugin = {
  name: 'zoom',
  defaults: {
    maxScale: 4,
    doubleTapScale: 2,
    buttonStep: 1.5,
  } satisfies ZoomOptions,

  init(ctx: PluginContext): () => void {
    const { gallery } = ctx;
    const maxScale = Number(ctx.options.maxScale ?? 4);
    const doubleTapScale = Number(ctx.options.doubleTapScale ?? 2);
    const buttonStep = Number(ctx.options.buttonStep ?? 1.5);
    const locale = (gallery.options.locale ?? {}) as Record<string, string>;
    const zoomInLabel = locale.zoomIn ?? 'Zoom in';
    const zoomOutLabel = locale.zoomOut ?? 'Zoom out';
    const actualSizeLabel = locale.zoomActualSize ?? 'Actual size';

    let scale = 1;
    let pan: PanOffset = { tx: 0, ty: 0 };
    let natural: ZoomBox | null = null;
    let container: ZoomBox | null = null;
    let pinchStartScale = 1;

    function getImg(): HTMLImageElement | null {
      const media = gallery.getActiveMedia();
      const child = media?.firstElementChild;
      return child instanceof HTMLImageElement ? child : null;
    }

    function boxOf(el: Element): ZoomBox {
      const rect = el.getBoundingClientRect();
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    }

    /** Only valid to measure while scale===1 (untransformed) — the very first zoom action on a slide; every subsequent action within the same slide reuses the cached box, since measuring an already-scaled element would capture the scaled size, not the natural one. */
    function ensureNatural(img: HTMLImageElement): boolean {
      if (natural && container) return true;
      if (scale !== 1) return false; // shouldn't happen — defensive
      natural = boxOf(img);
      container = boxOf(img.parentElement ?? img);
      return true;
    }

    /**
     * A real bug: `ensureNatural`'s first measurement of a slide is only
     * trustworthy once the lightbox's own open FLIP transition (`zoomIn`,
     * `core/zoomTransition.ts`) has actually settled — that transition
     * applies its own transform directly to `.shoji-slide-media`, the exact
     * element `ensureNatural` measures as `container`. A zoom action firing
     * before it settles (any interaction within `--shoji-duration` of
     * opening — a fast click, or a test that only waits for the dialog to
     * become visible) captured a wildly wrong, mid-animation rect,
     * permanently poisoning that slide's zoom math (every later action
     * reuses the same cached, wrong box). `zoomIn` is fire-and-forget by
     * design (nothing to await when opening) and clears this exact inline
     * style once its own transition ends — the one signal available for
     * "is it still running." Runs `action` immediately once settled, which
     * is right away in the overwhelming common case (any real interaction
     * more than ~300ms after open).
     */
    function whenSettled(action: () => void): void {
      const media = gallery.getActiveMedia();
      if (!media || media.style.transition === '') {
        action();
        return;
      }
      waitForTransitionEnd(media, action);
    }

    function apply(): void {
      const img = getImg();
      if (!img) return;
      img.style.transformOrigin = '0 0';
      img.style.transform =
        scale === 1 && pan.tx === 0 && pan.ty === 0
          ? 'none'
          : `translate(${pan.tx}px, ${pan.ty}px) scale(${scale})`;
      img.classList.toggle('shoji-zoomed', scale > 1);
    }

    function emitChange(): void {
      ctx.emit('zoomChange', { index: gallery.currentIndex, scale });
    }

    /** Wraps a transform-setting `run` in a transition, for discrete jumps (buttons, double-tap, actual-size) — never for pinch/pan/wheel, which already track the input 1:1 and would visibly lag behind it under a transition. Cleared afterward so it doesn't linger onto the next, possibly-continuous, zoom action. */
    function withTransition(img: HTMLImageElement, run: () => void): void {
      img.style.transition = 'transform var(--shoji-duration) var(--shoji-easing)';
      run();
      waitForTransitionEnd(img, () => {
        img.style.transition = '';
      });
    }

    /** Shared by every zoom-in/out entry point (pinch, wheel, buttons, double-tap, actual-size) — anchors on (anchorX, anchorY), clamps scale to [1, ceiling] and pan to the container bounds. `ceiling` defaults to maxScale; actual-size passes its own (possibly larger) target so it isn't capped by the gesture-zoom limit. Deferred via `whenSettled` — see its doc comment — so a zoom action landing right as the lightbox opens doesn't measure mid-animation. `animate` — see `withTransition`. */
    function zoomTo(
      targetScale: number,
      anchorX: number,
      anchorY: number,
      ceiling = maxScale,
      animate = false,
    ): void {
      whenSettled(() => {
        const img = getImg();
        if (!img || !ensureNatural(img)) return;
        const clampedScale = clampScale(targetScale, 1, Math.max(ceiling, 1));
        pan = zoomTowardPoint(natural!, pan, scale, clampedScale, anchorX, anchorY);
        scale = clampedScale;
        pan = clampPan(natural!, container!, scale, pan);
        if (animate) withTransition(img, apply);
        else apply();
        emitChange();
      });
    }

    function reset(animate = false): void {
      scale = 1;
      pan = { tx: 0, ty: 0 };
      natural = null;
      container = null;
      const img = getImg();
      if (img) {
        const clear = (): void => {
          img.style.transform = '';
          img.style.transformOrigin = '';
          img.classList.remove('shoji-zoomed');
        };
        if (animate) withTransition(img, clear);
        else clear();
      }
    }

    /** Each slide gets a freshly-created `<img>` (SlideManager never reuses elements across renders), so the cursor-affordance marker (`zoom.css`) needs reapplying every time the active media changes, not just once. */
    function markEnabled(): void {
      getImg()?.classList.add('shoji-zoom-enabled');
    }

    function toggleZoom(x: number, y: number): void {
      if (scale > ZOOM_EPSILON) reset(true);
      else zoomTo(doubleTapScale, x, y, maxScale, true);
    }

    // --- pinch (relayed by core, §2.4 — no built-in effect until this plugin exists) ---
    const offPinchStart = ctx.on('pinchStart', () => {
      pinchStartScale = scale;
    });
    const offPinchMove = ctx.on('pinchMove', ({ scale: relative, centerX, centerY }) => {
      zoomTo(pinchStartScale * relative, centerX, centerY);
    });
    const offPinchEnd = ctx.on('pinchEnd', () => {
      if (scale <= ZOOM_EPSILON) reset(); // snap fully back to neutral rather than leaving float residue
    });

    // --- double-tap / double-click (relayed by core; Pointer Events unify the two, see GestureEngine) ---
    const offDoubleTap = ctx.on('doubleTap', ({ x, y }) => toggleZoom(x, y));

    // --- ctrl+wheel / trackpad pinch (relayed by core) ---
    const offWheelZoom = ctx.on('wheelZoom', ({ deltaScale, x, y }) => {
      zoomTo(scale + deltaScale, x, y);
    });

    // --- pan while zoomed — the one gesture core's relay doesn't cover; see the plugin doc comment for why this can't reuse GestureEngine. ---
    let panPointerId: number | null = null;
    let lastX = 0;
    let lastY = 0;
    const outer = ctx.ui.outer();

    function onPointerDown(event: PointerEvent): void {
      if (scale <= ZOOM_EPSILON || isRealControl(event)) return;
      panPointerId = event.pointerId;
      lastX = event.clientX;
      lastY = event.clientY;
    }
    function onPointerMove(event: PointerEvent): void {
      if (panPointerId !== event.pointerId || !natural || !container) return;
      event.preventDefault();
      const dx = event.clientX - lastX;
      const dy = event.clientY - lastY;
      lastX = event.clientX;
      lastY = event.clientY;
      pan = clampPan(natural, container, scale, { tx: pan.tx + dx, ty: pan.ty + dy });
      apply();
    }
    function onPointerUp(event: PointerEvent): void {
      if (panPointerId === event.pointerId) panPointerId = null;
    }

    outer.addEventListener('pointerdown', onPointerDown);
    outer.addEventListener('pointermove', onPointerMove, { passive: false });
    outer.addEventListener('pointerup', onPointerUp);
    outer.addEventListener('pointercancel', onPointerUp);

    // --- toolbar buttons ---
    function buildButton(icon: string, label: string): HTMLButtonElement {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'shoji-toolbar-button';
      button.innerHTML = icon;
      button.setAttribute('aria-label', label);
      button.title = label;
      return button;
    }

    function centerAnchor(): { x: number; y: number } {
      const media = gallery.getActiveMedia();
      const rect = media?.getBoundingClientRect();
      return rect
        ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
        : { x: 0, y: 0 };
    }

    const zoomInBtn = buildButton(ZOOM_IN_ICON, zoomInLabel);
    const zoomOutBtn = buildButton(ZOOM_OUT_ICON, zoomOutLabel);
    const actualSizeBtn = buildButton(ZOOM_ACTUAL_SIZE_ICON, actualSizeLabel);

    zoomInBtn.addEventListener('click', () => {
      const { x, y } = centerAnchor();
      zoomTo(scale * buttonStep, x, y, maxScale, true);
    });
    zoomOutBtn.addEventListener('click', () => {
      const { x, y } = centerAnchor();
      if (scale / buttonStep <= ZOOM_EPSILON) reset(true);
      else zoomTo(scale / buttonStep, x, y, maxScale, true);
    });
    actualSizeBtn.addEventListener('click', () => {
      // Reads natural.width directly (unlike every other entry point, which
      // just hands zoomTo a target and lets it call ensureNatural itself) —
      // needs its own whenSettled wrap for that reason, not just zoomTo's.
      whenSettled(() => {
        const img = getImg();
        if (!img || !img.naturalWidth) return;
        if (!ensureNatural(img)) return;
        if (scale > ZOOM_EPSILON) {
          reset(true);
          return;
        }
        const targetScale = img.naturalWidth / natural!.width;
        const { x, y } = centerAnchor();
        zoomTo(targetScale, x, y, targetScale, true); // ceiling = targetScale — bypasses maxScale deliberately
      });
    });

    // 'right' — registered in this order, so they cluster left-to-right as
    // zoomIn, zoomOut, actualSize, then whatever later plugin (or the close
    // button) follows (DESIGN.md §3.1).
    const removeButtons = [zoomInBtn, zoomOutBtn, actualSizeBtn].map((button) =>
      ctx.ui.toolbar('right', button),
    );

    const offOpen = ctx.on('afterOpen', () => {
      reset();
      markEnabled();
    });
    const offSlide = ctx.on('afterSlide', () => {
      reset();
      markEnabled();
    });
    // Fires synchronously, before Gallery.close() measures the active
    // media's rect to compute the zoom-out-to-thumbnail animation — reset
    // here (not just afterOpen/afterSlide) so that measurement sees the
    // image at its natural position/scale, not wherever it was left
    // zoomed/panned to. Skipping this made closing while zoomed animate
    // from the image's current (zoomed, often partly off-screen) rect
    // instead of its real thumbnail-relative size, landing "closed" at a
    // seemingly random spot instead of visibly shrinking into the thumbnail.
    const offBeforeClose = ctx.on('beforeClose', () => reset());
    const unregisterGate = gallery.registerZoomGate(() => scale > ZOOM_EPSILON);
    markEnabled(); // covers the (unusual but possible) case of the gallery already being open when this plugin initializes

    return () => {
      for (const remove of removeButtons) remove();
      offOpen();
      offSlide();
      offBeforeClose();
      offPinchStart();
      offPinchMove();
      offPinchEnd();
      offDoubleTap();
      offWheelZoom();
      outer.removeEventListener('pointerdown', onPointerDown);
      outer.removeEventListener('pointermove', onPointerMove);
      outer.removeEventListener('pointerup', onPointerUp);
      outer.removeEventListener('pointercancel', onPointerUp);
      unregisterGate();
      reset();
      getImg()?.classList.remove('shoji-zoom-enabled');
    };
  },
};
