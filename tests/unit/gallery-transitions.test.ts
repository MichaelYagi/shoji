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

/** Never matches anything — a blunt "matches everything" stub would flip `prefers-reduced-motion` to true and silently skip every transition. */
function mockMatchMedia(): void {
  window.matchMedia = vi.fn(() => ({
    matches: false,
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
  mockMatchMedia();
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

describe('Gallery — caption fade alongside the mode transition (DESIGN.md §2.5)', () => {
  function itemsWithCaptions(n: number): GalleryItem[] {
    return Array.from({ length: n }, (_, i) => ({
      id: String(i),
      src: `${i}.jpg`,
      caption: `Caption ${i}`,
    }));
  }

  function caption(): HTMLElement {
    return document.querySelector('.shoji-caption') as HTMLElement;
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fades the caption out over the first half of --shoji-duration, keeping the outgoing text until the midpoint', () => {
    const gallery = new Gallery(document.body, { items: itemsWithCaptions(3), preload: 0 });
    gallery.open(0);

    gallery.next();

    expect(caption().style.opacity).toBe('0');
    expect(caption().style.transitionDuration).toBe('150ms'); // half of the mocked 300ms
    expect(caption().textContent).toBe('Caption 0'); // still outgoing, not yet swapped

    settleAnyGhost();
    gallery.destroy();
  });

  it('swaps content and starts fading back in at the midpoint, not before', () => {
    const gallery = new Gallery(document.body, { items: itemsWithCaptions(3), preload: 0 });
    gallery.open(0);

    gallery.next();
    vi.advanceTimersByTime(150);

    expect(caption().textContent).toBe('Caption 1');
    expect(caption().style.opacity).toBe('');
    // Still the half-duration override — only cleared once the fade-in
    // itself finishes, below.
    expect(caption().style.transitionDuration).toBe('150ms');

    settleAnyGhost();
    gallery.destroy();
  });

  it('clears the half-duration override once the fade-in finishes — a full --shoji-duration after next()', () => {
    const gallery = new Gallery(document.body, { items: itemsWithCaptions(3), preload: 0 });
    gallery.open(0);

    gallery.next();
    vi.advanceTimersByTime(300);

    expect(caption().style.transitionDuration).toBe('');
    expect(caption().style.opacity).toBe('');

    settleAnyGhost();
    gallery.destroy();
  });

  it("an async image decode() resolving before the midpoint doesn't jump the caption ahead of the fade", async () => {
    const gallery = new Gallery(document.body, { items: itemsWithCaptions(3), preload: 0 });
    gallery.open(0);

    gallery.next();
    await Promise.resolve();
    await Promise.resolve();

    expect(caption().textContent).toBe('Caption 0'); // captionFadePending held it back

    vi.advanceTimersByTime(150);
    expect(caption().textContent).toBe('Caption 1');

    settleAnyGhost();
    gallery.destroy();
  });

  it('goTo({ animate: false }) swaps the caption instantly, no fade', () => {
    const gallery = new Gallery(document.body, { items: itemsWithCaptions(3), preload: 0 });
    gallery.open(0);

    gallery.goTo(2, { animate: false });

    expect(caption().textContent).toBe('Caption 2');
    expect(caption().style.opacity).toBe('');
    gallery.destroy();
  });

  it('respects prefers-reduced-motion — no fade, caption swaps instantly', () => {
    window.matchMedia = vi.fn(() => ({ matches: true })) as unknown as typeof window.matchMedia;
    const gallery = new Gallery(document.body, { items: itemsWithCaptions(3), preload: 0 });
    gallery.open(0);

    gallery.next();

    expect(caption().textContent).toBe('Caption 1');
    expect(caption().style.opacity).toBe('');
    gallery.destroy();
  });
});

describe('Gallery — caption fade-in on the very first open() (DESIGN.md §2.5)', () => {
  function caption(): HTMLElement {
    return document.querySelector('.shoji-caption') as HTMLElement;
  }

  it('fades the caption in alongside zoomIn() when origin + known dimensions are both present', () => {
    const mount = document.createElement('div');
    const marker = document.createElement('div');
    marker.setAttribute('data-shoji-id', 'x');
    document.body.append(mount, marker);

    const gallery = new Gallery(mount, {
      items: [{ id: 'x', src: 'x.jpg', width: 800, height: 600, caption: 'Hello' }],
      preload: 0,
    });
    gallery.open(0);

    // The fade-in itself plays out via the CSS engine after open() returns
    // (same as every other class/opacity-toggle-driven fade in this
    // codebase) — what's directly observable synchronously is that it ends
    // up correctly revealed: real content, no inline opacity/duration
    // override left stuck mid-fade. No half-duration split here, unlike
    // next() — there's no outgoing caption to fade out first.
    expect(caption().textContent).toBe('Hello');
    expect(caption().style.opacity).toBe('');
    expect(caption().style.transitionDuration).toBe('');

    marker.remove();
    gallery.destroy();
  });

  it('does not fade when there is no known naturalSize — same "no disconnected animation" rule zoomIn() itself follows', () => {
    const mount = document.createElement('div');
    const marker = document.createElement('div');
    marker.setAttribute('data-shoji-id', 'x');
    document.body.append(mount, marker);

    const gallery = new Gallery(mount, {
      items: [{ id: 'x', src: 'x.jpg', caption: 'Hello' }], // no width/height
      preload: 0,
    });
    gallery.open(0);

    expect(caption().textContent).toBe('Hello');
    expect(caption().style.opacity).toBe('');

    marker.remove();
    gallery.destroy();
  });
});
