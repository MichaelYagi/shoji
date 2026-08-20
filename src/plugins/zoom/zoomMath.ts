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

/** The 2x2 linear part of a CSS transform matrix — `{a, b, c, d}` from `matrix(a, b, c, d, e, f)`, translation (`e`/`f`) deliberately excluded, since everything below only ever uses this to remap a *delta* or a *local offset*, never an absolute position. */
export interface LinearTransform {
  a: number;
  b: number;
  c: number;
  d: number;
}

/** No parent transform — used as the default wherever a caller doesn't have (or need) one, so every function below stays backward-compatible with a pre-RotateFlip-aware caller. */
export const IDENTITY_TRANSFORM: LinearTransform = { a: 1, b: 0, c: 0, d: 1 };

/**
 * `getComputedStyle().transform`'s own `matrix(a, b, c, d, e, f)` (or
 * `none`) string, parsed by hand rather than via the `DOMMatrix`
 * constructor — jsdom (`tests/unit/`) doesn't implement it, so relying on
 * it broke every unit test that exercises a pan drag; a plain regex needs
 * nothing environment-specific and works identically in a real browser.
 * RotateFlip only ever emits a 2D `matrix(...)` (never `matrix3d(...)`),
 * so that's the only form handled — `none` and anything unparseable both
 * fall back to the identity matrix.
 */
export function parseLinearTransform(transform: string): LinearTransform {
  const match = /^matrix\(\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^,]+),/.exec(transform);
  if (!match) return { ...IDENTITY_TRANSFORM };
  return { a: Number(match[1]), b: Number(match[2]), c: Number(match[3]), d: Number(match[4]) };
}

/**
 * DESIGN.md §4.6 — a real bug, reported from real usage: dragging to pan a
 * zoomed photo that RotateFlip (§4.5) had also rotated moved it in the
 * *wrong* direction (e.g. dragging down moved the image sideways instead)
 * — `onPointerMove`'s raw `event.clientX/Y` delta (screen space) was being
 * applied directly as `pan.tx`/`ty` (the `<img>`'s own *local* space,
 * nested inside `.shoji-slide-media`), with nothing correcting for
 * whatever transform that parent has — RotateFlip's rotation, in this
 * case, but this doesn't need to know that specifically: it corrects for
 * *any* linear transform on the parent, read live off its own computed
 * style, not by reaching into RotateFlip.
 *
 * Standard 2x2 matrix inversion: for `M = [[a, c], [b, d]]`, `M⁻¹ =
 * 1/det * [[d, -c], [-b, a]]` — applying `M⁻¹` to a screen-space delta
 * converts it into the local space `M` itself maps *from*, which is
 * exactly what a child nested inside that transformed parent needs to
 * move by to track the pointer 1:1 on screen regardless of the parent's
 * own rotation/scale/flip. `det === 0` is a degenerate parent transform
 * (zero scale on some axis) that can't be un-done at all — returns the
 * raw delta unchanged rather than dividing by zero into `NaN`.
 */
export function screenDeltaToLocal(dx: number, dy: number, m: LinearTransform): PanOffset {
  const det = m.a * m.d - m.b * m.c;
  if (det === 0) return { tx: dx, ty: dy };
  return {
    tx: (m.d * dx - m.c * dy) / det,
    ty: (m.a * dy - m.b * dx) / det,
  };
}

/** The forward companion to `screenDeltaToLocal` above: `M * [dx; dy]`, converting a *local* delta into the screen-space delta it produces once composed through the parent's current transform `m`. */
export function localDeltaToScreen(dx: number, dy: number, m: LinearTransform): PanOffset {
  return { tx: m.a * dx + m.c * dy, ty: m.b * dx + m.d * dy };
}

/**
 * DESIGN.md §4.6 — the img's own true, *unrotated* layout size (its
 * `offsetWidth`/`offsetHeight` — CSS `transform` is paint-only and never
 * affects these, unlike `natural`'s own `getBoundingClientRect()`, which
 * *does* reflect the parent's current rotation) as an offset from the
 * img's own local origin `(0, 0)` to its own layout center, negated:
 * `{tx: -width/2, ty: -height/2}`. See `localOriginScreen`'s own doc
 * comment for why this specific offset is what a rotated parent needs.
 * Defaults to deriving it from `natural` itself (assuming `natural` *is*
 * already the true, unrotated size) — correct whenever the parent has no
 * rotation, wrong whenever it does; real callers with a possibly-rotated
 * parent should always pass the img's real `offsetWidth`/`offsetHeight`
 * explicitly instead of relying on this default.
 */
export function trueOriginOffset(natural: ZoomBox): PanOffset {
  return { tx: -natural.width / 2, ty: -natural.height / 2 };
}

/**
 * DESIGN.md §4.6 — a real bug, found immediately after the pan-drag fix
 * above while testing the analogous double-click-to-zoom case: `natural`'s
 * own `left`/`top` (from `getBoundingClientRect()` on the *rotated* img)
 * is **not** the screen position of the img's local origin `(0, 0)` —
 * rotating a rectangle moves *which of its own corners* ends up at the
 * bounding box's own top-left. For a 90°-rotated landscape photo, the
 * corner that lands at `natural`'s own top-left is the photo's original
 * *bottom*-left, not its top-left — confirmed directly, by hand, against
 * real `getBoundingClientRect()` numbers: treating `natural.left + pan.tx`
 * as "the origin's screen position" (what `zoomTowardPoint`/`clampPan`
 * both did) was off by the img's own full width on one axis, which is
 * exactly why double-clicking to zoom toward the pointer, after a
 * rotation, zoomed toward the wrong point instead — sometimes a
 * plausible-looking wrong point, sometimes (as reported) toward an edge
 * of the image instead of the actual click.
 *
 * The one point immune to this ambiguity is the bounding box's own
 * *center* — rotating a rectangle around its own center (the default
 * `transform-origin`, and where `.shoji-slide-media`'s flex-centering
 * already puts the img) never moves that center, on screen or off. Used
 * as a pivot: the img's local origin, relative to its own *true* (layout,
 * pre-rotation) center, is a fixed offset (`originOffset`, `-width/2,
 * -height/2` in the img's own local space) — that offset plus the current
 * `pan`, mapped through the parent's rotation matrix `m` and added back to
 * the pivot's own (rotation-invariant) screen position, gives the origin's
 * *real* current screen position, correct for any axis-aligned rotation
 * RotateFlip can produce. At the default identity `m` and the default
 * `originOffset` (derived from `natural` itself, correct exactly when
 * there's no rotation to begin with), this reduces to plain
 * `natural.left + pan.tx` — the original, pre-fix formula.
 */
export function localOriginScreen(
  natural: ZoomBox,
  pan: PanOffset,
  m: LinearTransform = IDENTITY_TRANSFORM,
  originOffset: PanOffset = trueOriginOffset(natural),
): { x: number; y: number } {
  const pivotX = natural.left + natural.width / 2;
  const pivotY = natural.top + natural.height / 2;
  const fromPivot = localDeltaToScreen(originOffset.tx + pan.tx, originOffset.ty + pan.ty, m);
  return { x: pivotX + fromPivot.tx, y: pivotY + fromPivot.ty };
}

/** One axis of `clampEdgeToContainer` below — see `clampPan`'s own doc comment for the geometry. Keeps the scaled content's edge from retreating inside the container's edge (no empty gap beyond the image); when the content is already smaller than the container on this axis, no position can avoid a gap on *both* sides at once, so centered is the only sensible answer. */
function clampEdge(
  contentPos: number,
  contentSize: number,
  containerPos: number,
  containerSize: number,
): number {
  if (contentSize <= containerSize) {
    return containerPos + (containerSize - contentSize) / 2;
  }
  const minPos = containerPos + containerSize - contentSize;
  const maxPos = containerPos;
  return Math.min(maxPos, Math.max(minPos, contentPos));
}

/**
 * The content's own current screen-space bounding box, for `clampPan`
 * below — the four corners of the img's true (unrotated) `width x height`
 * rect (from `originOffset`, negated), scaled and panned in the wrapper's
 * own unrotated frame, then each mapped to screen space individually via
 * `m` before taking the min/max. Four corners, not one edge scaled
 * directly, because `m` can swap which axis grows with which — RotateFlip
 * only ever produces axis-aligned (90°-multiple) rotations, so the result
 * is still a plain axis-aligned box, just not derivable from a single
 * corner the way an unrotated one is.
 */
function contentScreenBounds(
  natural: ZoomBox,
  pan: PanOffset,
  scale: number,
  m: LinearTransform,
  originOffset: PanOffset,
): { left: number; top: number; right: number; bottom: number } {
  const trueWidth = -originOffset.tx * 2;
  const trueHeight = -originOffset.ty * 2;
  const pivotX = natural.left + natural.width / 2;
  const pivotY = natural.top + natural.height / 2;
  const localCorners = [
    { x: 0, y: 0 },
    { x: trueWidth, y: 0 },
    { x: 0, y: trueHeight },
    { x: trueWidth, y: trueHeight },
  ];
  const screenCorners = localCorners.map(({ x, y }) => {
    const wrapperFrame = {
      x: originOffset.tx + pan.tx + x * scale,
      y: originOffset.ty + pan.ty + y * scale,
    };
    const screen = localDeltaToScreen(wrapperFrame.x, wrapperFrame.y, m);
    return { x: pivotX + screen.tx, y: pivotY + screen.ty };
  });
  const xs = screenCorners.map((p) => p.x);
  const ys = screenCorners.map((p) => p.y);
  return {
    left: Math.min(...xs),
    top: Math.min(...ys),
    right: Math.max(...xs),
    bottom: Math.max(...ys),
  };
}

/**
 * Keeps the scaled+panned content's edges from retreating inside
 * `container`'s edges (no empty gap beyond the image), on both screen axes
 * independently.
 *
 * `m`/`originOffset` (default identity / derived from `natural`, DESIGN.md
 * §4.6) — same real bug and same root cause as `localOriginScreen`'s own
 * doc comment: the old per-axis formula compared `natural.left + pan.tx`
 * (mixing screen-space and, once rotated, the wrong corner entirely)
 * against the container's screen bounds. The content's actual screen
 * bounding box is computed properly via `contentScreenBounds` (which
 * itself only ever needs `m`/`originOffset` to do that correctly), each
 * edge is clamped against the container the same way as before, and the
 * *difference* — a screen-space delta — is mapped back to local space and
 * folded into `pan`. At the defaults, every step is a no-op and this
 * reduces to exactly the original per-axis formula.
 */
export function clampPan(
  natural: ZoomBox,
  container: ZoomBox,
  scale: number,
  pan: PanOffset,
  m: LinearTransform = IDENTITY_TRANSFORM,
  originOffset: PanOffset = trueOriginOffset(natural),
): PanOffset {
  const bounds = contentScreenBounds(natural, pan, scale, m, originOffset);
  const clampedLeft = clampEdge(
    bounds.left,
    bounds.right - bounds.left,
    container.left,
    container.width,
  );
  const clampedTop = clampEdge(
    bounds.top,
    bounds.bottom - bounds.top,
    container.top,
    container.height,
  );
  const screenDelta = { tx: clampedLeft - bounds.left, ty: clampedTop - bounds.top };
  const localDelta = screenDeltaToLocal(screenDelta.tx, screenDelta.ty, m);
  return { tx: pan.tx + localDelta.tx, ty: pan.ty + localDelta.ty };
}

/**
 * The standard "zoom toward a point" formula: adjusts pan so the viewport
 * point `(anchorX, anchorY)` stays visually fixed as scale changes from
 * `oldScale` to `newScale`, given `transform-origin: 0 0` (scaling never
 * moves the img's own local origin on screen, only `pan` does). Callers
 * still need to clamp the result with `clampPan` afterward; this only
 * solves the anchor-fixed part, not boundary containment.
 *
 * `m`/`originOffset` (default identity / derived from `natural`, DESIGN.md
 * §4.6) — a real bug, reported from real usage: double-clicking to zoom
 * toward the pointer, after RotateFlip had rotated the slide, zoomed
 * toward the wrong point — sometimes badly (see `localOriginScreen`'s own
 * doc comment for the root cause and how these two parameters fix it,
 * shared with `clampPan` above). At the defaults, every step is a no-op
 * and this reduces to exactly the original formula.
 */
export function zoomTowardPoint(
  natural: ZoomBox,
  pan: PanOffset,
  oldScale: number,
  newScale: number,
  anchorX: number,
  anchorY: number,
  m: LinearTransform = IDENTITY_TRANSFORM,
  originOffset: PanOffset = trueOriginOffset(natural),
): PanOffset {
  const origin = localOriginScreen(natural, pan, m, originOffset);
  const screenDx = anchorX - origin.x;
  const screenDy = anchorY - origin.y;
  const local = screenDeltaToLocal(screenDx, screenDy, m);
  const factor = 1 - newScale / oldScale;
  return {
    tx: pan.tx + local.tx * factor,
    ty: pan.ty + local.ty * factor,
  };
}
