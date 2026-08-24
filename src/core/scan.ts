import type { GalleryItem, GalleryItemInput, MediaSource, VideoDescriptor } from './types';

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
 * alt/.../poster) apart from custom ones — except attributes that fold into
 * a *nested* field (`video-id`/`video-provider` → `item.video.id`/
 * `.provider`, both already applied in `scanVideo` by the time this runs)
 * or have no field of their own at all (`no-drag`, GestureController's
 * drag-opt-out); `key in item` can't see either case, so both are excluded
 * by name instead.
 */
const NO_OWN_DATA_FIELD = new Set(['no-drag', 'video-id', 'video-provider']);

function applyCommon(element: HTMLElement, item: GalleryItem, src: string): void {
  const caption = attr(element, 'data-shoji-caption');
  if (caption) item.caption = caption;
  item.id = attr(element, 'data-shoji-id') ?? src;

  let data: Record<string, string> | undefined;
  for (const a of element.attributes) {
    if (!a.name.startsWith('data-shoji-')) continue;
    const key = a.name.slice(11);
    if (!NO_OWN_DATA_FIELD.has(key) && !(key in item)) (data ??= {})[key] = a.value;
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

/**
 * DESIGN.md §2.1 — a nested `<video>` is always html5; `data-shoji-video`
 * checks known provider hosts first. `data-shoji-video-id`/
 * `data-shoji-video-provider` (both optional) can override what would
 * otherwise be parsed out of that URL — see `resolveExplicitVideo`.
 */
function scanVideo(element: HTMLElement): GalleryItem | undefined {
  const videoIdAttr = attr(element, 'data-shoji-video-id');
  const videoEl = element.querySelector('video');
  if (videoEl) {
    if (videoIdAttr) {
      console.warn(
        `Shoji: data-shoji-video-id="${videoIdAttr}" ignored — no effect on a nested <video> (always html5).`,
      );
    }
    const sources: MediaSource[] = Array.from(videoEl.querySelectorAll('source'))
      .map((s) => ({ src: s.getAttribute('src') ?? '', type: s.getAttribute('type') ?? '' }))
      .filter((s) => s.src);
    const src = videoEl.getAttribute('src') ?? sources[0]?.src;
    if (!src) return undefined;

    const item: GalleryItem = { src, video: { provider: 'html5' } };
    if (sources.length) item.sources = sources;
    const poster = videoEl.getAttribute('poster');
    if (poster) item.poster = poster;
    // Same bug as the data-shoji-video branch below: without this, these
    // fall through into item.data.width/height as strings instead.
    const width = numAttr(element, 'data-shoji-width');
    if (width !== undefined) item.width = width;
    const height = numAttr(element, 'data-shoji-height');
    if (height !== undefined) item.height = height;
    applyCommon(element, item, src);
    return item;
  }

  const videoUrl = attr(element, 'data-shoji-video');
  if (videoUrl) {
    const providerAttr = attr(element, 'data-shoji-video-provider');
    const resolved = resolveExplicitVideo(videoUrl, providerAttr, videoIdAttr);
    const item: GalleryItem = { src: videoUrl, video: resolved.video };
    if (resolved.sources) item.sources = resolved.sources;
    const poster = attr(element, 'data-shoji-poster');
    if (poster) item.poster = poster;
    // A real bug: unlike `scanImage`, this never read these — they fell
    // through into `item.data.width`/`item.data.height` as strings instead
    // of `item.width`/`item.height`, silently losing `applyAspect()`'s
    // aspect-ratio and the open-placeholder's explicit natural-size box for
    // every DOM-mode (`data-shoji-*`) provider-video item.
    const width = numAttr(element, 'data-shoji-width');
    if (width !== undefined) item.width = width;
    const height = numAttr(element, 'data-shoji-height');
    if (height !== undefined) item.height = height;
    applyCommon(element, item, videoUrl);
    return item;
  }

  if (videoIdAttr) {
    console.warn(
      `Shoji: data-shoji-video-id="${videoIdAttr}" ignored — requires a data-shoji-video URL.`,
    );
  }
  return undefined;
}

const KNOWN_VIDEO_PROVIDERS = new Set(['youtube', 'vimeo', 'html5']);

function html5Fallback(url: string): { video: VideoDescriptor; sources: MediaSource[] } {
  return { video: { provider: 'html5' }, sources: [{ src: url, type: guessVideoType(url) }] };
}

/**
 * `data-shoji-video-provider` declares the provider outright — trusts an id
 * even off a non-YouTube/non-Vimeo host (e.g. an internal proxy URL).
 * Mirrors dynamic mode's `video: { provider: '...' }`.
 */
function resolveExplicitVideo(
  url: string,
  providerAttr: string | undefined,
  idAttr: string | undefined,
): { video: VideoDescriptor; sources?: MediaSource[] } {
  if (providerAttr && !KNOWN_VIDEO_PROVIDERS.has(providerAttr)) {
    console.warn(`Shoji: data-shoji-video-provider="${providerAttr}" isn't recognized — ignored.`);
    providerAttr = undefined;
  }

  if (providerAttr === 'html5') {
    if (idAttr)
      console.warn(`Shoji: data-shoji-video-id="${idAttr}" ignored — provider html5 has no id.`);
    return html5Fallback(url);
  }

  const youtube = resolveDetectedProvider(
    'youtube',
    url,
    providerAttr,
    idAttr,
    isYouTubeUrl,
    detectYouTubeId,
  );
  if (youtube) return youtube;
  const vimeo = resolveDetectedProvider(
    'vimeo',
    url,
    providerAttr,
    idAttr,
    isVimeoUrl,
    detectVimeoId,
  );
  if (vimeo) return vimeo;

  if (idAttr) {
    console.warn(
      `Shoji: data-shoji-video-id="${idAttr}" ignored — data-shoji-video="${url}" isn't a recognized YouTube/Vimeo URL; falling back to html5.`,
    );
  }
  return html5Fallback(url);
}

/** Shared logic for youtube/vimeo, the only two providers with URL-based host detection. `undefined` means "not this provider, try the next one"; anything else is final, explicit trusting `idAttr` off any host, unset falling back to html5 quietly. */
function resolveDetectedProvider(
  provider: 'youtube' | 'vimeo',
  url: string,
  providerAttr: string | undefined,
  idAttr: string | undefined,
  isHost: (url: string) => boolean,
  detectId: (url: string) => string | undefined,
): { video: VideoDescriptor; sources?: MediaSource[] } | undefined {
  const explicit = providerAttr === provider;
  if (!explicit && !isHost(url)) return undefined;
  const id = idAttr ?? detectId(url);
  if (!id) {
    if (!explicit) return html5Fallback(url);
    console.warn(
      `Shoji: data-shoji-video-provider="${provider}" but no id could be parsed from "${url}".`,
    );
  }
  return { video: { provider, id, url } };
}

const YOUTUBE_HOSTS = new Set(['youtu.be', 'youtube.com', 'youtube-nocookie.com']);
const VIMEO_HOSTS = new Set(['vimeo.com', 'player.vimeo.com']);

/** Strips the `www.`/`m.`/`music.` subdomain YouTube/Vimeo serve the same content under either way. */
function normalizeVideoHost(hostname: string): string {
  return hostname.replace(/^(www|m|music)\./, '');
}

/** Host-only, weaker than `detectYouTubeId` on purpose — tells "wrong site" (a real misconfig with an explicit id set) apart from "right site, unparsed path" (what an explicit id is for). */
function isYouTubeUrl(url: string): boolean {
  try {
    return YOUTUBE_HOSTS.has(normalizeVideoHost(new URL(url, window.location.href).hostname));
  } catch {
    return false;
  }
}

/** Same reasoning as `isYouTubeUrl`, for Vimeo's two hosts (`vimeo.com` for an ordinary page link, `player.vimeo.com` for an already-embed-shaped URL). */
function isVimeoUrl(url: string): boolean {
  try {
    return VIMEO_HOSTS.has(normalizeVideoHost(new URL(url, window.location.href).hostname));
  } catch {
    return false;
  }
}

/**
 * `youtu.be/{id}`, `watch?v=`, `/embed/`, `/shorts/`, `/live/` (streams/
 * premieres), `/v/` (legacy), on `youtube.com` or `youtube-nocookie.com`
 * (the privacy-enhanced embed domain) — `www.`/`m.`/`music.` subdomains all
 * normalize the same way. `undefined` otherwise.
 */
function detectYouTubeId(url: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url, window.location.href);
  } catch {
    return undefined;
  }
  const host = normalizeVideoHost(parsed.hostname);
  if (host === 'youtu.be') return parsed.pathname.slice(1).split('/')[0] || undefined;
  if (!YOUTUBE_HOSTS.has(host)) return undefined;
  if (parsed.pathname === '/watch') return parsed.searchParams.get('v') ?? undefined;
  const match = parsed.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/?]+)/);
  return match?.[1];
}

/** First numeric path segment on a recognized Vimeo host — covers `vimeo.com/{id}`, `vimeo.com/{id}/{hash}` (unlisted-video privacy hash, kept in `url` not the id), `player.vimeo.com/video/{id}`, and an id buried deeper (`vimeo.com/channels/x/{id}`). `undefined` on an unrecognized host too. */
function detectVimeoId(url: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url, window.location.href);
  } catch {
    return undefined;
  }
  if (!VIMEO_HOSTS.has(normalizeVideoHost(parsed.hostname))) return undefined;
  return parsed.pathname.match(/\/(\d+)(?:\/|$)/)?.[1];
}

/** youtube/vimeo, in host-detection preference order — same pair `resolveDetectedProvider` covers for selector mode. */
const DETECTABLE_PROVIDERS = [
  { provider: 'youtube' as const, isHost: isYouTubeUrl, detectId: detectYouTubeId },
  { provider: 'vimeo' as const, isHost: isVimeoUrl, detectId: detectVimeoId },
];

/**
 * Dynamic mode skips `scanContainer()` entirely, so it never gets the same
 * src-based detection `data-shoji-video`/`data-shoji-video-id` have.
 * Mirrors it here: `video: true` infers the whole descriptor from `src`
 * (youtube or vimeo if the host matches, else html5); `{provider:'youtube'|
 * 'vimeo'}` with no `id` fills in just the id. An explicit `id` always
 * wins. Warns (doesn't throw) when a detectable-provider item ends up with
 * no id — the renderer guards this at render time too, showing a
 * placeholder instead of a broken embed.
 */
export function resolveDynamicVideoItems(items: GalleryItemInput[]): GalleryItem[] {
  return items.map((item): GalleryItem => {
    if (item.video === true) {
      const detected = DETECTABLE_PROVIDERS.find((p) => p.isHost(item.src));
      const video: VideoDescriptor = detected
        ? { provider: detected.provider, id: detected.detectId(item.src) }
        : { provider: 'html5' };
      if ((video.provider === 'youtube' || video.provider === 'vimeo') && !video.id) {
        console.warn(
          `Shoji: item "${item.id ?? item.src}" has video: true, but no id could be parsed from src ("${item.src}") — the embed won't load. Use an explicit video.id instead.`,
        );
      }
      return { ...item, video };
    }
    // TS narrows `item.video` past this point, but not `item`'s own type —
    // hence the cast (the map's `: GalleryItem` annotation is what actually
    // catches a mistake here).
    const resolved = item as GalleryItem;
    const provider = resolved.video?.provider;
    if (provider !== 'youtube' && provider !== 'vimeo') return resolved;
    if (resolved.video && 'id' in resolved.video && resolved.video.id) return resolved;
    const id = DETECTABLE_PROVIDERS.find((p) => p.provider === provider)!.detectId(resolved.src);
    if (!id) {
      console.warn(
        `Shoji: item "${resolved.id ?? resolved.src}" has video.provider: '${provider}' with no id, and src ("${resolved.src}") isn't a recognized ${provider === 'youtube' ? 'YouTube' : 'Vimeo'} URL — the embed won't load. Set video.id explicitly.`,
      );
      return resolved;
    }
    return { ...resolved, video: { provider, id, url: resolved.video?.url } };
  });
}

function guessVideoType(url: string): string {
  const clean = url.split(/[?#]/)[0] ?? url;
  const ext = clean.slice(clean.lastIndexOf('.') + 1).toLowerCase();
  if (ext === 'webm') return 'video/webm';
  if (ext === 'ogg' || ext === 'ogv') return 'video/ogg';
  return 'video/mp4';
}
