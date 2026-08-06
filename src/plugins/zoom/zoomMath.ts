/** A viewport-relative rect: `{left, top, width, height}`, same shape as `DOMRect` but plain-object so it's trivial to mock in tests. */
export interface ZoomBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PanOffset {
  tx: number;
  ty: number;
}

export function clampScale(scale: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, scale));
}

/**
 * One axis of `clampPan` below. `natural*` is the element's own unscaled
 * rendered box (captured once at scale 1, before any transform — `apply()`
 * in `index.ts` renders `translate(tx, ty) scale(s)` with `transform-origin:
 * 0 0`, so the natural box's top-left is exactly where the scaled box's own
 * local origin sits on screen, and `tx`/`ty` are the *only* thing moving it
 * from there). If the scaled content is still smaller than the container on
 * this axis, no pan range can avoid a gap on *both* sides at once — centered
 * is the only sensible answer, not an inverted min>max range.
 */
function clampAxis(
  naturalPos: number,
  naturalSize: number,
  scale: number,
  containerPos: number,
  containerSize: number,
  offset: number,
): number {
  const scaledSize = naturalSize * scale;
  if (scaledSize <= containerSize) {
    return containerPos + (containerSize - scaledSize) / 2 - naturalPos;
  }
  const minPos = containerPos + containerSize - scaledSize;
  const maxPos = containerPos;
  const proposedPos = naturalPos + offset;
  return Math.min(maxPos, Math.max(minPos, proposedPos)) - naturalPos;
}

/** Keeps the scaled+panned content's edges from retreating inside `container`'s edges (no empty gap beyond the image), on both axes independently. */
export function clampPan(
  natural: ZoomBox,
  container: ZoomBox,
  scale: number,
  pan: PanOffset,
): PanOffset {
  return {
    tx: clampAxis(natural.left, natural.width, scale, container.left, container.width, pan.tx),
    ty: clampAxis(natural.top, natural.height, scale, container.top, container.height, pan.ty),
  };
}

/**
 * The standard "zoom toward a point" formula: adjusts pan so the viewport
 * point `(anchorX, anchorY)` stays visually fixed as scale changes from
 * `oldScale` to `newScale`, given `transform-origin: 0 0` (see `natural`'s
 * doc comment on `clampAxis` above for why that makes this tractable —
 * scaling never moves the natural box's own top-left on screen, only `pan`
 * does). Callers still need to clamp the result with `clampPan` afterward;
 * this only solves the anchor-fixed part, not boundary containment.
 */
export function zoomTowardPoint(
  natural: ZoomBox,
  pan: PanOffset,
  oldScale: number,
  newScale: number,
  anchorX: number,
  anchorY: number,
): PanOffset {
  const currentLeft = natural.left + pan.tx;
  const currentTop = natural.top + pan.ty;
  const dx = anchorX - currentLeft;
  const dy = anchorY - currentTop;
  const factor = 1 - newScale / oldScale;
  return {
    tx: pan.tx + dx * factor,
    ty: pan.ty + dy * factor,
  };
}
