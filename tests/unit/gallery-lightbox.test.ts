import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Gallery } from '../../src/core';

beforeEach(() => {
  HTMLImageElement.prototype.decode = vi.fn().mockResolvedValue(undefined);
});

afterEach(() => {
  // @ts-expect-error - removing the test-only stub added above
  delete HTMLImageElement.prototype.decode;
  document.body.innerHTML = '';
});

function makeGallery(count = 5, options: Record<string, unknown> = {}) {
  const el = document.createElement('div');
  const items = Array.from({ length: count }, (_, i) => ({
    id: `item-${i}`,
    src: `${i}.jpg`,
    alt: `Photo ${i}`,
  }));
  return new Gallery(el, { items, ...options });
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('Gallery — lightbox DOM', () => {
  it('builds the dialog with role/aria-modal on first open, appended to body', () => {
    const gallery = makeGallery();
    gallery.open(0);

    const dialog = document.querySelector('.shoji-dialog');
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute('role')).toBe('dialog');
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(document.querySelector('.shoji-outer.shoji-open')).not.toBeNull();

    gallery.destroy();
  });

  it('reuses the same DOM across close/reopen instead of rebuilding', () => {
    const gallery = makeGallery();
    gallery.open(0);
    const dialog1 = document.querySelector('.shoji-dialog');
    gallery.close();
    gallery.open(1);
    const dialog2 = document.querySelector('.shoji-dialog');

    expect(dialog2).toBe(dialog1);
    gallery.destroy();
  });

  it('close() hides the outer element but leaves it in the DOM', () => {
    const gallery = makeGallery();
    gallery.open(0);
    gallery.close();

    const outer = document.querySelector('.shoji-outer');
    expect(outer).not.toBeNull();
    expect(outer?.classList.contains('shoji-open')).toBe(false);
    gallery.destroy();
  });

  it('destroy() removes the lightbox DOM entirely', () => {
    const gallery = makeGallery();
    gallery.open(0);
    gallery.destroy();

    expect(document.querySelector('.shoji-outer')).toBeNull();
  });

  it('updates counter and caption text on open and navigate', () => {
    const el = document.createElement('div');
    const gallery = new Gallery(el, {
      items: [
        { id: 'a', src: 'a.jpg', caption: 'First' },
        { id: 'b', src: 'b.jpg', caption: 'Second' },
      ],
    });

    gallery.open(0);
    expect(document.querySelector('.shoji-counter')?.textContent).toBe('1 / 2');
    expect(document.querySelector('.shoji-caption')?.textContent).toBe('First');

    gallery.next();
    expect(document.querySelector('.shoji-counter')?.textContent).toBe('2 / 2');
    expect(document.querySelector('.shoji-caption')?.textContent).toBe('Second');

    gallery.destroy();
  });

  it('announces the live region text on open and navigate', () => {
    const gallery = makeGallery();
    gallery.open(1);

    const live = document.querySelector('.shoji-live-region');
    expect(live?.textContent).toBe('Image 2 of 5: Photo 1');

    gallery.next();
    expect(live?.textContent).toBe('Image 3 of 5: Photo 2');

    gallery.destroy();
  });
});

describe('Gallery — navigation', () => {
  it('next()/prev() move the active index and emit beforeSlide/afterSlide', () => {
    const gallery = makeGallery();
    gallery.open(1);

    const before = vi.fn();
    const after = vi.fn();
    gallery.on('beforeSlide', before);
    gallery.on('afterSlide', after);

    gallery.next();
    expect(gallery.currentIndex).toBe(2);
    expect(before).toHaveBeenCalledWith({ from: 1, to: 2 });
    expect(after).toHaveBeenCalledWith({ from: 1, to: 2 });

    gallery.prev();
    expect(gallery.currentIndex).toBe(1);

    gallery.destroy();
  });

  it('wraps past the last item to the first by default (loop: true)', () => {
    const gallery = makeGallery(3);
    gallery.open(2);
    const after = vi.fn();
    gallery.on('afterSlide', after);

    gallery.next();

    expect(gallery.currentIndex).toBe(0);
    expect(after).toHaveBeenCalledWith({ from: 2, to: 0 });
    gallery.destroy();
  });

  it('wraps past the first item to the last by default (loop: true)', () => {
    const gallery = makeGallery(3);
    gallery.open(0);
    const after = vi.fn();
    gallery.on('afterSlide', after);

    gallery.prev();

    expect(gallery.currentIndex).toBe(2);
    expect(after).toHaveBeenCalledWith({ from: 0, to: 2 });
    gallery.destroy();
  });

  it('clamps at the last item and does not wrap with loop: false', () => {
    const gallery = makeGallery(3, { loop: false });
    gallery.open(2);
    const after = vi.fn();
    gallery.on('afterSlide', after);

    gallery.next();

    expect(gallery.currentIndex).toBe(2);
    expect(after).not.toHaveBeenCalled();
    gallery.destroy();
  });

  it('clamps at the first item and does not wrap with loop: false', () => {
    const gallery = makeGallery(3, { loop: false });
    gallery.open(0);
    const after = vi.fn();
    gallery.on('afterSlide', after);

    gallery.prev();

    expect(gallery.currentIndex).toBe(0);
    expect(after).not.toHaveBeenCalled();
    gallery.destroy();
  });

  it('goTo/next/prev are no-ops while closed', () => {
    const gallery = makeGallery();
    gallery.goTo(3);
    expect(gallery.currentIndex).toBe(0);
    gallery.destroy();
  });

  it('emits slideItemLoad after the active slide settles', async () => {
    const gallery = makeGallery();
    const loaded = vi.fn();
    gallery.on('slideItemLoad', loaded);

    gallery.open(0);
    await flush();

    expect(loaded).toHaveBeenCalledWith({ index: 0 });
    gallery.destroy();
  });
});

describe('Gallery — keyboard navigation', () => {
  function press(key: string, shiftKey = false): void {
    document.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true }));
  }

  it('Escape closes the gallery', () => {
    const gallery = makeGallery();
    gallery.open(0);
    press('Escape');
    expect(document.querySelector('.shoji-outer.shoji-open')).toBeNull();
    gallery.destroy();
  });

  it('ArrowRight/ArrowLeft navigate', () => {
    const gallery = makeGallery();
    gallery.open(1);
    press('ArrowRight');
    expect(gallery.currentIndex).toBe(2);
    press('ArrowLeft');
    expect(gallery.currentIndex).toBe(1);
    gallery.destroy();
  });

  it('ignores ArrowLeft/ArrowRight/Home/End while a video has focus, but Escape still closes', () => {
    // jsdom doesn't support focusing <video> at all (confirmed: .focus() is a
    // silent no-op, activeElement never changes) — a documented gap, same
    // category as the media-loading limitations elsewhere in this suite.
    // Force document.activeElement directly to unit-test the guard's logic;
    // real-browser video-focus behavior is covered by e2e instead.
    const el = document.createElement('div');
    const gallery = new Gallery(el, {
      items: [
        { id: 'a', src: 'a.jpg' },
        { id: 'vid', src: 'v.mp4', video: { provider: 'html5' }, poster: 'poster.jpg' },
        { id: 'c', src: 'c.jpg' },
      ],
    });
    gallery.open(1);
    const video = document.querySelector('.shoji-slide-video') as HTMLVideoElement;
    // This creates an *own* property on the document instance, shadowing the
    // real inherited getter — deleting it afterward (not "restoring" a saved
    // descriptor) is what un-shadows it and brings back real behavior.
    Object.defineProperty(document, 'activeElement', { value: video, configurable: true });

    try {
      press('ArrowRight');
      press('ArrowLeft');
      press('Home');
      press('End');
      expect(gallery.currentIndex).toBe(1); // unchanged — the video owns these keys while focused

      press('Escape');
      expect(document.querySelector('.shoji-outer.shoji-open')).toBeNull();
    } finally {
      delete (document as { activeElement?: unknown }).activeElement;
    }
    gallery.destroy();
  });

  it('Home/End jump to the first/last item', () => {
    const gallery = makeGallery(5);
    gallery.open(2);
    press('End');
    expect(gallery.currentIndex).toBe(4);
    press('Home');
    expect(gallery.currentIndex).toBe(0);
    gallery.destroy();
  });

  it('stops responding to keys after close', () => {
    const gallery = makeGallery();
    gallery.open(1);
    gallery.close();
    press('ArrowRight');
    expect(gallery.currentIndex).toBe(1);
    gallery.destroy();
  });
});

describe('Gallery — focus management', () => {
  it('moves focus into the dialog on open and restores it on close', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();

    const gallery = makeGallery();
    gallery.open(0);
    expect(document.activeElement).toBe(document.querySelector('.shoji-dialog'));

    gallery.close();
    expect(document.activeElement).toBe(trigger);

    gallery.destroy();
  });
});

describe('Gallery — updateSlides while open', () => {
  it('re-renders the current slide when the item list changes', () => {
    const el = document.createElement('div');
    const gallery = new Gallery(el, {
      items: [
        { id: 'a', src: 'a.jpg', caption: 'A' },
        { id: 'b', src: 'b.jpg', caption: 'B' },
      ],
    });
    gallery.open(1); // active item "b"

    gallery.updateSlides([
      { id: 'b', src: 'b.jpg', caption: 'B' },
      { id: 'a', src: 'a.jpg', caption: 'A' },
    ]);

    expect(gallery.currentIndex).toBe(0); // "b" preserved at its new index
    expect(document.querySelector('.shoji-caption')?.textContent).toBe('B');

    gallery.destroy();
  });
});
