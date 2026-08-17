import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Gallery } from '../../src/core';
import type { PluginContext } from '../../src/core';

// jsdom has no real `:hover` tracking at all (`Element.prototype.matches`
// never returns true for it, regardless of any dispatched pointer event) —
// Gallery.ts's own `reconcileHover()` (DESIGN.md §2.8) reads that as ground
// truth on every activity event, so left unmocked it would immediately
// undo whatever `hover()`/`unhover()` below just did, in the same
// synchronous call. Tracked here instead and consulted only for `:hover`
// queries — every other selector still goes through the real `matches()`.
const hoveredInTest = new Set<Element>();
let realMatches: typeof Element.prototype.matches;

beforeEach(() => {
  HTMLImageElement.prototype.decode = vi.fn().mockResolvedValue(undefined);
  vi.useFakeTimers();
  realMatches = Element.prototype.matches;
  Element.prototype.matches = function (selector: string): boolean {
    if (selector === ':hover') return hoveredInTest.has(this);
    return realMatches.call(this, selector);
  };
});

afterEach(() => {
  vi.useRealTimers();
  // @ts-expect-error - removing the test-only stub added above
  delete HTMLImageElement.prototype.decode;
  Element.prototype.matches = realMatches;
  hoveredInTest.clear();
  document.body.innerHTML = '';
});

function makeGallery(options: Record<string, unknown> = {}) {
  const el = document.createElement('div');
  const items = Array.from({ length: 5 }, (_, i) => ({ id: `item-${i}`, src: `${i}.jpg` }));
  return new Gallery(el, { items, ...options });
}

function isHidden(): boolean {
  return (
    document.querySelector('.shoji-dialog')?.classList.contains('shoji-controls-hidden') ?? false
  );
}

function pointerMove(): void {
  document
    .querySelector('.shoji-outer')!
    .dispatchEvent(new Event('pointermove', { bubbles: true }));
}

function hover(selector: string): void {
  const el = document.querySelector(selector)!;
  hoveredInTest.add(el);
  el.dispatchEvent(new Event('pointerenter'));
}

function unhover(selector: string): void {
  const el = document.querySelector(selector)!;
  hoveredInTest.delete(el);
  el.dispatchEvent(new Event('pointerleave'));
}

describe('Gallery — auto-hide controls', () => {
  it('controls are visible right after open', () => {
    const gallery = makeGallery();
    gallery.open(0);

    expect(isHidden()).toBe(false);
    gallery.destroy();
  });

  it('hides after 5000ms of inactivity by default', () => {
    const gallery = makeGallery();
    gallery.open(0);

    vi.advanceTimersByTime(4999);
    expect(isHidden()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(isHidden()).toBe(true);

    gallery.destroy();
  });

  it('controlsHidden getter tracks the same state as the DOM class', () => {
    const gallery = makeGallery();
    gallery.open(0);
    expect(gallery.controlsHidden).toBe(false);

    vi.advanceTimersByTime(5000);
    expect(gallery.controlsHidden).toBe(true);
    expect(isHidden()).toBe(true);

    pointerMove();
    expect(gallery.controlsHidden).toBe(false);

    gallery.destroy();
  });

  it('activity resets the idle timer', () => {
    const gallery = makeGallery();
    gallery.open(0);

    vi.advanceTimersByTime(4000);
    pointerMove(); // resets the clock
    vi.advanceTimersByTime(4000);
    expect(isHidden()).toBe(false); // only 4000ms since the reset

    vi.advanceTimersByTime(1000);
    expect(isHidden()).toBe(true); // now 5000ms since the reset

    gallery.destroy();
  });

  it('respects a custom autoHideDelay', () => {
    const gallery = makeGallery({ autoHideDelay: 1000 });
    gallery.open(0);

    vi.advanceTimersByTime(999);
    expect(isHidden()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(isHidden()).toBe(true);

    gallery.destroy();
  });

  it('autoHideDelay:0 hides immediately and activity never reveals it', () => {
    const gallery = makeGallery({ autoHideDelay: 0 });
    gallery.open(0);

    expect(isHidden()).toBe(true);

    pointerMove();
    vi.advanceTimersByTime(10000);
    expect(isHidden()).toBe(true);

    gallery.destroy();
  });

  it("autoHideDelay:0 still marks the dialog with .shoji-cursor-visible, so the mouse cursor itself stays normal even though Shoji's own controls stay invisible — requested directly: this mode is for hosts with fully custom chrome, not a signal that the whole gallery should act like nothing is there", () => {
    const gallery = makeGallery({ autoHideDelay: 0 });
    gallery.open(0);

    expect(
      document.querySelector('.shoji-dialog')?.classList.contains('shoji-cursor-visible'),
    ).toBe(true);

    gallery.destroy();
  });

  it('a normal, positive autoHideDelay does not get the cursor-visible override — the real, deliberate idle-hide state should behave as documented (cursor hides with the controls)', () => {
    const gallery = makeGallery({ autoHideDelay: 1000 });
    gallery.open(0);

    expect(
      document.querySelector('.shoji-dialog')?.classList.contains('shoji-cursor-visible'),
    ).toBe(false);

    gallery.destroy();
  });

  it('autoHideDelay:false keeps controls visible indefinitely — the actual "always visible" value, the opposite of 0', () => {
    const gallery = makeGallery({ autoHideDelay: false });
    gallery.open(0);

    expect(isHidden()).toBe(false);

    // No idle timer was ever armed to begin with — advancing time alone
    // (no activity at all) still must not hide anything.
    vi.advanceTimersByTime(10_000_000);
    expect(isHidden()).toBe(false);

    pointerMove();
    vi.advanceTimersByTime(10_000_000);
    expect(isHidden()).toBe(false);

    gallery.destroy();
  });

  it("autoHideDelay:false makes the public hideControls() itself a no-op, not just the idle timer — a real bug, reported from real usage: a plugin (Autoplay's own tap-to-toggle-chrome behavior, since removed) called hideControls() directly and ignored autoHideDelay entirely, since only the timer checked it. 'Always visible' has to mean any caller of this public method, not just the automatic one, or a host's explicit request is silently overridable by any plugin. forceHideControls()/setControlsHiddenForDrag() (close, drag-to-close — tests/unit/gallery-zoom.test.ts, tests/unit/gallery-gestures.test.ts) are deliberately unaffected — those are direct user actions with their own feedback, not an auto-hide convenience.", () => {
    const gallery = makeGallery({ autoHideDelay: false });
    gallery.open(0);

    gallery.hideControls();

    expect(isHidden()).toBe(false);
    gallery.destroy();
  });

  it('focusing a control resets the idle clock, but does not block the eventual hide (real bug: a stale focused button — left over from an ordinary click, not active keyboard use — used to block auto-hide forever)', () => {
    const gallery = makeGallery();
    gallery.open(0);

    vi.advanceTimersByTime(4000);
    (document.querySelector('.shoji-close') as HTMLElement).focus(); // counts as activity — resets the clock

    vi.advanceTimersByTime(4999);
    expect(isHidden()).toBe(false); // only 4999ms since the focus-reset
    vi.advanceTimersByTime(1);
    expect(isHidden()).toBe(true); // now 5000ms since the reset — hides even though focus never moved away

    gallery.destroy();
  });

  it('focusing a control re-shows it if already hidden, same as any other activity', () => {
    const gallery = makeGallery();
    gallery.open(0);
    vi.advanceTimersByTime(5000);
    expect(isHidden()).toBe(true);

    (document.querySelector('.shoji-close') as HTMLElement).focus();
    expect(isHidden()).toBe(false);

    gallery.destroy();
  });

  it('emits controls:hide and controls:show', () => {
    const gallery = makeGallery();
    const hide = vi.fn();
    const show = vi.fn();
    gallery.on('controls:hide', hide);
    gallery.on('controls:show', show);

    gallery.open(0);
    vi.advanceTimersByTime(5000);
    expect(hide).toHaveBeenCalledTimes(1);

    pointerMove();
    expect(show).toHaveBeenCalledTimes(1);

    gallery.destroy();
  });

  it('resets to visible on close, so reopening starts fresh', () => {
    const gallery = makeGallery();
    gallery.open(0);
    vi.advanceTimersByTime(5000);
    expect(isHidden()).toBe(true);

    gallery.close();
    gallery.open(1);

    expect(isHidden()).toBe(false);
    gallery.destroy();
  });

  it('clears the timer on destroy (no late hide-after-destroy crash)', () => {
    const gallery = makeGallery();
    gallery.open(0);
    gallery.destroy();

    expect(() => vi.advanceTimersByTime(10000)).not.toThrow();
  });
});

describe('Gallery — hover pauses auto-hide (controls, caption, plugin overlays — not the counter)', () => {
  it('hovering the close button prevents hiding past the delay', () => {
    const gallery = makeGallery();
    gallery.open(0);
    hover('.shoji-close');

    vi.advanceTimersByTime(10000);

    expect(isHidden()).toBe(false);
    gallery.destroy();
  });

  it('hovering a nav button prevents hiding past the delay', () => {
    const gallery = makeGallery();
    gallery.open(0);
    hover('.shoji-nav-next');

    vi.advanceTimersByTime(10000);

    expect(isHidden()).toBe(false);
    gallery.destroy();
  });

  it('leaving the button resumes the countdown from a full delay', () => {
    const gallery = makeGallery();
    gallery.open(0);
    hover('.shoji-close');

    vi.advanceTimersByTime(10000); // would have hidden long ago if not hovered
    unhover('.shoji-close');

    vi.advanceTimersByTime(4999);
    expect(isHidden()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(isHidden()).toBe(true);

    gallery.destroy();
  });

  it('hovering the counter prevents hiding past the delay', () => {
    const gallery = makeGallery();
    gallery.open(0);
    hover('.shoji-counter');

    vi.advanceTimersByTime(10000);

    expect(isHidden()).toBe(false);
    gallery.destroy();
  });

  it('hovering the toolbar bar itself (not directly on a button — its own padding/gaps) prevents hiding past the delay', () => {
    const gallery = makeGallery();
    gallery.open(0);
    hover('.shoji-toolbar-right');

    vi.advanceTimersByTime(10000);

    expect(isHidden()).toBe(false);
    gallery.destroy();
  });

  it("hovering the caption prevents hiding past the delay — a viewer reading a long one, or clicking a link inside a rich one, shouldn't have it vanish mid-read", () => {
    const el = document.createElement('div');
    const gallery = new Gallery(el, { items: [{ id: 'a', src: 'a.jpg', caption: 'A caption' }] });
    gallery.open(0);
    hover('.shoji-caption');

    vi.advanceTimersByTime(10000);

    expect(isHidden()).toBe(false);
    gallery.destroy();
  });

  it('hovering a plugin-added overlay element (ctx.ui.overlay()) prevents hiding past the delay', () => {
    const overlayEl = document.createElement('div');
    overlayEl.className = 'my-plugin-overlay';
    const plugin = {
      name: 'test-overlay',
      init: (ctx: PluginContext) => ctx.ui.overlay(overlayEl),
    };
    const gallery = makeGallery({ plugins: [plugin] });
    gallery.open(0);
    hover('.my-plugin-overlay');

    vi.advanceTimersByTime(10000);

    expect(isHidden()).toBe(false);
    gallery.destroy();
  });

  it('removing a hovered plugin overlay does not leave auto-hide permanently stuck (paused)', () => {
    const overlayEl = document.createElement('div');
    overlayEl.className = 'my-plugin-overlay';
    let removeOverlay: () => void = () => {};
    const plugin = {
      name: 'test-overlay',
      init: (ctx: PluginContext) => {
        removeOverlay = ctx.ui.overlay(overlayEl);
        return () => {};
      },
    };
    const gallery = makeGallery({ plugins: [plugin] });
    gallery.open(0);
    hover('.my-plugin-overlay');
    removeOverlay(); // gone mid-hover — no matching pointerleave will ever fire

    vi.advanceTimersByTime(10000);

    expect(isHidden()).toBe(true); // corrected, not stuck paused forever
    gallery.destroy();
  });
});
