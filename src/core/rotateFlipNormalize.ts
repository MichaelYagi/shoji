export interface RotateFlipState {
  flipH: boolean;
  flipV: boolean;
  /** Degrees; normalized to one of 0/90/180/270 by `normalizeRotateFlip`. */
  rotation: number;
}

/**
 * DESIGN.md §8.1's flip/rotation canonicalization table, verbatim — CLAUDE.md:
 * "Flip + rotate compose non-commutatively. Use the normalization table...
 * don't re-derive it." `flipH && flipV` is always visually equivalent to a
 * 180°-rotated state with neither flip set; this collapses any
 * `flipH`/`flipV`/`rotation` combination down to that canonical form, so two
 * states reached via different sequences of clicks compare equal and never
 * accumulate redundant flip+flip-again or unbounded rotation values.
 * Shared between the standalone rotate/flip *view* plugin (§4) and the
 * future Editor plugin (§8), which both need the identical composition —
 * not duplicated per-plugin.
 */
export function normalizeRotateFlip(state: RotateFlipState): RotateFlipState {
  const rotation = ((state.rotation % 360) + 360) % 360;
  if (state.flipH && state.flipV) {
    return { flipH: false, flipV: false, rotation: (rotation + 180) % 360 };
  }
  return { flipH: state.flipH, flipV: state.flipV, rotation };
}
