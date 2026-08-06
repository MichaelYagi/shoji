import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Gallery } from '../../../src/core';
import { Layout } from '../../../src/plugins/layout';
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
    expect(gallery.items[0]!.width).toBe(1600); // learned dims persisted onto the real item
    expect(gallery.items[0]!.height).toBe(800);

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

  it('re-runs groupBy once real dimensions land, fixing section boundaries computed before they were known', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    mockContainerWidth(el, 1000);
    const gallery = new Gallery(el, {
      items: makeItems(2),
      plugins: [Layout],
      layout: {
        type: 'justified',
        groupBy: (item: GalleryItem) => String(item.width ?? 'Other'),
        renderHeading: (key: string) => key,
      },
    });

    // Before either image resolves, both items report the same groupBy key
    // ('Other') since neither has a width yet — one heading.
    expect(el.querySelectorAll('.shoji-layout-heading')).toHaveLength(1);
    expect(el.querySelector('.shoji-layout-heading')!.textContent).toBe('Other');

    const imgs = tileImages(el);
    resolveImage(imgs[0]!, 800, 600);
    resolveImage(imgs[1]!, 1600, 1200);
    flushRaf();

    // Real, distinct widths now split them into two sections — only
    // possible via a full re-render (computeSections() re-run), not a
    // plain reposition pass.
    const headings = el.querySelectorAll('.shoji-layout-heading');
    expect(headings).toHaveLength(2);
    expect([...headings].map((h) => h.textContent).sort()).toEqual(['1600', '800']);

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
    expect(gallery.items[0]!.width).toBe(400);

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
});
