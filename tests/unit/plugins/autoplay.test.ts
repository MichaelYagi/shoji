import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Gallery } from '../../../src/core';
import type { PluginContext } from '../../../src/core/plugin';
import { Autoplay } from '../../../src/plugins/autoplay';

beforeEach(() => {
  HTMLImageElement.prototype.decode = vi.fn().mockResolvedValue(undefined);
  HTMLVideoElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  HTMLVideoElement.prototype.pause = vi.fn();
  HTMLVideoElement.prototype.load = vi.fn();
});

afterEach(() => {
  vi.useRealTimers();
  // @ts-expect-error - removing the test-only stubs added above
  delete HTMLImageElement.prototype.decode;
  // @ts-expect-error - removing the test-only stubs added above
  delete HTMLVideoElement.prototype.play;
  // @ts-expect-error - removing the test-only stubs added above
  delete HTMLVideoElement.prototype.pause;
  // @ts-expect-error - removing the test-only stubs added above
  delete HTMLVideoElement.prototype.load;
  document.body.innerHTML = '';
});

const items = [
  { id: 'a', src: 'a.jpg' },
  { id: 'b', src: 'b.jpg' },
  { id: 'video', src: 'v.mp4', video: { provider: 'html5' as const } },
  { id: 'd', src: 'd.jpg' },
];

function makeGallery(options: Record<string, unknown> = {}) {
  const el = document.createElement('div');
  return new Gallery(el, { items, plugins: [Autoplay], preload: 0, ...options });
}

function toggleButton(): HTMLButtonElement {
  // 'right' — clusters immediately before the close button (DESIGN.md §3.1).
  // :not(.shoji-caption-toggle) excludes core's own video-caption toggle
  // button, which now also lives in this slot (hidden outside a captioned
  // video slide, but still a real .shoji-toolbar-button in the DOM).
  return document.querySelector(
    '.shoji-toolbar-right .shoji-toolbar-button:not(.shoji-caption-toggle)',
  ) as HTMLButtonElement;
}

function click(el: Element): void {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

function activeVideo(): HTMLVideoElement | null {
  return (document.querySelector('.shoji-slide-media video') as HTMLVideoElement) ?? null;
}

describe('Autoplay — button & basic timing', () => {
  it('inserts a play button in the toolbar, starting in the "Play" state', () => {
    const gallery = makeGallery();
    gallery.open(0);

    const button = toggleButton();
    expect(button).not.toBeNull();
    expect(button.getAttribute('aria-label')).toBe('Play slideshow');

    gallery.destroy();
  });

  it('clicking play flips the button to "Pause" and advances after the default 5000ms', () => {
    vi.useFakeTimers();
    const gallery = makeGallery();
    gallery.open(0);

    click(toggleButton());
    expect(toggleButton().getAttribute('aria-label')).toBe('Pause slideshow');
    expect(gallery.currentIndex).toBe(0);

    vi.advanceTimersByTime(5000);
    expect(gallery.currentIndex).toBe(1);

    gallery.destroy();
  });

  it('honors a custom interval option', () => {
    vi.useFakeTimers();
    const gallery = makeGallery({ autoplay: { interval: 1000 } });
    gallery.open(0);

    click(toggleButton());
    vi.advanceTimersByTime(999);
    expect(gallery.currentIndex).toBe(0);
    vi.advanceTimersByTime(1);
    expect(gallery.currentIndex).toBe(1);

    gallery.destroy();
  });

  it('shows the progress bar by default while playing a timed slide', () => {
    vi.useFakeTimers();
    const gallery = makeGallery();
    gallery.open(0);

    expect(document.querySelector('.shoji-autoplay-progress')).not.toBeNull();
    click(toggleButton());
    expect(document.querySelector('.shoji-autoplay-progress')?.hasAttribute('hidden')).toBe(false);

    gallery.destroy();
  });

  it('showProgress: false never mounts the progress bar at all', () => {
    vi.useFakeTimers();
    const gallery = makeGallery({ autoplay: { showProgress: false } });
    gallery.open(0);

    click(toggleButton());
    vi.advanceTimersByTime(2000);
    expect(document.querySelector('.shoji-autoplay-progress')).toBeNull();

    // Purely presentational — timing is unaffected.
    vi.advanceTimersByTime(3000);
    expect(gallery.currentIndex).toBe(1);

    gallery.destroy();
  });

  it('clicking pause stops the timer — the clock advancing further does not navigate', () => {
    vi.useFakeTimers();
    const gallery = makeGallery();
    gallery.open(0);

    click(toggleButton()); // play
    click(toggleButton()); // pause
    expect(toggleButton().getAttribute('aria-label')).toBe('Play slideshow');

    vi.advanceTimersByTime(10_000);
    expect(gallery.currentIndex).toBe(0);

    gallery.destroy();
  });

  it('Space toggles play/pause', () => {
    vi.useFakeTimers();
    const gallery = makeGallery();
    gallery.open(0);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    expect(toggleButton().getAttribute('aria-label')).toBe('Pause slideshow');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    expect(toggleButton().getAttribute('aria-label')).toBe('Play slideshow');

    gallery.destroy();
  });

  it('wraps via the core loop option — no separate autoplay-level loop setting needed', () => {
    vi.useFakeTimers();
    const gallery = makeGallery(); // loop: true is the Gallery default
    gallery.open(3); // last item

    click(toggleButton());
    vi.advanceTimersByTime(5000);
    expect(gallery.currentIndex).toBe(0); // wrapped

    gallery.destroy();
  });

  it('with loop: false, reaching the last slide auto-stops instead of ticking forever', () => {
    vi.useFakeTimers();
    const gallery = makeGallery({ loop: false });
    gallery.open(3); // last item

    click(toggleButton());
    vi.advanceTimersByTime(5000);

    expect(gallery.currentIndex).toBe(3); // stayed
    expect(toggleButton().getAttribute('aria-label')).toBe('Play slideshow'); // auto-stopped

    gallery.destroy();
  });

  it('manual navigation mid-slideshow re-times from the newly active slide, not doubled up', () => {
    vi.useFakeTimers();
    const gallery = makeGallery();
    gallery.open(0);
    click(toggleButton());

    vi.advanceTimersByTime(3000);
    gallery.goTo(1); // manual jump partway through the countdown

    // if the old timer weren't cleared, it would fire at the 5000ms mark
    // (2000ms from now) landing on index 2 *in addition to* the fresh timer
    vi.advanceTimersByTime(2000);
    expect(gallery.currentIndex).toBe(1); // old timer didn't fire

    vi.advanceTimersByTime(3000); // fresh 5000ms timer for index 1 completes
    expect(gallery.currentIndex).toBe(2);

    gallery.destroy();
  });

  it('closing the gallery stops autoplay so reopening starts fresh, not mid-countdown', () => {
    vi.useFakeTimers();
    const gallery = makeGallery();
    gallery.open(0);
    click(toggleButton());
    vi.advanceTimersByTime(3000);

    gallery.close();
    gallery.open(0);

    expect(toggleButton().getAttribute('aria-label')).toBe('Play slideshow');
    vi.advanceTimersByTime(3000); // the closed instance's old timer, if it survived, would fire here
    expect(gallery.currentIndex).toBe(0);

    gallery.destroy();
  });
});

describe('Autoplay — video-aware behavior', () => {
  it('arriving at a video slide plays it instead of starting a fixed-interval timer', async () => {
    vi.useFakeTimers();
    const gallery = makeGallery();
    gallery.open(2); // the video slide directly

    click(toggleButton());
    await vi.advanceTimersByTimeAsync(0);

    expect(HTMLVideoElement.prototype.play).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5000); // default interval must NOT apply to video
    expect(gallery.currentIndex).toBe(2); // still on the video

    gallery.destroy();
  });

  it("the video's ended event advances to the next slide", async () => {
    vi.useFakeTimers();
    const gallery = makeGallery();
    gallery.open(2);
    click(toggleButton());
    await vi.advanceTimersByTimeAsync(0);

    activeVideo()!.dispatchEvent(new Event('ended'));
    expect(gallery.currentIndex).toBe(3);

    gallery.destroy();
  });

  it('a manual pause on the video (not from ending) pauses the whole slideshow', async () => {
    vi.useFakeTimers();
    const gallery = makeGallery();
    gallery.open(2);
    click(toggleButton());
    await vi.advanceTimersByTimeAsync(0);

    const video = activeVideo()!;
    Object.defineProperty(video, 'ended', { value: false, configurable: true });
    video.dispatchEvent(new Event('pause'));

    expect(toggleButton().getAttribute('aria-label')).toBe('Play slideshow');
    expect(HTMLVideoElement.prototype.pause).not.toHaveBeenCalled(); // it's already paused — the event came from the user, not us

    gallery.destroy();
  });

  it('a pause fired alongside the natural end (video.ended === true) does not also stop the slideshow via onVideoPause', async () => {
    // 'ended' itself already advances (previous test) — this confirms the
    // 'pause' some browsers fire right alongside 'ended' isn't ALSO
    // mistaken for a manual interrupt and stopped a second time.
    vi.useFakeTimers();
    const gallery = makeGallery();
    gallery.open(2);
    click(toggleButton());
    await vi.advanceTimersByTimeAsync(0);

    const video = activeVideo()!;
    Object.defineProperty(video, 'ended', { value: true, configurable: true });
    video.dispatchEvent(new Event('pause'));
    video.dispatchEvent(new Event('ended'));

    expect(gallery.currentIndex).toBe(3); // advanced normally
    expect(toggleButton().getAttribute('aria-label')).toBe('Pause slideshow'); // still playing (index 3 is an image slide, timer running)

    gallery.destroy();
  });

  it('resuming the video manually after a pause-interrupt does NOT resume the slideshow or auto-advance on a later ended', async () => {
    vi.useFakeTimers();
    const gallery = makeGallery();
    gallery.open(2);
    click(toggleButton());
    await vi.advanceTimersByTimeAsync(0);

    const video = activeVideo()!;
    Object.defineProperty(video, 'ended', { value: false, configurable: true });
    video.dispatchEvent(new Event('pause')); // slideshow now paused

    video.dispatchEvent(new Event('play')); // user manually resumes the video itself
    video.dispatchEvent(new Event('ended')); // ...and later it finishes

    expect(gallery.currentIndex).toBe(2); // did NOT advance — slideshow stayed paused throughout
    expect(toggleButton().getAttribute('aria-label')).toBe('Play slideshow');

    gallery.destroy();
  });

  it('explicitly pressing play again after a video-pause interrupt re-engages and re-plays the current video', async () => {
    vi.useFakeTimers();
    const gallery = makeGallery();
    gallery.open(2);
    click(toggleButton());
    await vi.advanceTimersByTimeAsync(0);

    const video = activeVideo()!;
    Object.defineProperty(video, 'ended', { value: false, configurable: true });
    video.dispatchEvent(new Event('pause'));
    expect(toggleButton().getAttribute('aria-label')).toBe('Play slideshow');

    vi.mocked(HTMLVideoElement.prototype.play).mockClear();
    click(toggleButton()); // explicit resume via the slideshow's own control
    await vi.advanceTimersByTimeAsync(0);

    expect(toggleButton().getAttribute('aria-label')).toBe('Pause slideshow');
    expect(HTMLVideoElement.prototype.play).toHaveBeenCalledTimes(1);

    gallery.destroy();
  });

  it('a blocked (rejected) autoplay attempt gracefully stops the slideshow instead of hanging', async () => {
    vi.useFakeTimers();
    HTMLVideoElement.prototype.play = vi.fn().mockRejectedValue(new Error('NotAllowedError'));
    const gallery = makeGallery();
    gallery.open(2);

    click(toggleButton());
    await vi.advanceTimersByTimeAsync(0);

    expect(toggleButton().getAttribute('aria-label')).toBe('Play slideshow'); // auto-stopped
    expect(gallery.currentIndex).toBe(2); // never advanced

    gallery.destroy();
  });

  it('stopping the slideshow while a video is actively playing also pauses the video', async () => {
    vi.useFakeTimers();
    const gallery = makeGallery();
    gallery.open(2);
    click(toggleButton());
    await vi.advanceTimersByTimeAsync(0);

    const video = activeVideo()!;
    Object.defineProperty(video, 'paused', { value: false, configurable: true });
    click(toggleButton()); // explicit slideshow pause, not a video-originated one

    expect(HTMLVideoElement.prototype.pause).toHaveBeenCalledTimes(1);

    gallery.destroy();
  });
});

describe('Autoplay — provider video (§4-video, e.g. YouTube)', () => {
  // A minimal test-only stand-in for the real Video plugin — registers a
  // 'youtube' renderer that wires up the same play/pause/paused/ended
  // contract youtube.ts's wirePlayableContract does, without any of the
  // real IFrame API/network involved. Exercises Autoplay's own
  // findPlayable() fallback in isolation.
  function fakeVideoProviderPlugin() {
    return {
      name: 'fakeVideoProvider',
      init: (ctx: PluginContext) =>
        ctx.ui.registerVideoProvider(
          'youtube',
          (container: HTMLElement, _item, onReady: () => void) => {
            const playable = container as HTMLElement & {
              play: () => void;
              pause: () => void;
              paused: boolean;
              ended: boolean;
              muted: boolean;
            };
            playable.paused = true;
            playable.ended = false;
            playable.muted = false;
            playable.play = () => {
              playable.paused = false;
              playable.dispatchEvent(new Event('play'));
            };
            playable.pause = () => {
              playable.paused = true;
              playable.dispatchEvent(new Event('pause'));
            };
            onReady();
          },
        ),
    };
  }

  const videoItems = [
    { id: 'a', src: 'a.jpg' },
    { id: 'yt', src: 'https://youtu.be/x', video: { provider: 'youtube' as const, id: 'x' } },
    { id: 'd', src: 'd.jpg' },
  ];

  function makeProviderGallery() {
    const el = document.createElement('div');
    return new Gallery(el, {
      items: videoItems,
      plugins: [Autoplay, fakeVideoProviderPlugin()],
      preload: 0,
    });
  }

  // Unlike fakeVideoProviderPlugin above (which wires up synchronously —
  // matching a provider that's already warm), this one defers wiring until
  // the test calls the captured trigger — matching a real provider's async
  // setup (e.g. loading the YouTube IFrame API cold).
  function delayedVideoProviderPlugin(onRegister: (triggerReady: () => void) => void) {
    return {
      name: 'delayedVideoProvider',
      init: (ctx: PluginContext) =>
        ctx.ui.registerVideoProvider(
          'youtube',
          (container: HTMLElement, _item, onReady: () => void) => {
            const playable = container as HTMLElement & {
              play: () => void;
              pause: () => void;
              paused: boolean;
              ended: boolean;
            };
            onRegister(() => {
              playable.paused = true;
              playable.ended = false;
              playable.play = () => {
                playable.paused = false;
                playable.dispatchEvent(new Event('play'));
              };
              playable.pause = () => {
                playable.paused = true;
                playable.dispatchEvent(new Event('pause'));
              };
              onReady();
            });
            // deliberately does not call onReady() here
          },
        ),
    };
  }

  function providerContainer(): (HTMLElement & { paused?: boolean; ended?: boolean }) | null {
    return document.querySelector('.shoji-slide-provider-video');
  }

  // Simulates a provider whose postMessage bridge silently drops the first
  // `failCount` play() commands (a real bug, found via CI — DESIGN.md
  // §4.1 point 9) before finally taking one.
  function flakyVideoProviderPlugin(failCount: number) {
    let attempts = 0;
    return {
      name: 'flakyVideoProvider',
      init: (ctx: PluginContext) =>
        ctx.ui.registerVideoProvider(
          'youtube',
          (container: HTMLElement, _item, onReady: () => void) => {
            const playable = container as HTMLElement & {
              play: () => void;
              pause: () => void;
              paused: boolean;
              ended: boolean;
              muted: boolean;
            };
            playable.paused = true;
            playable.ended = false;
            playable.muted = false;
            playable.play = () => {
              attempts++;
              if (attempts <= failCount) return; // dropped, same as a too-early real command
              playable.paused = false;
              playable.dispatchEvent(new Event('play'));
            };
            playable.pause = () => {
              playable.paused = true;
              playable.dispatchEvent(new Event('pause'));
            };
            onReady();
          },
        ),
    };
  }

  it('arriving at a provider-video slide plays it instead of starting the fixed-interval timer', () => {
    vi.useFakeTimers();
    const gallery = makeProviderGallery();
    gallery.open(1); // the YouTube slide directly

    click(toggleButton());
    const container = providerContainer()!;
    expect(container.paused).toBe(false); // our fake play() flips it via the 'play' event

    vi.advanceTimersByTime(5000); // default interval must NOT apply
    expect(gallery.currentIndex).toBe(1); // still on the video slide

    gallery.destroy();
  });

  it('regression: retries an automatic play if the first attempt(s) silently do nothing, instead of leaving the video stuck paused', () => {
    vi.useFakeTimers();
    const el = document.createElement('div');
    const gallery = new Gallery(el, {
      items: videoItems,
      plugins: [Autoplay, flakyVideoProviderPlugin(3)], // first 3 play() calls are silently dropped
      preload: 0,
    });
    gallery.open(1);

    click(toggleButton());
    const container = providerContainer()!;
    expect(container.paused).toBe(true); // 1st attempt (at click time) didn't take

    vi.advanceTimersByTime(400);
    expect(container.paused).toBe(true); // 2nd attempt didn't take either

    vi.advanceTimersByTime(400);
    expect(container.paused).toBe(true); // 3rd attempt didn't take either

    vi.advanceTimersByTime(400);
    expect(container.paused).toBe(false); // 4th attempt finally does

    gallery.destroy();
  });

  it('regression: gives up and stops the slideshow if every retry attempt is exhausted, instead of leaving it silently stuck forever', () => {
    vi.useFakeTimers();
    const el = document.createElement('div');
    const gallery = new Gallery(el, {
      items: videoItems,
      plugins: [Autoplay, flakyVideoProviderPlugin(999)], // never actually takes
      preload: 0,
    });
    gallery.open(1);

    click(toggleButton());
    expect(toggleButton().getAttribute('aria-label')).toBe('Pause slideshow');

    vi.advanceTimersByTime(400 * 9); // initial attempt + MAX_PROVIDER_PLAY_ATTEMPTS retries, all exhausted
    expect(toggleButton().getAttribute('aria-label')).toBe('Play slideshow'); // stop() was called

    gallery.destroy();
  });

  it('regression: mutes a provider video before an automatic play — cross-origin embeds silently refuse to autoplay unmuted without a direct gesture on the embed itself, unlike native <video>', () => {
    vi.useFakeTimers();
    const gallery = makeProviderGallery();
    gallery.open(1);

    click(toggleButton()); // this click is a direct gesture on the *toolbar button*, not the embed
    const container = providerContainer() as HTMLElement & { muted?: boolean };
    expect(container.muted).toBe(true);

    gallery.destroy();
  });

  it("the provider container's own 'ended' event advances to the next slide", () => {
    vi.useFakeTimers();
    const gallery = makeProviderGallery();
    gallery.open(1);
    click(toggleButton());

    providerContainer()!.dispatchEvent(new Event('ended'));

    expect(gallery.currentIndex).toBe(2);
    gallery.destroy();
  });

  it('a manual pause on the provider container pauses the whole slideshow, same as native video', () => {
    vi.useFakeTimers();
    const gallery = makeProviderGallery();
    gallery.open(1);
    click(toggleButton());

    const container = providerContainer()!;
    container.ended = false;
    container.dispatchEvent(new Event('pause'));

    expect(toggleButton().getAttribute('aria-label')).toBe('Play slideshow');
    gallery.destroy();
  });

  it('regression: a provider video still mid-setup when the slideshow arrives gets played once it becomes ready, instead of being silently treated as an ordinary timed slide', () => {
    // The real bug this fixes: a YouTube slide's container is attached
    // immediately, but .play isn't wired until the (async) IFrame API
    // finishes loading — findPlayable() alone can't tell "no video here"
    // apart from "video here, not ready yet" at the moment afterSlide
    // fires, and used to just fall through to the fixed-interval timer,
    // silently never playing the video at all.
    vi.useFakeTimers();
    let triggerReady: (() => void) | null = null;
    const el = document.createElement('div');
    const gallery = new Gallery(el, {
      items: videoItems,
      plugins: [Autoplay, delayedVideoProviderPlugin((fn) => (triggerReady = fn))],
      preload: 0,
    });

    gallery.open(1); // the YouTube slide directly
    click(toggleButton());

    const container = providerContainer()!;
    expect(typeof (container as unknown as { play?: unknown }).play).toBe('undefined');

    vi.advanceTimersByTime(2000); // well before the 5000ms interval elapses
    triggerReady!(); // the provider's async setup finally completes

    expect(container.paused).toBe(false); // played automatically, not left sitting there
    vi.advanceTimersByTime(5000); // the interval must not fire and skip past it now that it's playing
    expect(gallery.currentIndex).toBe(1); // still on the video slide

    gallery.destroy();
  });

  it('a provider video that never becomes ready does not stall the slideshow forever — the fallback timer still advances', () => {
    vi.useFakeTimers();
    const el = document.createElement('div');
    const gallery = new Gallery(el, {
      items: videoItems,
      plugins: [Autoplay, delayedVideoProviderPlugin(() => {})], // triggerReady never called
      preload: 0,
    });

    gallery.open(1);
    click(toggleButton());

    vi.advanceTimersByTime(5000); // default interval

    expect(gallery.currentIndex).toBe(2); // moved on instead of stalling forever
    gallery.destroy();
  });
});

describe('Autoplay — cleanup', () => {
  it('destroy() while playing tears down the timer and removes the button/progress bar', () => {
    vi.useFakeTimers();
    const gallery = makeGallery();
    gallery.open(0);
    click(toggleButton());

    gallery.destroy();

    expect(document.querySelector('.shoji-toolbar-button')).toBeNull();
    expect(document.querySelector('.shoji-autoplay-progress')).toBeNull();
  });
});
