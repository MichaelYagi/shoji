import type { PluginContext, ShojiPlugin } from '../../core/plugin';
import { markIntentionalScroll } from '../../core/bodyScrollLock';

export interface ActiveThumbnailOptions {
  /** CSS class applied to the origin thumbnail for whichever slide is currently active. Default `'shoji-thumb-active'` — Shoji ships no default styling for it (the host's own thumbnail markup, or the layout plugin's tiles, define what "active" looks like), only the class toggling. */
  activeClass?: string;
  /** Scrolls the active thumbnail into view (`block: 'nearest'`) whenever it changes. Default `true`. */
  scrollIntoView?: boolean;
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
  } satisfies ActiveThumbnailOptions,

  init(ctx: PluginContext): () => void {
    const { gallery } = ctx;
    const activeClass = String(ctx.options.activeClass ?? 'shoji-thumb-active');
    const scrollIntoView = ctx.options.scrollIntoView !== false;

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

    function cancelPendingScroll(): void {
      if (scrollTimer !== null) {
        clearTimeout(scrollTimer);
        scrollTimer = null;
      }
    }

    /** Resolves and marks the origin element for `index` — no scrolling, so a DOM rebuild that didn't actually change which slide is active (`onLayoutRender` below) doesn't also re-trigger a scroll nothing about real navigation caused. */
    function applyClass(index: number): HTMLElement | null {
      const el = gallery.getOriginElement(index);
      if (current && current !== el) current.classList.remove(activeClass);
      if (el) el.classList.add(activeClass);
      current = el;
      return el;
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
        // itself is never debounced, only the scroll.
        scrollTimer = setTimeout(() => {
          scrollTimer = null;
          // Scrolling is best-effort — whatever goes wrong with it must
          // never take the highlight down with it (already applied above).
          try {
            // The lightbox that's navigating (and so triggering this scroll)
            // is also what's holding the page scroll lock — without this,
            // closing it unconditionally snaps the page back to wherever it
            // was on open, undoing every scroll this call ever made.
            markIntentionalScroll();
            el.scrollIntoView({
              block: 'nearest',
              inline: 'nearest',
              behavior: prefersReducedMotion() ? 'auto' : 'smooth',
            });
          } catch {
            // no-op — see comment above
          }
        }, 80);
      }
    }

    // Cleared on close (not left highlighting a thumbnail the viewer isn't
    // looking at anymore) — reopening re-applies it from whatever index
    // open() lands on, via the 'afterOpen' listener below. Also cancels any
    // still-pending debounced scroll — nothing left to usefully scroll
    // toward once the highlight itself is about to be cleared, and this is
    // exactly what stops a debounced-but-not-yet-fired scroll from
    // surfacing later as an unexplained shift after the gallery is closed.
    function clear(): void {
      cancelPendingScroll();
      current?.classList.remove(activeClass);
      current = null;
      currentIndex = null;
    }

    const offOpen = ctx.on('afterOpen', ({ index }) => apply(index));
    const offSlide = ctx.on('afterSlide', ({ to }) => apply(to));
    const offClose = ctx.on('close', clear);
    // Re-marks (never re-scrolls, see applyClass's own doc comment) after
    // any render pass that may have rebuilt the DOM out from under `current`
    // — the layout plugin's own real bug, see the comment on `currentIndex`
    // above. A no-op while closed (`currentIndex` is `null` then, per `clear()`).
    const offLayoutRender = ctx.on('layoutRender', () => {
      if (currentIndex !== null) applyClass(currentIndex);
    });

    return () => {
      offOpen();
      offSlide();
      offClose();
      offLayoutRender();
      clear();
    };
  },
};
