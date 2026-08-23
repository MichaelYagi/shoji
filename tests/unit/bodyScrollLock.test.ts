import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  lockBodyScroll,
  markIntentionalScroll,
  unlockBodyScroll,
} from '../../src/core/bodyScrollLock';

function mockScrollPosition(x: number, y: number): void {
  Object.defineProperty(window, 'scrollX', { value: x, configurable: true });
  Object.defineProperty(window, 'scrollY', { value: y, configurable: true });
}

// jsdom doesn't implement window.scrollTo at all (logs "Not implemented" and
// no-ops) — stubbed globally so every test in this file is quiet by
// default; tests that care about the call itself grab the same spy back via
// `vi.spyOn` again (vitest returns the existing spy, doesn't double-wrap).
beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});

afterEach(() => {
  document.documentElement.style.overflow = '';
  document.documentElement.style.paddingRight = '';
  document.documentElement.style.paddingLeft = '';
  document.documentElement.style.direction = '';
  mockScrollPosition(0, 0);
  vi.restoreAllMocks();
});

describe('bodyScrollLock — programmatic scroll restore', () => {
  it('restores the exact pre-lock scroll position on unlock, regardless of what scrolled while locked', () => {
    mockScrollPosition(0, 250);
    const scrollTo = vi.spyOn(window, 'scrollTo');

    lockBodyScroll();
    // Some other code on the host page scrolls while the lightbox is open
    // — a router restoring position, an unrelated "scroll to top" button.
    // overflow: hidden never blocked this in the first place.
    mockScrollPosition(0, 900);

    unlockBodyScroll();

    expect(scrollTo).toHaveBeenCalledWith({ left: 0, top: 250, behavior: 'instant' });
  });

  it('does not restore scroll for a still-nested lock (two galleries open at once)', () => {
    mockScrollPosition(0, 100);
    const scrollTo = vi.spyOn(window, 'scrollTo');

    lockBodyScroll();
    lockBodyScroll();
    unlockBodyScroll();

    expect(scrollTo).not.toHaveBeenCalled();

    unlockBodyScroll();
    expect(scrollTo).toHaveBeenCalledWith({ left: 0, top: 100, behavior: 'instant' });
  });

  it('skips the restore entirely once markIntentionalScroll() has been called — a real regression: this unconditional restore made ActiveThumbnail.scrollIntoView (also running while this exact lock is active) a complete no-op, undone the instant the lightbox closed', () => {
    mockScrollPosition(0, 250);
    const scrollTo = vi.spyOn(window, 'scrollTo');

    lockBodyScroll();
    mockScrollPosition(0, 900); // e.g. ActiveThumbnail scrolling to the active slide
    markIntentionalScroll();

    unlockBodyScroll();

    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('the intentional-scroll flag does not leak into the next lock session', () => {
    mockScrollPosition(0, 250);
    const scrollTo = vi.spyOn(window, 'scrollTo');

    lockBodyScroll();
    markIntentionalScroll();
    unlockBodyScroll();
    scrollTo.mockClear();

    mockScrollPosition(0, 250); // fresh open, fresh saved position
    lockBodyScroll();
    mockScrollPosition(0, 900); // unrelated drift only, nothing marks it intentional this time
    unlockBodyScroll();

    expect(scrollTo).toHaveBeenCalledWith({ left: 0, top: 250, behavior: 'instant' });
  });
});

describe('bodyScrollLock — RTL scrollbar-width compensation', () => {
  it('compensates padding-left, not padding-right, when the page is direction: rtl', () => {
    document.documentElement.style.direction = 'rtl';
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1920);
    vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(1905);

    lockBodyScroll();

    expect(document.documentElement.style.paddingLeft).toBe('15px');
    expect(document.documentElement.style.paddingRight).toBe('');

    unlockBodyScroll();
    expect(document.documentElement.style.paddingLeft).toBe('');
  });

  it('still compensates padding-right on an ordinary (non-rtl) page', () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1920);
    vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(1905);

    lockBodyScroll();

    expect(document.documentElement.style.paddingRight).toBe('15px');
    expect(document.documentElement.style.paddingLeft).toBe('');

    unlockBodyScroll();
  });
});

/** Fires touchstart then touchmove on `target`, same order a real gesture always has — onTouchStart is what actually computes/caches the scrollable-ancestor decision touchmove then reads. */
function fireTouchGesture(target: Element): Event {
  const start = new Event('touchstart', { bubbles: true, cancelable: true });
  Object.defineProperty(start, 'target', { value: target });
  document.dispatchEvent(start);

  const move = new Event('touchmove', { bubbles: true, cancelable: true });
  Object.defineProperty(move, 'target', { value: target });
  document.dispatchEvent(move);
  return move;
}

describe('bodyScrollLock — background touch scroll', () => {
  it('preventDefaults a touchmove that starts outside any lightbox while locked', () => {
    lockBodyScroll();

    const outside = document.createElement('div');
    document.body.appendChild(outside);
    const event = fireTouchGesture(outside);

    expect(event.defaultPrevented).toBe(true);

    unlockBodyScroll();
    outside.remove();
  });

  it("leaves a touchmove that starts inside a lightbox alone — Shoji's own gesture handling owns that", () => {
    lockBodyScroll();

    const outer = document.createElement('div');
    outer.className = 'shoji-outer';
    const inner = document.createElement('div');
    outer.appendChild(inner);
    document.body.appendChild(outer);

    const event = fireTouchGesture(inner);

    expect(event.defaultPrevented).toBe(false);

    unlockBodyScroll();
    outer.remove();
  });

  it('stops intercepting touchmove once fully unlocked', () => {
    lockBodyScroll();
    unlockBodyScroll();

    const outside = document.createElement('div');
    document.body.appendChild(outside);
    const event = new Event('touchmove', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'target', { value: outside });
    document.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    outside.remove();
  });
});

/**
 * DESIGN.md §2.6a — a real bug, reported from real usage: this lock used to
 * block touch-scrolling in *any* host-app UI outside `.shoji-outer`, not
 * just the page body behind it — a Bootstrap modal or sidebar opened on
 * top of the lightbox, with its own genuinely scrollable content, couldn't
 * be scrolled on Android. `onTouchStart` now walks up from the touch's own
 * target looking for a real scrollable ancestor (a real bug's worth of
 * nuance below — `overflow-y: auto`/`scroll` alone isn't enough, it also
 * has to actually overflow) and caches that decision for `onTouchMove` to
 * read, rather than blocking unconditionally.
 *
 * jsdom has no real layout engine — `scrollHeight`/`clientHeight` both
 * default to `0` for every element, so "has overflow" needs mocking
 * per-element (via a marker class checked in the mocked getter), same
 * reasoning `gallery-lightbox.test.ts`'s own `mockTruncated()` documents
 * for a different geometry-dependent feature.
 */
describe('bodyScrollLock — scrollable ancestor outside the lightbox (e.g. a host-app modal)', () => {
  const SCROLLABLE_CLASS = 'e2e-mock-scrollable';

  function mockScrollableElements(): void {
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.classList.contains(SCROLLABLE_CLASS) ? 400 : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.classList.contains(SCROLLABLE_CLASS) ? 200 : 0;
    });
  }

  it('does not preventDefault a touchmove starting inside a scrollable ancestor outside the lightbox', () => {
    mockScrollableElements();
    const modal = document.createElement('div');
    modal.className = SCROLLABLE_CLASS;
    modal.style.overflowY = 'auto';
    const content = document.createElement('p');
    modal.appendChild(content);
    document.body.appendChild(modal);

    lockBodyScroll();
    const event = fireTouchGesture(content); // touch starts on a descendant, not the scrollable element itself

    expect(event.defaultPrevented).toBe(false);

    unlockBodyScroll();
    modal.remove();
  });

  it('still preventDefaults when overflow-y is auto/scroll but the element has nothing to actually scroll (scrollHeight <= clientHeight)', () => {
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(100);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(100);
    const el = document.createElement('div');
    el.style.overflowY = 'auto';
    document.body.appendChild(el);

    lockBodyScroll();
    const event = fireTouchGesture(el);

    expect(event.defaultPrevented).toBe(true);

    unlockBodyScroll();
    el.remove();
  });

  it('still preventDefaults when content genuinely overflows but overflow-y is not auto/scroll (e.g. the default visible, or hidden)', () => {
    mockScrollableElements();
    const el = document.createElement('div');
    el.className = SCROLLABLE_CLASS; // genuinely overflows per the mock above
    // overflow-y left at its default ('visible') — not a real touch-scroll container regardless of content size
    document.body.appendChild(el);

    lockBodyScroll();
    const event = fireTouchGesture(el);

    expect(event.defaultPrevented).toBe(true);

    unlockBodyScroll();
    el.remove();
  });

  it('does not treat document.documentElement itself as a qualifying scrollable ancestor — that is exactly the background scroll this lock exists to block', () => {
    // No scrollable ancestor anywhere between the touch target and <html> —
    // the walk must stop at documentElement without matching it, same as
    // the plain "preventDefaults a touchmove outside any lightbox" test
    // above, just asserting the boundary explicitly.
    const el = document.createElement('div');
    document.body.appendChild(el);

    lockBodyScroll();
    const event = fireTouchGesture(el);

    expect(event.defaultPrevented).toBe(true);

    unlockBodyScroll();
    el.remove();
  });

  it('caches the decision from touchstart — a later touchmove is not re-evaluated against a different apparent target', () => {
    // Real browsers guarantee event.target stays fixed to the original
    // touchstart target for a given touch throughout the gesture — this
    // proves the fix actually relies on that cached decision (the
    // performance reason it's computed once, not per-move) rather than
    // happening to work only because the targets always matched in the
    // tests above.
    mockScrollableElements();
    const modal = document.createElement('div');
    modal.className = SCROLLABLE_CLASS;
    modal.style.overflowY = 'auto';
    document.body.appendChild(modal);
    const plain = document.createElement('div');
    document.body.appendChild(plain);

    lockBodyScroll();

    const start = new Event('touchstart', { bubbles: true, cancelable: true });
    Object.defineProperty(start, 'target', { value: modal });
    document.dispatchEvent(start);

    const move = new Event('touchmove', { bubbles: true, cancelable: true });
    Object.defineProperty(move, 'target', { value: plain }); // artificially different from the touchstart target
    document.dispatchEvent(move);

    expect(move.defaultPrevented).toBe(false); // still reflects touchstart's own decision, not a fresh check against `plain`

    unlockBodyScroll();
    modal.remove();
    plain.remove();
  });
});

describe('bodyScrollLock — defends against unrelated code clearing the style', () => {
  it('re-asserts overflow: hidden if something else on the page clears it while locked', async () => {
    lockBodyScroll();
    expect(document.documentElement.style.overflow).toBe('hidden');

    // Simulates an unrelated library also touching this same property and
    // clearing it on its own close, unaware Shoji's lock is still active.
    document.documentElement.style.overflow = '';

    // MutationObserver callbacks are microtask-queued, not synchronous.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(document.documentElement.style.overflow).toBe('hidden');

    unlockBodyScroll();
  });

  it('does not keep re-asserting after a real unlock', async () => {
    lockBodyScroll();
    unlockBodyScroll();
    expect(document.documentElement.style.overflow).toBe('');

    document.documentElement.style.overflow = 'scroll'; // some other code's own choice
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(document.documentElement.style.overflow).toBe('scroll'); // left alone
    document.documentElement.style.overflow = '';
  });
});
