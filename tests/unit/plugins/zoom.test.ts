import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Gallery } from '../../../src/core';
import { Zoom } from '../../../src/plugins/zoom';
import type { GalleryItem } from '../../../src/core/types';
import type { PluginContext } from '../../../src/core/plugin';

/** A minimal stand-in for a host-authored custom plugin — captures `ctx.emit` so a test can fire a `request*` command the same way a real custom plugin's own button click would, with zero import of Zoom itself. */
class EmitterPlugin {
  name = 'test-emitter';
  emit!: PluginContext['emit'];
  init(ctx: PluginContext): void {
    this.emit = ctx.emit;
  }
}

const DEFAULT_RECT: DOMRect = {
  top: 0,
  left: 0,
  right: 300,
  bottom: 300,
  width: 300,
  height: 300,
  x: 0,
  y: 0,
  toJSON: () => ({}),
};

beforeEach(() => {
  HTMLImageElement.prototype.decode = vi.fn().mockResolvedValue(undefined);
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(DEFAULT_RECT);
});

afterEach(() => {
  vi.restoreAllMocks();
  // @ts-expect-error - removing the test-only stub added above
  delete HTMLImageElement.prototype.decode;
  document.body.innerHTML = '';
});

const items: GalleryItem[] = [
  { id: 'a', src: 'a.jpg' },
  { id: 'b', src: 'b.jpg' },
];

function makeGallery(options: Record<string, unknown> = {}): Gallery {
  return new Gallery(document.createElement('div'), {
    items,
    plugins: [Zoom],
    preload: 0,
    ...options,
  });
}

/** `img.decode()` is mocked as an already-resolved promise — a microtask, not synchronous with open()/next(). SlideManager only attaches the `<img>` once it resolves. */
async function flushSlideLoad(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function dialog(): HTMLElement {
  return document.querySelector('.shoji-dialog') as HTMLElement;
}

/**
 * Scoped to the offset-0 `.shoji-slide` specifically (`translateX(calc(0%
 * ...`), not just the first `.shoji-slide-img` in DOM order — a real gap in
 * this helper, caught by SlideManager.ts's loop-wrap fix (DESIGN.md §2.3):
 * slots are physically fixed in DOM order at construction (`i - preload`),
 * so the "prev" slot is always first in the document regardless of which
 * offset it's currently relabeled to. Before loop-wrapping, that slot had
 * no image at all at either end of a small gallery, so the plain selector
 * happened to skip past it to the real active one; wrapping populates it
 * with the (real) wrapped-around neighbor, so the plain selector started
 * finding that instead. Plain JS traversal, not a
 * `[style*="calc(0%"] descendant` CSS selector — jsdom's selector engine
 * fails to match that combination (confirmed directly: `Element.matches()`
 * on the slide alone succeeds, but `querySelector` with a descendant
 * combinator after it does not), most likely the unbalanced `(` inside the
 * attribute-value string tripping up the same-engine's compound-selector
 * path specifically.
 */
function activeImg(): HTMLImageElement {
  const slide = Array.from(document.querySelectorAll<HTMLElement>('.shoji-slide')).find((el) =>
    el.style.transform.includes('calc(0%'),
  );
  return slide?.querySelector('.shoji-slide-img') as HTMLImageElement;
}

function button(label: string): HTMLButtonElement {
  return document.querySelector(
    `.shoji-toolbar-button[aria-label="${label}"]`,
  ) as HTMLButtonElement;
}

function click(el: Element): void {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

function press(key: string): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
}

function firePointer(
  target: EventTarget,
  type: string,
  opts: { clientX?: number; clientY?: number; pointerId?: number; isPrimary?: boolean } = {},
): void {
  target.dispatchEvent(
    new PointerEvent(type, {
      clientX: opts.clientX ?? 0,
      clientY: opts.clientY ?? 0,
      pointerId: opts.pointerId ?? 1,
      isPrimary: opts.isPrimary ?? true,
      bubbles: true,
      cancelable: true,
    }),
  );
}

/** The settle animation (Gallery.ts's settleDragOffset) waits on this element's transitionend — real browsers fire it once the CSS transition finishes; tests fire it directly instead of running real timers. */
function fireTransitionEnd(el: Element): void {
  const event = new Event('transitionend') as Event & { propertyName?: string };
  Object.defineProperty(event, 'propertyName', { value: 'transform' });
  el.dispatchEvent(event);
}

function slideRoot(): HTMLElement {
  return document.querySelector('.shoji-slide') as HTMLElement;
}

/**
 * A full horizontal drag: lock past lockThreshold, move further, release, then
 * complete the settle animation — matches gallery-gestures.test.ts's pattern
 * (a single jump straight to the final position would zero the effective
 * post-lock delta; skipping fireTransitionEnd leaves the index change queued
 * behind a transitionend that never fires). `startTarget` (default the
 * dialog) is where `pointerdown` fires — a zoomed pan test needs this to be
 * the image itself, since the Zoom plugin's own pan listener now only
 * engages for a pointerdown that actually starts there (see the
 * "backdrop click while zoomed" describe block below); the subsequent
 * move/up firing on the dialog regardless is fine either way — jsdom's
 * `dispatchEvent` doesn't retarget for real pointer capture, and `outer`'s
 * own listener receives both through ordinary bubbling.
 */
function dragHorizontal(endX: number, startTarget: EventTarget = dialog()): void {
  firePointer(startTarget, 'pointerdown', { clientX: 0, clientY: 0 });
  const d = dialog();
  firePointer(d, 'pointermove', { clientX: Math.sign(endX) * 11 || 11, clientY: 0 });
  firePointer(d, 'pointermove', { clientX: endX, clientY: 0 });
  firePointer(d, 'pointerup', { clientX: endX, clientY: 0 });
  fireTransitionEnd(slideRoot());
}

/** Two quick taps at the same point, close in time — GestureEngine reports this as doubleTap. */
function doubleTapAt(x: number, y: number): void {
  const d = dialog();
  firePointer(d, 'pointerdown', { clientX: x, clientY: y });
  firePointer(d, 'pointerup', { clientX: x, clientY: y });
  firePointer(d, 'pointerdown', { clientX: x, clientY: y });
  firePointer(d, 'pointerup', { clientX: x, clientY: y });
}

describe('Zoom — buttons', () => {
  it('inserts zoomIn/zoomOut/actualSize toolbar buttons', () => {
    const gallery = makeGallery();
    expect(button('Zoom in')).not.toBeNull();
    expect(button('Zoom out')).not.toBeNull();
    expect(button('Actual size')).not.toBeNull();
    gallery.destroy();
  });

  it('zoom-in button scales the active image up', async () => {
    const gallery = makeGallery();
    gallery.open(0);
    await flushSlideLoad();

    click(button('Zoom in'));

    expect(activeImg().style.transform).toContain('scale3d(1.5, 1.5, 1)');
    gallery.destroy();
  });

  it('zoom-out button from neutral is a no-op (already clamped to scale 1)', async () => {
    const gallery = makeGallery();
    gallery.open(0);
    await flushSlideLoad();

    click(button('Zoom out'));

    expect(activeImg().style.transform).toBe('');
    gallery.destroy();
  });

  it('zoom-in then zoom-out returns to neutral (transform cleared)', async () => {
    const gallery = makeGallery();
    gallery.open(0);
    await flushSlideLoad();

    click(button('Zoom in'));
    click(button('Zoom out'));

    expect(activeImg().style.transform).toBe('');
    gallery.destroy();
  });

  it('actual-size zooms toward the image natural resolution, then toggles back to neutral', async () => {
    const gallery = makeGallery();
    gallery.open(0);
    await flushSlideLoad();
    Object.defineProperty(activeImg(), 'naturalWidth', { value: 600, configurable: true });

    click(button('Actual size'));
    // natural rendered width is 300 (mocked rect) -> target scale 600/300 = 2
    expect(activeImg().style.transform).toContain('scale3d(2, 2, 1)');

    click(button('Actual size'));
    expect(activeImg().style.transform).toBe('');
    gallery.destroy();
  });

  /**
   * The actual-size button's icon (src/core/iconSwap.ts,
   * `arrows-angle-expand`/`arrows-angle-contract`) tracks `scale > 1`
   * directly, matching the button's own real click behavior exactly — not
   * a separate "are we exactly at native pixel size" concept. A real bug
   * in an earlier version tracked a separate cache for that instead, which
   * went stale after the very first press: `reset()` nulled it every time
   * without every call site re-populating it, so only the first actual-
   * size press of a session ever updated the icon at all.
   */
  describe('actual-size icon (expand/contract) reflects live zoom state', () => {
    function iconSwapOn(): boolean {
      return button('Actual size')
        .querySelector('.shoji-icon-swap')!
        .classList.contains('shoji-icon-swap--on');
    }

    it('alternates correctly across repeated presses, not just the first one', async () => {
      const gallery = makeGallery();
      gallery.open(0);
      await flushSlideLoad();
      Object.defineProperty(activeImg(), 'naturalWidth', { value: 600, configurable: true });

      expect(iconSwapOn()).toBe(false);
      click(button('Actual size'));
      expect(iconSwapOn()).toBe(true);
      click(button('Actual size'));
      expect(iconSwapOn()).toBe(false);
      click(button('Actual size'));
      expect(iconSwapOn()).toBe(true);
      click(button('Actual size'));
      expect(iconSwapOn()).toBe(false);

      gallery.destroy();
    });

    it('flips to contract when zoomed via the zoom-in button too, not just via actual-size itself', async () => {
      const gallery = makeGallery();
      gallery.open(0);
      await flushSlideLoad();

      expect(iconSwapOn()).toBe(false);
      click(button('Zoom in'));
      expect(iconSwapOn()).toBe(true); // zoomed in at all, even though nowhere near "actual size"
      click(button('Zoom out'));
      expect(iconSwapOn()).toBe(false);

      gallery.destroy();
    });

    it("stays expand for a photo whose native resolution is at or below its fitted size (nothing to reach) — the button's own click is a no-op there", async () => {
      const gallery = makeGallery();
      gallery.open(0);
      await flushSlideLoad();
      // natural rendered width is 300 (mocked rect); naturalWidth <= that
      // means "actual size" would be a downscale, not an upscale.
      Object.defineProperty(activeImg(), 'naturalWidth', { value: 200, configurable: true });

      click(button('Actual size'));
      expect(iconSwapOn()).toBe(false); // clampScale's own floor of 1 makes this a no-op
      expect(activeImg().style.transform).toBe('none'); // apply()'s own neutral-state value, scale still 1

      gallery.destroy();
    });

    it('resets to expand on a fresh slide, even if the outgoing slide was left zoomed', async () => {
      const gallery = makeGallery({ loop: true });
      gallery.open(0);
      await flushSlideLoad();
      Object.defineProperty(activeImg(), 'naturalWidth', { value: 600, configurable: true });

      click(button('Actual size'));
      expect(iconSwapOn()).toBe(true);

      gallery.goTo(1, { animate: false });
      await flushSlideLoad();
      expect(iconSwapOn()).toBe(false);

      gallery.destroy();
    });
  });
});

describe('Zoom — requestZoom* commands (DESIGN.md §4.6), a generic surface for a custom plugin', () => {
  function makeGalleryWithEmitter(): { gallery: Gallery; emitter: EmitterPlugin } {
    const emitter = new EmitterPlugin();
    const gallery = new Gallery(document.createElement('div'), {
      items,
      plugins: [Zoom, emitter],
      preload: 0,
    });
    return { gallery, emitter };
  }

  it('requestZoomIn mirrors the toolbar button exactly', async () => {
    const { gallery, emitter } = makeGalleryWithEmitter();
    gallery.open(0);
    await flushSlideLoad();

    emitter.emit('requestZoomIn', {});

    expect(activeImg().style.transform).toContain('scale3d(1.5, 1.5, 1)');
    gallery.destroy();
  });

  it('requestZoomOut mirrors the toolbar button exactly', async () => {
    const { gallery, emitter } = makeGalleryWithEmitter();
    gallery.open(0);
    await flushSlideLoad();

    emitter.emit('requestZoomIn', {});
    emitter.emit('requestZoomOut', {});

    expect(activeImg().style.transform).toBe('');
    gallery.destroy();
  });

  it('requestZoomActualSize mirrors the toolbar button exactly, both directions', async () => {
    const { gallery, emitter } = makeGalleryWithEmitter();
    gallery.open(0);
    await flushSlideLoad();
    Object.defineProperty(activeImg(), 'naturalWidth', { value: 600, configurable: true });

    emitter.emit('requestZoomActualSize', {});
    expect(activeImg().style.transform).toContain('scale3d(2, 2, 1)');

    emitter.emit('requestZoomActualSize', {});
    expect(activeImg().style.transform).toBe('');
    gallery.destroy();
  });

  it('requestZoomReset returns straight to neutral from any zoom level', async () => {
    const { gallery, emitter } = makeGalleryWithEmitter();
    gallery.open(0);
    await flushSlideLoad();

    emitter.emit('requestZoomIn', {});
    expect(activeImg().style.transform).toContain('scale3d(1.5, 1.5, 1)');

    emitter.emit('requestZoomReset', {});
    expect(activeImg().style.transform).toBe('');
    gallery.destroy();
  });
});

describe('Zoom — w/s keyboard shortcuts (same fixed step as the toolbar buttons)', () => {
  it('w zooms in, s zooms out — same as clicking the toolbar buttons', async () => {
    const gallery = makeGallery();
    gallery.open(0);
    await flushSlideLoad();

    press('w');
    expect(activeImg().style.transform).toContain('scale3d(1.5, 1.5, 1)');

    press('s');
    expect(activeImg().style.transform).toBe('');
    gallery.destroy();
  });

  it('uppercase W/S (Shift held) work the same as lowercase', async () => {
    const gallery = makeGallery();
    gallery.open(0);
    await flushSlideLoad();

    press('W');
    expect(activeImg().style.transform).toContain('scale3d(1.5, 1.5, 1)');

    press('S');
    expect(activeImg().style.transform).toBe('');
    gallery.destroy();
  });

  it('does nothing once the plugin is torn down (destroy() unregisters the shortcuts)', async () => {
    const gallery = makeGallery();
    gallery.open(0);
    await flushSlideLoad();
    gallery.destroy();

    expect(() => press('w')).not.toThrow();
  });
});

describe('Zoom — double-tap', () => {
  it('double-tap zooms in to doubleTapScale, a second double-tap resets', async () => {
    const gallery = makeGallery();
    gallery.open(0);
    await flushSlideLoad();

    doubleTapAt(150, 150);
    expect(activeImg().style.transform).toContain('scale3d(2, 2, 1)');

    doubleTapAt(150, 150);
    expect(activeImg().style.transform).toBe('');
    gallery.destroy();
  });

  it('respects a custom doubleTapScale option', async () => {
    const gallery = makeGallery({ zoom: { doubleTapScale: 3 } });
    gallery.open(0);
    await flushSlideLoad();

    doubleTapAt(150, 150);

    expect(activeImg().style.transform).toContain('scale3d(3, 3, 1)');
    gallery.destroy();
  });
});

describe('Zoom — pinch/wheel (core gesture relay, DESIGN.md §2.4)', () => {
  it('pinch zooms the active image proportionally to the pinch scale', async () => {
    const gallery = makeGallery();
    gallery.open(0);
    await flushSlideLoad();
    const d = dialog();

    firePointer(d, 'pointerdown', { clientX: 0, clientY: 0, pointerId: 1, isPrimary: true });
    firePointer(d, 'pointerdown', { clientX: 100, clientY: 0, pointerId: 2, isPrimary: false });
    firePointer(d, 'pointermove', { clientX: 200, clientY: 0, pointerId: 2 }); // distance doubled -> pinch scale 2

    expect(activeImg().style.transform).toContain('scale3d(2, 2, 1)');
    gallery.destroy();
  });

  it('ctrl+wheel zooms in/out around the cursor', async () => {
    const gallery = makeGallery();
    gallery.open(0);
    await flushSlideLoad();

    dialog().dispatchEvent(
      new WheelEvent('wheel', {
        deltaY: -1000, // one big flick, not a realistic single tick — Kiri's own gentler 0.0015 coefficient needs more deltaY than the old 0.01 did to clearly cross scale 2 in one dispatch
        ctrlKey: true,
        clientX: 150,
        clientY: 150,
        cancelable: true,
        bubbles: true, // real wheel events always bubble — this plugin's own listener is on .shoji-outer, an ancestor of .shoji-dialog
      }),
    );

    expect(activeImg().style.transform).toMatch(/scale3d\(([2-9]|\d\d)/); // clearly zoomed in past 1
    gallery.destroy();
  });

  it("plain (non-ctrl) wheel zooms too, by default (mouseWheelZoom: true) — the only way to also catch a trackpad's plain two-finger drag, which reports as an ordinary wheel event with no ctrl marker", async () => {
    const gallery = makeGallery();
    gallery.open(0);
    await flushSlideLoad();

    dialog().dispatchEvent(
      new WheelEvent('wheel', {
        deltaY: -1000,
        ctrlKey: false,
        clientX: 150,
        clientY: 150,
        bubbles: true,
      }),
    );

    expect(activeImg().style.transform).toMatch(/scale3d\(([2-9]|\d\d)/);
    gallery.destroy();
  });

  /**
   * A trackpad's own two-finger *drag* (as opposed to a pinch) never
   * reaches the browser as real multi-touch — the OS/browser reports it as
   * a plain `wheel` event, identical in shape to an ordinary scroll or a
   * bare mouse wheel. `mouseWheelZoom: true` is the only way to make that
   * zoom, at the unavoidable cost of a bare mouse wheel also zooming (there
   * is no way to tell the two apart).
   */
  describe('mouseWheelZoom option', () => {
    it("'ctrl' — reproduces the option's own pre-existing behavior: a plain wheel event does not zoom, only ctrl+wheel does", async () => {
      const gallery = makeGallery({ zoom: { mouseWheelZoom: 'ctrl' } });
      gallery.open(0);
      await flushSlideLoad();

      dialog().dispatchEvent(
        new WheelEvent('wheel', { deltaY: -100, ctrlKey: false, bubbles: true }),
      );

      expect(activeImg().style.transform).toBe('');
      gallery.destroy();
    });

    it('true — a plain wheel event (no ctrl) now also zooms, same as ctrl+wheel already did', async () => {
      const gallery = makeGallery({ zoom: { mouseWheelZoom: true } });
      gallery.open(0);
      await flushSlideLoad();

      dialog().dispatchEvent(
        new WheelEvent('wheel', {
          deltaY: -1000,
          ctrlKey: false,
          clientX: 150,
          clientY: 150,
          bubbles: true,
        }),
      );

      expect(activeImg().style.transform).toMatch(/scale3d\(([2-9]|\d\d)/);
      gallery.destroy();
    });

    it('true — ctrl+wheel still works too (additive, not a replacement)', async () => {
      const gallery = makeGallery({ zoom: { mouseWheelZoom: true } });
      gallery.open(0);
      await flushSlideLoad();

      dialog().dispatchEvent(
        new WheelEvent('wheel', {
          deltaY: -1000,
          ctrlKey: true,
          clientX: 150,
          clientY: 150,
          bubbles: true,
        }),
      );

      expect(activeImg().style.transform).toMatch(/scale3d\(([2-9]|\d\d)/);
      gallery.destroy();
    });

    it('false — not even ctrl+wheel zooms', async () => {
      const gallery = makeGallery({ zoom: { mouseWheelZoom: false } });
      gallery.open(0);
      await flushSlideLoad();

      dialog().dispatchEvent(
        new WheelEvent('wheel', {
          deltaY: -100,
          ctrlKey: true,
          clientX: 150,
          clientY: 150,
          bubbles: true,
        }),
      );

      expect(activeImg().style.transform).toBe('');
      gallery.destroy();
    });
  });
});

describe('Zoom — pan suspends core drag-to-navigate (DESIGN.md §4-zoom)', () => {
  it('a horizontal drag does not change slides while zoomed', async () => {
    const gallery = makeGallery();
    gallery.open(0);
    await flushSlideLoad();
    doubleTapAt(150, 150); // zoom in first

    dragHorizontal(-80);

    expect(gallery.currentIndex).toBe(0);
    gallery.destroy();
  });

  it('captures the pointer for a pan drag while zoomed, but only on the image — never the dialog it bubbles through, which would misread the release click as a backdrop click and close the lightbox (DESIGN.md §4-zoom, twelfth bug; §2.4\'s own "exits on release" bug for how GestureEngine\'s own dialog capture is separately suppressed here)', async () => {
    const gallery = makeGallery();
    gallery.open(0);
    await flushSlideLoad();
    doubleTapAt(150, 150); // zoom in first

    const captureSpy = vi.spyOn(Element.prototype, 'setPointerCapture');
    // Starts on the image itself — the Zoom plugin's own pan listener only
    // engages for a pointerdown that actually starts there (see the
    // "backdrop click while zoomed" describe block below); a real pan drag
    // always does, since there's nothing else zoomed-in to grab onto.
    dragHorizontal(-80, activeImg());

    expect(captureSpy).toHaveBeenCalled();
    for (const instance of captureSpy.mock.instances) {
      expect(instance).toBe(activeImg()); // never the dialog GestureEngine would otherwise have captured on
    }
    gallery.destroy();
  });

  it('does capture the pointer for a normal (unzoomed) drag — confirms the zoomed case above is a real suppression, not capture being broken generally', async () => {
    const gallery = makeGallery();
    gallery.open(0);
    await flushSlideLoad();

    const captureSpy = vi.spyOn(Element.prototype, 'setPointerCapture');
    dragHorizontal(-80);

    expect(captureSpy).toHaveBeenCalled();
    gallery.destroy();
  });

  it('panning while zoomed shifts the pan offset (translate) on the image', async () => {
    const gallery = makeGallery();
    gallery.open(0);
    await flushSlideLoad();
    doubleTapAt(150, 150);
    const beforePan = activeImg().style.transform;

    firePointer(activeImg(), 'pointerdown', { clientX: 150, clientY: 150 });
    firePointer(dialog(), 'pointermove', { clientX: 130, clientY: 150 });

    expect(activeImg().style.transform).not.toBe(beforePan);
    gallery.destroy();
  });

  it('a horizontal drag navigates normally again once zoom resets', async () => {
    const gallery = makeGallery({ loop: true });
    gallery.open(0);
    await flushSlideLoad();
    doubleTapAt(150, 150);
    doubleTapAt(150, 150); // back to neutral

    dragHorizontal(-80);

    expect(gallery.currentIndex).toBe(1);
    gallery.destroy();
  });
});

describe('Zoom — backdrop click while zoomed still closes the lightbox (DESIGN.md §4-zoom, thirteenth bug)', () => {
  it('does not engage pan (no pointer capture) for a pointerdown that starts on the backdrop, not the image', async () => {
    const gallery = makeGallery();
    gallery.open(0);
    await flushSlideLoad();
    doubleTapAt(150, 150); // zoom in first

    const captureSpy = vi.spyOn(Element.prototype, 'setPointerCapture');
    // The dialog itself, not the image — dispatched directly on it, so
    // composedPath() doesn't include the (descendant) image, same as a
    // real click on the empty backdrop area between the image and a nav
    // arrow.
    firePointer(dialog(), 'pointerdown', { clientX: 5, clientY: 5 });

    expect(captureSpy).not.toHaveBeenCalled();
    gallery.destroy();
  });

  it('a subsequent pointermove does not pan the image either, once a backdrop pointerdown failed to engage pan', async () => {
    const gallery = makeGallery();
    gallery.open(0);
    await flushSlideLoad();
    doubleTapAt(150, 150);
    const beforePan = activeImg().style.transform;

    firePointer(dialog(), 'pointerdown', { clientX: 5, clientY: 5 });
    firePointer(dialog(), 'pointermove', { clientX: 20, clientY: 20 });

    expect(activeImg().style.transform).toBe(beforePan);
    gallery.destroy();
  });

  it('still engages pan normally for a pointerdown that does start on the image, right next to a backdrop click that does not — confirms the fix is scoped to pointerdown target, not zoom state in general', async () => {
    const gallery = makeGallery();
    gallery.open(0);
    await flushSlideLoad();
    doubleTapAt(150, 150);

    firePointer(dialog(), 'pointerdown', { clientX: 5, clientY: 5 }); // backdrop — no-op
    firePointer(dialog(), 'pointerup', { clientX: 5, clientY: 5 });

    const captureSpy = vi.spyOn(Element.prototype, 'setPointerCapture');
    firePointer(activeImg(), 'pointerdown', { clientX: 150, clientY: 150 }); // the image — engages

    expect(captureSpy).toHaveBeenCalledWith(expect.anything());
    expect(captureSpy.mock.instances[0]).toBe(activeImg());
    gallery.destroy();
  });
});

describe('Zoom — resets per slide', () => {
  it('resets to neutral on afterSlide', async () => {
    const gallery = makeGallery();
    gallery.open(0);
    await flushSlideLoad();
    doubleTapAt(150, 150);
    expect(activeImg().style.transform).not.toBe('');

    gallery.next();
    await flushSlideLoad();

    expect(activeImg().style.transform).toBe('');
    gallery.destroy();
  });

  it('resets to neutral synchronously on beforeClose — before the zoom-out-to-thumbnail transition measures the media rect, not just eventually on the next afterOpen (DESIGN.md §2.3b, "zooms out to a random spot" bug)', async () => {
    const gallery = makeGallery();
    gallery.open(0);
    await flushSlideLoad();
    doubleTapAt(150, 150);
    expect(activeImg().style.transform).toContain('scale3d(2, 2, 1)');

    const onBeforeClose = vi.fn(() => {
      // still zoomed at this exact moment would mean zoomOut() computes its
      // transform from the zoomed/panned rect instead of the natural one
      expect(activeImg().style.transform).toBe('');
    });
    gallery.on('beforeClose', onBeforeClose);

    gallery.close();

    expect(onBeforeClose).toHaveBeenCalledTimes(1);
    gallery.destroy();
  });

  it("regression: resets a still-zoomed image before navigate() reparents it into a different pool slot via cache-reuse — otherwise it stays transformed, unclipped, bleeding into the new slide (reported from real usage, only reproduces with preload > 0, where the old slide's node actually survives to be reused)", async () => {
    const gallery = makeGallery({
      preload: 1,
      items: [
        { id: 'a', src: 'a.jpg' },
        { id: 'b', src: 'b.jpg' },
        { id: 'c', src: 'c.jpg' },
      ],
    });
    gallery.open(0);
    await flushSlideLoad();
    const zoomedImg = activeImg();
    doubleTapAt(150, 150);
    expect(zoomedImg.style.transform).not.toBe('');

    gallery.next();

    // beforeSlide (where the fix resets) fires synchronously inside next(),
    // before SlideManager.render() ever reparents this same cached node —
    // no need to await anything to observe it.
    expect(zoomedImg.style.transform).toBe('');
    gallery.destroy();
  });

  it('resets to neutral on afterOpen (re-opening after a zoom was applied)', async () => {
    const gallery = makeGallery();
    gallery.open(0);
    await flushSlideLoad();
    doubleTapAt(150, 150);
    gallery.close();

    gallery.open(1);
    await flushSlideLoad();

    expect(activeImg().style.transform).toBe('');
    gallery.destroy();
  });
});

describe('Zoom — events', () => {
  it('emits zoomChange with the current index and scale', async () => {
    const gallery = makeGallery();
    gallery.open(1);
    await flushSlideLoad();
    const onChange = vi.fn();
    gallery.on('zoomChange', onChange);

    click(button('Zoom in'));

    expect(onChange).toHaveBeenCalledWith({ index: 1, scale: 1.5 });
    gallery.destroy();
  });
});

describe("Zoom — transition (discrete jumps animate, continuous gestures don't)", () => {
  it('zoom-in button applies a transform transition', async () => {
    const gallery = makeGallery();
    gallery.open(0);
    await flushSlideLoad();

    click(button('Zoom in'));

    expect(activeImg().style.transition).toContain('transform');
    gallery.destroy();
  });

  it('zoom-out button back to neutral applies a transition too', async () => {
    const gallery = makeGallery();
    gallery.open(0);
    await flushSlideLoad();
    click(button('Zoom in'));

    click(button('Zoom out'));

    expect(activeImg().style.transition).toContain('transform');
    gallery.destroy();
  });

  it('regression: zoom-out-to-neutral keeps transform-origin anchored until the transition actually ends, instead of snapping it early and jumping the image', async () => {
    const gallery = makeGallery();
    gallery.open(0);
    await flushSlideLoad();
    click(button('Zoom in'));
    const img = activeImg();
    expect(img.style.transformOrigin).toBe('0 0');

    click(button('Zoom out')); // scale 1.5 / buttonStep 1.5 === 1 -> the reset(true) branch

    // Still mid-transition: the anchor must not have moved yet, or the
    // scaled image would visibly snap to a new position before easing.
    expect(img.style.transformOrigin).toBe('0 0');
    expect(img.style.transition).toContain('transform');

    fireTransitionEnd(img);

    // Only once the transition genuinely finished is it safe to clear.
    expect(img.style.transformOrigin).toBe('');
    expect(img.style.transition).toBe('');
    gallery.destroy();
  });

  it('double-tap applies a transition', async () => {
    const gallery = makeGallery();
    gallery.open(0);
    await flushSlideLoad();

    doubleTapAt(150, 150);

    expect(activeImg().style.transition).toContain('transform');
    gallery.destroy();
  });

  it('actual-size applies a transition', async () => {
    const gallery = makeGallery();
    gallery.open(0);
    await flushSlideLoad();
    Object.defineProperty(activeImg(), 'naturalWidth', { value: 600, configurable: true });

    click(button('Actual size'));

    expect(activeImg().style.transition).toContain('transform');
    gallery.destroy();
  });

  it('pinch does not apply a transition — it must track the fingers 1:1, not lag behind them', async () => {
    const gallery = makeGallery();
    gallery.open(0);
    await flushSlideLoad();
    const d = dialog();

    firePointer(d, 'pointerdown', { clientX: 0, clientY: 0, pointerId: 1, isPrimary: true });
    firePointer(d, 'pointerdown', { clientX: 100, clientY: 0, pointerId: 2, isPrimary: false });
    firePointer(d, 'pointermove', { clientX: 200, clientY: 0, pointerId: 2 });

    expect(activeImg().style.transition).toBe('');
    gallery.destroy();
  });

  it("ctrl+wheel does not apply a transition — stays instant, per-tick steps shouldn't stack up a transition each", async () => {
    const gallery = makeGallery();
    gallery.open(0);
    await flushSlideLoad();

    dialog().dispatchEvent(
      new WheelEvent('wheel', {
        deltaY: -100,
        ctrlKey: true,
        clientX: 150,
        clientY: 150,
        cancelable: true,
        bubbles: true,
      }),
    );

    expect(activeImg().style.transition).toBe('');
    gallery.destroy();
  });

  it('pan while zoomed does not apply a transition', async () => {
    const gallery = makeGallery();
    gallery.open(0);
    await flushSlideLoad();
    doubleTapAt(150, 150);
    // The double-tap itself is a discrete jump and legitimately sets one —
    // clear it so the pan assertion below isn't riding on that leftover.
    activeImg().style.transition = '';

    firePointer(activeImg(), 'pointerdown', { clientX: 150, clientY: 150 });
    firePointer(dialog(), 'pointermove', { clientX: 130, clientY: 150 });

    expect(activeImg().style.transition).toBe('');
    gallery.destroy();
  });
});

describe("Zoom — buttons hidden on video slides (all three zoom actions are no-ops there: getImg() returns null whenever the active slide isn't an <img>)", () => {
  const videoItems: GalleryItem[] = [
    { id: 'a', src: 'a.jpg' },
    { id: 'v', src: 'v.mp4', video: { provider: 'html5' } },
  ];

  it('hides all three buttons when opening directly on a video slide', async () => {
    const gallery = makeGallery({ items: videoItems });
    gallery.open(1);
    await flushSlideLoad();

    expect(button('Zoom in').hidden).toBe(true);
    expect(button('Zoom out').hidden).toBe(true);
    expect(button('Actual size').hidden).toBe(true);
    gallery.destroy();
  });

  it('shows the buttons again navigating from a video slide back to a photo slide', async () => {
    const gallery = makeGallery({ items: videoItems });
    gallery.open(1);
    await flushSlideLoad();

    gallery.prev();
    await flushSlideLoad();

    expect(button('Zoom in').hidden).toBe(false);
    expect(button('Zoom out').hidden).toBe(false);
    expect(button('Actual size').hidden).toBe(false);
    gallery.destroy();
  });

  it('hides the buttons navigating from a photo slide to a video slide', async () => {
    const gallery = makeGallery({ items: videoItems });
    gallery.open(0);
    await flushSlideLoad();
    expect(button('Zoom in').hidden).toBe(false);

    gallery.next();
    await flushSlideLoad();

    expect(button('Zoom in').hidden).toBe(true);
    gallery.destroy();
  });

  it('a photo-only gallery never hides the buttons', async () => {
    const gallery = makeGallery();
    gallery.open(0);
    await flushSlideLoad();

    expect(button('Zoom in').hidden).toBe(false);
    gallery.destroy();
  });
});

describe('Zoom — cleanup', () => {
  it('destroy() removes all three toolbar buttons', () => {
    const gallery = makeGallery();
    gallery.destroy();

    expect(document.querySelector('.shoji-toolbar-button')).toBeNull();
  });

  it('destroy() while zoomed clears the inline transform', async () => {
    const gallery = makeGallery();
    gallery.open(0);
    await flushSlideLoad();
    doubleTapAt(150, 150);
    const img = activeImg();

    gallery.destroy();

    expect(img.style.transform).toBe('');
  });
});
