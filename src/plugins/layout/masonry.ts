/**
 * DESIGN.md §5.2 — deterministic, measure-free layout: positions come purely
 * from each tile's aspect ratio, never from measuring a loaded image (that's
 * exactly what causes the layout-jump problem most masonry libraries have).
 * Pure functions, no DOM — testable in isolation from rendering.
 */

export interface MasonryTile {
  /** Natural aspect ratio only — any unit works as long as width/height share one. */
  width: number;
  height: number;
}

export interface MasonryPosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MasonryOptions {
  containerWidth: number;
  /** Gap *between* columns (horizontal). */
  gutterX: number;
  /** Gap *between* tiles stacked within a column (vertical). */
  gutterY: number;
  columns: number | 'auto';
  columnWidth: number;
  minColumnWidth: number;
  maxColumnWidth: number;
  fill: 'shortest' | 'ordered';
}

export interface MasonryResult {
  positions: MasonryPosition[];
  columnCount: number;
  columnWidth: number;
  /** Per-column running height, incl. trailing gutterY — feed back in as `startHeights` to continue packing (e.g. an appended page) without relaying out earlier tiles. */
  columnHeights: number[];
  containerHeight: number;
}

/**
 * `'auto'` column count is `containerWidth / columnWidth`, floored — at odd
 * container widths that division can drift the *effective* per-column width
 * well past `columnWidth` before the count itself changes (e.g. 601px at a
 * 200px target floors to 3 columns of ~200px, but 999px floors to 4 columns
 * of ~250px). `minColumnWidth`/`maxColumnWidth` cap how far that drift goes
 * before the column count itself adjusts, so columns never go stringy-narrow
 * or stretch too wide at awkward container sizes. Only `gutterX` (the axis
 * columns are laid out along) factors into this — `gutterY` never affects
 * column count/width.
 */
export function computeColumnCount(options: MasonryOptions): number {
  const { containerWidth, gutterX, columns } = options;
  if (typeof columns === 'number') return Math.max(1, Math.floor(columns));

  const target = Math.max(
    1,
    Math.floor((containerWidth + gutterX) / (options.columnWidth + gutterX)),
  );
  const maxAllowedByMin = Math.max(
    1,
    Math.floor((containerWidth + gutterX) / (options.minColumnWidth + gutterX)),
  );
  const minRequiredByMax = Math.max(
    1,
    Math.ceil((containerWidth + gutterX) / (options.maxColumnWidth + gutterX)),
  );
  // minRequiredByMax can exceed maxAllowedByMin at a pathological config
  // (minColumnWidth > maxColumnWidth) — minRequiredByMax wins rather than
  // silently violating maxColumnWidth in that case.
  return Math.max(minRequiredByMax, Math.min(target, maxAllowedByMin));
}

export function computeColumnWidth(
  containerWidth: number,
  gutterX: number,
  columnCount: number,
): number {
  return (containerWidth - gutterX * (columnCount - 1)) / columnCount;
}

/**
 * Packs `tiles` into columns. `startHeights` (one entry per column, from a
 * previous `MasonryResult.columnHeights`) continues packing after already-
 * placed tiles instead of relaying out from scratch — this is what makes an
 * infinite-scroll append O(new items): earlier tiles' positions never change.
 */
export function layoutMasonry(
  tiles: readonly MasonryTile[],
  options: MasonryOptions,
  startHeights?: readonly number[],
): MasonryResult {
  const columnCount = computeColumnCount(options);
  const colWidth = computeColumnWidth(options.containerWidth, options.gutterX, columnCount);
  const columnHeights =
    startHeights && startHeights.length === columnCount
      ? [...startHeights]
      : new Array<number>(columnCount).fill(0);

  const positions: MasonryPosition[] = tiles.map((tile, i) => {
    const colIndex = options.fill === 'ordered' ? i % columnCount : indexOfShortest(columnHeights);
    const tileHeight = tile.width > 0 ? colWidth * (tile.height / tile.width) : colWidth;
    const x = colIndex * (colWidth + options.gutterX);
    const y = columnHeights[colIndex]!;
    columnHeights[colIndex] = y + tileHeight + options.gutterY;
    return { x, y, width: colWidth, height: tileHeight };
  });

  const containerHeight = tiles.length === 0 ? 0 : Math.max(...columnHeights) - options.gutterY;
  return { positions, columnCount, columnWidth: colWidth, columnHeights, containerHeight };
}

function indexOfShortest(heights: readonly number[]): number {
  let shortest = 0;
  for (let i = 1; i < heights.length; i++) {
    if (heights[i]! < heights[shortest]!) shortest = i;
  }
  return shortest;
}

export interface MasonryHorizontalOptions {
  containerWidth: number;
  /** Gap between tiles packed rightward within a row. */
  gutterX: number;
  /** Gap *between* rows (vertical). */
  gutterY: number;
  /** Every row's exact, fixed height — never scaled/solved-for (that's what distinguishes this from `justified`, whose row heights are the free variable it adjusts to make each row's width land exactly on `containerWidth`; here, height is the fixed input and width is left wherever a row's tiles naturally end). */
  rowHeight: number;
}

export interface MasonryHorizontalResult {
  positions: MasonryPosition[];
  rowCount: number;
  containerHeight: number;
}

/**
 * DESIGN.md §5.1 — packs tiles left-to-right into rows of `rowHeight` (each
 * tile scaled to that exact height at its own true aspect ratio, never
 * stretched/cropped), wrapping to a new row the moment the next tile would
 * push the current one past `containerWidth` — never stretching the
 * finished row to close the remaining gap. The result: every row is
 * *exactly* `rowHeight` tall (the fixed constraint), and every row's right
 * edge lands wherever its tiles' natural widths summed to (the free,
 * "ragged" one) — the direct masonry-family transpose of vertical masonry,
 * whose *columns* share a fixed width and whose ragged edge is the bottom.
 * `justified` (`justified.ts`) is the inverse tradeoff: width is the fixed
 * constraint (every row forced flush to `containerWidth`) and height is the
 * free variable solved per row to make that work.
 *
 * A single tile whose natural width at `rowHeight` alone already exceeds
 * `containerWidth` (a wide panorama) is still placed on its own row rather
 * than shrunk — nothing narrower to fall back to without violating the
 * fixed-height constraint, the same tradeoff `justified`'s `minRowHeight`
 * makes in its own analogous single-tile edge case.
 */
export function layoutMasonryHorizontal(
  tiles: readonly MasonryTile[],
  options: MasonryHorizontalOptions,
): MasonryHorizontalResult {
  const { containerWidth, gutterX, gutterY, rowHeight } = options;
  const positions: MasonryPosition[] = new Array(tiles.length);
  let currentY = 0;
  let rowStart = 0;
  let rowWidth = 0; // cumulative width of tiles committed to the current row so far, gutters included
  let rowCount = 0;

  function tileWidth(tile: MasonryTile): number {
    return tile.height > 0 ? rowHeight * (tile.width / tile.height) : rowHeight;
  }

  function placeRow(start: number, endExclusive: number): void {
    let x = 0;
    for (let i = start; i < endExclusive; i++) {
      const w = tileWidth(tiles[i]!);
      positions[i] = { x, y: currentY, width: w, height: rowHeight };
      x += w + gutterX;
    }
    rowCount++;
    currentY += rowHeight + gutterY;
  }

  for (let i = 0; i < tiles.length; i++) {
    const w = tileWidth(tiles[i]!);
    const countInRow = i - rowStart;
    const widthIfIncluded = rowWidth + (countInRow > 0 ? gutterX : 0) + w;
    if (countInRow > 0 && widthIfIncluded > containerWidth) {
      placeRow(rowStart, i); // finalize the row without tile i — it starts the next one instead
      rowStart = i;
      rowWidth = w;
    } else {
      rowWidth = widthIfIncluded;
    }
  }
  if (rowStart < tiles.length) placeRow(rowStart, tiles.length);

  const containerHeight = tiles.length === 0 ? 0 : currentY - gutterY;
  return { positions, rowCount, containerHeight };
}
