/** DESIGN.md §2.6a — reference-counted page scroll lock. */
let lockCount = 0;
let savedOverflow = '';
let savedHtmlOverflow = '';

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
  }
  lockCount++;
}

export function unlockBodyScroll(): void {
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount === 0) {
    document.body.style.overflow = savedOverflow;
    document.documentElement.style.overflow = savedHtmlOverflow;
  }
}
