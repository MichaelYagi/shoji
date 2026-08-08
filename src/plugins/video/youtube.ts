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
  destroy(): void;
}

interface YTPlayerStateEvent {
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
};

function wirePlayableContract(container: HTMLElement, player: YTPlayer): PlayableElement {
  const playable = container as PlayableElement;
  playable.paused = true;
  playable.ended = false;
  playable.play = () => player.playVideo();
  playable.pause = () => player.pauseVideo();
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

  const mount = document.createElement('div');
  container.appendChild(mount);

  loadYouTubeApi().then((YT) => {
    if (signal.aborted) return; // navigated away before the (possibly first-ever, slow) API load resolved

    const playable = container as PlayableElement;
    const player = new YT.Player(mount, {
      videoId,
      playerVars: { playsinline: 1, rel: 0 },
      events: {
        onReady: () => onReady(),
        onStateChange: (event) => handleStateChange(event, YT, playable),
      },
    });
    wirePlayableContract(container, player);
    signal.addEventListener('abort', () => player.destroy(), { once: true });
  });
};
