import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Gallery } from '../../../src/core';
import { Autoplay } from '../../../src/plugins/autoplay';
import { Zoom } from '../../../src/plugins/zoom';
import { RotateFlip } from '../../../src/plugins/rotateFlip';
import type { GalleryItem } from '../../../src/core/types';

/**
 * DESIGN.md §4.1 — pause-on-zoom (default on) / pause-on-rotate-flip
 * (default off, `pauseOnRotateFlip: true`): a real UX gap, not a reported
 * bug, fixed alongside the rotate/zoom-under-rotation work above. Autoplay
 * only reacts to zoomChange/rotateFlipChange's event *shape* (`core/
 * types.ts`) — never imports either plugin directly — so these tests load
 * all three together, the same cross-plugin pattern
 * `layout-automeasure.test.ts` already established, and drive the
 * interaction through each plugin's own real, public toolbar buttons
 * rather than faking the event bus directly.
 *
 * Deliberately **stays paused** rather than auto-resuming once back at
 * neutral — a real bug, reported from real usage against an earlier,
 * edge-tracked auto-resume design: rotating back to the original
 * orientation is still an active interaction with the view controls, not
 * "nothing happened," so it must not silently resume either.
 */

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
  vi.useRealTimers();
  vi.restoreAllMocks();
  // @ts-expect-error - removing the test-only stub added above
  delete HTMLImageElement.prototype.decode;
  document.body.innerHTML = '';
});

const items: GalleryItem[] = [
  { id: 'a', src: 'a.jpg' },
  { id: 'b', src: 'b.jpg' },
];

function makeGallery(options: Record<string, unknown> = {}): Gallery {
  return new Gallery(document.createElement('div'), {
    items,
    plugins: [Autoplay, Zoom, RotateFlip],
    preload: 0,
    ...options,
  });
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function button(label: string): HTMLButtonElement {
  return document.querySelector(
    `.shoji-toolbar-button[aria-label="${label}"]`,
  ) as HTMLButtonElement;
}

function toggleButton(): HTMLButtonElement {
  return document.querySelector('.shoji-autoplay-toggle') as HTMLButtonElement;
}

function dialog(): HTMLElement {
  return document.querySelector('.shoji-dialog') as HTMLElement;
}

function firePointer(
  target: EventTarget,
  type: string,
  opts: { clientX?: number; clientY?: number; pointerId?: number } = {},
): void {
  target.dispatchEvent(
    new PointerEvent(type, {
      clientX: opts.clientX ?? 0,
      clientY: opts.clientY ?? 0,
      pointerId: opts.pointerId ?? 1,
      isPrimary: true,
      bubbles: true,
      cancelable: true,
    }),
  );
}

/** Two quick taps at the same point, close in time — GestureEngine reports this as doubleTap; Zoom's own `toggleZoom()` zooms in, or resets straight back to neutral in one step if already zoomed — unlike the toolbar zoom-out button, which steps down gradually. */
function doubleTapAt(x: number, y: number): void {
  const d = dialog();
  firePointer(d, 'pointerdown', { clientX: x, clientY: y });
  firePointer(d, 'pointerup', { clientX: x, clientY: y });
  firePointer(d, 'pointerdown', { clientX: x, clientY: y });
  firePointer(d, 'pointerup', { clientX: x, clientY: y });
}

function click(el: Element): void {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

function isPlaying(): boolean {
  return toggleButton().getAttribute('aria-label') === 'Pause slideshow';
}

function isToggleDisabled(): boolean {
  return toggleButton().getAttribute('aria-disabled') === 'true';
}

describe('Autoplay — pauseOnZoom (default on)', () => {
  it('zooming in pauses a playing slideshow', async () => {
    vi.useFakeTimers();
    const gallery = makeGallery();
    gallery.open(0);
    await flush();
    click(toggleButton());
    expect(isPlaying()).toBe(true);

    click(button('Zoom in')); // scale 1 -> 1.5
    expect(isPlaying()).toBe(false);

    gallery.destroy();
  });

  it('stays paused once zoomed back out to neutral — no auto-resume', async () => {
    vi.useFakeTimers();
    const gallery = makeGallery();
    gallery.open(0);
    await flush();
    click(toggleButton());

    click(button('Zoom in'));
    expect(isPlaying()).toBe(false);
    click(button('Zoom out')); // scale 1.5 -> 1 (reset(), not zoomTo() — the gap this fixed)
    expect(isPlaying()).toBe(false); // still paused, not auto-resumed

    gallery.destroy();
  });

  it('re-pauses on a second zoom-in even after a manual restart while still zoomed', async () => {
    vi.useFakeTimers();
    const gallery = makeGallery();
    gallery.open(0);
    await flush();
    click(toggleButton());

    click(button('Zoom in'));
    expect(isPlaying()).toBe(false);

    // Attempting to restart while still zoomed now immediately re-pauses
    // (toggle()'s own "already engaged" check, the regression test below) —
    // covers a *further* zoom-in on top of that still correctly re-pausing
    // too, not just the toggle-triggered one.
    click(toggleButton());
    expect(isPlaying()).toBe(false);

    click(button('Zoom in')); // still zoomed, zooming further
    expect(isPlaying()).toBe(false); // must still be paused

    gallery.destroy();
  });

  it('regression: pressing Play while already zoomed in immediately pauses again, instead of running unpaused — a real bug found testing this directly: nothing fires zoomChange just from clicking Play, and toggling straight back to neutral afterward (double-tap-to-reset) only emits the already-neutral event, never one crossing the engaged threshold, so nothing ever caught it', async () => {
    vi.useFakeTimers();
    const gallery = makeGallery();
    gallery.open(0);
    await flush();

    doubleTapAt(150, 150); // zoom in first, while not playing
    expect(isPlaying()).toBe(false);

    click(toggleButton()); // press Play while already zoomed in
    expect(isPlaying()).toBe(false); // must immediately re-pause, not run unpaused

    doubleTapAt(150, 150); // toggle straight back to neutral (reset(), single step)
    expect(isPlaying()).toBe(false); // still paused — no auto-resume

    gallery.destroy();
  });

  it('does not pause a slideshow that was never playing to begin with', async () => {
    vi.useFakeTimers();
    const gallery = makeGallery();
    gallery.open(0); // never started — playing stays false throughout
    await flush();

    click(button('Zoom in'));
    expect(isPlaying()).toBe(false);

    gallery.destroy();
  });

  it('pauseOnZoom: false is a complete no-op even while zoomed', async () => {
    vi.useFakeTimers();
    const gallery = makeGallery({ autoplay: { pauseOnZoom: false } });
    gallery.open(0);
    await flush();
    click(toggleButton());

    click(button('Zoom in'));
    expect(isPlaying()).toBe(true);

    gallery.destroy();
  });

  it('a slide-change-driven zoom reset (an outgoing zoomed slide silently resetting, not a real interaction) does not itself pause a playing slideshow on a fresh slide', async () => {
    vi.useFakeTimers();
    const gallery = makeGallery({ loop: true });
    gallery.open(0);
    await flush();

    click(button('Zoom in')); // zoom in first, while not playing
    // animate: false — sidesteps SlideTransition entirely (a real, unrelated
    // CSS transition that never settles in jsdom without a synthetic
    // transitionend/fake-timer advance).
    gallery.goTo(1, { animate: false }); // navigates away while still zoomed — reset() now emits zoomChange(scale:1)
    await flush();

    click(toggleButton()); // only now start playing, on the fresh (neutral) slide
    expect(isPlaying()).toBe(true); // the earlier reset-driven event must not have left anything paused

    gallery.destroy();
  });
});

describe('Autoplay — pauseOnRotateFlip (default off)', () => {
  it('is a complete no-op by default, even while rotated', async () => {
    vi.useFakeTimers();
    const gallery = makeGallery();
    gallery.open(0);
    await flush();
    click(toggleButton());

    click(button('Rotate right'));
    expect(isPlaying()).toBe(true);

    gallery.destroy();
  });

  it('pauseOnRotateFlip: true pauses on rotate', async () => {
    vi.useFakeTimers();
    const gallery = makeGallery({ autoplay: { pauseOnRotateFlip: true } });
    gallery.open(0);
    await flush();
    click(toggleButton());

    click(button('Rotate right'));
    expect(isPlaying()).toBe(false);

    gallery.destroy();
  });

  it('regression: still pauses on the click that lands back on the original orientation (rotate x4 = 360deg -> 0), not just the ones that leave it rotated — reported from real usage against an earlier auto-resume design', async () => {
    vi.useFakeTimers();
    const gallery = makeGallery({ autoplay: { pauseOnRotateFlip: true } });
    gallery.open(0);
    await flush();
    click(toggleButton());

    click(button('Rotate right')); // 90
    expect(isPlaying()).toBe(false);

    click(toggleButton()); // manual restart between clicks, mirroring real usage
    click(button('Rotate right')); // 180
    expect(isPlaying()).toBe(false);

    click(toggleButton());
    click(button('Rotate right')); // 270
    expect(isPlaying()).toBe(false);

    click(toggleButton());
    click(button('Rotate right')); // 360 -> normalizes to 0, back at the original orientation
    expect(isPlaying()).toBe(false); // still pauses — this exact click is the one that was reported broken

    gallery.destroy();
  });

  it('regression: pressing Play while already rotated immediately pauses again, instead of running unpaused', async () => {
    vi.useFakeTimers();
    const gallery = makeGallery({ autoplay: { pauseOnRotateFlip: true } });
    gallery.open(0);
    await flush();

    click(button('Rotate right')); // rotate first, while not playing
    click(toggleButton()); // press Play while already rotated
    expect(isPlaying()).toBe(false); // must immediately re-pause

    gallery.destroy();
  });

  it('flipping back to unflipped (same button twice) also pauses on both clicks', async () => {
    vi.useFakeTimers();
    const gallery = makeGallery({ autoplay: { pauseOnRotateFlip: true } });
    gallery.open(0);
    await flush();
    click(toggleButton());

    click(button('Flip horizontal'));
    expect(isPlaying()).toBe(false);

    click(toggleButton());
    click(button('Flip horizontal')); // back to unflipped
    expect(isPlaying()).toBe(false);

    gallery.destroy();
  });

  it('does not pause a slideshow that was never playing to begin with', async () => {
    vi.useFakeTimers();
    const gallery = makeGallery({ autoplay: { pauseOnRotateFlip: true } });
    gallery.open(0);
    await flush();

    click(button('Rotate right'));
    expect(isPlaying()).toBe(false);

    gallery.destroy();
  });
});

describe('Autoplay — view-engagement pausing, general', () => {
  it('is a complete no-op with neither Zoom nor RotateFlip loaded', async () => {
    vi.useFakeTimers();
    const gallery = new Gallery(document.createElement('div'), {
      items,
      plugins: [Autoplay],
      preload: 0,
    });
    gallery.open(0);
    await flush();
    click(toggleButton());
    expect(isPlaying()).toBe(true);

    vi.advanceTimersByTime(5000);
    expect(gallery.currentIndex).toBe(1); // ordinary timed advance, unaffected

    gallery.destroy();
  });
});

/**
 * DESIGN.md §4.1 — a real UX gap, asked about directly: pressing Play
 * while resume is blocked (toggle()'s own re-check above) silently
 * re-pauses in the same synchronous tick — no paint in between, so the
 * button never visibly flips to "Pause" at all before reverting. Looks
 * broken, not just quiet. The Play button is now disabled (aria-disabled
 * + tabIndex removed, matching core's own slide-loading disable pattern)
 * whenever pressing it wouldn't actually take, so "can't resume yet" is
 * an honest, visible state instead of a click that appears to do nothing.
 */
describe('Autoplay — Play button disabled while resume is blocked', () => {
  it('disables the Play button while zoomed in (pauseOnZoom), re-enables once un-zoomed', async () => {
    vi.useFakeTimers();
    const gallery = makeGallery();
    gallery.open(0);
    await flush();
    expect(isToggleDisabled()).toBe(false);

    click(button('Zoom in')); // not playing yet — nothing to pause, but resume is now blocked
    expect(isPlaying()).toBe(false);
    expect(isToggleDisabled()).toBe(true);

    click(button('Zoom out'));
    expect(isToggleDisabled()).toBe(false); // un-zoomed — Play is available again

    gallery.destroy();
  });

  it('disables the Play button while rotated (pauseOnRotateFlip)', async () => {
    vi.useFakeTimers();
    const gallery = makeGallery({ autoplay: { pauseOnRotateFlip: true } });
    gallery.open(0);
    await flush();

    click(button('Rotate right'));
    expect(isToggleDisabled()).toBe(true);

    click(button('Rotate right'));
    click(button('Rotate right'));
    click(button('Rotate right')); // back to 0deg
    expect(isToggleDisabled()).toBe(false);

    gallery.destroy();
  });

  it('never disables the button while actually playing — it must always stay clickable to stop', async () => {
    vi.useFakeTimers();
    const gallery = makeGallery();
    gallery.open(0);
    await flush();
    click(toggleButton());
    expect(isPlaying()).toBe(true);
    expect(isToggleDisabled()).toBe(false);

    gallery.destroy();
  });

  it('pauseOnZoom: false never disables the button, even while zoomed', async () => {
    vi.useFakeTimers();
    const gallery = makeGallery({ autoplay: { pauseOnZoom: false } });
    gallery.open(0);
    await flush();

    click(button('Zoom in'));
    expect(isToggleDisabled()).toBe(false);

    gallery.destroy();
  });

  it('re-enables on a fresh slide even if the outgoing slide was left zoomed', async () => {
    vi.useFakeTimers();
    const gallery = makeGallery({ loop: true });
    gallery.open(0);
    await flush();

    click(button('Zoom in'));
    expect(isToggleDisabled()).toBe(true);

    gallery.goTo(1, { animate: false });
    await flush();
    expect(isToggleDisabled()).toBe(false);

    gallery.destroy();
  });
});
