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
  /** Starts the slideshow automatically as soon as the gallery opens — every `open()`, not just the first — instead of waiting for the toolbar button/`Space`. Default `false`. */
  autoStart?: boolean;
  /** Pauses the slideshow while the viewer is zoomed in on the active slide (Zoom plugin) — stays paused until Play is pressed again, even once un-zoomed back to neutral (no auto-resume). A no-op if Zoom isn't loaded. Default `false` — opt-in, same reasoning as `pauseOnRotateFlip` below. */
  pauseOnZoom?: boolean;
  /** Pauses the slideshow on any RotateFlip interaction — including one that lands back on the original orientation, since the click itself is still an active interruption, not just its end state. Stays paused until Play is pressed again. A no-op if RotateFlip isn't loaded. Default `false` — opt-in, requested directly: a host embedding a gallery shouldn't have its slideshow's pause behavior silently change just because a viewer happens to touch a zoom/rotate control, unless it asked for that. */
  pauseOnRotateFlip?: boolean;
  /** Pauses the slideshow when the viewer expands a truncated caption to read the rest (core's own caption modal, DESIGN.md §2.3a) — stays paused until Play is pressed again, same as `pauseOnZoom`/`pauseOnRotateFlip`. No re-check on Play needed the way those two need one: the modal traps both pointer and keyboard input while open (core blocks every key, not just Escape), so Play is physically unreachable until the modal is already closed. Default `false` — same opt-in reasoning as the other two. */
  pauseOnCaptionExpand?: boolean;
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
    const autoStart = ctx.options.autoStart === true;
    const pauseOnZoom = ctx.options.pauseOnZoom === true;
    const pauseOnRotateFlip = ctx.options.pauseOnRotateFlip === true;
    const pauseOnCaptionExpand = ctx.options.pauseOnCaptionExpand === true;
    const locale = ctx.options.locale as Partial<Record<'play' | 'pause', string>> | undefined;
    const playLabel = locale?.play ?? 'Play slideshow';
    const pauseLabel = locale?.pause ?? 'Pause slideshow';

    let playing = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let currentVideo: PlayableMedia | null = null;
    let awaitingProviderVideo = false;
    let wasPlayingBeforeDrag = false;
    // Tracks only the *current* zoom/rotate-flip state, purely for
    // toggle()'s "was it already engaged the moment Play was pressed"
    // check below — not reused for the pause-on-event logic itself, which
    // reacts to each zoomChange/rotateFlipChange event directly instead of
    // consulting these.
    let zoomedIn = false;
    let rotatedOrFlipped = false;

    // A real bug, regression: this used to capture gallery.getActiveMedia()
    // once here and listen on that node directly, back when a pool slot's
    // own offset never changed after construction (only its *content*
    // moved between slots) — so "whichever slot has offset 0" was always
    // the same physical node, safe to capture once. SlideManager's pool now
    // relabels a slot's offset in place instead (§2.3) — the node that
    // happened to be offset 0 when this plugin initialized can become a
    // neighbor after even one navigation, while a *different* node becomes
    // the active one, silently going unheard by this listener. Listening on
    // `ctx.ui.outer()` instead (the whole lightbox, never relabeled) still
    // catches a provider's own error event (§4-video's `onError`, dispatched
    // with `bubbles: true`) regardless of which slide it came from — the
    // `contains()` check below is what actually scopes it to the currently
    // active slide, re-resolved fresh on every error rather than trusting a
    // stale reference.
    const outer = ctx.ui.outer();
    function onVideoError(event: Event): void {
      if (!playing) return;
      const active = gallery.getActiveMedia();
      if (active && event.target instanceof Node && active.contains(event.target)) advance();
    }
    outer.addEventListener('error', onVideoError);

    const button = document.createElement('button');
    button.type = 'button';
    // shoji-autoplay-toggle: a stable hook for host code that needs to find
    // this button from outside (e.g. to pause the slideshow before opening
    // its own UI on top) — `title`/`aria-label` swap with `locale`, so
    // matching on those breaks silently the moment a host customizes it.
    button.className = 'shoji-toolbar-button shoji-autoplay-toggle';
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

    /**
     * DESIGN.md §4.1 — while `pauseOnZoom`/`pauseOnRotateFlip` is holding
     * playback paused, pressing Play would otherwise just silently
     * re-pause it in the same synchronous tick (`toggle()`'s own check,
     * below) — no `transitionend`, no paint in between the two state
     * flips, so the button never visibly shows "Pause" at all before
     * reverting. Reported as looking broken, not just quiet. Disabling
     * the button while blocked (same `aria-disabled`/`tabIndex`/CSS
     * pattern as core's own slide-loading disable, Gallery.ts's
     * `setSlideLoading()`) makes "you can't resume yet" an honest, visible
     * state instead of a click that does nothing. Only while *not*
     * playing — while playing, the button always shows/means Pause, and
     * must stay clickable to stop regardless of zoom/rotate state.
     */
    function updateToggleAvailability(): void {
      const blocked =
        !playing && ((pauseOnZoom && zoomedIn) || (pauseOnRotateFlip && rotatedOrFlipped));
      button.ariaDisabled = blocked ? 'true' : null;
      if (blocked) button.tabIndex = -1;
      else button.removeAttribute('tabindex');
    }

    function setButtonState(isPlaying: boolean): void {
      playing = isPlaying;
      button.innerHTML = isPlaying ? PAUSE_ICON : PLAY_ICON;
      button.setAttribute('aria-label', isPlaying ? pauseLabel : playLabel);
      button.title = isPlaying ? pauseLabel : playLabel;
      updateToggleAvailability();
    }

    function onVideoEnded(): void {
      if (playing) advance();
    }

    // A real user pause, as opposed to the pause some browsers fire
    // immediately alongside 'ended' — `.ended` disambiguates the two.
    // Provider videos (§4.3's renderers) are responsible for holding their
    // own 'pause' dispatch back if it might just be a natural end arriving
    // slightly early — vimeo.ts's `PAUSE_DISPATCH_DELAY_MS` is why.
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
    //
    // A real bug, reported from real usage, found only once a second
    // promise-returning provider (Vimeo) existed to compare against:
    // re-issuing `play()`/`muted = true` on every retry — needed for
    // YouTube, whose fire-and-forget `playVideo()` can silently drop a
    // command issued before its postMessage bridge is fully settled — does
    // the opposite for a provider whose `play()` genuinely returns a
    // promise. Confirmed directly, isolated from Shoji entirely: a single,
    // uninterrupted `play()` call reliably started Vimeo playback in
    // ~1.6s, while calling it again every 400ms (this loop's original,
    // unconditional behavior) kept it stuck indefinitely — each new call
    // resets the progress the previous one had already made, so it never
    // gets an uninterrupted run long enough to actually start. (This is
    // also what point 12 below's retry-exhaustion was actually skipping
    // past: not a broken video, but this loop's own repeated calls
    // preventing it from ever finishing what the first one started.)
    // `video.play()`'s return type only *claims* to be a promise for every
    // provider (see the `PlayableMedia` doc comment above) — branching on
    // whether it genuinely is one is what lets each provider get the
    // retry behavior it actually needs from this one shared function.
    function ensureProviderPlaying(video: PlayableMedia, attemptsLeft: number): void {
      video.muted = true;
      const playResult = video.play();
      if (playResult && typeof playResult.then === 'function') {
        pollWithoutReissuing(video, attemptsLeft, playResult);
      } else {
        reissueOnEachRetry(video, attemptsLeft);
      }
    }

    /** Fire-and-forget `play()` (YouTube) — re-issues the command itself on every retry, per this function's own doc comment above. */
    function reissueOnEachRetry(video: PlayableMedia, attemptsLeft: number): void {
      setTimeout(() => {
        if (currentVideo !== video || !playing) return; // stale — slide changed, or already stopped
        if (!video.paused) return; // took effect
        if (attemptsLeft > 0) ensureProviderPlaying(video, attemptsLeft - 1);
        // Exhausted every retry after already muting first — muted
        // autoplay is essentially never blocked by policy, so this means
        // something is genuinely wrong with the embed, not that it's
        // waiting on a gesture. advance() (not stop()) so a slow/late
        // error report (real usage: YouTube's own error can arrive slower
        // than this retry window, e.g. Error 153) can't leave the
        // slideshow stuck if this fires first.
        else advance();
      }, PROVIDER_PLAY_RETRY_MS);
    }

    /** A genuine `play()` promise (e.g. Vimeo) — the command itself is only ever issued once (by the caller); this only re-checks `.paused` on the same schedule, over the same total budget, without ever calling `play()` again. */
    function pollWithoutReissuing(
      video: PlayableMedia,
      attemptsLeft: number,
      playResult: Promise<void>,
    ): void {
      // Swallowed deliberately: a rejection here isn't distinguished from
      // "still pending" — the .paused poll below is what actually decides
      // whether this took effect, on the same schedule regardless of how
      // the promise itself settles. An unhandled-rejection console warning
      // is the only cost, same tradeoff as the native <video> path below
      // taking a real .catch() instead when it needs to branch on *why*.
      playResult.catch(() => {});
      setTimeout(() => {
        if (currentVideo !== video || !playing) return;
        if (!video.paused) return;
        if (attemptsLeft > 0) pollWithoutReissuing(video, attemptsLeft - 1, playResult);
        else advance();
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
          // A rejected play() has two different causes that look identical
          // here: the browser blocking an unmuted play() that isn't a direct
          // continuation of a user gesture (NotAllowedError — the video is
          // fine, it just needs the viewer's own click) or the video
          // genuinely being unplayable (NotSupportedError — a broken/missing
          // source, an unsupported format). Only the first pauses the
          // slideshow for the viewer to resolve by hand; anything else means
          // there's nothing to wait for, so it skips ahead instead.
          if (playResult && typeof playResult.catch === 'function') {
            playResult.catch((error: unknown) => {
              if (currentVideo !== video || !playing) return; // stale
              if (error instanceof DOMException && error.name === 'NotAllowedError') stop();
              else advance();
            });
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
      if (playing) {
        stop();
        return;
      }
      start();
      // A real bug, reported from real usage: zooming in *first*, then
      // pressing Play, never paused at all — clicking Play doesn't itself
      // fire zoomChange/rotateFlipChange, and a single-step "toggle back to
      // neutral" action afterward (Actual size, double-tap-to-reset) only
      // ever emits the *already-neutral* event, never one crossing the
      // engaged threshold — so nothing downstream would ever have caught it
      // either. Re-checked here instead, right after a genuine manual
      // start — the one path a viewer can actually reach a non-neutral view
      // state from *before* pressing Play. `zoomedIn`/`rotatedOrFlipped`
      // (below) track only the *current* state, purely for this check —
      // deliberately not reused for the pause-on-event logic itself, which
      // reacts to each event directly.
      if ((pauseOnZoom && zoomedIn) || (pauseOnRotateFlip && rotatedOrFlipped)) stop();
    }

    /**
     * Pauses the slideshow the instant a vertical drag crosses the close
     * threshold, mirroring the controls' own live hide cue
     * (`dragCloseThreshold`) — asked for directly, otherwise the
     * interval/video kept running mid-drag. Resumes only if *this*
     * crossing paused it — a manual pause (toolbar, mid-drag tap) must
     * stay paused even if the drag retreats back under the threshold.
     */
    const offDragThreshold = ctx.on('dragCloseThreshold', ({ hidden }) => {
      if (hidden) {
        wasPlayingBeforeDrag = playing;
        if (playing) stop();
      } else if (wasPlayingBeforeDrag) {
        wasPlayingBeforeDrag = false;
        start();
      }
    });

    /**
     * DESIGN.md §4.1 — a real UX gap, not a reported bug: nothing stopped
     * the slideshow from auto-advancing out from under a viewer actively
     * zoomed into a detail on the current slide. Only reacts to
     * `zoomChange`'s event *shape* (`core/types.ts`) — never imports Zoom
     * directly, so this is a no-op with it not loaded, or with
     * `pauseOnZoom: false` (events over inheritance, CLAUDE.md).
     *
     * Deliberately **stays paused** rather than auto-resuming once
     * un-zoomed back to neutral — the first design tried the opposite
     * (edge-tracked "engaged" state, auto-resume on disengage, matching
     * `dragCloseThreshold` below) and hit two real problems testing it:
     * (1) a manual restart while still zoomed left the edge-tracker stuck
     * "already engaged," silently skipping the *next* re-pause; (2) once
     * fixed, un-zooming back to exactly scale 1 still auto-resumed even
     * when the viewer's very next action (confirmed directly for
     * RotateFlip's equivalent, below) was to keep interacting with the
     * view controls, not watch the slideshow. `scale > 1` still gates
     * *which* zoomChange events count (an ordinary scale-1 event can also
     * fire from an unrelated slide-change reset, not a real interaction —
     * `zoom/index.ts`'s `reset()` — so it can't unconditionally pause on
     * every event the way rotateFlipChange below safely can).
     */
    const ZOOM_ENGAGED_THRESHOLD = 1.001; // matches Zoom's own ZOOM_EPSILON — "just barely above 1" is float residue, not a real zoom
    const offZoomChange = ctx.on('zoomChange', ({ scale }) => {
      zoomedIn = scale > ZOOM_ENGAGED_THRESHOLD;
      if (pauseOnZoom && zoomedIn && playing) stop();
      else updateToggleAvailability(); // stop() above already refreshes this; covers zooming in while already paused, which stop() wouldn't touch
    });
    /**
     * Same UX gap, RotateFlip's own equivalent — off by default (see
     * `pauseOnRotateFlip`'s own doc comment). Pauses on *any*
     * `rotateFlipChange` event unconditionally, including one that lands
     * back on the original orientation — confirmed directly, reported from
     * real usage: rotate four times back to 0deg still reads as an active
     * interruption of the slideshow, not "nothing happened," so it must
     * stay paused too, the same as landing anywhere else. Every
     * `rotateFlipChange` (unlike zoomChange above) only ever fires from a
     * real button/shortcut click — `rotateFlip/index.ts`'s own per-slide
     * `reset()` never emits it — so no extra state check is needed here.
     */
    const offRotateFlipChange = ctx.on('rotateFlipChange', ({ flipH, flipV, rotation }) => {
      rotatedOrFlipped = flipH || flipV || rotation !== 0;
      if (pauseOnRotateFlip && playing) stop();
      else updateToggleAvailability(); // stop() above already refreshes this; covers rotating while already paused, which stop() wouldn't touch
    });
    /**
     * `pauseOnCaptionExpand`'s own doc comment above — unlike the two
     * listeners above, no `updateToggleAvailability()` companion call and
     * no `zoomedIn`/`rotatedOrFlipped`-style tracked flag: the caption
     * modal already makes Play physically unreachable while `open: true`
     * (core's own focus trap + capture-phase keydown blocking, not
     * anything this plugin has to enforce), so there's no "pressed Play
     * while still blocked" case to disable the button for or re-check on
     * toggle() the way zoom/rotateFlip both need.
     */
    const offCaptionModalChange = ctx.on('captionModalChange', ({ open }) => {
      if (pauseOnCaptionExpand && open && playing) stop();
    });

    button.addEventListener('click', toggle);

    // 'right' — clusters immediately before the close button, per DESIGN.md §3.1.
    const removeButton = ctx.ui.toolbar('right', button);
    const removeProgress = showProgress ? ctx.ui.overlay(progress) : null;
    const removeShortcut = ctx.ui.registerShortcut(' ', toggle);
    // Detaches this plugin's own 'pause'/'ended' listeners from the outgoing
    // video before Gallery.navigate() pauses it (see Gallery.ts's comment on
    // this same event) — otherwise that pause is misread as the viewer
    // manually pausing, which stops the slideshow before the new slide's
    // afterSlide handler below ever runs. enterSlide() below also calls
    // detachVideo(), but by then it's too late for *this* transition; that
    // call is what handles the slide *after* this one instead.
    const offBeforeSlide = ctx.on('beforeSlide', () => {
      detachVideo();
    });
    // Any slide change — autoplay's own next(), or the viewer manually
    // navigating mid-slideshow via arrows/buttons/goTo() — re-enters here,
    // tearing down the previous slide's timer/video listeners and setting
    // up fresh ones for whatever is active now. advance() deliberately does
    // NOT call enterSlide() itself: next() already triggers this listener
    // synchronously, so calling it twice would double up the timer/video wiring.
    const offSlide = ctx.on('afterSlide', () => {
      // Zoom/RotateFlip both reset unanimated on navigation (DESIGN.md
      // §2.5) without re-emitting zoomChange/rotateFlipChange — resynced
      // here so a stale "was engaged" reading from the *outgoing* slide
      // can't wrongly re-pause toggle()'s next Play press on a slide
      // that's actually neutral now.
      zoomedIn = false;
      rotatedOrFlipped = false;
      updateToggleAvailability();
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
    const offOpen = ctx.on('afterOpen', () => {
      zoomedIn = false;
      rotatedOrFlipped = false;
      updateToggleAvailability();
      if (autoStart) start();
    });

    return () => {
      stop();
      outer.removeEventListener('error', onVideoError);
      removeButton();
      removeProgress?.();
      removeShortcut();
      offBeforeSlide();
      offSlide();
      offSlideItemLoad();
      offOpen();
      offClose();
      offDragThreshold();
      offZoomChange();
      offRotateFlipChange();
      offCaptionModalChange();
    };
  },
};
