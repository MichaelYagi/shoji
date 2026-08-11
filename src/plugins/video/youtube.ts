import type { VideoProviderRenderer } from '../../core/plugin';

/**
 * The bits of the YouTube IFrame Player API actually used here — not in
 * `lib.dom.d.ts` (a third-party global loaded on demand), so this is a
 * documented interop boundary (CLAUDE.md: `any` only there). Kept
 * intentionally minimal, not a full mirror of YouTube's own typings.
 */
interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  mute(): void;
  unMute(): void;
  isMuted(): boolean;
  destroy(): void;
}

interface YTPlayerStateEvent {
  data: number;
}

/**
 * Same `{ data: number }` shape as `YTPlayerStateEvent` — `data` holds an
 * error code there (2 invalid parameter, 5 HTML5 player error, 100 video
 * not found/private, 101/150 embedding disabled by the owner; undocumented
 * codes like 153 are also reported in the wild) rather than a player state.
 * Named separately from `YTPlayerStateEvent` for readability at the call
 * site, not because the shape actually differs.
 */
interface YTPlayerErrorEvent {
  data: number;
}

interface YTNamespace {
  Player: new (
    el: HTMLElement,
    opts: {
      videoId: string;
      playerVars?: { playsinline?: 0 | 1; rel?: 0 | 1 };
      events?: {
        onReady?: () => void;
        onStateChange?: (event: YTPlayerStateEvent) => void;
        onError?: (event: YTPlayerErrorEvent) => void;
      };
    },
  ) => YTPlayer;
  PlayerState: { ENDED: number; PLAYING: number; PAUSED: number };
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<YTNamespace> | null = null;

/**
 * Loads `https://www.youtube.com/iframe_api` exactly once however many
 * YouTube slides/galleries end up on a page — the API itself is a single
 * global (`window.YT`), and re-injecting the script tag would be wasteful
 * and risks a second, conflicting `onYouTubeIframeAPIReady` firing. Composes
 * with a host's own `onYouTubeIframeAPIReady`, if one already exists
 * (e.g. the host embeds YouTube elsewhere too), instead of clobbering it.
 */
function loadYouTubeApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;

  apiPromise = new Promise((resolve) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve(window.YT!);
    };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(script);
  });
  return apiPromise;
}

/**
 * DESIGN.md §4-autoplay — Autoplay looks for exactly this shape (`.play`/
 * `.pause`/`.paused`/`.ended`, plus real `play`/`pause`/`ended` DOM events)
 * on whatever's active, native `<video>` or not. Augmenting `container`
 * this way is what makes slideshow sync work without Autoplay ever having
 * to know YouTube — or any other provider — exists.
 */
type PlayableElement = HTMLElement & {
  play: () => void;
  pause: () => void;
  paused: boolean;
  ended: boolean;
  muted: boolean;
};

/**
 * `muted` is a real accessor (not a plain property) backed by the player's
 * own `mute()`/`unMute()`/`isMuted()` — DESIGN.md §4.1's autoplay-policy fix
 * sets `video.muted = true` right before an *automatic* play, the same way
 * it would for a native `<video>`; a plain property here would just be
 * inert state that never actually silences the embed.
 */
function wirePlayableContract(container: HTMLElement, player: YTPlayer): PlayableElement {
  const playable = container as PlayableElement;
  playable.paused = true;
  playable.ended = false;
  playable.play = () => player.playVideo();
  playable.pause = () => player.pauseVideo();
  Object.defineProperty(playable, 'muted', {
    configurable: true,
    get: () => player.isMuted(),
    set: (value: boolean) => (value ? player.mute() : player.unMute()),
  });
  return playable;
}

function handleStateChange(
  event: YTPlayerStateEvent,
  YT: YTNamespace,
  playable: PlayableElement,
): void {
  if (event.data === YT.PlayerState.PLAYING) {
    playable.paused = false;
    playable.dispatchEvent(new Event('play'));
  } else if (event.data === YT.PlayerState.PAUSED) {
    playable.paused = true;
    playable.dispatchEvent(new Event('pause'));
  } else if (event.data === YT.PlayerState.ENDED) {
    playable.paused = true;
    playable.ended = true;
    playable.dispatchEvent(new Event('ended'));
  }
}

/**
 * DESIGN.md §4-video — no poster/thumbnail handling at all: the slide shows
 * nothing until the embed itself is ready (same spinner-then-reveal every
 * other slide type gets), never an auto-fetched or guessed preview image.
 */
export const renderYouTube: VideoProviderRenderer = (container, item, onReady, signal) => {
  if (item.video?.provider !== 'youtube') return;
  const videoId = item.video.id;
  if (!videoId) {
    // A misconfigured item — scan.ts (data-shoji-video-id / video: true /
    // video.id auto-fill) already warned about this at normalization time.
    // Same placeholder SlideManager itself uses for "no source"/"provider
    // not registered", so the spinner doesn't hang forever waiting for an
    // onReady that would never fire otherwise.
    const placeholder = document.createElement('div');
    placeholder.className = 'shoji-slide-placeholder';
    placeholder.textContent = 'Video';
    container.appendChild(placeholder);
    onReady();
    return;
  }

  const mount = document.createElement('div');
  container.appendChild(mount);

  loadYouTubeApi().then((YT) => {
    if (signal.aborted) return; // navigated away before the (possibly first-ever, slow) API load resolved

    const playable = container as PlayableElement;
    const player = new YT.Player(mount, {
      videoId,
      playerVars: { playsinline: 1, rel: 0 },
      events: {
        // `new YT.Player()` returns before the embed's own internal bootstrap
        // (its postMessage handshake with youtube.com) finishes — calling
        // `player.mute()`/`playVideo()`/etc. before that completes can throw
        // ("player.isMuted is not a function") or silently no-op, even though
        // the constructor already returned an object. `onReady` is YouTube's
        // own signal that the real API surface is actually callable now, so
        // wiring the contract here — not synchronously after construction —
        // is what makes `findPlayable()`'s "is `.play` wired?" check in
        // Autoplay (DESIGN.md §4.1) an accurate proxy for "is it really
        // ready?" instead of just "did we build the wrapper closures?".
        onReady: () => {
          wirePlayableContract(container, player);
          onReady();
        },
        onStateChange: (event) => handleStateChange(event, YT, playable),
        // bubbles: true — reaches .shoji-slide-media (the pool slot, always
        // present regardless of readiness) without needing wirePlayableContract
        // to have run first; onError can fire instead of onReady entirely
        // (e.g. a removed/private video), so playable isn't a safe assumption
        // here the way it is in onStateChange. Autoplay (DESIGN.md §4.1)
        // listens for this to skip to the next slide instead of stalling.
        onError: (event) =>
          playable.dispatchEvent(
            new CustomEvent('error', { bubbles: true, detail: { code: event.data } }),
          ),
      },
    });
    signal.addEventListener('abort', () => player.destroy(), { once: true });
  });
};
