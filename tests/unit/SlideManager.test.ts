import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SlideManager } from '../../src/core/SlideManager';
import type { GalleryItem } from '../../src/core/types';

// This jsdom doesn't implement HTMLImageElement.decode() at all (and doesn't do
// real resource loading, so 'load'/'error' never fire either) — stub decode()
// the way a real browser would resolve it, so the reveal path is exercised.
// Same for HTMLVideoElement.play() (jsdom has no real playback either) — same
// stub pattern already established in tests/unit/plugins/autoplay.test.ts.
beforeEach(() => {
  HTMLImageElement.prototype.decode = vi.fn().mockResolvedValue(undefined);
  HTMLVideoElement.prototype.play = vi.fn().mockResolvedValue(undefined);
});

afterEach(() => {
  // @ts-expect-error - removing the test-only stub added above
  delete HTMLImageElement.prototype.decode;
  // @ts-expect-error - removing the test-only stub added above
  delete HTMLVideoElement.prototype.play;
});

const items: GalleryItem[] = [
  { id: 'a', src: 'a.jpg', width: 800, height: 600, alt: 'A' },
  { id: 'b', src: 'b.jpg' },
  { id: 'c', src: 'c.jpg' },
  { id: 'video', src: 'v.mp4', video: { provider: 'html5' }, poster: 'poster.jpg' },
  { id: 'video-no-source', src: '', video: { provider: 'html5' } }, // no playable src or sources
];

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('SlideManager', () => {
  it('creates 2*preload+1 pool slots, positioned by fixed offset', () => {
    const manager = new SlideManager({
      preload: 1,
      playVideoLabel: 'Play video',
      videoProviders: new Map(),
    });
    const slots = manager.element.querySelectorAll('.shoji-slide');
    expect(slots).toHaveLength(3);
    // DESIGN.md §2.4 — each slot's transform is now offset*100% plus a live
    // drag-offset px term (0 at rest) so the gesture engine's setDragOffset
    // can animate the whole pool without SlideManager needing a second
    // code path for "structural position" vs. "structural position + drag".
    expect((slots[0] as HTMLElement).style.transform).toBe('translateX(calc(-100% + 0px))');
    expect((slots[1] as HTMLElement).style.transform).toBe('translateX(calc(0% + 0px))');
    expect((slots[2] as HTMLElement).style.transform).toBe('translateX(calc(100% + 0px))');
  });

  it('supports preload:0 (single slot)', () => {
    const manager = new SlideManager({
      preload: 0,
      playVideoLabel: 'Play video',
      videoProviders: new Map(),
    });
    expect(manager.element.querySelectorAll('.shoji-slide')).toHaveLength(1);
  });

  it('renders the image, calls onLoad, and sets aspect-ratio when width/height are known', async () => {
    const manager = new SlideManager({
      preload: 0,
      playVideoLabel: 'Play video',
      videoProviders: new Map(),
    });
    const onLoad = vi.fn();

    manager.render(items, 0, onLoad);
    await flush();

    const media = manager.element.querySelector('.shoji-slide-media') as HTMLElement;
    expect(media.style.aspectRatio).toBe('800 / 600');
    const img = media.querySelector('img.shoji-slide-img') as HTMLImageElement;
    expect(img.src).toContain('a.jpg');
    expect(img.alt).toBe('A');
    expect(onLoad).toHaveBeenCalledWith(0);
  });

  it('shows a spinner (not the previous image) while a genuinely new, uncached index decodes, then swaps it out atomically', async () => {
    const manager = new SlideManager({
      preload: 0,
      playVideoLabel: 'Play video',
      videoProviders: new Map(),
    }); // preload:0 means nothing is ever preloaded/cached
    manager.render(items, 0, vi.fn()); // image 'a'
    await flush();
    const imgA = manager.element.querySelector('img') as HTMLImageElement;
    expect(imgA.src).toContain('a.jpg');

    // Control exactly when 'b' finishes decoding, instead of the global
    // auto-resolving mock, to observe the mid-flight state.
    let resolveDecode!: () => void;
    HTMLImageElement.prototype.decode = vi.fn(
      () => new Promise<void>((resolve) => (resolveDecode = resolve)),
    );

    manager.render(items, 1, vi.fn()); // navigate to image 'b'

    // 'a' is gone immediately, replaced by a spinner — not left on screen.
    expect(manager.element.querySelector('img')).toBeNull();
    expect(manager.element.querySelector('.shoji-slide-spinner')).not.toBeNull();

    resolveDecode();
    await flush();

    const imgB = manager.element.querySelector('img') as HTMLImageElement;
    expect(imgB.src).toContain('b.jpg');
    expect(manager.element.querySelector('.shoji-slide-spinner')).toBeNull();
  });

  it('preload keeps neighbors decoded ahead of time — navigating to one shows it instantly, no spinner, onLoad fires synchronously', async () => {
    const manager = new SlideManager({
      preload: 1,
      playVideoLabel: 'Play video',
      videoProviders: new Map(),
    });
    const onLoad = vi.fn();
    manager.render(items, 0, onLoad); // preloads 'a' (active) and 'b' (+1 neighbor)
    await flush();
    onLoad.mockClear();

    manager.render(items, 1, onLoad); // navigate to 'b' — already decoded

    // No flush() here on purpose — a fresh decode would still be pending at
    // this point (decode() is always async); an instant swap-in proves this
    // came from the cache, not a new decode that happened to resolve fast.
    // Scoped to the *active* slot specifically — the new +1 neighbor ('c',
    // index 2) wasn't preloaded relative to the old center and legitimately
    // still shows its own spinner; that's a separate, correct fresh decode.
    const activeMedia = manager.getActiveMedia();
    expect(activeMedia?.querySelector('.shoji-slide-spinner')).toBeNull();
    const img = activeMedia?.querySelector('img') as HTMLImageElement;
    expect(img.src).toContain('b.jpg');
    expect(onLoad).toHaveBeenCalledWith(1);
  });

  it('regression: navigating to a slide before its preload decode resolves reuses that same in-flight decode instead of abandoning it and starting a duplicate one', async () => {
    // A real bug: the pool used to key an in-flight decode to whichever
    // *slot* started it. Navigating before it resolved reassigned that
    // slot to a different target, discarding the still-loading decode —
    // and the newly-active slot (a different physical slot) started a
    // brand new fetch for the very same image from zero. A slow-loading
    // preload could never actually finish preloading; every navigation
    // before it resolved just restarted it. Fixed by tracking in-flight
    // decodes by item index, not by slot.
    const decodeCallsFor = (needle: string) =>
      decodeCalls.filter((src) => src.includes(needle)).length;
    const decodeCalls: string[] = [];
    const resolvers: Array<{ src: string; resolve: () => void }> = [];
    HTMLImageElement.prototype.decode = vi.fn(function (this: HTMLImageElement) {
      decodeCalls.push(this.src);
      return new Promise<void>((resolve) => resolvers.push({ src: this.src, resolve }));
    });

    const manager = new SlideManager({
      preload: 1,
      playVideoLabel: 'Play video',
      videoProviders: new Map(),
    });
    const onLoad = vi.fn();
    manager.render(items, 0, onLoad); // starts decoding 'a' (active) and 'b' (+1 preload neighbor)
    expect(decodeCallsFor('b.jpg')).toBe(1);

    manager.render(items, 1, onLoad); // navigate to 'b' before its decode resolves (also starts 'c' as the new +1 neighbor — expected, unrelated to the bug)

    // The fix, directly: still just the one decode() call for 'b' — no
    // duplicate fetch was started for it just because it became active.
    expect(decodeCallsFor('b.jpg')).toBe(1);
    const activeMedia = manager.getActiveMedia();
    expect(activeMedia?.querySelector('.shoji-slide-spinner')).not.toBeNull(); // still waiting, correctly

    const bResolver = resolvers.find((r) => r.src.includes('b.jpg'));
    bResolver?.resolve(); // the original (only) decode for 'b' finally settles
    await flush();

    // The still-active slot picks it up — not lost, not stuck forever.
    expect(activeMedia?.querySelector('.shoji-slide-spinner')).toBeNull();
    expect(activeMedia?.querySelector('img')?.getAttribute('src')).toContain('b.jpg');
    expect(onLoad).toHaveBeenCalledWith(1);
  });

  it('a decode that resolves after the viewer has navigated past it entirely is a harmless no-op (no error, nothing incorrectly swapped in)', async () => {
    let resolveB!: () => void;
    HTMLImageElement.prototype.decode = vi.fn(function (this: HTMLImageElement) {
      if (this.src.includes('b.jpg')) {
        return new Promise<void>((resolve) => (resolveB = resolve));
      }
      return Promise.resolve();
    });

    const manager = new SlideManager({
      preload: 0,
      playVideoLabel: 'Play video',
      videoProviders: new Map(),
    }); // single slot — 'b' is never cached once passed
    manager.render(items, 0, vi.fn());
    await flush();

    manager.render(items, 1, vi.fn()); // starts decoding 'b', never resolves yet
    manager.render(items, 2, vi.fn()); // navigate away again before 'b' resolves — nobody wants 'b' anymore

    expect(() => {
      resolveB();
    }).not.toThrow();
    await flush();

    // 'c' (the actual current slide) is unaffected by 'b' finally resolving.
    expect(manager.getActiveMedia()?.querySelector('img')?.getAttribute('src')).toContain('c.jpg');
  });

  it('a cached node is the exact same element when reused, not a re-decoded copy', async () => {
    const manager = new SlideManager({
      preload: 1,
      playVideoLabel: 'Play video',
      videoProviders: new Map(),
    });
    manager.render(items, 0, vi.fn());
    await flush();
    const preloadedImgB = manager.element.querySelectorAll('img')[1] as HTMLImageElement; // +1 slot

    manager.render(items, 1, vi.fn()); // 'b' becomes active

    const activeImg = manager.getActiveMedia()?.querySelector('img') as HTMLImageElement;
    expect(activeImg).toBe(preloadedImgB);
  });

  it('a preloaded neighbor that falls outside the window gets evicted, so navigating back to it later shows the spinner again', async () => {
    // All-image, 4-item array — deliberately not the shared `items` above,
    // whose index 3 is a video; this test only cares about image eviction.
    const imagesOnly: GalleryItem[] = [
      { id: 'z0', src: 'z0.jpg' },
      { id: 'z1', src: 'z1.jpg' },
      { id: 'z2', src: 'z2.jpg' },
      { id: 'z3', src: 'z3.jpg' },
    ];
    const manager = new SlideManager({
      preload: 1,
      playVideoLabel: 'Play video',
      videoProviders: new Map(),
    });
    manager.render(imagesOnly, 1, vi.fn()); // preloads z0 (-1) and z2 (+1)
    await flush();

    manager.render(imagesOnly, 2, vi.fn()); // z0 (index 0) is now out of the ±1 window around 2
    await flush();

    let resolveDecode!: () => void;
    HTMLImageElement.prototype.decode = vi.fn(
      () => new Promise<void>((resolve) => (resolveDecode = resolve)),
    );
    manager.render(imagesOnly, 0, vi.fn()); // back to z0 — no longer cached, must redecode

    expect(manager.element.querySelector('.shoji-slide-spinner')).not.toBeNull();
    resolveDecode();
    await flush();
    expect(manager.element.querySelector('img')?.getAttribute('src')).toContain('z0.jpg');
  });

  it('isActiveReady() is false while the active slide is still loading and true once it settles', async () => {
    const manager = new SlideManager({
      preload: 0,
      playVideoLabel: 'Play video',
      videoProviders: new Map(),
    });
    expect(manager.isActiveReady()).toBe(false); // nothing rendered yet

    manager.render(items, 0, vi.fn());
    expect(manager.isActiveReady()).toBe(false); // decode() is always async, never resolved synchronously
    await flush();
    expect(manager.isActiveReady()).toBe(true);
  });

  it('isActiveReady() stays true immediately when re-navigating to an already-rendered index (no new load triggered)', async () => {
    const manager = new SlideManager({
      preload: 0,
      playVideoLabel: 'Play video',
      videoProviders: new Map(),
    });
    manager.render(items, 0, vi.fn());
    await flush();
    expect(manager.isActiveReady()).toBe(true);

    manager.render(items, 0, vi.fn()); // same index — render() skips it entirely
    expect(manager.isActiveReady()).toBe(true);
  });

  it('disables native image drag (real bug: browser-native "drag this image out" cancels the pointer sequence a real drag/pan gesture needs)', async () => {
    const manager = new SlideManager({
      preload: 0,
      playVideoLabel: 'Play video',
      videoProviders: new Map(),
    });
    manager.render(items, 0, vi.fn());
    await flush();

    const img = manager.element.querySelector('img.shoji-slide-img') as HTMLImageElement;
    expect(img.draggable).toBe(false);
  });

  it('leaves out aspect-ratio when width/height are absent', async () => {
    const manager = new SlideManager({
      preload: 0,
      playVideoLabel: 'Play video',
      videoProviders: new Map(),
    });
    manager.render(items, 1, vi.fn());
    await flush();

    const media = manager.element.querySelector('.shoji-slide-media') as HTMLElement;
    expect(media.style.aspectRatio).toBe('');
  });

  it('renders a video item as a real, natively-controllable <video>', () => {
    const manager = new SlideManager({
      preload: 0,
      playVideoLabel: 'Play video',
      videoProviders: new Map(),
    });
    const onLoad = vi.fn();

    manager.render(items, 3, onLoad);

    const video = manager.element.querySelector('video.shoji-slide-video') as HTMLVideoElement;
    expect(video).not.toBeNull();
    expect(video.controls).toBe(true);
    expect(video.playsInline).toBe(true);
    expect(video.poster).toContain('poster.jpg');
    expect(video.src).toContain('v.mp4');
    expect(video.muted).toBe(false); // deliberate click-to-play, not an autoplay preview
    expect(onLoad).not.toHaveBeenCalled(); // only once loadedmetadata actually fires

    video.dispatchEvent(new Event('loadedmetadata'));
    expect(onLoad).toHaveBeenCalledWith(3);
  });

  it('renders item.sources as <source> children instead of a bare src', () => {
    const withSources: GalleryItem = {
      id: 'v-sources',
      src: 'ignored.mp4',
      video: { provider: 'html5' },
      sources: [
        { src: 'v.webm', type: 'video/webm' },
        { src: 'v.mp4', type: 'video/mp4' },
      ],
    };
    const manager = new SlideManager({
      preload: 0,
      playVideoLabel: 'Play video',
      videoProviders: new Map(),
    });

    manager.render([withSources], 0, vi.fn());

    const video = manager.element.querySelector('video.shoji-slide-video') as HTMLVideoElement;
    const sources = Array.from(video.querySelectorAll('source'));
    expect(sources).toHaveLength(2);
    expect(sources[0]?.type).toBe('video/webm');
    expect(sources[1]?.type).toBe('video/mp4');
  });

  it('renders a placeholder when a video item has no src or sources at all', () => {
    const manager = new SlideManager({
      preload: 0,
      playVideoLabel: 'Play video',
      videoProviders: new Map(),
    });
    const onLoad = vi.fn();

    manager.render(items, 4, onLoad);

    const placeholder = manager.element.querySelector('.shoji-slide-placeholder');
    expect(placeholder?.textContent).toBe('Video');
    expect(manager.element.querySelector('video')).toBeNull();
    expect(onLoad).toHaveBeenCalledWith(4);
  });

  describe('video play-overlay', () => {
    function videoAndOverlay(manager: SlideManager) {
      const video = manager.element.querySelector('video.shoji-slide-video') as HTMLVideoElement;
      const overlay = manager.element.querySelector(
        '.shoji-video-play-overlay',
      ) as HTMLButtonElement;
      return { video, overlay };
    }

    it('is visible (not hidden) on a freshly rendered, paused video', () => {
      const manager = new SlideManager({
        preload: 0,
        playVideoLabel: 'Play video',
        videoProviders: new Map(),
      });
      manager.render(items, 3, vi.fn());

      const { video, overlay } = videoAndOverlay(manager);
      expect(video.paused).toBe(true); // jsdom default — nothing has played it
      expect(overlay).not.toBeNull();
      expect(overlay.hidden).toBe(false);
      expect(overlay.getAttribute('aria-label')).toBe('Play video');
    });

    it('hides when the video starts playing, reappears on pause (after the debounce) and immediately on ended', () => {
      vi.useFakeTimers();
      const manager = new SlideManager({
        preload: 0,
        playVideoLabel: 'Play video',
        videoProviders: new Map(),
      });
      manager.render(items, 3, vi.fn());
      const { video, overlay } = videoAndOverlay(manager);

      video.dispatchEvent(new Event('play'));
      expect(overlay.hidden).toBe(true);

      video.dispatchEvent(new Event('pause'));
      expect(overlay.hidden).toBe(true); // not yet — debounced, see the dedicated test below
      vi.advanceTimersByTime(200);
      expect(overlay.hidden).toBe(false);

      video.dispatchEvent(new Event('play'));
      expect(overlay.hidden).toBe(true);
      video.dispatchEvent(new Event('ended'));
      expect(overlay.hidden).toBe(false); // ended is never debounced — always a real, terminal state
      vi.useRealTimers();
    });

    it("regression: a native scrub-bar's transient pause-then-resume (well within the debounce window) never flashes the overlay", () => {
      // Real browsers pause <video> for the duration of a seek-bar drag —
      // showing the overlay for every one of those would flash it on every
      // scrub interaction, which is what this whole debounce exists to fix.
      vi.useFakeTimers();
      const manager = new SlideManager({
        preload: 0,
        playVideoLabel: 'Play video',
        videoProviders: new Map(),
      });
      manager.render(items, 3, vi.fn());
      const { video, overlay } = videoAndOverlay(manager);
      video.dispatchEvent(new Event('play'));

      video.dispatchEvent(new Event('pause')); // scrub-drag starts
      vi.advanceTimersByTime(50); // well within the drag, short of the debounce
      expect(overlay.hidden).toBe(true);
      video.dispatchEvent(new Event('play')); // scrub-drag released, playback resumes

      vi.advanceTimersByTime(500); // long past where the (now-cancelled) timer would have fired
      expect(overlay.hidden).toBe(true); // never flashed

      vi.useRealTimers();
    });

    it('clicking it plays the video and does not bubble to backdrop-click-to-close', () => {
      const manager = new SlideManager({
        preload: 0,
        playVideoLabel: 'Play video',
        videoProviders: new Map(),
      });
      manager.render(items, 3, vi.fn());
      const { video, overlay } = videoAndOverlay(manager);

      const bubbledTo = vi.fn();
      manager.element.addEventListener('click', bubbledTo);
      overlay.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

      expect(video.play).toHaveBeenCalledTimes(1);
      expect(bubbledTo).not.toHaveBeenCalled();
    });

    it('is absent for the no-source video placeholder (nothing to play)', () => {
      const manager = new SlideManager({
        preload: 0,
        playVideoLabel: 'Play video',
        videoProviders: new Map(),
      });
      manager.render(items, 4, vi.fn()); // 'video-no-source'

      expect(manager.element.querySelector('.shoji-video-play-overlay')).toBeNull();
    });

    it('travels with the video across cache-hit reuse (preloaded neighbor becoming active)', () => {
      const manager = new SlideManager({
        preload: 1,
        playVideoLabel: 'Play video',
        videoProviders: new Map(),
      });
      // centerIndex 2 ('c'): offsets -1/0/+1 → 'b' / 'c' / the video (index 3) —
      // preloaded as the +1 neighbor, not yet active, but already built and
      // inserted regardless (video swaps in immediately, per renderVideo).
      manager.render(items, 2, vi.fn());
      const { video: originalVideo, overlay: originalOverlay } = videoAndOverlay(manager);
      expect(originalOverlay.hidden).toBe(false);

      manager.render(items, 3, vi.fn()); // navigate onto it — a cache hit, not a fresh render

      const { video, overlay } = videoAndOverlay(manager);
      expect(video).toBe(originalVideo); // same element, reused from cache
      expect(overlay).toBe(originalOverlay); // its overlay came along with it
      expect(overlay.hidden).toBe(false);
    });
  });

  describe('provider video (registerVideoProvider / custom)', () => {
    function ytItem(id = 'x'): GalleryItem {
      return { id: 'yt', src: `https://youtu.be/${id}`, video: { provider: 'youtube', id } };
    }

    it('shows a spinner and a hidden container until onReady, then reveals it', () => {
      let capturedOnReady: (() => void) | null = null;
      const render = vi.fn((container: HTMLElement, _item: GalleryItem, onReady: () => void) => {
        capturedOnReady = onReady;
        container.appendChild(document.createElement('iframe'));
      });
      const manager = new SlideManager({
        preload: 0,
        playVideoLabel: 'Play video',
        videoProviders: new Map([['youtube', render]]),
      });
      const onLoad = vi.fn();

      manager.render([ytItem()], 0, onLoad);

      expect(manager.element.querySelector('.shoji-slide-spinner')).not.toBeNull();
      const container = manager.element.querySelector<HTMLElement>('.shoji-slide-provider-video');
      expect(container).not.toBeNull();
      expect(container?.hidden).toBe(true);
      expect(manager.isActiveReady()).toBe(false);
      expect(onLoad).not.toHaveBeenCalled();

      capturedOnReady!();

      expect(container?.hidden).toBe(false);
      expect(manager.element.querySelector('.shoji-slide-spinner')).toBeNull();
      expect(manager.isActiveReady()).toBe(true);
      expect(onLoad).toHaveBeenCalledWith(0);
    });

    it('falls back to the same plain placeholder as no-source video for an unregistered provider name', () => {
      const manager = new SlideManager({
        preload: 0,
        playVideoLabel: 'Play video',
        videoProviders: new Map(), // nothing registered for 'youtube'
      });
      const onLoad = vi.fn();

      manager.render([ytItem()], 0, onLoad);

      const placeholder = manager.element.querySelector('.shoji-slide-placeholder');
      expect(placeholder?.textContent).toBe('Video');
      expect(onLoad).toHaveBeenCalledWith(0);
      expect(manager.isActiveReady()).toBe(true);
    });

    it("routes provider: 'custom' items through the item's own render function, not the registry", () => {
      const registryRender = vi.fn();
      const customRender = vi.fn((_el: HTMLElement, _item: GalleryItem, onReady: () => void) =>
        onReady(),
      );
      const manager = new SlideManager({
        preload: 0,
        playVideoLabel: 'Play video',
        videoProviders: new Map([['youtube', registryRender]]),
      });
      const customItem: GalleryItem = {
        id: 'custom',
        src: 'x',
        video: { provider: 'custom', render: customRender },
      };

      manager.render([customItem], 0, vi.fn());

      expect(customRender).toHaveBeenCalledTimes(1);
      expect(registryRender).not.toHaveBeenCalled();
    });

    it('aborts the signal once evicted from the preload window', () => {
      const aborts: string[] = [];
      const render = vi.fn(
        (_c: HTMLElement, _i: GalleryItem, onReady: () => void, signal: AbortSignal) => {
          signal.addEventListener('abort', () => aborts.push('aborted'));
          onReady();
        },
      );
      const manager = new SlideManager({
        preload: 0,
        playVideoLabel: 'Play video',
        videoProviders: new Map([['youtube', render]]),
      });
      const mixed: GalleryItem[] = [ytItem(), { id: 'photo', src: 'photo.jpg' }];

      manager.render(mixed, 0, vi.fn());
      expect(aborts).toEqual([]);

      manager.render(mixed, 1, vi.fn()); // preload:0 -> index 0 falls fully outside the window

      expect(aborts).toEqual(['aborted']);
    });

    it('aborts on destroy()', () => {
      const aborts: string[] = [];
      const render = vi.fn(
        (_c: HTMLElement, _i: GalleryItem, onReady: () => void, signal: AbortSignal) => {
          signal.addEventListener('abort', () => aborts.push('aborted'));
          onReady();
        },
      );
      const manager = new SlideManager({
        preload: 0,
        playVideoLabel: 'Play video',
        videoProviders: new Map([['youtube', render]]),
      });

      manager.render([ytItem()], 0, vi.fn());
      manager.destroy();

      expect(aborts).toEqual(['aborted']);
    });

    it('a late onReady (after eviction already aborted the signal) does not reveal stale content', () => {
      let capturedOnReady: (() => void) | null = null;
      const render = vi.fn((_c: HTMLElement, _i: GalleryItem, onReady: () => void) => {
        capturedOnReady = onReady; // deliberately not called yet - simulates slow async setup
      });
      const manager = new SlideManager({
        preload: 0,
        playVideoLabel: 'Play video',
        videoProviders: new Map([['youtube', render]]),
      });
      const onLoad = vi.fn();

      manager.render([ytItem()], 0, onLoad);
      manager.destroy(); // aborts before onReady ever fired
      capturedOnReady!(); // a slow provider API resolving after teardown

      expect(onLoad).not.toHaveBeenCalled();
    });
  });

  it('a genuinely new (uncached) navigation onto a video-holding slot shows a spinner immediately, pausing/releasing the outgoing video up front rather than leaving it visible mid-decode', async () => {
    const manager = new SlideManager({
      preload: 0,
      playVideoLabel: 'Play video',
      videoProviders: new Map(),
    });
    manager.render(items, 3, vi.fn()); // video item
    const video = manager.element.querySelector('video') as HTMLVideoElement;
    const pauseSpy = vi.spyOn(video, 'pause').mockImplementation(() => {});
    const loadSpy = vi.spyOn(video, 'load').mockImplementation(() => {});

    manager.render(items, 0, vi.fn()); // switch this slot to an image item

    // Released immediately (not deferred until the new image finishes
    // decoding) — the slot shows a spinner in the meantime, not the old video.
    expect(pauseSpy).toHaveBeenCalled();
    expect(loadSpy).toHaveBeenCalled();
    expect(manager.element.querySelector('video')).toBeNull();
    expect(manager.element.querySelector('.shoji-slide-spinner')).not.toBeNull();

    await flush();

    expect(manager.element.querySelector('img')).not.toBeNull();
  });

  it('regression: moving a still-needed <video> from one slot to another within a single render() call never pauses or resets it', async () => {
    // preload:1 with a video in the middle of the pool — stepping backward
    // by one requires this exact scenario in one render() call: the slot
    // currently showing the video needs *different* new content (pulled
    // from the slot on its other side), while the video itself needs to
    // move into the slot that's opening up beside it. If the outgoing
    // slot's content were released the moment it's told to show something
    // else — before the video had a chance to be reclaimed by its new
    // slot a few lines later — this would incorrectly pause/reset it.
    const custom: GalleryItem[] = [
      { id: 'x0', src: 'x0.jpg' },
      { id: 'x1', src: 'x1.jpg' },
      { id: 'x2', src: 'x2.mp4', video: { provider: 'html5' }, poster: 'x2.jpg' },
      { id: 'x3', src: 'x3.jpg' },
    ];
    const manager = new SlideManager({
      preload: 1,
      playVideoLabel: 'Play video',
      videoProviders: new Map(),
    });
    manager.render(custom, 2, vi.fn()); // slots: -1→x1, 0→x2 (video), +1→x3
    await flush();

    const video = manager.element.querySelector('video') as HTMLVideoElement;
    expect(video).not.toBeNull();
    const pauseSpy = vi.spyOn(video, 'pause').mockImplementation(() => {});
    const loadSpy = vi.spyOn(video, 'load').mockImplementation(() => {});

    manager.render(custom, 1, vi.fn()); // step back: -1→x0 (fresh), 0→x1 (was -1), +1→x2 (the video, was 0)

    expect(pauseSpy).not.toHaveBeenCalled();
    expect(loadSpy).not.toHaveBeenCalled();
    expect(manager.element.querySelector('video')).toBe(video); // same element, just relocated

    // It's still fully controllable afterward — not left in some
    // half-reset state by the move.
    expect(video.hasAttribute('src') || video.querySelector('source')).toBeTruthy();
  });

  it('evicts a preloaded video that falls out of the window (without being reused elsewhere), pausing/releasing it even though the slot that held it is never itself touched again this call', async () => {
    const custom: GalleryItem[] = [
      { id: 'y0', src: 'y0.mp4', video: { provider: 'html5' }, poster: 'y0.jpg' },
      { id: 'y1', src: 'y1.jpg' },
      { id: 'y2', src: 'y2.jpg' },
      { id: 'y3', src: 'y3.jpg' },
      { id: 'y4', src: 'y4.jpg' },
    ];
    const manager = new SlideManager({
      preload: 1,
      playVideoLabel: 'Play video',
      videoProviders: new Map(),
    });
    manager.render(custom, 1, vi.fn()); // slots: -1→y0 (video), 0→y1, +1→y2
    await flush();

    const video = manager.element.querySelector('video') as HTMLVideoElement;
    expect(video).not.toBeNull();
    const pauseSpy = vi.spyOn(video, 'pause').mockImplementation(() => {});
    const loadSpy = vi.spyOn(video, 'load').mockImplementation(() => {});

    manager.render(custom, 3, vi.fn()); // jump ahead — y0 (index 0) is now well outside the ±1 window around 3
    await flush();

    expect(pauseSpy).toHaveBeenCalled();
    expect(loadSpy).toHaveBeenCalled();
  });

  it('clears a slot when its offset falls outside the item range', async () => {
    const manager = new SlideManager({
      preload: 1,
      playVideoLabel: 'Play video',
      videoProviders: new Map(),
    });
    manager.render(items, 0, vi.fn());
    await flush();

    const prevSlot = manager.element.querySelectorAll('.shoji-slide-media')[0] as HTMLElement;
    expect(prevSlot.children).toHaveLength(0); // offset -1 from index 0 is out of range
  });

  it('does not re-render a slot already showing the requested index', async () => {
    const manager = new SlideManager({
      preload: 0,
      playVideoLabel: 'Play video',
      videoProviders: new Map(),
    });
    manager.render(items, 0, vi.fn());
    await flush();
    const imgBefore = manager.element.querySelector('img');

    manager.render(items, 0, vi.fn());
    const imgAfter = manager.element.querySelector('img');

    expect(imgAfter).toBe(imgBefore);
  });

  it('destroy() empties all slots and detaches the element', async () => {
    const manager = new SlideManager({
      preload: 0,
      playVideoLabel: 'Play video',
      videoProviders: new Map(),
    });
    const root = document.createElement('div');
    root.appendChild(manager.element);
    manager.render(items, 0, vi.fn());
    await flush();

    manager.destroy();

    expect(manager.element.querySelector('.shoji-slide-media')?.children).toHaveLength(0);
    expect(manager.element.parentElement).toBeNull();
  });

  it('destroy() pauses and releases a currently-playing video', () => {
    const manager = new SlideManager({
      preload: 0,
      playVideoLabel: 'Play video',
      videoProviders: new Map(),
    });
    manager.render(items, 3, vi.fn()); // video item
    const video = manager.element.querySelector('video') as HTMLVideoElement;
    const pauseSpy = vi.spyOn(video, 'pause').mockImplementation(() => {});
    const loadSpy = vi.spyOn(video, 'load').mockImplementation(() => {});

    manager.destroy();

    expect(pauseSpy).toHaveBeenCalled();
    expect(loadSpy).toHaveBeenCalled();
  });
});
