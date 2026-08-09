import type { PluginContext, ShojiPlugin } from '../../core/plugin';
import { PAUSE_ICON, PLAY_ICON } from './icons';
import './autoplay.css';

/**
 * A native `<video>` or a `.shoji-slide-provider-video` container a video
 * provider plugin (§4-video) has augmented with the same shape — Autoplay
 * never needs to know which. `play()`'s return type is technically a lie
 * for the provider case (that `.play` is a synchronous fire-and-forget, no
 * `HTMLVideoElement.play()`-style promise) — harmless, `enterSlide()`'s own
 * `typeof playResult.catch === 'function'` guard already treats a
 * non-promise `play()` result as "nothing to await," same as `undefined`.
 */
type PlayableMedia = Pick<
  HTMLVideoElement,
  'play' | 'pause' | 'paused' | 'ended' | 'muted' | 'addEventListener' | 'removeEventListener'
>;

/** `.shoji-slide-provider-video` only counts if it's actually been wired up as playable (§4-video's `wirePlayableContract`) — a provider still mid-async-setup, or one that never opted into Autoplay sync at all, isn't. */
function findPlayable(media: HTMLElement | null): PlayableMedia | null {
  const video = media?.querySelector('video');
  if (video) return video;
  const provider = media?.querySelector<HTMLElement & Partial<PlayableMedia>>(
    '.shoji-slide-provider-video',
  );
  if (provider && typeof provider.play === 'function') return provider as PlayableMedia;
  return null;
}

/** A provider container is attached to the DOM immediately (§4-video), well before its async setup (loading an SDK, constructing a player) finishes wiring `.play` — this is what tells `enterSlide()` "there's a video here, it's just not playable yet" apart from "no video at all," so it doesn't mistreat a still-loading video as an ordinary timed slide. */
function isPendingProviderVideo(media: HTMLElement | null): boolean {
  const provider = media?.querySelector<HTMLElement & Partial<PlayableMedia>>(
    '.shoji-slide-provider-video',
  );
  return !!provider && typeof provider.play !== 'function';
}

// A provider embed's postMessage bridge (DESIGN.md §4.3) can need more real
// time after "ready" before it reliably processes its first command — a
// play() issued too soon can silently no-op with nothing to catch. Retries
// a few times with a short delay instead of a single best-effort attempt.
const PROVIDER_PLAY_RETRY_MS = 400;
const MAX_PROVIDER_PLAY_ATTEMPTS = 8; // + the initial attempt = 9 total, ~3.6s before giving up

export interface AutoplayOptions {
  /** Milliseconds between advances for timed (photo) slides. Default `5000`. */
  interval?: number;
  /** Shows the thin progress bar (`--shoji-progress`) tracking time-to-next-advance along the dialog's bottom edge, for timed slides only — never shown during video slides, whose own runtime drives advancement instead. Default `true`. Purely presentational: turning it off doesn't change any timing, only whether it's drawn. */
  showProgress?: boolean;
}

/**
 * DESIGN.md §4-autoplay. Advances on a fixed `interval` (default 5000ms) for
 * ordinary slides; for a video slide, plays it and waits for `ended` instead
 * — the interval never applies to video. A manual pause on that video pauses
 * the *slideshow* too (not just the video); manually resuming the video does
 * NOT resume the slideshow — that requires pressing the slideshow's own
 * play control again. See `enterSlide()`/`onVideoPause()` below for exactly
 * where each half of that rule lives.
 */
export const Autoplay: ShojiPlugin = {
  name: 'autoplay',
  defaults: { interval: 5000, showProgress: true } satisfies AutoplayOptions,

  init(ctx: PluginContext): () => void {
    const { gallery } = ctx;
    const interval = Number(ctx.options.interval ?? 5000);
    const showProgress = ctx.options.showProgress !== false;
    const locale = ctx.options.locale as Partial<Record<'play' | 'pause', string>> | undefined;
    const playLabel = locale?.play ?? 'Play slideshow';
    const pauseLabel = locale?.pause ?? 'Pause slideshow';

    let playing = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let currentVideo: PlayableMedia | null = null;
    let awaitingProviderVideo = false;

    // .shoji-slide-media (offset 0) is a stable node for the gallery's whole
    // lifetime (SlideManager's pool, DESIGN.md §2.3) — registered once here,
    // not per enterSlide(), rather than tracked/detached alongside
    // currentVideo. A provider's own error event (§4-video, e.g. YouTube's
    // onError) bubbles up to it regardless of which slide is currently
    // showing there, or whether findPlayable() would even consider it
    // "ready" yet — a video that errors out before ever becoming playable
    // would otherwise just sit through the full `interval` fallback timer
    // instead of skipping ahead immediately.
    const media = gallery.getActiveMedia();
    function onVideoError(): void {
      if (playing) advance();
    }
    media?.addEventListener('error', onVideoError);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'shoji-toolbar-button';
    button.setAttribute('aria-label', playLabel);
    button.title = playLabel;
    button.innerHTML = PLAY_ICON;

    const progress = document.createElement('div');
    progress.className = 'shoji-autoplay-progress';
    progress.hidden = true;
    const progressBar = document.createElement('div');
    progressBar.className = 'shoji-autoplay-progress-bar';
    progress.appendChild(progressBar);

    function clearTimer(): void {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    }

    function resetProgressBar(): void {
      if (!showProgress) return;
      progress.hidden = true;
      progressBar.style.transition = 'none';
      progressBar.style.width = '0%';
    }

    function runProgressBar(ms: number): void {
      if (!showProgress) return;
      progress.hidden = false;
      progressBar.style.transition = 'none';
      progressBar.style.width = '0%';
      void progressBar.offsetWidth; // commit the reset before transitioning
      progressBar.style.transition = `width ${ms}ms linear`;
      progressBar.style.width = '100%';
    }

    function setButtonState(isPlaying: boolean): void {
      playing = isPlaying;
      button.innerHTML = isPlaying ? PAUSE_ICON : PLAY_ICON;
      button.setAttribute('aria-label', isPlaying ? pauseLabel : playLabel);
      button.title = isPlaying ? pauseLabel : playLabel;
    }

    function onVideoEnded(): void {
      if (playing) advance();
    }

    // A real user pause, as opposed to the pause some browsers fire
    // immediately alongside 'ended' — `.ended` disambiguates the two.
    function onVideoPause(): void {
      if (currentVideo?.ended) return;
      stop();
    }

    function detachVideo(): void {
      if (!currentVideo) return;
      currentVideo.removeEventListener('ended', onVideoEnded);
      currentVideo.removeEventListener('pause', onVideoPause);
      currentVideo = null;
    }

    // A provider embed (e.g. YouTube) is cross-origin — unlike native
    // <video>, its own autoplay policy requires a *direct* user gesture on
    // the embed itself, which an automatic play() arriving via this
    // timer/'ended'/slideItemLoad chain never has; it silently no-ops
    // rather than rejecting, so there's nothing to catch. Muting first is
    // what actually gets it to play — the viewer can still unmute via the
    // embed's own controls.
    function ensureProviderPlaying(video: PlayableMedia, attemptsLeft: number): void {
      video.muted = true;
      video.play();
      setTimeout(() => {
        if (currentVideo !== video || !playing) return; // stale — slide changed, or already stopped
        if (!video.paused) return; // took effect
        if (attemptsLeft > 0) ensureProviderPlaying(video, attemptsLeft - 1);
        else stop(); // exhausted retries — don't leave the slideshow silently stuck
      }, PROVIDER_PLAY_RETRY_MS);
    }

    function enterSlide(): void {
      clearTimer();
      detachVideo();
      resetProgressBar();
      awaitingProviderVideo = false;
      if (!playing) return;

      const media = gallery.getActiveMedia();
      const video = findPlayable(media);
      if (video) {
        currentVideo = video;
        video.addEventListener('ended', onVideoEnded);
        video.addEventListener('pause', onVideoPause);
        if (video instanceof HTMLVideoElement) {
          const playResult = video.play();
          // Browsers can block an unmuted native <video> play() that isn't a
          // direct continuation of a user gesture (e.g. one arriving via this
          // setTimeout/'ended' chain rather than the toggle button's click) —
          // pause the slideshow and wait for the viewer rather than getting
          // stuck with a video that silently never plays or advances.
          if (playResult && typeof playResult.catch === 'function') {
            playResult.catch(() => stop());
          }
        } else {
          ensureProviderPlaying(video, MAX_PROVIDER_PLAY_ATTEMPTS);
        }
        return;
      }

      // A provider video (e.g. YouTube) still mid-setup isn't an ordinary
      // slide either — the slideItemLoad listener below re-enters once it's
      // actually playable. This timer is a fallback in case that never
      // happens (network failure, blocked, ...), so the slideshow can't
      // stall on it forever.
      awaitingProviderVideo = isPendingProviderVideo(media);
      runProgressBar(interval);
      timer = setTimeout(advance, interval);
    }

    function advance(): void {
      const before = gallery.currentIndex;
      gallery.next();
      // loop:false and next() was already at the last item — nothing left
      // to advance to; the 'afterSlide' handler below won't fire for a
      // no-op goTo(), so this is the only place that can catch it.
      if (gallery.currentIndex === before) stop();
    }

    function start(): void {
      if (playing) return;
      setButtonState(true);
      ctx.emit('autoplayStart', {});
      enterSlide();
    }

    function stop(): void {
      if (!playing) return;
      setButtonState(false);
      clearTimer();
      resetProgressBar();
      if (currentVideo && !currentVideo.paused) currentVideo.pause();
      detachVideo();
      ctx.emit('autoplayStop', {});
    }

    function toggle(): void {
      if (playing) stop();
      else start();
    }

    button.addEventListener('click', toggle);

    // 'right' — clusters immediately before the close button, per DESIGN.md §3.1.
    const removeButton = ctx.ui.toolbar('right', button);
    const removeProgress = showProgress ? ctx.ui.overlay(progress) : null;
    const removeShortcut = ctx.ui.registerShortcut(' ', toggle);
    // Any slide change — autoplay's own next(), or the viewer manually
    // navigating mid-slideshow via arrows/buttons/goTo() — re-enters here,
    // tearing down the previous slide's timer/video listeners and setting
    // up fresh ones for whatever is active now. advance() deliberately does
    // NOT call enterSlide() itself: next() already triggers this listener
    // synchronously, so calling it twice would double up the timer/video wiring.
    const offSlide = ctx.on('afterSlide', () => {
      if (playing) enterSlide();
    });
    // A provider video (§4-video) that was still mid-setup when enterSlide()
    // last ran — see awaitingProviderVideo there — becomes playable some
    // time after afterSlide already fired and gave up on it for this pass.
    // Re-enter once it's genuinely ready, scoped to the still-active index
    // so a slide the viewer has already moved past doesn't retroactively
    // hijack the timer.
    const offSlideItemLoad = ctx.on('slideItemLoad', ({ index }) => {
      if (playing && awaitingProviderVideo && index === gallery.currentIndex) enterSlide();
    });
    const offClose = ctx.on('close', () => stop());

    return () => {
      stop();
      media?.removeEventListener('error', onVideoError);
      removeButton();
      removeProgress?.();
      removeShortcut();
      offSlide();
      offSlideItemLoad();
      offClose();
    };
  },
};
