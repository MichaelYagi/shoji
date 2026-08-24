import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Gallery } from '../../src/core';
import type { GalleryItem } from '../../src/core/types';

/**
 * DESIGN.md §2.4/§4.3 — swipe-to-navigate/drag-to-close over an HTML5 video
 * slide. `INTERACTIVE_CONTROL_SELECTOR` (GestureController.ts) still
 * excludes `<video>` wholesale for backdrop-click/caption-selection
 * purposes, but a *separate* gesture-only carve-out lets Shoji's own
 * gestures reach the video body — everywhere except a reserved bottom
 * margin (`--shoji-video-gesture-margin`), left alone for the browser's own
 * scrub-bar/tap-to-toggle chrome, which isn't real DOM Shoji can measure or
 * exclude by selector.
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
