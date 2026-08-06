import { describe, expect, it } from 'vitest';
import { clampPan, clampScale, zoomTowardPoint } from '../../../src/plugins/zoom/zoomMath';

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
});
