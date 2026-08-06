import { describe, expect, it } from 'vitest';
import {
  layoutJustified,
  type JustifiedOptions,
  type JustifiedPosition,
  type JustifiedTile,
} from '../../../src/plugins/layout/justified';

const base: JustifiedOptions = {
  containerWidth: 1000,
  gutterX: 8,
  gutterY: 8,
  rowHeight: 200,
  // Deliberately permissive — wide enough that no existing (pre-clamp)
  // fixture below is affected; the clamping describe block further down
  // overrides these with an intentionally narrow range instead.
  minRowHeight: 10,
  maxRowHeight: 5000,
  lastRow: 'justify',
};

// At these settings, 200*n + 8*(n-1) crosses 1000 exactly at n=5 for square
// (1:1) tiles — 5 completes one row exactly (no leftover), fewer than 5
// never reaches the threshold at all (always leftover), more than 5 splits
// across multiple rows. Every fixture below is picked deliberately around
// that boundary — see the comment on each describe block.
const SQUARE: JustifiedTile = { width: 100, height: 100 };

describe('layoutJustified — row filling', () => {
  it('packs tiles into a row until the target height would overflow the container, then finalizes it — 10 tiles make exactly two rows', () => {
    const tiles: JustifiedTile[] = Array.from({ length: 10 }, () => SQUARE);
    const result = layoutJustified(tiles, base);

    const ys = result.positions.map((p) => p?.y);
    expect(new Set(ys).size).toBe(2);
  });

  it('scales a finalized row so its tiles exactly fill the container width (edges flush)', () => {
    const tiles: JustifiedTile[] = [
      { width: 100, height: 100 },
      { width: 200, height: 100 }, // 2:1 landscape
      { width: 100, height: 100 },
    ];
    // force exactly one row: pick a rowHeight where all 3 fit together at target width < containerWidth
    const result = layoutJustified(tiles, { ...base, containerWidth: 500 });

    const rowPositions = result.positions.filter((p) => p!.y === result.positions[0]!.y);
    const lastTile = rowPositions[rowPositions.length - 1]!;
    expect(lastTile.x + lastTile.width).toBeCloseTo(500, 0); // right edge flush with the container
  });

  it('each tile keeps its own aspect ratio within a scaled row', () => {
    const tiles: JustifiedTile[] = [
      { width: 100, height: 100 }, // square
      { width: 200, height: 100 }, // 2:1
    ];
    const result = layoutJustified(tiles, { ...base, containerWidth: 500 });
    const square = result.positions[0]!;
    const landscape = result.positions[1]!;
    expect(square.height).toBeCloseTo(landscape.height); // same row height
    expect(landscape.width / landscape.height).toBeCloseTo(2, 1); // ratio preserved
    expect(square.width / square.height).toBeCloseTo(1, 1);
  });

  it('a single tile wider than the container alone still gets forced into its own row, scaled down to fit', () => {
    const tiles: JustifiedTile[] = [{ width: 3000, height: 100 }]; // extreme panorama
    const result = layoutJustified(tiles, base);
    expect(result.positions[0]!.width).toBeCloseTo(base.containerWidth, 0);
  });

  it('containerHeight sums finalized row heights + gutters, excluding the final trailing gutter', () => {
    const tiles: JustifiedTile[] = Array.from({ length: 10 }, () => SQUARE);
    const result = layoutJustified(tiles, base);
    const lastPosition = result.positions[result.positions.length - 1]!;
    expect(result.containerHeight).toBeCloseTo(lastPosition.y + lastPosition.height, 0);
  });

  it('returns containerHeight 0 and an empty positions array for no tiles', () => {
    const result = layoutJustified([], base);
    expect(result.containerHeight).toBe(0);
    expect(result.positions).toHaveLength(0);
  });
});

describe('layoutJustified — lastRow handling (3 square tiles: never reaches the row-fill threshold on its own, always leftover)', () => {
  const tiles: JustifiedTile[] = [SQUARE, SQUARE, SQUARE];

  it("'justify' stretches even a short trailing row to fill the container width, same as any other row", () => {
    const result = layoutJustified(tiles, { ...base, lastRow: 'justify' });
    const rightEdge = Math.max(...result.positions.map((p) => p!.x + p!.width));
    expect(rightEdge).toBeCloseTo(base.containerWidth, 0);
  });

  it("'left' leaves the trailing row at natural rowHeight size, not stretched, left-aligned", () => {
    const result = layoutJustified(tiles, { ...base, lastRow: 'left' });
    for (const position of result.positions) {
      expect(position!.height).toBeCloseTo(base.rowHeight, 0); // natural, not rescaled
    }
    const rightEdge = Math.max(...result.positions.map((p) => p!.x + p!.width));
    expect(rightEdge).toBeLessThan(base.containerWidth); // not stretched to fill
  });

  it("'hide' excludes the trailing row's tiles from positions (null) and from containerHeight", () => {
    const justified = layoutJustified(tiles, { ...base, lastRow: 'justify' });
    const hidden = layoutJustified(tiles, { ...base, lastRow: 'hide' });

    expect(hidden.positions.every((p) => p === null)).toBe(true);
    expect(hidden.containerHeight).toBe(0);
    expect(justified.containerHeight).toBeGreaterThan(0);
  });
});

describe('layoutJustified — minRowHeight/maxRowHeight clamping', () => {
  it('caps a row that would otherwise scale to an extreme height — a lone tall/narrow tile stretched to fill the container width', () => {
    // aspect 0.1 (very tall/narrow) alone: unclamped it'd scale to
    // containerWidth / 0.1 = 10000px tall to fill the row
    const tallTile: JustifiedTile = { width: 50, height: 500 };
    const result = layoutJustified([tallTile], {
      ...base,
      minRowHeight: 10,
      maxRowHeight: 300,
      lastRow: 'justify',
    });

    expect(result.positions[0]!.height).toBe(300); // capped at maxRowHeight
    // a capped row no longer reaches the container's right edge — the
    // documented tradeoff, same one masonry's min/maxColumnWidth accepts
    expect(result.positions[0]!.width).toBeLessThan(base.containerWidth);
  });

  it('sheds tiles into the next row rather than overflowing, when raising a row to minRowHeight would otherwise widen it past the container', () => {
    // 3 moderately-wide tiles (aspect 3 each): greedy fill groups the first
    // 2 into a candidate row whose natural scaled height (992/6≈165px) is
    // below a minRowHeight of 200 — naively clamping up to 200 would widen
    // that row to 200*6+8=1208px, over the 1000px container. The 2nd tile
    // should get shed back out instead, rolling into the next row, so
    // *every* finalized row's total width stays within the container.
    const tile: JustifiedTile = { width: 300, height: 100 };
    const result = layoutJustified([tile, tile, tile], {
      ...base,
      minRowHeight: 200,
      maxRowHeight: 5000,
      lastRow: 'justify',
    });

    expect(result.positions.every((p) => p !== null)).toBe(true); // nothing silently dropped
    for (const row of result.rows) {
      const rowPositions = result.positions.slice(row.start, row.end) as JustifiedPosition[];
      const totalWidth =
        rowPositions.reduce((sum, p) => sum + p.width, 0) +
        base.gutterX * (rowPositions.length - 1);
      expect(totalWidth).toBeLessThanOrEqual(base.containerWidth + 0.01);
    }
  });

  it('a single tile so wide that minRowHeight can never fit the container falls back to natural height instead of overflowing — nothing left to shed', () => {
    // aspect 20 (very wide): unclamped it'd scale to
    // containerWidth / 20 = 50px tall to fit the row at all — raising it to
    // minRowHeight: 100 would make it 2000px wide, double the container,
    // and there's no second tile to shed it onto instead.
    const wideTile: JustifiedTile = { width: 2000, height: 100 };
    const result = layoutJustified([wideTile], {
      ...base,
      minRowHeight: 100,
      maxRowHeight: 5000,
      lastRow: 'justify',
    });

    expect(result.positions[0]!.height).toBeCloseTo(base.containerWidth / 20, 1); // minRowHeight yields
    expect(result.positions[0]!.width).toBeCloseTo(base.containerWidth, 0); // flush, never past it
  });

  it("does not clamp lastRow: 'left', which already uses a fixed rowHeight rather than a derived one", () => {
    const tallTile: JustifiedTile = { width: 50, height: 500 };
    const result = layoutJustified([tallTile], {
      ...base,
      rowHeight: 200,
      minRowHeight: 10,
      maxRowHeight: 50, // would clamp a derived height, but 'left' doesn't derive one
      lastRow: 'left',
    });

    expect(result.positions[0]!.height).toBe(200); // untouched rowHeight, not clamped to 50
  });

  it('a normally-scaled row within [min, max] is unaffected — clamping is a no-op in the common case', () => {
    const tiles: JustifiedTile[] = Array.from({ length: 5 }, () => SQUARE);
    const unclamped = layoutJustified(tiles, base); // base's own min/max (10/5000) already permissive
    const narrowerButStillPermissive = layoutJustified(tiles, {
      ...base,
      minRowHeight: 50,
      maxRowHeight: 500,
    });
    expect(narrowerButStillPermissive.positions[0]!.height).toBeCloseTo(
      unclamped.positions[0]!.height,
      5,
    );
  });
});

describe('layoutJustified — rows (row-boundary tracking for compact/inline heading placement)', () => {
  it('one entry per finalized row, with the tile index range and geometry that produced it', () => {
    const tiles: JustifiedTile[] = Array.from({ length: 10 }, () => SQUARE);
    const result = layoutJustified(tiles, base);

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toEqual({ start: 0, end: 5, y: 0, height: result.positions[0]!.height });
    expect(result.rows[1]!.start).toBe(5);
    expect(result.rows[1]!.end).toBe(10);
    expect(result.rows[1]!.y).toBeCloseTo(result.rows[0]!.height + base.gutterY, 0);
  });

  it("excludes a lastRow: 'hide' trailing range — no row entry for tiles that never got finalized", () => {
    const tiles: JustifiedTile[] = [SQUARE, SQUARE, SQUARE]; // never reaches the row threshold alone
    const result = layoutJustified(tiles, { ...base, lastRow: 'hide' });

    expect(result.rows).toHaveLength(0);
  });

  it('returns no rows for an empty tile list', () => {
    const result = layoutJustified([], base);
    expect(result.rows).toHaveLength(0);
  });
});

describe('layoutJustified — a row that divides evenly (5 square tiles exactly complete one row) is unaffected by lastRow', () => {
  const tiles: JustifiedTile[] = Array.from({ length: 5 }, () => SQUARE);

  it('every tile is positioned (none null) regardless of lastRow, since there is no leftover row', () => {
    const justify = layoutJustified(tiles, { ...base, lastRow: 'justify' });
    const hide = layoutJustified(tiles, { ...base, lastRow: 'hide' });
    expect(justify.positions.every((p) => p !== null)).toBe(true);
    expect(hide.positions.every((p) => p !== null)).toBe(true);
    expect(hide.containerHeight).toBeCloseTo(justify.containerHeight, 0);
  });
});
