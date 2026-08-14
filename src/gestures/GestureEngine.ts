/**
 * DESIGN.md §2.4 — one Pointer-Events-based engine feeding all consumers:
 * core drag-to-navigate, core vertical-swipe-to-close, and (via `onPinch`/
 * `onDoubleTap`/`onWheelZoom`) a future zoom plugin that doesn't exist yet.
 * Pointer Events (not separate mouse/touch listeners) give mouse-drag and
 * touch-swipe parity for free — one code path, one set of thresholds.
 *
 * State machine: `idle → pending → dragging(h|v) → idle`. `pending` is the
 * window before `lockThreshold` is crossed, where it's still ambiguous
 * whether this is a tap, a horizontal drag, or a vertical drag; `dragging`
 * is entered once one axis's delta exceeds the threshold first, and the
 * *other* axis is ignored for the rest of that gesture (an axis lock, not
 * a snapped direction — diagonal drags don't fight the engine). There's no
 * literal blocking `settling` state after release: `onDragEnd` reports the
 * outcome synchronously and the caller owns however long its own
 * snap-back/completion animation takes; a new `pointerdown` before that
 * finishes is allowed to interrupt it (matches real touch-carousel UX —
 * grabbing a still-settling slide feels responsive, not broken).
 *
 * Pinch tracking is a separate concern layered on top of the same pointer
 * map: a second simultaneous pointer suspends whatever single-pointer drag
 * state was in progress (real pinches start from a single touch already
 * down) and switches to distance-ratio tracking until back down to one
 * pointer or zero.
 */

export type GestureDirection = 'horizontal' | 'vertical';

export interface GestureEngineOptions {
  /** px of movement before a direction locks in. DESIGN.md §2.4 default: 10. */
  lockThreshold: number;
  /** px of movement past which a released drag counts as "swiped" (completes), independent of velocity. DESIGN.md §2.4 default: 50. */
  swipeThreshold: number;
  /** px/ms release velocity past which a drag completes even under swipeThreshold — a fast flick counts. DESIGN.md §2.4 default: 0.3. */
  swipeVelocity: number;
}

export interface GestureEngineCallbacks {
  /** Direction has just locked in for this gesture — the first move past lockThreshold. */
  onDragStart?(direction: GestureDirection, event: PointerEvent): void;
  /** delta: signed px moved along the locked axis so far (this move's cumulative total, not a per-frame diff). */
  onDragMove?(direction: GestureDirection, delta: number, event: PointerEvent): void;
  /** Pointer released (or cancelled) after a drag was in progress. velocity is signed px/ms over the whole gesture; completed reflects swipeThreshold/swipeVelocity. cancelled is true for pointercancel (e.g. an OS gesture took over) — always treated as not-completed regardless of delta/velocity. */
  onDragEnd?(
    direction: GestureDirection,
    delta: number,
    velocity: number,
    completed: boolean,
    cancelled: boolean,
  ): void;
  /** A pointerdown that never crossed lockThreshold before release — not a drag. Used to detect double-tap (the engine tracks tap timing/position itself and calls onDoubleTap instead when two land close enough together) as well as being a simple tap signal on its own. */
  onTap?(x: number, y: number, event: PointerEvent): void;
  onDoubleTap?(x: number, y: number, event: PointerEvent): void;
  /** scale is relative to the pinch's own start distance (1 = unchanged), not a cumulative multiplier across multiple pinch gestures. */
  onPinchStart?(centerX: number, centerY: number): void;
  onPinchMove?(scale: number, centerX: number, centerY: number): void;
  onPinchEnd?(): void;
  /** Ctrl+wheel (trackpad pinch reports this way in every major browser) or a genuine ctrl+scroll-wheel. deltaScale is a small increment (positive = zoom in), not an absolute scale — the caller accumulates it. */
  onWheelZoom?(deltaScale: number, x: number, y: number, event: WheelEvent): void;
  /** Only consulted on pointerdown — returning true means this pointer is ignored for the rest of its lifetime (a click on a real button/control shouldn't also start a drag). */
  ignore?(event: PointerEvent): boolean;
  /** Consulted right before capturing a locked drag's pointer — `false` skips capture for this gesture entirely (not just its drag effect). Default `true` if omitted. See onPointerMove's capture branch for why this needs to be a real skip, not just a suppressed effect. */
  shouldCapture?(): boolean;
}

const DOUBLE_TAP_MAX_DELAY_MS = 300;
const DOUBLE_TAP_MAX_DISTANCE = 30;
const TAP_MAX_DELAY_MS = 500; // a pointerdown→up this slow isn't a "tap" even if it never crossed lockThreshold

interface PointerState {
  startX: number;
  startY: number;
  startTime: number;
  lastX: number;
  lastY: number;
  lastTime: number;
}

export class GestureEngine {
  private readonly target: HTMLElement;
  private readonly options: GestureEngineOptions;
  private readonly callbacks: GestureEngineCallbacks;

  private readonly pointers = new Map<number, PointerState>();
  private primaryPointerId: number | null = null;
  private direction: GestureDirection | null = null;
  private dragStartDistance = 0; // along the locked axis, at the moment direction locked — subtracted so onDragStart's delta is 0

  private pinching = false;
  private pinchStartDistance = 0;

  /** True once `setPointerCapture` has actually been called for the gesture currently in progress — see `suppressRetargetedClick`'s own doc comment for why this needs tracking separately from `direction`. */
  private capturedThisGesture = false;

  // -Infinity, not 0: `event.timeStamp` is time-since-navigation-start, so a
  // real first tap is always some large positive number and 0 would seem
  // like a safe "no previous tap" sentinel in practice — but not always: a
  // tap in the first 300ms of the page's life, near the viewport's top-left
  // corner, would satisfy registerTap's isDouble check against this
  // sentinel and get wrongly reported as a double-tap on nothing. -Infinity
  // can never be within DOUBLE_TAP_MAX_DELAY_MS of any real timestamp.
  private lastTapTime = -Infinity;
  private lastTapX = 0;
  private lastTapY = 0;

  constructor(
    target: HTMLElement,
    callbacks: GestureEngineCallbacks,
    options?: Partial<GestureEngineOptions>,
  ) {
    this.target = target;
    this.callbacks = callbacks;
    this.options = {
      lockThreshold: options?.lockThreshold ?? 10,
      swipeThreshold: options?.swipeThreshold ?? 50,
      swipeVelocity: options?.swipeVelocity ?? 0.3,
    };

    this.target.addEventListener('pointerdown', this.onPointerDown);
    // Not passive: once a horizontal/vertical drag direction has locked in,
    // preventDefault() on move is required so the browser's own
    // scroll/back-navigation gesture doesn't fight the drag — see
    // onPointerMove. Before that lock, moves don't preventDefault, so
    // ordinary page scroll/tap behavior is unaffected until a real drag is
    // actually recognized.
    this.target.addEventListener('pointermove', this.onPointerMove);
    this.target.addEventListener('pointerup', this.onPointerUp);
    this.target.addEventListener('pointercancel', this.onPointerCancel);
    // ctrl+wheel must preventDefault (documented, not passive) — otherwise
    // the browser zooms the whole page instead of this becoming a gesture
    // the caller can hand to a zoom plugin.
    this.target.addEventListener('wheel', this.onWheel, { passive: false });
  }

  destroy(): void {
    this.target.removeEventListener('pointerdown', this.onPointerDown);
    this.target.removeEventListener('pointermove', this.onPointerMove);
    this.target.removeEventListener('pointerup', this.onPointerUp);
    this.target.removeEventListener('pointercancel', this.onPointerCancel);
    this.target.removeEventListener('wheel', this.onWheel);
    this.pointers.clear();
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.isPrimary === false && this.pointers.size === 0) return; // stray non-primary with no primary tracked yet — ignore
    if (this.pointers.size === 0 && this.callbacks.ignore?.(event)) return;

    this.pointers.set(event.pointerId, {
      startX: event.clientX,
      startY: event.clientY,
      startTime: event.timeStamp,
      lastX: event.clientX,
      lastY: event.clientY,
      lastTime: event.timeStamp,
    });

    if (this.pointers.size === 1) {
      this.primaryPointerId = event.pointerId;
      this.direction = null;
      this.capturedThisGesture = false;
      // Deliberately NOT captured here — see onPointerMove's direction-lock
      // branch for why.
    } else if (this.pointers.size === 2) {
      // A second pointer arriving mid-drag suspends the single-pointer
      // gesture (real pinches start from an already-down single touch) and
      // starts pinch tracking instead.
      this.direction = null;
      this.pinching = true;
      const [a, b] = [...this.pointers.values()];
      this.pinchStartDistance = distanceBetween(a!, b!);
      const center = centerOf(a!, b!);
      this.callbacks.onPinchStart?.(center.x, center.y);
    }
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    const state = this.pointers.get(event.pointerId);
    if (!state) return;
    state.lastX = event.clientX;
    state.lastY = event.clientY;
    state.lastTime = event.timeStamp;

    if (this.pinching) {
      if (this.pointers.size < 2) return;
      const [a, b] = [...this.pointers.values()];
      const distance = distanceBetween(a!, b!);
      const scale = this.pinchStartDistance > 0 ? distance / this.pinchStartDistance : 1;
      const center = centerOf(a!, b!);
      this.callbacks.onPinchMove?.(scale, center.x, center.y);
      return;
    }

    if (event.pointerId !== this.primaryPointerId) return;

    const dx = event.clientX - state.startX;
    const dy = event.clientY - state.startY;

    if (this.direction === null) {
      const absX = Math.abs(dx);
      const absY = Math.abs(dy);
      if (Math.max(absX, absY) < this.options.lockThreshold) return; // still pending — too small to call yet
      this.direction = absX > absY ? 'horizontal' : 'vertical';
      this.dragStartDistance = this.direction === 'horizontal' ? dx : dy;
      // Captured only once a real drag is confirmed (direction locked), not
      // on every pointerdown — capturing eagerly retargets the browser's
      // synthesized mousedown/click to the capturing element, breaking any
      // click-target-based logic downstream on an ordinary tap. Deferring
      // capture to here fixes that — but a *confirmed* drag still captures,
      // and a captured pointer's release still fires a real click
      // afterward, still retargeted to `target`. See
      // `suppressRetargetedClick` below for that other half of the fix.
      if (this.callbacks.shouldCapture?.() ?? true) {
        this.target.setPointerCapture(event.pointerId);
        this.capturedThisGesture = true;
      }
      this.callbacks.onDragStart?.(this.direction, event);
    }

    if (this.direction === 'horizontal') event.preventDefault(); // stop page/back-gesture scroll from fighting the drag

    const delta = (this.direction === 'horizontal' ? dx : dy) - this.dragStartDistance;
    this.callbacks.onDragMove?.(this.direction, delta, event);
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    this.finishPointer(event, false);
  };

  private readonly onPointerCancel = (event: PointerEvent): void => {
    this.finishPointer(event, true);
  };

  private finishPointer(event: PointerEvent, cancelled: boolean): void {
    const state = this.pointers.get(event.pointerId);
    if (!state) return;
    // pointerup/pointercancel carry their own release coordinates — these
    // don't necessarily match the last pointermove (coalesced/throttled
    // move events, or a release with no intervening move at all), so total
    // delta/velocity/tap-position must be computed from *this* event's
    // position, not whatever onPointerMove last recorded.
    state.lastX = event.clientX;
    state.lastY = event.clientY;
    state.lastTime = event.timeStamp;
    this.pointers.delete(event.pointerId);

    if (this.pinching) {
      if (this.pointers.size < 2) {
        this.pinching = false;
        this.callbacks.onPinchEnd?.();
      }
      // Still >= 2 pointers (a third was down) — stay in pinch mode; not
      // handled further here, an unusual case not worth extra state for.
      return;
    }

    if (event.pointerId !== this.primaryPointerId) return;

    if (this.direction === null) {
      // Never crossed lockThreshold — a tap, not a drag (unless it was
      // cancelled, or took too long to plausibly be an intentional tap).
      if (!cancelled && event.timeStamp - state.startTime <= TAP_MAX_DELAY_MS) {
        this.registerTap(state.lastX, state.lastY, event);
      }
    } else {
      const elapsed = Math.max(1, state.lastTime - state.startTime); // avoid divide-by-zero on a same-tick move
      const totalDelta =
        (this.direction === 'horizontal'
          ? state.lastX - state.startX
          : state.lastY - state.startY) - this.dragStartDistance;
      const velocity = totalDelta / elapsed;
      const completed =
        !cancelled &&
        (Math.abs(totalDelta) >= this.options.swipeThreshold ||
          Math.abs(velocity) >= this.options.swipeVelocity);
      this.callbacks.onDragEnd?.(this.direction, totalDelta, velocity, completed, cancelled);
      if (this.capturedThisGesture) this.suppressRetargetedClick();
    }

    this.primaryPointerId = null;
    this.direction = null;
    this.capturedThisGesture = false;
  }

  /**
   * A captured pointer's release still fires a real `click`, retargeted to
   * `target` regardless of where the pointer visually ends up — misread by
   * Gallery's click-outside-to-close as landing nowhere recognizable.
   * Consumes exactly one `click` on `target` in the capture phase, then
   * removes itself; a fallback timeout also removes it in case no `click`
   * ever comes, so it can't swallow a later, unrelated one.
   */
  private suppressRetargetedClick(): void {
    let done = false;
    const cleanup = (event?: MouseEvent): void => {
      if (done) return;
      done = true;
      event?.stopPropagation();
      this.target.removeEventListener('click', cleanup, { capture: true });
    };
    this.target.addEventListener('click', cleanup, { capture: true });
    setTimeout(cleanup, 500);
  }

  private registerTap(x: number, y: number, event: PointerEvent): void {
    const now = event.timeStamp;
    const isDouble =
      now - this.lastTapTime <= DOUBLE_TAP_MAX_DELAY_MS &&
      Math.hypot(x - this.lastTapX, y - this.lastTapY) <= DOUBLE_TAP_MAX_DISTANCE;
    if (isDouble) {
      this.callbacks.onDoubleTap?.(x, y, event);
      this.lastTapTime = 0; // consumed — a third tap starts fresh, isn't a triple-double
    } else {
      this.callbacks.onTap?.(x, y, event);
      this.lastTapTime = now;
      this.lastTapX = x;
      this.lastTapY = y;
    }
  }

  private readonly onWheel = (event: WheelEvent): void => {
    if (!event.ctrlKey) return;
    event.preventDefault();
    // Browsers report trackpad pinch as ctrl+wheel with deltaY roughly
    // proportional to pinch speed; negate so pinching out (deltaY < 0,
    // conventionally) reads as zooming in (positive deltaScale).
    const deltaScale = -event.deltaY * 0.01;
    this.callbacks.onWheelZoom?.(deltaScale, event.clientX, event.clientY, event);
  };
}

function distanceBetween(
  a: { lastX: number; lastY: number },
  b: { lastX: number; lastY: number },
): number {
  return Math.hypot(a.lastX - b.lastX, a.lastY - b.lastY);
}

function centerOf(
  a: { lastX: number; lastY: number },
  b: { lastX: number; lastY: number },
): { x: number; y: number } {
  return { x: (a.lastX + b.lastX) / 2, y: (a.lastY + b.lastY) / 2 };
}
