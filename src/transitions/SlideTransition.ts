import type { SlideManager } from '../core/SlideManager';
import type { TransitionPreset } from './presets';

function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** `"300ms"` / `"0.3s"` → milliseconds — same parser as `zoomTransition.ts`, duplicated rather than shared: two independent transition subsystems that happen to share a timing format. */
function parseCssTime(value: string): number {
  const first = value.split(',')[0]?.trim() ?? '';
  if (first.endsWith('ms')) return parseFloat(first);
  if (first.endsWith('s')) return parseFloat(first) * 1000;
  return 0;
}

/** Waits for `transitionend` *or* `animationend` (with a timeout fallback) then calls `cb` once — the custom CSS-class-pair path (§2.5) may use either, since "no JS needed" for the host means Shoji can't assume which. */
function waitForEnd(el: HTMLElement, cb: () => void): void {
  const style = getComputedStyle(el);
  const durationMs = Math.max(
    parseCssTime(style.transitionDuration),
    parseCssTime(style.animationDuration),
  );
  let done = false;
  const finish = (): void => {
    if (done) return;
    done = true;
    el.removeEventListener('transitionend', onEnd);
    el.removeEventListener('animationend', onEnd);
    cb();
  };
  const onEnd = (event: Event): void => {
    if (event.target === el) finish();
  };
  el.addEventListener('transitionend', onEnd);
  el.addEventListener('animationend', onEnd);
  setTimeout(finish, durationMs + 100);
}

/** Incoming slide: instant jump to `(transform, opacity)` (same FLIP trick as `zoomTransition.ts`'s `zoomIn`), then transitions to natural. */
function applyEnter(el: HTMLElement, transform: string, opacity: number): void {
  el.style.transition = 'none';
  el.style.transformOrigin = 'center';
  el.style.transform = transform;
  el.style.opacity = String(opacity);
  void el.offsetHeight; // force the instant jump to commit before transitioning away from it
  el.style.transition =
    'transform var(--shoji-duration) var(--shoji-easing), opacity var(--shoji-duration) var(--shoji-easing)';
  el.style.transform = 'none';
  el.style.opacity = '1';
}

/** Outgoing ghost: already sits at natural (a fresh clone has no inline transform yet), so it transitions the other way — natural → `(transform, opacity)`, mirroring `zoomOut`'s shape. */
function applyLeave(el: HTMLElement, transform: string, opacity: number): void {
  el.style.transformOrigin = 'center';
  el.style.transition =
    'transform var(--shoji-duration) var(--shoji-easing), opacity var(--shoji-duration) var(--shoji-easing)';
  void el.offsetHeight;
  el.style.transform = transform;
  el.style.opacity = String(opacity);
}

function clearInlineTransform(el: HTMLElement): void {
  el.style.transition = '';
  el.style.transform = '';
  el.style.opacity = '';
  el.style.transformOrigin = '';
}

/**
 * DESIGN.md §2.5 — animates a slide-to-slide navigation via a temporary
 * "ghost": a clone of the outgoing `.shoji-slide-media`, positioned over
 * the real slot, playing the preset's `leave` keyframe while `swapContent`
 * (the real `SlideManager.render()` reassignment) runs invisibly underneath
 * it. The newly-swapped-in real active media then plays `enter`. Both
 * animate concurrently.
 *
 * Deliberately separate from the gesture engine's own live-drag/settle
 * animation (`GestureController.ts`, §2.4): `mode` is a discrete "jump" for
 * programmatic navigation, not layered onto a continuous drag — a completed
 * swipe always uses its own pool-shift regardless of `mode`. See
 * `Gallery.navigate()`'s `animate` flag.
 */
export class SlideTransition {
  constructor(private readonly slides: SlideManager) {}

  /** A recognized built-in preset (`TRANSITION_PRESETS`). */
  animate(preset: TransitionPreset, direction: 1 | -1, swapContent: () => void): void {
    this.run(swapContent, (ghost, incoming) => {
      const leave = preset.leave(direction);
      applyLeave(ghost, leave.transform, leave.opacity);
      const enter = preset.enter(direction);
      applyEnter(incoming, enter.transform, enter.opacity);
    });
  }

  /** An unrecognized `mode` string: a host-supplied CSS class pair (`shoji-transition-<mode>-leave`/`-enter`), not an error — §2.5's "custom animation = a CSS class pair, no JS needed." */
  animateCustom(mode: string, direction: 1 | -1, swapContent: () => void): void {
    const dirAttr = direction === 1 ? 'next' : 'prev';
    this.run(
      swapContent,
      (ghost, incoming) => {
        ghost.dataset.shojiDirection = dirAttr;
        ghost.classList.add(`shoji-transition-${mode}-leave`);
        incoming.dataset.shojiDirection = dirAttr;
        incoming.classList.add(`shoji-transition-${mode}-enter`);
      },
      (incoming) => {
        incoming.classList.remove(`shoji-transition-${mode}-enter`);
        delete incoming.dataset.shojiDirection;
      },
    );
  }

  private run(
    swapContent: () => void,
    kickOff: (ghost: HTMLElement, incoming: HTMLElement) => void,
    cleanupIncoming: (incoming: HTMLElement) => void = clearInlineTransform,
  ): void {
    if (prefersReducedMotion()) {
      swapContent();
      return;
    }
    const outgoing = this.slides.getActiveMedia();
    if (!outgoing) {
      swapContent();
      return;
    }

    const ghost = document.createElement('div');
    ghost.className = 'shoji-slide-ghost';
    ghost.appendChild(outgoing.cloneNode(true) as HTMLElement);
    this.slides.element.appendChild(ghost);
    void ghost.offsetHeight; // commit the ghost's natural (untransformed) appearance before anything changes it

    swapContent();

    const incoming = this.slides.getActiveMedia();
    if (!incoming) {
      ghost.remove();
      return;
    }

    kickOff(ghost, incoming);
    waitForEnd(ghost, () => ghost.remove());
    waitForEnd(incoming, () => cleanupIncoming(incoming));
  }
}
