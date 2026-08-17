/**
 * DESIGN.md §5.2 — Flickr/Google-Photos-style row filler: tiles are grouped
 * into rows, each row scaled as a whole (every tile in it keeps its own
 * aspect ratio, only the shared row height changes) until the row's total
 * width exactly matches the container — the opposite visual signature from
 * masonry: row *right edges* line up flush, row *heights* vary instead of
 * column bottoms varying. Pure, no DOM — same shape/testing pattern as
 * masonry.ts.
 */

export interface JustifiedTile {
  width: number;
  height: number;
}

export interface JustifiedPosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface JustifiedOptions {
  containerWidth: number;
  /** Gap between tiles within a row (horizontal). */
  gutterX: number;
  /** Gap *between* rows (vertical). */
  gutterY: number;
  /** Target row height — rows are greedily filled until adding the next tile would exceed containerWidth at this height, then the whole row is rescaled to fit exactly (so actual row heights end up *near*, not always exactly at, this value). */
  rowHeight: number;
  /**
   * Bounds on a row's *scaled* (fill-the-container) height — an unusual mix
   * of aspect ratios (very few tiles, or very narrow/wide ones, e.g. a lone
   * portrait tile stretched to fill the container width under
   * `lastRow: 'justify'`) can otherwise scale a row to an extreme height.
   * `maxRowHeight` clamping means that row no longer exactly fills
   * `containerWidth` at its capped height — it falls short of the right
   * edge instead, the same tradeoff masonry's `maxColumnWidth` already
   * makes for the analogous reason. `minRowHeight` never causes that kind
   * of overflow, though, unlike a naive clamp would: a row that would need
   * to go below `minRowHeight` to fit exactly instead sheds tiles off its
   * end (rolled into the next row) until what's left *does* fit at
   * `minRowHeight` — rows never extend past `containerWidth`. The one
   * unavoidable exception is a single tile so wide/panoramic that even
   * alone it can't satisfy both bounds at once (`minRowHeight` at its own
   * aspect ratio is inherently wider than the container) — there,
   * `minRowHeight` itself yields rather than the row overflowing. Neither
   * bound applies to `lastRow: 'left'`, which already uses `rowHeight` as
   * a fixed, unscaled height rather than deriving one (and, being the
   * left-over *under*-full case by definition, never overflows either).
   */
  minRowHeight: number;
  maxRowHeight: number;
  /** How to handle the trailing row when there aren't enough tiles left to naturally reach containerWidth: 'justify' stretches it like any other row (Flickr-style — the default); 'left' keeps it at natural rowHeight-scaled size, left-aligned, empty space on the right; 'hide' excludes it from `positions` (returned as `null`) entirely. */
  lastRow: 'justify' | 'left' | 'hide';
}

export interface JustifiedRow {
  /** Tile index range finalized into this row, `[start, end)`. */
  start: number;
  end: number;
  y: number;
  height: number;
}

export interface JustifiedResult {
  /** One entry per input tile, same order — `null` only for a `lastRow: 'hide'`-excluded trailing tile. */
  positions: Array<JustifiedPosition | null>;
  containerHeight: number;
  /** One entry per finalized row, in order — lets a caller find which tiles landed on the same row (e.g. to decide where a compact section label belongs) without re-deriving it from `positions[i].y` equality. */
  rows: JustifiedRow[];
}

function aspectRatioOf(tile: JustifiedTile): number {
  return tile.width > 0 && tile.height > 0 ? tile.width / tile.height : 1;
}

export function layoutJustified(
  tiles: readonly JustifiedTile[],
  options: JustifiedOptions,
): JustifiedResult {
  const { containerWidth, gutterX, gutterY, rowHeight, minRowHeight, maxRowHeight, lastRow } =
    options;
  const positions: Array<JustifiedPosition | null> = new Array(tiles.length).fill(null);
  const rows: JustifiedRow[] = [];
  let currentY = 0;
  let rowStart = 0;
  let aspectSum = 0;

  function naturalHeightOf(startIndex: number, endExclusive: number, sum: number): number {
    const availableWidth = containerWidth - gutterX * (endExclusive - startIndex - 1);
    return availableWidth / sum;
  }

  function placeRow(startIndex: number, endExclusive: number, height: number): void {
    let x = 0;
    for (let i = startIndex; i < endExclusive; i++) {
      const width = height * aspectRatioOf(tiles[i]!);
      positions[i] = { x, y: currentY, width, height };
      x += width + gutterX;
    }
    rows.push({ start: startIndex, end: endExclusive, y: currentY, height });
    currentY += height + gutterY;
  }

  /**
   * Resolves `[startIndex, endExclusive)` (whose combined aspect ratio is
   * `sum`) into its final row, shedding tiles off the end — rolled into
   * whatever comes after — if honoring `minRowHeight` would otherwise push
   * this row's width past `containerWidth`. Returns the `endExclusive`
   * actually used, so the caller knows how many tiles (if any) got rolled
   * over and need to start the next row instead.
   */
  function resolveScaledRow(startIndex: number, endExclusive: number, sum: number): number {
    let end = endExclusive;
    let rowSum = sum;
    let yieldMinRowHeight = false;
    while (end - startIndex > 1 && naturalHeightOf(startIndex, end, rowSum) < minRowHeight) {
      // A real bug, reported from real usage: shedding the trailing tile
      // down to exactly one remaining tile only helps if that lone tile's
      // own natural height doesn't itself need `maxRowHeight` to clamp it
      // — otherwise shedding trades an under-`minRowHeight` row (merely a
      // bit short) for one that instead falls short of the *right edge*
      // (a visible gap, this file's own `maxRowHeight` tradeoff above) —
      // strictly worse, for nothing. Confirmed directly: a lone square
      // tile sandwiched between two wider neighbors landed exactly here.
      // Keep the wider grouping instead and let `minRowHeight` yield for
      // it too, same precedent the single-super-wide-tile case below
      // already establishes.
      if (end - startIndex === 2) {
        const soloNatural = naturalHeightOf(
          startIndex,
          startIndex + 1,
          aspectRatioOf(tiles[startIndex]!),
        );
        if (soloNatural > maxRowHeight) {
          yieldMinRowHeight = true;
          break;
        }
      }
      end--;
      rowSum -= aspectRatioOf(tiles[end]!);
    }
    const natural = naturalHeightOf(startIndex, end, rowSum);
    // Down to one tile and *still* under minRowHeight: that single tile's
    // own aspect ratio makes minRowHeight-at-full-width inherently wider
    // than the container — nothing left to shed, so minRowHeight yields
    // (the natural height keeps width exactly at containerWidth) rather
    // than ever letting the row overflow. `yieldMinRowHeight` extends the
    // same yield to the lone-tile-would-gap case just above.
    const height =
      (end - startIndex === 1 || yieldMinRowHeight) && natural < minRowHeight
        ? natural
        : Math.min(Math.max(natural, minRowHeight), maxRowHeight);
    placeRow(startIndex, end, height);
    return end;
  }

  for (let i = 0; i < tiles.length; i++) {
    aspectSum += aspectRatioOf(tiles[i]!);
    const count = i - rowStart + 1;
    const widthAtTargetHeight = rowHeight * aspectSum + gutterX * (count - 1);
    if (widthAtTargetHeight >= containerWidth) {
      const end = resolveScaledRow(rowStart, i + 1, aspectSum);
      rowStart = end;
      aspectSum = 0;
      for (let j = end; j <= i; j++) aspectSum += aspectRatioOf(tiles[j]!); // rolled-over tiles seed the next row
    }
  }

  if (rowStart < tiles.length) {
    if (lastRow === 'justify') {
      // resolveScaledRow can itself shed tiles (the same overflow-avoidance
      // as the main loop above) — unlike there, there's no "next row" this
      // far down for the outer loop to naturally roll them into, so keep
      // resolving whatever's left until every trailing tile lands
      // somewhere. Always makes forward progress (resolveScaledRow places
      // at least one tile per call), so this always terminates.
      let start = rowStart;
      while (start < tiles.length) {
        let sum = 0;
        for (let j = start; j < tiles.length; j++) sum += aspectRatioOf(tiles[j]!);
        start = resolveScaledRow(start, tiles.length, sum);
      }
    } else if (lastRow === 'left') {
      placeRow(rowStart, tiles.length, rowHeight);
    }
    // 'hide': positions stay null for this trailing range, currentY doesn't advance
  }

  const containerHeight = tiles.length === 0 ? 0 : Math.max(0, currentY - gutterY);
  return { positions, containerHeight, rows };
}
