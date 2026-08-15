import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Gallery } from '../../src/core';
import type { GalleryItem } from '../../src/core/types';
import * as zoomTransition from '../../src/core/zoomTransition';

const DEFAULT_RECT: DOMRect = {
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

beforeEach(() => {
  HTMLImageElement.prototype.decode = vi.fn().mockResolvedValue(undefined);
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(DEFAULT_RECT);
});

afterEach(() => {
  vi.restoreAllMocks();
  // @ts-expect-error - removing the test-only stub added above
  delete HTMLImageElement.prototype.decode;
  document.body.innerHTML = '';
});

function items(n: number): GalleryItem[] {
  return Array.from({ length: n }, (_, i) => ({ id: String(i), src: `${i}.jpg` }));
}

function dialog(): HTMLElement {
  return document.querySelector('.shoji-dialog') as HTMLElement;
}

/** Vertical-drag-to-close feedback (translateY/scale/opacity) applies here, not to dialog() — the toolbar/nav/counter/caption are siblings of this, not descendants, so they stay put while the image moves. */
function slidesContainer(): HTMLElement {
  return document.querySelector('.shoji-slides') as HTMLElement;
}

/** With preload: 0 there's exactly one `.shoji-slide` (structural offset 0) — the same element the gesture drag settle animation waits on. */
function slideRoot(): HTMLElement {
  return document.querySelector('.shoji-slide') as HTMLElement;
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

/** The settle animation (Gallery.ts's settleDragOffset) waits on this element's transitionend — real browsers fire it once the CSS transition finishes; tests fire it directly instead of running real timers. */
function fireTransitionEnd(el: Element): void {
  const event = new Event('transitionend') as Event & { propertyName?: string };
  Object.defineProperty(event, 'propertyName', { value: 'transform' });
  el.dispatchEvent(event);
}

/** A full horizontal drag: lock past lockThreshold, move further, release. `endX` is the release position. */
function dragHorizontal(endX: number): void {
  const d = dialog();
  firePointer(d, 'pointerdown', { clientX: 0, timeStamp: 0 });
  firePointer(d, 'pointermove', { clientX: Math.sign(endX) * 11 || 11, timeStamp: 10 }); // cross lockThreshold(10) toward endX's sign
  firePointer(d, 'pointermove', { clientX: endX, timeStamp: 20 });
  firePointer(d, 'pointerup', { clientX: endX, timeStamp: 30 });
}

function dragVertical(endY: number): void {
  const d = dialog();
  firePointer(d, 'pointerdown', { clientX: 0, clientY: 0, timeStamp: 0 });
  firePointer(d, 'pointermove', { clientY: Math.sign(endY) * 11 || 11, timeStamp: 10 });
  firePointer(d, 'pointermove', { clientY: endY, timeStamp: 20 });
  firePointer(d, 'pointerup', { clientY: endY, timeStamp: 30 });
}

describe('Gallery — gesture engine wiring (DESIGN.md §2.4)', () => {
  it('a completed leftward horizontal drag advances to the next item', () => {
    const gallery = new Gallery(document.body, { items: items(3), preload: 0 });
    gallery.open(0);

    dragHorizontal(-80); // well past the default 50px swipeThreshold
    fireTransitionEnd(slideRoot());

    expect(gallery.currentIndex).toBe(1);
    gallery.destroy();
  });

  it('a completed rightward horizontal drag goes to the previous item', () => {
    const gallery = new Gallery(document.body, { items: items(3), preload: 0 });
    gallery.open(1);

    dragHorizontal(80);
    fireTransitionEnd(slideRoot());

    expect(gallery.currentIndex).toBe(0);
    gallery.destroy();
  });

  it('does not advance on a short, slow drag under swipeThreshold/swipeVelocity — snaps back instead', () => {
    const gallery = new Gallery(document.body, { items: items(3), preload: 0 });
    gallery.open(0);

    const d = dialog();
    firePointer(d, 'pointerdown', { clientX: 0, timeStamp: 0 });
    firePointer(d, 'pointermove', { clientX: -11, timeStamp: 1000 }); // locks, dragStartDistance=-11
    firePointer(d, 'pointermove', { clientX: -20, timeStamp: 2000 }); // post-lock delta=-9, well under 50px
    firePointer(d, 'pointerup', { clientX: -20, timeStamp: 3000 }); // 9px over 3000ms — nowhere near 0.3px/ms
    fireTransitionEnd(slideRoot());

    expect(gallery.currentIndex).toBe(0);
    expect(slideRoot().style.transform).toBe('translateX(calc(0% + 0px))');
    gallery.destroy();
  });

  it('a completed swipe past the last item does not advance when loop is false', () => {
    const gallery = new Gallery(document.body, { items: items(3), preload: 0, loop: false });
    gallery.open(2); // last item

    dragHorizontal(-80); // "next" direction, but nothing to advance to
    fireTransitionEnd(slideRoot());

    expect(gallery.currentIndex).toBe(2);
    gallery.destroy();
  });

  it('respects a custom swipeThreshold from options.gestures', () => {
    const gallery = new Gallery(document.body, {
      items: items(3),
      preload: 0,
      gestures: { swipeThreshold: 5, swipeVelocity: 999 },
    });
    gallery.open(0);

    // -17 crosses lockThreshold(default 10) at -11 first, leaving a
    // post-lock delta of -6 — under the library default swipeThreshold (50)
    // but past this gallery's own override (5).
    dragHorizontal(-17);
    fireTransitionEnd(slideRoot());

    expect(gallery.currentIndex).toBe(1);
    gallery.destroy();
  });

  it('a completed vertical drag closes the gallery', () => {
    const gallery = new Gallery(document.body, { items: items(2), preload: 0 });
    gallery.open(0);
    const onClose = vi.fn();
    gallery.on('close', onClose);

    dragVertical(120); // well past the default 50px swipeThreshold

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(dialog().closest('.shoji-outer')?.classList.contains('shoji-open')).toBe(false);
    // A completed drag-close never explicitly un-hides (nothing left to
    // reveal) — the cursor-visible-during-drag marker must still be
    // cleaned up by finishClose(), not left stuck for the next open().
    expect(dialog().classList.contains('shoji-controls-hidden-for-drag')).toBe(false);
    gallery.destroy();
  });

  it("bakes the drag's exact appearance onto the photo itself and resets .shoji-slides to neutral instantly, instead of freezing the transform on .shoji-slides for the whole close — a real bug, reported from real usage: freezing it on the container split the close motion across two elements (a static frozen container plus a photo separately easing in from a standing start), which read as a visible pause partway through, worse the smaller the drag. Baking it onto the photo means only one thing ever animates, continuous from exactly where the drag left off.", () => {
    const marker = document.createElement('div');
    marker.setAttribute('data-shoji-id', '0');
    document.body.appendChild(marker);
    const gallery = new Gallery(document.body, {
      items: [
        { id: '0', src: '0.jpg', width: 800, height: 600 },
        { id: '1', src: '1.jpg', width: 800, height: 600 },
      ],
      preload: 0,
    });
    gallery.open(0);
    const media = document.querySelector('.shoji-slide-media') as HTMLElement;

    dragVertical(120);

    // .shoji-slides carries nothing at all — the drag's appearance has
    // been handed off to `media` instead, not left frozen here.
    expect(slidesContainer().style.transform).toBe('');
    expect(slidesContainer().style.opacity).toBe('');

    // `media` (the photo itself) is what's animating — zoomOut()'s own
    // transition, already running toward the thumbnail.
    expect(media.style.transition).toContain('var(--shoji-duration)');
    expect(media.style.transform).not.toBe('');

    // Once that transition finishes and the dialog is hidden, media's own
    // inline styles are cleaned up too.
    fireTransitionEnd(media);
    expect(media.style.transform).toBe('');
    expect(media.style.opacity).toBe('');

    marker.remove();
    gallery.destroy();
  });

  it('does not clamp the close-start position baked onto the photo — a real bug, reported from real usage and confirmed on video: an earlier version clamped translateY to the same 160px the dim/scale feedback ramps over, to bound how far away the close animation could start. Clamping is itself an instant correction: for a drag past that distance, release visibly snapped the photo from wherever it actually was back to the clamped point, before the real shrink-to-thumbnail motion continued from there — reading as "jumps to a small image in the middle of the screen." The close must continue from exactly where the drag left off, however far that is, with no recentering step.', () => {
    const marker = document.createElement('div');
    marker.setAttribute('data-shoji-id', '0');
    document.body.appendChild(marker);
    const gallery = new Gallery(document.body, {
      items: [
        { id: '0', src: '0.jpg', width: 800, height: 600 },
        { id: '1', src: '1.jpg', width: 800, height: 600 },
      ],
      preload: 0,
    });
    gallery.open(0);
    // Stubbed so real zoomOut()'s own DOM/transition side effects don't run
    // — this test only cares what Gallery hands zoomOut() as `dragStart`,
    // covered for real (including zoomOut()'s own handling of it) by the
    // "bakes the drag's exact appearance" test above, and by e2e.
    const zoomOutSpy = vi.spyOn(zoomTransition, 'zoomOut').mockImplementation(() => {});

    dragVertical(600); // well past the old, now-removed 160px clamp

    const dragStart = zoomOutSpy.mock.calls[0]![0].dragStart!;
    expect(dragStart.translateY).toBe(589); // the raw delta, unclamped
    expect(dragStart.scale).toBeCloseTo(0.85); // scale/opacity still ramp-capped, unrelated to the removed translate clamp

    zoomOutSpy.mockRestore();
    marker.remove();
    gallery.destroy();
  });

  it("keeps the drag's own shrink (scale) as zoomOut()'s dragStart instead of snapping it back to full size on release — a real bug, reported from real usage: dropping it instantly visibly popped the photo back toward full size for a frame before the real close animation took over", () => {
    const marker = document.createElement('div');
    marker.setAttribute('data-shoji-id', '0');
    document.body.appendChild(marker);
    const gallery = new Gallery(document.body, {
      items: [
        { id: '0', src: '0.jpg', width: 800, height: 600 },
        { id: '1', src: '1.jpg', width: 800, height: 600 },
      ],
      preload: 0,
    });
    gallery.open(0);
    const zoomOutSpy = vi.spyOn(zoomTransition, 'zoomOut').mockImplementation(() => {});

    const d = dialog();
    firePointer(d, 'pointerdown', { clientX: 0, clientY: 0, timeStamp: 0 });
    firePointer(d, 'pointermove', { clientY: 11, timeStamp: 10 }); // locks
    firePointer(d, 'pointermove', { clientY: 100, timeStamp: 20 }); // delta 89, under the cap

    const liveScale = slidesContainer().style.transform.match(/scale\(([^)]+)\)/)?.[1];
    expect(liveScale).toBeTruthy();

    firePointer(d, 'pointerup', { clientY: 100, timeStamp: 30 });

    // Same scale value carried straight through as zoomOut()'s dragStart —
    // not stripped back out at the instant of release.
    expect(zoomOutSpy.mock.calls[0]![0].dragStart!.scale).toBe(Number(liveScale));

    zoomOutSpy.mockRestore();
    marker.remove();
    gallery.destroy();
  });

  it("a completed vertical drag with a real origin element starts the zoom-out immediately — doesn't wait for a controls-fade transitionend the way a regular close() does, since the drag's own live feedback is already the closing motion in progress", () => {
    const marker = document.createElement('div');
    marker.setAttribute('data-shoji-id', '0');
    document.body.appendChild(marker);
    const gallery = new Gallery(document.body, {
      items: [
        { id: '0', src: '0.jpg', width: 800, height: 600 },
        { id: '1', src: '1.jpg', width: 800, height: 600 },
      ],
      preload: 0,
    });
    gallery.open(0);
    const media = document.querySelector('.shoji-slide-media') as HTMLElement;

    dragVertical(120);

    // No extra transitionend needed — zoomOut() already ran synchronously,
    // right after the drag's own release, not gated behind a controls-fade
    // wait the way Gallery.close() (button/Escape/backdrop) sequences it.
    expect(media.style.transform).not.toBe('');

    marker.remove();
    gallery.destroy();
  });

  it('closable: false suspends vertical drag-to-close entirely — no live feedback, no close on release', () => {
    const gallery = new Gallery(document.body, {
      items: items(2),
      preload: 0,
      closable: false,
    });
    gallery.open(0);
    const onClose = vi.fn();
    gallery.on('close', onClose);

    const d = dialog();
    firePointer(d, 'pointerdown', { clientX: 0, clientY: 0, timeStamp: 0 });
    firePointer(d, 'pointermove', { clientY: 11, timeStamp: 10 });
    firePointer(d, 'pointermove', { clientY: 120, timeStamp: 20 }); // well past swipeThreshold
    expect(slidesContainer().style.transform).toBe(''); // no live feedback at all while suspended
    firePointer(d, 'pointerup', { clientY: 120, timeStamp: 30 });

    expect(onClose).not.toHaveBeenCalled();
    expect(dialog().closest('.shoji-outer')?.classList.contains('shoji-open')).toBe(true);
    gallery.destroy();
  });

  it('an incomplete vertical drag resets feedback without closing', () => {
    const gallery = new Gallery(document.body, { items: items(2), preload: 0 });
    gallery.open(0);
    const onClose = vi.fn();
    gallery.on('close', onClose);

    dragVertical(15); // under swipeThreshold, slow release

    expect(onClose).not.toHaveBeenCalled();
    expect(dialog().closest('.shoji-outer')?.classList.contains('shoji-open')).toBe(true);
    expect(slidesContainer().style.opacity).toBe('');
    expect(slidesContainer().style.transform).toBe('');
    gallery.destroy();
  });

  it('applies live opacity/scale feedback to the image (.shoji-slides), not the dialog, while a vertical drag is in progress — requested directly: the toolbar/nav/counter/caption should stay anchored in place while the photo is dragged away, not move with it', () => {
    const gallery = new Gallery(document.body, { items: items(2), preload: 0 });
    gallery.open(0);

    const d = dialog();
    firePointer(d, 'pointerdown', { clientX: 0, clientY: 0, timeStamp: 0 });
    firePointer(d, 'pointermove', { clientY: 11, timeStamp: 10 }); // locks, dragStartDistance=11 (delta 0 at the lock event itself)
    firePointer(d, 'pointermove', { clientY: 80, timeStamp: 20 }); // post-lock delta=69

    expect(slidesContainer().style.transform).toContain('translateY(');
    expect(Number(slidesContainer().style.opacity)).toBeLessThan(1);
    // The dialog itself (and thus the toolbar/nav/counter/caption, its
    // direct children — .shoji-slides is a sibling, not their ancestor)
    // never gets a transform/opacity from this at all.
    expect(d.style.transform).toBe('');
    expect(d.style.opacity).toBe('');

    // release short of the threshold so the test doesn't also close the gallery
    firePointer(d, 'pointerup', { clientY: 80, timeStamp: 20 });
    gallery.destroy();
  });

  it('hides controls once a vertical drag crosses the same distance a release would complete the close — a live "let go now and this closes" cue', () => {
    const gallery = new Gallery(document.body, { items: items(2), preload: 0 });
    gallery.open(0);

    const d = dialog();
    firePointer(d, 'pointerdown', { clientX: 0, clientY: 0, timeStamp: 0 });
    firePointer(d, 'pointermove', { clientY: 11, timeStamp: 10 }); // locks
    firePointer(d, 'pointermove', { clientY: 30, timeStamp: 20 }); // under the default 50px threshold

    expect(d.classList.contains('shoji-controls-hidden')).toBe(false);

    firePointer(d, 'pointermove', { clientY: 70, timeStamp: 30 }); // delta from the lock point (11) is 59 — now past it

    expect(d.classList.contains('shoji-controls-hidden')).toBe(true);

    firePointer(d, 'pointerup', { clientY: 15, timeStamp: 40 }); // release back under threshold — not completed
    gallery.destroy();
  });

  it('reveals controls again if the drag retreats back under the threshold before release, without closing', () => {
    const gallery = new Gallery(document.body, { items: items(2), preload: 0 });
    gallery.open(0);

    const d = dialog();
    firePointer(d, 'pointerdown', { clientX: 0, clientY: 0, timeStamp: 0 });
    firePointer(d, 'pointermove', { clientY: 11, timeStamp: 10 });
    firePointer(d, 'pointermove', { clientY: 70, timeStamp: 20 }); // delta 59 — past threshold
    expect(d.classList.contains('shoji-controls-hidden')).toBe(true);

    firePointer(d, 'pointermove', { clientY: 20, timeStamp: 30 }); // delta 9 — back under it, still dragging

    expect(d.classList.contains('shoji-controls-hidden')).toBe(false);

    firePointer(d, 'pointerup', { clientY: 20, timeStamp: 5030 }); // slow release, well under threshold — not completed
    expect(document.querySelector('.shoji-outer.shoji-open')).not.toBeNull(); // still open
    gallery.destroy();
  });

  it("marks the dialog with a dedicated class while controls are hidden for a drag, distinct from an idle/inactive hide — a real bug, reported from real usage: crossing the close threshold hid the cursor along with the toolbar (shoji.css's .shoji-controls-hidden rule), disorienting mid-drag, when the pointer is actively moving and the viewer most needs to see it. Cleared again on retreat, not left stuck.", () => {
    const gallery = new Gallery(document.body, { items: items(2), preload: 0 });
    gallery.open(0);

    const d = dialog();
    firePointer(d, 'pointerdown', { clientX: 0, clientY: 0, timeStamp: 0 });
    firePointer(d, 'pointermove', { clientY: 11, timeStamp: 10 });
    expect(d.classList.contains('shoji-controls-hidden-for-drag')).toBe(false);

    firePointer(d, 'pointermove', { clientY: 70, timeStamp: 20 }); // delta 59 — past threshold
    expect(d.classList.contains('shoji-controls-hidden-for-drag')).toBe(true);

    firePointer(d, 'pointermove', { clientY: 20, timeStamp: 30 }); // delta 9 — back under it
    expect(d.classList.contains('shoji-controls-hidden-for-drag')).toBe(false);

    firePointer(d, 'pointerup', { clientY: 20, timeStamp: 5030 }); // not completed
    gallery.destroy();
  });

  it('does not resurrect controls that were already, permanently hidden before the drag started (autoHideDelay: 0) just because the drag retreated back under the threshold', () => {
    // autoHideDelay: 0 specifically, not gallery.hideControls() — any
    // ordinary activity (including this same drag's own pointerdown)
    // already re-reveals a merely idle-hidden gallery via the existing,
    // separate auto-hide "any interaction reveals controls" behavior
    // (DESIGN.md §2.8) before this feature's own threshold logic ever runs.
    // 0 is the one mode where that reveal is itself suppressed, so controls
    // genuinely stay hidden through pointerdown — the actual scenario
    // `controlsHiddenAtGestureStart` exists to respect.
    const gallery = new Gallery(document.body, { items: items(2), preload: 0, autoHideDelay: 0 });
    gallery.open(0);
    const d = dialog();
    expect(d.classList.contains('shoji-controls-hidden')).toBe(true);

    firePointer(d, 'pointerdown', { clientX: 0, clientY: 0, timeStamp: 0 });
    firePointer(d, 'pointermove', { clientY: 11, timeStamp: 10 });
    firePointer(d, 'pointermove', { clientY: 70, timeStamp: 20 }); // delta 59 — past threshold
    firePointer(d, 'pointermove', { clientY: 20, timeStamp: 30 }); // delta 9 — back under it

    expect(d.classList.contains('shoji-controls-hidden')).toBe(true); // still hidden — was hidden before this gesture too

    firePointer(d, 'pointerup', { clientY: 20, timeStamp: 5030 });
    gallery.destroy();
  });

  it('respects a custom swipeThreshold for the controls-hide cue too, not just the hardcoded default', () => {
    const gallery = new Gallery(document.body, {
      items: items(2),
      preload: 0,
      gestures: { swipeThreshold: 100 },
    });
    gallery.open(0);

    const d = dialog();
    firePointer(d, 'pointerdown', { clientX: 0, clientY: 0, timeStamp: 0 });
    firePointer(d, 'pointermove', { clientY: 11, timeStamp: 10 });
    firePointer(d, 'pointermove', { clientY: 70, timeStamp: 20 }); // delta 59 — past the default 50, under the custom 100

    expect(d.classList.contains('shoji-controls-hidden')).toBe(false);

    firePointer(d, 'pointermove', { clientY: 115, timeStamp: 30 }); // delta 104 — now past the custom threshold

    expect(d.classList.contains('shoji-controls-hidden')).toBe(true);

    firePointer(d, 'pointerup', { clientY: 20, timeStamp: 5030 });
    gallery.destroy();
  });

  it('relays tap/doubleTap/pinch/wheelZoom on the event bus with no built-in effect', () => {
    const gallery = new Gallery(document.body, { items: items(2), preload: 0 });
    gallery.open(0);

    const onTap = vi.fn();
    const onDoubleTap = vi.fn();
    const onPinchStart = vi.fn();
    const onPinchMove = vi.fn();
    const onPinchEnd = vi.fn();
    const onWheelZoom = vi.fn();
    gallery.on('tap', onTap);
    gallery.on('doubleTap', onDoubleTap);
    gallery.on('pinchStart', onPinchStart);
    gallery.on('pinchMove', onPinchMove);
    gallery.on('pinchEnd', onPinchEnd);
    gallery.on('wheelZoom', onWheelZoom);

    const d = dialog();
    firePointer(d, 'pointerdown', { clientX: 10, clientY: 10, timeStamp: 0 });
    firePointer(d, 'pointerup', { clientX: 10, clientY: 10, timeStamp: 50 });
    // controlsWereHidden: false — controls are freshly opened, not auto-hidden yet.
    expect(onTap).toHaveBeenCalledWith({ x: 10, y: 10, controlsWereHidden: false });

    firePointer(d, 'pointerdown', { clientX: 10, clientY: 10, timeStamp: 100 });
    firePointer(d, 'pointerup', { clientX: 10, clientY: 10, timeStamp: 150 });
    expect(onDoubleTap).toHaveBeenCalledWith({ x: 10, y: 10 });

    const pinchA = new PointerEvent('pointerdown', {
      clientX: 0,
      clientY: 0,
      pointerId: 2,
      isPrimary: true,
      bubbles: true,
    });
    const pinchB = new PointerEvent('pointerdown', {
      clientX: 100,
      clientY: 0,
      pointerId: 3,
      isPrimary: false,
      bubbles: true,
    });
    d.dispatchEvent(pinchA);
    d.dispatchEvent(pinchB);
    expect(onPinchStart).toHaveBeenCalledWith({ centerX: 50, centerY: 0 });

    const pinchMoveB = new PointerEvent('pointermove', {
      clientX: 200,
      clientY: 0,
      pointerId: 3,
      bubbles: true,
    });
    d.dispatchEvent(pinchMoveB);
    expect(onPinchMove).toHaveBeenCalledWith(expect.objectContaining({ scale: 2 }));

    d.dispatchEvent(new PointerEvent('pointerup', { pointerId: 2, bubbles: true }));
    d.dispatchEvent(new PointerEvent('pointerup', { pointerId: 3, bubbles: true }));
    expect(onPinchEnd).toHaveBeenCalledTimes(1);

    const wheel = new WheelEvent('wheel', {
      deltaY: -10,
      ctrlKey: true,
      clientX: 1,
      clientY: 2,
      cancelable: true,
    });
    d.dispatchEvent(wheel);
    expect(onWheelZoom).toHaveBeenCalledWith({ deltaScale: 0.1, x: 1, y: 2 });

    gallery.destroy();
  });

  it('ignores drags/taps starting on a real control (e.g. the close button) — clicking it must not also count as a swipe', () => {
    const gallery = new Gallery(document.body, { items: items(3), preload: 0 });
    gallery.open(0);
    const closeButton = document.querySelector('.shoji-close') as HTMLElement;

    firePointer(closeButton, 'pointerdown', { clientX: 0, timeStamp: 0 });
    firePointer(dialog(), 'pointermove', { clientX: -80, timeStamp: 10 });
    firePointer(dialog(), 'pointerup', { clientX: -80, timeStamp: 20 });

    expect(gallery.currentIndex).toBe(0);
    gallery.destroy();
  });

  it('destroy() tears down the gesture engine (no lingering listeners/errors on a dead dialog)', () => {
    const gallery = new Gallery(document.body, { items: items(2), preload: 0 });
    gallery.open(0);
    const d = dialog();
    gallery.destroy();

    // The dialog element itself is detached, not destroyed — dispatching on
    // it directly (bypassing the dialog() lookup, which would now find
    // nothing) still proves the engine's own listeners were removed.
    expect(() => {
      firePointer(d, 'pointerdown', { clientX: 0, timeStamp: 0 });
      firePointer(d, 'pointermove', { clientX: -80, timeStamp: 10 });
      firePointer(d, 'pointerup', { clientX: -80, timeStamp: 20 });
    }).not.toThrow();
  });
});
