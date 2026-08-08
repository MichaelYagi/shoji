import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SlideManager } from '../../../src/core/SlideManager';
import { SlideTransition } from '../../../src/transitions/SlideTransition';
import { TRANSITION_PRESETS } from '../../../src/transitions/presets';
import type { GalleryItem } from '../../../src/core/types';

const items: GalleryItem[] = [
  { id: 'a', src: 'a.jpg' },
  { id: 'b', src: 'b.jpg' },
  { id: 'c', src: 'c.jpg' },
];

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function fireTransitionEnd(el: Element): void {
  const event = new Event('transitionend') as Event & { propertyName?: string };
  Object.defineProperty(event, 'propertyName', { value: 'transform' });
  el.dispatchEvent(event);
}

beforeEach(() => {
  HTMLImageElement.prototype.decode = vi.fn().mockResolvedValue(undefined);
  window.matchMedia = vi
    .fn()
    .mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia;
  vi.spyOn(window, 'getComputedStyle').mockReturnValue({
    transitionDuration: '300ms',
    animationDuration: '0s',
  } as CSSStyleDeclaration);
});

afterEach(() => {
  vi.restoreAllMocks();
  // @ts-expect-error - removing the test-only stub added above
  delete HTMLImageElement.prototype.decode;
});

async function makeManager(): Promise<SlideManager> {
  const manager = new SlideManager({
    preload: 0,
    playVideoLabel: 'Play video',
    videoProviders: new Map(),
  });
  document.body.appendChild(manager.element);
  manager.render(items, 0, () => {});
  await flush();
  return manager;
}

describe('SlideTransition.animate — built-in preset', () => {
  it('clones the outgoing media into a ghost, swaps content underneath it, then animates both', async () => {
    const manager = await makeManager();
    const transition = new SlideTransition(manager);
    const swapContent = vi.fn(() => {
      manager.render(items, 1, () => {});
    });

    transition.animate(TRANSITION_PRESETS.slide!, 1, swapContent);

    const ghost = manager.element.querySelector('.shoji-slide-ghost');
    expect(ghost).not.toBeNull();
    // The ghost is a snapshot of the *outgoing* (index 0) content, cloned
    // before swapContent ran — proven by it still containing an <img>
    // (SlideManager doesn't tear down cloned nodes when it reassigns the
    // real slot's content).
    expect(ghost!.querySelector('img')).not.toBeNull();

    expect(swapContent).toHaveBeenCalledTimes(1);

    const incoming = manager.getActiveMedia()!;
    expect(incoming.style.transform).not.toBe('');
    expect((ghost as HTMLElement).style.transform).not.toBe('');
  });

  it('removes the ghost and clears the incoming element inline styles once both transitions end', async () => {
    const manager = await makeManager();
    const transition = new SlideTransition(manager);
    transition.animate(TRANSITION_PRESETS.fade!, 1, () => manager.render(items, 1, () => {}));

    const ghost = manager.element.querySelector('.shoji-slide-ghost') as HTMLElement;
    const incoming = manager.getActiveMedia()!;

    fireTransitionEnd(ghost);
    fireTransitionEnd(incoming);

    expect(manager.element.querySelector('.shoji-slide-ghost')).toBeNull();
    expect(incoming.style.transform).toBe('');
    expect(incoming.style.opacity).toBe('');
  });

  it('applies mirror-image transforms for direction 1 vs -1 (slide preset)', async () => {
    const manager = await makeManager();
    const transition = new SlideTransition(manager);

    transition.animate(TRANSITION_PRESETS.slide!, 1, () => manager.render(items, 1, () => {}));
    const incomingNext = manager.getActiveMedia()!;
    expect(incomingNext.style.transform).toBe('none'); // enter animates *to* natural — see applyEnter's asymmetry

    const ghostNext = manager.element.querySelector('.shoji-slide-ghost') as HTMLElement;
    fireTransitionEnd(ghostNext);
    fireTransitionEnd(incomingNext);

    transition.animate(TRANSITION_PRESETS.slide!, -1, () => manager.render(items, 0, () => {}));
    const ghostPrev = manager.element.querySelector('.shoji-slide-ghost') as HTMLElement;
    // leave(-1) for `slide` should be the mirror of leave(1) — opposite exit side.
    expect(ghostPrev.style.transform).toContain('100%, 0%');
  });

  it('skips the ghost entirely under prefers-reduced-motion, still swapping content', async () => {
    window.matchMedia = vi
      .fn()
      .mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia;
    const manager = await makeManager();
    const transition = new SlideTransition(manager);
    const swapContent = vi.fn();

    transition.animate(TRANSITION_PRESETS.slide!, 1, swapContent);

    expect(swapContent).toHaveBeenCalledTimes(1);
    expect(manager.element.querySelector('.shoji-slide-ghost')).toBeNull();
  });

  it('falls back to a timeout if transitionend never fires', async () => {
    vi.useFakeTimers();
    const manager = await makeManager();
    const transition = new SlideTransition(manager);
    transition.animate(TRANSITION_PRESETS.fade!, 1, () => manager.render(items, 1, () => {}));

    expect(manager.element.querySelector('.shoji-slide-ghost')).not.toBeNull();
    await vi.advanceTimersByTimeAsync(500); // 300ms transitionDuration + 100ms safety net
    expect(manager.element.querySelector('.shoji-slide-ghost')).toBeNull();
    vi.useRealTimers();
  });
});

describe('SlideTransition.animateCustom — host-supplied CSS class pair', () => {
  it('applies shoji-transition-<mode>-leave/-enter classes instead of computing a transform', async () => {
    const manager = await makeManager();
    const transition = new SlideTransition(manager);

    transition.animateCustom('my-flip', 1, () => manager.render(items, 1, () => {}));

    const ghost = manager.element.querySelector('.shoji-slide-ghost') as HTMLElement;
    expect(ghost.classList.contains('shoji-transition-my-flip-leave')).toBe(true);
    expect(ghost.dataset.shojiDirection).toBe('next');

    const incoming = manager.getActiveMedia()!;
    expect(incoming.classList.contains('shoji-transition-my-flip-enter')).toBe(true);
    expect(incoming.dataset.shojiDirection).toBe('next');
  });

  it('removes the enter class and direction attribute once the host animation ends', async () => {
    const manager = await makeManager();
    const transition = new SlideTransition(manager);
    transition.animateCustom('my-flip', -1, () => manager.render(items, 1, () => {}));

    const incoming = manager.getActiveMedia()!;
    expect(incoming.dataset.shojiDirection).toBe('prev');

    fireTransitionEnd(incoming);

    expect(incoming.classList.contains('shoji-transition-my-flip-enter')).toBe(false);
    expect(incoming.dataset.shojiDirection).toBeUndefined();
  });

  it('also resolves via animationend, for hosts using @keyframes instead of transition', async () => {
    const manager = await makeManager();
    const transition = new SlideTransition(manager);
    transition.animateCustom('my-flip', 1, () => manager.render(items, 1, () => {}));

    const ghost = manager.element.querySelector('.shoji-slide-ghost') as HTMLElement;
    const event = new Event('animationend');
    ghost.dispatchEvent(event);

    expect(manager.element.querySelector('.shoji-slide-ghost')).toBeNull();
  });
});
