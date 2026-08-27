import type { PluginContext, ShojiPlugin } from '../../core/plugin';
import './activeThumbnail.css';

export interface ActiveThumbnailOptions {
  /** CSS class applied to the origin thumbnail for whichever slide is currently active. Default `'shoji-thumb-active'` — Shoji ships no default styling for this class itself (the host's own thumbnail markup, or the layout plugin's tiles, define what "active" looks like); see `highlight` below for Shoji's own opt-in styling. */
  activeClass?: string;
  /** Scrolls the active thumbnail into view (`block: 'nearest'`) whenever it changes. Default `true`. */
  scrollIntoView?: boolean;
  /** Opt-in: also adds a second, fixed (non-renameable) class that Shoji ships real CSS for — a `borderColor` outline around the active thumbnail — instead of leaving 100% of the visual highlight to the host. Default `false`. */
  highlight?: boolean;
  /** Only visible when `highlight: true`. Sets `--shoji-active-thumbnail-border-color` on the active element. Default `'blue'`. */
  borderColor?: string;
  /** Only meaningful when `highlight: true`. Milliseconds after `close()` (i.e. after the highlight actually becomes visible, not from when the slide became active) to fade it out. Default `undefined` — persists indefinitely, moving only when a different slide becomes active. Does not touch `activeClass`, only the built-in `highlight` styling. */
  highlightDuration?: number;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Opt-in: keeps the host's thumbnail grid in sync with whichever slide is
 * currently open — highlighting it and, by default, scrolling it into view —
 * as the viewer moves through the lightbox by any means (arrow keys,
 * prev/next buttons, a completed swipe, autoplay ticking forward, a plugin
 * calling `goTo()`). Not core: CLAUDE.md's "everything that can be a plugin
 * is a plugin" — a host whose thumbnail grid is short enough to always be
 * fully visible, or who doesn't want their page scrolling out from under
 * them mid-slideshow, should be able to leave this off entirely.
 *
 * Reuses `Gallery.getOriginElement()` (the same index → thumbnail lookup the
 * zoom transition already relies on, §2.3b) rather than re-deriving it, so
 * this plugin's coverage exactly matches whatever the zoom transition
 * already zooms to/from: `scannedElements[index]` in selector mode,
 * `data-shoji-id="<item.id>"` markers elsewhere (including the layout
 * plugin's own tiles, which set that attribute automatically when
 * `item.id` is present).
 */
export const ActiveThumbnail: ShojiPlugin = {
  name: 'activeThumbnail',
  defaults: {
    activeClass: 'shoji-thumb-active',
    scrollIntoView: true,
    highlight: false,
    borderColor: 'blue',
  } satisfies ActiveThumbnailOptions,

  init(ctx: PluginContext): () => void {
    const { gallery } = ctx;
    const activeClass = String(ctx.options.activeClass ?? 'shoji-thumb-active');
    const scrollIntoView = ctx.options.scrollIntoView !== false;
    const highlight = ctx.options.highlight === true;
    const borderColor = String(ctx.options.borderColor ?? 'blue');
    const highlightDuration =
      typeof ctx.options.highlightDuration === 'number' ? ctx.options.highlightDuration : null;
    const HIGHLIGHT_CLASS = 'shoji-thumb-active--highlight';

    let current: HTMLElement | null = null;
    // The Layout plugin's own `groupBy` option always fully re-renders (its
    // own doc comment: "grouped changes always fully re-render") on any
    // `autoMeasure` correction, not just on real `updateSlides()` calls — a
    // real bug, found via a real integration combining `groupBy` with most
    // items missing `width`/`height` (so most tiles get an `autoMeasure`
    // correction as their real image loads): each correction rebuilt every
    // tile via `createTile()` from scratch, discarding the exact DOM element
    // `current` above pointed at along with whatever class was on it — the
    // highlight simply vanished, often while the lightbox was still open on
    // the very slide it was supposed to be marking. Tracking the *index*
    // (not just the resolved element) is what lets `onLayoutRender` below
    // re-resolve and re-mark the freshly-rebuilt tile — `getOriginElement()`
    // finds it again via the same `data-shoji-id`, which `createTile()` sets
    // on every rebuilt tile regardless.
    let currentIndex: number | null = null;
    let scrollTimer: ReturnType<typeof setTimeout> | null = null;
    let fadeTimer: ReturnType<typeof setTimeout> | null = null;

    function cancelPendingScroll(): void {
      if (scrollTimer !== null) {
        clearTimeout(scrollTimer);
        scrollTimer = null;
      }
    }

    /** Cancels a still-pending `highlightDuration` fade — called whenever the highlight moves or is re-applied (`applyClass`), so a stale countdown from a previous close never fires against a since-changed or since-reopened element. */
    function cancelFade(): void {
      if (fadeTimer !== null) {
        clearTimeout(fadeTimer);
        fadeTimer = null;
      }
    }

    /** Resolves and marks the origin element for `index` — no scrolling, so a DOM rebuild that didn't actually change which slide is active (`onLayoutRender` below) doesn't also re-trigger a scroll nothing about real navigation caused. */
    function applyClass(index: number): HTMLElement | null {
      cancelFade();
      const el = gallery.getOriginElement(index);
      if (current && current !== el) {
        current.classList.remove(activeClass);
        if (highlight) current.classList.remove(HIGHLIGHT_CLASS);
      }
      if (el) {
        el.classList.add(activeClass);
        if (highlight) {
          el.classList.add(HIGHLIGHT_CLASS);
          // Always the real color, not whatever a previous highlightDuration
          // fade may have left it at (transparent) — covers both a genuinely
          // new active element and this same element being re-marked (e.g.
          // reopening at the same index) after having already faded once.
          el.style.setProperty('--shoji-active-thumbnail-border-color', borderColor);
        }
      }
      current = el;
      return el;
    }

    /** Scrolling is best-effort — whatever goes wrong with it must never take the highlight down with it (already applied by `applyClass`). */
    function performScroll(el: HTMLElement): void {
      try {
        // The lightbox that's navigating (and so triggering this scroll)
        // is also what's holding the page scroll lock — without this,
        // closing it unconditionally snaps the page back to wherever it
        // was on open, undoing every scroll this call ever made.
        //
        // Through gallery.markIntentionalScroll(), not a direct import of
        // bodyScrollLock's own function — a real bug, confirmed directly:
        // in the standalone core+plugins distribution (DESIGN.md §10),
        // dist/plugins/activeThumbnail.js is bundled completely separately
        // from dist/core/shoji-core.js, so a direct import here would call
        // a totally independent copy of that module's state, invisible to
        // the actual unlockBodyScroll() running inside core. Routing
        // through the Gallery instance itself — always the same instance
        // regardless of bundle mode — reaches whichever bodyScrollLock
        // module *that* build of core is really using.
        gallery.markIntentionalScroll();
        el.scrollIntoView({
          block: 'nearest',
          inline: 'nearest',
          behavior: prefersReducedMotion() ? 'auto' : 'smooth',
        });
      } catch {
        // no-op — see comment above
      }
    }

    function apply(index: number): void {
      currentIndex = index;
      cancelPendingScroll();
      const el = applyClass(index);
      if (el && scrollIntoView) {
        // Debounced, not fired on every single navigation directly: a
        // real bug, reported from real usage and confirmed via direct
        // testing — navigating faster than a single smooth scroll can
        // finish (autoplay ticking, or just clicking quickly) leaves the
        // browser with an interrupted, not-yet-settled scroll animation,
        // which can visibly resolve later, at some unrelated later point
        // (e.g. exactly when the gallery closes) rather than simply being
        // superseded. Waiting a short beat before actually scrolling — and
        // restarting that wait on every subsequent navigation — means a
        // rapid burst only ever issues one real scrollIntoView call, for
        // wherever the viewer actually lands, instead of one *per step*
        // that can never keep up and pile up interrupted animations.
        // classList.add() above is unaffected either way — the highlight
        // itself is never debounced, only the scroll. `clear()` below
        // flushes this immediately instead of waiting out the rest of the
        // 80ms if close() happens first.
        scrollTimer = setTimeout(() => {
          scrollTimer = null;
          performScroll(el);
        }, 80);
      }
    }

    // NOT cleared on close — a real complaint, reported from real usage:
    // an earlier version removed the highlight the instant the lightbox
    // closed, which defeats the entire point of a *visible* "you were just
    // looking at this one" marker — it can only ever be seen once the
    // lightbox (and its backdrop) is gone, and clearing it right then meant
    // there was never a moment a host could actually see it. The highlight
    // now stays on whichever thumbnail was last active until a *different*
    // one becomes active (the next `open()`/`afterSlide`, whenever that is,
    // possibly a whole separate visit to the gallery later) — that's what
    // "last viewed" means. Only `onClose` below (the pending-scroll flush)
    // and real teardown (`destroy()`, returned below) still run on close;
    // the highlight itself is untouched by it.
    function onClose(): void {
      // Flushed, not dropped: a navigation immediately followed by close()
      // still means "this is where I ended up" — a real complaint, reported
      // from real usage, about an earlier version of this function that
      // called cancelPendingScroll() here instead, silently discarding that
      // final navigation's scroll if close() landed inside its 80ms window
      // (routine, at normal clicking speed) rather than running it. Flushing
      // immediately (not just letting the timer run out naturally after
      // close instead) avoids the *other* failure mode this guarded against
      // originally: the page visibly scrolling on its own some tens of ms
      // after the lightbox is already gone, rather than as part of closing it.
      const pending = scrollTimer !== null ? current : null;
      cancelPendingScroll();
      if (pending && scrollIntoView) performScroll(pending);

      // highlightDuration counts from here, not from whenever the slide
      // became active — the highlight is hidden behind the backdrop until
      // now, so a countdown that started earlier (while still open) would
      // burn down time nobody could actually see it for.
      if (highlight && highlightDuration !== null && current) {
        const el = current;
        fadeTimer = setTimeout(() => {
          fadeTimer = null;
          el.style.setProperty('--shoji-active-thumbnail-border-color', 'transparent');
        }, highlightDuration);
      }
    }

    /** Real teardown, run only when the plugin itself is going away (`destroy()`) — unlike `onClose()`, this does remove the highlight, since there's no plugin left afterward to manage or move it. */
    function teardown(): void {
      cancelPendingScroll();
      cancelFade();
      current?.classList.remove(activeClass);
      if (highlight) current?.classList.remove(HIGHLIGHT_CLASS);
      current = null;
      currentIndex = null;
    }

    const offOpen = ctx.on('afterOpen', ({ index }) => apply(index));
    const offSlide = ctx.on('afterSlide', ({ to }) => apply(to));
    // 'beforeClose', not 'close' — a real bug, reported from real usage and
    // confirmed by reading Gallery.ts directly: 'close' fires from inside
    // finishClose(), which only runs *after* the close (zoom-out) animation
    // completes — but unlockBodyScroll() (also in finishClose(), earlier in
    // the same function) has *already* run and already decided whether to
    // restore the pre-open scroll position, based on whatever
    // markIntentionalScroll() state existed *before* this handler ever got
    // a chance to flush a still-pending scroll. If the last navigation's
    // debounce hadn't fired yet, that decision was wrong: it snapped back
    // to the original position, and only *then* did this handler's flush
    // fire — starting a second, ~1s smooth scroll back to the correct
    // image, well after the lightbox was already gone. 'beforeClose' fires
    // synchronously before any of that — the animation, unlockBodyScroll(),
    // all of it — so flushing here guarantees markIntentionalScroll() has
    // already been called by the time the core makes its restore decision,
    // with no wrong snap-back and no visible second scroll to correct it.
    const offClose = ctx.on('beforeClose', onClose);
    // Re-marks (never re-scrolls, see applyClass's own doc comment) after
    // any render pass that may have rebuilt the DOM out from under `current`
    // — the layout plugin's own real bug, see the comment on `currentIndex`
    // above. Keeps working while closed too now, since `currentIndex` is no
    // longer reset to `null` on close — a layout rebuild between visits
    // still re-marks the right (still-persisted) tile.
    const offLayoutRender = ctx.on('layoutRender', () => {
      if (currentIndex !== null) applyClass(currentIndex);
    });

    return () => {
      offOpen();
      offSlide();
      offClose();
      offLayoutRender();
      teardown();
    };
  },
};
