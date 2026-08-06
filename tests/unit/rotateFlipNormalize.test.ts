import { describe, expect, it } from 'vitest';
import { normalizeRotateFlip } from '../../src/core/rotateFlipNormalize';

describe('normalizeRotateFlip — DESIGN.md §8.1 table', () => {
  it.each([
    [0, 180],
    [90, 270],
    [180, 0],
    [270, 90],
  ])('flipH+flipV at rotation %i canonicalizes to no flips, rotation %i', (rot, expected) => {
    const result = normalizeRotateFlip({ flipH: true, flipV: true, rotation: rot });
    expect(result).toEqual({ flipH: false, flipV: false, rotation: expected });
  });

  it('leaves a single-axis flip untouched (only both-flipped collapses)', () => {
    expect(normalizeRotateFlip({ flipH: true, flipV: false, rotation: 90 })).toEqual({
      flipH: true,
      flipV: false,
      rotation: 90,
    });
    expect(normalizeRotateFlip({ flipH: false, flipV: true, rotation: 90 })).toEqual({
      flipH: false,
      flipV: true,
      rotation: 90,
    });
  });

  it('leaves no-flip states untouched aside from rotation normalization', () => {
    expect(normalizeRotateFlip({ flipH: false, flipV: false, rotation: 90 })).toEqual({
      flipH: false,
      flipV: false,
      rotation: 90,
    });
  });

  it('normalizes rotation to [0, 360) regardless of sign or magnitude', () => {
    expect(normalizeRotateFlip({ flipH: false, flipV: false, rotation: -90 }).rotation).toBe(270);
    expect(normalizeRotateFlip({ flipH: false, flipV: false, rotation: 450 }).rotation).toBe(90);
    expect(normalizeRotateFlip({ flipH: false, flipV: false, rotation: 720 }).rotation).toBe(0);
    expect(normalizeRotateFlip({ flipH: false, flipV: false, rotation: -450 }).rotation).toBe(270);
  });

  it('two different click sequences reaching an equivalent visual state normalize identically', () => {
    // Sequence A: rotate 90, then flip both axes.
    const a = normalizeRotateFlip({ flipH: true, flipV: true, rotation: 90 });
    // Sequence B: rotate 270 directly (the table's documented equivalent).
    const b = normalizeRotateFlip({ flipH: false, flipV: false, rotation: 270 });
    expect(a).toEqual(b);
  });
});
