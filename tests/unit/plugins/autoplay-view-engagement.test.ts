import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Gallery } from '../../../src/core';
import { Autoplay } from '../../../src/plugins/autoplay';
import { Zoom } from '../../../src/plugins/zoom';
import { RotateFlip } from '../../../src/plugins/rotateFlip';
import type { GalleryItem } from '../../../src/core/types';
import type { PluginContext } from '../../../src/core/plugin';

/** A minimal stand-in for a host-authored custom plugin — captures `ctx.emit` so a test can fire a `request*` command the same way a real custom plugin's own button click would, with zero import of Autoplay/Zoom/RotateFlip. */
class EmitterPlugin {
  name = 'test-emitter';
  emit!: PluginContext['emit'];
  init(ctx: PluginContext): void {
    this.emit = ctx.emit;
  }
}

/**
 * DESIGN.md §4.1 — `onZoom`/`onRotateFlip`/`onCaptionExpand`, all default
 * `'stop'`: a real UX gap, not a reported bug, fixed alongside the
 * rotate/zoom-under-rotation work above. Autoplay only reacts to
 * zoomChange/rotateFlipChange's event *shape* (`core/types.ts`) — never
 * imports either plugin directly — so these tests load all three together,
 * the same cross-plugin pattern `layout-automeasure.test.ts` already
 * established, and drive the interaction through each plugin's own real,
 * public toolbar buttons rather than faking the event bus directly.
 *
 * `'stop'` mode (this file's default, tested throughout the three
 * describe blocks below) deliberately **stays paused** rather than
 * auto-resuming once back at neutral — a real bug, reported from real
 * usage against an earlier, edge-tracked auto-resume design that always
 * auto-resumed: rotating back to the original orientation is still an
 * active interaction with the view controls, not "nothing happened," so
 * it must not silently resume either. `'pause'` mode (its own describe
 * block further down) is a *second*, differently-built attempt at that
 * same auto-resume idea — a debounce is what actually fixes the earlier
 * attempt's failure mode, not just re-adding instant auto-resume under a
 * new name (`RESUME_DEBOUNCE_MS`'s own doc comment, `autoplay/index.ts`).
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

describe("Autoplay — onZoom: 'stop' (the default)", () => {
  it('onZoom: false is a complete no-op, even while zoomed', async () => {
    vi.useFakeTimers();
    const gallery = makeGallery({ autoplay: { onZoom: false } });
    gallery.open(0);
    await flush();
    click(toggleButton());

    click(button('Zoom in'));
    expect(isPlaying()).toBe(true);

    gallery.destroy();
  });

  it('pauses a playing slideshow on zoom-in by default, with no options passed at all', async () => {
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
    const gallery = makeGallery({ autoplay: { onZoom: 'stop' } });
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
    const gallery = makeGallery({ autoplay: { onZoom: 'stop' } });
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
    const gallery = makeGallery({ autoplay: { onZoom: 'stop' } });
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

  it('requestAutoplayStart (DESIGN.md §4.1 point 20) gets the same manual-start re-check as the real Play button — a custom plugin starting the slideshow while already zoomed in immediately re-pauses too', async () => {
    vi.useFakeTimers();
    const emitter = new EmitterPlugin();
    const gallery = new Gallery(document.createElement('div'), {
      items,
      plugins: [Autoplay, Zoom, RotateFlip, emitter],
      preload: 0,
      autoplay: { onZoom: 'stop' },
    });
    gallery.open(0);
    await flush();

    doubleTapAt(150, 150); // zoom in first, while not playing
    expect(isPlaying()).toBe(false);

    emitter.emit('requestAutoplayStart', {}); // custom plugin starts it while already zoomed in
    expect(isPlaying()).toBe(false); // must immediately re-pause, not run unpaused

    gallery.destroy();
  });

  it('does not pause a slideshow that was never playing to begin with', async () => {
    vi.useFakeTimers();
    const gallery = makeGallery({ autoplay: { onZoom: 'stop' } });
    gallery.open(0); // never started — playing stays false throughout
    await flush();

    click(button('Zoom in'));
    expect(isPlaying()).toBe(false);

    gallery.destroy();
  });

  it('a slide-change-driven zoom reset (an outgoing zoomed slide silently resetting, not a real interaction) does not itself pause a playing slideshow on a fresh slide', async () => {
    vi.useFakeTimers();
    const gallery = makeGallery({ loop: true, autoplay: { onZoom: 'stop' } });
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

/**
 * `onZoom`/`onRotateFlip`: `'pause'` mode — auto-resumes once genuinely
 * disengaged, unlike `'stop'` mode above. `RESUME_DEBOUNCE_MS`
 * (`autoplay/index.ts`) is 1000ms; every test here uses
 * `vi.advanceTimersByTime()` relative to that, never a real wait.
 */
describe("Autoplay — onZoom/onRotateFlip: 'pause' mode auto-resume", () => {
  it('resumes on its own once the debounce elapses after un-zooming, unlike stop mode', async () => {
    vi.useFakeTimers();
    const gallery = makeGallery({ autoplay: { onZoom: 'pause' } });
    gallery.open(0);
    await flush();
    click(toggleButton());

    click(button('Zoom in'));
    expect(isPlaying()).toBe(false);
    click(button('Zoom out')); // back to neutral — disengaged, but not yet debounced
    expect(isPlaying()).toBe(false);

    vi.advanceTimersByTime(999);
    expect(isPlaying()).toBe(false); // not yet — still inside the debounce window
    vi.advanceTimersByTime(1);
    expect(isPlaying()).toBe(true); // debounce elapsed with nothing re-engaging it

    gallery.destroy();
  });

  it("regression (the earlier auto-resume design's second real problem): re-zooming before the debounce elapses cancels and restarts it, instead of resuming mid-interaction", async () => {
    vi.useFakeTimers();
    const gallery = makeGallery({ autoplay: { onZoom: 'pause' } });
    gallery.open(0);
    await flush();
    click(toggleButton());

    click(button('Zoom in'));
    click(button('Zoom out')); // disengage #1 — schedules a resume
    vi.advanceTimersByTime(700); // well inside the 1000ms window, not yet fired
    click(button('Zoom in')); // re-engage before it could fire
    expect(isPlaying()).toBe(false);
    click(button('Zoom out')); // disengage #2 — must restart the wait, not reuse the old one's remaining time

    vi.advanceTimersByTime(700); // would have fired by now under the old (cancelled) schedule
    expect(isPlaying()).toBe(false); // must not have resumed mid-interaction
    vi.advanceTimersByTime(300); // completes the full 1000ms from disengage #2
    expect(isPlaying()).toBe(true);

    gallery.destroy();
  });

  it("regression (the earlier auto-resume design's first real problem): a manual restart while still zoomed doesn't leave the resume tracking stuck — it still resumes once genuinely disengaged afterward", async () => {
    vi.useFakeTimers();
    const gallery = makeGallery({ autoplay: { onZoom: 'pause' } });
    gallery.open(0);
    await flush();
    click(toggleButton());

    click(button('Zoom in'));
    expect(isPlaying()).toBe(false);

    click(toggleButton()); // manual restart while still zoomed — immediately re-pauses (reCheckEngagedAfterManualStart)
    expect(isPlaying()).toBe(false);

    click(button('Zoom out'));
    vi.advanceTimersByTime(1000);
    expect(isPlaying()).toBe(true); // not stuck "already engaged" — the resume tracking survived the manual restart

    gallery.destroy();
  });

  it('a manual pause during ordinary playback is a hard stop — it does not later spring back to life just because zoom state happens to change afterward', async () => {
    vi.useFakeTimers();
    const gallery = makeGallery({ autoplay: { onZoom: 'pause' } });
    gallery.open(0);
    await flush();
    click(toggleButton());
    click(toggleButton()); // manual pause — nothing to do with zoom at all
    expect(isPlaying()).toBe(false);

    click(button('Zoom in'));
    click(button('Zoom out'));
    vi.advanceTimersByTime(2000);
    expect(isPlaying()).toBe(false); // stays stopped — this was never a pending pause-mode resume

    gallery.destroy();
  });

  it('navigating to a different slide while a resume is pending cancels it — the slide it was paused for is no longer even active', async () => {
    vi.useFakeTimers();
    const gallery = makeGallery({ loop: true, autoplay: { onZoom: 'pause' } });
    gallery.open(0);
    await flush();
    click(toggleButton());

    click(button('Zoom in'));
    click(button('Zoom out')); // schedules a resume
    gallery.goTo(1, { animate: false }); // manual nav before it fires — stopOnManualNavigate (default true) also stops playback
    await flush();

    vi.advanceTimersByTime(2000);
    expect(isPlaying()).toBe(false); // the cancelled resume never fires on the new slide

    gallery.destroy();
  });

  it("a 'stop'-mode trigger cancels a different trigger's still-pending 'pause'-mode resume — a hard stop always wins", async () => {
    vi.useFakeTimers();
    const gallery = makeGallery({ autoplay: { onZoom: 'pause', onRotateFlip: 'stop' } });
    gallery.open(0);
    await flush();
    click(toggleButton());

    click(button('Zoom in'));
    click(button('Zoom out')); // schedules a pause-mode resume
    click(button('Rotate right')); // a hard stop from a different, 'stop'-mode trigger
    expect(isPlaying()).toBe(false);

    vi.advanceTimersByTime(2000);
    expect(isPlaying()).toBe(false); // the zoom-side resume must not resurrect it

    gallery.destroy();
  });

  it("regression, RotateFlip's own equivalent of the earlier design's second real problem: rotating x4 back to 0 (four separate disengage-eligible moments) only resumes once idle after the last one, not mid-sequence", async () => {
    vi.useFakeTimers();
    const gallery = makeGallery({ autoplay: { onRotateFlip: 'pause' } });
    gallery.open(0);
    await flush();
    click(toggleButton());

    click(button('Rotate right')); // 90
    vi.advanceTimersByTime(400);
    click(button('Rotate right')); // 180 — still engaged throughout, so nothing was ever scheduled yet
    vi.advanceTimersByTime(400);
    click(button('Rotate right')); // 270
    vi.advanceTimersByTime(400);
    click(button('Rotate right')); // 360 -> 0 — the original orientation, and the last click
    expect(isPlaying()).toBe(false);

    vi.advanceTimersByTime(999);
    expect(isPlaying()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(isPlaying()).toBe(true); // resumed only once truly idle after the last click

    gallery.destroy();
  });
});

describe("Autoplay — onRotateFlip: 'stop' (the default)", () => {
  it('onRotateFlip: false is a complete no-op, even while rotated', async () => {
    vi.useFakeTimers();
    const gallery = makeGallery({ autoplay: { onRotateFlip: false } });
    gallery.open(0);
    await flush();
    click(toggleButton());

    click(button('Rotate right'));
    expect(isPlaying()).toBe(true);

    gallery.destroy();
  });

  it('pauses on rotate by default, with no options passed at all', async () => {
    vi.useFakeTimers();
    const gallery = makeGallery();
    gallery.open(0);
    await flush();
    click(toggleButton());

    click(button('Rotate right'));
    expect(isPlaying()).toBe(false);

    gallery.destroy();
  });

  it('regression: still pauses on the click that lands back on the original orientation (rotate x4 = 360deg -> 0), not just the ones that leave it rotated — reported from real usage against an earlier auto-resume design', async () => {
    vi.useFakeTimers();
    const gallery = makeGallery({ autoplay: { onRotateFlip: 'stop' } });
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
    const gallery = makeGallery({ autoplay: { onRotateFlip: 'stop' } });
    gallery.open(0);
    await flush();

    click(button('Rotate right')); // rotate first, while not playing
    click(toggleButton()); // press Play while already rotated
    expect(isPlaying()).toBe(false); // must immediately re-pause

    gallery.destroy();
  });

  it('flipping back to unflipped (same button twice) also pauses on both clicks', async () => {
    vi.useFakeTimers();
    const gallery = makeGallery({ autoplay: { onRotateFlip: 'stop' } });
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
    const gallery = makeGallery({ autoplay: { onRotateFlip: 'stop' } });
    gallery.open(0);
    await flush();

    click(button('Rotate right'));
    expect(isPlaying()).toBe(false);

    gallery.destroy();
  });
});

/**
 * DESIGN.md §2.3a/§4-autoplay — `onCaptionExpand` (default 'stop'),
 * requested directly: expanding a truncated caption to read the rest is the
 * viewer asking for time, not an idle moment to advance past. Reuses
 * `core-lightbox.test.ts`'s own `mockTruncated()` approach — jsdom has no
 * real layout engine, so truncation can't be exercised through real
 * geometry, only through the scrollHeight/clientHeight comparison
 * `updateCaptionTruncation()` actually makes.
 *
 * No "pressed Play while already engaged" regression test here, unlike
 * onZoom/onRotateFlip above — that scenario is structurally
 * impossible for this one: the caption modal traps both pointer and
 * keyboard input while open (core's own focus trap plus a capture-phase
 * keydown handler that stops propagation for every key, not just Escape),
 * so the toolbar's Play button is physically unreachable until the modal
 * is already closed. See `onCaptionExpand`'s own doc comment
 * (autoplay/index.ts).
 */
describe("Autoplay — onCaptionExpand: 'stop' (the default)", () => {
  afterEach(() => {
    // Not vi.spyOn — jsdom's Range doesn't define this method at all, so
    // mockTruncated() below assigns it outright; the top-level afterEach's
    // vi.restoreAllMocks() doesn't touch a non-spied assignment.
    delete (Range.prototype as { getClientRects?: unknown }).getClientRects;
  });

  function mockTruncated(): void {
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(100);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(10);
    Range.prototype.getClientRects = vi.fn().mockReturnValue([]);
  }

  function caption(): HTMLElement {
    return document.querySelector('.shoji-caption') as HTMLElement;
  }

  function modal(): HTMLElement {
    return document.querySelector('.shoji-caption-modal') as HTMLElement;
  }

  function openCaptionModal(): void {
    caption().dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }

  function makeGalleryWithCaption(options: Record<string, unknown> = {}): Gallery {
    return new Gallery(document.createElement('div'), {
      items: [{ id: 'a', src: 'a.jpg', caption: 'the full text' }],
      plugins: [Autoplay],
      preload: 0,
      ...options,
    });
  }

  it('onCaptionExpand: false is a complete no-op, even while the caption modal is open', async () => {
    vi.useFakeTimers();
    mockTruncated();
    const gallery = makeGalleryWithCaption({ autoplay: { onCaptionExpand: false } });
    gallery.open(0);
    await flush();
    click(toggleButton());
    expect(isPlaying()).toBe(true);

    openCaptionModal();
    expect(modal().hidden).toBe(false);
    expect(isPlaying()).toBe(true);

    gallery.destroy();
  });

  it('pauses a playing slideshow when the caption modal opens, by default, with no options passed at all', async () => {
    vi.useFakeTimers();
    mockTruncated();
    const gallery = makeGalleryWithCaption();
    gallery.open(0);
    await flush();
    click(toggleButton());
    expect(isPlaying()).toBe(true);

    openCaptionModal();
    expect(isPlaying()).toBe(false);

    gallery.destroy();
  });

  it('stays paused once the caption modal closes — no auto-resume', async () => {
    vi.useFakeTimers();
    mockTruncated();
    const gallery = makeGalleryWithCaption({ autoplay: { onCaptionExpand: 'stop' } });
    gallery.open(0);
    await flush();
    click(toggleButton());

    openCaptionModal();
    expect(isPlaying()).toBe(false);

    (document.querySelector('.shoji-caption-modal-close') as HTMLButtonElement).click();
    expect(modal().hidden).toBe(true);
    expect(isPlaying()).toBe(false); // still paused, not auto-resumed

    gallery.destroy();
  });

  it('does not pause a slideshow that was never playing to begin with', async () => {
    vi.useFakeTimers();
    mockTruncated();
    const gallery = makeGalleryWithCaption({ autoplay: { onCaptionExpand: 'stop' } });
    gallery.open(0); // never started — playing stays false throughout
    await flush();

    openCaptionModal();
    expect(isPlaying()).toBe(false);

    gallery.destroy();
  });

  it('never disables the Play button while the modal is open — unlike onZoom/onRotateFlip, Play is already unreachable there by construction, so there is nothing for this plugin to additionally guard', async () => {
    vi.useFakeTimers();
    mockTruncated();
    const gallery = makeGalleryWithCaption({ autoplay: { onCaptionExpand: 'stop' } });
    gallery.open(0);
    await flush();
    click(toggleButton());

    openCaptionModal();
    expect(isPlaying()).toBe(false);
    expect(isToggleDisabled()).toBe(false);

    gallery.destroy();
  });

  describe("'pause' mode auto-resume", () => {
    it('resumes on its own, debounced, once the caption modal closes', async () => {
      vi.useFakeTimers();
      mockTruncated();
      const gallery = makeGalleryWithCaption({ autoplay: { onCaptionExpand: 'pause' } });
      gallery.open(0);
      await flush();
      click(toggleButton());

      openCaptionModal();
      expect(isPlaying()).toBe(false);

      (document.querySelector('.shoji-caption-modal-close') as HTMLButtonElement).click();
      expect(isPlaying()).toBe(false); // not yet — still inside the debounce window

      vi.advanceTimersByTime(1000);
      expect(isPlaying()).toBe(true);

      gallery.destroy();
    });
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
  it('disables the Play button while zoomed in (onZoom), re-enables once un-zoomed', async () => {
    vi.useFakeTimers();
    const gallery = makeGallery({ autoplay: { onZoom: 'stop' } });
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

  it('disables the Play button while rotated (onRotateFlip)', async () => {
    vi.useFakeTimers();
    const gallery = makeGallery({ autoplay: { onRotateFlip: 'stop' } });
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

  it('never disables the button while zoomed, with onZoom: false', async () => {
    vi.useFakeTimers();
    const gallery = makeGallery({ autoplay: { onZoom: false } });
    gallery.open(0);
    await flush();

    click(button('Zoom in'));
    expect(isToggleDisabled()).toBe(false);

    gallery.destroy();
  });

  it('re-enables on a fresh slide even if the outgoing slide was left zoomed', async () => {
    vi.useFakeTimers();
    const gallery = makeGallery({ loop: true, autoplay: { onZoom: 'stop' } });
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
