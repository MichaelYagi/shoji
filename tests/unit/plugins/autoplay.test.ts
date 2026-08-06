import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Gallery } from '../../../src/core';
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
  return document.querySelector('.shoji-toolbar-right .shoji-toolbar-button') as HTMLButtonElement;
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
