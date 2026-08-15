/** DESIGN.md §2.6a — reference-counted page scroll lock. */
let lockCount = 0;
let savedOverflow = '';
let savedHtmlOverflow = '';
let savedHtmlScrollbarGutter = '';

export function lockBodyScroll(): void {
  if (lockCount === 0) {
    savedOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // <html>'s own overflow, not just body's — mobile viewport-widening
    // bug, see DESIGN.md §2.6a. Both axes, not just overflow-x: setting
    // only one non-'visible' axis forces the browser to silently promote
    // the other from 'visible' to 'auto' (mixing hidden+visible isn't
    // allowed per spec), which revealed a real scrollbar that wasn't
    // there before.
    savedHtmlOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    // A real bug: hiding overflow above reclaims the scrollbar's own
    // gutter, widening <html>'s content box by however many px the
    // scrollbar was — on a host page whose content spans the full viewport
    // width, that reflow is visible as a shift right when the lightbox
    // opens/closes (and reverses on close). scrollbar-gutter: stable
    // reserves that same gutter as blank space regardless of whether a
    // scrollbar is actually drawn, so hiding it here never changes the
    // available width in the first place — nothing to reflow. Set only for
    // the lock's duration (not permanently in the stylesheet), so it
    // doesn't alter the host page's own layout the rest of the time.
    // Unsupported browsers (Safari) just don't get the extra protection —
    // no worse than before, and Safari's overlay scrollbars don't reflow
    // anything anyway.
    savedHtmlScrollbarGutter = document.documentElement.style.scrollbarGutter;
    document.documentElement.style.scrollbarGutter = 'stable';
  }
  lockCount++;
}

export function unlockBodyScroll(): void {
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount === 0) {
    document.body.style.overflow = savedOverflow;
    document.documentElement.style.overflow = savedHtmlOverflow;
    document.documentElement.style.scrollbarGutter = savedHtmlScrollbarGutter;
  }
}
