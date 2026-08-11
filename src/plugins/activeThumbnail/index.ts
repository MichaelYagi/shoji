import type { PluginContext, ShojiPlugin } from '../../core/plugin';

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

    function apply(index: number): void {
      const el = gallery.getOriginElement(index);
      if (current && current !== el) current.classList.remove(activeClass);
      if (el) {
        el.classList.add(activeClass);
        if (scrollIntoView) {
          // Scrolling is best-effort — whatever goes wrong with it must
          // never take the highlight down with it. classList.add() above
          // already ran and is unaffected either way; this only guards
          // against scrollIntoView itself throwing.
          try {
            el.scrollIntoView({
              block: 'nearest',
              inline: 'nearest',
              behavior: prefersReducedMotion() ? 'auto' : 'smooth',
            });
          } catch {
            // no-op — see comment above
          }
        }
      }
      current = el;
    }

    // Cleared on close (not left highlighting a thumbnail the viewer isn't
    // looking at anymore) — reopening re-applies it from whatever index
    // open() lands on, via the 'afterOpen' listener below.
    function clear(): void {
      current?.classList.remove(activeClass);
      current = null;
    }

    const offOpen = ctx.on('afterOpen', ({ index }) => apply(index));
    const offSlide = ctx.on('afterSlide', ({ to }) => apply(to));
    const offClose = ctx.on('close', clear);

    return () => {
      offOpen();
      offSlide();
      offClose();
      clear();
    };
  },
};
