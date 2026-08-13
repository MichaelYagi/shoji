import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Gallery } from '../../../src/core';
import { Layout } from '../../../src/plugins/layout';
import { RotateFlip } from '../../../src/plugins/rotateFlip';
import type { GalleryItem } from '../../../src/core/types';

function mockContainerWidth(el: HTMLElement, width: number): void {
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    top: 0,
    left: 0,
    right: width,
    bottom: 0,
    width,
    height: 0,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
}

function makeItems(count: number): GalleryItem[] {
  return Array.from({ length: count }, (_, i) => ({ id: `item-${i}`, src: `${i}.jpg` }));
}

function tileImages(el: HTMLElement): HTMLImageElement[] {
  return [...el.querySelectorAll<HTMLImageElement>('.shoji-layout-tile img')];
}

/** Sets the natural size an image "loaded" with, then fires its load event — autoMeasure's own listener is what reacts to this. */
function resolveImage(img: HTMLImageElement, width: number, height: number): void {
  Object.defineProperty(img, 'naturalWidth', { value: width, configurable: true });
  Object.defineProperty(img, 'naturalHeight', { value: height, configurable: true });
  img.dispatchEvent(new Event('load'));
}

let rafQueue: FrameRequestCallback[] = [];
let rafSpy: ReturnType<typeof vi.fn>;
let originalRaf: typeof window.requestAnimationFrame;
let originalComplete: PropertyDescriptor | undefined;

function flushRaf(): void {
  const queue = rafQueue;
  rafQueue = [];
  queue.forEach((cb) => cb(0));
}

beforeEach(() => {
  HTMLImageElement.prototype.decode = vi.fn().mockResolvedValue(undefined);

  // Queued, not auto-run: lets tests control exactly when the plugin's
  // rAF-deferred relayout actually fires, and assert on how many times it
  // was even *scheduled* before that (the coalescing behavior itself).
  originalRaf = window.requestAnimationFrame;
  rafQueue = [];
  rafSpy = vi.fn((cb: FrameRequestCallback) => {
    rafQueue.push(cb);
    return rafQueue.length;
  });
  window.requestAnimationFrame = rafSpy as unknown as typeof window.requestAnimationFrame;

  // jsdom's <img>.complete defaults to true unconditionally (no real network
  // layer) — force it false so autoMeasure takes the "wait for a real load
  // event" branch instead of resolving synchronously (with naturalWidth/
  // Height both 0) at tile-creation time, letting tests control exactly
  // when + with what dimensions each image "finishes loading".
  originalComplete = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'complete');
  Object.defineProperty(HTMLImageElement.prototype, 'complete', {
    configurable: true,
    get(): boolean {
      return false;
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  window.requestAnimationFrame = originalRaf;
  if (originalComplete) {
    Object.defineProperty(HTMLImageElement.prototype, 'complete', originalComplete);
  }
  // @ts-expect-error - removing the test-only stub added above
  delete HTMLImageElement.prototype.decode;
  document.body.innerHTML = '';
});

describe('Layout — autoMeasure (missing width/height self-correction)', () => {
  it('corrects a tile from the 4:3 placeholder to the real aspect ratio once its image loads', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    mockContainerWidth(el, 1000);
    const gallery = new Gallery(el, {
      items: [{ id: 'a', src: 'a.jpg' }],
      plugins: [Layout],
      layout: { type: 'masonry', columns: 1 },
    });

    const tile = el.querySelector<HTMLElement>('.shoji-layout-tile')!;
    expect(tile.style.height).toBe('750px'); // 1000 * 3/4 — the 4:3 placeholder

    resolveImage(tileImages(el)[0]!, 1600, 800); // 2:1
    flushRaf();

    expect(tile.style.height).toBe('500px'); // 1000 * 800/1600
    // A real bug, reported from real usage: this used to persist the
    // learned dims straight onto item.width/height — wrong, since a
    // tile's own thumbnail (measurableSrc(): thumb, then poster, then src)
    // isn't necessarily the full photo's real size, and other consumers
    // (RotateFlip's fit-scale, DESIGN.md §4.5; SlideManager's aspect-ratio
    // placeholder) read those same fields expecting the true dimensions.
    // Learned dims now stay entirely Layout-private (measuredAspect) —
    // item.width/height are untouched, still undefined.
    expect(gallery.items[0]!.width).toBeUndefined();
    expect(gallery.items[0]!.height).toBeUndefined();

    gallery.destroy();
  });

  it('does not schedule a relayout until an image actually resolves', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    mockContainerWidth(el, 1000);
    const gallery = new Gallery(el, {
      items: [{ id: 'a', src: 'a.jpg' }],
      plugins: [Layout],
      layout: { type: 'masonry', columns: 1 },
    });

    expect(rafSpy).not.toHaveBeenCalled();

    gallery.destroy();
  });

  it('coalesces several images resolving before the frame fires into one relayout, not one per image', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    mockContainerWidth(el, 1000);
    const gallery = new Gallery(el, {
      items: makeItems(3),
      plugins: [Layout],
      layout: { type: 'masonry', columns: 1 },
    });

    const imgs = tileImages(el);
    resolveImage(imgs[0]!, 1600, 800);
    resolveImage(imgs[1]!, 800, 1600);
    resolveImage(imgs[2]!, 1200, 900);

    expect(rafSpy).toHaveBeenCalledTimes(1); // all three landed before the first scheduled frame ran

    flushRaf();
    const tiles = el.querySelectorAll<HTMLElement>('.shoji-layout-tile');
    expect(tiles[0]!.style.height).toBe('500px');
    expect(tiles[1]!.style.height).toBe('2000px');
    expect(tiles[2]!.style.height).toBe('750px');

    gallery.destroy();
  });

  it('re-runs groupBy (a full re-render, not just a reposition pass) once real dimensions land', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    mockContainerWidth(el, 1000);
    // groupBy only ever sees item.data (a field the test controls directly)
    // — not item.width/height, which measuredAspect deliberately keeps
    // Layout-private (see its own doc comment) rather than exposing a
    // thumbnail-derived measurement to host code as if it were the real
    // photo's dimensions. What this test actually verifies is the
    // *mechanism*: a spy proves groupBy is genuinely invoked again once
    // autoMeasure's own measurement lands, i.e. scheduleMeasureRelayout()
    // triggers a full re-render (computeSections() re-run) and not merely
    // a reposition pass — orthogonal to what groupBy happens to read.
    const groupBy = vi.fn((item: GalleryItem) => String(item.data?.group ?? 'Other'));
    const gallery = new Gallery(el, {
      items: makeItems(2),
      plugins: [Layout],
      layout: { type: 'justified', groupBy, renderHeading: (key: string) => key },
    });

    expect(el.querySelectorAll('.shoji-layout-heading')).toHaveLength(1);
    const callsBeforeMeasure = groupBy.mock.calls.length;
    expect(callsBeforeMeasure).toBeGreaterThan(0);

    const imgs = tileImages(el);
    resolveImage(imgs[0]!, 800, 600);
    resolveImage(imgs[1]!, 1600, 1200);
    flushRaf();

    expect(groupBy.mock.calls.length).toBeGreaterThan(callsBeforeMeasure);

    gallery.destroy();
  });

  it('an already-loaded (cached) image measures immediately, without waiting for a load event', () => {
    // Override .complete back to true (the jsdom default) just for this
    // image, simulating a cache hit — img.complete is already true by the
    // time the tile's <img> element exists.
    Object.defineProperty(HTMLImageElement.prototype, 'complete', {
      configurable: true,
      get(): boolean {
        return true;
      },
    });

    const el = document.createElement('div');
    document.body.appendChild(el);
    mockContainerWidth(el, 1000);

    // naturalWidth/Height must be set before construction, since the
    // "already complete" branch reads them synchronously during the
    // gallery's own construction-time render, not on a later event.
    const originalNaturalWidth = Object.getOwnPropertyDescriptor(
      HTMLImageElement.prototype,
      'naturalWidth',
    );
    const originalNaturalHeight = Object.getOwnPropertyDescriptor(
      HTMLImageElement.prototype,
      'naturalHeight',
    );
    Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', {
      configurable: true,
      get: () => 400,
    });
    Object.defineProperty(HTMLImageElement.prototype, 'naturalHeight', {
      configurable: true,
      get: () => 300,
    });

    const gallery = new Gallery(el, {
      items: [{ id: 'a', src: 'a.jpg' }],
      plugins: [Layout],
      layout: { type: 'masonry', columns: 1 },
    });

    // No frame needed — scheduleMeasureRelayout() still defers through rAF
    // even for the synchronous "already complete" branch (kept consistent,
    // one code path), so a flush is still required to see it applied.
    flushRaf();
    const tile = el.querySelector<HTMLElement>('.shoji-layout-tile')!;
    expect(tile.style.height).toBe('750px'); // 1000 * 300/400
    // Learned dims stay Layout-private (measuredAspect) — see the first
    // test in this file for why item.width/height must not reflect them.
    expect(gallery.items[0]!.width).toBeUndefined();

    gallery.destroy();
    if (originalNaturalWidth) {
      Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', originalNaturalWidth);
    }
    if (originalNaturalHeight) {
      Object.defineProperty(HTMLImageElement.prototype, 'naturalHeight', originalNaturalHeight);
    }
  });

  it('does not re-measure an item that already learned its dimensions, on a later relayout', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    mockContainerWidth(el, 1000);
    const gallery = new Gallery(el, {
      items: [{ id: 'a', src: 'a.jpg' }],
      plugins: [Layout],
      layout: { type: 'masonry', columns: 1 },
    });

    resolveImage(tileImages(el)[0]!, 1600, 800);
    flushRaf();
    expect(rafSpy).toHaveBeenCalledTimes(1);

    // A second items change re-renders (fresh tiles, fresh <img>s) — the
    // item itself already carries real width/height from before, so
    // aspectOf() should use it directly rather than scheduling a new
    // measurement for it.
    gallery.updateSlides([...gallery.items]);
    expect(rafSpy).toHaveBeenCalledTimes(1); // unchanged — no new measurement scheduled

    gallery.destroy();
  });

  it('autoMeasure: false restores the old immediate, permanent 4:3 fallback with no measurement attempted', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const el = document.createElement('div');
    document.body.appendChild(el);
    mockContainerWidth(el, 1000);
    const gallery = new Gallery(el, {
      items: [{ id: 'a', src: 'a.jpg' }],
      plugins: [Layout],
      layout: { type: 'masonry', columns: 1, autoMeasure: false },
    });

    expect(rafSpy).not.toHaveBeenCalled();
    resolveImage(tileImages(el)[0]!, 1600, 800);
    expect(rafSpy).not.toHaveBeenCalled(); // no listener was ever attached — nothing reacts to this

    const tile = el.querySelector<HTMLElement>('.shoji-layout-tile')!;
    expect(tile.style.height).toBe('750px'); // still the placeholder

    gallery.destroy();
    warnSpy.mockRestore();
  });

  it('a broken image (never resolves with real dimensions) keeps the 4:3 fallback instead of crashing or hanging', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    mockContainerWidth(el, 1000);
    const gallery = new Gallery(el, {
      items: [{ id: 'a', src: 'broken.jpg' }],
      plugins: [Layout],
      layout: { type: 'masonry', columns: 1 },
    });

    const img = tileImages(el)[0]!;
    img.dispatchEvent(new Event('error'));
    expect(() => flushRaf()).not.toThrow();

    const tile = el.querySelector<HTMLElement>('.shoji-layout-tile')!;
    expect(tile.style.height).toBe('750px');
    expect(gallery.items[0]!.width).toBeUndefined();

    gallery.destroy();
  });

  it('a pending measurement resolving after destroy() does not throw or touch a torn-down gallery', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    mockContainerWidth(el, 1000);
    const gallery = new Gallery(el, {
      items: [{ id: 'a', src: 'a.jpg' }],
      plugins: [Layout],
      layout: { type: 'masonry', columns: 1 },
    });

    const img = tileImages(el)[0]!;
    gallery.destroy();

    expect(() => resolveImage(img, 1600, 800)).not.toThrow();
    expect(() => flushRaf()).not.toThrow();
  });

  it("regression: RotateFlip's fit-scale (DESIGN.md §4.5) is unaffected by autoMeasure — reported from real usage: rotating a photo whose thumb differs from its src, and had no explicit item.width/height, silently computed a no-op 1x scale instead of a correctly-fitted one. Root cause was this same item.width/height leak — a thumbnail genuinely smaller than the lightbox in both orientations always self-caps fitScaleFor's Math.min(1, ...) to exactly 1, masking the real photo's own actual size", async () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    mockContainerWidth(el, 1000);
    const gallery = new Gallery(el, {
      // No width/height, and a thumb genuinely different from src — the
      // exact real-usage shape this was reported against.
      items: [{ id: 'a', src: 'full.jpg', thumb: 'thumb.jpg' }],
      plugins: [Layout, RotateFlip],
      layout: { type: 'masonry', columns: 1 },
    });

    // Layout's own tile thumbnail "loads" small — this is what used to
    // leak onto item.width/height.
    resolveImage(tileImages(el)[0]!, 100, 100);
    flushRaf();
    expect(gallery.items[0]!.width).toBeUndefined(); // the leak itself, covered above

    gallery.open(0);
    // The lightbox's own <img> (full.jpg) isn't in the DOM until its
    // decode() resolves (SlideManager's moveIn) — mirrors rotateFlip.test.ts.
    await Promise.resolve();
    await Promise.resolve();
    const media = gallery.getActiveMedia()!;
    Object.defineProperty(media, 'clientWidth', { value: 300, configurable: true });
    Object.defineProperty(media, 'clientHeight', { value: 600, configurable: true });
    // It's a separate element from the layout tile's (thumb.jpg) — jsdom
    // never actually decodes either, so both start at naturalWidth/Height 0
    // until stubbed here.
    const slideImg = media.querySelector('img')!;
    Object.defineProperty(slideImg, 'naturalWidth', { value: 2400, configurable: true });
    Object.defineProperty(slideImg, 'naturalHeight', { value: 6000, configurable: true });

    const rotateBtn = document.querySelector<HTMLButtonElement>(
      '.shoji-toolbar-button[aria-label="Rotate right"]',
    )!;
    rotateBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    // scaleAt0 = min(1, 300/2400, 600/6000) = 0.1; scaleAt90 = min(1,
    // 300/6000, 600/2400) = 0.05; fitScale = 0.5 — the real photo's own
    // computation. Before the fix this read the tile's 100x100 instead,
    // where both scaleAt0/90 self-cap to 1, silently producing fitScale 1.
    expect(media.style.transform).toBe('scaleX(0.5) scaleY(0.5) rotate(90deg)');

    gallery.destroy();
  });
});
