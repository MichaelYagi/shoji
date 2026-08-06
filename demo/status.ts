import type { Gallery } from '../src/core';

/** Shared "what just happened" line for pages that don't render real slides yet. */
export function wireStatus(gallery: Gallery, statusEl: HTMLElement): void {
  statusEl.textContent = `Loaded ${gallery.items.length} item(s).`;

  gallery.on('afterOpen', ({ index }) => {
    const item = gallery.items[index];
    const kind = item?.video ? 'video' : 'image';
    const label = item?.id ?? item?.src ?? 'unknown';
    statusEl.textContent = `Opened index ${index}: ${kind} (${label})`;
  });
}
