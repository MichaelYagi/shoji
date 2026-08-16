/** DESIGN.md §2.6a — reference-counted page scroll lock. */
let lockCount = 0;
let savedHtmlOverflow = '';
let savedHtmlPaddingRight = '';
let savedHtmlPaddingLeft = '';
let savedScrollX = 0;
let savedScrollY = 0;
let styleObserver: MutationObserver | null = null;
// Set by markIntentionalScroll() (ActiveThumbnail's own scrollIntoView while
// locked, DESIGN.md §2.6a/§4.2) — a real bug/regression: unlockBodyScroll()
// unconditionally restoring savedScrollX/Y (below) was meant to undo
// *unrelated* code hijacking scroll during the lock (a router, a stray
// "scroll to top" button), but it just as unconditionally undid Shoji's own
// legitimate background-page scrolling too, making ActiveThumbnail's
// scrollIntoView a complete no-op the instant the lightbox that triggers it
// is also what's holding the lock — every navigation while open, always.
// Once anything marks an intentional scroll during this lock session, skip
// the restore entirely rather than try to track a smooth-scroll animation's
// eventual resting position (no reliable completion signal across browsers)
// — same "leave it where legitimate code put it" reasoning, just without
// pinpointing the exact pixel.
let intentionalScrollOccurred = false;

const LIGHTBOX_SELECTOR = '.shoji-outer';

/** Call after intentionally scrolling something on the host page while the lock is active (e.g. ActiveThumbnail's own `scrollIntoView`) — tells `unlockBodyScroll()` not to undo it. */
export function markIntentionalScroll(): void {
  intentionalScrollOccurred = true;
}

function isRtl(): boolean {
  return getComputedStyle(document.documentElement).direction === 'rtl';
}

/**
 * A real gap: `overflow: hidden` on `<html>` doesn't reliably block iOS
 * Safari's own touch-driven rubber-band/bounce scroll in every case — a
 * well-known limitation of this technique across the ecosystem. The common
 * workaround (flipping `body` to `position: fixed` while locked) has its
 * own real tradeoffs: a full reflow, plus manual scroll-position capture/
 * restore that's a frequent source of bugs in other libraries (the exact
 * class of bug this whole lock has already had twice — see the other real
 * bugs in this file's history). Lighter alternative: block the browser's
 * default only for a touchmove that didn't start inside a lightbox,
 * leaving Shoji's own in-dialog gesture handling (which already manages
 * its own `preventDefault`, see `GestureEngine.ts`) completely untouched.
 * Not a passive listener — `preventDefault` is genuinely required here to
 * suppress the browser's native scroll, not just observe it.
 */
function onTouchMove(event: TouchEvent): void {
  const target = event.target;
  const insideLightbox = target instanceof Element && target.closest(LIGHTBOX_SELECTOR) !== null;
  if (!insideLightbox) event.preventDefault();
}

/**
 * A real gap: this lock is reference-counted against other `Gallery`
 * instances, but has no way to know about unrelated code on the host page
 * — another modal/dropdown library that also sets
 * `document.documentElement.style.overflow`, then clears it back to `''`
 * on its own close, would silently undo this lock mid-lightbox with
 * neither library aware of the other. Watching the one attribute this
 * lock itself owns is the only way to detect and correct that reactively.
 * `takeRecords()` discards the mutation record our own corrective write
 * below just queued — otherwise the observer would fire again for a
 * change it caused itself, forever.
 */
function onStyleMutation(): void {
  if (lockCount === 0) return;
  const html = document.documentElement;
  if (getComputedStyle(html).overflow !== 'hidden') {
    html.style.overflow = 'hidden';
    styleObserver?.takeRecords();
  }
}

export function lockBodyScroll(): void {
  if (lockCount === 0) {
    // A real gap: `overflow: hidden` blocks wheel/touch/keyboard-driven
    // scrolling, but not a programmatic `window.scrollTo()`/`scrollTop`
    // write — confirmed directly. If the host's own code scrolls the
    // window while the lightbox is open (a router restoring scroll
    // position, an unrelated "scroll to top" button), the page ends up
    // somewhere different than where the viewer left it once the lock
    // releases. Restored unconditionally on unlock below — a scroll
    // *lock* implies the background stays frozen in place for the whole
    // time the lightbox is open, not just protected from direct input.
    savedScrollX = window.scrollX;
    savedScrollY = window.scrollY;
    intentionalScrollOccurred = false;

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
    const rtl = isRtl();
    savedHtmlPaddingRight = document.documentElement.style.paddingRight;
    savedHtmlPaddingLeft = document.documentElement.style.paddingLeft;
    if (scrollbarWidth > 0) {
      // A real gap: a classic scrollbar renders on the *left* on a
      // `direction: rtl` page, not the right — compensating the wrong
      // side would reintroduce the exact reflow this exists to prevent,
      // just mirrored. Checked at lock time, not baked in as a fixed
      // assumption.
      if (rtl) {
        const currentPaddingLeft =
          parseFloat(getComputedStyle(document.documentElement).paddingLeft) || 0;
        document.documentElement.style.paddingLeft = `${currentPaddingLeft + scrollbarWidth}px`;
      } else {
        const currentPaddingRight =
          parseFloat(getComputedStyle(document.documentElement).paddingRight) || 0;
        document.documentElement.style.paddingRight = `${currentPaddingRight + scrollbarWidth}px`;
      }
    }

    // A real bug: `document.body.style.overflow = 'hidden'` (this function's
    // original, and until now only, scroll-blocking mechanism) was still
    // set here alongside <html>'s own below — redundant, and not harmless:
    // any value of `overflow` other than `visible` makes an element
    // establish a new block-formatting context, which blocks top-margin
    // collapsing between it and its first child. Confirmed directly via
    // real-browser instrumentation: with body's overflow locked, an h1
    // immediately inside it rendered `bodyMarginTop + h1's own default
    // margin-top` below the viewport top (its margin no longer collapsing
    // into body's own); the instant `unlockBodyScroll()` restored body's
    // overflow, collapsing resumed and the h1 snapped back up by its own
    // margin's worth — reading as the page shifting upward right as the
    // lightbox closes, on *any* page where the first child's margin would
    // otherwise collapse with body's (essentially any page without padding/
    // border on body itself — not a corner case). <html>'s own overflow:
    // hidden below is sufficient on its own to block user-driven scrolling
    // (wheel/touch/keyboard) — confirmed directly — since it's the real
    // scrolling element in standards mode; body's lock was never adding
    // independent protection, only this side effect.
    //
    // <html>'s own overflow, not just body's — mobile viewport-widening
    // bug, see DESIGN.md §2.6a. Both axes, not just overflow-x: setting
    // only one non-'visible' axis forces the browser to silently promote
    // the other from 'visible' to 'auto' (mixing hidden+visible isn't
    // allowed per spec), which revealed a real scrollbar that wasn't
    // there before.
    savedHtmlOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';

    document.addEventListener('touchmove', onTouchMove, { passive: false });

    // Starts observing only after the writes above have already landed, so
    // it never reacts to its own initial setup — only to a later, external
    // change.
    styleObserver = new MutationObserver(onStyleMutation);
    styleObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style'],
    });
  }
  lockCount++;
}

export function unlockBodyScroll(): void {
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount === 0) {
    styleObserver?.disconnect();
    styleObserver = null;
    document.removeEventListener('touchmove', onTouchMove);

    document.documentElement.style.overflow = savedHtmlOverflow;
    document.documentElement.style.paddingRight = savedHtmlPaddingRight;
    document.documentElement.style.paddingLeft = savedHtmlPaddingLeft;

    if (!intentionalScrollOccurred) {
      window.scrollTo({ left: savedScrollX, top: savedScrollY, behavior: 'instant' });
    }
  }
}
