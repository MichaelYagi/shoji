import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Gallery } from '../../src/core';
import * as zoomTransition from '../../src/core/zoomTransition';
import type * as ZoomTransitionModule from '../../src/core/zoomTransition';

// zoomIn's synchronous end-state is always transform:'none' (it kicks off a
// transition *toward* that value in the same call) — reading style.transform
// afterward can't tell us *which* origin rect was used to compute it. Spying
// on the call args (while still calling through to the real implementation,
// so its side effects and the deferred-close tests below stay real) lets us
// assert on origin identity directly instead of reverse-engineering it from CSS.
vi.mock('../../src/core/zoomTransition', async (importOriginal) => {
  const actual = await importOriginal<typeof ZoomTransitionModule>();
  return { zoomIn: vi.fn(actual.zoomIn), zoomOut: vi.fn(actual.zoomOut) };
});

const DEFAULT_RECT: DOMRect = {
  top: 0,
  left: 0,
  right: 100,
  bottom: 100,
  width: 100,
  height: 100,
  x: 0,
  y: 0,
  toJSON: () => ({}),
};

function mockRect(el: Element, rect: Partial<DOMRect>): void {
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({ ...DEFAULT_RECT, ...rect });
}

beforeEach(() => {
  HTMLImageElement.prototype.decode = vi.fn().mockResolvedValue(undefined);
  window.matchMedia = vi
    .fn()
    .mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia;
  vi.spyOn(window, 'getComputedStyle').mockReturnValue({
    transitionDuration: '300ms',
  } as CSSStyleDeclaration);
  // Global non-zero default so every element — including the slide-media
  // element, which doesn't exist until open() creates it, too late to mock
  // individually beforehand — has *some* size unless a test overrides it.
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(DEFAULT_RECT);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(zoomTransition.zoomIn).mockClear();
  vi.mocked(zoomTransition.zoomOut).mockClear();
  // @ts-expect-error - removing the test-only stub added above
  delete HTMLImageElement.prototype.decode;
  document.body.innerHTML = '';
});

function fireTransitionEnd(el: Element): void {
  const event = new Event('transitionend') as Event & { propertyName?: string };
  Object.defineProperty(event, 'propertyName', { value: 'transform' });
  el.dispatchEvent(event);
}

// preload: 0 keeps the pool to a single slide-media element, so
// `.shoji-slide-media` is unambiguous — with the default preload: 1, three
// pooled elements exist and a plain querySelector would grab the "prev"
// slot rather than necessarily the active one.
function activeMedia(): HTMLElement {
  return document.querySelector('.shoji-slide-media') as HTMLElement;
}

describe('Gallery — zoom transition origin lookup', () => {
  it('uses the scanned element in selector mode with no markup needed', () => {
    const el = document.createElement('div');
    el.innerHTML = `<a href="a.jpg"><img src="thumb-a.jpg"></a><a href="b.jpg"><img src="thumb-b.jpg"></a>`;
    document.body.appendChild(el);

    const gallery = new Gallery(el, { preload: 0 });
    gallery.open(1);

    expect(activeMedia().style.transform).not.toBe('');
    gallery.destroy();
  });

  it('prefers a data-shoji-id marker over the scanned element when both exist', () => {
    // The anchor carries no data-shoji-id of its own, so scan.ts falls back
    // to item.id = src ('a.jpg') for it — the *separate* marker div is the
    // only element tagged data-shoji-id="a.jpg", so a match there is
    // unambiguous proof the marker was preferred, not the scanned anchor.
    const el = document.createElement('div');
    el.innerHTML = `<a href="a.jpg"><img src="thumb-a.jpg"></a>`;
    const marker = document.createElement('div');
    marker.setAttribute('data-shoji-id', 'a.jpg');
    document.body.append(el, marker);
    mockRect(marker, { top: 5, left: 5, width: 20, height: 20, right: 25, bottom: 25 });
    mockRect(el.querySelector('a') as HTMLElement, {
      top: 100,
      left: 100,
      width: 200,
      height: 200,
      right: 300,
      bottom: 300,
    });

    const gallery = new Gallery(el, { preload: 0 });
    gallery.open(0);

    expect(zoomTransition.zoomIn).toHaveBeenCalledWith(expect.objectContaining({ origin: marker }));

    marker.remove();
    gallery.destroy();
  });

  it('finds the origin via data-shoji-id in dynamic mode, where there is no scanned element at all', () => {
    const mount = document.createElement('div');
    const marker = document.createElement('div');
    marker.setAttribute('data-shoji-id', 'x');
    document.body.append(mount, marker);
    mockRect(marker, { top: 5, left: 5, width: 20, height: 20, right: 25, bottom: 25 });

    const gallery = new Gallery(mount, { items: [{ id: 'x', src: 'x.jpg' }], preload: 0 });
    gallery.open(0);

    expect(activeMedia().style.transform).not.toBe('');

    marker.remove();
    gallery.destroy();
  });

  it('runs the zoom-in animation again on a second open() — after a full close(), not just the first open ever', () => {
    const mount = document.createElement('div');
    const marker = document.createElement('div');
    marker.setAttribute('data-shoji-id', 'x');
    document.body.append(mount, marker);
    mockRect(marker, { top: 5, left: 5, width: 20, height: 20, right: 25, bottom: 25 });

    const gallery = new Gallery(mount, { items: [{ id: 'x', src: 'x.jpg' }], preload: 0 });
    gallery.open(0);
    expect(zoomTransition.zoomIn).toHaveBeenCalledTimes(1);

    gallery.close();
    fireTransitionEnd(activeMedia()); // let the deferred close actually finish

    gallery.open(0);
    expect(zoomTransition.zoomIn).toHaveBeenCalledTimes(2);
    // Called with real (non-null-origin, non-zero-rect) args, not silently
    // skipped a second time — matches the first call's origin identity.
    expect(zoomTransition.zoomIn).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ origin: marker }),
    );

    marker.remove();
    gallery.destroy();
  });

  it('skips the animation gracefully in dynamic mode with no marker at all', () => {
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const gallery = new Gallery(mount, { items: [{ id: 'x', src: 'x.jpg' }], preload: 0 });

    expect(() => gallery.open(0)).not.toThrow();
    expect(gallery.currentIndex).toBe(0);
    expect(activeMedia().style.transform).toBe(''); // no origin found — no-op, not a crash

    gallery.destroy();
  });
});

describe('Gallery — open-placeholder source (item.thumb / data-shoji-thumb / origin img)', () => {
  it("prefers item.thumb over a data-shoji-thumb attribute or the origin's own rendered <img>", () => {
    const mount = document.createElement('div');
    const marker = document.createElement('div');
    marker.setAttribute('data-shoji-id', 'x');
    marker.setAttribute('data-shoji-thumb', 'from-attr.jpg');
    marker.innerHTML = '<img src="from-dom.jpg">';
    document.body.append(mount, marker);

    const gallery = new Gallery(mount, {
      items: [{ id: 'x', src: 'x.jpg', thumb: 'from-item.jpg' }],
      preload: 0,
    });
    gallery.open(0);

    const placeholder = activeMedia().querySelector(
      'img.shoji-slide-open-placeholder',
    ) as HTMLImageElement;
    expect(placeholder.src).toContain('from-item.jpg');

    marker.remove();
    gallery.destroy();
  });

  it('falls back to a live data-shoji-thumb attribute on the origin element when item.thumb is unset (dynamic mode, no item-array change needed)', () => {
    const mount = document.createElement('div');
    const marker = document.createElement('div');
    marker.setAttribute('data-shoji-id', 'x');
    marker.setAttribute('data-shoji-thumb', 'from-attr.jpg');
    document.body.append(mount, marker);

    const gallery = new Gallery(mount, { items: [{ id: 'x', src: 'x.jpg' }], preload: 0 });
    gallery.open(0);

    const placeholder = activeMedia().querySelector(
      'img.shoji-slide-open-placeholder',
    ) as HTMLImageElement;
    expect(placeholder.src).toContain('from-attr.jpg');

    marker.remove();
    gallery.destroy();
  });

  it("falls back to the origin element's own rendered <img> when neither item.thumb nor data-shoji-thumb is set", () => {
    const el = document.createElement('div');
    el.innerHTML = `<a href="a.jpg"><img src="thumb-a.jpg"></a>`;
    document.body.appendChild(el);

    const gallery = new Gallery(el, { preload: 0 });
    gallery.open(0);

    const placeholder = activeMedia().querySelector(
      'img.shoji-slide-open-placeholder',
    ) as HTMLImageElement;
    expect(placeholder.src).toContain('thumb-a.jpg');

    gallery.destroy();
  });

  it('shows no placeholder — same spinner as before — when none of the three sources are available', () => {
    const mount = document.createElement('div');
    const marker = document.createElement('div'); // tagged for origin lookup, but no thumb source at all
    marker.setAttribute('data-shoji-id', 'x');
    document.body.append(mount, marker);

    const gallery = new Gallery(mount, { items: [{ id: 'x', src: 'x.jpg' }], preload: 0 });
    gallery.open(0);

    expect(activeMedia().querySelector('.shoji-slide-open-placeholder')).toBeNull();
    expect(activeMedia().querySelector('.shoji-slide-spinner')).not.toBeNull();

    marker.remove();
    gallery.destroy();
  });
});

describe('Gallery — deferred close animation', () => {
  function openGallery(count = 3) {
    const el = document.createElement('div');
    el.innerHTML = Array.from(
      { length: count },
      (_, i) => `<a href="${i}.jpg" data-shoji-id="item-${i}"><img src="thumb-${i}.jpg"></a>`,
    ).join('');
    document.body.appendChild(el);

    const gallery = new Gallery(el, { preload: 0 });
    gallery.open(0);
    return { gallery, media: activeMedia() };
  }

  it('does not finish closing until the zoom-out transition ends', () => {
    const { gallery, media } = openGallery();

    gallery.close();
    expect(document.querySelector('.shoji-outer.shoji-open')).not.toBeNull(); // still open, mid-animation

    fireTransitionEnd(media);
    expect(document.querySelector('.shoji-outer.shoji-open')).toBeNull(); // now finished

    gallery.destroy();
  });

  it('a second close() call while already closing is a no-op (isClosing guard)', () => {
    const { gallery, media } = openGallery();
    const closeHandler = vi.fn();
    gallery.on('beforeClose', closeHandler);

    gallery.close();
    gallery.close(); // should not re-trigger
    expect(closeHandler).toHaveBeenCalledTimes(1);

    fireTransitionEnd(media);
    gallery.destroy();
  });

  it('destroy() force-finishes an in-progress close without waiting for the transition', () => {
    const { gallery } = openGallery();
    const afterClose = vi.fn();
    gallery.on('afterClose', afterClose);

    gallery.close();
    expect(afterClose).not.toHaveBeenCalled(); // still animating

    expect(() => gallery.destroy()).not.toThrow();
    expect(afterClose).toHaveBeenCalledTimes(1); // force-finished, not skipped
  });

  it('destroy() does not double-emit beforeClose when close() already emitted it', () => {
    const { gallery } = openGallery();
    const beforeClose = vi.fn();
    gallery.on('beforeClose', beforeClose);

    gallery.close();
    gallery.destroy();

    expect(beforeClose).toHaveBeenCalledTimes(1);
  });

  it('a late transitionend after destroy() does not re-fire close/afterClose', () => {
    const { gallery, media } = openGallery();
    const afterClose = vi.fn();
    gallery.on('afterClose', afterClose);

    gallery.close();
    gallery.destroy();
    expect(afterClose).toHaveBeenCalledTimes(1);

    fireTransitionEnd(media); // the original zoomOut's listener may still be attached
    expect(afterClose).toHaveBeenCalledTimes(1); // finishClose() is idempotent — no second call
  });
});
