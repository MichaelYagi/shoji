/** DESIGN.md §9 — inline SVG, stroke = currentColor, matches src/core/icons.ts's convention. A magnifying glass with a +/− in the lens, and a plain expand-corners glyph for "actual size" (distinct from fullscreen's EXPAND_ICON — no diagonal corner arrows, just a frame, so the two aren't visually confusable when both plugins are enabled). */
export const ZOOM_IN_ICON =
  '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="7"/><path d="M21 21l-5.5-5.5M10 7v6M7 10h6"/></svg>';

export const ZOOM_OUT_ICON =
  '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="7"/><path d="M21 21l-5.5-5.5M7 10h6"/></svg>';

export const ZOOM_ACTUAL_SIZE_ICON =
  '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="1"/><path d="M9 15l6-6M9 9h0M15 15h0"/></svg>';
