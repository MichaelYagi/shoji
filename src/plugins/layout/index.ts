import type { PluginContext, ShojiPlugin } from '../../core/plugin';
import type { GalleryItem } from '../../core/types';
import { layoutMasonry, layoutMasonryHorizontal, type MasonryTile } from './masonry';
import { layoutJustified, type JustifiedOptions, type JustifiedResult } from './justified';
import './layout.css';

/**
 * DESIGN.md §5 — `type: 'grid' | 'masonry' | 'justified'`; masonry supports
 * both `orientation`s, `breakpoints` (§5.4), and `groupBy`/headings (§5.2;
 * see that option's own doc comment for the v1 scope cuts vs. the full
 * spec, including why `groupBy` itself is excluded from `orientation:
 * 'horizontal'`). Deliberately still
 * deferred: jump-free *prepend* coordination (§5.2's scroll-anchoring
 * handoff needs the not-yet-built scroll plugin on the other end —
 * prepending today triggers a full relayout, which can shift scroll
 * position if content above the fold grew).
 */
export interface LayoutOptions {
  /** Default `'justified'`. */
  type?: 'grid' | 'masonry' | 'justified';
  gutter?: number | { x: number; y: number };
  /**
   * `type: 'grid'` only — every cell's shape, cropped to fit via
   * `object-fit: cover`; default 1 (square). Deliberately *not* each
   * photo's own aspect ratio: plain CSS grid sizes a row's height to its
   * tallest cell, so per-item ratios leave a visible blank gap under every
   * shorter tile sharing a row with a taller one. Masonry/justified are
   * the two types that preserve true per-photo aspect ratios instead (via
   * their own JS packing, which doesn't have this row-height problem).
   */
  aspectRatio?: number;
  /**
   * `type: 'masonry'` only. `'vertical'` (default): fixed-width columns,
   * tiles stack top-to-bottom, ragged *bottom* edge. `'horizontal'`: fixed-
   * height rows, tiles pack left-to-right, ragged *right* edge — the direct
   * transpose. Both wrap/grow within the container and scroll vertically
   * only, same as every other layout type; neither ever needs horizontal
   * scroll. See `rowHeight` for `'horizontal'`'s one fixed input, and
   * `justified` (a different `type` entirely) for the *opposite* tradeoff —
   * width forced flush, height left to solve for.
   */
  orientation?: 'vertical' | 'horizontal';
  columns?: number | 'auto';
  columnWidth?: number;
  minColumnWidth?: number;
  maxColumnWidth?: number;
  fill?: 'shortest' | 'ordered';
  /** `type: 'justified'`, or `type: 'masonry', orientation: 'horizontal'`. For horizontal masonry this is the row's exact, fixed height (see `orientation`'s doc comment) — `minRowHeight`/`maxRowHeight` don't apply there, since nothing is solved/clamped, only for justified, where it's a *target* a solved-for height converges near. */
  rowHeight?: number;
  minRowHeight?: number;
  maxRowHeight?: number;
  lastRow?: 'justify' | 'left' | 'hide';
  animate?: boolean;
  /**
   * Container-width → partial overrides, applied on top of the base options
   * above whenever the container's current width is <= that key (the
   * *narrowest* matching key wins if more than one applies). Re-evaluated on
   * every relayout, so crossing a threshold while resizing takes effect
   * live. Cannot override `type` or `orientation` — swapping the DOM
   * structure/positioning strategy live is a bigger feature than a sizing
   * tweak; use a media query + two `Shoji` instances if that's genuinely
   * needed.
   */
  breakpoints?: Record<number, Omit<LayoutOptions, 'type' | 'orientation' | 'breakpoints'>>;
  /**
   * Derives a section key per item (e.g. a formatted date) — a heading is
   * inserted whenever the key changes between consecutive items, real
   * "Today / Yesterday / March 2024" (Google Photos-style) sectioning.
   * Items must already be grouped consecutively; a key reappearing later
   * after a different key started a new section anyway.
   *
   * Section boundaries behave differently per `type`: `grid`'s heading is a
   * full-span (`grid-column: 1 / -1`) element, native CSS grid gives it its
   * own row for free. `masonry`'s heading is a full-width blocking element
   * too — each section is its own fresh column-packing pass, no two
   * sections ever share visual space. `justified` is the odd one out, by
   * design (this is the actual Google Photos behavior, not a simplified
   * approximation of it): sections do **not** force a row break. Row
   * *composition* ignores section boundaries entirely — one continuous
   * `layoutJustified` pass packs every item regardless of section, so a
   * section with too few items to reach a full row's target width (a
   * single lone photo, say) shares that row with whatever comes right
   * after it, instead of getting stretched into its own awkward
   * almost-empty row. A heading only marks *where* a new section starts:
   * a compact, inline label sized to its own content (not full width),
   * positioned at the x-coordinate of the tile that starts its section,
   * in a slim label-band above whichever row that tile landed on — more
   * than one label can share the same band if more than one section
   * happens to start within the same row (see `renderHeading`'s
   * `{title, subtitle}` form for exactly this — that's what the reference
   * behavior actually looks like).
   *
   * v1 scope cuts vs. DESIGN.md §5.2's full spec: (1) any items change
   * while `groupBy` is set does a full relayout, same simplification
   * justified's non-grouped path already makes for appends (§5.4) — the
   * "merge across load boundaries" incremental optimization is deferred;
   * (2) headings are always `<h2>`, not a configurable level; (3) not
   * supported with `orientation: 'horizontal'` (warns, ignored) —
   * DESIGN.md itself calls that pairing rare.
   */
  groupBy?: (item: GalleryItem) => string;
  /**
   * Customizes a heading's content; default renders the key as plain text.
   * Three return shapes:
   * - `string` — plain text (default behavior, just with custom content).
   * - `HTMLElement` — full control, own tag/children; the plugin adds its
   *   own class/positioning on top of whatever's returned, nothing else.
   * - `{ title: string; subtitle?: string }` — the built-in structured
   *   form (bold title + a smaller, muted `subtitle`, e.g. a date + a
   *   location) — the only form the plugin can apply automatic overflow
   *   handling to (see `headingOverflow`), since it owns the DOM structure
   *   (a raw `HTMLElement` is opaque to it, no safe way to guess what's
   *   droppable).
   */
  renderHeading?: (
    key: string,
    items: GalleryItem[],
  ) => string | HTMLElement | { title: string; subtitle?: string };
  /**
   * `type: 'justified'` + the `{ title, subtitle }` structured heading
   * form only — controls what happens when a compact label doesn't fit
   * its available width (the gap until the next section's label sharing
   * its row, or the container edge). Ignored otherwise: `grid`/`masonry`
   * headings are full-width and this kind of squeeze can't happen there;
   * a raw `renderHeading`-returned `HTMLElement`/`string` is left exactly
   * as returned regardless, since the plugin has no safe way to guess
   * what's droppable in an opaque element.
   * - `'show'` (default) — always render the full title + subtitle, one
   *   line, however wide; a label can visually run past the next
   *   section's label or the container edge if the content is long
   *   enough. The simple, predictable default — nothing gets silently
   *   dropped or reflowed.
   * - `'fit'` — never wraps a label's text. First the subtitle is dropped
   *   if title+subtitle together don't fit; if the title *alone* still
   *   doesn't fit next to whatever's sharing its row, that section is
   *   pushed to start a fresh row instead, giving its label the room it
   *   needs — row *composition* responds to label width, not just label
   *   content. Real Google Photos behavior; opt in when labels regularly
   *   need to share tight row space. The one unavoidable exception is a
   *   single label wider than the entire container even alone on its own
   *   row — there, nothing left to break onto, so the label is
   *   ellipsis-truncated (still one line, never wrapped, never
   *   overflowing).
   */
  headingOverflow?: 'show' | 'fit';
  /**
   * Pins the active section's heading via `position: sticky`. Only
   * implemented for `type: 'grid'`, where headings sit in normal document
   * flow — masonry/justified headings are absolutely positioned by JS (like
   * their tiles), and `position: sticky` doesn't do anything meaningful
   * layered onto an already explicitly-positioned element. Warns and is
   * ignored for those two types.
   */
  stickyHeadings?: boolean;
  /**
   * When an item is missing `width`/`height`, measure its tile's own `<img>`
   * once it loads (`naturalWidth`/`naturalHeight`) and correct that tile's
   * aspect ratio in place, rather than leaving it at the permanent 4:3
   * placeholder fallback. Default `true`.
   *
   * The *first* layout pass never waits on this — it always uses the 4:3
   * placeholder immediately, same as before this option existed, so opening
   * the gallery is never blocked on image loads (DESIGN.md §5.2's
   * never-measure-mid-layout-pass rule still holds for that first pass).
   * This only ever *corrects* a placeholder after the fact, once a real
   * measurement lands — the same "async correction after an initial
   * synchronous pass" pattern already used for a `containerWidth <= 0`
   * container (§5.4) and the zoom transition's origin-rect race (§2.3b),
   * extended to per-item dimensions. Multiple corrections landing close
   * together (e.g. several cached images resolving in the same tick) are
   * coalesced into one relayout via `requestAnimationFrame`, not one
   * relayout per image.
   *
   * Effectively does automatically, for `thumb`/`poster`/`src`, what a host
   * would otherwise have to do by hand before constructing the gallery
   * (`new Image(); img.onload = () => ...`) — set `false` to keep the old
   * behavior (permanent 4:3 fallback, no self-correction) if you'd rather
   * guarantee zero extra relayouts under any circumstance.
   */
  autoMeasure?: boolean;
}

interface ResolvedConfig {
  gutter: { x: number; y: number };
  columns: number | 'auto';
  columnWidth: number;
  minColumnWidth: number;
  maxColumnWidth: number;
  fill: 'shortest' | 'ordered';
  rowHeight: number;
  minRowHeight: number;
  maxRowHeight: number;
  lastRow: 'justify' | 'left' | 'hide';
}

const DEFAULT_ASPECT: MasonryTile = { width: 4, height: 3 };

interface Tile {
  index: number;
  root: HTMLAnchorElement;
  /** The tile's own thumbnail `<img>` — reused by `autoMeasure` to read `naturalWidth`/`naturalHeight` once it loads, rather than fetching the same image a second time with a separate `Image()`. */
  img: HTMLImageElement;
}

interface HeadingEntry {
  root: HTMLElement;
  /** index into `tiles[]` (== item index) where this section's tiles start. */
  tileStart: number;
  /** Present only for the built-in `{ title, subtitle }` form — the two elements `applyJustified`'s overflow handling is allowed to hide/wrap, since the plugin itself built them (a raw `renderHeading`-returned `HTMLElement` is opaque; nothing is touched there). */
  structured: { titleEl: HTMLElement; subtitleEl: HTMLElement | null } | null;
}

/** `gutter: 8` means `{x: 8, y: 8}` — a single number applies to both axes; `{x, y}` sets them independently. */
function resolveGutter(raw: unknown): { x: number; y: number } {
  if (raw && typeof raw === 'object') {
    const obj = raw as { x?: number; y?: number };
    return { x: Number(obj.x ?? 8), y: Number(obj.y ?? 8) };
  }
  const n = Number(raw ?? 8);
  return { x: n, y: n };
}

function keyOf(item: GalleryItem): string {
  return item.id ?? item.src;
}

/** `newItems` is a superset of `oldItems` sharing an identical prefix — i.e. purely appended, nothing reordered/removed/prepended. */
function isPureAppend(oldItems: readonly GalleryItem[], newItems: readonly GalleryItem[]): boolean {
  if (newItems.length <= oldItems.length) return false;
  for (let i = 0; i < oldItems.length; i++) {
    if (keyOf(oldItems[i]!) !== keyOf(newItems[i]!)) return false;
  }
  return true;
}

export const Layout: ShojiPlugin = {
  name: 'layout',
  defaults: {
    type: 'justified',
    gutter: 8,
    columns: 'auto',
    columnWidth: 240,
    minColumnWidth: 160,
    maxColumnWidth: 480,
    fill: 'shortest',
    animate: true,
    autoMeasure: true,
  },

  init(ctx: PluginContext): () => void {
    const { gallery } = ctx;
    const type = (ctx.options.type as 'grid' | 'masonry' | 'justified' | undefined) ?? 'justified';
    const gutter = resolveGutter(ctx.options.gutter);
    const aspectRatio = Number(ctx.options.aspectRatio ?? 1);
    const orientation =
      (ctx.options.orientation as 'vertical' | 'horizontal' | undefined) ?? 'vertical';
    const columns = (ctx.options.columns as number | 'auto' | undefined) ?? 'auto';
    const columnWidth = Number(ctx.options.columnWidth ?? 240);
    const minColumnWidth = Number(ctx.options.minColumnWidth ?? 160);
    const maxColumnWidth = Number(ctx.options.maxColumnWidth ?? 480);
    const fill = (ctx.options.fill as 'shortest' | 'ordered' | undefined) ?? 'shortest';
    const rowHeight = Number(ctx.options.rowHeight ?? 220);
    const minRowHeight = Number(ctx.options.minRowHeight ?? 120);
    const maxRowHeight = Number(ctx.options.maxRowHeight ?? 360);
    const lastRow = (ctx.options.lastRow as 'justify' | 'left' | 'hide' | undefined) ?? 'justify';
    const animate = ctx.options.animate !== false;
    const autoMeasureEnabled = ctx.options.autoMeasure !== false;
    const horizontal = type === 'masonry' && orientation === 'horizontal';
    const groupByFn = ctx.options.groupBy as ((item: GalleryItem) => string) | undefined;
    const renderHeadingFn = ctx.options.renderHeading as
      | ((
          key: string,
          items: GalleryItem[],
        ) => string | HTMLElement | { title: string; subtitle?: string })
      | undefined;
    const headingOverflow = (ctx.options.headingOverflow as 'show' | 'fit' | undefined) ?? 'show';
    const stickyHeadingsRaw = ctx.options.stickyHeadings === true;
    const stickyHeadings = stickyHeadingsRaw && type === 'grid';
    if (stickyHeadingsRaw && type !== 'grid') {
      console.warn(
        "Shoji: layout plugin — stickyHeadings is only implemented for type: 'grid'; ignored (see the option's doc comment).",
      );
    }
    if (groupByFn && horizontal) {
      console.warn(
        "Shoji: layout plugin — groupBy isn't supported with orientation: 'horizontal'; ignored.",
      );
    }
    const groupingEnabled = !!groupByFn && !horizontal;

    const baseConfig: ResolvedConfig = {
      gutter,
      columns,
      columnWidth,
      minColumnWidth,
      maxColumnWidth,
      fill,
      rowHeight,
      minRowHeight,
      maxRowHeight,
      lastRow,
    };

    const breakpointsRaw = ctx.options.breakpoints as
      Record<number, Partial<LayoutOptions>> | undefined;
    const sortedBreakpoints = breakpointsRaw
      ? Object.entries(breakpointsRaw)
          .map(([key, overrides]) => [Number(key), overrides] as const)
          .sort((a, b) => a[0] - b[0])
      : [];

    /** Re-run on every relayout — the narrowest breakpoint whose key is still >= the current width wins; falls back to `baseConfig` if none match or no breakpoints were given. */
    function resolveConfig(width: number): ResolvedConfig {
      const match = sortedBreakpoints.find(([maxWidth]) => width <= maxWidth);
      if (!match) return baseConfig;
      const overrides = match[1];
      return {
        gutter:
          overrides.gutter !== undefined ? resolveGutter(overrides.gutter) : baseConfig.gutter,
        columns: overrides.columns ?? baseConfig.columns,
        columnWidth: overrides.columnWidth ?? baseConfig.columnWidth,
        minColumnWidth: overrides.minColumnWidth ?? baseConfig.minColumnWidth,
        maxColumnWidth: overrides.maxColumnWidth ?? baseConfig.maxColumnWidth,
        fill: overrides.fill ?? baseConfig.fill,
        rowHeight: overrides.rowHeight ?? baseConfig.rowHeight,
        minRowHeight: overrides.minRowHeight ?? baseConfig.minRowHeight,
        maxRowHeight: overrides.maxRowHeight ?? baseConfig.maxRowHeight,
        lastRow: overrides.lastRow ?? baseConfig.lastRow,
      };
    }

    const container = gallery.element;
    container.classList.add('shoji-layout', `shoji-layout--${type}`);
    if (animate) container.classList.add('shoji-layout--animate');

    let tiles: Tile[] = [];
    let headings: HeadingEntry[] = [];
    let columnHeights: number[] | undefined;
    let previousItems: readonly GalleryItem[] = [];
    let warnedMissingDims = false;

    /** [startIndex, endExclusive) into `items`/`tiles` per section, split wherever `groupByFn`'s key changes. */
    function computeSections(
      items: readonly GalleryItem[],
    ): Array<{ key: string; startIndex: number; endIndex: number }> {
      const sections: Array<{ key: string; startIndex: number; endIndex: number }> = [];
      for (let i = 0; i < items.length; i++) {
        const key = groupByFn!(items[i]!);
        const current = sections[sections.length - 1];
        if (!current || current.key !== key) {
          sections.push({ key, startIndex: i, endIndex: i + 1 });
        } else {
          current.endIndex = i + 1;
        }
      }
      return sections;
    }

    function createHeadingRoot(
      key: string,
      sectionItems: GalleryItem[],
    ): { root: HTMLElement; structured: HeadingEntry['structured'] } {
      const rendered = renderHeadingFn ? renderHeadingFn(key, sectionItems) : key;
      let root: HTMLElement;
      let structured: HeadingEntry['structured'] = null;
      if (typeof rendered === 'string') {
        root = document.createElement('h2');
        root.textContent = rendered;
      } else if (rendered instanceof HTMLElement) {
        root = rendered;
      } else {
        root = document.createElement('h2');
        const titleEl = document.createElement('span');
        titleEl.className = 'shoji-layout-heading-title';
        titleEl.textContent = rendered.title;
        root.appendChild(titleEl);
        let subtitleEl: HTMLElement | null = null;
        if (rendered.subtitle) {
          subtitleEl = document.createElement('span');
          subtitleEl.className = 'shoji-layout-heading-subtitle';
          subtitleEl.textContent = rendered.subtitle;
          root.appendChild(subtitleEl);
        }
        structured = { titleEl, subtitleEl };
      }
      root.classList.add('shoji-layout-heading');
      if (stickyHeadings) root.classList.add('shoji-layout-heading--sticky');
      return { root, structured };
    }

    /** Segment boundaries derived from `headings` — `end` is the next heading's `tileStart`, or `tiles.length` for the last one. */
    function headingSegments(): Array<{ heading: HeadingEntry; start: number; end: number }> {
      return headings.map((heading, i) => ({
        heading,
        start: heading.tileStart,
        end: i + 1 < headings.length ? headings[i + 1]!.tileStart : tiles.length,
      }));
    }

    /** `undefined` for a video item with neither `thumb` nor `poster` — its tile `<img>` ends up pointed at the unplayable video file itself, which can never load as an image, so there's nothing `autoMeasure` could learn from it either. */
    function measurableSrc(item: GalleryItem): string | undefined {
      return item.thumb ?? item.poster ?? (item.video ? undefined : item.src);
    }

    function aspectOf(item: GalleryItem | undefined): MasonryTile {
      if (item?.width && item.height) return { width: item.width, height: item.height };
      const selfCorrecting = autoMeasureEnabled && !!item && !!measurableSrc(item);
      if (!warnedMissingDims && !selfCorrecting) {
        warnedMissingDims = true;
        console.warn(
          autoMeasureEnabled
            ? 'Shoji: layout plugin — item(s) missing width/height with no measurable thumb/poster/src to auto-measure from either; falling back to a 4:3 placeholder ratio permanently for those.'
            : 'Shoji: layout plugin — item(s) missing width/height and autoMeasure is disabled. Masonry/justified positions are computed from aspect ratios up front, never by measuring loaded images (DESIGN.md §5.2 — that causes layout-jump), so items without dimensions fall back to a 4:3 placeholder ratio instead.',
        );
      }
      return DEFAULT_ASPECT;
    }

    function createTile(item: GalleryItem, index: number): Tile {
      const root = document.createElement('a');
      root.className = 'shoji-layout-tile';
      if (item.id) root.dataset.shojiId = item.id;

      // item.src is the video *file* for a video item (unplayable as a tile
      // thumbnail) — item.poster is the actual image to show there, checked
      // before falling back to item.src, which is only ever correct for a
      // plain image item.
      const img = document.createElement('img');
      img.src = item.thumb ?? item.poster ?? item.src;
      img.loading = 'lazy';
      img.alt = item.alt ?? '';
      root.appendChild(img);

      const tile: Tile = { index, root, img };
      root.addEventListener('click', (event) => {
        event.preventDefault();
        gallery.open(tile.index);
      });
      return tile;
    }

    function applyGrid(target: readonly Tile[]): void {
      // Grid otherwise never reads its own size (native CSS grid reflows
      // itself) — only breakpoint resolution needs it read here.
      const containerWidth = container.getBoundingClientRect().width;
      const config = resolveConfig(containerWidth);
      container.style.setProperty('--shoji-layout-column-width', `${config.columnWidth}px`);
      // CSS gap shorthand is "row-gap column-gap" — y before x.
      container.style.setProperty(
        '--shoji-layout-gutter',
        `${config.gutter.y}px ${config.gutter.x}px`,
      );
      for (const tile of target) {
        tile.root.style.setProperty('--shoji-layout-tile-aspect', `${aspectRatio}`);
      }
    }

    /** `appendOnly`: reposition just these (new) tiles, continuing from the saved `columnHeights`; omit to relayout every tile from scratch (resize, or a non-append items change). Never called with `appendOnly` set when grouping is active — grouped changes always route through `fullRender` (see the `groupBy` option's doc comment). */
    function applyMasonry(appendOnly: readonly Tile[] | null): void {
      const containerWidth = container.getBoundingClientRect().width;
      if (containerWidth <= 0) return; // not painted yet (e.g. display:none) — the resize observer's initial callback will retry once it is

      const config = resolveConfig(containerWidth);
      const masonryOptions = {
        containerWidth,
        gutterX: config.gutter.x,
        gutterY: config.gutter.y,
        columns: config.columns,
        columnWidth: config.columnWidth,
        minColumnWidth: config.minColumnWidth,
        maxColumnWidth: config.maxColumnWidth,
        fill: config.fill,
      };

      if (groupingEnabled && headings.length > 0) {
        const segments = headingSegments();
        // Batch-read every heading's height up front, before writing any
        // tile styles below — interleaving reads (which force a layout
        // flush) with the transform writes in the same pass measurably
        // delayed the very first paint under animate: true (each flush
        // gives the browser a "before" style to transition away from that
        // it otherwise wouldn't have for freshly-inserted elements).
        const headingHeights = segments.map((s) => s.heading.root.getBoundingClientRect().height);

        let y = 0;
        segments.forEach(({ heading, start, end }, i) => {
          const segTiles = tiles.slice(start, end);
          heading.root.style.transform = `translate(0px, ${y}px)`;
          y += headingHeights[i]! + config.gutter.y;
          const segResult = layoutMasonry(
            segTiles.map((t) => aspectOf(gallery.items[t.index])),
            masonryOptions,
          );
          segTiles.forEach((tile, j) => {
            const pos = segResult.positions[j]!;
            tile.root.style.width = `${pos.width}px`;
            tile.root.style.height = `${pos.height}px`;
            tile.root.style.visibility = 'visible';
            tile.root.style.transform = `translate(${pos.x}px, ${y + pos.y}px)`;
          });
          y += segResult.containerHeight + config.gutter.y;
        });
        columnHeights = undefined; // no cross-segment continuation once grouped
        container.style.height = `${Math.max(0, y - config.gutter.y)}px`;
        return;
      }

      const target = appendOnly ?? tiles;
      const masonryTiles = target.map((t) => aspectOf(gallery.items[t.index]));
      const startHeights = appendOnly ? columnHeights : undefined;
      const result = layoutMasonry(masonryTiles, masonryOptions, startHeights);

      target.forEach((tile, i) => {
        const pos = result.positions[i]!;
        tile.root.style.width = `${pos.width}px`;
        tile.root.style.height = `${pos.height}px`;
        tile.root.style.visibility = 'visible';
        tile.root.style.transform = `translate(${pos.x}px, ${pos.y}px)`;
      });

      columnHeights = result.columnHeights;
      container.style.height = `${result.containerHeight}px`;
    }

    /**
     * The masonry-family transpose of applyMasonry: fixed-height rows pack
     * tiles left-to-right, wrapping to a new row rather than stretching —
     * see layoutMasonryHorizontal's doc comment (masonry.ts) for the full
     * algorithm. Like applyJustified, this always relays out every tile
     * from scratch (no `appendOnly`/incremental-continuation param) — a
     * row isn't "committed" until enough tiles arrive to overflow it, so an
     * appended tile can extend what was the previous render's trailing row,
     * exactly the same reason applyJustified can't do incremental append.
     */
    function applyMasonryHorizontal(): void {
      const containerWidth = container.getBoundingClientRect().width;
      if (containerWidth <= 0) return; // not painted yet (e.g. display:none) — the resize observer's initial callback will retry once it is

      const config = resolveConfig(containerWidth);
      const masonryTiles = tiles.map((t) => aspectOf(gallery.items[t.index]));
      const result = layoutMasonryHorizontal(masonryTiles, {
        containerWidth,
        gutterX: config.gutter.x,
        gutterY: config.gutter.y,
        rowHeight: config.rowHeight,
      });

      tiles.forEach((tile, i) => {
        const pos = result.positions[i]!;
        tile.root.style.width = `${pos.width}px`;
        tile.root.style.height = `${pos.height}px`;
        tile.root.style.visibility = 'visible';
        tile.root.style.transform = `translate(${pos.x}px, ${pos.y}px)`;
      });

      container.style.height = `${result.containerHeight}px`;
    }

    /**
     * The `groupBy` + `justified` combination — see that option's doc
     * comment for the full behavioral spec (sections don't force a row
     * break by default; a heading is a compact inline label, not a
     * full-width blocking element).
     *
     * `headingOverflow: 'show'` (default): one continuous `layoutJustified`
     * pass packs every tile regardless of section — the simple case, a
     * single "segment" covering everything.
     *
     * `headingOverflow: 'fit'`: still prefers continuous packing, but a
     * section whose label (title+subtitle, or title alone once the
     * subtitle's dropped) wouldn't fit the gap to the next label sharing
     * its row gets pushed to start a fresh row instead — the label is
     * never wrapped. This means row *composition itself* has to respond to
     * label width, not just label content — computeSegments() below finds
     * the largest run of sections that can share rows without any label
     * needing to break, by growing a trial `layoutJustified` call one
     * section at a time and backing off the moment a fit check fails; each
     * final segment becomes its own independent `layoutJustified` call
     * (same mechanism as masonry's hard per-section blocks, except the
     * unit here is a dynamically-sized run of sections, not always
     * exactly one).
     */
    function applyJustifiedGrouped(
      justifiedOptions: JustifiedOptions,
      config: ResolvedConfig,
      containerWidth: number,
    ): void {
      // Batch-measure every structured heading's natural (unconstrained,
      // single-line) width up front — both with and without its subtitle —
      // before any segmentation trial runs. Needed by computeSegments()'s
      // fit checks below, and again by the final per-segment content
      // decision pass; measuring once here avoids re-measuring per trial.
      const fullWidths = new Map<number, number>();
      const titleOnlyWidths = new Map<number, number>();
      if (headingOverflow === 'fit') {
        for (const heading of headings) {
          if (!heading.structured) continue;
          const { subtitleEl } = heading.structured;
          heading.root.style.maxWidth = 'none';
          heading.root.style.whiteSpace = 'nowrap';
          if (subtitleEl) subtitleEl.hidden = false;
          fullWidths.set(heading.tileStart, heading.root.getBoundingClientRect().width);
          if (subtitleEl) {
            subtitleEl.hidden = true;
            titleOnlyWidths.set(heading.tileStart, heading.root.getBoundingClientRect().width);
            subtitleEl.hidden = false; // restored — the real decision happens per final segment, below
          } else {
            titleOnlyWidths.set(heading.tileStart, fullWidths.get(heading.tileStart)!);
          }
        }
      }

      /** [startSection, endSection) into `headings`, sized `tiles[]` range, and that range's own layoutJustified result. */
      type Segment = {
        startSection: number;
        endSection: number;
        tileStart: number;
        tileEnd: number;
        result: JustifiedResult;
      };

      function tileAspects(tileStart: number, tileEnd: number) {
        return tiles.slice(tileStart, tileEnd).map((t) => aspectOf(gallery.items[t.index]));
      }

      /** Runs layoutJustified on sections [startSection, endSection) and checks every label in it fits (full or title-only) its row's available width — null if any doesn't. */
      function tryFit(startSection: number, endSection: number): JustifiedResult | null {
        const tileStart = headings[startSection]!.tileStart;
        const tileEnd =
          endSection < headings.length ? headings[endSection]!.tileStart : tiles.length;
        const result = layoutJustified(tileAspects(tileStart, tileEnd), justifiedOptions);
        for (let k = startSection; k < endSection; k++) {
          const heading = headings[k]!;
          if (!heading.structured) continue; // raw renderHeading content never triggers a break
          const pos = result.positions[heading.tileStart - tileStart];
          if (!pos) continue; // lastRow: 'hide' trailing range within this trial
          const next = k + 1 < endSection ? headings[k + 1] : undefined;
          const nextPos = next ? result.positions[next.tileStart - tileStart] : null;
          const sameRow = !!nextPos && Math.abs(nextPos.y - pos.y) < 0.5;
          const available = (sameRow ? nextPos!.x : containerWidth) - pos.x - config.gutter.x;
          const bestWidth = Math.min(
            fullWidths.get(heading.tileStart) ?? Infinity,
            titleOnlyWidths.get(heading.tileStart) ?? Infinity,
          );
          if (bestWidth > available) return null;
        }
        return result;
      }

      function computeSegments(): Segment[] {
        if (headingOverflow !== 'fit') {
          return [
            {
              startSection: 0,
              endSection: headings.length,
              tileStart: 0,
              tileEnd: tiles.length,
              result: layoutJustified(tileAspects(0, tiles.length), justifiedOptions),
            },
          ];
        }
        const segments: Segment[] = [];
        let segStart = 0;
        while (segStart < headings.length) {
          const base = tryFit(segStart, segStart + 1);
          const tileStart = headings[segStart]!.tileStart;
          if (base === null) {
            // Doesn't fit even alone in its own row — the unavoidable case
            // (a single label wider than the container itself). Nothing
            // narrower to fall back to; take it as its own 1-section
            // segment anyway and let the content-decision pass below
            // ellipsis-truncate it rather than ever wrapping or
            // overflowing.
            const tileEnd =
              segStart + 1 < headings.length ? headings[segStart + 1]!.tileStart : tiles.length;
            segments.push({
              startSection: segStart,
              endSection: segStart + 1,
              tileStart,
              tileEnd,
              result: layoutJustified(tileAspects(tileStart, tileEnd), justifiedOptions),
            });
            segStart += 1;
            continue;
          }
          let end = segStart + 1;
          let best = base;
          while (end < headings.length) {
            const trial = tryFit(segStart, end + 1);
            if (trial === null) break;
            end += 1;
            best = trial;
          }
          const tileEnd = end < headings.length ? headings[end]!.tileStart : tiles.length;
          segments.push({
            startSection: segStart,
            endSection: end,
            tileStart,
            tileEnd,
            result: best,
          });
          segStart = end;
        }
        return segments;
      }

      /** Applies the real drop-subtitle/ellipsis decision for every structured heading in one finalized segment, using its actual computed positions (not a trial). */
      function applyContentDecisions(segment: Segment): void {
        for (let k = segment.startSection; k < segment.endSection; k++) {
          const heading = headings[k]!;
          if (!heading.structured) continue;
          const pos = segment.result.positions[heading.tileStart - segment.tileStart];
          if (!pos) continue;
          const next = k + 1 < segment.endSection ? headings[k + 1] : undefined;
          const nextPos = next
            ? segment.result.positions[next.tileStart - segment.tileStart]
            : null;
          const sameRow = !!nextPos && Math.abs(nextPos.y - pos.y) < 0.5;
          const available = (sameRow ? nextPos!.x : containerWidth) - pos.x - config.gutter.x;

          const { subtitleEl } = heading.structured;
          heading.root.style.whiteSpace = 'nowrap';
          heading.root.style.maxWidth = 'none';
          heading.root.style.overflow = '';
          heading.root.style.textOverflow = '';
          if (subtitleEl) subtitleEl.hidden = false;

          const full = fullWidths.get(heading.tileStart) ?? 0;
          if (full <= available) continue; // fits with subtitle, as-is

          if (subtitleEl) {
            subtitleEl.hidden = true;
            const titleOnly = titleOnlyWidths.get(heading.tileStart) ?? 0;
            if (titleOnly <= available) continue; // fits with subtitle dropped
          }

          // Still too wide title-only — only reachable for a 1-section
          // segment that couldn't be narrowed any further (computeSegments
          // already gave every other case its own row's worth of room).
          // Never wrap: ellipsis-truncate instead, still one line.
          heading.root.style.maxWidth = `${Math.max(0, available)}px`;
          heading.root.style.overflow = 'hidden';
          heading.root.style.textOverflow = 'ellipsis';
        }
      }

      const segments = computeSegments();
      let cumulativeExtra = 0;
      let headingPtr = 0;

      for (const segment of segments) {
        if (headingOverflow === 'fit') applyContentDecisions(segment);

        // Batch-read this segment's heading heights up front, after content
        // decisions are final — see applyMasonry's identical pattern/comment
        // for why reads and writes shouldn't interleave in the same pass.
        const headingHeights = new Map<number, number>();
        for (let k = segment.startSection; k < segment.endSection; k++) {
          const heading = headings[k]!;
          headingHeights.set(heading.tileStart, heading.root.getBoundingClientRect().height);
        }

        for (const row of segment.result.rows) {
          const globalStart = row.start + segment.tileStart;
          const globalEnd = row.end + segment.tileStart;

          let bandHeight = 0;
          while (headingPtr < segment.endSection && headings[headingPtr]!.tileStart < globalEnd) {
            const heading = headings[headingPtr]!;
            const pos = segment.result.positions[heading.tileStart - segment.tileStart];
            if (pos) {
              heading.root.hidden = false;
              heading.root.style.transform = `translate(${pos.x}px, ${row.y + cumulativeExtra}px)`;
              bandHeight = Math.max(bandHeight, headingHeights.get(heading.tileStart) ?? 0);
            }
            headingPtr++;
          }
          if (bandHeight > 0) cumulativeExtra += bandHeight + config.gutter.y;

          for (let i = globalStart; i < globalEnd; i++) {
            const pos = segment.result.positions[i - segment.tileStart];
            const tile = tiles[i]!;
            tile.root.hidden = pos === null;
            if (!pos) continue;
            tile.root.style.width = `${pos.width}px`;
            tile.root.style.height = `${pos.height}px`;
            tile.root.style.visibility = 'visible';
            tile.root.style.transform = `translate(${pos.x}px, ${pos.y + cumulativeExtra}px)`;
          }
        }

        // Tiles beyond this segment's last finalized row (a lastRow: 'hide'
        // trailing range) never got touched above — hide them explicitly.
        const segLastCovered =
          segment.result.rows.length > 0
            ? segment.result.rows[segment.result.rows.length - 1]!.end + segment.tileStart
            : segment.tileStart;
        for (let i = segLastCovered; i < segment.tileEnd; i++) {
          tiles[i]!.root.hidden = true;
        }

        // Advance past this whole segment's own content height, so the
        // next segment's rows (a fresh layoutJustified call, local y
        // starting back at 0) stack directly beneath it.
        cumulativeExtra += segment.result.containerHeight + config.gutter.y;
      }

      // Any heading whose section starts in the very last segment's hidden
      // trailing range never got positioned above — hide it rather than
      // leaving it at its CSS default top:0/left:0.
      while (headingPtr < headings.length) {
        headings[headingPtr]!.root.hidden = true;
        headingPtr++;
      }

      container.style.height = `${Math.max(0, cumulativeExtra - config.gutter.y)}px`;
    }

    /**
     * Unlike masonry's `columnHeights`, a justified row isn't "locked in"
     * until enough tiles arrive to fill it — an appended tile can extend or
     * complete what was the *previous* render's trailing row. Rather than
     * build a second continuation scheme for that, justified always relays
     * out every tile on any items change (append included); see §5.4.
     */
    function applyJustified(): void {
      const containerWidth = container.getBoundingClientRect().width;
      if (containerWidth <= 0) return; // not painted yet — resize observer's initial callback retries once it is

      const config = resolveConfig(containerWidth);
      const justifiedOptions = {
        containerWidth,
        gutterX: config.gutter.x,
        gutterY: config.gutter.y,
        rowHeight: config.rowHeight,
        minRowHeight: config.minRowHeight,
        maxRowHeight: config.maxRowHeight,
        lastRow: config.lastRow,
      };

      if (groupingEnabled && headings.length > 0) {
        applyJustifiedGrouped(justifiedOptions, config, containerWidth);
        return;
      }

      const justifiedTiles = tiles.map((t) => aspectOf(gallery.items[t.index]));
      const result = layoutJustified(justifiedTiles, justifiedOptions);

      tiles.forEach((tile, i) => {
        const pos = result.positions[i];
        tile.root.hidden = pos === null; // lastRow: 'hide' on this pass's trailing tiles
        if (!pos) return;
        tile.root.style.width = `${pos.width}px`;
        tile.root.style.height = `${pos.height}px`;
        tile.root.style.visibility = 'visible';
        tile.root.style.transform = `translate(${pos.x}px, ${pos.y}px)`;
      });

      container.style.height = `${result.containerHeight}px`;
    }

    function relayoutAll(): void {
      if (horizontal) applyMasonryHorizontal();
      else if (type === 'masonry') applyMasonry(null);
      else if (type === 'justified') applyJustified();
      else applyGrid(tiles);
    }

    let destroyed = false;
    let measureFrame: number | null = null;

    /**
     * Coalesces every `autoMeasure` correction landing in the same tick (or
     * the same animation frame — several cached images resolving
     * synchronously back-to-back is the common case) into one relayout,
     * never one per image. `groupingEnabled` needs a real `fullRender()`,
     * not just a reposition pass: `groupBy` was evaluated once already
     * during the first render, using whatever `item.width`/etc. was known
     * *then* — if that's exactly the field a correction just filled in,
     * the section boundaries themselves were computed wrong and only a
     * fresh `computeSections()` call (inside `fullRender`) fixes them, not
     * `relayoutAll()`, which only ever repositions the existing tiles/headings.
     */
    function scheduleMeasureRelayout(): void {
      if (measureFrame !== null || destroyed) return;
      measureFrame = requestAnimationFrame(() => {
        measureFrame = null;
        if (destroyed) return;
        if (groupingEnabled) fullRender(gallery.items);
        else relayoutAll();
      });
    }

    /**
     * DESIGN.md §5's `autoMeasure` option — never blocks or delays the
     * *first* layout pass (already painted with the 4:3 placeholder by the
     * time this runs); only ever corrects it afterward, once a real
     * measurement lands. Reuses each tile's own `<img>` (already fetching
     * for display) rather than a second `new Image()`, so nothing is
     * fetched twice. A `loading="lazy"` tile far off-screen may not
     * resolve for a long time (or ever, if never scrolled to) — harmless,
     * since nothing visible is waiting on it; it simply keeps its 4:3
     * placeholder until/unless it does.
     */
    function autoMeasureTiles(newTiles: readonly Tile[]): void {
      if (!autoMeasureEnabled) return;
      for (const tile of newTiles) {
        const item = gallery.items[tile.index];
        if (!item || (item.width && item.height) || !measurableSrc(item)) continue;

        const onLoad = (): void => {
          if (destroyed) return;
          if (tile.img.naturalWidth > 0 && tile.img.naturalHeight > 0) {
            item.width = tile.img.naturalWidth;
            item.height = tile.img.naturalHeight;
            scheduleMeasureRelayout();
          }
        };
        if (tile.img.complete) onLoad();
        else tile.img.addEventListener('load', onLoad, { once: true });
        // No 'error' listener needed — aspectOf()'s 4:3 fallback already
        // covers an image that never loads; there's nothing to update.
      }
    }

    function fullRender(items: readonly GalleryItem[]): void {
      container.replaceChildren();
      tiles = items.map((item, i) => createTile(item, i));
      headings = [];
      if (groupingEnabled) {
        for (const section of computeSections(items)) {
          const sectionItems = items.slice(section.startIndex, section.endIndex);
          const { root: headingRoot, structured } = createHeadingRoot(section.key, sectionItems);
          container.appendChild(headingRoot);
          headings.push({ root: headingRoot, tileStart: section.startIndex, structured });
          for (let i = section.startIndex; i < section.endIndex; i++) {
            container.appendChild(tiles[i]!.root);
          }
        }
      } else {
        for (const tile of tiles) container.appendChild(tile.root);
      }
      columnHeights = undefined;
      relayoutAll();
      autoMeasureTiles(tiles);
    }

    function appendRender(newItems: readonly GalleryItem[], startIndex: number): void {
      const newTiles = newItems.map((item, i) => createTile(item, startIndex + i));
      for (const tile of newTiles) container.appendChild(tile.root);
      tiles = [...tiles, ...newTiles];
      if (horizontal)
        applyMasonryHorizontal(); // full relayout — see applyMasonryHorizontal's doc comment
      else if (type === 'masonry') applyMasonry(newTiles);
      else if (type === 'justified')
        applyJustified(); // full relayout — see applyJustified's doc comment
      else applyGrid(newTiles);
      autoMeasureTiles(newTiles);
    }

    fullRender(gallery.items);
    previousItems = gallery.items;

    const offItemsUpdated = ctx.on('itemsUpdated', ({ items }) => {
      if (groupingEnabled) {
        // grouped changes always fully re-render — see the `groupBy` option's doc comment.
        fullRender(items);
      } else if (isPureAppend(previousItems, items)) {
        appendRender(items.slice(previousItems.length), previousItems.length);
      } else {
        fullRender(items);
      }
      previousItems = items;
    });

    // Native CSS grid already reflows its own tile positions responsively —
    // it only needs a resize-driven recompute at all when breakpoints are
    // configured (to re-check whether the container crossed a threshold).
    // Masonry/justified always need one, since they're JS-computed.
    let resizeFrame: number | null = null;
    let resizeObserver: ResizeObserver | undefined;
    if (type === 'masonry' || type === 'justified' || sortedBreakpoints.length > 0) {
      resizeObserver = new ResizeObserver(() => {
        if (resizeFrame !== null) return;
        resizeFrame = requestAnimationFrame(() => {
          resizeFrame = null;
          relayoutAll();
        });
      });
      resizeObserver.observe(container);
    }

    return () => {
      destroyed = true;
      if (measureFrame !== null) cancelAnimationFrame(measureFrame);
      resizeObserver?.disconnect();
      if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
      offItemsUpdated();
      container.classList.remove('shoji-layout', `shoji-layout--${type}`, 'shoji-layout--animate');
      container.style.removeProperty('height');
      container.style.removeProperty('width');
      container.replaceChildren();
    };
  },
};
