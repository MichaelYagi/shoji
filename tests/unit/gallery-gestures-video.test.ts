import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Gallery } from '../../src/core';
import type { GalleryItem } from '../../src/core/types';

/**
 * DESIGN.md §2.4/§4.3 — swipe-to-navigate/drag-to-close over a video slide.
 * `INTERACTIVE_CONTROL_SELECTOR` (GestureController.ts) still excludes
 * `<video>` wholesale for backdrop-click/caption-selection purposes, but a
 * *separate* gesture-only carve-out lets Shoji's own gestures reach the
 * video body — for HTML5, everywhere except a reserved bottom margin
 * (`--shoji-video-gesture-margin`), left alone for the browser's own
 * scrub-bar/tap-to-toggle chrome; for a provider (YouTube/Vimeo/custom),
 * everywhere outside the caption's own bounds — the iframe/embed itself is
 * architecturally unreachable regardless (cross-origin isolation), so only
 * the letterboxed margins around it are ever in play there.
 *
 * A separate file, not added to `gallery-gestures.test.ts` (already past
 * CLAUDE.md's ~400-line split guideline) — same helper patterns as that
 * file (`firePointer`/`dialog`/`slideRoot`/`fireTransitionEnd`), duplicated
 * rather than shared, matching how other test files in this suite each
 * keep their own local copies rather than importing across test files.
 */

const DIALOG_RECT: DOMRect = {
  top: 0,
  left: 0,
  right: 300,
  bottom: 300,
  width: 300,
  height: 300,
  x: 0,
  y: 0,
  toJSON: () => ({}),
};

/** 300 wide, 200 tall, at the origin — bottom edge at y=200. */
const VIDEO_RECT: DOMRect = {
  top: 0,
  left: 0,
  right: 300,
  bottom: 200,
  width: 300,
  height: 200,
  x: 0,
  y: 0,
  toJSON: () => ({}),
};

/** Mocks a real rect for `.shoji-slide-video` distinct from every other element (DIALOG_RECT), and `--shoji-video-gesture-margin` (read via getComputedStyle, GestureController.ts's isInVideoControlsMargin) to a known value — jsdom has no real layout engine or CSS cascade, same reasoning `gallery-gestures.test.ts`'s own DEFAULT_RECT mock and `zoomTransition.test.ts`'s `getComputedStyle` mocks document. */
function mockVideoGeometry(marginPx: number): void {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return this.tagName === 'VIDEO' ? VIDEO_RECT : DIALOG_RECT;
  });
  // Only the video element's own custom property needs overriding —
  // everything else (GestureController.ts's own transitionDuration read via
  // waitForTransitionEnd, for the settle animation) must keep working
  // exactly like a real, unmocked getComputedStyle would.
  const real = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element, ...rest) => {
    if (el.tagName !== 'VIDEO') return real(el, ...rest);
    const base = real(el, ...rest);
    return new Proxy(base, {
      get(target, prop, receiver) {
        if (prop === 'getPropertyValue') {
          return (name: string) =>
            name === '--shoji-video-gesture-margin'
              ? `${marginPx}px`
              : target.getPropertyValue(name);
        }
        return Reflect.get(target, prop, receiver);
      },
    });
  });
}

// jsdom implements none of these for a real <video> — same stub pattern
// SlideManager.test.ts/autoplay.test.ts already establish. `pause`/`load`
// specifically matter here: SlideManager.ts's releaseVideoNode() calls both
// on gallery.destroy(), which every test below does in cleanup.
beforeEach(() => {
  HTMLImageElement.prototype.decode = vi.fn().mockResolvedValue(undefined);
  HTMLVideoElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  HTMLVideoElement.prototype.pause = vi.fn();
  HTMLVideoElement.prototype.load = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
  // @ts-expect-error - removing the test-only stub added above
  delete HTMLImageElement.prototype.decode;
  // @ts-expect-error - removing the test-only stub added above
  delete HTMLVideoElement.prototype.play;
  // @ts-expect-error - removing the test-only stub added above
  delete HTMLVideoElement.prototype.pause;
  // @ts-expect-error - removing the test-only stub added above
  delete HTMLVideoElement.prototype.load;
  document.body.innerHTML = '';
});

function videoItems(n: number): GalleryItem[] {
  return Array.from({ length: n }, (_, i) => ({
    id: String(i),
    src: `${i}.mp4`,
    video: { provider: 'html5' as const },
  }));
}

function dialog(): HTMLElement {
  return document.querySelector('.shoji-dialog') as HTMLElement;
}

function slideRoot(): HTMLElement {
  return document.querySelector('.shoji-slide') as HTMLElement;
}

function video(): HTMLElement {
  return document.querySelector('.shoji-slide-video') as HTMLElement;
}

function firePointer(
  target: EventTarget,
  type: string,
  opts: { clientX?: number; clientY?: number; timeStamp?: number } = {},
): void {
  const event = new PointerEvent(type, {
    clientX: opts.clientX ?? 0,
    clientY: opts.clientY ?? 0,
    pointerId: 1,
    isPrimary: true,
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(event, 'timeStamp', { value: opts.timeStamp ?? 0, configurable: true });
  target.dispatchEvent(event);
}

function fireTransitionEnd(el: Element): void {
  const event = new Event('transitionend') as Event & { propertyName?: string };
  Object.defineProperty(event, 'propertyName', { value: 'transform' });
  el.dispatchEvent(event);
}

/**
 * `pointerdown` fires on the video itself (bubbling up to `.shoji-dialog`,
 * where `GestureEngine`'s listeners live) — that's what makes the video
 * element show up in `event.composedPath()`, which
 * `shouldIgnoreGesture()`/`isInVideoControlsMargin()` needs to see. The
 * remaining steps target `.shoji-dialog` directly, matching
 * `gallery-gestures.test.ts`'s own `dragHorizontal`/`dragVertical` helpers
 * — once `pointerdown` locks a direction, the rest is coordinate-only.
 * `GestureEngine` locks direction from whichever axis the *first* move
 * actually perturbs (`Math.max(absX, absY)`, `GestureEngine.ts`) — a
 * horizontal drag's lock step moves X only; a vertical one moves Y only.
 */
function dragFromVideo(startY: number, endX: number): void {
  firePointer(video(), 'pointerdown', { clientX: 0, clientY: startY, timeStamp: 0 });
  firePointer(dialog(), 'pointermove', {
    clientX: Math.sign(endX) * 11 || 11,
    clientY: startY,
    timeStamp: 10,
  });
  firePointer(dialog(), 'pointermove', { clientX: endX, clientY: startY, timeStamp: 20 });
  firePointer(dialog(), 'pointerup', { clientX: endX, clientY: startY, timeStamp: 30 });
}

function dragVerticalFromVideo(startY: number, endY: number): void {
  firePointer(video(), 'pointerdown', { clientX: 0, clientY: startY, timeStamp: 0 });
  firePointer(dialog(), 'pointermove', {
    clientX: 0,
    clientY: startY + (Math.sign(endY - startY) * 11 || 11),
    timeStamp: 10,
  });
  firePointer(dialog(), 'pointermove', { clientX: 0, clientY: endY, timeStamp: 20 });
  firePointer(dialog(), 'pointerup', { clientX: 0, clientY: endY, timeStamp: 30 });
}

/** A `provider: 'custom'` renderer builds a real (synthetic) iframe synchronously — same shape a YouTube/Vimeo renderer's own container ends up in, without needing their real SDKs mocked. */
function providerVideoItems(n: number): GalleryItem[] {
  return Array.from({ length: n }, (_, i) => ({
    id: String(i),
    src: 'x',
    caption: `caption ${i}`,
    video: {
      provider: 'custom' as const,
      render: (container: HTMLElement, _item: GalleryItem, onReady: () => void) => {
        const iframe = document.createElement('iframe');
        container.appendChild(iframe);
        onReady();
      },
    },
  }));
}

function providerContainer(): HTMLElement {
  return document.querySelector('.shoji-slide-provider-video') as HTMLElement;
}

function caption(): HTMLElement {
  return document.querySelector('.shoji-caption') as HTMLElement;
}

/** A video caption defaults to hidden (Gallery.ts's captionVisibleOnVideo, DESIGN.md §2.3a) — `isOverVideoCaption()`'s exclusion only ever matters once it's actually shown, same as a real viewer would have to reveal it first. */
function revealVideoCaption(): void {
  (document.querySelector('.shoji-caption-toggle') as HTMLButtonElement).click();
}

/** 300 wide, 40 tall, bottom-left — distinct from PROVIDER_RECT below so a touch can land in either without ambiguity. */
const CAPTION_RECT: DOMRect = {
  top: 260,
  left: 0,
  right: 300,
  bottom: 300,
  width: 300,
  height: 40,
  x: 0,
  y: 260,
  toJSON: () => ({}),
};

/** Same box `.shoji-slide-provider-video` fills — matches DIALOG_RECT (position: absolute; inset: 0, shoji.css), so margin/gutter coordinates outside the (synthetic, zero-sized-in-jsdom) iframe are just "anywhere in this box". */
const PROVIDER_RECT = DIALOG_RECT;

/** Mocks real rects for `.shoji-slide-provider-video` and `.shoji-caption`, distinct from every other element — same jsdom-has-no-layout-engine reasoning as `mockVideoGeometry` above. No `getComputedStyle` override needed here: `isInVideoControlsMargin()` only ever runs for a real `<video>`, never a provider's `<iframe>`/container div. */
function mockProviderGeometry(): void {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (this.classList.contains('shoji-caption')) return CAPTION_RECT;
    if (this.classList.contains('shoji-slide-provider-video')) return PROVIDER_RECT;
    return DIALOG_RECT;
  });
}

describe("Gallery — swipe-to-navigate/drag-to-close over a provider video (custom/YouTube/Vimeo)'s own letterboxed margins (DESIGN.md §2.4/§4.3)", () => {
  it('a horizontal drag starting in the margin (outside the caption) navigates to the next slide', () => {
    mockProviderGeometry();
    const gallery = new Gallery(document.body, {
      items: providerVideoItems(3),
      preload: 0,
    });
    gallery.open(0);

    // y=50 — well clear of CAPTION_RECT's [260, 300] band.
    firePointer(providerContainer(), 'pointerdown', { clientX: 0, clientY: 50, timeStamp: 0 });
    firePointer(dialog(), 'pointermove', { clientX: 11, clientY: 50, timeStamp: 10 });
    firePointer(dialog(), 'pointermove', { clientX: -80, clientY: 50, timeStamp: 20 });
    firePointer(dialog(), 'pointerup', { clientX: -80, clientY: 50, timeStamp: 30 });
    fireTransitionEnd(slideRoot());

    expect(gallery.currentIndex).toBe(1);
    gallery.destroy();
  });

  it("a horizontal drag starting within the video caption's bounds does not navigate, even though pointer-events: none means the event target is the provider container underneath, not the caption itself", () => {
    mockProviderGeometry();
    const gallery = new Gallery(document.body, {
      items: providerVideoItems(3),
      preload: 0,
    });
    gallery.open(0);
    revealVideoCaption();
    expect(caption().hidden).toBe(false);
    expect(caption().classList.contains('shoji-caption--video')).toBe(true);

    // y=280 — inside CAPTION_RECT's [260, 300] band. Dispatched on the
    // provider container (not the caption) — pointer-events: none means a
    // real browser's hit-test would land here too, never on the caption
    // itself; composedPath() alone can't see it, which is exactly what
    // isOverVideoCaption()'s coordinate check exists for.
    firePointer(providerContainer(), 'pointerdown', { clientX: 0, clientY: 280, timeStamp: 0 });
    firePointer(dialog(), 'pointermove', { clientX: 11, clientY: 280, timeStamp: 10 });
    firePointer(dialog(), 'pointermove', { clientX: -80, clientY: 280, timeStamp: 20 });
    firePointer(dialog(), 'pointerup', { clientX: -80, clientY: 280, timeStamp: 30 });
    fireTransitionEnd(slideRoot());

    expect(gallery.currentIndex).toBe(0);
    gallery.destroy();
  });

  it('a vertical drag starting in the margin (outside the caption) closes the gallery', () => {
    mockProviderGeometry();
    const gallery = new Gallery(document.body, { items: providerVideoItems(1), preload: 0 });
    gallery.open(0);

    firePointer(providerContainer(), 'pointerdown', { clientX: 150, clientY: 50, timeStamp: 0 });
    firePointer(dialog(), 'pointermove', { clientX: 150, clientY: 61, timeStamp: 10 });
    firePointer(dialog(), 'pointermove', { clientX: 150, clientY: 300, timeStamp: 20 });
    firePointer(dialog(), 'pointerup', { clientX: 150, clientY: 300, timeStamp: 30 });

    expect(document.querySelector('.shoji-outer.shoji-open')).toBeNull();
    gallery.destroy();
  });

  it("a vertical drag starting within the video caption's bounds does not close", () => {
    mockProviderGeometry();
    const gallery = new Gallery(document.body, { items: providerVideoItems(1), preload: 0 });
    gallery.open(0);
    revealVideoCaption();
    expect(caption().hidden).toBe(false);

    // y=270 — inside CAPTION_RECT's [260, 300] band.
    firePointer(providerContainer(), 'pointerdown', { clientX: 150, clientY: 270, timeStamp: 0 });
    firePointer(dialog(), 'pointermove', { clientX: 150, clientY: 281, timeStamp: 10 });
    firePointer(dialog(), 'pointermove', { clientX: 150, clientY: 500, timeStamp: 20 });
    firePointer(dialog(), 'pointerup', { clientX: 150, clientY: 500, timeStamp: 30 });

    expect(document.querySelector('.shoji-outer.shoji-open')).not.toBeNull();
    gallery.destroy();
  });
});

describe('Gallery — swipe-to-navigate/drag-to-close over HTML5 video (DESIGN.md §2.4/§4.3)', () => {
  it('a horizontal drag starting above the reserved bottom margin navigates to the next slide', () => {
    mockVideoGeometry(56);
    const gallery = new Gallery(document.body, { items: videoItems(3), preload: 0 });
    gallery.open(0);

    dragFromVideo(100, -80); // y=100, well above bottom(200) - margin(56) = 144
    fireTransitionEnd(slideRoot());

    expect(gallery.currentIndex).toBe(1);
    gallery.destroy();
  });

  it('a horizontal drag starting within the reserved bottom margin does not navigate — native scrub-bar territory', () => {
    mockVideoGeometry(56);
    const gallery = new Gallery(document.body, { items: videoItems(3), preload: 0 });
    gallery.open(0);

    dragFromVideo(180, -80); // y=180, inside [144, 200)
    fireTransitionEnd(slideRoot());

    expect(gallery.currentIndex).toBe(0);
    gallery.destroy();
  });

  it('a vertical drag starting above the reserved bottom margin closes the gallery, same as a photo slide', () => {
    mockVideoGeometry(56);
    const gallery = new Gallery(document.body, { items: videoItems(1), preload: 0 });
    gallery.open(0);

    dragVerticalFromVideo(50, 300); // starts well above the margin, ends past the close threshold

    expect(document.querySelector('.shoji-outer.shoji-open')).toBeNull();
    gallery.destroy();
  });

  it('a vertical drag starting within the reserved bottom margin does not close — native scrub-bar territory', () => {
    mockVideoGeometry(56);
    const gallery = new Gallery(document.body, { items: videoItems(1), preload: 0 });
    gallery.open(0);

    dragVerticalFromVideo(180, 300); // starts inside [144, 200)

    expect(document.querySelector('.shoji-outer.shoji-open')).not.toBeNull();
    gallery.destroy();
  });

  it('a video slide with --shoji-video-gesture-margin overridden lower reserves less of the bottom for native controls', () => {
    mockVideoGeometry(10); // a host that knows its target browsers render a shorter controls bar
    const gallery = new Gallery(document.body, { items: videoItems(3), preload: 0 });
    gallery.open(0);

    // y=180 is now well above bottom(200) - margin(10) = 190 — no longer inside the (now-smaller) margin.
    dragFromVideo(180, -80);
    fireTransitionEnd(slideRoot());

    expect(gallery.currentIndex).toBe(1);
    gallery.destroy();
  });
});
