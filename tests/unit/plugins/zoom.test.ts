import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Gallery } from '../../../src/core';
import { Zoom } from '../../../src/plugins/zoom';
import type { GalleryItem } from '../../../src/core/types';

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

function activeImg(): HTMLImageElement {
  return document.querySelector('.shoji-slide-img') as HTMLImageElement;
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

/** A full horizontal drag: lock past lockThreshold, move further, release, then complete the settle animation — matches gallery-gestures.test.ts's pattern (a single jump straight to the final position would zero the effective post-lock delta; skipping fireTransitionEnd leaves the index change queued behind a transitionend that never fires). */
function dragHorizontal(endX: number): void {
  const d = dialog();
  firePointer(d, 'pointerdown', { clientX: 0, clientY: 0 });
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
        deltaY: -100,
        ctrlKey: true,
        clientX: 150,
        clientY: 150,
        cancelable: true,
      }),
    );

    expect(activeImg().style.transform).toMatch(/scale3d\(([2-9]|\d\d)/); // clearly zoomed in past 1
    gallery.destroy();
  });

  it('plain (non-ctrl) wheel does not zoom', async () => {
    const gallery = makeGallery();
    gallery.open(0);
    await flushSlideLoad();

    dialog().dispatchEvent(
      new WheelEvent('wheel', { deltaY: -100, ctrlKey: false, clientX: 150, clientY: 150 }),
    );

    expect(activeImg().style.transform).toBe('');
    gallery.destroy();
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

  it('does not capture the pointer for a pan drag while zoomed (DESIGN.md §2.4, "exits on release" bug) — capturing would retarget the release click to the dialog in a real browser and trigger click-outside-to-close, even though the drag\'s own effect is already suppressed', async () => {
    const gallery = makeGallery();
    gallery.open(0);
    await flushSlideLoad();
    doubleTapAt(150, 150); // zoom in first

    const captureSpy = vi.spyOn(Element.prototype, 'setPointerCapture');
    dragHorizontal(-80); // locks direction in core's engine even though its effect is suppressed

    expect(captureSpy).not.toHaveBeenCalled();
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

    const d = dialog();
    firePointer(d, 'pointerdown', { clientX: 150, clientY: 150 });
    firePointer(d, 'pointermove', { clientX: 130, clientY: 150 });

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

    const d = dialog();
    firePointer(d, 'pointerdown', { clientX: 150, clientY: 150 });
    firePointer(d, 'pointermove', { clientX: 130, clientY: 150 });

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
