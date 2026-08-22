import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GalleryItem } from '../../../src/core/types';
import type { VideoProviderRenderer } from '../../../src/core/plugin';

/**
 * `loadVimeoApi()`'s `apiPromise` is module-level state — a fresh
 * `vi.resetModules()` + dynamic re-import per test is what gives each test
 * its own isolated copy, rather than every test after the first silently
 * reusing whatever the first test's (possibly mocked) API promise resolved
 * to. `window.Vimeo` is a real global too, cleared the same way.
 */
async function freshRenderVimeo(): Promise<VideoProviderRenderer> {
  vi.resetModules();
  const mod = await import('../../../src/plugins/video/vimeo');
  return mod.renderVimeo;
}

interface FakePlayerOptions {
  id?: number;
  url?: string;
  playsinline?: boolean;
}

/**
 * Every real Vimeo Player SDK method is Promise-based, `ready()` included —
 * unlike YouTube's synchronous-callback `onReady`, so `resolveReady()` here
 * is what a test calls to simulate the player actually becoming ready,
 * independent of construction.
 */
function makeVimeoPlayerMock() {
  const instances: Array<{
    options: FakePlayerOptions;
    play: ReturnType<typeof vi.fn>;
    pause: ReturnType<typeof vi.fn>;
    setMuted: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
    resolveReady: () => void;
    trigger: (
      event: 'play' | 'pause' | 'ended' | 'error',
      arg?: { name: string; message: string },
    ) => void;
  }> = [];

  class FakePlayer {
    options: FakePlayerOptions;
    play = vi.fn(() => Promise.resolve());
    pause = vi.fn(() => Promise.resolve());
    setMuted = vi.fn((muted: boolean) => Promise.resolve(muted));
    destroy = vi.fn(() => Promise.resolve());
    private handlers: Record<string, Array<(arg: { name: string; message: string }) => void>> = {};
    private readyResolve!: () => void;
    private readyPromise = new Promise<void>((resolve) => {
      this.readyResolve = resolve;
    });

    constructor(_el: HTMLElement, options: FakePlayerOptions) {
      this.options = options;
    }

    ready(): Promise<void> {
      return this.readyPromise;
    }

    on(event: string, callback: (arg: { name: string; message: string }) => void): void {
      (this.handlers[event] ??= []).push(callback);
    }

    trigger(event: string, arg?: { name: string; message: string }): void {
      this.handlers[event]?.forEach((cb) => cb(arg!));
    }

    resolveReady(): void {
      this.readyResolve();
    }
  }

  const Vimeo = {
    Player: function (el: HTMLElement, options: FakePlayerOptions) {
      const player = new FakePlayer(el, options);
      instances.push(player);
      return player;
    } as unknown as new (
      el: HTMLElement,
      options: FakePlayerOptions,
    ) => InstanceType<typeof FakePlayer>,
  };

  return { Vimeo, instances };
}

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.useRealTimers();
  delete window.Vimeo;
  document.querySelectorAll('script[src*="player.vimeo.com"]').forEach((s) => s.remove());
});

const vimeoItem: GalleryItem = {
  id: 'vimeo',
  src: 'https://vimeo.com/76979871',
  video: { provider: 'vimeo', id: '76979871', url: 'https://vimeo.com/76979871' },
};

describe('renderVimeo — missing both video.id and video.url (a misconfigured item scan.ts already warned about)', () => {
  it('shows the same placeholder SlideManager uses for "no source", and calls onReady immediately instead of hanging', async () => {
    const { Vimeo, instances } = makeVimeoPlayerMock();
    window.Vimeo = Vimeo;
    const renderVimeo = await freshRenderVimeo();

    const container = document.createElement('div');
    const onReady = vi.fn();
    const noIdItem: GalleryItem = {
      id: 'vimeo',
      src: 'https://vimeo.com/channels/staffpicks',
      video: { provider: 'vimeo' },
    };

    renderVimeo(container, noIdItem, onReady, new AbortController().signal, vi.fn());

    expect(onReady).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.shoji-slide-placeholder')).not.toBeNull();
    expect(instances).toHaveLength(0); // never attempted to construct a player at all
  });
});

/**
 * DESIGN.md §4-video — `setPoster` fallback: a host-supplied `item.poster`
 * always wins (core's own job, `SlideManager.ts`'s own tests cover that
 * precedence) — this only covers what `renderVimeo` itself is responsible
 * for: fetching Vimeo's oEmbed endpoint when there's no `item.poster` and
 * calling `setPoster` with its `thumbnail_url`, unlike `youtube.ts`'s
 * request-free predictable URL — Vimeo has no such pattern, so this is a
 * genuine network round trip, with its own failure modes to swallow.
 */
describe('renderVimeo — setPoster fallback via oEmbed (a real fetch, unlike youtube.ts)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches oEmbed for the item’s own url and calls setPoster with thumbnail_url once it resolves', async () => {
    const { Vimeo } = makeVimeoPlayerMock();
    window.Vimeo = Vimeo;
    const renderVimeo = await freshRenderVimeo();

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ thumbnail_url: 'https://i.vimeocdn.com/thumb.jpg' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const container = document.createElement('div');
    const setPoster = vi.fn();
    renderVimeo(container, vimeoItem, vi.fn(), new AbortController().signal, setPoster);

    expect(fetchMock).toHaveBeenCalledWith(
      `https://vimeo.com/api/oembed.json?url=${encodeURIComponent('https://vimeo.com/76979871')}`,
    );
    await vi.waitFor(() =>
      expect(setPoster).toHaveBeenCalledWith('https://i.vimeocdn.com/thumb.jpg'),
    );
  });

  it('builds the oEmbed target from a bare id when the item has no url', async () => {
    const { Vimeo } = makeVimeoPlayerMock();
    window.Vimeo = Vimeo;
    const renderVimeo = await freshRenderVimeo();

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ thumbnail_url: 'https://i.vimeocdn.com/thumb.jpg' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const idOnlyItem: GalleryItem = {
      id: 'vimeo',
      src: 'https://vimeo.com/76979871',
      video: { provider: 'vimeo', id: '76979871' },
    };
    renderVimeo(
      document.createElement('div'),
      idOnlyItem,
      vi.fn(),
      new AbortController().signal,
      vi.fn(),
    );

    expect(fetchMock).toHaveBeenCalledWith(
      `https://vimeo.com/api/oembed.json?url=${encodeURIComponent('https://vimeo.com/76979871')}`,
    );
  });

  it('never fetches at all when item.poster is already set — a host-supplied poster is core’s job to show, not this renderer’s to second-guess', async () => {
    const { Vimeo } = makeVimeoPlayerMock();
    window.Vimeo = Vimeo;
    const renderVimeo = await freshRenderVimeo();

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const itemWithPoster: GalleryItem = { ...vimeoItem, poster: 'host-poster.jpg' };
    renderVimeo(
      document.createElement('div'),
      itemWithPoster,
      vi.fn(),
      new AbortController().signal,
      vi.fn(),
    );

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('swallows a failed fetch (network error) — never calls setPoster, no unhandled rejection', async () => {
    const { Vimeo } = makeVimeoPlayerMock();
    window.Vimeo = Vimeo;
    const renderVimeo = await freshRenderVimeo();

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));

    const container = document.createElement('div');
    const setPoster = vi.fn();
    renderVimeo(container, vimeoItem, vi.fn(), new AbortController().signal, setPoster);

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(setPoster).not.toHaveBeenCalled();
  });

  it('does not call setPoster for a non-ok response (e.g. a private/deleted video oEmbed rejects)', async () => {
    const { Vimeo } = makeVimeoPlayerMock();
    window.Vimeo = Vimeo;
    const renderVimeo = await freshRenderVimeo();

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));

    const container = document.createElement('div');
    const setPoster = vi.fn();
    renderVimeo(container, vimeoItem, vi.fn(), new AbortController().signal, setPoster);

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(setPoster).not.toHaveBeenCalled();
  });

  it('does not call setPoster once the signal has aborted before the fetch resolves', async () => {
    const { Vimeo } = makeVimeoPlayerMock();
    window.Vimeo = Vimeo;
    const renderVimeo = await freshRenderVimeo();

    let resolveFetch!: (value: unknown) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise((resolve) => {
            resolveFetch = resolve;
          }),
      ),
    );

    const container = document.createElement('div');
    const setPoster = vi.fn();
    const controller = new AbortController();
    renderVimeo(container, vimeoItem, vi.fn(), controller.signal, setPoster);

    controller.abort();
    resolveFetch({
      ok: true,
      json: () => Promise.resolve({ thumbnail_url: 'https://i.vimeocdn.com/thumb.jpg' }),
    });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(setPoster).not.toHaveBeenCalled();
  });
});

describe('renderVimeo — API already loaded (window.Vimeo.Player present)', () => {
  it("builds a Vimeo.Player preferring the item's video.url over its id, and calls onReady once ready() resolves", async () => {
    const { Vimeo, instances } = makeVimeoPlayerMock();
    window.Vimeo = Vimeo;
    const renderVimeo = await freshRenderVimeo();

    const container = document.createElement('div');
    const onReady = vi.fn();
    const controller = new AbortController();

    renderVimeo(container, vimeoItem, onReady, controller.signal, vi.fn());
    await Promise.resolve(); // loadVimeoApi()'s Promise.resolve(window.Vimeo) fast path

    expect(instances).toHaveLength(1);
    expect(instances[0]!.options).toEqual({
      url: 'https://vimeo.com/76979871',
      playsinline: true,
    });
    expect(onReady).not.toHaveBeenCalled();

    instances[0]!.resolveReady();
    await Promise.resolve();
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it('falls back to a numeric id when video.url is absent (dynamic-mode item authored without one)', async () => {
    const { Vimeo, instances } = makeVimeoPlayerMock();
    window.Vimeo = Vimeo;
    const renderVimeo = await freshRenderVimeo();

    const idOnlyItem: GalleryItem = {
      id: 'vimeo',
      src: 'https://vimeo.com/76979871',
      video: { provider: 'vimeo', id: '76979871' },
    };
    renderVimeo(
      document.createElement('div'),
      idOnlyItem,
      vi.fn(),
      new AbortController().signal,
      vi.fn(),
    );
    await Promise.resolve();

    expect(instances[0]!.options).toEqual({ id: 76979871, playsinline: true });
  });

  it('wires .play()/.pause() on the container to the real player, and paused/ended update from on(play/pause/ended)', async () => {
    const { Vimeo, instances } = makeVimeoPlayerMock();
    window.Vimeo = Vimeo;
    const renderVimeo = await freshRenderVimeo();

    const container = document.createElement('div') as HTMLElement & {
      play?: () => Promise<void>;
      pause?: () => void;
      paused?: boolean;
      ended?: boolean;
    };
    renderVimeo(container, vimeoItem, vi.fn(), new AbortController().signal, vi.fn());
    await Promise.resolve();
    instances[0]!.resolveReady();
    await Promise.resolve();

    expect(typeof container.play).toBe('function');
    const playResult = container.play!();
    expect(instances[0]!.play).toHaveBeenCalledTimes(1);
    // A real thenable, not fire-and-forget like youtube.ts's .play — DESIGN.md
    // §4.1 point 12's Autoplay retry logic branches its own strategy on this
    // at runtime, regardless of what PlayableMedia's own type declares.
    expect(playResult).toBeInstanceOf(Promise);

    container.pause!();
    expect(instances[0]!.pause).toHaveBeenCalledTimes(1);

    const playSpy = vi.fn();
    const pauseSpy = vi.fn();
    const endedSpy = vi.fn();
    container.addEventListener('play', playSpy);
    container.addEventListener('pause', pauseSpy);
    container.addEventListener('ended', endedSpy);

    instances[0]!.trigger('play');
    expect(container.paused).toBe(false);
    expect(playSpy).toHaveBeenCalledTimes(1);

    instances[0]!.trigger('ended');
    expect(container.paused).toBe(true);
    expect(container.ended).toBe(true);
    expect(endedSpy).toHaveBeenCalledTimes(1);
    expect(pauseSpy).not.toHaveBeenCalled(); // ended alone never also dispatches pause
  });

  it("regression: dispatching 'pause' is held back briefly and dropped entirely if 'ended' arrives right after — Vimeo's own 'pause' can land shortly before 'ended' when a video reaches its natural end (DESIGN.md §4.1 point 13), and dispatching it immediately would misreport that as a manual pause to anything checking `.ended` synchronously (e.g. Autoplay's own onVideoPause)", async () => {
    vi.useFakeTimers();
    const { Vimeo, instances } = makeVimeoPlayerMock();
    window.Vimeo = Vimeo;
    const renderVimeo = await freshRenderVimeo();

    const container = document.createElement('div') as HTMLElement & { ended?: boolean };
    renderVimeo(container, vimeoItem, vi.fn(), new AbortController().signal, vi.fn());
    await Promise.resolve();
    instances[0]!.resolveReady();
    await Promise.resolve();

    const pauseSpy = vi.fn();
    const endedSpy = vi.fn();
    container.addEventListener('pause', pauseSpy);
    container.addEventListener('ended', endedSpy);

    instances[0]!.trigger('pause'); // Vimeo's own pause, arriving first
    instances[0]!.trigger('ended'); // ...immediately followed by ended, same as real usage

    vi.advanceTimersByTime(1000); // well past the hold-back window either way
    expect(endedSpy).toHaveBeenCalledTimes(1);
    expect(pauseSpy).not.toHaveBeenCalled(); // the held-back pause never fires at all
    expect(container.ended).toBe(true);
  });

  it('a genuine standalone pause (no ended following) still dispatches, just held back briefly', async () => {
    vi.useFakeTimers();
    const { Vimeo, instances } = makeVimeoPlayerMock();
    window.Vimeo = Vimeo;
    const renderVimeo = await freshRenderVimeo();

    const container = document.createElement('div') as HTMLElement & { paused?: boolean };
    renderVimeo(container, vimeoItem, vi.fn(), new AbortController().signal, vi.fn());
    await Promise.resolve();
    instances[0]!.resolveReady();
    await Promise.resolve();

    const pauseSpy = vi.fn();
    container.addEventListener('pause', pauseSpy);

    instances[0]!.trigger('pause');
    expect(container.paused).toBe(true); // the property updates immediately either way
    expect(pauseSpy).not.toHaveBeenCalled(); // but the event itself is held back

    vi.advanceTimersByTime(1000);
    expect(pauseSpy).toHaveBeenCalledTimes(1); // and fires once nothing preempted it
  });

  it('wires container.muted to forward to setMuted() — a real accessor, not inert state, but mirrors the last-set value locally since Vimeo has no synchronous getter', async () => {
    const { Vimeo, instances } = makeVimeoPlayerMock();
    window.Vimeo = Vimeo;
    const renderVimeo = await freshRenderVimeo();

    const container = document.createElement('div') as HTMLElement & { muted?: boolean };
    renderVimeo(container, vimeoItem, vi.fn(), new AbortController().signal, vi.fn());
    await Promise.resolve();
    instances[0]!.resolveReady();
    await Promise.resolve();

    expect(container.muted).toBe(false);

    container.muted = true;
    expect(instances[0]!.setMuted).toHaveBeenCalledWith(true);
    expect(container.muted).toBe(true);

    container.muted = false;
    expect(instances[0]!.setMuted).toHaveBeenCalledWith(false);
    expect(container.muted).toBe(false);
  });

  it("dispatches a bubbling 'error' CustomEvent on the container with the Vimeo error's name, once on('error') fires", async () => {
    const { Vimeo, instances } = makeVimeoPlayerMock();
    window.Vimeo = Vimeo;
    const renderVimeo = await freshRenderVimeo();

    const mount = document.createElement('div');
    const container = document.createElement('div');
    mount.appendChild(container);
    document.body.appendChild(mount);
    renderVimeo(container, vimeoItem, vi.fn(), new AbortController().signal, vi.fn());
    await Promise.resolve();

    const onError = vi.fn();
    mount.addEventListener('error', onError); // an ancestor — proves it bubbles

    instances[0]!.trigger('error', { name: 'PrivacyError', message: 'embedding disabled' });

    expect(onError).toHaveBeenCalledTimes(1);
    const event = onError.mock.calls[0]![0] as CustomEvent<{ name: string }>;
    expect(event.detail).toEqual({ name: 'PrivacyError' });
  });

  it('dispatches the error event even if ready() never resolved (e.g. a privacy-restricted video) — wirePlayableContract is not a prerequisite', async () => {
    const { Vimeo, instances } = makeVimeoPlayerMock();
    window.Vimeo = Vimeo;
    const renderVimeo = await freshRenderVimeo();

    const container = document.createElement('div');
    renderVimeo(container, vimeoItem, vi.fn(), new AbortController().signal, vi.fn());
    await Promise.resolve();

    const onError = vi.fn();
    container.addEventListener('error', onError);

    expect(() =>
      instances[0]!.trigger('error', { name: 'PasswordError', message: 'password required' }),
    ).not.toThrow();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('destroys the player once the signal aborts', async () => {
    const { Vimeo, instances } = makeVimeoPlayerMock();
    window.Vimeo = Vimeo;
    const renderVimeo = await freshRenderVimeo();

    const container = document.createElement('div');
    const controller = new AbortController();
    renderVimeo(container, vimeoItem, vi.fn(), controller.signal, vi.fn());
    await Promise.resolve();
    instances[0]!.resolveReady();
    await Promise.resolve();

    controller.abort();

    expect(instances[0]!.destroy).toHaveBeenCalledTimes(1);
  });

  it('does not construct a player at all if the signal was already aborted before the API resolved', async () => {
    const { Vimeo, instances } = makeVimeoPlayerMock();
    window.Vimeo = Vimeo;
    const renderVimeo = await freshRenderVimeo();

    const container = document.createElement('div');
    const controller = new AbortController();
    controller.abort(); // aborted before renderVimeo is even called
    renderVimeo(container, vimeoItem, vi.fn(), controller.signal, vi.fn());
    await Promise.resolve();

    expect(instances).toHaveLength(0);
  });
});

describe('renderVimeo — cold start (API not yet loaded)', () => {
  it('injects the player.js script exactly once and resolves once it loads', async () => {
    const renderVimeo = await freshRenderVimeo();
    const { Vimeo, instances } = makeVimeoPlayerMock();

    const container = document.createElement('div');
    const onReady = vi.fn();
    renderVimeo(container, vimeoItem, onReady, new AbortController().signal, vi.fn());

    const scripts = document.querySelectorAll(
      'script[src="https://player.vimeo.com/api/player.js"]',
    );
    expect(scripts).toHaveLength(1);
    expect(instances).toHaveLength(0); // API hasn't "loaded" yet

    // Simulate the script finishing (real browsers execute it and fire the
    // script's own load event; jsdom doesn't fetch external scripts).
    window.Vimeo = Vimeo;
    scripts[0]!.dispatchEvent(new Event('load'));
    await Promise.resolve();
    instances[0]!.resolveReady();
    await Promise.resolve();

    expect(onReady).toHaveBeenCalledTimes(1);
  });
});
