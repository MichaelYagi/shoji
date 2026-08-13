import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Gallery } from '../../src/core';

// open() now renders real lightbox DOM into document.body — stub decode()
// (jsdom doesn't implement it) and reset body so tests don't leak into each other.
beforeEach(() => {
  HTMLImageElement.prototype.decode = vi.fn().mockResolvedValue(undefined);
});

afterEach(() => {
  // @ts-expect-error - removing the test-only stub added above
  delete HTMLImageElement.prototype.decode;
  document.body.innerHTML = '';
});

function container(html: string): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = html;
  return el;
}

describe('Gallery — selector mode', () => {
  it('scans items from the DOM using the default selector', () => {
    const el = container(`
      <a href="full-1.jpg"><img src="thumb-1.jpg" alt="One"></a>
      <a href="full-2.jpg"><img src="thumb-2.jpg" alt="Two"></a>
    `);
    const gallery = new Gallery(el);

    expect(gallery.items).toHaveLength(2);
    expect(gallery.items[0]).toMatchObject({ src: 'full-1.jpg' });
  });

  it('resolves a string target against document.querySelector', () => {
    const wrapper = document.createElement('div');
    wrapper.id = 'string-target-gallery';
    wrapper.innerHTML = '<a href="full.jpg"><img src="thumb.jpg"></a>';
    document.body.appendChild(wrapper);

    try {
      const gallery = new Gallery('#string-target-gallery');
      expect(gallery.element).toBe(wrapper);
      expect(gallery.items).toHaveLength(1);
    } finally {
      wrapper.remove();
    }
  });

  it('throws when a string target matches nothing', () => {
    expect(() => new Gallery('#does-not-exist')).toThrow(/no element matches/);
  });

  it('opens at the clicked item index and prevents default navigation', () => {
    const el = container(`
      <a href="full-1.jpg"><img src="thumb-1.jpg"></a>
      <a href="full-2.jpg"><img src="thumb-2.jpg"></a>
    `);
    const gallery = new Gallery(el);
    const opened = vi.fn();
    gallery.on('afterOpen', opened);

    const secondAnchor = el.querySelectorAll('a')[1]!;
    const img = secondAnchor.querySelector('img')!;
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    img.dispatchEvent(event);

    expect(opened).toHaveBeenCalledWith({ index: 1 });
    expect(gallery.currentIndex).toBe(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('ignores clicks outside any matched item', () => {
    const el = container(`<a href="full-1.jpg"><img src="thumb-1.jpg"></a>`);
    const gallery = new Gallery(el);
    const opened = vi.fn();
    gallery.on('afterOpen', opened);

    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(opened).not.toHaveBeenCalled();
  });

  it('removes the click listener on destroy', () => {
    const el = container(`<a href="full-1.jpg"><img src="thumb-1.jpg"></a>`);
    const gallery = new Gallery(el);
    const opened = vi.fn();
    gallery.on('afterOpen', opened);
    gallery.destroy();

    el.querySelector('img')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(opened).not.toHaveBeenCalled();
  });

  it('refresh() rescans the DOM and diffs via the same path as updateSlides', () => {
    const el = container(`<a href="full-1.jpg" data-shoji-id="a"><img src="thumb-1.jpg"></a>`);
    const gallery = new Gallery(el);
    gallery.open(0);

    const newAnchor = document.createElement('a');
    newAnchor.href = 'full-0.jpg';
    newAnchor.dataset.shojiId = 'new';
    el.prepend(newAnchor);

    gallery.refresh();

    expect(gallery.items.map((i) => i.id)).toEqual(['new', 'a']);
    expect(gallery.currentIndex).toBe(1); // active item "a" preserved at its new index
  });
});

describe('Gallery — dynamic mode', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses the provided items array and does not scan the DOM', () => {
    const el = document.createElement('div');
    el.innerHTML = '<a href="ignored.jpg"><img src="ignored-thumb.jpg"></a>';
    const gallery = new Gallery(el, { items: [{ src: 'a.jpg' }, { src: 'b.jpg' }] });

    expect(gallery.items).toEqual([{ src: 'a.jpg' }, { src: 'b.jpg' }]);
  });

  it('does not auto-open on click', () => {
    const el = document.createElement('div');
    const gallery = new Gallery(el, { items: [{ src: 'a.jpg' }] });
    const opened = vi.fn();
    gallery.on('afterOpen', opened);

    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(opened).not.toHaveBeenCalled();
  });

  it('refresh() is a no-op with a console warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const el = document.createElement('div');
    const gallery = new Gallery(el, { items: [{ src: 'a.jpg' }] });

    gallery.refresh();

    expect(gallery.items).toEqual([{ src: 'a.jpg' }]);
    expect(warn).toHaveBeenCalledOnce();
  });

  it('updateSlides preserves the active slide by id when it persists', () => {
    const el = document.createElement('div');
    const gallery = new Gallery(el, {
      items: [
        { id: 'x', src: 'x.jpg' },
        { id: 'y', src: 'y.jpg' },
      ],
    });
    gallery.open(1); // active item is "y"

    gallery.updateSlides([
      { id: 'z', src: 'z.jpg' },
      { id: 'y', src: 'y.jpg' },
      { id: 'x', src: 'x.jpg' },
    ]);

    expect(gallery.currentIndex).toBe(1); // "y" is now at index 1
  });

  it('updateSlides clamps to the new length when the active item is gone and no index is given', () => {
    const el = document.createElement('div');
    const gallery = new Gallery(el, {
      items: [
        { id: 'x', src: 'x.jpg' },
        { id: 'y', src: 'y.jpg' },
      ],
    });
    gallery.open(1);

    gallery.updateSlides([{ id: 'a', src: 'a.jpg' }]);

    expect(gallery.currentIndex).toBe(0);
  });

  it('updateSlides emits itemsUpdated', () => {
    const el = document.createElement('div');
    const gallery = new Gallery(el, { items: [] });
    const handler = vi.fn();
    gallery.on('itemsUpdated', handler);

    const items = [{ src: 'a.jpg' }];
    gallery.updateSlides(items);

    expect(handler).toHaveBeenCalledWith({ items });
  });
});

describe('Gallery — dynamic mode: YouTube video.id auto-fill from src', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('leaves an explicit video.id untouched, even if src would parse to a different id', () => {
    const el = document.createElement('div');
    const gallery = new Gallery(el, {
      items: [
        {
          id: 'a',
          src: 'https://youtu.be/wrong-id',
          video: { provider: 'youtube', id: 'right-id' },
        },
      ],
    });

    expect(gallery.items[0]?.video).toEqual({ provider: 'youtube', id: 'right-id' });
  });

  it('fills in video.id from src when missing and the URL is a recognized YouTube link', () => {
    const el = document.createElement('div');
    const gallery = new Gallery(el, {
      items: [{ id: 'a', src: 'https://youtu.be/dQw4w9WgXcQ', video: { provider: 'youtube' } }],
    });

    expect(gallery.items[0]?.video).toEqual({ provider: 'youtube', id: 'dQw4w9WgXcQ' });
  });

  it('warns and leaves video.id unset when missing and src is not a recognized YouTube link', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const el = document.createElement('div');
    const gallery = new Gallery(el, {
      items: [{ id: 'a', src: 'not-a-youtube-url.mp4', video: { provider: 'youtube' } }],
    });

    expect(gallery.items[0]?.video).toEqual({ provider: 'youtube' });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(/item "a".*no id.*not-a-youtube-url\.mp4/);
  });

  it('does not touch html5 or plain photo items', () => {
    const el = document.createElement('div');
    const gallery = new Gallery(el, {
      items: [
        { id: 'a', src: 'clip.mp4', video: { provider: 'html5' } },
        { id: 'b', src: 'photo.jpg' },
      ],
    });

    expect(gallery.items[0]?.video).toEqual({ provider: 'html5' });
    expect(gallery.items[1]?.video).toBeUndefined();
  });

  it('also fills in on updateSlides(), not just construction', () => {
    const el = document.createElement('div');
    const gallery = new Gallery(el, { items: [] });

    gallery.updateSlides([
      { id: 'a', src: 'https://youtu.be/dQw4w9WgXcQ', video: { provider: 'youtube' } },
    ]);

    expect(gallery.items[0]?.video).toEqual({ provider: 'youtube', id: 'dQw4w9WgXcQ' });
  });
});

describe('Gallery — dynamic mode: Vimeo video.id auto-fill from src', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('leaves an explicit video.id untouched, even if src would parse to a different id', () => {
    const el = document.createElement('div');
    const gallery = new Gallery(el, {
      items: [
        {
          id: 'a',
          src: 'https://vimeo.com/00000000',
          video: { provider: 'vimeo', id: '76979871' },
        },
      ],
    });

    expect(gallery.items[0]?.video).toEqual({ provider: 'vimeo', id: '76979871' });
  });

  it('fills in video.id from src when missing and the URL is a recognized Vimeo link', () => {
    const el = document.createElement('div');
    const gallery = new Gallery(el, {
      items: [{ id: 'a', src: 'https://vimeo.com/76979871', video: { provider: 'vimeo' } }],
    });

    expect(gallery.items[0]?.video).toEqual({ provider: 'vimeo', id: '76979871' });
  });

  it('warns and leaves video.id unset when missing and src is not a recognized Vimeo link', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const el = document.createElement('div');
    const gallery = new Gallery(el, {
      items: [{ id: 'a', src: 'not-a-vimeo-url.mp4', video: { provider: 'vimeo' } }],
    });

    expect(gallery.items[0]?.video).toEqual({ provider: 'vimeo' });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(/item "a".*no id.*not-a-vimeo-url\.mp4/);
  });

  it('also fills in on updateSlides(), not just construction', () => {
    const el = document.createElement('div');
    const gallery = new Gallery(el, { items: [] });

    gallery.updateSlides([
      { id: 'a', src: 'https://vimeo.com/76979871', video: { provider: 'vimeo' } },
    ]);

    expect(gallery.items[0]?.video).toEqual({ provider: 'vimeo', id: '76979871' });
  });
});

describe('Gallery — dynamic mode: video: true (full inference from src)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves to a youtube descriptor when src is a recognized YouTube URL', () => {
    const el = document.createElement('div');
    const gallery = new Gallery(el, {
      items: [{ id: 'a', src: 'https://youtu.be/dQw4w9WgXcQ', video: true }],
    });

    expect(gallery.items[0]?.video).toEqual({ provider: 'youtube', id: 'dQw4w9WgXcQ' });
  });

  it('resolves to a vimeo descriptor when src is a recognized Vimeo URL', () => {
    const el = document.createElement('div');
    const gallery = new Gallery(el, {
      items: [{ id: 'a', src: 'https://vimeo.com/76979871', video: true }],
    });

    expect(gallery.items[0]?.video).toEqual({ provider: 'vimeo', id: '76979871' });
  });

  it('resolves to html5 when src is not a recognized YouTube or Vimeo URL', () => {
    const el = document.createElement('div');
    const gallery = new Gallery(el, {
      items: [{ id: 'a', src: 'clips/sunset.mp4', video: true }],
    });

    expect(gallery.items[0]?.video).toEqual({ provider: 'html5' });
  });

  it('warns when src is a YouTube host but no id could be parsed out of it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const el = document.createElement('div');
    const gallery = new Gallery(el, {
      items: [{ id: 'a', src: 'https://youtube.com/attribution_link?u=weird', video: true }],
    });

    expect(gallery.items[0]?.video).toEqual({ provider: 'youtube', id: undefined });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(/item "a".*video: true.*attribution_link/);
  });

  it('also resolves on updateSlides(), not just construction', () => {
    const el = document.createElement('div');
    const gallery = new Gallery(el, { items: [] });

    gallery.updateSlides([{ id: 'a', src: 'https://youtu.be/dQw4w9WgXcQ', video: true }]);

    expect(gallery.items[0]?.video).toEqual({ provider: 'youtube', id: 'dQw4w9WgXcQ' });
  });
});

describe('Gallery — addSlides/removeSlides (sugar over updateSlides)', () => {
  it('addSlides appends at the end by default', () => {
    const el = document.createElement('div');
    const gallery = new Gallery(el, { items: [{ id: 'a', src: 'a.jpg' }] });

    gallery.addSlides([
      { id: 'b', src: 'b.jpg' },
      { id: 'c', src: 'c.jpg' },
    ]);

    expect(gallery.items.map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });

  it('addSlides inserts at an explicit index, preserving the active slide by id like updateSlides does', () => {
    const el = document.createElement('div');
    const gallery = new Gallery(el, {
      items: [
        { id: 'a', src: 'a.jpg' },
        { id: 'b', src: 'b.jpg' },
      ],
    });
    gallery.open(1); // active item is "b"

    gallery.addSlides([{ id: 'new', src: 'new.jpg' }], 0);

    expect(gallery.items.map((i) => i.id)).toEqual(['new', 'a', 'b']);
    expect(gallery.currentIndex).toBe(2); // "b" shifted, still the active one
  });

  it('removeSlides matches by id (falling back to src, same key updateSlides uses)', () => {
    const el = document.createElement('div');
    const gallery = new Gallery(el, {
      items: [
        { id: 'a', src: 'a.jpg' },
        { src: 'b.jpg' }, // no id — matched by src
        { id: 'c', src: 'c.jpg' },
      ],
    });

    gallery.removeSlides(['a', 'b.jpg']);

    expect(gallery.items.map((i) => i.id ?? i.src)).toEqual(['c']);
  });

  it('removeSlides matches by index, resolved against the list before any removal (not shifted mid-removal)', () => {
    const el = document.createElement('div');
    const gallery = new Gallery(el, {
      items: [
        { id: 'a', src: 'a.jpg' },
        { id: 'b', src: 'b.jpg' },
        { id: 'c', src: 'c.jpg' },
      ],
    });

    gallery.removeSlides([0, 1]); // "first two", not "index 0 then the new index 1"

    expect(gallery.items.map((i) => i.id)).toEqual(['c']);
  });

  it('removeSlides accepts a single id or index, not just an array', () => {
    const el = document.createElement('div');
    const gallery = new Gallery(el, {
      items: [
        { id: 'a', src: 'a.jpg' },
        { id: 'b', src: 'b.jpg' },
      ],
    });

    gallery.removeSlides('a');
    expect(gallery.items.map((i) => i.id)).toEqual(['b']);

    gallery.removeSlides(0);
    expect(gallery.items).toHaveLength(0);
  });

  it('both emit itemsUpdated, same as updateSlides', () => {
    const el = document.createElement('div');
    const gallery = new Gallery(el, { items: [{ id: 'a', src: 'a.jpg' }] });
    const handler = vi.fn();
    gallery.on('itemsUpdated', handler);

    gallery.addSlides([{ id: 'b', src: 'b.jpg' }]);
    gallery.removeSlides('a');

    expect(handler).toHaveBeenCalledTimes(2);
  });
});
