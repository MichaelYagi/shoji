import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Gallery } from '../../src/core';
import type { GalleryItem } from '../../src/core/types';

const DEFAULT_RECT: DOMRect = {
  top: 0,
  left: 0,
  right: 300,
  bottom: 300,
  width: 300,
  height: 300,
  x: 0,
  y: 0,
  toJSON: () => ({}),
};

/** Query-aware: only `(pointer: coarse)` reports true when `coarse` is set — a blunt "matches everything" stub would also flip `prefers-reduced-motion` to true and silently skip every transition. */
function mockMatchMedia(coarse: boolean): void {
  window.matchMedia = vi.fn((query: string) => ({
    matches: query.includes('pointer: coarse') && coarse,
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  HTMLImageElement.prototype.decode = vi.fn().mockResolvedValue(undefined);
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(DEFAULT_RECT);
  vi.spyOn(window, 'getComputedStyle').mockReturnValue({
    transitionDuration: '300ms',
    animationDuration: '0s',
  } as CSSStyleDeclaration);
  // window.matchMedia is a plain assignment (jsdom has no real implementation
  // to vi.spyOn), so afterEach's restoreAllMocks() can't restore it — it
  // resets to a no-op instead, leaking `undefined` into whichever test runs
  // next unless every test starts from a known-good default here.
  mockMatchMedia(false);
});

afterEach(() => {
  vi.restoreAllMocks();
  // @ts-expect-error - removing the test-only stub added above
  delete HTMLImageElement.prototype.decode;
  document.body.innerHTML = '';
});

function items(n: number): GalleryItem[] {
  return Array.from({ length: n }, (_, i) => ({ id: String(i), src: `${i}.jpg` }));
}

function ghost(): HTMLElement | null {
  return document.querySelector('.shoji-slide-ghost');
}

function fireTransitionEnd(el: Element): void {
  const event = new Event('transitionend') as Event & { propertyName?: string };
  Object.defineProperty(event, 'propertyName', { value: 'transform' });
  el.dispatchEvent(event);
}

function settleAnyGhost(): void {
  const g = ghost();
  if (g) fireTransitionEnd(g);
  const media = document.querySelector('.shoji-slide-media') as HTMLElement | null;
  if (media) fireTransitionEnd(media);
}

describe('Gallery — transition system (DESIGN.md §2.5)', () => {
  it('next()/prev() animate via a ghost by default (mode: slide)', () => {
    const gallery = new Gallery(document.body, { items: items(3), preload: 0 });
    gallery.open(0);

    gallery.next();

    expect(ghost()).not.toBeNull();
    expect(gallery.currentIndex).toBe(1); // index updates synchronously; only the visual is async

    settleAnyGhost();
    gallery.destroy();
  });

  it('goTo({ animate: false }) jumps instantly with no ghost', () => {
    const gallery = new Gallery(document.body, { items: items(3), preload: 0 });
    gallery.open(0);

    gallery.goTo(2, { animate: false });

    expect(gallery.currentIndex).toBe(2);
    expect(ghost()).toBeNull();
    gallery.destroy();
  });

  it('respects a custom mode option (e.g. "fade")', () => {
    const gallery = new Gallery(document.body, { items: items(3), preload: 0, mode: 'fade' });
    gallery.open(0);

    gallery.next();
    const g = ghost();
    expect(g).not.toBeNull();
    expect(g!.style.opacity).toBe('0'); // fade's leave keyframe

    settleAnyGhost();
    gallery.destroy();
  });

  it('treats an unrecognized mode string as a custom CSS class pair', () => {
    const gallery = new Gallery(document.body, {
      items: items(3),
      preload: 0,
      mode: 'my-custom-flip',
    });
    gallery.open(0);

    gallery.next();
    const g = ghost();
    expect(g!.classList.contains('shoji-transition-my-custom-flip-leave')).toBe(true);

    settleAnyGhost();
    gallery.destroy();
  });

  it('mobileSettings.mode overrides mode under a coarse-pointer device', () => {
    mockMatchMedia(true);
    const gallery = new Gallery(document.body, {
      items: items(3),
      preload: 0,
      mode: 'slide',
      mobileSettings: { mode: 'fade' },
    });
    gallery.open(0);

    gallery.next();
    expect(ghost()!.style.opacity).toBe('0'); // fade, not slide's opacity:1

    settleAnyGhost();
    gallery.destroy();
  });

  it('mobileSettings.mode has no effect on a fine-pointer (desktop) device', () => {
    mockMatchMedia(false);
    const gallery = new Gallery(document.body, {
      items: items(3),
      preload: 0,
      mode: 'slide',
      mobileSettings: { mode: 'fade' },
    });
    gallery.open(0);

    gallery.next();
    expect(ghost()!.style.opacity).toBe('1'); // still slide, not overridden

    settleAnyGhost();
    gallery.destroy();
  });

  it('mobileSettings.controls: false starts controls hidden on a coarse-pointer device via the existing auto-hide mechanism', () => {
    mockMatchMedia(true);
    const gallery = new Gallery(document.body, {
      items: items(2),
      preload: 0,
      mobileSettings: { controls: false },
    });
    gallery.open(0);

    const dialog = document.querySelector('.shoji-dialog') as HTMLElement;
    expect(dialog.classList.contains('shoji-controls-hidden')).toBe(true);
    gallery.destroy();
  });

  it('mobileSettings.controls: false is overridden by autoHideDelay: false — the stronger, more explicit "never automatically hide controls" statement wins over the narrower mobile-only start-hidden convenience', () => {
    mockMatchMedia(true);
    const gallery = new Gallery(document.body, {
      items: items(2),
      preload: 0,
      autoHideDelay: false,
      mobileSettings: { controls: false },
    });
    gallery.open(0);

    const dialog = document.querySelector('.shoji-dialog') as HTMLElement;
    expect(dialog.classList.contains('shoji-controls-hidden')).toBe(false);
    gallery.destroy();
  });

  it('mobileSettings.controls: false has no effect on a fine-pointer device', () => {
    mockMatchMedia(false);
    const gallery = new Gallery(document.body, {
      items: items(2),
      preload: 0,
      mobileSettings: { controls: false },
    });
    gallery.open(0);

    const dialog = document.querySelector('.shoji-dialog') as HTMLElement;
    expect(dialog.classList.contains('shoji-controls-hidden')).toBe(false);
    gallery.destroy();
  });

  it('a gesture-completed swipe does not also run the mode-based transition (no double-animate)', () => {
    const gallery = new Gallery(document.body, { items: items(3), preload: 0, mode: 'fade' });
    gallery.open(0);

    const dialog = document.querySelector('.shoji-dialog') as HTMLElement;
    function firePointer(type: string, x: number, timeStamp: number): void {
      const event = new PointerEvent(type, {
        clientX: x,
        clientY: 0,
        pointerId: 1,
        isPrimary: true,
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(event, 'timeStamp', { value: timeStamp, configurable: true });
      dialog.dispatchEvent(event);
    }

    firePointer('pointerdown', 0, 0);
    firePointer('pointermove', -20, 10);
    firePointer('pointermove', -200, 20);
    firePointer('pointerup', -200, 30);

    // The gesture's own settle animation is on the pooled `.shoji-slide`
    // roots, not a ghost — the §2.5 transition system must not also fire.
    expect(ghost()).toBeNull();

    gallery.destroy();
  });
});
