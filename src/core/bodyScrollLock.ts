/** DESIGN.md §2.6a — reference-counted page scroll lock. */
let lockCount = 0;
let savedOverflow = '';
let savedHtmlOverflow = '';
let savedHtmlPaddingRight = '';

export function lockBodyScroll(): void {
  if (lockCount === 0) {
    // A real bug: hiding overflow below reclaims the scrollbar's own
    // gutter, widening <html>'s content box by however many px the
    // scrollbar was — on a host page whose content spans the full viewport
    // width, that reflow is visible as a shift right when the lightbox
    // opens/closes (and reverses on close). Measured *before* overflow is
    // hidden (clientWidth only grows once the gutter is actually reclaimed,
    // so measuring after would always read 0) and only compensated for when
    // a real scrollbar was actually there — a page that never had one gets
    // no padding at all, nothing to compensate for.
    //
    // Two rejected approaches, both real bugs of their own: padding-right
    // on `document.body` compensates the wrong element — a page whose body
    // is narrower than the viewport (a centered, `max-width`-capped layout,
    // this docs site included) never touches the scrollbar's gutter in the
    // first place, so padding body just shrinks its own content box by an
    // *extra* scrollbar-width's worth, a new, self-inflicted reflow.
    // `scrollbar-gutter: stable` compensates the right element (`<html>`,
    // the same one the width is measured on) but paints its own visible,
    // if non-interactive, scrollbar-track styling for as long as the lock
    // is active — trading a brief shift for a permanent scrollbar-shaped
    // strip sitting over the page the whole time the lightbox is open,
    // which reads as more wrong, not less. Padding is genuinely invisible
    // — the same blank space a wider margin would be — and, applied to
    // `<html>` (not `body`), compensates the actual element the scrollbar's
    // gutter belongs to either way.
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    savedHtmlPaddingRight = document.documentElement.style.paddingRight;
    if (scrollbarWidth > 0) {
      const currentPaddingRight =
        parseFloat(getComputedStyle(document.documentElement).paddingRight) || 0;
      document.documentElement.style.paddingRight = `${currentPaddingRight + scrollbarWidth}px`;
    }

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
  }
  lockCount++;
}

export function unlockBodyScroll(): void {
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount === 0) {
    document.body.style.overflow = savedOverflow;
    document.documentElement.style.overflow = savedHtmlOverflow;
    document.documentElement.style.paddingRight = savedHtmlPaddingRight;
  }
}
