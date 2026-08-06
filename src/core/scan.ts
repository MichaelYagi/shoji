import type { GalleryItem, MediaSource } from './types';

/** DESIGN.md §2.1 zero-config quickstart. */
export const DEFAULT_SELECTOR =
  ':scope > a, :scope > [data-shoji-src], :scope > [data-shoji-video]';

export interface ScannedItem {
  element: HTMLElement;
  item: GalleryItem;
}

export function scanContainer(
  container: HTMLElement,
  selector: string = DEFAULT_SELECTOR,
): ScannedItem[] {
  const elements = Array.from(container.querySelectorAll<HTMLElement>(selector));
  const scanned: ScannedItem[] = [];
  for (const element of elements) {
    const item = scanVideo(element) ?? scanImage(element);
    if (item) scanned.push({ element, item });
  }
  return scanned;
}

function attr(el: Element, name: string): string | undefined {
  return el.getAttribute(name) ?? undefined;
}

function numAttr(el: Element, name: string): number | undefined {
  const raw = el.getAttribute(name);
  if (raw === null) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * `caption`/`id` first, then any other `data-shoji-*` attribute with no
 * matching `GalleryItem` field lands in `item.data`, keyed verbatim (not
 * camelCased) — DESIGN.md §2.1. By this point every named field above is
 * already set, so `key in item` alone tells known suffixes (src/thumb/
 * alt/.../poster) apart from custom ones; `no-drag` (GestureController's
 * drag-opt-out) is the one exception with no field of its own.
 */
function applyCommon(element: HTMLElement, item: GalleryItem, src: string): void {
  const caption = attr(element, 'data-shoji-caption');
  if (caption) item.caption = caption;
  item.id = attr(element, 'data-shoji-id') ?? src;

  let data: Record<string, string> | undefined;
  for (const a of element.attributes) {
    if (!a.name.startsWith('data-shoji-')) continue;
    const key = a.name.slice(11);
    if (key !== 'no-drag' && !(key in item)) (data ??= {})[key] = a.value;
  }
  if (data) item.data = data;
}

function scanImage(element: HTMLElement): GalleryItem | undefined {
  const src = attr(element, 'href') ?? attr(element, 'data-shoji-src');
  if (!src) return undefined;

  const item: GalleryItem = { src };
  const img = element.querySelector('img');
  const thumb = img?.getAttribute('src') ?? attr(element, 'data-shoji-thumb');
  if (thumb) item.thumb = thumb;
  const alt = img?.getAttribute('alt') ?? attr(element, 'data-shoji-alt');
  if (alt) item.alt = alt;
  const width = numAttr(element, 'data-shoji-width');
  if (width !== undefined) item.width = width;
  const height = numAttr(element, 'data-shoji-height');
  if (height !== undefined) item.height = height;
  // On the wrapping element, not the inner <img> (that's the thumb; `src`
  // above is the full-resolution image, so it needs its own attribute).
  const srcset = attr(element, 'data-shoji-srcset');
  if (srcset) item.srcset = srcset;
  const sizes = attr(element, 'data-shoji-sizes');
  if (sizes) item.sizes = sizes;
  applyCommon(element, item, src);
  return item;
}

/** DESIGN.md §2.1 "Video detection" — html5 only; provider URLs are Video-plugin territory. */
function scanVideo(element: HTMLElement): GalleryItem | undefined {
  const videoEl = element.querySelector('video');
  if (videoEl) {
    const sources: MediaSource[] = Array.from(videoEl.querySelectorAll('source'))
      .map((s) => ({ src: s.getAttribute('src') ?? '', type: s.getAttribute('type') ?? '' }))
      .filter((s) => s.src);
    const src = videoEl.getAttribute('src') ?? sources[0]?.src;
    if (!src) return undefined;

    const item: GalleryItem = { src, video: { provider: 'html5' } };
    if (sources.length) item.sources = sources;
    const poster = videoEl.getAttribute('poster');
    if (poster) item.poster = poster;
    applyCommon(element, item, src);
    return item;
  }

  const videoUrl = attr(element, 'data-shoji-video');
  if (videoUrl) {
    const item: GalleryItem = {
      src: videoUrl,
      video: { provider: 'html5' },
      sources: [{ src: videoUrl, type: guessVideoType(videoUrl) }],
    };
    const poster = attr(element, 'data-shoji-poster');
    if (poster) item.poster = poster;
    applyCommon(element, item, videoUrl);
    return item;
  }

  return undefined;
}

function guessVideoType(url: string): string {
  const clean = url.split(/[?#]/)[0] ?? url;
  const ext = clean.slice(clean.lastIndexOf('.') + 1).toLowerCase();
  if (ext === 'webm') return 'video/webm';
  if (ext === 'ogg' || ext === 'ogv') return 'video/ogg';
  return 'video/mp4';
}
