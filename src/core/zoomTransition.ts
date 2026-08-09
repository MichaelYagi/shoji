export interface ZoomTransitionTarget {
  /** The thumbnail element to animate to/from. */
  origin: HTMLElement;
  /** The `.shoji-slide-media` element being animated — not `.shoji-slide` itself, whose transform is already owned by pool-offset positioning. */
  target: HTMLElement;
  /** `item.width / item.height`, when known — `target` is always its full flex-box size, never the (usually smaller, letterboxed) rendered photo inside it; see `effectiveTargetBox`. */
  aspectRatio?: number;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** `"300ms"` / `"0.3s"` → milliseconds. Reads the *actual* computed value, not an assumed default, so a host overriding `--shoji-duration` still gets a correct fallback timeout below. */
function parseCssTime(value: string): number {
  const first = value.split(',')[0]?.trim() ?? '';
  if (first.endsWith('ms')) return parseFloat(first);
  if (first.endsWith('s')) return parseFloat(first) * 1000;
  return 0;
}

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The `object-fit: contain` box for `aspectRatio` within `container` — computed analytically since the real image may not be loaded/attached yet. */
function containedBox(container: Box, aspectRatio: number): Box {
  const containerRatio = container.width / container.height;
  const width = aspectRatio > containerRatio ? container.width : container.height * aspectRatio;
  const height = aspectRatio > containerRatio ? container.width / aspectRatio : container.height;
  return {
    left: container.left + (container.width - width) / 2,
    top: container.top + (container.height - height) / 2,
    width,
    height,
  };
}

/**
 * `target`'s effective visual box, not necessarily its own
 * `getBoundingClientRect()`. `target` is always its full flex-box size; the
 * photo inside is usually *smaller*, letterboxed to its own aspect ratio —
 * a real bug used the container's full rect, making the animation scale
 * from/to a box far bigger than the photo ever renders at, visibly
 * shrinking it to something much smaller than the thumbnail whenever the
 * aspect ratios didn't match (the common case). Preferred sources: the real
 * rendered media child, if attached; else an analytical contain-box from
 * `aspectRatio`; else the container's own rect as a last resort.
 *
 * A real bug this guards against: on a fresh open with nothing decoded yet,
 * `target`'s only child at this point is the loading spinner (§2.3) — a
 * fixed ~40px circle, not the photo. Trusting its rect as "the real
 * rendered media child" made the FLIP transition scale toward/from a box
 * far smaller than the actual photo, so the scale factor came out inverted
 * (>1 instead of <1) and the spinner rendered wildly oversized for the
 * transition's first frames before shrinking back down — never the actual
 * photo, which hadn't swapped in yet either way.
 *
 * Same reasoning excludes `.shoji-slide-open-placeholder` (§2.3's low-res
 * open() stand-in): it's a real, non-spinner `<img>`, but its own rendered
 * rect reflects *its* crop/aspect ratio, not the real photo's — trusting it
 * would scale toward the placeholder's shape instead of the real photo's,
 * only to visibly jump again once the real photo swaps in and this
 * transition (already run) no longer applies. Excluding it falls through to
 * the analytical `aspectRatio`-based box below, sized for the real photo
 * regardless of what shape the placeholder happens to be.
 */
function effectiveTargetBox(target: HTMLElement, aspectRatio?: number): Box {
  const child = target.firstElementChild;
  const isPlaceholder =
    child instanceof HTMLElement &&
    (child.classList.contains('shoji-slide-spinner') ||
      child.classList.contains('shoji-slide-open-placeholder'));
  if (child instanceof HTMLElement && !isPlaceholder) {
    const rect = child.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return rect;
  }
  const containerRect = target.getBoundingClientRect();
  if (aspectRatio && containerRect.width > 0 && containerRect.height > 0) {
    return containedBox(containerRect, aspectRatio);
  }
  return containerRect;
}

/**
 * Center-to-center translate + a single uniform scale that lands `target`'s
 * effective box (`effectiveTargetBox` above) *within* `origin`'s box,
 * without distorting it. `null` if either has no real size — nothing sane
 * to animate. One scale factor, not independent scaleX/scaleY: origin and
 * the photo essentially never share an exact aspect ratio, and scaling each
 * axis independently to force a rect match visibly squeezes/stretches the
 * image. `Math.min` keeps the box fully contained within origin's rect
 * (same tradeoff `object-fit: contain` makes); center always lands exactly
 * on origin's center, only the unconstrained axis's edges fall short.
 */
function computeTransform(
  origin: HTMLElement,
  target: HTMLElement,
  aspectRatio?: number,
): string | null {
  const originRect = origin.getBoundingClientRect();
  const targetRect = effectiveTargetBox(target, aspectRatio);
  if (
    targetRect.width === 0 ||
    targetRect.height === 0 ||
    originRect.width === 0 ||
    originRect.height === 0
  ) {
    return null;
  }
  const scale = Math.min(
    originRect.width / targetRect.width,
    originRect.height / targetRect.height,
  );
  const translateX =
    originRect.left + originRect.width / 2 - (targetRect.left + targetRect.width / 2);
  const translateY =
    originRect.top + originRect.height / 2 - (targetRect.top + targetRect.height / 2);
  // translate3d/scale3d, not translate()/scale() — forces the GPU
  // compositing path instead of a main-thread-painted 2D transform, the
  // same fix already validated for the Zoom plugin's own scale animation
  // (DESIGN.md §4.6): this is the identical technique (a large photo
  // scaled via `transform`) on the same element, just driven by open/close
  // instead of pinch/toolbar zoom.
  return `translate3d(${translateX}px, ${translateY}px, 0) scale3d(${scale}, ${scale}, 1)`;
}

/**
 * Waits for `target`'s own transform transition to end (with a safety-net
 * timeout in case transitionend never fires — an interrupted/removed
 * element, or a browser quirk) then calls `cb` exactly once. Exported: the
 * gesture-driven drag-to-navigate/drag-to-close settle animations (§2.4,
 * `Gallery.ts`) reuse this same wait-with-fallback logic rather than
 * duplicating it — same instant-jump-then-transition FLIP family of moves
 * as the zoom transition, just on a different element/property pairing.
 */
export function waitForTransitionEnd(target: HTMLElement, cb: () => void): void {
  const durationMs = parseCssTime(getComputedStyle(target).transitionDuration);
  let done = false;
  const finish = (): void => {
    if (done) return;
    done = true;
    target.removeEventListener('transitionend', onEnd);
    cb();
  };
  const onEnd = (event: Event): void => {
    if (event.target === target && (event as TransitionEvent).propertyName === 'transform')
      finish();
  };
  target.addEventListener('transitionend', onEnd);
  setTimeout(finish, durationMs + 100);
}

/**
 * A real bug: unconditionally clearing `transform` here could wipe out a
 * value another plugin (rotateFlip) legitimately set on the *same* element
 * in the time between this animation starting and its cleanup callback
 * firing (transitionend, or the fallback timeout — either can land well
 * after a quick click elsewhere). Only clears `transform` if it still
 * matches what this animation itself last wrote — nothing else has touched
 * it since — otherwise leaves it alone. `transition`/`transformOrigin`
 * are always safe to clear; nothing else in this codebase sets them.
 *
 * A second real bug, found via reopening the lightbox: `expectedTransform`
 * must be the value *read back* from `target.style.transform` right after
 * assigning it, not the raw string `computeTransform()` produced. Setting
 * `element.style.transform` to a string containing an arbitrary JS float
 * (e.g. `scale(0.10416666666666667)`, `computeTransform`'s un-rounded
 * `Math.min(...)` result) and reading it back gives a *differently
 * formatted* string — the browser's CSSOM serializer rounds/reformats
 * numeric values on its own (observed in Chromium: `scale(0.104167)`).
 * Comparing the raw JS string against that reformatted one here always
 * failed for any scale factor without a short, clean decimal, silently
 * skipping the clear — permanently leaving `zoomOut`'s shrink transform
 * applied to `.shoji-slide-media` after the lightbox closed. The next
 * `open()`'s `computeTransform` then measured that *already-shrunk*
 * element's `getBoundingClientRect()` as if it were the natural size,
 * computing a near-1 (barely visible) scale instead of a real zoom-in —
 * reads as "doesn't zoom, just appears," and compounds on every further
 * open/close cycle since the stuck transform is never cleared either way.
 * `zoomIn`'s own `'none'` literal never hit this — a fixed string round-trips
 * through the CSSOM unchanged, unlike an arbitrary computed float.
 */
function clearInlineTransform(target: HTMLElement, expectedTransform: string): void {
  target.style.transition = '';
  target.style.transformOrigin = '';
  target.style.willChange = '';
  if (target.style.transform === expectedTransform) target.style.transform = '';
}

/**
 * FLIP-style open: `target` starts visually at `origin`'s position/size (an
 * instant, untransitioned jump), then transitions to its natural layout —
 * reads as "growing out of the thumbnail." Fire-and-forget: cleans up its
 * own inline styles once the transition ends, nothing to await.
 */
export function zoomIn({ origin, target, aspectRatio }: ZoomTransitionTarget): void {
  if (prefersReducedMotion()) return;
  const transform = computeTransform(origin, target, aspectRatio);
  if (!transform) return;

  target.style.transition = 'none';
  // computeTransform's translateX/Y is center-to-center math — must pair with
  // a center transform-origin (the CSS default), not 'top left', or the
  // scaled box ends up offset from origin by however far origin's center
  // sits from its own top-left corner.
  target.style.transformOrigin = 'center';
  // Promotes target onto its own compositing layer before the animated
  // transform starts, not mid-animation — same GPU-seam mitigation as the
  // Zoom plugin (DESIGN.md §4.6). Cleared in clearInlineTransform once the
  // transition ends, not left on permanently: this is the offset-0 pool
  // slot, alive for the gallery's whole lifetime, not a class scoped to
  // only-while-zoomed.
  target.style.willChange = 'transform';
  target.style.transform = transform;
  void target.offsetHeight; // force the instant jump to commit before transitioning away from it
  target.style.transition = 'transform var(--shoji-duration) var(--shoji-easing)';
  target.style.transform = 'none';

  waitForTransitionEnd(target, () => clearInlineTransform(target, 'none'));
}

/**
 * Reverse of `zoomIn`: `target` transitions from its natural position down
 * to `origin`'s rect — "shrinking back into the thumbnail." `onComplete`
 * always fires exactly once, synchronously if there's nothing to animate
 * (reduced motion, or no valid rect), otherwise once the transition ends —
 * callers use this to know when it's safe to actually hide/finalize.
 */
export function zoomOut(
  { origin, target, aspectRatio }: ZoomTransitionTarget,
  onComplete: () => void,
): void {
  if (prefersReducedMotion()) {
    onComplete();
    return;
  }
  const transform = computeTransform(origin, target, aspectRatio);
  if (!transform) {
    onComplete();
    return;
  }

  // computeTransform's translateX/Y is center-to-center math — must pair with
  // a center transform-origin (the CSS default), not 'top left', or the
  // scaled box ends up offset from origin by however far origin's center
  // sits from its own top-left corner.
  target.style.transformOrigin = 'center';
  target.style.willChange = 'transform'; // see zoomIn's doc comment on this line
  target.style.transition = 'transform var(--shoji-duration) var(--shoji-easing)';
  void target.offsetHeight;
  target.style.transform = transform;
  // Read back what the browser actually stored, not the raw string just
  // assigned — see clearInlineTransform's own doc comment for why the two
  // can differ (CSSOM float reformatting) and why that difference matters.
  const appliedTransform = target.style.transform;

  waitForTransitionEnd(target, () => {
    clearInlineTransform(target, appliedTransform);
    onComplete();
  });
}
