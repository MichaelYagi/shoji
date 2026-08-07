import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Gallery } from '../../../src/core';
import { Layout } from '../../../src/plugins/layout';

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

function makeItems(count: number, startAt = 0) {
  return Array.from({ length: count }, (_, i) => {
    const n = startAt + i;
    return { id: `item-${n}`, src: `${n}.jpg`, thumb: `thumb-${n}.jpg`, width: 800, height: 600 };
  });
}

beforeEach(() => {
  HTMLImageElement.prototype.decode = vi.fn().mockResolvedValue(undefined);
});

afterEach(() => {
  // @ts-expect-error - removing the test-only stub added above
  delete HTMLImageElement.prototype.decode;
  document.body.innerHTML = '';
});

describe('Layout — default type', () => {
  it('defaults to justified when no layout.type is given', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    mockContainerWidth(el, 1000);
    const gallery = new Gallery(el, { items: makeItems(3), plugins: [Layout] });

    expect(el.classList.contains('shoji-layout--justified')).toBe(true);
    expect(el.classList.contains('shoji-layout--grid')).toBe(false);
    expect(el.classList.contains('shoji-layout--masonry')).toBe(false);

    gallery.destroy();
  });
});

describe('Layout — grid mode', () => {
  it('renders one tile per item, each linking to its thumb with a lazy-loaded img', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const gallery = new Gallery(el, {
      items: makeItems(3),
      plugins: [Layout],
      layout: { type: 'grid' },
    });

    const tiles = el.querySelectorAll('.shoji-layout-tile');
    expect(tiles).toHaveLength(3);
    const img = tiles[0]!.querySelector('img')!;
    expect(img.src).toContain('thumb-0.jpg');
    expect(img.loading).toBe('lazy');

    gallery.destroy();
  });

  it('tags each tile with data-shoji-id from item.id, for the zoom transition origin lookup', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const gallery = new Gallery(el, {
      items: makeItems(2),
      plugins: [Layout],
      layout: { type: 'grid' },
    });

    expect(el.querySelectorAll('.shoji-layout-tile')[0]!.getAttribute('data-shoji-id')).toBe(
      'item-0',
    );

    gallery.destroy();
  });

  it('sets a uniform aspect-ratio custom property per tile, default 1 (square) — not each item’s own width/height', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    // items have differing aspect ratios (800/600 here, others could be
    // panoramas etc.) — grid cells must NOT vary with them, or a row
    // containing a taller item leaves every shorter tile in that row
    // sitting in a blank gap (plain CSS grid sizes a row to its tallest
    // cell). Masonry/justified are the types that preserve true per-photo
    // ratios instead, via their own JS packing.
    const gallery = new Gallery(el, {
      items: makeItems(2),
      plugins: [Layout],
      layout: { type: 'grid' },
    });

    const tiles = el.querySelectorAll<HTMLElement>('.shoji-layout-tile');
    expect(tiles[0]!.style.getPropertyValue('--shoji-layout-tile-aspect')).toBe('1');
    expect(tiles[1]!.style.getPropertyValue('--shoji-layout-tile-aspect')).toBe('1');

    gallery.destroy();
  });

  it('aspectRatio customizes the uniform grid cell shape', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const gallery = new Gallery(el, {
      items: makeItems(1),
      plugins: [Layout],
      layout: { type: 'grid', aspectRatio: 1.5 },
    });

    const tile = el.querySelector('.shoji-layout-tile') as HTMLElement;
    expect(tile.style.getPropertyValue('--shoji-layout-tile-aspect')).toBe('1.5');

    gallery.destroy();
  });

  it('does not warn about missing width/height — grid cells no longer depend on item dimensions', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const el = document.createElement('div');
    document.body.appendChild(el);
    const gallery = new Gallery(el, {
      items: [{ id: 'a', src: 'a.jpg' }],
      plugins: [Layout],
      layout: { type: 'grid' },
    });

    expect(warnSpy).not.toHaveBeenCalled();

    gallery.destroy();
    warnSpy.mockRestore();
  });

  it('gutter: {x, y} maps to the CSS gap shorthand as "row-gap column-gap" (y before x)', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const gallery = new Gallery(el, {
      items: makeItems(1),
      plugins: [Layout],
      layout: { type: 'grid', gutter: { x: 4, y: 12 } },
    });

    expect(el.style.getPropertyValue('--shoji-layout-gutter')).toBe('12px 4px');

    gallery.destroy();
  });

  it('a plain numeric gutter still applies equally to both axes', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const gallery = new Gallery(el, {
      items: makeItems(1),
      plugins: [Layout],
      layout: { type: 'grid', gutter: 8 },
    });

    expect(el.style.getPropertyValue('--shoji-layout-gutter')).toBe('8px 8px');

    gallery.destroy();
  });

  it('clicking a tile opens the lightbox at that index', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const gallery = new Gallery(el, {
      items: makeItems(3),
      plugins: [Layout],
      layout: { type: 'grid' },
    });

    const tiles = el.querySelectorAll('.shoji-layout-tile');
    tiles[1]!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(gallery.currentIndex).toBe(1);
    gallery.destroy();
  });

  it("a video item's tile thumbnail uses item.poster, not item.src (the unplayable video file itself)", () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const gallery = new Gallery(el, {
      items: [
        {
          id: 'v',
          src: 'clip.mp4',
          video: { provider: 'html5' },
          poster: 'poster.jpg',
          width: 800,
          height: 600,
        },
      ],
      plugins: [Layout],
      layout: { type: 'grid' },
    });

    const img = el.querySelector('.shoji-layout-tile img') as HTMLImageElement;
    expect(img.src).toContain('poster.jpg');
    expect(img.src).not.toContain('clip.mp4');

    gallery.destroy();
  });

  it('falls back to item.src only for a plain image item, unaffected by the poster fix', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const gallery = new Gallery(el, {
      items: [{ id: 'a', src: 'a.jpg', width: 800, height: 600 }],
      plugins: [Layout],
      layout: { type: 'grid' },
    });

    const img = el.querySelector('.shoji-layout-tile img') as HTMLImageElement;
    expect(img.src).toContain('a.jpg');

    gallery.destroy();
  });
});

describe('Layout — masonry mode', () => {
  it('with autoMeasure disabled: warns once (not per item) when items are missing width/height, falling back to a 4:3 placeholder ratio permanently', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const el = document.createElement('div');
    document.body.appendChild(el);
    mockContainerWidth(el, 1000);
    const gallery = new Gallery(el, {
      items: [
        { id: 'a', src: 'a.jpg' },
        { id: 'b', src: 'b.jpg' },
      ],
      plugins: [Layout],
      layout: { type: 'masonry', columns: 1, autoMeasure: false },
    });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const tile = el.querySelector('.shoji-layout-tile') as HTMLElement;
    // single column, no gutter subtracted -> width == containerWidth;
    // height derives from the 4:3 fallback ratio (DEFAULT_ASPECT).
    expect(tile.style.width).toBe('1000px');
    expect(tile.style.height).toBe('750px');

    gallery.destroy();
    warnSpy.mockRestore();
  });

  it('with autoMeasure on (the default), does not warn for missing width/height when a thumb/poster/src exists to measure from — it self-corrects instead (see the autoMeasure describe block below)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const el = document.createElement('div');
    document.body.appendChild(el);
    mockContainerWidth(el, 1000);
    const gallery = new Gallery(el, {
      items: [{ id: 'a', src: 'a.jpg' }],
      plugins: [Layout],
      layout: { type: 'masonry', columns: 1 },
    });

    expect(warnSpy).not.toHaveBeenCalled();

    gallery.destroy();
    warnSpy.mockRestore();
  });

  it('still warns even with autoMeasure on, if an item has no measurable thumb/poster/src at all', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const el = document.createElement('div');
    document.body.appendChild(el);
    mockContainerWidth(el, 1000);
    const gallery = new Gallery(el, {
      items: [{ id: 'v', src: 'clip.mp4', video: { provider: 'html5' } }], // no thumb/poster
      plugins: [Layout],
      layout: { type: 'masonry', columns: 1 },
    });

    expect(warnSpy).toHaveBeenCalledTimes(1);

    gallery.destroy();
    warnSpy.mockRestore();
  });

  it('positions tiles via transform + explicit width/height, and sets the container height', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    mockContainerWidth(el, 1000);
    const gallery = new Gallery(el, {
      items: makeItems(3),
      plugins: [Layout],
      layout: { type: 'masonry', columns: 2, gutter: 8 },
    });

    const tiles = el.querySelectorAll<HTMLElement>('.shoji-layout-tile');
    expect(tiles[0]!.style.transform).toMatch(/translate\(0px, 0px\)/);
    expect(tiles[0]!.style.width).not.toBe('');
    expect(el.style.height).not.toBe('');

    gallery.destroy();
  });

  it('gutter: {x, y} applies independent horizontal/vertical spacing, not a single shared value', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    mockContainerWidth(el, 1000);
    // asymmetric on purpose: x (between columns) tiny, y (within a column) huge
    const gallery = new Gallery(el, {
      items: makeItems(3),
      plugins: [Layout],
      layout: { type: 'masonry', columns: 2, gutter: { x: 2, y: 100 } },
    });

    const tiles = Array.from(el.querySelectorAll<HTMLElement>('.shoji-layout-tile'));
    const xOf = (t: HTMLElement) => Number(t.style.transform.match(/translate\(([\d.]+)px/)![1]);
    const yOf = (t: HTMLElement) =>
      Number(t.style.transform.match(/translate\([\d.]+px, ([\d.]+)px\)/)![1]);

    // col width = (1000 - gutterX*(2-1)) / 2 = (1000-2)/2 = 499; second column starts at 499+2=501
    const colGap = tiles.find((t) => xOf(t) > 0);
    expect(colGap).toBeDefined();
    expect(xOf(colGap!)).toBeCloseTo(499 + 2, 0);

    // whichever two tiles share a column should be gutterY (100px) apart in y, not gutterX
    const sameColumnPair = tiles.filter((t) => xOf(t) === xOf(tiles[0]!));
    if (sameColumnPair.length >= 2) {
      const ys = sameColumnPair.map(yOf).sort((a, b) => a - b);
      expect(ys[1]! - ys[0]!).toBeGreaterThan(50); // consistent with a 100px gutterY, not a 2px gutterX
    }

    gallery.destroy();
  });

  it('does nothing (no NaN/degenerate styles) when the container has zero width — e.g. display:none — and self-corrects once sized', () => {
    const el = document.createElement('div');
    document.body.appendChild(el); // getBoundingClientRect not mocked -> jsdom's real (zero) layout
    const gallery = new Gallery(el, {
      items: makeItems(2),
      plugins: [Layout],
      layout: { type: 'masonry' },
    });

    const tile = el.querySelector<HTMLElement>('.shoji-layout-tile')!;
    expect(tile.style.transform).toBe(''); // skipped, not garbage
    gallery.destroy();
  });

  it('does not mark a tile visible until it actually gets real geometry — DESIGN.md §2.3b', () => {
    // Regression: a tile left unstyled during the containerWidth <= 0 gap
    // above falls back to CSS auto-sizing from its <img> child, which can
    // still be a real, clickable rect — just the wrong one. A click
    // landing on it during that gap computes the zoom transition's origin
    // from that bad rect, silently skipping the animation (if the rect is
    // 0×0) or animating from the wrong place (if it isn't). layout.css
    // makes an unpositioned tile visibility: hidden (untestable here —
    // jsdom doesn't apply real CSS under Vitest, see vitest.config.ts) by
    // default, removing it from hit-testing entirely; the JS side of that
    // contract, tested here, is that it never explicitly marks a tile
    // visible until that same pass actually sets its real geometry.
    const el = document.createElement('div');
    document.body.appendChild(el); // zero width -> the layout pass is skipped
    let resizeCallback: (() => void) | undefined;
    const originalRO = window.ResizeObserver;
    window.ResizeObserver = vi.fn().mockImplementation((cb: () => void) => {
      resizeCallback = cb;
      return { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
    }) as unknown as typeof ResizeObserver;
    const originalRaf = window.requestAnimationFrame;
    window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    }) as typeof window.requestAnimationFrame;

    const gallery = new Gallery(el, {
      items: makeItems(1),
      plugins: [Layout],
      layout: { type: 'masonry' },
    });

    const tile = el.querySelector<HTMLElement>('.shoji-layout-tile')!;
    expect(tile.style.visibility).toBe(''); // never explicitly set — CSS default (hidden) still applies

    // Give it real geometry, then fire the same ResizeObserver callback
    // its own eventual correction would use — a relayout, not a rebuild,
    // so `tile` is still the live element being asserted on.
    mockContainerWidth(el, 1000);
    resizeCallback?.();

    expect(tile.style.visibility).toBe('visible');
    expect(tile.style.transform).not.toBe('');

    gallery.destroy();
    window.ResizeObserver = originalRO;
    window.requestAnimationFrame = originalRaf;
  });
});

describe('Layout — masonry, orientation: horizontal', () => {
  it('reads containerWidth (like every other layout type) and sets its own computed height — never its width', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    mockContainerWidth(el, 1000);
    const gallery = new Gallery(el, {
      items: makeItems(3),
      plugins: [Layout],
      layout: { type: 'masonry', orientation: 'horizontal', rowHeight: 200, gutter: 8 },
    });

    const tile = el.querySelector<HTMLElement>('.shoji-layout-tile')!;
    expect(tile.style.transform).toMatch(/translate\(0px, 0px\)/);
    // Only height is ever set inline (computed from the packed rows) — width
    // stays at its natural CSS width, same as every other layout type; the
    // whole point of this algorithm is that it never needs to exceed it.
    expect(el.style.width).toBe('');
    expect(el.style.height).not.toBe('');

    gallery.destroy();
  });

  it('does nothing when the container has zero width and does not crash', () => {
    const el = document.createElement('div');
    document.body.appendChild(el); // no mocked width -> jsdom's real (zero) layout
    const gallery = new Gallery(el, {
      items: makeItems(2),
      plugins: [Layout],
      layout: { type: 'masonry', orientation: 'horizontal' },
    });

    const tile = el.querySelector<HTMLElement>('.shoji-layout-tile')!;
    expect(tile.style.transform).toBe(''); // skipped, not garbage
    gallery.destroy();
  });

  it('wraps tiles into multiple rows once a row would overflow containerWidth, never scrolling sideways', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    mockContainerWidth(el, 500); // 5 square 800x600(4:3)-ish tiles at rowHeight 200 won't all fit on one row
    const gallery = new Gallery(el, {
      items: makeItems(6),
      plugins: [Layout],
      layout: { type: 'masonry', orientation: 'horizontal', rowHeight: 200, gutter: 8 },
    });

    const tiles = Array.from(el.querySelectorAll<HTMLElement>('.shoji-layout-tile'));
    const ys = new Set(tiles.map((t) => t.style.transform.match(/, (-?\d+(?:\.\d+)?)px\)/)![1]));
    expect(ys.size).toBeGreaterThan(1); // more than one row was needed

    gallery.destroy();
  });
});

describe('Layout — justified mode', () => {
  it('positions tiles via transform + explicit width/height, and sets the container height', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    mockContainerWidth(el, 1000);
    const gallery = new Gallery(el, {
      items: makeItems(3),
      plugins: [Layout],
      layout: { type: 'justified', rowHeight: 200, gutter: 8 },
    });

    const tile = el.querySelector<HTMLElement>('.shoji-layout-tile')!;
    expect(tile.style.transform).toMatch(/translate\(/);
    expect(tile.style.width).not.toBe('');
    expect(el.style.height).not.toBe('');

    gallery.destroy();
  });

  it('every row of tiles ends flush with the container width (the justified signature)', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    mockContainerWidth(el, 1000);
    // 6 uniform 4:3 tiles at rowHeight:200 forms at least one full row given these settings
    const gallery = new Gallery(el, {
      items: makeItems(6),
      plugins: [Layout],
      layout: { type: 'justified', rowHeight: 200, gutter: 8, lastRow: 'justify' },
    });

    const tiles = Array.from(el.querySelectorAll<HTMLElement>('.shoji-layout-tile'));
    const firstRowY = tiles[0]!.style.transform.match(/translate\([\d.]+px, ([\d.]+)px\)/)?.[1];
    const sameRowTiles = tiles.filter(
      (t) => t.style.transform.match(/translate\([\d.]+px, ([\d.]+)px\)/)?.[1] === firstRowY,
    );
    const rightEdges = sameRowTiles.map((t) => {
      const x = Number(t.style.transform.match(/translate\(([\d.]+)px/)![1]);
      return x + Number(t.style.width.replace('px', ''));
    });
    expect(Math.max(...rightEdges)).toBeCloseTo(1000, 0);

    gallery.destroy();
  });

  it("lastRow: 'hide' hides a genuine trailing partial row's tiles (hidden attribute set)", () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    mockContainerWidth(el, 1000);
    // a single 4:3 tile at rowHeight:200 never reaches 1000px on its own -> always a trailing leftover
    const gallery = new Gallery(el, {
      items: makeItems(1),
      plugins: [Layout],
      layout: { type: 'justified', rowHeight: 200, lastRow: 'hide' },
    });

    const tile = el.querySelector<HTMLElement>('.shoji-layout-tile')!;
    expect(tile.hidden).toBe(true);

    gallery.destroy();
  });

  it("switching from 'hide' to enough tiles to complete a row un-hides them on relayout", () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    mockContainerWidth(el, 1000);
    const gallery = new Gallery(el, {
      items: makeItems(1),
      plugins: [Layout],
      layout: { type: 'justified', rowHeight: 200, lastRow: 'hide' },
    });
    expect(el.querySelector<HTMLElement>('.shoji-layout-tile')!.hidden).toBe(true);

    gallery.updateSlides(makeItems(6)); // now enough to complete at least one row
    const stillHidden = Array.from(el.querySelectorAll<HTMLElement>('.shoji-layout-tile')).filter(
      (t) => t.hidden,
    );
    expect(stillHidden.length).toBeLessThan(6);

    gallery.destroy();
  });

  it('appending items relays out every tile (not just the new ones) — unlike masonry, a row can be completed by a later append', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    mockContainerWidth(el, 1000);
    const gallery = new Gallery(el, {
      items: makeItems(1),
      plugins: [Layout],
      layout: { type: 'justified', rowHeight: 200, lastRow: 'justify' },
    });

    const firstTileBefore = el.querySelector<HTMLElement>('.shoji-layout-tile')!.style.width;
    gallery.updateSlides(makeItems(4)); // completes a row the lone first tile couldn't on its own
    const firstTileAfter = el.querySelector<HTMLElement>('.shoji-layout-tile')!.style.width;

    expect(firstTileAfter).not.toBe(firstTileBefore); // the earlier tile WAS repositioned/resized

    gallery.destroy();
  });
});

describe('Layout — data-shoji-index and the layoutRender event', () => {
  it('every tile carries data-shoji-index, matching its position in the items array — regardless of item.id', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    mockContainerWidth(el, 1000);
    const items = [
      { src: 'no-id.jpg', width: 800, height: 600 }, // no id at all
      ...makeItems(2, 1),
    ];
    const gallery = new Gallery(el, { items, plugins: [Layout] });

    const tiles = el.querySelectorAll<HTMLElement>('.shoji-layout-tile');
    expect(tiles).toHaveLength(3);
    tiles.forEach((tile, i) => expect(tile.dataset.shojiIndex).toBe(String(i)));
    // The no-id item's tile still has no data-shoji-id (unrelated, optional attribute) — index is the always-available one.
    expect(tiles[0]!.dataset.shojiId).toBeUndefined();

    gallery.destroy();
  });

  it('emits layoutRender with every tile after a full render, in item order', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    mockContainerWidth(el, 1000);
    const gallery = new Gallery(el, { items: makeItems(3), plugins: [Layout] });

    const handler = vi.fn();
    gallery.on('layoutRender', handler);
    gallery.updateSlides(makeItems(3).reverse()); // same length, different order — not a pure append, triggers fullRender

    expect(handler).toHaveBeenCalledTimes(1);
    const { tiles } = handler.mock.calls[0]![0] as {
      tiles: { index: number; element: HTMLElement }[];
    };
    expect(tiles).toHaveLength(3);
    expect(tiles.map((t) => t.index)).toEqual([0, 1, 2]);
    tiles.forEach((t) => expect(t.element.classList.contains('shoji-layout-tile')).toBe(true));

    gallery.destroy();
  });

  it('emits layoutRender with only the newly-appended tiles — not the whole set — on a pure append', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    mockContainerWidth(el, 1000);
    const gallery = new Gallery(el, { items: makeItems(3), plugins: [Layout] });

    const handler = vi.fn();
    gallery.on('layoutRender', handler);
    gallery.updateSlides(makeItems(5)); // 0,1,2 unchanged, 3,4 appended

    expect(handler).toHaveBeenCalledTimes(1);
    const { tiles } = handler.mock.calls[0]![0] as {
      tiles: { index: number; element: HTMLElement }[];
    };
    expect(tiles.map((t) => t.index)).toEqual([3, 4]);

    gallery.destroy();
  });

  it("a host can inject custom content keyed to the event's index, then recover that same index later from data-shoji-index alone", () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    mockContainerWidth(el, 1000);
    const items = makeItems(3);
    const gallery = new Gallery(el, { items, plugins: [Layout] });

    gallery.on('layoutRender', ({ tiles }) => {
      for (const { index, element } of tiles) {
        const badge = document.createElement('span');
        badge.className = 'my-badge';
        badge.textContent = `badge-for-${index}`;
        element.appendChild(badge);
      }
    });
    // Re-render (order change, not a pure append) so the listener above,
    // attached after construction, actually runs.
    gallery.updateSlides([...items].reverse());

    const badges = Array.from(el.querySelectorAll<HTMLElement>('.my-badge'));
    expect(badges).toHaveLength(3);
    for (const badge of badges) {
      const tile = badge.closest('.shoji-layout-tile') as HTMLElement;
      const recoveredIndex = Number(tile.dataset.shojiIndex);
      // The index recovered from the DOM alone (no reference to the
      // original event payload) matches exactly the index that was used
      // to create this same badge in the first place.
      expect(badge.textContent).toBe(`badge-for-${recoveredIndex}`);
    }

    gallery.destroy();
  });
});

describe('Layout — incremental updates (infinite-scroll compatibility)', () => {
  it('a pure append only creates DOM for the new items — existing tile elements are untouched (same references)', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    mockContainerWidth(el, 1000);
    const gallery = new Gallery(el, {
      items: makeItems(3),
      plugins: [Layout],
      layout: { type: 'masonry' },
    });

    const before = Array.from(el.querySelectorAll('.shoji-layout-tile'));
    gallery.updateSlides(makeItems(5)); // 0,1,2 unchanged, 3,4 appended
    const after = Array.from(el.querySelectorAll('.shoji-layout-tile'));

    expect(after).toHaveLength(5);
    expect(after[0]).toBe(before[0]); // same DOM node, not recreated
    expect(after[1]).toBe(before[1]);
    expect(after[2]).toBe(before[2]);

    gallery.destroy();
  });

  it('continues masonry packing from where the previous page left off, not resetting to y=0', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    mockContainerWidth(el, 1000);
    const gallery = new Gallery(el, {
      items: makeItems(2),
      plugins: [Layout],
      layout: { type: 'masonry', columns: 2 },
    });

    gallery.updateSlides(makeItems(3));
    const appendedTile = el.querySelectorAll<HTMLElement>('.shoji-layout-tile')[2]!;
    expect(appendedTile.style.transform).not.toMatch(/translate\(\d+px, 0px\)/); // not back at the top

    gallery.destroy();
  });

  it('a non-append change (reorder/removal) triggers a full rebuild — all new DOM nodes', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    mockContainerWidth(el, 1000);
    const gallery = new Gallery(el, {
      items: makeItems(3),
      plugins: [Layout],
      layout: { type: 'masonry' },
    });

    const before = Array.from(el.querySelectorAll('.shoji-layout-tile'));
    gallery.updateSlides([...makeItems(3)].reverse()); // same items, different order
    const after = Array.from(el.querySelectorAll('.shoji-layout-tile'));

    expect(after[0]).not.toBe(before[0]);

    gallery.destroy();
  });

  it("click-to-open uses each tile's current index after items change, not a stale one from creation", () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    mockContainerWidth(el, 1000);
    const gallery = new Gallery(el, {
      items: makeItems(3),
      plugins: [Layout],
      layout: { type: 'masonry' },
    });

    gallery.updateSlides([...makeItems(3)].reverse()); // item-2, item-1, item-0
    const firstTile = el.querySelectorAll('.shoji-layout-tile')[0]!;
    firstTile.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(gallery.currentIndex).toBe(0); // opened at its NEW position (0), not its original (2)
    gallery.destroy();
  });
});

describe('Layout — breakpoints', () => {
  it('applies the matching breakpoint override when the container width is within range', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    mockContainerWidth(el, 500); // narrow
    const gallery = new Gallery(el, {
      items: makeItems(1),
      plugins: [Layout],
      layout: { type: 'grid', columnWidth: 240, breakpoints: { 600: { columnWidth: 100 } } },
    });

    expect(el.style.getPropertyValue('--shoji-layout-column-width')).toBe('100px'); // overridden

    gallery.destroy();
  });

  it('falls back to the base config when the container is wider than every breakpoint', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    mockContainerWidth(el, 900); // wider than the one breakpoint below
    const gallery = new Gallery(el, {
      items: makeItems(1),
      plugins: [Layout],
      layout: { type: 'grid', columnWidth: 240, breakpoints: { 600: { columnWidth: 100 } } },
    });

    expect(el.style.getPropertyValue('--shoji-layout-column-width')).toBe('240px'); // base, unmatched

    gallery.destroy();
  });

  it('the narrowest matching breakpoint wins when more than one applies', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    mockContainerWidth(el, 300); // matches both 400 and 800 (300 <= both)
    const gallery = new Gallery(el, {
      items: makeItems(1),
      plugins: [Layout],
      layout: {
        type: 'grid',
        columnWidth: 240,
        breakpoints: { 800: { columnWidth: 150 }, 400: { columnWidth: 80 } },
      },
    });

    expect(el.style.getPropertyValue('--shoji-layout-column-width')).toBe('80px'); // 400, not 800

    gallery.destroy();
  });

  it('a breakpoint override with an unspecified field falls back to the base value for just that field', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    mockContainerWidth(el, 500);
    const gallery = new Gallery(el, {
      items: makeItems(1),
      plugins: [Layout],
      layout: {
        type: 'grid',
        columnWidth: 240,
        gutter: 20,
        breakpoints: { 600: { columnWidth: 100 } }, // gutter not overridden here
      },
    });

    expect(el.style.getPropertyValue('--shoji-layout-column-width')).toBe('100px');
    expect(el.style.getPropertyValue('--shoji-layout-gutter')).toBe('20px 20px'); // base gutter preserved

    gallery.destroy();
  });

  it('re-evaluates on resize — crossing a threshold takes effect live', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    mockContainerWidth(el, 900); // starts wide, unmatched
    let resizeCallback: (() => void) | undefined;
    const originalRO = window.ResizeObserver;
    window.ResizeObserver = vi.fn().mockImplementation((cb: () => void) => {
      resizeCallback = cb;
      return { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
    }) as unknown as typeof ResizeObserver;
    // the plugin defers its actual relayout to one requestAnimationFrame
    // past the ResizeObserver callback (batches bursts of resize events) —
    // run it synchronously here so the test doesn't need real frame timing.
    const originalRaf = window.requestAnimationFrame;
    window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    }) as typeof window.requestAnimationFrame;

    const gallery = new Gallery(el, {
      items: makeItems(1),
      plugins: [Layout],
      layout: { type: 'masonry', columnWidth: 240, breakpoints: { 600: { columnWidth: 100 } } },
    });
    const columnWidthAt900 = el.querySelectorAll<HTMLElement>('.shoji-layout-tile')[0]!.style.width;

    mockContainerWidth(el, 500); // simulate the resize
    resizeCallback?.();
    const columnWidthAt500 = el.querySelectorAll<HTMLElement>('.shoji-layout-tile')[0]!.style.width;

    expect(columnWidthAt500).not.toBe(columnWidthAt900);

    gallery.destroy();
    window.ResizeObserver = originalRO;
    window.requestAnimationFrame = originalRaf;
  });

  it("breakpoints apply to orientation: 'horizontal' too, since it measures containerWidth like every other type", () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    mockContainerWidth(el, 500);
    const gallery = new Gallery(el, {
      items: makeItems(1),
      plugins: [Layout],
      layout: {
        type: 'masonry',
        orientation: 'horizontal',
        rowHeight: 200,
        breakpoints: { 600: { rowHeight: 50 } },
      },
    });

    const tile = el.querySelector<HTMLElement>('.shoji-layout-tile')!;
    expect(tile.style.height).toBe('50px'); // the breakpoint override won, not the base rowHeight

    gallery.destroy();
  });
});

function makeGroupedItems() {
  return [
    { id: 'a', src: 'a.jpg', thumb: 'a.jpg', width: 800, height: 600, data: { section: 'Today' } },
    { id: 'b', src: 'b.jpg', thumb: 'b.jpg', width: 800, height: 600, data: { section: 'Today' } },
    {
      id: 'c',
      src: 'c.jpg',
      thumb: 'c.jpg',
      width: 800,
      height: 600,
      data: { section: 'Yesterday' },
    },
    { id: 'd', src: 'd.jpg', thumb: 'd.jpg', width: 800, height: 600, data: { section: 'March' } },
    { id: 'e', src: 'e.jpg', thumb: 'e.jpg', width: 800, height: 600, data: { section: 'March' } },
  ];
}

const sectionOf = (item: { data?: Record<string, unknown> }) => item.data!.section as string;

describe('Layout — groupBy/headings', () => {
  it('inserts one heading per consecutive run of a changing group key, in DOM order ahead of that run’s tiles', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const gallery = new Gallery(el, {
      items: makeGroupedItems(),
      plugins: [Layout],
      layout: { type: 'grid', groupBy: sectionOf },
    });

    const children = [...el.children];
    const headingTexts = children
      .filter((c) => c.classList.contains('shoji-layout-heading'))
      .map((c) => c.textContent);
    expect(headingTexts).toEqual(['Today', 'Yesterday', 'March']);

    // first child overall is the first heading, and it precedes its section's tiles
    expect(children[0]!.classList.contains('shoji-layout-heading')).toBe(true);
    expect(children[0]!.textContent).toBe('Today');
    expect(children[1]!.classList.contains('shoji-layout-tile')).toBe(true);

    gallery.destroy();
  });

  it('headings are real <h2> elements by default, spanning the full grid row', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const gallery = new Gallery(el, {
      items: makeGroupedItems(),
      plugins: [Layout],
      layout: { type: 'grid', groupBy: sectionOf },
    });

    const heading = el.querySelector('.shoji-layout-heading')!;
    expect(heading.tagName).toBe('H2');

    gallery.destroy();
  });

  it('renderHeading customizes content — a returned string still renders in an <h2>, an HTMLElement is used as-is', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const gallery = new Gallery(el, {
      items: makeGroupedItems(),
      plugins: [Layout],
      layout: {
        type: 'grid',
        groupBy: sectionOf,
        renderHeading: (key: string, items: unknown[]) => `${key} (${items.length})`,
      },
    });

    const heading = el.querySelector('.shoji-layout-heading')!;
    expect(heading.tagName).toBe('H2');
    expect(heading.textContent).toBe('Today (2)');

    gallery.destroy();
  });

  it('renderHeading returning an HTMLElement is used directly as the heading root', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const gallery = new Gallery(el, {
      items: makeGroupedItems(),
      plugins: [Layout],
      layout: {
        type: 'grid',
        groupBy: sectionOf,
        renderHeading: (key: string) => {
          const custom = document.createElement('div');
          custom.dataset.custom = key;
          return custom;
        },
      },
    });

    const heading = el.querySelector('.shoji-layout-heading')!;
    expect(heading.tagName).toBe('DIV');
    expect(heading.getAttribute('data-custom')).toBe('Today');

    gallery.destroy();
  });

  it('headings are skipped by lightbox indexing — a tile’s click-to-open index still matches its real item position', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const gallery = new Gallery(el, {
      items: makeGroupedItems(),
      plugins: [Layout],
      layout: { type: 'grid', groupBy: sectionOf },
    });

    const tiles = el.querySelectorAll('.shoji-layout-tile');
    expect(tiles).toHaveLength(5);
    tiles[3]!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); // item 'd', index 3
    expect(gallery.currentIndex).toBe(3);

    gallery.destroy();
  });

  it('masonry: each section lays out independently and stacks beneath the previous section’s heading', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    mockContainerWidth(el, 1000);
    const gallery = new Gallery(el, {
      items: makeGroupedItems(),
      plugins: [Layout],
      layout: { type: 'masonry', groupBy: sectionOf },
    });

    const headings = el.querySelectorAll('.shoji-layout-heading');
    expect(headings).toHaveLength(3);
    // headings are JS-positioned in masonry mode, same mechanism as tiles
    expect(headings[0]!.getAttribute('style')).toContain('translate');

    // second heading is offset below the first section's content, not at y=0
    const firstTransform = (headings[0] as HTMLElement).style.transform;
    const secondTransform = (headings[1] as HTMLElement).style.transform;
    expect(firstTransform).toContain('translate(0px, 0px)');
    expect(secondTransform).not.toBe(firstTransform);

    gallery.destroy();
  });

  it('justified: small sections share a row instead of each forcing its own (Google Photos-style, not a hard section break)', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    mockContainerWidth(el, 1000);
    // makeGroupedItems(): Today[0,1], Yesterday[2], March[3,4], all 800x600
    // (4:3). Row-fill math at rowHeight:220/gutter:8 packs tiles 0-3 into
    // one row before threshold is crossed (item 4 spills to its own row)
    // — so this row spans all three sections' first tiles.
    const gallery = new Gallery(el, {
      items: makeGroupedItems(),
      plugins: [Layout],
      layout: { type: 'justified', groupBy: sectionOf },
    });

    const headings = el.querySelectorAll<HTMLElement>('.shoji-layout-heading');
    expect(headings).toHaveLength(3);
    const tiles = el.querySelectorAll<HTMLElement>('.shoji-layout-tile');
    const yOf = (t: HTMLElement) =>
      t.style.transform.match(/translate\([\d.-]+px, ([\d.-]+)px\)/)![1];

    // Today's 2nd tile (index 1), Yesterday's only tile (index 2), and
    // March's 1st tile (index 3) all land on the *same* row as each
    // other — proving row composition doesn't hard-break at a section
    // boundary the way it does for masonry.
    expect(yOf(tiles[1]!)).toBe(yOf(tiles[2]!));
    expect(yOf(tiles[2]!)).toBe(yOf(tiles[3]!));

    // Their headings are consequently in the same label-band (same y),
    // positioned at distinct x (each aligned to its own section's first tile).
    const headingY = (h: HTMLElement) =>
      h.style.transform.match(/translate\(([\d.-]+)px, ([\d.-]+)px\)/)!;
    const [todayMatch, yesterdayMatch, marchMatch] = [...headings].map(headingY);
    expect(todayMatch![2]).toBe(yesterdayMatch![2]);
    expect(yesterdayMatch![2]).toBe(marchMatch![2]);
    expect(new Set([todayMatch![1], yesterdayMatch![1], marchMatch![1]]).size).toBe(3); // distinct x

    gallery.destroy();
  });

  it('justified: a heading is a compact element (width: auto), not a full-width blocking one', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    mockContainerWidth(el, 1000);
    const gallery = new Gallery(el, {
      items: makeGroupedItems(),
      plugins: [Layout],
      layout: { type: 'justified', groupBy: sectionOf },
    });

    expect(el.classList.contains('shoji-layout--justified')).toBe(true);
    // The compact-width override lives in layout.css
    // (.shoji-layout--justified .shoji-layout-heading { width: auto }),
    // not inline — asserting the class hook it depends on is present.
    const heading = el.querySelector('.shoji-layout-heading')!;
    expect(heading.classList.contains('shoji-layout-heading')).toBe(true);

    gallery.destroy();
  });

  it('renderHeading returning { title, subtitle } builds a structured title + muted-subtitle heading', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    mockContainerWidth(el, 1000);
    const gallery = new Gallery(el, {
      items: makeGroupedItems(),
      plugins: [Layout],
      layout: {
        type: 'justified',
        groupBy: sectionOf,
        renderHeading: (key: string) => ({ title: key, subtitle: `${key} subtitle` }),
      },
    });

    const heading = el.querySelector('.shoji-layout-heading')!;
    const title = heading.querySelector('.shoji-layout-heading-title')!;
    const subtitle = heading.querySelector('.shoji-layout-heading-subtitle')!;
    expect(title.textContent).toBe('Today');
    expect(subtitle.textContent).toBe('Today subtitle');

    gallery.destroy();
  });

  it('renderHeading returning { title } with no subtitle omits the subtitle element entirely', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    mockContainerWidth(el, 1000);
    const gallery = new Gallery(el, {
      items: makeGroupedItems(),
      plugins: [Layout],
      layout: {
        type: 'justified',
        groupBy: sectionOf,
        renderHeading: (key: string) => ({ title: key }),
      },
    });

    const heading = el.querySelector('.shoji-layout-heading')!;
    expect(heading.querySelector('.shoji-layout-heading-title')!.textContent).toBe('Today');
    expect(heading.querySelector('.shoji-layout-heading-subtitle')).toBeNull();

    gallery.destroy();
  });

  it("headingOverflow defaults to 'show' — the content-fitting pass never runs, subtitle stays visible, no inline overflow styles touched", () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    mockContainerWidth(el, 1000);
    const gallery = new Gallery(el, {
      items: makeGroupedItems(),
      plugins: [Layout],
      layout: {
        type: 'justified',
        groupBy: sectionOf,
        renderHeading: (key: string) => ({ title: key, subtitle: 'a location' }),
      },
    });

    const heading = el.querySelector<HTMLElement>('.shoji-layout-heading')!;
    const subtitle = heading.querySelector<HTMLElement>('.shoji-layout-heading-subtitle')!;
    expect(subtitle.hidden).toBe(false);
    // 'show' never runs the fitting pass at all — inline whiteSpace/maxWidth
    // are left untouched (CSS's own nowrap/width:auto default applies
    // instead); 'fit' (tested below) always sets them explicitly, even
    // when the fitted decision happens to also be "show everything".
    expect(heading.style.whiteSpace).toBe('');
    expect(heading.style.maxWidth).toBe('');

    gallery.destroy();
  });

  it("headingOverflow: 'fit' runs the content-fitting pass — inline overflow styles get set explicitly", () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    mockContainerWidth(el, 1000);
    const gallery = new Gallery(el, {
      items: makeGroupedItems(),
      plugins: [Layout],
      layout: {
        type: 'justified',
        groupBy: sectionOf,
        renderHeading: (key: string) => ({ title: key, subtitle: 'a location' }),
        headingOverflow: 'fit',
      },
    });

    const heading = el.querySelector<HTMLElement>('.shoji-layout-heading')!;
    // jsdom measures every element at 0×0, so the fitting pass always finds
    // "fits" trivially here — this test isn't about the measurement outcome
    // (that needs a real browser, verified separately), only that 'fit'
    // actually took the fitting code path at all, unlike 'show' above.
    expect(heading.style.whiteSpace).toBe('nowrap');
    expect(heading.style.maxWidth).toBe('none');

    gallery.destroy();
  });

  it('stickyHeadings adds the sticky class only for type: grid', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const gallery = new Gallery(el, {
      items: makeGroupedItems(),
      plugins: [Layout],
      layout: { type: 'grid', groupBy: sectionOf, stickyHeadings: true },
    });

    expect(
      el.querySelector('.shoji-layout-heading')!.classList.contains('shoji-layout-heading--sticky'),
    ).toBe(true);

    gallery.destroy();
  });

  it('an items change while grouped fully re-renders (new heading/tile DOM), rather than appending', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    mockContainerWidth(el, 1000);
    const gallery = new Gallery(el, {
      items: makeGroupedItems().slice(0, 3), // Today, Today, Yesterday
      plugins: [Layout],
      layout: { type: 'grid', groupBy: sectionOf },
    });

    expect(el.querySelectorAll('.shoji-layout-heading')).toHaveLength(2);

    gallery.updateSlides(makeGroupedItems()); // + March, March
    expect(el.querySelectorAll('.shoji-layout-heading')).toHaveLength(3);
    expect(el.querySelectorAll('.shoji-layout-tile')).toHaveLength(5);

    gallery.destroy();
  });
});

describe('Layout — unsupported option combinations', () => {
  it('warns and ignores groupBy when combined with orientation: horizontal', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const el = document.createElement('div');
    document.body.appendChild(el);
    mockContainerWidth(el, 600);
    const gallery = new Gallery(el, {
      items: makeItems(2),
      plugins: [Layout],
      layout: { type: 'masonry', orientation: 'horizontal', groupBy: () => 'x' },
    });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]![0] as string).toContain('groupBy');
    expect(el.querySelectorAll('.shoji-layout-heading')).toHaveLength(0);

    gallery.destroy();
    warnSpy.mockRestore();
  });

  it('warns and ignores stickyHeadings when type is not grid', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const el = document.createElement('div');
    document.body.appendChild(el);
    const gallery = new Gallery(el, {
      items: makeItems(2),
      plugins: [Layout],
      layout: { type: 'masonry', stickyHeadings: true },
    });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]![0] as string).toContain('stickyHeadings');

    gallery.destroy();
    warnSpy.mockRestore();
  });

  it('does not warn when no unsupported combinations are supplied', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const el = document.createElement('div');
    document.body.appendChild(el);
    const gallery = new Gallery(el, {
      items: makeItems(2),
      plugins: [Layout],
      layout: { type: 'grid' },
    });

    expect(warnSpy).not.toHaveBeenCalled();

    gallery.destroy();
    warnSpy.mockRestore();
  });
});

describe('Layout — cleanup', () => {
  it('destroy() clears the container and removes the layout classes', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    // Deliberately no `layout: { type }` — destroy() must work the same
    // regardless of type, so this exercises whatever the plugin's own
    // default currently is (justified) rather than pinning one explicitly.
    const gallery = new Gallery(el, { items: makeItems(2), plugins: [Layout] });

    gallery.destroy();

    expect(el.querySelector('.shoji-layout-tile')).toBeNull();
    expect(el.classList.contains('shoji-layout')).toBe(false);
  });

  it('disconnects the resize observer on destroy so a later resize does not touch a torn-down gallery', () => {
    const disconnect = vi.fn();
    const observe = vi.fn();
    const originalRO = window.ResizeObserver;
    window.ResizeObserver = vi.fn().mockImplementation(() => ({
      observe,
      unobserve: vi.fn(),
      disconnect,
    })) as unknown as typeof ResizeObserver;

    const el = document.createElement('div');
    document.body.appendChild(el);
    const gallery = new Gallery(el, {
      items: makeItems(2),
      plugins: [Layout],
      layout: { type: 'masonry' },
    });
    expect(observe).toHaveBeenCalledTimes(1);

    gallery.destroy();
    expect(disconnect).toHaveBeenCalledTimes(1);

    window.ResizeObserver = originalRO;
  });
});
