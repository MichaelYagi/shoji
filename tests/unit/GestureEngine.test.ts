import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GestureEngine, type GestureEngineCallbacks } from '../../src/gestures/GestureEngine';

/**
 * PointerEvent's `timeStamp` is normally stamped automatically at
 * construction (time-since-timeOrigin) and read-only — synchronous test
 * code would otherwise see ~0ms elapsed between every dispatch, making
 * velocity/tap-timing assertions meaningless. Overriding it as an own
 * property (shadowing the prototype accessor) is the only way to control it.
 */
function firePointer(
  target: EventTarget,
  type: string,
  opts: {
    clientX?: number;
    clientY?: number;
    pointerId?: number;
    isPrimary?: boolean;
    timeStamp?: number;
  } = {},
): void {
  const event = new PointerEvent(type, {
    clientX: opts.clientX ?? 0,
    clientY: opts.clientY ?? 0,
    pointerId: opts.pointerId ?? 1,
    isPrimary: opts.isPrimary ?? true,
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(event, 'timeStamp', { value: opts.timeStamp ?? 0, configurable: true });
  target.dispatchEvent(event);
}

function fireWheel(
  target: EventTarget,
  opts: { deltaY?: number; ctrlKey?: boolean; clientX?: number; clientY?: number } = {},
): WheelEvent {
  const event = new WheelEvent('wheel', {
    deltaY: opts.deltaY ?? 0,
    ctrlKey: opts.ctrlKey ?? false,
    clientX: opts.clientX ?? 0,
    clientY: opts.clientY ?? 0,
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return event;
}

function makeCallbacks(): GestureEngineCallbacks &
  Record<keyof GestureEngineCallbacks, ReturnType<typeof vi.fn>> {
  return {
    onDragStart: vi.fn(),
    onDragMove: vi.fn(),
    onDragEnd: vi.fn(),
    onTap: vi.fn(),
    onDoubleTap: vi.fn(),
    onPinchStart: vi.fn(),
    onPinchMove: vi.fn(),
    onPinchEnd: vi.fn(),
    onWheelZoom: vi.fn(),
    ignore: vi.fn().mockReturnValue(false),
  } as unknown as GestureEngineCallbacks &
    Record<keyof GestureEngineCallbacks, ReturnType<typeof vi.fn>>;
}

let target: HTMLElement;

beforeEach(() => {
  target = document.createElement('div');
  document.body.appendChild(target);
});

describe('GestureEngine — drag axis locking', () => {
  it('locks horizontal once past lockThreshold and reports delta relative to the lock point', () => {
    const callbacks = makeCallbacks();
    new GestureEngine(target, callbacks, { lockThreshold: 10 });

    firePointer(target, 'pointerdown', { clientX: 0, clientY: 0, timeStamp: 0 });
    firePointer(target, 'pointermove', { clientX: 5, clientY: 0, timeStamp: 10 });
    expect(callbacks.onDragStart).not.toHaveBeenCalled(); // still under lockThreshold

    firePointer(target, 'pointermove', { clientX: 15, clientY: 0, timeStamp: 20 });
    expect(callbacks.onDragStart).toHaveBeenCalledTimes(1);
    expect(callbacks.onDragStart).toHaveBeenCalledWith('horizontal', expect.anything());
    // delta is relative to the lock point (dx=15), not the original pointerdown (0)
    expect(callbacks.onDragMove).toHaveBeenCalledWith('horizontal', 0, expect.anything());

    firePointer(target, 'pointermove', { clientX: 25, clientY: 0, timeStamp: 30 });
    expect(callbacks.onDragMove).toHaveBeenLastCalledWith('horizontal', 10, expect.anything());
  });

  it('locks vertical when |dy| > |dx| at the moment of crossing lockThreshold', () => {
    const callbacks = makeCallbacks();
    new GestureEngine(target, callbacks, { lockThreshold: 10 });

    firePointer(target, 'pointerdown', { clientX: 0, clientY: 0, timeStamp: 0 });
    firePointer(target, 'pointermove', { clientX: 2, clientY: 15, timeStamp: 10 });

    expect(callbacks.onDragStart).toHaveBeenCalledWith('vertical', expect.anything());
    expect(callbacks.onDragMove).toHaveBeenCalledWith('vertical', 0, expect.anything());
  });

  it('locks whichever axis wins even if the other keeps moving afterward (axis lock, not re-evaluated)', () => {
    const callbacks = makeCallbacks();
    new GestureEngine(target, callbacks, { lockThreshold: 10 });

    firePointer(target, 'pointerdown', { clientX: 0, clientY: 0, timeStamp: 0 });
    firePointer(target, 'pointermove', { clientX: 20, clientY: 0, timeStamp: 10 }); // locks horizontal
    firePointer(target, 'pointermove', { clientX: 20, clientY: 50, timeStamp: 20 }); // huge vertical move after lock

    expect(callbacks.onDragStart).toHaveBeenCalledTimes(1);
    expect(callbacks.onDragStart).toHaveBeenCalledWith('horizontal', expect.anything());
    // second move's horizontal delta unchanged (20-20=0) — vertical move is ignored entirely, not queued as a second onDragStart
    expect(callbacks.onDragMove).toHaveBeenLastCalledWith('horizontal', 0, expect.anything());
  });
});

describe('GestureEngine — drag completion (swipeThreshold / swipeVelocity)', () => {
  // Reported delta is measured from the *lock point* (where dx first
  // reaches lockThreshold), not from the original pointerdown — see
  // GestureEngine.ts's dragStartDistance comment ("subtracted so
  // onDragStart's delta is 0"). Every case below locks on the first move,
  // then a second move supplies the post-lock distance being tested.

  it('completes when released past swipeThreshold px, even at low velocity', () => {
    const callbacks = makeCallbacks();
    new GestureEngine(target, callbacks, {
      lockThreshold: 10,
      swipeThreshold: 50,
      swipeVelocity: 999,
    });

    firePointer(target, 'pointerdown', { clientX: 0, timeStamp: 0 });
    firePointer(target, 'pointermove', { clientX: 15, timeStamp: 10 }); // locks, dragStartDistance=15
    firePointer(target, 'pointermove', { clientX: 75, timeStamp: 1000 }); // slow, but far post-lock: delta=60
    firePointer(target, 'pointerup', { clientX: 75, timeStamp: 2000 });

    expect(callbacks.onDragEnd).toHaveBeenCalledWith(
      'horizontal',
      60,
      expect.any(Number),
      true,
      false,
    );
  });

  it('completes on a fast flick under swipeThreshold via swipeVelocity', () => {
    const callbacks = makeCallbacks();
    new GestureEngine(target, callbacks, {
      lockThreshold: 10,
      swipeThreshold: 999,
      swipeVelocity: 0.3,
    });

    firePointer(target, 'pointerdown', { clientX: 0, timeStamp: 0 });
    firePointer(target, 'pointermove', { clientX: 10, timeStamp: 1 }); // locks, dragStartDistance=10
    firePointer(target, 'pointermove', { clientX: 30, timeStamp: 11 }); // post-lock delta=20
    firePointer(target, 'pointerup', { clientX: 30, timeStamp: 21 }); // 20px over 21ms ~= 0.95px/ms >> 0.3

    const [, delta, velocity, completed] = callbacks.onDragEnd.mock.calls[0] as [
      string,
      number,
      number,
      boolean,
      boolean,
    ];
    expect(delta).toBe(20);
    expect(velocity).toBeGreaterThan(0.3);
    expect(completed).toBe(true);
  });

  it('does not complete a short, slow drag', () => {
    const callbacks = makeCallbacks();
    new GestureEngine(target, callbacks, {
      lockThreshold: 10,
      swipeThreshold: 50,
      swipeVelocity: 0.3,
    });

    firePointer(target, 'pointerdown', { clientX: 0, timeStamp: 0 });
    firePointer(target, 'pointermove', { clientX: 10, timeStamp: 1 }); // locks, dragStartDistance=10
    firePointer(target, 'pointermove', { clientX: 15, timeStamp: 1000 });
    // Release lands past the last move's position (10px further, not just
    // the 5px the last move suggested) — exercises that finishPointer reads
    // *this* event's own coordinates, not a stale last-move snapshot.
    firePointer(target, 'pointerup', { clientX: 20, timeStamp: 2000 });

    expect(callbacks.onDragEnd).toHaveBeenCalledWith(
      'horizontal',
      10,
      expect.any(Number),
      false,
      false,
    );
  });

  it('pointercancel always reports not-completed and cancelled=true, regardless of distance', () => {
    const callbacks = makeCallbacks();
    new GestureEngine(target, callbacks, { lockThreshold: 10, swipeThreshold: 50 });

    firePointer(target, 'pointerdown', { clientX: 0, timeStamp: 0 });
    firePointer(target, 'pointermove', { clientX: 200, timeStamp: 10 }); // way past threshold
    firePointer(target, 'pointercancel', { clientX: 200, timeStamp: 20 });

    expect(callbacks.onDragEnd).toHaveBeenCalledWith(
      'horizontal',
      expect.any(Number),
      expect.any(Number),
      false,
      true,
    );
  });
});

describe('GestureEngine — tap / double-tap', () => {
  it('reports a tap for a pointerdown->up that never crosses lockThreshold', () => {
    const callbacks = makeCallbacks();
    new GestureEngine(target, callbacks, { lockThreshold: 10 });

    firePointer(target, 'pointerdown', { clientX: 5, clientY: 5, timeStamp: 0 });
    firePointer(target, 'pointerup', { clientX: 6, clientY: 6, timeStamp: 50 });

    expect(callbacks.onTap).toHaveBeenCalledWith(6, 6, expect.anything());
    expect(callbacks.onDragEnd).not.toHaveBeenCalled();
  });

  it('does not report a tap if the pointerdown->up took too long', () => {
    const callbacks = makeCallbacks();
    new GestureEngine(target, callbacks, {});

    firePointer(target, 'pointerdown', { clientX: 5, clientY: 5, timeStamp: 0 });
    firePointer(target, 'pointerup', { clientX: 5, clientY: 5, timeStamp: 5000 });

    expect(callbacks.onTap).not.toHaveBeenCalled();
  });

  it('promotes a second nearby, well-timed tap to onDoubleTap instead of a second onTap', () => {
    const callbacks = makeCallbacks();
    new GestureEngine(target, callbacks, {});

    firePointer(target, 'pointerdown', { clientX: 10, clientY: 10, timeStamp: 0 });
    firePointer(target, 'pointerup', { clientX: 10, clientY: 10, timeStamp: 50 });
    firePointer(target, 'pointerdown', { clientX: 12, clientY: 12, timeStamp: 100 });
    firePointer(target, 'pointerup', { clientX: 12, clientY: 12, timeStamp: 150 });

    expect(callbacks.onTap).toHaveBeenCalledTimes(1);
    expect(callbacks.onDoubleTap).toHaveBeenCalledTimes(1);
    expect(callbacks.onDoubleTap).toHaveBeenCalledWith(12, 12, expect.anything());
  });

  it('treats two taps too far apart in time as two separate taps, not a double-tap', () => {
    const callbacks = makeCallbacks();
    new GestureEngine(target, callbacks, {});

    firePointer(target, 'pointerdown', { clientX: 10, clientY: 10, timeStamp: 0 });
    firePointer(target, 'pointerup', { clientX: 10, clientY: 10, timeStamp: 50 });
    firePointer(target, 'pointerdown', { clientX: 10, clientY: 10, timeStamp: 1000 });
    firePointer(target, 'pointerup', { clientX: 10, clientY: 10, timeStamp: 1050 });

    expect(callbacks.onTap).toHaveBeenCalledTimes(2);
    expect(callbacks.onDoubleTap).not.toHaveBeenCalled();
  });

  it('treats two taps too far apart in space as two separate taps', () => {
    const callbacks = makeCallbacks();
    new GestureEngine(target, callbacks, {});

    firePointer(target, 'pointerdown', { clientX: 0, clientY: 0, timeStamp: 0 });
    firePointer(target, 'pointerup', { clientX: 0, clientY: 0, timeStamp: 50 });
    firePointer(target, 'pointerdown', { clientX: 500, clientY: 500, timeStamp: 100 });
    firePointer(target, 'pointerup', { clientX: 500, clientY: 500, timeStamp: 150 });

    expect(callbacks.onTap).toHaveBeenCalledTimes(2);
    expect(callbacks.onDoubleTap).not.toHaveBeenCalled();
  });
});

describe('GestureEngine — ignore()', () => {
  it('never starts tracking a pointer that ignore() rejects on pointerdown', () => {
    const callbacks = makeCallbacks();
    callbacks.ignore.mockReturnValue(true);
    new GestureEngine(target, callbacks, { lockThreshold: 10 });

    firePointer(target, 'pointerdown', { clientX: 0, timeStamp: 0 });
    firePointer(target, 'pointermove', { clientX: 50, timeStamp: 10 });
    firePointer(target, 'pointerup', { clientX: 50, timeStamp: 20 });

    expect(callbacks.onDragStart).not.toHaveBeenCalled();
    expect(callbacks.onTap).not.toHaveBeenCalled();
  });
});

describe('GestureEngine — pinch', () => {
  it('tracks two-pointer distance ratio as scale, and reports the midpoint as center', () => {
    const callbacks = makeCallbacks();
    new GestureEngine(target, callbacks, {});

    firePointer(target, 'pointerdown', {
      clientX: 0,
      clientY: 0,
      pointerId: 1,
      isPrimary: true,
      timeStamp: 0,
    });
    firePointer(target, 'pointerdown', {
      clientX: 100,
      clientY: 0,
      pointerId: 2,
      isPrimary: false,
      timeStamp: 0,
    });
    expect(callbacks.onPinchStart).toHaveBeenCalledWith(50, 0);

    // distance doubles: 100 -> 200
    firePointer(target, 'pointermove', { clientX: -50, clientY: 0, pointerId: 1, timeStamp: 10 });
    firePointer(target, 'pointermove', { clientX: 150, clientY: 0, pointerId: 2, timeStamp: 10 });
    expect(callbacks.onPinchMove).toHaveBeenLastCalledWith(2, 50, 0);

    firePointer(target, 'pointerup', { clientX: -50, clientY: 0, pointerId: 1, timeStamp: 20 });
    expect(callbacks.onPinchEnd).toHaveBeenCalledTimes(1);
  });

  it('suspends single-pointer drag tracking when a second pointer arrives mid-drag', () => {
    const callbacks = makeCallbacks();
    new GestureEngine(target, callbacks, { lockThreshold: 10 });

    firePointer(target, 'pointerdown', { clientX: 0, pointerId: 1, timeStamp: 0 });
    firePointer(target, 'pointermove', { clientX: 30, pointerId: 1, timeStamp: 10 });
    expect(callbacks.onDragStart).toHaveBeenCalledTimes(1);

    firePointer(target, 'pointerdown', {
      clientX: 100,
      pointerId: 2,
      isPrimary: false,
      timeStamp: 10,
    });
    expect(callbacks.onPinchStart).toHaveBeenCalledTimes(1);

    // releasing the original primary pointer now resolves through the pinch path, not a second onDragEnd
    firePointer(target, 'pointerup', { clientX: 30, pointerId: 1, timeStamp: 20 });
    expect(callbacks.onDragEnd).not.toHaveBeenCalled();
  });
});

describe('GestureEngine — wheel + ctrl', () => {
  it('reports onWheelZoom with a sign-flipped deltaScale only when ctrlKey is held', () => {
    const callbacks = makeCallbacks();
    new GestureEngine(target, callbacks, {});

    fireWheel(target, { deltaY: -10, ctrlKey: true, clientX: 3, clientY: 4 });
    expect(callbacks.onWheelZoom).toHaveBeenCalledWith(0.1, 3, 4, expect.anything());

    callbacks.onWheelZoom.mockClear();
    fireWheel(target, { deltaY: -10, ctrlKey: false });
    expect(callbacks.onWheelZoom).not.toHaveBeenCalled();
  });

  it('preventDefault()s a ctrl+wheel so the browser does not also zoom the page', () => {
    const callbacks = makeCallbacks();
    new GestureEngine(target, callbacks, {});

    const event = fireWheel(target, { deltaY: 5, ctrlKey: true });
    expect(event.defaultPrevented).toBe(true);
  });
});

describe('GestureEngine — pointer capture timing (DESIGN.md §2.4, "third real bug")', () => {
  it('does not capture the pointer on pointerdown alone', () => {
    const captureSpy = vi.spyOn(Element.prototype, 'setPointerCapture');
    const callbacks = makeCallbacks();
    new GestureEngine(target, callbacks, { lockThreshold: 10 });

    firePointer(target, 'pointerdown', { clientX: 0, timeStamp: 0 });

    expect(captureSpy).not.toHaveBeenCalled();
  });

  it('does not capture the pointer for a move that stays under lockThreshold (e.g. a plain tap)', () => {
    const captureSpy = vi.spyOn(Element.prototype, 'setPointerCapture');
    const callbacks = makeCallbacks();
    new GestureEngine(target, callbacks, { lockThreshold: 10 });

    firePointer(target, 'pointerdown', { clientX: 0, timeStamp: 0 });
    firePointer(target, 'pointermove', { clientX: 3, clientY: 0, timeStamp: 10 });
    firePointer(target, 'pointerup', { clientX: 3, clientY: 0, timeStamp: 20 });

    expect(captureSpy).not.toHaveBeenCalled();
  });

  it('captures the pointer only once direction actually locks (a real drag)', () => {
    const captureSpy = vi.spyOn(Element.prototype, 'setPointerCapture');
    const callbacks = makeCallbacks();
    new GestureEngine(target, callbacks, { lockThreshold: 10 });

    firePointer(target, 'pointerdown', { clientX: 0, timeStamp: 0 });
    expect(captureSpy).not.toHaveBeenCalled();

    firePointer(target, 'pointermove', { clientX: 20, clientY: 0, timeStamp: 10 }); // crosses lockThreshold
    expect(captureSpy).toHaveBeenCalledTimes(1);
    expect(captureSpy).toHaveBeenCalledWith(1);
  });

  it("skips capture entirely when shouldCapture() returns false — a locked drag whose effect a caller suppresses (the zoom plugin's pan) must not still trigger the same click-retargeting side effect", () => {
    const captureSpy = vi.spyOn(Element.prototype, 'setPointerCapture');
    const callbacks = makeCallbacks();
    callbacks.shouldCapture = vi.fn().mockReturnValue(false);
    new GestureEngine(target, callbacks, { lockThreshold: 10 });

    firePointer(target, 'pointerdown', { clientX: 0, timeStamp: 0 });
    firePointer(target, 'pointermove', { clientX: 20, clientY: 0, timeStamp: 10 }); // crosses lockThreshold

    expect(callbacks.onDragStart).toHaveBeenCalledTimes(1); // the drag itself still locks/reports normally
    expect(captureSpy).not.toHaveBeenCalled();
  });
});

describe('GestureEngine — destroy()', () => {
  it('stops responding to events after destroy()', () => {
    const callbacks = makeCallbacks();
    const engine = new GestureEngine(target, callbacks, { lockThreshold: 10 });
    engine.destroy();

    firePointer(target, 'pointerdown', { clientX: 0, timeStamp: 0 });
    firePointer(target, 'pointermove', { clientX: 50, timeStamp: 10 });
    firePointer(target, 'pointerup', { clientX: 50, timeStamp: 20 });
    fireWheel(target, { deltaY: -10, ctrlKey: true });

    expect(callbacks.onDragStart).not.toHaveBeenCalled();
    expect(callbacks.onWheelZoom).not.toHaveBeenCalled();
  });
});
