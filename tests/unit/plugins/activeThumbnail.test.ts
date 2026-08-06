import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Gallery } from '../../../src/core';
import { ActiveThumbnail } from '../../../src/plugins/activeThumbnail';

beforeEach(() => {
  HTMLImageElement.prototype.decode = vi.fn().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  // @ts-expect-error - removing the test-only stub added above
  delete HTMLImageElement.prototype.decode;
  document.body.innerHTML = '';
});

function makeSelectorGallery(options: Record<string, unknown> = {}): {
  gallery: Gallery;
  thumbs: HTMLAnchorElement[];
} {
  const el = document.createElement('div');
  el.innerHTML = `
    <a href="a.jpg"><img src="a-thumb.jpg" /></a>
    <a href="b.jpg"><img src="b-thumb.jpg" /></a>
    <a href="c.jpg"><img src="c-thumb.jpg" /></a>
  `;
  document.body.appendChild(el);
  const gallery = new Gallery(el, { plugins: [ActiveThumbnail], preload: 0, ...options });
  const thumbs = [...el.querySelectorAll<HTMLAnchorElement>('a')];
  return { gallery, thumbs };
}

describe('ActiveThumbnail plugin', () => {
  it('marks the origin thumbnail for the opened index, and only that one', () => {
    const { gallery, thumbs } = makeSelectorGallery();
    gallery.open(1);

    expect(thumbs[0]!.classList.contains('shoji-thumb-active')).toBe(false);
    expect(thumbs[1]!.classList.contains('shoji-thumb-active')).toBe(true);
    expect(thumbs[2]!.classList.contains('shoji-thumb-active')).toBe(false);
    gallery.destroy();
  });

  it('moves the active class as the slide changes via next()/prev()/goTo()', () => {
    const { gallery, thumbs } = makeSelectorGallery();
    gallery.open(0);
    expect(thumbs[0]!.classList.contains('shoji-thumb-active')).toBe(true);

    gallery.next();
    expect(thumbs[0]!.classList.contains('shoji-thumb-active')).toBe(false);
    expect(thumbs[1]!.classList.contains('shoji-thumb-active')).toBe(true);

    gallery.goTo(2, { animate: false });
    expect(thumbs[1]!.classList.contains('shoji-thumb-active')).toBe(false);
    expect(thumbs[2]!.classList.contains('shoji-thumb-active')).toBe(true);

    gallery.prev();
    expect(thumbs[2]!.classList.contains('shoji-thumb-active')).toBe(false);
    expect(thumbs[1]!.classList.contains('shoji-thumb-active')).toBe(true);
    gallery.destroy();
  });

  it('clears the active class on close(), and re-applies it on the next open()', () => {
    const { gallery, thumbs } = makeSelectorGallery();
    gallery.open(1);
    expect(thumbs[1]!.classList.contains('shoji-thumb-active')).toBe(true);

    gallery.close();
    expect(thumbs[1]!.classList.contains('shoji-thumb-active')).toBe(false);

    gallery.open(2);
    expect(thumbs[2]!.classList.contains('shoji-thumb-active')).toBe(true);
    gallery.destroy();
  });

  it('scrolls the active thumbnail into view by default', () => {
    const { gallery, thumbs } = makeSelectorGallery();
    const spy = vi.spyOn(thumbs[1]!, 'scrollIntoView');
    gallery.open(1);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ block: 'nearest' }));
    gallery.destroy();
  });

  it('scrollIntoView: false disables the auto-scroll but still highlights', () => {
    const { gallery, thumbs } = makeSelectorGallery({ activeThumbnail: { scrollIntoView: false } });
    const spy = vi.spyOn(thumbs[1]!, 'scrollIntoView');
    gallery.open(1);
    expect(spy).not.toHaveBeenCalled();
    expect(thumbs[1]!.classList.contains('shoji-thumb-active')).toBe(true);
    gallery.destroy();
  });

  it('a custom activeClass is used instead of the default', () => {
    const { gallery, thumbs } = makeSelectorGallery({
      activeThumbnail: { activeClass: 'my-active' },
    });
    gallery.open(0);
    expect(thumbs[0]!.classList.contains('my-active')).toBe(true);
    expect(thumbs[0]!.classList.contains('shoji-thumb-active')).toBe(false);
    gallery.destroy();
  });

  it('works in dynamic mode via data-shoji-id markers, same as the zoom transition', () => {
    const mount = document.createElement('div');
    const marker = document.createElement('div');
    marker.setAttribute('data-shoji-id', 'x');
    document.body.append(mount, marker);

    const gallery = new Gallery(mount, {
      items: [{ id: 'x', src: 'x.jpg' }],
      plugins: [ActiveThumbnail],
      preload: 0,
    });
    gallery.open(0);

    expect(marker.classList.contains('shoji-thumb-active')).toBe(true);
    gallery.destroy();
  });

  it('destroy() clears the active class (no leak onto a torn-down gallery thumbnail)', () => {
    const { gallery, thumbs } = makeSelectorGallery();
    gallery.open(1);
    expect(thumbs[1]!.classList.contains('shoji-thumb-active')).toBe(true);

    gallery.destroy();
    expect(thumbs[1]!.classList.contains('shoji-thumb-active')).toBe(false);
  });

  it('does nothing (no crash) when no origin element exists for the index', () => {
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const gallery = new Gallery(mount, {
      items: [{ id: 'x', src: 'x.jpg' }],
      plugins: [ActiveThumbnail],
      preload: 0,
    });

    expect(() => gallery.open(0)).not.toThrow();
    gallery.destroy();
  });
});
