import { describe, expect, it } from 'vitest';
import {
  computeColumnCount,
  computeColumnWidth,
  layoutMasonry,
  layoutMasonryHorizontal,
  type MasonryHorizontalOptions,
  type MasonryOptions,
  type MasonryTile,
} from '../../../src/plugins/layout/masonry';

const base: MasonryOptions = {
  containerWidth: 1000,
  gutterX: 8,
  gutterY: 8,
  columns: 'auto',
  columnWidth: 240,
  minColumnWidth: 160,
  maxColumnWidth: 480,
  fill: 'shortest',
};

describe('computeColumnCount', () => {
  it('uses the explicit column count when given a number, ignoring width entirely', () => {
    expect(computeColumnCount({ ...base, columns: 5 })).toBe(5);
  });

  it('derives from containerWidth / columnWidth when auto', () => {
    // (1000 + 8) / (240 + 8) = 4.06 -> 4
    expect(computeColumnCount({ ...base, columns: 'auto' })).toBe(4);
  });

  it('increases column count (narrower columns) rather than exceed maxColumnWidth', () => {
    // a huge columnWidth target would otherwise floor to 1 very-wide column
    const result = computeColumnCount({
      ...base,
      columnWidth: 2000,
      maxColumnWidth: 300,
      containerWidth: 1000,
    });
    const effectiveWidth = computeColumnWidth(1000, base.gutterX, result);
    expect(effectiveWidth).toBeLessThanOrEqual(300);
  });

  it('decreases column count (wider columns) rather than go below minColumnWidth', () => {
    // a tiny columnWidth target would otherwise floor to many stringy columns
    const result = computeColumnCount({
      ...base,
      columnWidth: 10,
      minColumnWidth: 200,
      containerWidth: 1000,
    });
    const effectiveWidth = computeColumnWidth(1000, base.gutterX, result);
    expect(effectiveWidth).toBeGreaterThanOrEqual(200);
  });

  it('never returns fewer than 1 column, even at a container narrower than minColumnWidth', () => {
    expect(computeColumnCount({ ...base, containerWidth: 50, minColumnWidth: 200 })).toBe(1);
  });
});

describe('layoutMasonry — shortest fill', () => {
  it('places each tile into the currently-shortest column', () => {
    const tiles: MasonryTile[] = [
      { width: 100, height: 100 }, // square
      { width: 100, height: 200 }, // tall
      { width: 100, height: 50 }, // short
    ];
    const result = layoutMasonry(tiles, { ...base, columns: 2 });

    // col widths equal: (1000 - 8*1)/2 = 496
    // tile0 -> col0 (both empty, index 0 wins ties): height 496
    // tile1 -> col1 (shorter, 0 < 496): height 992
    // tile2 -> col0 is now shorter (496+8=504 < 992+8=1000) -> col0
    expect(result.positions[0]!.x).toBe(0);
    expect(result.positions[1]!.x).toBeCloseTo(496 + 8);
    expect(result.positions[2]!.x).toBe(0); // back to col0, the shorter one
  });

  it('computes tile height from the column width scaled by the tile aspect ratio', () => {
    const tiles: MasonryTile[] = [{ width: 200, height: 100 }]; // 2:1 landscape
    const result = layoutMasonry(tiles, { ...base, columns: 1 });
    const colWidth = 1000; // single column, no gutter subtracted
    expect(result.positions[0]!.height).toBeCloseTo(colWidth * 0.5);
  });

  it('containerHeight is the tallest column, excluding the final trailing gutter', () => {
    const tiles: MasonryTile[] = [{ width: 100, height: 100 }];
    const result = layoutMasonry(tiles, { ...base, columns: 1 });
    // one column, one tile: height = colWidth (square) ; containerHeight should equal that, not +gutter
    expect(result.containerHeight).toBeCloseTo(result.positions[0]!.height);
  });

  it('returns containerHeight 0 for an empty tile list', () => {
    const result = layoutMasonry([], { ...base, columns: 3 });
    expect(result.containerHeight).toBe(0);
    expect(result.positions).toHaveLength(0);
  });
});

describe('layoutMasonry — ordered fill', () => {
  it('round-robins tiles across columns in DOM order, ignoring column height', () => {
    const tiles: MasonryTile[] = Array.from({ length: 5 }, () => ({ width: 100, height: 100 }));
    const result = layoutMasonry(tiles, { ...base, columns: 3, fill: 'ordered' });
    const colWidth = computeColumnWidth(1000, 8, 3);
    const expectedX = (col: number) => col * (colWidth + 8);
    expect(result.positions.map((p) => p.x)).toEqual([
      expectedX(0),
      expectedX(1),
      expectedX(2),
      expectedX(0),
      expectedX(1),
    ]);
  });
});

describe('layoutMasonry — incremental continuation (infinite-scroll append)', () => {
  it('continuing from a previous columnHeights result places new tiles after existing ones, never moving them', () => {
    const options: MasonryOptions = { ...base, columns: 2 };
    const firstPage: MasonryTile[] = [
      { width: 100, height: 100 },
      { width: 100, height: 300 },
    ];
    const first = layoutMasonry(firstPage, options);

    const secondPage: MasonryTile[] = [{ width: 100, height: 150 }];
    const second = layoutMasonry(secondPage, options, first.columnHeights);

    // the appended tile must start at the shortest existing column's height,
    // not at y=0 — proving it continues rather than relaying out from scratch
    const shortestPrevHeight = Math.min(...first.columnHeights);
    expect(second.positions[0]!.y).toBe(shortestPrevHeight);
  });

  it('falls back to a fresh layout (ignores startHeights) if the column count changed since', () => {
    const options: MasonryOptions = { ...base, columns: 2 };
    const first = layoutMasonry([{ width: 100, height: 100 }], options);

    // container got narrower, now only fits 1 column — startHeights has the
    // wrong length (2) for the new columnCount (1), so it must not be reused
    const second = layoutMasonry(
      [{ width: 100, height: 100 }],
      { ...options, columns: 1 },
      first.columnHeights,
    );
    expect(second.columnHeights).toHaveLength(1);
    expect(second.positions[0]!.y).toBe(0);
  });
});

describe('layoutMasonryHorizontal — fixed-height rows packed left-to-right, wrapping without stretch', () => {
  const hBase: MasonryHorizontalOptions = {
    containerWidth: 1000,
    gutterX: 8,
    gutterY: 8,
    rowHeight: 200,
  };

  it('scales each tile to the fixed rowHeight at its own aspect ratio, not a computed/solved height', () => {
    const tile: MasonryTile = { width: 200, height: 100 }; // 2:1 landscape
    const result = layoutMasonryHorizontal([tile], hBase);

    expect(result.positions[0]!.height).toBe(200); // fixed, exactly hBase.rowHeight
    expect(result.positions[0]!.width).toBeCloseTo(400); // 2:1 aspect ratio preserved at that height
  });

  it('packs tiles left-to-right within a row (x advances by width + gutterX, y constant)', () => {
    const tiles: MasonryTile[] = [
      { width: 100, height: 100 },
      { width: 100, height: 100 },
      { width: 100, height: 100 },
    ];
    const result = layoutMasonryHorizontal(tiles, hBase);

    expect(result.positions[0]!.x).toBe(0);
    expect(result.positions[1]!.x).toBeCloseTo(result.positions[0]!.width + hBase.gutterX);
    expect(result.positions[2]!.y).toBe(result.positions[0]!.y); // still the same row
  });

  it('wraps to a new row once the next tile would overflow containerWidth, without stretching the finished row', () => {
    // 5 square tiles at rowHeight 200 are 200px wide each + 8px gutter = 208px/tile;
    // containerWidth 1000 fits 4 (824px) but not a 5th (1032px > 1000).
    const tiles: MasonryTile[] = Array.from({ length: 5 }, () => ({ width: 200, height: 200 }));
    const result = layoutMasonryHorizontal(tiles, hBase);

    expect(result.rowCount).toBe(2);
    expect(result.positions[3]!.y).toBe(result.positions[0]!.y); // 4th tile still row 0
    expect(result.positions[4]!.y).toBeGreaterThan(result.positions[0]!.y); // 5th wraps to row 1
    // ragged right edge: row 0's last tile ends well short of containerWidth, not stretched to meet it
    const row0End = result.positions[3]!.x + result.positions[3]!.width;
    expect(row0End).toBeLessThan(1000);
  });

  it('a single tile wider than containerWidth at rowHeight still gets its own row rather than being shrunk', () => {
    const wide: MasonryTile = { width: 3000, height: 200 }; // panorama, way over 1000 at rowHeight 200
    const normal: MasonryTile = { width: 100, height: 100 };
    const result = layoutMasonryHorizontal([wide, normal], hBase);

    expect(result.positions[0]!.height).toBe(200); // never shrunk below fixed rowHeight
    expect(result.rowCount).toBe(2); // wide tile alone on row 0, normal tile pushed to row 1
    expect(result.positions[1]!.y).toBeGreaterThan(result.positions[0]!.y);
  });

  it('containerHeight accumulates rowCount * (rowHeight + gutterY), minus the trailing gutter', () => {
    const tiles: MasonryTile[] = Array.from({ length: 5 }, () => ({ width: 200, height: 200 }));
    const result = layoutMasonryHorizontal(tiles, hBase); // wraps into 2 rows, per the earlier test
    expect(result.containerHeight).toBeCloseTo(200 * 2 + hBase.gutterY);
  });

  it('empty input yields no rows and zero containerHeight', () => {
    const result = layoutMasonryHorizontal([], hBase);
    expect(result.rowCount).toBe(0);
    expect(result.containerHeight).toBe(0);
    expect(result.positions).toHaveLength(0);
  });
});
