/** DESIGN.md §9 — inline SVG, stroke = currentColor, matches src/core/icons.ts's convention. A magnifying glass with a +/− in the lens, and a plain expand-corners glyph for "actual size" (distinct from fullscreen's EXPAND_ICON — no diagonal corner arrows, just a frame, so the two aren't visually confusable when both plugins are enabled). */
export const ZOOM_IN_ICON =
  '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="7"/><path d="M21 21l-5.5-5.5M10 7v6M7 10h6"/></svg>';

export const ZOOM_OUT_ICON =
  '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="7"/><path d="M21 21l-5.5-5.5M7 10h6"/></svg>';

/**
 * Live state icons for the actual-size button (index.ts's icon-swap wiring)
 * — a diagonal double-arrow pair, matching the shape of Bootstrap Icons'
 * `arrows-angle-expand`/`arrows-angle-contract` (requested directly), not
 * literally that icon set's own path data. Still distinct from Fullscreen's
 * own EXPAND_ICON/COMPRESS_ICON (fullscreen/icons.ts) despite both being
 * diagonal-corner glyphs: Fullscreen draws four independent corner brackets
 * with no connecting line between them; these draw one continuous diagonal
 * shaft with an arrowhead-style bracket at each end, a different enough
 * shape that the two read as separate icons at a glance, not near-copies of
 * each other.
 */
export const ZOOM_ACTUAL_SIZE_EXPAND_ICON =
  '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 9L3 3M3 8V3h5M15 15l6 6M21 16v5h-5"/></svg>';

export const ZOOM_ACTUAL_SIZE_CONTRACT_ICON =
  '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l6 6M9 3v6H3M21 21l-6-6M15 21v-6h6"/></svg>';
