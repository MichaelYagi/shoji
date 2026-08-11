import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GalleryItem } from '../../../src/core/types';
import type { VideoProviderRenderer } from '../../../src/core/plugin';

/**
 * `loadYouTubeApi()`'s `apiPromise` is module-level state — a fresh
 * `vi.resetModules()` + dynamic re-import per test is what gives each test
 * its own isolated copy, rather than every test after the first silently
 * reusing whatever the first test's (possibly mocked) API promise resolved
 * to. `window.YT`/`onYouTubeIframeAPIReady` are real globals too, cleared
 * the same way.
 */
async function freshRenderYouTube(): Promise<VideoProviderRenderer> {
  vi.resetModules();
  const mod = await import('../../../src/plugins/video/youtube');
  return mod.renderYouTube;
}

interface FakePlayerOptions {
  videoId: string;
  playerVars?: unknown;
  events?: {
    onReady?: () => void;
    onStateChange?: (event: { data: number }) => void;
    onError?: (event: { data: number }) => void;
  };
}

function makeYTPlayerMock() {
  const instances: Array<{
    videoId: string;
    playVideo: ReturnType<typeof vi.fn>;
    pauseVideo: ReturnType<typeof vi.fn>;
    mute: ReturnType<typeof vi.fn>;
    unMute: ReturnType<typeof vi.fn>;
    isMuted: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
    onReady?: () => void;
    onStateChange?: (event: { data: number }) => void;
    onError?: (event: { data: number }) => void;
  }> = [];

  class FakePlayer {
    playVideo = vi.fn();
    pauseVideo = vi.fn();
    muted = false;
    mute = vi.fn(() => {
      this.muted = true;
    });
    unMute = vi.fn(() => {
      this.muted = false;
    });
    isMuted = vi.fn(() => this.muted);
    destroy = vi.fn();
    videoId: string;
    onReady?: () => void;
    onStateChange?: (event: { data: number }) => void;
    onError?: (event: { data: number }) => void;

    constructor(_el: HTMLElement, opts: FakePlayerOptions) {
      this.videoId = opts.videoId;
      this.onReady = opts.events?.onReady;
      this.onStateChange = opts.events?.onStateChange;
      this.onError = opts.events?.onError;
      instances.push(this);
    }
  }

  const YT = {
    Player: FakePlayer,
    PlayerState: { ENDED: 0, PLAYING: 1, PAUSED: 2 },
  };

  return { YT, instances };
}

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  delete window.YT;
  delete window.onYouTubeIframeAPIReady;
  document.querySelectorAll('script[src*="iframe_api"]').forEach((s) => s.remove());
});

const ytItem: GalleryItem = {
  id: 'yt',
  src: 'https://youtu.be/dQw4w9WgXcQ',
  video: { provider: 'youtube', id: 'dQw4w9WgXcQ' },
};

describe('renderYouTube — missing video.id (a misconfigured item scan.ts already warned about)', () => {
  it('shows the same placeholder SlideManager uses for "no source", and calls onReady immediately instead of hanging', async () => {
    const { YT, instances } = makeYTPlayerMock();
    window.YT = YT;
    const renderYouTube = await freshRenderYouTube();

    const container = document.createElement('div');
    const onReady = vi.fn();
    const noIdItem: GalleryItem = {
      id: 'yt',
      src: 'https://youtube.com/attribution_link?u=weird',
      video: { provider: 'youtube' },
    };

    renderYouTube(container, noIdItem, onReady, new AbortController().signal);

    expect(onReady).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.shoji-slide-placeholder')).not.toBeNull();
    expect(instances).toHaveLength(0); // never attempted to construct a player at all
  });
});

describe('renderYouTube — API already loaded (window.YT.Player present)', () => {
  it("builds a YT.Player with the item's video id, and calls onReady once the player reports ready", async () => {
    const { YT, instances } = makeYTPlayerMock();
    window.YT = YT;
    const renderYouTube = await freshRenderYouTube();

    const container = document.createElement('div');
    const onReady = vi.fn();
    const controller = new AbortController();

    renderYouTube(container, ytItem, onReady, controller.signal);
    await Promise.resolve(); // loadYouTubeApi()'s Promise.resolve(window.YT) fast path

    expect(instances).toHaveLength(1);
    expect(instances[0]!.videoId).toBe('dQw4w9WgXcQ');
    expect(onReady).not.toHaveBeenCalled();

    instances[0]!.onReady?.();
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it('wires .play()/.pause() on the container to the real player, and paused/ended update from onStateChange', async () => {
    const { YT, instances } = makeYTPlayerMock();
    window.YT = YT;
    const renderYouTube = await freshRenderYouTube();

    const container = document.createElement('div') as HTMLElement & {
      play?: () => void;
      pause?: () => void;
      paused?: boolean;
      ended?: boolean;
    };
    renderYouTube(container, ytItem, vi.fn(), new AbortController().signal);
    await Promise.resolve();
    instances[0]!.onReady?.();

    expect(typeof container.play).toBe('function');
    container.play!();
    expect(instances[0]!.playVideo).toHaveBeenCalledTimes(1);

    container.pause!();
    expect(instances[0]!.pauseVideo).toHaveBeenCalledTimes(1);

    const playSpy = vi.fn();
    const pauseSpy = vi.fn();
    const endedSpy = vi.fn();
    container.addEventListener('play', playSpy);
    container.addEventListener('pause', pauseSpy);
    container.addEventListener('ended', endedSpy);

    instances[0]!.onStateChange?.({ data: YT.PlayerState.PLAYING });
    expect(container.paused).toBe(false);
    expect(playSpy).toHaveBeenCalledTimes(1);

    instances[0]!.onStateChange?.({ data: YT.PlayerState.PAUSED });
    expect(container.paused).toBe(true);
    expect(pauseSpy).toHaveBeenCalledTimes(1);

    instances[0]!.onStateChange?.({ data: YT.PlayerState.ENDED });
    expect(container.paused).toBe(true);
    expect(container.ended).toBe(true);
    expect(endedSpy).toHaveBeenCalledTimes(1);
  });

  it('wires container.muted to the real player — a real accessor (mute()/unMute()/isMuted()), not inert state', async () => {
    const { YT, instances } = makeYTPlayerMock();
    window.YT = YT;
    const renderYouTube = await freshRenderYouTube();

    const container = document.createElement('div') as HTMLElement & { muted?: boolean };
    renderYouTube(container, ytItem, vi.fn(), new AbortController().signal);
    await Promise.resolve();
    instances[0]!.onReady?.();

    expect(container.muted).toBe(false);

    container.muted = true;
    expect(instances[0]!.mute).toHaveBeenCalledTimes(1);
    expect(container.muted).toBe(true); // getter reflects the real player, not a stale write

    container.muted = false;
    expect(instances[0]!.unMute).toHaveBeenCalledTimes(1);
    expect(container.muted).toBe(false);
  });

  it("dispatches a bubbling 'error' CustomEvent on the container with the YouTube error code, once onError fires", async () => {
    const { YT, instances } = makeYTPlayerMock();
    window.YT = YT;
    const renderYouTube = await freshRenderYouTube();

    const mount = document.createElement('div');
    const container = document.createElement('div');
    mount.appendChild(container);
    document.body.appendChild(mount);
    renderYouTube(container, ytItem, vi.fn(), new AbortController().signal);
    await Promise.resolve();

    const onError = vi.fn();
    mount.addEventListener('error', onError); // an ancestor — proves it bubbles

    instances[0]!.onError?.({ data: 153 });

    expect(onError).toHaveBeenCalledTimes(1);
    const event = onError.mock.calls[0]![0] as CustomEvent<{ code: number }>;
    expect(event.detail).toEqual({ code: 153 });
  });

  it('dispatches the error event even if onReady never fired (e.g. a removed/private video) — wirePlayableContract is not a prerequisite', async () => {
    const { YT, instances } = makeYTPlayerMock();
    window.YT = YT;
    const renderYouTube = await freshRenderYouTube();

    const container = document.createElement('div');
    renderYouTube(container, ytItem, vi.fn(), new AbortController().signal);
    await Promise.resolve();

    const onError = vi.fn();
    container.addEventListener('error', onError);

    expect(() => instances[0]!.onError?.({ data: 100 })).not.toThrow();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('destroys the player once the signal aborts', async () => {
    const { YT, instances } = makeYTPlayerMock();
    window.YT = YT;
    const renderYouTube = await freshRenderYouTube();

    const container = document.createElement('div');
    const controller = new AbortController();
    renderYouTube(container, ytItem, vi.fn(), controller.signal);
    await Promise.resolve();
    instances[0]!.onReady?.();

    controller.abort();

    expect(instances[0]!.destroy).toHaveBeenCalledTimes(1);
  });

  it('does not construct a player at all if the signal was already aborted before the API resolved', async () => {
    const { YT, instances } = makeYTPlayerMock();
    window.YT = YT;
    const renderYouTube = await freshRenderYouTube();

    const container = document.createElement('div');
    const controller = new AbortController();
    controller.abort(); // aborted before renderYouTube is even called
    renderYouTube(container, ytItem, vi.fn(), controller.signal);
    await Promise.resolve();

    expect(instances).toHaveLength(0);
  });
});

describe('renderYouTube — cold start (API not yet loaded)', () => {
  it('injects the iframe_api script exactly once and resolves once onYouTubeIframeAPIReady fires', async () => {
    const renderYouTube = await freshRenderYouTube();
    const { YT, instances } = makeYTPlayerMock();

    const container = document.createElement('div');
    const onReady = vi.fn();
    renderYouTube(container, ytItem, onReady, new AbortController().signal);

    const scripts = document.querySelectorAll('script[src="https://www.youtube.com/iframe_api"]');
    expect(scripts).toHaveLength(1);
    expect(instances).toHaveLength(0); // API hasn't "loaded" yet

    // Simulate the script finishing (real browsers execute it, invoking the
    // global callback themselves — jsdom doesn't fetch external scripts).
    window.YT = YT;
    window.onYouTubeIframeAPIReady?.();
    await Promise.resolve();
    instances[0]!.onReady?.();

    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it('composes with a pre-existing onYouTubeIframeAPIReady instead of clobbering it', async () => {
    const renderYouTube = await freshRenderYouTube();
    const { YT, instances } = makeYTPlayerMock();
    const hostOwnCallback = vi.fn();
    window.onYouTubeIframeAPIReady = hostOwnCallback;

    renderYouTube(document.createElement('div'), ytItem, vi.fn(), new AbortController().signal);

    window.YT = YT;
    window.onYouTubeIframeAPIReady?.();
    await Promise.resolve();

    expect(hostOwnCallback).toHaveBeenCalledTimes(1);
    expect(instances).toHaveLength(1);
  });
});
