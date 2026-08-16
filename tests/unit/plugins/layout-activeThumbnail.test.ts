import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Gallery } from '../../../src/core';
import { Layout } from '../../../src/plugins/layout';
import { ActiveThumbnail } from '../../../src/plugins/activeThumbnail';
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
let originalRaf: typeof window.requestAnimationFrame;
let originalComplete: PropertyDescriptor | undefined;

function flushRaf(): void {
  const queue = rafQueue;
  rafQueue = [];
  queue.forEach((cb) => cb(0));
}

beforeEach(() => {
  HTMLImageElement.prototype.decode = vi.fn().mockResolvedValue(undefined);

  originalRaf = window.requestAnimationFrame;
  rafQueue = [];
  window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    rafQueue.push(cb);
    return rafQueue.length;
  }) as unknown as typeof window.requestAnimationFrame;

  // jsdom's <img>.complete defaults to true unconditionally — force it
  // false so autoMeasure waits for a real load event instead of resolving
  // synchronously at tile-creation time (same reasoning as
  // layout-automeasure.test.ts).
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

describe('Layout + ActiveThumbnail — a real bug found via a real integration', () => {
  it("survives Layout's own full re-render (groupBy + an autoMeasure correction landing) — a real bug: createTile() rebuilds every tile from scratch on that path, discarding the exact DOM element the highlight was on", () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    mockContainerWidth(el, 1000);
    const gallery = new Gallery(el, {
      items: makeItems(3),
      plugins: [Layout, ActiveThumbnail],
      layout: { type: 'justified', groupBy: () => 'All', renderHeading: (key: string) => key },
    });

    gallery.open(1);
    const originalTile = gallery.getOriginElement(1)!;
    expect(originalTile.classList.contains('shoji-thumb-active')).toBe(true);

    // An autoMeasure correction under groupBy triggers Layout's own
    // fullRender() (confirmed in layout-automeasure.test.ts's "re-runs
    // groupBy" test) — every tile, including the one just marked active,
    // is replaced by a brand new element.
    resolveImage(tileImages(el)[2]!, 1600, 800);
    flushRaf();

    const rebuiltTile = gallery.getOriginElement(1)!;
    expect(rebuiltTile).not.toBe(originalTile); // really did get rebuilt, not just repositioned
    expect(rebuiltTile.classList.contains('shoji-thumb-active')).toBe(true);
    // The stale reference to the old, now-detached element must not still
    // carry the class either — nothing to visually confuse a viewer who
    // never sees the detached node, but a real leak if it also somehow
    // re-entered the DOM later.
    expect(originalTile.classList.contains('shoji-thumb-active')).toBe(false);

    gallery.destroy();
  });

  it('does not re-trigger scrollIntoView just because layoutRender fired — nothing about actual navigation changed', () => {
    vi.useFakeTimers();
    const el = document.createElement('div');
    document.body.appendChild(el);
    mockContainerWidth(el, 1000);
    const gallery = new Gallery(el, {
      items: makeItems(3),
      plugins: [Layout, ActiveThumbnail],
      layout: { type: 'justified', groupBy: () => 'All', renderHeading: (key: string) => key },
    });

    gallery.open(1);
    vi.advanceTimersByTime(80); // let the real-navigation scroll settle first

    const rebuiltSpy = vi.fn();
    const imgs = tileImages(el);
    resolveImage(imgs[2]!, 1600, 800);
    flushRaf();
    // Attach the spy to whatever the tile is *after* the rebuild — a fresh
    // element, since the whole point here is confirming re-marking it
    // doesn't also schedule a scroll.
    gallery.getOriginElement(1)!.addEventListener('scroll-would-fire', rebuiltSpy);
    vi.spyOn(gallery.getOriginElement(1)!, 'scrollIntoView').mockImplementation(() => {});
    const scrollSpy = vi.spyOn(gallery.getOriginElement(1)!, 'scrollIntoView');
    vi.advanceTimersByTime(200);

    expect(scrollSpy).not.toHaveBeenCalled();

    gallery.destroy();
    vi.useRealTimers();
  });

  it('a layoutRender while the gallery is closed is a no-op — nothing gets marked active', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    mockContainerWidth(el, 1000);
    const gallery = new Gallery(el, {
      items: makeItems(2),
      plugins: [Layout, ActiveThumbnail],
      layout: { type: 'justified', groupBy: () => 'All', renderHeading: (key: string) => key },
    });

    // Never opened — an autoMeasure correction still fires a real
    // layoutRender via fullRender().
    resolveImage(tileImages(el)[0]!, 1600, 800);
    expect(() => flushRaf()).not.toThrow();

    const tiles = el.querySelectorAll('.shoji-layout-tile');
    for (const tile of tiles) expect(tile.classList.contains('shoji-thumb-active')).toBe(false);

    gallery.destroy();
  });

  it('a plain (non-grouped) relayout — a reposition pass, not a rebuild — never even needs the re-mark, and still stays correct', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    mockContainerWidth(el, 1000);
    const gallery = new Gallery(el, {
      items: makeItems(3),
      plugins: [Layout, ActiveThumbnail],
      layout: { type: 'masonry', columns: 1 }, // no groupBy — relayoutAll() only repositions
    });

    gallery.open(1);
    const originalTile = gallery.getOriginElement(1)!;
    expect(originalTile.classList.contains('shoji-thumb-active')).toBe(true);

    resolveImage(tileImages(el)[2]!, 1600, 800);
    flushRaf();

    // Same element — a reposition pass never calls createTile() at all.
    expect(gallery.getOriginElement(1)).toBe(originalTile);
    expect(originalTile.classList.contains('shoji-thumb-active')).toBe(true);

    gallery.destroy();
  });
});
