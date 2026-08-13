import type { VideoProviderRenderer } from '../../core/plugin';

/**
 * The bits of Vimeo's Player SDK actually used here — not in `lib.dom.d.ts`
 * (a third-party global loaded on demand), so this is a documented interop
 * boundary (CLAUDE.md: `any` only there). Kept intentionally minimal, not a
 * full mirror of Vimeo's own typings. Unlike YouTube's IFrame API, every
 * method here is genuinely Promise-based — Vimeo has no synchronous
 * "isMuted()"-style query at all, which is why `wirePlayableContract` below
 * mirrors `muted` locally instead of reading it live (see its own comment).
 */
interface VimeoPlayer {
  play(): Promise<void>;
  pause(): Promise<void>;
  setMuted(muted: boolean): Promise<boolean>;
  ready(): Promise<void>;
  destroy(): Promise<void>;
  on(event: 'play' | 'pause' | 'ended', callback: () => void): void;
  on(event: 'error', callback: (error: VimeoErrorEvent) => void): void;
}

/** Vimeo's own error event shape (`name`/`message`, plus an undocumented `method` sometimes) — e.g. `name: 'PrivacyError'` (embedding disabled), `'PasswordError'` (password-protected). */
interface VimeoErrorEvent {
  name: string;
  message: string;
}

interface VimeoNamespace {
  Player: new (
    element: HTMLElement,
    options: { id?: number; url?: string; playsinline?: boolean },
  ) => VimeoPlayer;
}

declare global {
  interface Window {
    Vimeo?: VimeoNamespace;
  }
}

let apiPromise: Promise<VimeoNamespace> | null = null;

// See the 'pause'/'ended' race comment where this is used, below.
const PAUSE_DISPATCH_DELAY_MS = 250;

/**
 * Loads `https://player.vimeo.com/api/player.js` exactly once however many
 * Vimeo slides/galleries end up on a page — `window.Vimeo` is a single
 * global. Simpler than `youtube.ts`'s `loadYouTubeApi`: Vimeo's script has
 * no global-callback side channel to compose with (nothing else could
 * already be watching for it the way `onYouTubeIframeAPIReady` can be), so
 * a plain `script.onload` is enough.
 */
function loadVimeoApi(): Promise<VimeoNamespace> {
  if (window.Vimeo?.Player) return Promise.resolve(window.Vimeo);
  if (apiPromise) return apiPromise;

  apiPromise = new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = 'https://player.vimeo.com/api/player.js';
    script.onload = () => resolve(window.Vimeo!);
    document.head.appendChild(script);
  });
  return apiPromise;
}

/**
 * DESIGN.md §4-autoplay — Autoplay looks for exactly this shape (`.play`/
 * `.pause`/`.paused`/`.ended`, plus real `play`/`pause`/`ended` DOM events)
 * on whatever's active, native `<video>` or not. Augmenting `container` this
 * way is what makes slideshow sync work without Autoplay ever having to
 * know Vimeo — or any other provider — exists. `play` genuinely returns
 * `player.play()`'s own promise (unlike `youtube.ts`'s fire-and-forget
 * `.play`) — Autoplay's own `ensureProviderPlaying` (§4.1 point 12) branches
 * its retry strategy on whether this is a real thenable at runtime.
 */
type PlayableElement = HTMLElement & {
  play: () => Promise<void>;
  pause: () => void;
  paused: boolean;
  ended: boolean;
  muted: boolean;
};

/**
 * `muted`'s setter genuinely forwards to `player.setMuted()` (fire-and-
 * forget, same as `youtube.ts`'s `mute()`/`unMute()` calls), but the getter
 * mirrors a locally-tracked value instead of reading the player live —
 * unlike YouTube's `isMuted()`, Vimeo's `getMuted()` is Promise-based, so
 * there's no synchronous value to read at all. Harmless here: nothing in
 * Autoplay ever reads `.muted` back, only sets it (DESIGN.md §4.1 point 8's
 * `video.muted = true` before an automatic play).
 */
function wirePlayableContract(container: HTMLElement, player: VimeoPlayer): PlayableElement {
  const playable = container as PlayableElement;
  playable.paused = true;
  playable.ended = false;
  playable.play = () => player.play();
  playable.pause = () => player.pause();
  let mutedState = false;
  Object.defineProperty(playable, 'muted', {
    configurable: true,
    get: () => mutedState,
    set: (value: boolean) => {
      mutedState = value;
      player.setMuted(value);
    },
  });
  return playable;
}

/**
 * DESIGN.md §4-video — no poster/thumbnail handling at all: the slide shows
 * nothing until the embed itself is ready (same spinner-then-reveal every
 * other slide type gets), never an auto-fetched or guessed preview image.
 */
export const renderVimeo: VideoProviderRenderer = (container, item, onReady, signal) => {
  if (item.video?.provider !== 'vimeo') return;
  const { id, url } = item.video;
  if (!id && !url) {
    // A misconfigured item — scan.ts already warned about this at
    // normalization time. Same placeholder SlideManager itself uses for "no
    // source"/"provider not registered", so the spinner doesn't hang
    // forever waiting for a ready() that would never resolve otherwise.
    const placeholder = document.createElement('div');
    placeholder.className = 'shoji-slide-placeholder';
    placeholder.textContent = 'Video';
    container.appendChild(placeholder);
    onReady();
    return;
  }

  // shoji-video-mount (styles/shoji.css) — several real bugs, reported from
  // real usage, chased through in sequence:
  //
  // 1. Left at its own defaults, Vimeo's SDK sizes `mount` to a small fixed
  //    box (its own embed default, ~640x360) via inline styles — CSS's own
  //    `width/height: 100%` on the iframe only ever resolves relative to
  //    that fixed-size `mount`, not the actual slide, so the embed rendered
  //    small, in a corner, instead of filling the dialog.
  //
  // 2. `responsive: true` looked like the fix (and does make `mount` fill
  //    its parent's *width*) but doesn't actually solve this: it computes
  //    `mount`'s *height* from that width times the video's own native
  //    aspect ratio via a padding-percentage trick, entirely ignoring how
  //    much vertical space the slide actually has — confirmed directly at a
  //    wide-but-short viewport, the resulting iframe came out taller than
  //    its container, pushing the bottom of the video (and Vimeo's own
  //    scrubber/controls bar, always along that same edge) below the
  //    visible area.
  //
  // 3. Fully stretching `mount` to the container's own box instead (no
  //    aspect-ratio at all) fixed that, but traded it for a third bug:
  //    stretching regardless of the video's real 16:9 shape exposed
  //    Vimeo's own internal letterbox color (white — not overridable from
  //    here, that content is cross-origin) wherever the box wasn't already
  //    16:9 itself, instead of Shoji's own dark backdrop.
  //
  // `shoji-video-mount`'s CSS rules are what actually solve all three at
  // once now: contained to a real 16:9 box via container query units
  // (`!important` still doing the "discard whatever Vimeo tries to set
  // inline" job point 1 needed), so any leftover gap is *outside* the
  // iframe, showing this element's own transparent background — Shoji's
  // dark backdrop — rather than the provider's white. YouTube's plain
  // iframe (no such wrapper) gets the identical treatment directly, see
  // `.shoji-slide-provider-video > iframe` in shoji.css.
  const mount = document.createElement('div');
  mount.className = 'shoji-video-mount';
  container.appendChild(mount);

  loadVimeoApi().then((Vimeo) => {
    if (signal.aborted) return; // navigated away before the (possibly first-ever, slow) API load resolved

    const playable = container as PlayableElement;
    // `url` (the original data-shoji-video/video.url, when present) is
    // preferred over a bare id: it's what carries an unlisted video's
    // privacy hash (vimeo.com/{id}/{hash}) through to the player, which a
    // numeric id alone can't express. Only dynamic-mode items authored
    // without a url ever fall back to id-only.
    const player = new Vimeo.Player(mount, {
      ...(url ? { url } : { id: Number(id) }),
      playsinline: true,
    });

    // A real bug, reported from real usage: reaching the end of the video
    // stopped the slideshow instead of advancing it, and — the tell —
    // manually pressing play again restarted the same video from 0 instead
    // of resuming anywhere. Confirmed directly: Vimeo's own 'pause' arrives
    // as a genuinely separate postMessage event shortly *before* 'ended'
    // (~20ms apart in testing) when a video reaches its natural end, unlike
    // native `<video>`, whose `.ended` property the browser sets
    // synchronously before firing either event — Autoplay's own
    // `onVideoPause` (DESIGN.md §4.1 point 3) checks `.ended` to tell a
    // real pause from an end-adjacent one, and that check reliably lost the
    // race, reading `false` and treating a natural end as a manual pause.
    // Fixed by not dispatching 'pause' immediately: it's held for
    // `PAUSE_DISPATCH_DELAY_MS`, comfortably above the observed gap, and
    // dropped entirely if 'ended' arrives first — which is also then the
    // *only* event a natural end ever produces, matching how a single
    // native `<video>` 'pause' alongside 'ended' was already a non-issue
    // via the `.ended` check alone. A genuine manual pause (no 'ended'
    // following) still dispatches, just delayed by that same short window
    // — imperceptible for a real pause, and worth it for a correct one.
    let pendingPauseTimer: ReturnType<typeof setTimeout> | null = null;
    function clearPendingPause(): void {
      if (pendingPauseTimer !== null) {
        clearTimeout(pendingPauseTimer);
        pendingPauseTimer = null;
      }
    }
    player.on('play', () => {
      clearPendingPause();
      playable.paused = false;
      playable.dispatchEvent(new Event('play'));
    });
    player.on('pause', () => {
      playable.paused = true;
      clearPendingPause();
      pendingPauseTimer = setTimeout(() => {
        pendingPauseTimer = null;
        playable.dispatchEvent(new Event('pause'));
      }, PAUSE_DISPATCH_DELAY_MS);
    });
    player.on('ended', () => {
      clearPendingPause();
      playable.paused = true;
      playable.ended = true;
      playable.dispatchEvent(new Event('ended'));
    });
    // bubbles: true — reaches .shoji-slide-media (the pool slot, always
    // present regardless of readiness) without needing wirePlayableContract
    // to have run first; matches youtube.ts's onError — a player can error
    // out (bad id, privacy-restricted, password-protected) without ever
    // becoming ready. Autoplay (DESIGN.md §4.1) listens for this to skip to
    // the next slide instead of stalling.
    player.on('error', (error) =>
      playable.dispatchEvent(
        new CustomEvent('error', { bubbles: true, detail: { name: error.name } }),
      ),
    );

    player.ready().then(() => {
      wirePlayableContract(container, player);
      onReady();
    });

    signal.addEventListener(
      'abort',
      () => {
        clearPendingPause();
        void player.destroy();
      },
      { once: true },
    );
  });
};
