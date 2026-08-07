import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Gallery } from '../../src/core';

beforeEach(() => {
  HTMLImageElement.prototype.decode = vi.fn().mockResolvedValue(undefined);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  // @ts-expect-error - removing the test-only stub added above
  delete HTMLImageElement.prototype.decode;
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
  document.querySelector(selector)!.dispatchEvent(new Event('pointerenter'));
}

function unhover(selector: string): void {
  document.querySelector(selector)!.dispatchEvent(new Event('pointerleave'));
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

describe('Gallery — hover pauses auto-hide (buttons only, not counter/caption)', () => {
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

  it('does NOT pause auto-hide when hovering the counter', () => {
    const gallery = makeGallery();
    gallery.open(0);
    hover('.shoji-counter');

    vi.advanceTimersByTime(5000);

    expect(isHidden()).toBe(true);
    gallery.destroy();
  });

  it('does NOT pause auto-hide when hovering the caption', () => {
    const el = document.createElement('div');
    const gallery = new Gallery(el, { items: [{ id: 'a', src: 'a.jpg', caption: 'A caption' }] });
    gallery.open(0);
    hover('.shoji-caption');

    vi.advanceTimersByTime(5000);

    expect(isHidden()).toBe(true);
    gallery.destroy();
  });
});
