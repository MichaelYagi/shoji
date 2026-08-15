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
// containedBox passes through real (SlideManager.ts's open-placeholder
// sizing imports it from this same module too — not just Gallery.ts's own
// zoomIn/zoomOut calls this file cares about spying on).
vi.mock('../../src/core/zoomTransition', async (importOriginal) => {
  const actual = await importOriginal<typeof ZoomTransitionModule>();
  return {
    zoomIn: vi.fn(actual.zoomIn),
    zoomOut: vi.fn(actual.zoomOut),
    containedBox: actual.containedBox,
    waitForTransitionEnd: actual.waitForTransitionEnd,
  };
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

/** The open() placeholder now waits for its own decode() to resolve before appearing (SlideManager.ts's revealOpenPlaceholder) — a microtask, not synchronous with open(). */
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function fireTransitionEnd(el: Element, propertyName = 'transform'): void {
  const event = new Event('transitionend') as Event & { propertyName?: string };
  Object.defineProperty(event, 'propertyName', { value: propertyName });
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
    el.innerHTML = `<a href="a.jpg" data-shoji-width="800" data-shoji-height="600"><img src="thumb-a.jpg"></a><a href="b.jpg" data-shoji-width="800" data-shoji-height="600"><img src="thumb-b.jpg"></a>`;
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
    el.innerHTML = `<a href="a.jpg" data-shoji-width="800" data-shoji-height="600"><img src="thumb-a.jpg"></a>`;
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

    const gallery = new Gallery(mount, {
      items: [{ id: 'x', src: 'x.jpg', width: 800, height: 600 }],
      preload: 0,
    });
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

    const gallery = new Gallery(mount, {
      items: [{ id: 'x', src: 'x.jpg', width: 800, height: 600 }],
      preload: 0,
    });
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
  beforeEach(() => {
    // These tests care which *source* resolveOpenPlaceholderSrc picks, not
    // the placeholder-vs-real-content swap timing (already covered at the
    // SlideManager level) — so only the placeholder's own decode resolves;
    // the real slide image's never does, so it can't win the race and
    // overwrite the placeholder before each assertion runs.
    HTMLImageElement.prototype.decode = vi.fn(function (this: HTMLImageElement) {
      return this.classList.contains('shoji-slide-open-placeholder')
        ? Promise.resolve()
        : new Promise<void>(() => {});
    });
  });

  it("prefers item.thumb over a data-shoji-thumb attribute or the origin's own rendered <img>", async () => {
    const mount = document.createElement('div');
    const marker = document.createElement('div');
    marker.setAttribute('data-shoji-id', 'x');
    marker.setAttribute('data-shoji-thumb', 'from-attr.jpg');
    marker.innerHTML = '<img src="from-dom.jpg">';
    document.body.append(mount, marker);

    const gallery = new Gallery(mount, {
      items: [{ id: 'x', src: 'x.jpg', thumb: 'from-item.jpg', width: 800, height: 600 }],
      preload: 0,
    });
    gallery.open(0);
    await flush();

    const placeholder = activeMedia().querySelector(
      'img.shoji-slide-open-placeholder',
    ) as HTMLImageElement;
    expect(placeholder.src).toContain('from-item.jpg');

    marker.remove();
    gallery.destroy();
  });

  it('falls back to a live data-shoji-thumb attribute on the origin element when item.thumb is unset (dynamic mode, no item-array change needed)', async () => {
    const mount = document.createElement('div');
    const marker = document.createElement('div');
    marker.setAttribute('data-shoji-id', 'x');
    marker.setAttribute('data-shoji-thumb', 'from-attr.jpg');
    document.body.append(mount, marker);

    const gallery = new Gallery(mount, {
      items: [{ id: 'x', src: 'x.jpg', width: 800, height: 600 }],
      preload: 0,
    });
    gallery.open(0);
    await flush();

    const placeholder = activeMedia().querySelector(
      'img.shoji-slide-open-placeholder',
    ) as HTMLImageElement;
    expect(placeholder.src).toContain('from-attr.jpg');

    marker.remove();
    gallery.destroy();
  });

  it("falls back to the origin element's own rendered <img> when neither item.thumb nor data-shoji-thumb is set", async () => {
    const el = document.createElement('div');
    el.innerHTML = `<a href="a.jpg" data-shoji-width="800" data-shoji-height="600"><img src="thumb-a.jpg"></a>`;
    document.body.appendChild(el);

    const gallery = new Gallery(el, { preload: 0 });
    gallery.open(0);
    await flush();

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

describe('Gallery — no known dimensions means no guessing (open placeholder AND zoom-in animation both skipped, not just sized differently)', () => {
  it('shows the plain spinner, not the thumbnail placeholder, when item.width/height are unknown — even though a thumb source (item.thumb) is available', () => {
    const mount = document.createElement('div');
    const marker = document.createElement('div');
    marker.setAttribute('data-shoji-id', 'x');
    document.body.append(mount, marker);

    const gallery = new Gallery(mount, {
      items: [{ id: 'x', src: 'x.jpg', thumb: 'thumb.jpg' }], // no width/height
      preload: 0,
    });
    gallery.open(0);

    expect(activeMedia().querySelector('.shoji-slide-open-placeholder')).toBeNull();
    expect(activeMedia().querySelector('.shoji-slide-spinner')).not.toBeNull();

    marker.remove();
    gallery.destroy();
  });

  it('does not run the zoom-in animation on open() when item.width/height are unknown, even with a valid origin found', () => {
    const mount = document.createElement('div');
    const marker = document.createElement('div');
    marker.setAttribute('data-shoji-id', 'x');
    document.body.append(mount, marker);
    mockRect(marker, { top: 5, left: 5, width: 20, height: 20, right: 25, bottom: 25 });

    const gallery = new Gallery(mount, {
      items: [{ id: 'x', src: 'x.jpg' }], // no width/height
      preload: 0,
    });
    gallery.open(0);

    expect(zoomTransition.zoomIn).not.toHaveBeenCalled();
    expect(activeMedia().style.transform).toBe('');

    marker.remove();
    gallery.destroy();
  });

  it('still runs the zoom-in animation normally once item.width/height ARE known — the skip is scoped to unknown dimensions only, not a general regression', () => {
    const mount = document.createElement('div');
    const marker = document.createElement('div');
    marker.setAttribute('data-shoji-id', 'x');
    document.body.append(mount, marker);
    mockRect(marker, { top: 5, left: 5, width: 20, height: 20, right: 25, bottom: 25 });

    const gallery = new Gallery(mount, {
      items: [{ id: 'x', src: 'x.jpg', width: 800, height: 600 }],
      preload: 0,
    });
    gallery.open(0);

    expect(zoomTransition.zoomIn).toHaveBeenCalledTimes(1);

    marker.remove();
    gallery.destroy();
  });

  it('closing before the real image has ever loaded, with no known dimensions, skips the zoom-out animation too and closes immediately — nothing to shrink toward without guessing', () => {
    const mount = document.createElement('div');
    const marker = document.createElement('div');
    marker.setAttribute('data-shoji-id', 'x');
    document.body.append(mount, marker);
    mockRect(marker, { top: 5, left: 5, width: 20, height: 20, right: 25, bottom: 25 });
    // Never resolves — the real image (and thus isActiveReady()) never
    // becomes ready before close() runs, the exact scenario this covers.
    HTMLImageElement.prototype.decode = vi.fn(() => new Promise<void>(() => {}));

    const gallery = new Gallery(mount, {
      items: [{ id: 'x', src: 'x.jpg' }], // no width/height
      preload: 0,
    });
    gallery.open(0);
    gallery.close();

    expect(zoomTransition.zoomOut).not.toHaveBeenCalled();
    // finishClose() ran synchronously, not deferred waiting on a transition.
    expect(document.querySelector('.shoji-outer.shoji-open')).toBeNull();

    marker.remove();
    gallery.destroy();
  });

  it('closing still runs the zoom-out animation with no known dimensions, as long as the real content already finished loading — effectiveTargetBox() measures it directly, nothing to guess', async () => {
    const mount = document.createElement('div');
    const marker = document.createElement('div');
    marker.setAttribute('data-shoji-id', 'x');
    document.body.append(mount, marker);
    mockRect(marker, { top: 5, left: 5, width: 20, height: 20, right: 25, bottom: 25 });

    const gallery = new Gallery(mount, {
      items: [{ id: 'x', src: 'x.jpg' }], // no width/height
      preload: 0,
    });
    gallery.open(0);
    await flush(); // the real image finishes decoding — isActiveReady() becomes true

    gallery.close();

    expect(zoomTransition.zoomOut).toHaveBeenCalledTimes(1);

    marker.remove();
    gallery.destroy();
  });
});

describe('Gallery — deferred close animation', () => {
  function openGallery(count = 3) {
    const el = document.createElement('div');
    el.innerHTML = Array.from(
      { length: count },
      (_, i) =>
        `<a href="${i}.jpg" data-shoji-id="item-${i}" data-shoji-width="800" data-shoji-height="600"><img src="thumb-${i}.jpg"></a>`,
    ).join('');
    document.body.appendChild(el);

    const gallery = new Gallery(el, { preload: 0 });
    gallery.open(0);
    return { gallery, media: activeMedia() };
  }

  it('does not finish closing until the zoom-out transition ends', () => {
    const { gallery, media } = openGallery();

    gallery.close();
    expect(document.querySelector('.shoji-outer.shoji-open')).not.toBeNull(); // still open — the zoom-out itself hasn't ended yet
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

describe('Gallery — controls fade and zoom-out run concurrently on close (DESIGN.md §2.6a)', () => {
  function openGallery(count = 3) {
    const el = document.createElement('div');
    el.innerHTML = Array.from(
      { length: count },
      (_, i) =>
        `<a href="${i}.jpg" data-shoji-id="item-${i}" data-shoji-width="800" data-shoji-height="600"><img src="thumb-${i}.jpg"></a>`,
    ).join('');
    document.body.appendChild(el);

    const gallery = new Gallery(el, { preload: 0 });
    gallery.open(0);
    return { gallery, media: activeMedia() };
  }

  function dialog(): HTMLElement {
    return document.querySelector('.shoji-dialog') as HTMLElement;
  }

  it('hides controls and starts the zoom-out at the same time on close() — no wait between them', () => {
    const { gallery, media } = openGallery();

    gallery.close();

    expect(dialog().classList.contains('shoji-controls-hidden')).toBe(true);
    expect(zoomTransition.zoomOut).toHaveBeenCalledTimes(1);

    fireTransitionEnd(media);
    gallery.destroy();
  });

  it('still hides controls on close(), bypassing the hover guard, even while a toolbar control is actively hovered — the single most common close path (clicking the close button) is exactly this case', () => {
    const { gallery, media } = openGallery();
    document.querySelector('.shoji-toolbar-right')!.dispatchEvent(new PointerEvent('pointerenter'));

    gallery.close();

    expect(dialog().classList.contains('shoji-controls-hidden')).toBe(true);

    fireTransitionEnd(media);
    gallery.destroy();
  });

  it('starts the zoom-out immediately on close() even if controls were already hidden beforehand (e.g. idle auto-hide already ran) — same as the ordinary case, nothing extra to wait on either way', () => {
    const { gallery, media } = openGallery();
    gallery.hideControls();
    vi.mocked(zoomTransition.zoomOut).mockClear(); // isolate this test from hideControls() itself, which never calls it

    gallery.close();

    expect(zoomTransition.zoomOut).toHaveBeenCalledTimes(1);

    fireTransitionEnd(media);
    gallery.destroy();
  });

  it('regression: moving the mouse during the close sequence does not re-show the just-hidden controls — onActivity() (pointermove/pointerdown/etc.) stays wired until finishClose(), same as any other open-state activity listener', () => {
    const { gallery, media } = openGallery();

    gallery.close();
    expect(dialog().classList.contains('shoji-controls-hidden')).toBe(true);

    document
      .querySelector('.shoji-outer')!
      .dispatchEvent(new PointerEvent('pointermove', { bubbles: true }));

    expect(dialog().classList.contains('shoji-controls-hidden')).toBe(true); // still hidden — activity during close is a no-op

    fireTransitionEnd(media);
    gallery.destroy();
  });

  it('regression: same as above but for touch — onActivity() is one shared handler for pointermove/pointerdown/touchstart/wheel/focusin alike, so a touch tap/drag during close is equally covered, not mouse-specific', () => {
    const { gallery, media } = openGallery();

    gallery.close();
    expect(dialog().classList.contains('shoji-controls-hidden')).toBe(true);

    document
      .querySelector('.shoji-outer')!
      .dispatchEvent(new Event('touchstart', { bubbles: true }));

    expect(dialog().classList.contains('shoji-controls-hidden')).toBe(true);

    fireTransitionEnd(media);
    gallery.destroy();
  });
});
