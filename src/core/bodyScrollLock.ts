/** DESIGN.md §2.6a — reference-counted page scroll lock. */
let lockCount = 0;
let savedOverflow = '';
let savedOverflowX = '';

export function lockBodyScroll(): void {
  if (lockCount === 0) {
    savedOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // <html>'s own overflow-x, not just body's — mobile viewport-widening
    // bug, see DESIGN.md §2.6a.
    savedOverflowX = document.documentElement.style.overflowX;
    document.documentElement.style.overflowX = 'hidden';
  }
  lockCount++;
}

export function unlockBodyScroll(): void {
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount === 0) {
    document.body.style.overflow = savedOverflow;
    document.documentElement.style.overflowX = savedOverflowX;
  }
}
