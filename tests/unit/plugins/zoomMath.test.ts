import { describe, expect, it } from 'vitest';
import {
  clampPan,
  clampScale,
  localDeltaToScreen,
  parseLinearTransform,
  screenDeltaToLocal,
  zoomTowardPoint,
} from '../../../src/plugins/zoom/zoomMath';

describe('zoomMath — clampScale', () => {
  it('passes values already within range through unchanged', () => {
    expect(clampScale(2, 1, 4)).toBe(2);
  });

  it('clamps below the minimum', () => {
    expect(clampScale(0.5, 1, 4)).toBe(1);
  });

  it('clamps above the maximum', () => {
    expect(clampScale(10, 1, 4)).toBe(4);
  });
});

describe('zoomMath — clampPan', () => {
  const container = { left: 0, top: 0, width: 400, height: 300 };

  it('centers (no pan) when the scaled content is still smaller than the container on both axes', () => {
    const natural = { left: 50, top: 50, width: 200, height: 100 };
    const result = clampPan(natural, container, 1.5, { tx: 999, ty: 999 });
    // scaledWidth = 300 <= 400, scaledHeight = 150 <= 300 — both centered
    expect(result.tx).toBeCloseTo(0 + (400 - 300) / 2 - 50); // containerLeft + (containerW-scaledW)/2 - naturalLeft
    expect(result.ty).toBeCloseTo(0 + (300 - 150) / 2 - 50);
  });

  it('passes an in-bounds offset through unchanged once the content overflows the container', () => {
    const natural = { left: 0, top: 0, width: 400, height: 300 };
    // scale 2 -> scaled size 800x600, well past the 400x300 container
    const result = clampPan(natural, container, 2, { tx: -100, ty: -50 });
    expect(result.tx).toBeCloseTo(-100);
    expect(result.ty).toBeCloseTo(-50);
  });

  it('clamps so the left/top edge never retreats inside the container (pushed far right/down)', () => {
    const natural = { left: 0, top: 0, width: 400, height: 300 };
    // scale 2 -> scaled 800x600; pushing tx way positive drags the left
    // edge past the container's left edge — must clamp to maxPos (0).
    const result = clampPan(natural, container, 2, { tx: 1000, ty: 1000 });
    expect(result.tx).toBeCloseTo(0);
    expect(result.ty).toBeCloseTo(0);
  });

  it('clamps so the right/bottom edge never retreats inside the container (pushed far left/up)', () => {
    const natural = { left: 0, top: 0, width: 400, height: 300 };
    const result = clampPan(natural, container, 2, { tx: -5000, ty: -5000 });
    // minLeft = containerLeft + containerWidth - scaledWidth = 0+400-800 = -400
    expect(result.tx).toBeCloseTo(-400);
    expect(result.ty).toBeCloseTo(300 - 600);
  });

  it('regression: still keeps a screen-space edge from retreating inside the container once RotateFlip has rotated the parent', () => {
    // Same "pushed far right/down" scenario as above, but with a 90deg
    // rotation on the parent — before the pivot/trueSize fix, clampAxis
    // compared natural.left + pan.tx (a local-space value) directly
    // against container.left (screen space), which is only meaningful
    // with no rotation; here it must clamp the img's actual *screen*
    // bounding box against the container instead.
    const natural = { left: 0, top: 0, width: 400, height: 300 };
    const m = { a: 0, b: 1, c: -1, d: 0 }; // rotate(90deg)
    const result = clampPan(natural, container, 2, { tx: 1000, ty: 1000 }, m);

    // Independently recompute the resulting screen-space bounding box
    // (same 4-corner approach the implementation uses, but assembled
    // fresh from localDeltaToScreen rather than by calling clampPan's own
    // internal helper) and assert it never pokes outside the container.
    const originOffset = { tx: -natural.width / 2, ty: -natural.height / 2 };
    const pivotX = natural.left + natural.width / 2;
    const pivotY = natural.top + natural.height / 2;
    const corners = [
      { x: 0, y: 0 },
      { x: natural.width, y: 0 },
      { x: 0, y: natural.height },
      { x: natural.width, y: natural.height },
    ].map(({ x, y }) => {
      const wrapperFrame = {
        x: originOffset.tx + result.tx + x * 2,
        y: originOffset.ty + result.ty + y * 2,
      };
      const screen = localDeltaToScreen(wrapperFrame.x, wrapperFrame.y, m);
      return { x: pivotX + screen.tx, y: pivotY + screen.ty };
    });
    const left = Math.min(...corners.map((p) => p.x));
    const top = Math.min(...corners.map((p) => p.y));
    const right = Math.max(...corners.map((p) => p.x));
    const bottom = Math.max(...corners.map((p) => p.y));

    // A 90deg rotation swaps which local axis (width vs height) lands on
    // which screen axis, so the scaled content's screen bounding box here
    // is 600x800 (height*scale x width*scale), not 800x600 — and a pan
    // pushed "far positive" no longer necessarily means "far toward the
    // container's max edge" once the parent is rotated, the same way it
    // does with no rotation. So rather than assume which specific edge
    // the clamp pins (direction-dependent on the rotation), assert the
    // actual invariant clampPan exists to guarantee: the content is
    // exactly as large as it is (unclipped) and never leaves a gap
    // between its near edge and the container's near edge on an axis it
    // overflows.
    expect(right - left).toBeCloseTo(600); // height(300) * scale(2)
    expect(bottom - top).toBeCloseTo(800); // width(400) * scale(2)
    expect(left).toBeGreaterThanOrEqual(container.left - 400); // minPos = 0+400-600
    expect(left).toBeLessThanOrEqual(container.left);
    expect(top).toBeGreaterThanOrEqual(container.top - 500); // minPos = 0+300-800
    expect(top).toBeLessThanOrEqual(container.top);

    // Idempotent: an already-clamped pan is left unchanged by clamping again.
    const reclamped = clampPan(natural, container, 2, result, m);
    expect(reclamped.tx).toBeCloseTo(result.tx);
    expect(reclamped.ty).toBeCloseTo(result.ty);
  });
});

describe('zoomMath — zoomTowardPoint', () => {
  it('keeps the anchor point visually fixed when zooming in', () => {
    const natural = { left: 100, top: 50, width: 200, height: 100 };
    // anchor at the natural box's own center
    const result = zoomTowardPoint(natural, { tx: 0, ty: 0 }, 1, 2, 200, 100);
    expect(result.tx).toBeCloseTo(-100);
    expect(result.ty).toBeCloseTo(-50);

    // verify: at the new scale/pan, the anchor's local point maps back to the same screen position
    const oldCurrentLeft = natural.left + 0;
    const localX = (200 - oldCurrentLeft) / 1;
    const newCurrentLeft = natural.left + result.tx;
    expect(newCurrentLeft + localX * 2).toBeCloseTo(200);
  });

  it('reverses correctly when zooming back out from the same anchor', () => {
    const natural = { left: 100, top: 50, width: 200, height: 100 };
    const zoomedIn = zoomTowardPoint(natural, { tx: 0, ty: 0 }, 1, 2, 200, 100);
    const zoomedOut = zoomTowardPoint(natural, zoomedIn, 2, 1, 200, 100);
    expect(zoomedOut.tx).toBeCloseTo(0);
    expect(zoomedOut.ty).toBeCloseTo(0);
  });

  it('an anchor at the natural box origin never shifts pan (degenerate case)', () => {
    const natural = { left: 100, top: 50, width: 200, height: 100 };
    const result = zoomTowardPoint(natural, { tx: 0, ty: 0 }, 1, 3, 100, 50);
    expect(result.tx).toBeCloseTo(0);
    expect(result.ty).toBeCloseTo(0);
  });

  it("regression: still keeps the anchor point visually fixed once RotateFlip has rotated the parent — before this fix, natural.left + pan.tx was treated as the img's local-origin screen position, which only holds with no parent rotation; under rotation a *different* corner of the img lands at natural's own top-left", () => {
    const natural = { left: 100, top: 50, width: 200, height: 100 };
    const pan = { tx: 15, ty: -8 };
    const oldScale = 1.4;
    const newScale = 2.6;
    const anchorX = 260;
    const anchorY = 130;
    const m = { a: 0, b: 1, c: -1, d: 0 }; // rotate(90deg)

    const result = zoomTowardPoint(natural, pan, oldScale, newScale, anchorX, anchorY, m);

    // Recompute, independently of zoomTowardPoint's own implementation,
    // where the *content point* that was under the anchor before ends up
    // after — this is the actual definition of "the anchor stayed fixed",
    // not just a snapshot of some particular tx/ty this implementation
    // happens to produce. Uses the bounding box's own center as the
    // reference (rotation-invariant, unlike natural.left/top) plus the
    // img's own local origin offset from that center — the same
    // pivot-based geometry the fix itself relies on, but assembled fresh
    // here from the independently-tested screenDeltaToLocal/
    // localDeltaToScreen primitives rather than by calling any helper
    // zoomTowardPoint itself uses internally.
    const pivotX = natural.left + natural.width / 2;
    const pivotY = natural.top + natural.height / 2;
    const originOffset = { tx: -natural.width / 2, ty: -natural.height / 2 };
    function originScreen(p: { tx: number; ty: number }): { x: number; y: number } {
      const fromPivot = localDeltaToScreen(originOffset.tx + p.tx, originOffset.ty + p.ty, m);
      return { x: pivotX + fromPivot.tx, y: pivotY + fromPivot.ty };
    }

    const originBefore = originScreen(pan);
    const localOffsetBefore = screenDeltaToLocal(
      anchorX - originBefore.x,
      anchorY - originBefore.y,
      m,
    );
    const contentPoint = { x: localOffsetBefore.tx / oldScale, y: localOffsetBefore.ty / oldScale };

    const originAfter = originScreen(result);
    const screenOffsetAfter = localDeltaToScreen(
      contentPoint.x * newScale,
      contentPoint.y * newScale,
      m,
    );

    expect(originAfter.x + screenOffsetAfter.tx).toBeCloseTo(anchorX);
    expect(originAfter.y + screenOffsetAfter.ty).toBeCloseTo(anchorY);
  });

  it('regression: accounts for the true unrotated img size when it differs from the (rotated) natural bounding box — a 90deg rotation swaps which axis natural.width/height report', () => {
    // A landscape 800x600 img, rotated 90deg, reports a 600x800 (portrait-
    // shaped) getBoundingClientRect — natural.width/height alone can't be
    // used as the img's true local size once rotated; originOffset must
    // be derived from the img's real (unrotated) offsetWidth/offsetHeight
    // instead, exactly as index.ts's ensureNatural now does.
    const natural = { left: 200, top: 0, width: 600, height: 800 }; // rotated bounding box
    const m = { a: 0, b: 1, c: -1, d: 0 }; // rotate(90deg)
    const originOffset = { tx: -400, ty: -300 }; // true size 800x600, halved+negated
    const pan = { tx: 0, ty: 0 };
    const anchorX = 380;
    const anchorY = 240;

    const result = zoomTowardPoint(natural, pan, 1, 2, anchorX, anchorY, m, originOffset);

    // Independently verify the anchor invariant using the same pivot
    // geometry as the test above, but with the true (swapped) originOffset.
    const pivotX = natural.left + natural.width / 2;
    const pivotY = natural.top + natural.height / 2;
    function originScreen(p: { tx: number; ty: number }): { x: number; y: number } {
      const fromPivot = localDeltaToScreen(originOffset.tx + p.tx, originOffset.ty + p.ty, m);
      return { x: pivotX + fromPivot.tx, y: pivotY + fromPivot.ty };
    }

    const originBefore = originScreen(pan);
    const localOffsetBefore = screenDeltaToLocal(
      anchorX - originBefore.x,
      anchorY - originBefore.y,
      m,
    );

    const originAfter = originScreen(result);
    const screenOffsetAfter = localDeltaToScreen(
      localOffsetBefore.tx * 2,
      localOffsetBefore.ty * 2,
      m,
    );

    expect(originAfter.x + screenOffsetAfter.tx).toBeCloseTo(anchorX);
    expect(originAfter.y + screenOffsetAfter.ty).toBeCloseTo(anchorY);

    // And confirm this differs meaningfully from what naively using
    // natural.width/height as the true size (the pre-fix assumption)
    // would have produced — proof this test would have caught the bug.
    const naiveResult = zoomTowardPoint(natural, pan, 1, 2, anchorX, anchorY, m);
    expect(naiveResult.tx).not.toBeCloseTo(result.tx);
  });

  it('an identity parent transform (the default) reproduces the exact original, no-rotation formula', () => {
    const natural = { left: 100, top: 50, width: 200, height: 100 };
    const withDefault = zoomTowardPoint(natural, { tx: 0, ty: 0 }, 1, 2, 200, 100);
    const withExplicitIdentity = zoomTowardPoint(natural, { tx: 0, ty: 0 }, 1, 2, 200, 100, {
      a: 1,
      b: 0,
      c: 0,
      d: 1,
    });
    expect(withExplicitIdentity).toEqual(withDefault);
  });
});

describe('zoomMath — screenDeltaToLocal', () => {
  it('an identity parent transform passes the screen delta through unchanged', () => {
    const result = screenDeltaToLocal(30, -20, { a: 1, b: 0, c: 0, d: 1 });
    expect(result.tx).toBeCloseTo(30);
    expect(result.ty).toBeCloseTo(-20);
  });

  it("regression: a 90deg-rotated parent (RotateFlip) no longer applies the drag along the wrong screen axis — matrix(0, 1, -1, 0, ...) is CSS's own rotate(90deg), read live off the parent's computed style, not derived from RotateFlip's own state", () => {
    // Dragging straight down on screen (dx=0, dy=10) must translate the
    // <img> along its own local x-axis once nested inside a 90deg-rotated
    // parent — that's what makes the image visually continue moving
    // *down* on screen despite the parent's rotation. Before this fix, the
    // raw screen delta was applied directly as the local translate, which
    // moved the image sideways instead of down.
    const result = screenDeltaToLocal(0, 10, { a: 0, b: 1, c: -1, d: 0 });
    expect(result.tx).toBeCloseTo(10);
    expect(result.ty).toBeCloseTo(0);
  });

  it('a horizontally flipped parent (scaleX(-1)) still tracks a rightward screen drag rightward on screen', () => {
    // scaleX(-1) alone: matrix(-1, 0, 0, 1, ...).
    const result = screenDeltaToLocal(10, 0, { a: -1, b: 0, c: 0, d: 1 });
    // The local delta is mirrored (-10)...
    expect(result.tx).toBeCloseTo(-10);
    // ...which, composed back through the same scaleX(-1) parent, lands
    // the <img> exactly 10px further right on screen — the parent's own
    // mirror and the local mirror cancel out to the correct screen result.
  });

  it('a degenerate parent transform (zero determinant) falls back to the raw delta instead of dividing by zero', () => {
    const result = screenDeltaToLocal(15, -5, { a: 0, b: 0, c: 0, d: 0 });
    expect(result.tx).toBe(15);
    expect(result.ty).toBe(-5);
  });
});

describe('zoomMath — parseLinearTransform', () => {
  it("'none' parses as the identity matrix", () => {
    expect(parseLinearTransform('none')).toEqual({ a: 1, b: 0, c: 0, d: 1 });
  });

  it('parses a real matrix(a, b, c, d, e, f) string, ignoring translation', () => {
    expect(parseLinearTransform('matrix(0, 1, -1, 0, 12.5, -7)')).toEqual({
      a: 0,
      b: 1,
      c: -1,
      d: 0,
    });
  });

  it('an unparseable string (e.g. matrix3d, not emitted by RotateFlip but defensive anyway) falls back to identity rather than NaN', () => {
    expect(parseLinearTransform('matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1)')).toEqual({
      a: 1,
      b: 0,
      c: 0,
      d: 1,
    });
  });
});
