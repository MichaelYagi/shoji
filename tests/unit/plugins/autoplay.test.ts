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
  return document.querySelector('.shoji-autoplay-toggle') as HTMLButtonElement;
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

  it("a play() blocked by browser autoplay policy (NotAllowedError) gracefully stops the slideshow instead of hanging — the video is fine, it just needs the viewer's own click", async () => {
    vi.useFakeTimers();
    HTMLVideoElement.prototype.play = vi
      .fn()
      .mockRejectedValue(new DOMException('blocked', 'NotAllowedError'));
    const gallery = makeGallery();
    gallery.open(2);

    click(toggleButton());
    await vi.advanceTimersByTimeAsync(0);

    expect(toggleButton().getAttribute('aria-label')).toBe('Play slideshow'); // auto-stopped
    expect(gallery.currentIndex).toBe(2); // never advanced

    gallery.destroy();
  });

  it("a genuinely unplayable video (NotSupportedError — broken/missing source) skips ahead instead of stopping the slideshow — regression: previously any rejection reason stopped it the same way, indistinguishable from a merely autoplay-blocked video that's actually fine", async () => {
    vi.useFakeTimers();
    HTMLVideoElement.prototype.play = vi
      .fn()
      .mockRejectedValue(new DOMException('no supported source', 'NotSupportedError'));
    const gallery = makeGallery();
    gallery.open(2);

    click(toggleButton());
    await vi.advanceTimersByTimeAsync(0);

    expect(toggleButton().getAttribute('aria-label')).toBe('Pause slideshow'); // kept playing
    expect(gallery.currentIndex).toBe(3); // skipped past the broken video

    gallery.destroy();
  });

  it('a stale rejection (viewer already navigated away, or stopped the slideshow, before it resolved) is a no-op — does not advance or stop based on a video that is no longer the active one', async () => {
    vi.useFakeTimers();
    let reject!: (error: unknown) => void;
    HTMLVideoElement.prototype.play = vi.fn(
      () => new Promise((_resolve, r) => (reject = r)),
    ) as unknown as typeof HTMLVideoElement.prototype.play;
    const gallery = makeGallery();
    gallery.open(2);
    click(toggleButton());

    gallery.next(); // viewer navigates away before the play() promise ever settles
    const indexAfterNavigate = gallery.currentIndex;
    reject(new DOMException('no supported source', 'NotSupportedError'));
    await vi.advanceTimersByTimeAsync(0);

    expect(gallery.currentIndex).toBe(indexAfterNavigate); // the stale rejection didn't also advance

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

  it("regression: a provider video that errors out (e.g. YouTube's onError) is skipped — advances to the next slide instead of stalling on it", () => {
    vi.useFakeTimers();
    const gallery = makeProviderGallery();
    gallery.open(1); // the YouTube slide directly

    click(toggleButton());
    const container = providerContainer()!;
    expect(gallery.currentIndex).toBe(1);

    // Simulates what youtube.ts's onError actually dispatches — this test is
    // about Autoplay's own reaction, not youtube.ts's dispatching (covered
    // separately in video-youtube.test.ts).
    container.dispatchEvent(new CustomEvent('error', { bubbles: true, detail: { code: 153 } }));

    expect(gallery.currentIndex).toBe(2); // skipped ahead immediately
    gallery.destroy();
  });

  it("regression: still catches the provider's error event after navigating there (not opened directly on it) — a preloaded slot's own offset is relabeled as navigation happens (SlideManager, §2.3), so a listener attached to whichever node happened to be the active one at plugin init can end up listening to a neighbor instead of the actual active slide", () => {
    vi.useFakeTimers();
    const el = document.createElement('div');
    const gallery = new Gallery(el, {
      items: [
        { id: 'a', src: 'a.jpg' },
        { id: 'b', src: 'b.jpg' },
        { id: 'yt', src: 'https://youtu.be/x', video: { provider: 'youtube' as const, id: 'x' } },
        { id: 'd', src: 'd.jpg' },
      ],
      plugins: [Autoplay, fakeVideoProviderPlugin()],
      preload: 1, // >0 is what makes offset-relabeling (vs. a single always-offset-0 slot) possible at all
    });
    gallery.open(0);
    click(toggleButton());
    gallery.next(); // 'a' -> 'b' — a real navigation, not opening directly on the video slide
    gallery.next(); // 'b' -> 'yt' — reaches the video slide the same way autoplay's own advance() would
    expect(gallery.currentIndex).toBe(2);

    const container = providerContainer()!;
    container.dispatchEvent(new CustomEvent('error', { bubbles: true, detail: { code: 153 } }));

    expect(gallery.currentIndex).toBe(3); // skipped ahead, not stuck
    gallery.destroy();
  });

  it('an error event while the slideshow is paused does not navigate', () => {
    const gallery = makeProviderGallery();
    gallery.open(1); // not playing — never clicked the toggle

    const container = providerContainer()!;
    container.dispatchEvent(new CustomEvent('error', { bubbles: true, detail: { code: 100 } }));

    expect(gallery.currentIndex).toBe(1); // unchanged
    gallery.destroy();
  });

  it('an error on a provider video still mid-setup (never became ready) also skips ahead, not just an already-playing one', () => {
    vi.useFakeTimers();
    let trigger: (() => void) | null = null;
    const el = document.createElement('div');
    const gallery = new Gallery(el, {
      items: videoItems,
      plugins: [Autoplay, delayedVideoProviderPlugin((t) => (trigger = t))],
      preload: 0,
    });
    gallery.open(1);
    click(toggleButton());
    expect(trigger).not.toBeNull(); // registered, but onReady() deliberately never called

    const container = providerContainer()!;
    container.dispatchEvent(new CustomEvent('error', { bubbles: true, detail: { code: 100 } }));

    expect(gallery.currentIndex).toBe(2); // didn't wait out the fallback interval timer
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

  it("regression: skips ahead if every retry attempt is exhausted, instead of leaving the slideshow silently stuck forever — reported from real usage: a slow/late error report (e.g. YouTube's own Error 153) can arrive well after this retry window closes, so exhaustion needs to reach the same 'skip it' outcome on its own rather than depend on winning a race against the error event", () => {
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
    expect(toggleButton().getAttribute('aria-label')).toBe('Pause slideshow'); // kept playing
    expect(gallery.currentIndex).toBe(2); // skipped past the unplayable video

    gallery.destroy();
  });

  it('a slow-to-arrive error event, landing after retry-exhaustion already skipped past the video, does not also double-advance — reported from real usage: this is the exact race that left the slideshow stuck before both fixes above, and both reaching the same outcome independently must not compound into skipping twice', () => {
    vi.useFakeTimers();
    const el = document.createElement('div');
    const gallery = new Gallery(el, {
      items: [
        { id: 'a', src: 'a.jpg' },
        { id: 'yt', src: 'https://youtu.be/x', video: { provider: 'youtube' as const, id: 'x' } },
        { id: 'c', src: 'c.jpg' },
        { id: 'd', src: 'd.jpg' },
      ],
      plugins: [Autoplay, flakyVideoProviderPlugin(999)], // never actually takes
      preload: 1, // keeps the errored container cached as a neighbor, not evicted, once skipped past
    });
    gallery.open(1); // the youtube slide directly
    click(toggleButton());

    const container = providerContainer()!; // capture before advancing past it
    vi.advanceTimersByTime(400 * 9); // exhausts retries — advance() already fired once
    expect(gallery.currentIndex).toBe(2);

    // YouTube's own error report, arriving late — after the slide it's about is no longer active.
    container.dispatchEvent(new CustomEvent('error', { bubbles: true, detail: { code: 153 } }));

    expect(gallery.currentIndex).toBe(2); // unchanged — did not also advance a second time

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

describe('Autoplay — autoStart', () => {
  it('off by default — opening does not start the slideshow on its own', () => {
    const gallery = makeGallery();
    gallery.open(0);

    expect(toggleButton().getAttribute('aria-label')).toBe('Play slideshow');
    gallery.destroy();
  });

  it('starts the slideshow automatically as soon as the gallery opens', () => {
    vi.useFakeTimers();
    const gallery = makeGallery({ autoplay: { autoStart: true } });

    gallery.open(0);

    expect(toggleButton().getAttribute('aria-label')).toBe('Pause slideshow');
    vi.advanceTimersByTime(5000); // default interval
    expect(gallery.currentIndex).toBe(1);

    gallery.destroy();
  });

  it('starts again on a second open() — not only the first', () => {
    const gallery = makeGallery({ autoplay: { autoStart: true } });
    gallery.open(0);
    gallery.close();
    expect(toggleButton()?.getAttribute('aria-label')).toBe('Play slideshow'); // stopped on close

    gallery.open(0);

    expect(toggleButton().getAttribute('aria-label')).toBe('Pause slideshow');
    gallery.destroy();
  });

  it('the toggle button carries a stable class (shoji-autoplay-toggle) host code can rely on instead of matching translatable label/title text', () => {
    const gallery = makeGallery();
    gallery.open(0);

    expect(document.querySelector('.shoji-autoplay-toggle')).toBe(toggleButton());
    gallery.destroy();
  });
});
