/** The drag's exact on-screen appearance at the moment it completed a close — `translateY(px)`/`scale`/`opacity`, all as last shown live (translateY clamped, see `GestureController.takeFrozenDragTransform`). `zoomOut()` jumps `target` here instantly (after measuring its natural box — see `ZoomTransitionTarget.dragStart`) before transitioning away from it, so the close continues in one motion from exactly where the drag left off. */
export interface FrozenDragTransform {
  translateY: number;
  scale: number;
  opacity: number;
}

export interface ZoomTransitionTarget {
  /** The thumbnail element to animate to/from. */
  origin: HTMLElement;
  /** The `.shoji-slide-media` element being animated — not `.shoji-slide` itself, whose transform is already owned by pool-offset positioning. */
  target: HTMLElement;
  /** `item.width / item.height`, when known, else the origin thumbnail's own `naturalWidth`/`naturalHeight` ratio — just a *shape* guess; see `effectiveTargetBox`. */
  aspectRatio?: number;
  /** The real photo's true pixel size — `item.width`/`item.height` only, never the thumbnail's own natural size (would under-cap a large photo). Caps `containedBox` below at native resolution, mirroring `.shoji-slide-img`'s own `max-width/max-height: 100%`, instead of always growing toward filling the dialog. */
  naturalSize?: { width: number; height: number };
  /**
   * A completed drag-close's own last appearance (`GestureController.
   * takeFrozenDragTransform`) — `zoomOut()` (the only consumer) jumps
   * `target` here instantly, *after* measuring its natural box for the
   * landing math, then transitions away from it. Order matters: applying
   * this before measuring would make `effectiveTargetBox()` read the
   * child `<img>`'s rect *already* shrunk by this scale, double-counting
   * it once `zoomOut()`'s own transform (computed from that shrunk
   * measurement) then wholesale replaces — not composes with — it.
   */
  dragStart?: FrozenDragTransform;
  /**
   * The zoomed `<img>`'s own real on-screen rect (`getBoundingClientRect()`)
   * at the moment a button-close (or any non-drag close) starts, if it's
   * currently zoomed in — captured by `Gallery.beginClose()` from
   * `registerZoomStartProvider()` *before* the Zoom plugin's own
   * `beforeClose` handler resets it back to neutral (so `zoomOut()`'s own
   * measurement below stays correct — same ordering requirement `dragStart`
   * has, and the same reason).
   *
   * A rect, not the Zoom plugin's raw scale/pan numbers — an earlier version
   * passed those through directly and re-applied them to `target`
   * (`.shoji-slide-media`) the same way `dragStart` reapplies its own
   * translateY/scale. That doesn't work here: Zoom's own pan math is
   * relative to the `<img>` itself with `transform-origin: 0 0`
   * (`zoom/index.ts`), a *different* element with a *different* origin than
   * `target`'s `transform-origin: center` below — reapplying the same
   * numbers onto the wrong element/origin pair visibly shifted the image
   * toward its top-left corner the instant close started, worse the more
   * zoomed in it was. A rect sidesteps this entirely: `zoomOut()` computes
   * the jump the same center-to-center way it computes everything else
   * (`transformBetween`), from `target`'s own freshly-measured natural box
   * to this rect — origin-and-coordinate-system-agnostic, so it doesn't
   * matter what internal convention produced the rect.
   *
   * `zoomOut()` jumps `target` here instantly, then transitions away from
   * it, so closing while zoomed continues in one motion from the zoomed-in
   * view instead of snapping back to neutral first and only then shrinking
   * to the thumbnail. Mutually exclusive with `dragStart` in practice — you
   * can't complete a vertical drag-close while the zoom plugin is also
   * mid-pan, since `GestureController` suspends its own drag handling
   * entirely while zoomed (`isZoomed()`, DESIGN.md §4.6).
   */
  zoomStart?: Box;
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

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The `object-fit: contain` box for `aspectRatio` within `container`, computed analytically since the real image may not be loaded yet. `naturalSize` caps the result at the photo's own true pixel size, never stretching past native resolution. Exported — `SlideManager.ts`'s open-transition placeholder (§2.3) reuses this same math. */
export function containedBox(
  container: Box,
  aspectRatio: number,
  naturalSize?: { width: number; height: number },
): Box {
  const containerRatio = container.width / container.height;
  let width = aspectRatio > containerRatio ? container.width : container.height * aspectRatio;
  let height = aspectRatio > containerRatio ? container.width / aspectRatio : container.height;
  if (naturalSize && naturalSize.width > 0 && naturalSize.height > 0) {
    const cap = Math.min(1, naturalSize.width / width, naturalSize.height / height);
    width *= cap;
    height *= cap;
  }
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
function effectiveTargetBox(
  target: HTMLElement,
  aspectRatio?: number,
  naturalSize?: { width: number; height: number },
): Box {
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
    return containedBox(containerRect, aspectRatio, naturalSize);
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
 *
 * The actual translate3d/scale3d math `computeTransformOutcome` below needs —
 * pulled out on its own so `zoomOut`'s `zoomStart` jump (a *second* use of
 * the exact same center-to-center box-fitting math, landing on a captured
 * live rect instead of `origin`'s) can reuse it directly, rather than
 * re-deriving Zoom's own transform-origin/coordinate conventions on a
 * different element — see `ZoomTransitionTarget.zoomStart`'s own doc
 * comment for why that direct-replication approach doesn't work.
 */
function transformBetween(from: Box, to: Box): string {
  const scale = Math.min(to.width / from.width, to.height / from.height);
  return transformString(from, to, scale, scale);
}

/**
 * Same center-to-center landing as `transformBetween`, but independent
 * scaleX/scaleY instead of one uniform factor — `from` is allowed to warp
 * to `to`'s exact aspect ratio rather than merely fitting inside it. Used
 * only for the `'fade'` outcome below: a real bug, reported from real usage
 * on this exact panoramic-photo/square-thumbnail mismatch — `transformBetween`'s
 * "contain" tradeoff avoided visibly distorting the *photo* mid-zoom, but a
 * `'fade'` close/open isn't preserving that undistorted look anyway (opacity
 * is already carrying the transition), so it bought nothing there except
 * landing on a wrong-shaped, visibly-too-small box instead of the thumbnail's
 * own real size once the shrink finished (DESIGN.md §2.3b).
 */
function transformBetweenStretch(from: Box, to: Box): string {
  return transformString(from, to, to.width / from.width, to.height / from.height);
}

function transformString(from: Box, to: Box, scaleX: number, scaleY: number): string {
  const translateX = to.left + to.width / 2 - (from.left + from.width / 2);
  const translateY = to.top + to.height / 2 - (from.top + from.height / 2);
  // translate3d/scale3d, not translate()/scale() — forces the GPU
  // compositing path instead of a main-thread-painted 2D transform, the
  // same fix already validated for the Zoom plugin's own scale animation
  // (DESIGN.md §4.6): this is the identical technique (a large photo
  // scaled via `transform`) on the same element, just driven by open/close
  // instead of pinch/toolbar zoom.
  return `translate3d(${translateX}px, ${translateY}px, 0) scale3d(${scaleX}, ${scaleY}, 1)`;
}

/**
 * `origin`'s effective visual box, not necessarily its own
 * `getBoundingClientRect()`. In selector/DOM-markup mode without Layout,
 * `origin` is typically a plain `<a>` wrapping a `<img>` — an inline element
 * by default, whose own box is sized to a text-line-height sliver (its
 * `font-size`/`line-height`), not the image it visually contains, even
 * though the image itself paints at full size. A real bug: the zoom
 * open/close transform used that sliver directly as the FLIP target,
 * landing the animation at a tiny, essentially-random offset instead of the
 * real thumbnail's visible position and size. Layout tiles aren't affected
 * (`display: block`, sized to match their child image exactly) — preferring
 * the child's rect there returns the same box either way.
 *
 * `querySelector('img')`, not `firstElementChild` — matches `scan.ts`'s own
 * `scanImage()` convention for locating a thumbnail inside arbitrary host
 * markup, where the `<img>` isn't necessarily the first child (a badge or
 * caption element placed before it in the DOM would otherwise get measured
 * instead, no more correct than the wrapper's own sliver).
 */
function effectiveOriginBox(origin: HTMLElement): Box {
  const img = origin.querySelector('img');
  if (img) {
    const rect = img.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return rect;
  }
  return origin.getBoundingClientRect();
}

/**
 * How much more extreme one box's aspect ratio can be than the other's
 * before `transformBetween`'s single uniform scale (`Math.min`-constrained,
 * same tradeoff `object-fit: contain` makes) stops reading as "shrinking
 * into the thumbnail" and starts reading as "collapsing into a sliver" — a
 * deliberately cropped thumbnail (e.g. a center-cropped square next to a
 * panoramic photo) can differ from the real photo's shape by far more than
 * ordinary letterboxing ever does. `2` (not the `1.5` first proposed):
 * `tests/unit/zoomTransition.test.ts`'s own "never distorts the image's
 * aspect ratio" regression fixture (a square origin against a 16:9 target,
 * ratio 1.778) is a real, intentional case that must still get the plain
 * zoom transform, opacity fade included — it lands at ~56% of the origin's
 * height, letterboxed but clearly still "arriving at the thumbnail," and
 * doesn't need the fade to read correctly. `1.5` would have wrongly routed
 * that case through the fade-plus-transform combo below too. `2` keeps that
 * case (1.778 < 2) while still catching a 3:1 panoramic photo against a
 * square thumbnail (ratio 3.0 > 2), the reported bug — that one lands at
 * ~33% of the origin's height, a visibly thin strip if left fully opaque.
 */
const ASPECT_MISMATCH_THRESHOLD = 2;

type TransformOutcome =
  /** A sane single-scale zoom transform exists — used alone. */
  | { kind: 'zoom'; transform: string }
  /**
   * Both boxes have real size, but their aspect ratios differ too much for
   * `transform` alone to look sane (still `transformBetween`'s own
   * translate/scale — there's no *other* way to move toward the thumbnail's
   * position) — paired with a simultaneous opacity fade so the mismatch
   * dissolves away as part of the motion, never sitting fully opaque as the
   * animation's own final, distorted-looking frame. A plain in-place fade
   * (no `transform` at all) was tried first and reported back as reading
   * "I can't tell where it fades to" — the translate/scale is what keeps
   * this move legible as "going toward the thumbnail," the fade just keeps
   * the sliver shape from ever being the thing fully shown.
   */
  | { kind: 'fade'; transform: string }
  /** No real size to animate to/from at all (e.g. `origin` isn't actually
   * laid out) — nothing sane to do, animated or not. */
  | { kind: 'none' };

/**
 * True if `target`'s effective box (`effectiveTargetBox` above) came from
 * actually measuring real, already-rendered content — not a guess.
 * Duplicates that function's own "is this a trustworthy child" check
 * rather than having it report the distinction back, since only this one
 * caller needs it. See `computeTransformOutcome`'s own `unknownTargetSize`
 * for why the distinction matters.
 */
function hasRealTargetContent(target: HTMLElement): boolean {
  const child = target.firstElementChild;
  const isPlaceholder =
    child instanceof HTMLElement &&
    (child.classList.contains('shoji-slide-spinner') ||
      child.classList.contains('shoji-slide-open-placeholder'));
  if (!(child instanceof HTMLElement) || isPlaceholder) return false;
  const rect = child.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function computeTransformOutcome(
  origin: HTMLElement,
  target: HTMLElement,
  direction: 'in' | 'out',
  aspectRatio?: number,
  naturalSize?: { width: number; height: number },
): TransformOutcome {
  const originRect = effectiveOriginBox(origin);
  const targetRect = effectiveTargetBox(target, aspectRatio, naturalSize);
  if (
    targetRect.width === 0 ||
    targetRect.height === 0 ||
    originRect.width === 0 ||
    originRect.height === 0
  ) {
    return { kind: 'none' };
  }
  // `effectiveTargetBox` had nothing real to measure and no `naturalSize`
  // to cap an analytical guess at (Gallery.ts's open() own doc comment:
  // guessing "probably fills the dialog" visibly overshoots a genuinely
  // small photo) — `targetRect` above is thus an uncapped guess, not a
  // number to confidently zoom toward. Same "can't trust a single
  // scale/size, fade instead" reasoning as the aspect-mismatch case below,
  // just triggered by an unknown size instead of a known-but-mismatched
  // one. Never hits this for a real close (isActiveReady() gates zoomOut()
  // itself, Gallery.ts) — only an open() before anything's loaded, with no
  // item.width/height declared either.
  const unknownTargetSize = !naturalSize && !hasRealTargetContent(target);
  if (unknownTargetSize) {
    // targetRect here is a pure, uncapped guess — there's no real shape to
    // preserve *or* to intentionally land on, so this keeps the plain
    // "contain" scale rather than reaching for transformBetweenStretch
    // below: that fix is about landing pixel-exact on a real, known origin
    // box once the *target's* real shape is what's causing the mismatch,
    // not about a target whose shape isn't known at all.
    return { kind: 'fade', transform: transformBetween(targetRect, originRect) };
  }
  const originRatio = originRect.width / originRect.height;
  const targetRatio = targetRect.width / targetRect.height;
  const ratioOfRatios = Math.max(originRatio, targetRatio) / Math.min(originRatio, targetRatio);
  // Only on close: a real bug, reported directly, ruled out the alternative
  // here too — closing a severely mismatched box with a plain "contain"
  // scale collapses it into a barely-visible sliver (the original reason
  // 'fade' exists at all). Opening doesn't have that failure mode the same
  // way — growing *out* from a small, uniformly-scaled box never produces
  // an unreadable sliver the way shrinking *into* one does — so it isn't
  // worth trading for the fade's own real cost: a real stretch of time
  // where the photo is dim/near-invisible while it's still catching up to
  // full opacity, reported directly from real usage as looking broken, not
  // like a deliberate transition. Opening a badly mismatched item now just
  // grows a plain, undistorted "contain" box the same as any other item —
  // it won't perfectly fill the origin thumbnail's own footprint along the
  // way, but the photo itself is visible and correctly proportioned at
  // every single frame, the whole time.
  const isMismatch = direction === 'out' && ratioOfRatios > ASPECT_MISMATCH_THRESHOLD;
  // transformBetweenStretch, not transformBetween, once fading for a real
  // aspect mismatch: see its own doc comment for why landing pixel-exact on
  // origin's real box is strictly better there than preserving an
  // undistorted "contain" fit.
  const transform = isMismatch
    ? transformBetweenStretch(targetRect, originRect)
    : transformBetween(targetRect, originRect);
  return isMismatch ? { kind: 'fade', transform } : { kind: 'zoom', transform };
}

/**
 * The `'fade'` outcome's own transition values — see its doc comment for why
 * `transform` and `opacity` animate together. `transform` must stay listed
 * first in both: `waitForTransitionEnd` reads back `transitionDuration`'s
 * first comma-separated value to know how long to wait, and that has to be
 * `transform`'s full duration, not opacity's shorter one below.
 *
 * Opacity gets its own, shorter `--shoji-fade-duration` rather than sharing
 * the full duration: an opacity ramp spread across the *whole* transition
 * reads as "blank" for a big chunk of it — low opacity is barely
 * perceptible against the dialog's dark backdrop, so most of a full-
 * duration fade-in looks like nothing is happening yet, and a full-duration
 * fade-out looks like the content vanished well before the shrink motion
 * actually finishes (a real bug, reported from real usage on this exact
 * panoramic-photo/square-thumbnail mismatch: DESIGN.md §2.3b). Concentrating
 * the opacity change into a short window at the *start* of `zoomIn` (content
 * appears fast, size/shape keeps animating for the rest of the duration)
 * and at the *end* of `zoomOut` (content stays fully visible while
 * shrinking, only disappearing right at the very end) keeps the image
 * visible for as much of the motion as possible either way.
 */
const FADE_IN_TRANSITION =
  'transform var(--shoji-duration) var(--shoji-easing), opacity var(--shoji-fade-duration, 120ms) var(--shoji-easing)';
const FADE_OUT_TRANSITION =
  'transform var(--shoji-duration) var(--shoji-easing), opacity var(--shoji-fade-duration, 120ms) var(--shoji-easing) calc(var(--shoji-duration) - var(--shoji-fade-duration, 120ms))';

/**
 * Waits for `target`'s own transition (on `property`, default `'transform'`)
 * to end (with a safety-net timeout in case transitionend never fires — an
 * interrupted/removed element, a browser quirk, or `--shoji-duration: 0ms`
 * under `prefers-reduced-motion`, which some browsers never fire a real
 * transitionend for at all) then calls `cb` exactly once. Exported: the
 * gesture-driven drag-to-navigate/drag-to-close settle animations (§2.4,
 * `Gallery.ts`) reuse this same wait-with-fallback logic rather than
 * duplicating it — same instant-jump-then-transition FLIP family of moves
 * as the zoom transition, just on a different element/property pairing.
 * `close()`'s own controls-fade-before-zoom-out sequencing (§2.6a) reuses it
 * a second way, waiting on `opacity` instead.
 */
export function waitForTransitionEnd(
  target: HTMLElement,
  cb: () => void,
  property = 'transform',
): void {
  const durationMs = parseCssTime(getComputedStyle(target).transitionDuration);
  let done = false;
  const finish = (): void => {
    if (done) return;
    done = true;
    target.removeEventListener('transitionend', onEnd);
    cb();
  };
  const onEnd = (event: Event): void => {
    if (event.target === target && (event as TransitionEvent).propertyName === property) finish();
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
 * assigning it, not the raw string `computeTransformOutcome()` produced.
 * Setting `element.style.transform` to a string containing an arbitrary JS
 * float (e.g. `scale(0.10416666666666667)`, `transformBetween`'s un-rounded
 * `Math.min(...)` result) and reading it back gives a *differently
 * formatted* string — the browser's CSSOM serializer rounds/reformats
 * numeric values on its own (observed in Chromium: `scale(0.104167)`).
 * Comparing the raw JS string against that reformatted one here always
 * failed for any scale factor without a short, clean decimal, silently
 * skipping the clear — permanently leaving `zoomOut`'s shrink transform
 * applied to `.shoji-slide-media` after the lightbox closed. The next
 * `open()`'s `computeTransformOutcome` then measured that *already-shrunk*
 * element's `getBoundingClientRect()` as if it were the natural size,
 * computing a near-1 (barely visible) scale instead of a real zoom-in —
 * reads as "doesn't zoom, just appears," and compounds on every further
 * open/close cycle since the stuck transform is never cleared either way.
 * `zoomIn`'s own `'none'` literal never hit this — a fixed string round-trips
 * through the CSSOM unchanged, unlike an arbitrary computed float.
 *
 * `opacity` is cleared unconditionally, same as `transition`/
 * `transformOrigin` — a completed drag-close (`Gallery.beginClose`) bakes
 * the drag's own dim onto `target` before this animation starts; nothing
 * else in this codebase sets `.shoji-slide-media`'s opacity, so there's
 * nothing else's value this could ever clobber.
 */
function clearInlineTransform(target: HTMLElement, expectedTransform: string): void {
  target.style.transition = '';
  target.style.transformOrigin = '';
  target.style.willChange = '';
  target.style.opacity = '';
  if (target.style.transform === expectedTransform) target.style.transform = '';
}

/**
 * FLIP-style open: `target` starts visually at `origin`'s position/size (an
 * instant, untransitioned jump), then transitions to its natural layout —
 * reads as "growing out of the thumbnail." Fire-and-forget: cleans up its
 * own inline styles once the transition ends, nothing to await.
 */
export function zoomIn({ origin, target, aspectRatio, naturalSize }: ZoomTransitionTarget): void {
  if (prefersReducedMotion()) return;
  const outcome = computeTransformOutcome(origin, target, 'in', aspectRatio, naturalSize);
  if (outcome.kind === 'none') return;
  const { transform } = outcome;
  // See the `'fade'` outcome's own doc comment — animates alongside the
  // same transform below, not instead of it.
  const isFade = outcome.kind === 'fade';

  target.style.transition = 'none';
  // transformBetween's translateX/Y is center-to-center math — must pair with
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
  target.style.willChange = isFade ? 'transform, opacity' : 'transform';
  target.style.transform = transform;
  if (isFade) target.style.opacity = '0';
  void target.offsetHeight; // force the instant jump to commit before transitioning away from it
  target.style.transition = isFade
    ? FADE_IN_TRANSITION
    : 'transform var(--shoji-duration) var(--shoji-easing)';
  target.style.transform = 'none';
  if (isFade) target.style.opacity = '1';

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
  { origin, target, aspectRatio, naturalSize, dragStart, zoomStart }: ZoomTransitionTarget,
  onComplete: () => void,
): void {
  if (prefersReducedMotion()) {
    onComplete();
    return;
  }
  // Measured before dragStart/zoomStart is ever applied to `target` — see
  // ZoomTransitionTarget.dragStart's doc comment for why the order matters.
  const outcome = computeTransformOutcome(origin, target, 'out', aspectRatio, naturalSize);
  if (outcome.kind === 'none') {
    onComplete();
    return;
  }
  const { transform } = outcome;
  // See zoomIn's own doc comment on this — same "animates alongside the
  // transform, not instead of it" reasoning.
  const isFade = outcome.kind === 'fade';

  // transformBetween's translateX/Y is center-to-center math — must pair with
  // a center transform-origin (the CSS default), not 'top left', or the
  // scaled box ends up offset from origin by however far origin's center
  // sits from its own top-left corner.
  target.style.transformOrigin = 'center';
  target.style.willChange = isFade ? 'transform, opacity' : 'transform'; // see zoomIn's doc comment on this line
  if (dragStart) {
    // Instant jump to exactly where the drag left off — same FLIP
    // technique `zoomIn()` uses to jump onto origin's box before
    // transitioning away from it, just jumping to wherever the drag left
    // off instead of a fixed point. translate3d/scale3d (not the 2D forms),
    // matching the landing transform's own function list below — mismatched
    // function types between the transition's start/end values force the
    // browser into matrix-decomposition interpolation instead of simple
    // per-parameter interpolation, and lose the GPU-compositing path this
    // codebase otherwise always uses for this element (DESIGN.md §2.3b).
    target.style.transition = 'none';
    target.style.transform = `translate3d(0px, ${dragStart.translateY}px, 0px) scale3d(${dragStart.scale}, ${dragStart.scale}, 1)`;
    target.style.opacity = String(dragStart.opacity);
    void target.offsetHeight; // commit the jump before transitioning away from it
  } else if (zoomStart) {
    // Same FLIP jump as dragStart above, computed the same center-to-center
    // way as `transform` above (not dragStart's raw translate/scale reuse
    // — see ZoomTransitionTarget.zoomStart's doc comment for why that
    // doesn't work here). `target`'s own effective box, re-measured fresh:
    // cheap, and guaranteed unchanged since the read inside
    // computeTransformOutcome() above — nothing's touched `target` in between.
    // Still correct even if `target` is currently rotated/flipped (the
    // RotateFlip plugin, applied directly to this same element, unlike
    // Zoom's own scale/pan — see below): both this measurement and
    // `zoomStart` itself were captured at the same rotation, so the
    // scale/translate between their two (equally rotated) bounding boxes
    // still isolates the zoom-only delta correctly.
    const targetRect = effectiveTargetBox(target, aspectRatio, naturalSize);
    if (targetRect.width > 0 && targetRect.height > 0) {
      // Composed onto whatever's already there, never replacing it outright
      // — a real bug, reported from real usage: closing while both rotated/
      // flipped *and* zoomed wholesale-overwrote RotateFlip's own
      // scaleX/scaleY/rotate() with this jump's plain translate/scale,
      // un-rotating *instantly* right here, before the real transition
      // below even starts — a snap to neutral rotation, then a separate
      // zoom-out, instead of the smooth combined un-rotate-while-shrinking
      // motion closing while rotated (without zoomStart at all) already
      // gets for free: transitioning target's transform from *whatever it
      // currently is* to the final plain shrink value is what makes that
      // work, and it needs target's rotation to still be sitting there
      // when the transition starts, not already erased by this jump.
      const existing = target.style.transform;
      const jump = transformBetween(targetRect, zoomStart);
      target.style.transition = 'none';
      target.style.transform = existing && existing !== 'none' ? `${existing} ${jump}` : jump;
      void target.offsetHeight;
    }
  }
  target.style.transition = isFade
    ? FADE_OUT_TRANSITION
    : 'transform var(--shoji-duration) var(--shoji-easing)';
  void target.offsetHeight;
  target.style.transform = transform;
  if (isFade) target.style.opacity = '0';
  // Read back what the browser actually stored, not the raw string just
  // assigned — see clearInlineTransform's own doc comment for why the two
  // can differ (CSSOM float reformatting) and why that difference matters.
  const appliedTransform = target.style.transform;

  waitForTransitionEnd(target, () => {
    clearInlineTransform(target, appliedTransform);
    onComplete();
  });
}
