import { afterEach, describe, expect, it, vi } from 'vitest';
import { Gallery } from '../../src/core';

describe('Gallery lifecycle', () => {
  it('emits open/close events and tracks state idempotently', () => {
    const el = document.createElement('div');
    const gallery = new Gallery(el);

    const opened = vi.fn();
    const closed = vi.fn();
    gallery.on('afterOpen', opened);
    gallery.on('afterClose', closed);

    gallery.open(2);
    gallery.open(2); // no-op while already open
    expect(opened).toHaveBeenCalledTimes(1);
    expect(opened).toHaveBeenCalledWith({ index: 2 });

    gallery.close();
    gallery.close(); // no-op while already closed
    expect(closed).toHaveBeenCalledTimes(1);

    gallery.destroy();
  });

  it('unsubscribes listeners returned from on()', () => {
    const gallery = new Gallery(document.createElement('div'));
    const fn = vi.fn();
    const unsubscribe = gallery.on('open', fn);
    unsubscribe();

    gallery.open();
    expect(fn).not.toHaveBeenCalled();

    gallery.destroy();
  });

  it('closes and stops emitting after destroy()', () => {
    const gallery = new Gallery(document.createElement('div'));
    const closed = vi.fn();
    gallery.on('afterClose', closed);

    gallery.open();
    gallery.destroy();
    expect(closed).toHaveBeenCalledTimes(1);

    const opened = vi.fn();
    gallery.on('open', opened);
    gallery.open();
    expect(opened).not.toHaveBeenCalled();
  });

  it('isOpen reflects open()/close() state', () => {
    const gallery = new Gallery(document.createElement('div'));
    expect(gallery.isOpen).toBe(false);

    gallery.open();
    expect(gallery.isOpen).toBe(true);

    gallery.close();
    expect(gallery.isOpen).toBe(false);

    gallery.destroy();
  });

  it('isDestroyed is false until destroy() runs, then stays true', () => {
    const gallery = new Gallery(document.createElement('div'));
    expect(gallery.isDestroyed).toBe(false);

    gallery.open();
    expect(gallery.isDestroyed).toBe(false);

    gallery.destroy();
    expect(gallery.isDestroyed).toBe(true);
  });
});

describe('Gallery — body scroll lock', () => {
  afterEach(() => {
    document.body.style.overflow = '';
    document.documentElement.style.overflowX = '';
  });

  it('locks document.body scrolling while open, restores it on close', () => {
    const gallery = new Gallery(document.createElement('div'));

    gallery.open();
    expect(document.body.style.overflow).toBe('hidden');

    gallery.close();
    expect(document.body.style.overflow).toBe('');

    gallery.destroy();
  });

  it('restores the exact prior overflow value, not just clears it', () => {
    document.body.style.overflow = 'scroll';
    const gallery = new Gallery(document.createElement('div'));

    gallery.open();
    expect(document.body.style.overflow).toBe('hidden');

    gallery.close();
    expect(document.body.style.overflow).toBe('scroll');

    gallery.destroy();
  });

  it('two galleries open at once: closing one does not unlock while the other is still open', () => {
    const a = new Gallery(document.createElement('div'));
    const b = new Gallery(document.createElement('div'));

    a.open();
    b.open();
    expect(document.body.style.overflow).toBe('hidden');

    a.close();
    expect(document.body.style.overflow).toBe('hidden');

    b.close();
    expect(document.body.style.overflow).toBe('');

    a.destroy();
    b.destroy();
  });

  it('destroy() while open also unlocks', () => {
    const gallery = new Gallery(document.createElement('div'));
    gallery.open();
    expect(document.body.style.overflow).toBe('hidden');

    gallery.destroy();
    expect(document.body.style.overflow).toBe('');
  });

  it("regression: also locks <html>'s own overflow-x, not just body's — reported from real usage: rotating a photo on a narrow mobile viewport grew window.innerWidth itself (a rotated slide's ink overflow reaching the real viewport, since mobile browsers decide whether to widen the layout viewport past device-width by looking at <html>'s own overflow-x, not at what's already clipped further down the tree), pushing the toolbar off-screen until the page was scrolled right to reach it", () => {
    const gallery = new Gallery(document.createElement('div'));

    gallery.open();
    expect(document.documentElement.style.overflowX).toBe('hidden');

    gallery.close();
    expect(document.documentElement.style.overflowX).toBe('');

    gallery.destroy();
  });

  it("restores <html>'s exact prior overflow-x value, not just clears it", () => {
    document.documentElement.style.overflowX = 'scroll';
    const gallery = new Gallery(document.createElement('div'));

    gallery.open();
    expect(document.documentElement.style.overflowX).toBe('hidden');

    gallery.close();
    expect(document.documentElement.style.overflowX).toBe('scroll');

    gallery.destroy();
  });
});

describe('Gallery — openOnInit', () => {
  const items = [
    { id: 'a', src: 'a.jpg' },
    { id: 'b', src: 'b.jpg' },
  ];

  // close() is a no-op (no afterClose emission) unless the gallery was
  // actually open — used below as a behavioral proxy for "was it open after
  // construction", since that isn't otherwise exposed as a public getter.
  function wasOpenAfterConstruction(gallery: Gallery): boolean {
    const closed = vi.fn();
    gallery.on('afterClose', closed);
    gallery.close();
    return closed.mock.calls.length > 0;
  }

  it('stays closed by default, even with items present', () => {
    const gallery = new Gallery(document.createElement('div'), { items });
    expect(gallery.currentIndex).toBe(0);
    expect(wasOpenAfterConstruction(gallery)).toBe(false);

    gallery.destroy();
  });

  it('opens immediately at index (default 0) when set', () => {
    const gallery = new Gallery(document.createElement('div'), { items, openOnInit: true });

    expect(gallery.currentIndex).toBe(0);
    expect(wasOpenAfterConstruction(gallery)).toBe(true);

    gallery.destroy();
  });

  it('opens at options.index when both are set together', () => {
    const gallery = new Gallery(document.createElement('div'), {
      items,
      openOnInit: true,
      index: 1,
    });

    expect(gallery.currentIndex).toBe(1);

    gallery.destroy();
  });

  it('does not open when there are no items, even if requested', () => {
    const gallery = new Gallery(document.createElement('div'), { items: [], openOnInit: true });

    expect(wasOpenAfterConstruction(gallery)).toBe(false);

    gallery.destroy();
  });
});

describe('Gallery — instance registry (getInstance/instances)', () => {
  it('getInstance(el) returns the instance constructed on that element', () => {
    const el = document.createElement('div');
    const gallery = new Gallery(el);

    expect(Gallery.getInstance(el)).toBe(gallery);

    gallery.destroy();
  });

  it('getInstance(el) returns undefined for an element with no gallery, and after destroy()', () => {
    const untouched = document.createElement('div');
    expect(Gallery.getInstance(untouched)).toBeUndefined();

    const el = document.createElement('div');
    const gallery = new Gallery(el);
    gallery.destroy();

    expect(Gallery.getInstance(el)).toBeUndefined();
  });

  it('instances() enumerates every live instance and excludes destroyed ones', () => {
    // Counts relative to a baseline, not absolute — other test files in the
    // same run may have their own (properly destroy()-ed, or not) Gallery
    // instances alive in the shared module-level registry at this point;
    // this test only asserts about the two it adds itself. toContain, not
    // toEqual(new Set([a, b])) — the latter would deep-structurally compare
    // the two Gallery instances' internal state against each other rather
    // than checking reference identity.
    const before = [...Gallery.instances()].length;
    const a = new Gallery(document.createElement('div'));
    const b = new Gallery(document.createElement('div'));

    let list = [...Gallery.instances()];
    expect(list).toHaveLength(before + 2);
    expect(list).toContain(a);
    expect(list).toContain(b);

    a.destroy();
    list = [...Gallery.instances()];
    expect(list).toHaveLength(before + 1);
    expect(list).toContain(b);

    b.destroy();
  });

  it('a second gallery constructed on the same element replaces the first in the registry', () => {
    const el = document.createElement('div');
    const first = new Gallery(el);
    const second = new Gallery(el);

    expect(Gallery.getInstance(el)).toBe(second);

    first.destroy();
    second.destroy();
  });

  it('destroying a stale, already-superseded instance does not evict the newer one that replaced it', () => {
    const el = document.createElement('div');
    const first = new Gallery(el);
    const second = new Gallery(el); // never told about `first`; just takes over the element

    first.destroy(); // destroying the old one shouldn't touch the registry entry, which is already `second`'s

    expect(Gallery.getInstance(el)).toBe(second);

    second.destroy();
  });
});

describe('Gallery — reinit() (DESIGN.md §2.7)', () => {
  function trackingPlugin() {
    const initCount = vi.fn();
    const cleanup = vi.fn();
    const plugin = {
      name: 'tracker',
      init(_ctx: unknown) {
        initCount();
        return cleanup;
      },
    };
    return { plugin, initCount, cleanup };
  }

  it('preserves instance identity and the registry entry', () => {
    const el = document.createElement('div');
    const gallery = new Gallery(el);

    gallery.reinit();

    expect(Gallery.getInstance(el)).toBe(gallery);
    gallery.destroy();
  });

  it('omitting options rebuilds with the current options unchanged', () => {
    const el = document.createElement('div');
    const gallery = new Gallery(el, { items: [{ id: 'a', src: 'a.jpg' }], loop: false });

    gallery.reinit();

    expect(gallery.items).toEqual([{ id: 'a', src: 'a.jpg' }]);
    gallery.open(0);
    gallery.next(); // loop:false, only one item — next() at the only item must not wrap
    expect(gallery.currentIndex).toBe(0);
    gallery.destroy();
  });

  it('passing options reconfigures structurally — e.g. switching to a new item list', () => {
    const el = document.createElement('div');
    const gallery = new Gallery(el, { items: [{ id: 'a', src: 'a.jpg' }] });

    gallery.reinit({
      items: [
        { id: 'x', src: 'x.jpg' },
        { id: 'y', src: 'y.jpg' },
      ],
    });

    expect(gallery.items).toEqual([
      { id: 'x', src: 'x.jpg' },
      { id: 'y', src: 'y.jpg' },
    ]);
    gallery.destroy();
  });

  it("re-runs every plugin's init(), calling the previous cleanup first", () => {
    const el = document.createElement('div');
    const { plugin, initCount, cleanup } = trackingPlugin();
    const gallery = new Gallery(el, { plugins: [plugin] });

    expect(initCount).toHaveBeenCalledTimes(1);
    expect(cleanup).not.toHaveBeenCalled();

    gallery.reinit();

    expect(cleanup).toHaveBeenCalledTimes(1); // old registration torn down
    expect(initCount).toHaveBeenCalledTimes(2); // re-registered fresh

    gallery.destroy();
    expect(cleanup).toHaveBeenCalledTimes(2);
  });

  it('does not survive host-registered gallery.on() listeners — the event bus is fully cleared', () => {
    const el = document.createElement('div');
    const gallery = new Gallery(el);
    const fn = vi.fn();
    gallery.on('afterOpen', fn);

    gallery.reinit();

    gallery.open(0);
    expect(fn).not.toHaveBeenCalled();
    gallery.destroy();
  });

  it('force-closes without a zoom-out animation if open when called', () => {
    const el = document.createElement('div');
    const gallery = new Gallery(el, { items: [{ id: 'a', src: 'a.jpg' }] });
    gallery.open(0);

    const dialog = document.querySelector('.shoji-outer.shoji-open');
    expect(dialog).not.toBeNull();

    gallery.reinit();

    expect(document.querySelector('.shoji-outer.shoji-open')).toBeNull();
    gallery.destroy();
  });

  it('resets activeIndex to 0 (or wherever openOnInit lands) rather than carrying over the old index', () => {
    const el = document.createElement('div');
    const gallery = new Gallery(el, {
      items: [
        { id: 'a', src: 'a.jpg' },
        { id: 'b', src: 'b.jpg' },
      ],
    });
    gallery.open(1);
    expect(gallery.currentIndex).toBe(1);

    gallery.reinit();
    expect(gallery.currentIndex).toBe(0);

    gallery.reinit({
      items: [
        { id: 'a', src: 'a.jpg' },
        { id: 'b', src: 'b.jpg' },
      ],
      openOnInit: true,
      index: 1,
    });
    expect(gallery.currentIndex).toBe(1);

    gallery.destroy();
  });

  it('is a no-op on an already-destroyed instance', () => {
    const el = document.createElement('div');
    const gallery = new Gallery(el);
    gallery.destroy();

    expect(() => gallery.reinit()).not.toThrow();
    expect(Gallery.getInstance(el)).toBeUndefined(); // still gone, not resurrected
  });

  it('switching from selector mode to dynamic mode removes the old container click listener', () => {
    const el = document.createElement('div');
    el.innerHTML = `<a href="a.jpg"><img src="thumb-a.jpg"></a>`;
    document.body.appendChild(el);
    const gallery = new Gallery(el); // selector mode — scans the <a>

    expect(gallery.items).toHaveLength(1);

    gallery.reinit({ items: [{ id: 'x', src: 'x.jpg' }] }); // now dynamic mode

    // A click on the old scanned anchor must not open the gallery anymore —
    // the selector-mode click listener should have been torn down. (Not
    // just checking currentIndex === 0 — that's also the default value a
    // never-opened gallery would show, so it alone wouldn't prove the click
    // was actually ignored.)
    el.querySelector('a')!.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    );
    expect(document.querySelector('.shoji-outer.shoji-open')).toBeNull();

    gallery.destroy();
    el.remove();
  });
});
