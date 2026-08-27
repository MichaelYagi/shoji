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

  it('persists the active class after close() — the whole point is seeing which thumbnail you were just looking at once the lightbox (and its backdrop) is out of the way — and moves it once a different slide becomes active on the next open()', () => {
    const { gallery, thumbs } = makeSelectorGallery();
    gallery.open(1);
    expect(thumbs[1]!.classList.contains('shoji-thumb-active')).toBe(true);

    gallery.close();
    expect(thumbs[1]!.classList.contains('shoji-thumb-active')).toBe(true);

    gallery.open(2);
    expect(thumbs[1]!.classList.contains('shoji-thumb-active')).toBe(false);
    expect(thumbs[2]!.classList.contains('shoji-thumb-active')).toBe(true);
    gallery.destroy();
  });

  it('scrolls the active thumbnail into view by default, debounced by 80ms', () => {
    vi.useFakeTimers();
    const { gallery, thumbs } = makeSelectorGallery();
    const spy = vi.spyOn(thumbs[1]!, 'scrollIntoView');
    gallery.open(1);
    expect(spy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(80);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ block: 'nearest' }));
    gallery.destroy();
    vi.useRealTimers();
  });

  it('scrollIntoView: false disables the auto-scroll but still highlights', () => {
    vi.useFakeTimers();
    const { gallery, thumbs } = makeSelectorGallery({ activeThumbnail: { scrollIntoView: false } });
    const spy = vi.spyOn(thumbs[1]!, 'scrollIntoView');
    gallery.open(1);
    vi.advanceTimersByTime(80);
    expect(spy).not.toHaveBeenCalled();
    expect(thumbs[1]!.classList.contains('shoji-thumb-active')).toBe(true);
    gallery.destroy();
    vi.useRealTimers();
  });

  it('rapid-fire navigation coalesces into a single scrollIntoView call, for the final index only — regression: firing scrollIntoView synchronously on every step left overlapping/interrupted smooth-scroll animations that could visibly resolve later (e.g. on close), producing an unexplained scroll shift', () => {
    vi.useFakeTimers();
    const { gallery, thumbs } = makeSelectorGallery();
    gallery.open(0);
    const spy0 = vi.spyOn(thumbs[0]!, 'scrollIntoView');
    const spy1 = vi.spyOn(thumbs[1]!, 'scrollIntoView');
    const spy2 = vi.spyOn(thumbs[2]!, 'scrollIntoView');
    vi.advanceTimersByTime(80);
    spy0.mockClear();

    // navigate faster than the 80ms debounce window can settle
    gallery.goTo(1, { animate: false });
    vi.advanceTimersByTime(30);
    gallery.goTo(2, { animate: false });
    vi.advanceTimersByTime(80);

    expect(spy0).not.toHaveBeenCalled();
    expect(spy1).not.toHaveBeenCalled();
    expect(spy2).toHaveBeenCalledTimes(1);
    gallery.destroy();
    vi.useRealTimers();
  });

  it('close() flushes a still-pending debounced scroll immediately, synchronously, instead of dropping it or letting the timer run out after close — regression: an earlier version dropped it outright, so a navigation immediately followed by close (routine at normal clicking speed) silently never scrolled to where the viewer actually ended up', () => {
    vi.useFakeTimers();
    const { gallery, thumbs } = makeSelectorGallery();
    gallery.open(1);
    const spy = vi.spyOn(thumbs[1]!, 'scrollIntoView');
    vi.advanceTimersByTime(80);
    spy.mockClear();

    gallery.goTo(2, { animate: false });
    const spy2 = vi.spyOn(thumbs[2]!, 'scrollIntoView');
    gallery.close();

    // Synchronous, not "eventually" — close() itself must run it, not the
    // timer firing naturally some tens of ms later (that's the *other*
    // failure mode this guards against: the page visibly scrolling on its
    // own after the lightbox is already gone).
    expect(spy2).toHaveBeenCalledTimes(1);
    gallery.destroy();
    vi.useRealTimers();
  });

  it('close() does not scroll a second time if the pending scroll had already fired naturally before close', () => {
    vi.useFakeTimers();
    const { gallery, thumbs } = makeSelectorGallery();
    gallery.open(1);
    vi.advanceTimersByTime(80);
    const spy = vi.spyOn(thumbs[1]!, 'scrollIntoView');

    gallery.close();
    expect(spy).not.toHaveBeenCalled();
    gallery.destroy();
    vi.useRealTimers();
  });

  it('close() does not scroll at all when scrollIntoView: false, even with a navigation immediately beforehand', () => {
    vi.useFakeTimers();
    const { gallery, thumbs } = makeSelectorGallery({ activeThumbnail: { scrollIntoView: false } });
    gallery.open(1);
    gallery.goTo(2, { animate: false });
    const spy = vi.spyOn(thumbs[2]!, 'scrollIntoView');
    gallery.close();

    expect(spy).not.toHaveBeenCalled();
    gallery.destroy();
    vi.useRealTimers();
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

  it('highlight: false (the default) never adds the styled class or the border-color var', () => {
    const { gallery, thumbs } = makeSelectorGallery();
    gallery.open(0);
    expect(thumbs[0]!.classList.contains('shoji-thumb-active--highlight')).toBe(false);
    expect(thumbs[0]!.style.getPropertyValue('--shoji-active-thumbnail-border-color')).toBe('');
    gallery.destroy();
  });

  it('highlight: true adds a fixed styled class and sets --shoji-active-thumbnail-border-color, defaulting to blue', () => {
    const { gallery, thumbs } = makeSelectorGallery({ activeThumbnail: { highlight: true } });
    gallery.open(0);
    expect(thumbs[0]!.classList.contains('shoji-thumb-active--highlight')).toBe(true);
    expect(thumbs[0]!.style.getPropertyValue('--shoji-active-thumbnail-border-color')).toBe('blue');
    gallery.destroy();
  });

  it('highlight: true with a custom borderColor sets the var to that color', () => {
    const { gallery, thumbs } = makeSelectorGallery({
      activeThumbnail: { highlight: true, borderColor: 'red' },
    });
    gallery.open(0);
    expect(thumbs[0]!.style.getPropertyValue('--shoji-active-thumbnail-border-color')).toBe('red');
    gallery.destroy();
  });

  it('highlight: true moves the styled class along with activeClass as the slide changes', () => {
    const { gallery, thumbs } = makeSelectorGallery({ activeThumbnail: { highlight: true } });
    gallery.open(0);
    expect(thumbs[0]!.classList.contains('shoji-thumb-active--highlight')).toBe(true);

    gallery.next();
    expect(thumbs[0]!.classList.contains('shoji-thumb-active--highlight')).toBe(false);
    expect(thumbs[1]!.classList.contains('shoji-thumb-active--highlight')).toBe(true);
    gallery.destroy();
  });

  it('highlight: true persists the styled class after close() (same reasoning as activeClass — it needs to be visible once the backdrop is gone), and destroy() still removes it for real', () => {
    const { gallery, thumbs } = makeSelectorGallery({ activeThumbnail: { highlight: true } });
    gallery.open(0);
    gallery.close();
    expect(thumbs[0]!.classList.contains('shoji-thumb-active--highlight')).toBe(true);
    gallery.destroy();
    expect(thumbs[0]!.classList.contains('shoji-thumb-active--highlight')).toBe(false);
  });

  it('highlightDuration: undefined (the default) never fades the border color, however long after close()', () => {
    vi.useFakeTimers();
    const { gallery, thumbs } = makeSelectorGallery({ activeThumbnail: { highlight: true } });
    gallery.open(0);
    gallery.close();
    vi.advanceTimersByTime(60_000);
    expect(thumbs[0]!.style.getPropertyValue('--shoji-active-thumbnail-border-color')).toBe('blue');
    gallery.destroy();
    vi.useRealTimers();
  });

  it('highlightDuration fades the border color to transparent that many ms after close() — counted from close, not from whenever the slide became active, since the highlight is hidden behind the backdrop until then', () => {
    vi.useFakeTimers();
    const { gallery, thumbs } = makeSelectorGallery({
      activeThumbnail: { highlight: true, highlightDuration: 5000 },
    });
    gallery.open(0);
    vi.advanceTimersByTime(4000); // time passes *while open* — must not count
    gallery.close();

    vi.advanceTimersByTime(4999);
    expect(thumbs[0]!.style.getPropertyValue('--shoji-active-thumbnail-border-color')).toBe('blue');

    vi.advanceTimersByTime(1);
    expect(thumbs[0]!.style.getPropertyValue('--shoji-active-thumbnail-border-color')).toBe(
      'transparent',
    );
    // The highlight class itself, and activeClass, are untouched by the fade
    // — only the color changes.
    expect(thumbs[0]!.classList.contains('shoji-thumb-active--highlight')).toBe(true);
    expect(thumbs[0]!.classList.contains('shoji-thumb-active')).toBe(true);
    gallery.destroy();
    vi.useRealTimers();
  });

  it('highlightDuration: a pending fade is cancelled by reopening, and a fresh close() restarts the full countdown rather than continuing a stale one', () => {
    vi.useFakeTimers();
    const { gallery, thumbs } = makeSelectorGallery({
      activeThumbnail: { highlight: true, highlightDuration: 5000 },
    });
    gallery.open(0);
    gallery.close();
    vi.advanceTimersByTime(4000); // most of the way through the countdown

    gallery.open(0); // re-reveal — cancels the pending fade, resets the color
    expect(thumbs[0]!.style.getPropertyValue('--shoji-active-thumbnail-border-color')).toBe('blue');
    gallery.close();

    vi.advanceTimersByTime(4999); // old countdown would have fired by now
    expect(thumbs[0]!.style.getPropertyValue('--shoji-active-thumbnail-border-color')).toBe('blue');

    vi.advanceTimersByTime(1); // but the fresh one (from the second close) fires right on time
    expect(thumbs[0]!.style.getPropertyValue('--shoji-active-thumbnail-border-color')).toBe(
      'transparent',
    );
    gallery.destroy();
    vi.useRealTimers();
  });

  it('highlightDuration: navigating to a different slide before the fade fires cancels it, and the new slide starts fully visible (not transparent)', () => {
    vi.useFakeTimers();
    const { gallery, thumbs } = makeSelectorGallery({
      activeThumbnail: { highlight: true, highlightDuration: 5000 },
    });
    gallery.open(0);
    gallery.close();
    vi.advanceTimersByTime(4000);

    gallery.open(1); // a different index — cancels thumb 0's pending fade
    vi.advanceTimersByTime(2000); // old countdown (started at close()) would have fired by now
    expect(thumbs[0]!.style.getPropertyValue('--shoji-active-thumbnail-border-color')).toBe('blue');
    expect(thumbs[1]!.style.getPropertyValue('--shoji-active-thumbnail-border-color')).toBe('blue');
    gallery.destroy();
    vi.useRealTimers();
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
