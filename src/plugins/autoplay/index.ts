import type { PluginContext, ShojiPlugin } from '../../core/plugin';
import { PAUSE_ICON, PLAY_ICON } from './icons';
import './autoplay.css';

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
  defaults: { interval: 5000 },

  init(ctx: PluginContext): () => void {
    const { gallery } = ctx;
    const interval = Number(ctx.options.interval ?? 5000);
    const locale = ctx.options.locale as Partial<Record<'play' | 'pause', string>> | undefined;
    const playLabel = locale?.play ?? 'Play slideshow';
    const pauseLabel = locale?.pause ?? 'Pause slideshow';

    let playing = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let currentVideo: HTMLVideoElement | null = null;

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
      progress.hidden = true;
      progressBar.style.transition = 'none';
      progressBar.style.width = '0%';
    }

    function runProgressBar(ms: number): void {
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

    function enterSlide(): void {
      clearTimer();
      detachVideo();
      resetProgressBar();
      if (!playing) return;

      const media = gallery.getActiveMedia();
      const video = media?.querySelector('video') ?? null;
      if (video) {
        currentVideo = video;
        video.addEventListener('ended', onVideoEnded);
        video.addEventListener('pause', onVideoPause);
        const playResult = video.play();
        // Browsers can block an unmuted play() that isn't a direct
        // continuation of a user gesture (e.g. one arriving via this
        // setTimeout/'ended' chain rather than the toggle button's click) —
        // pause the slideshow and wait for the viewer rather than getting
        // stuck with a video that silently never plays or advances.
        if (playResult && typeof playResult.catch === 'function') {
          playResult.catch(() => stop());
        }
        return;
      }

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
    const removeProgress = ctx.ui.overlay(progress);
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
    const offClose = ctx.on('close', () => stop());

    return () => {
      stop();
      removeButton();
      removeProgress();
      removeShortcut();
      offSlide();
      offClose();
    };
  },
};
