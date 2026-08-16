import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lockBodyScroll, unlockBodyScroll } from '../../src/core/bodyScrollLock';

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

describe('bodyScrollLock — background touch scroll', () => {
  it('preventDefaults a touchmove that starts outside any lightbox while locked', () => {
    lockBodyScroll();

    const outside = document.createElement('div');
    document.body.appendChild(outside);
    const event = new Event('touchmove', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'target', { value: outside });
    document.dispatchEvent(event);

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

    const event = new Event('touchmove', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'target', { value: inner });
    document.dispatchEvent(event);

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
