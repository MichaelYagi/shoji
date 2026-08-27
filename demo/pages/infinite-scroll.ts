import Shoji from '../../src/index';
import type { Gallery, GalleryItem } from '../../src/core';
import { guessMimeType, images, video } from '../media';
import { wireStatus } from '../status';

const PAGE_SIZE = 4;
const SIMULATED_LATENCY = 500;

/**
 * Stands in for shashin's real paginated endpoint
 * (`GET /accessed/mediatype/:type/page/:n`) — chunks the same real photos
 * every other demo page uses, with an artificial delay so the loading state
 * is actually observable. Page 2 (if it exists) gets the sample video mixed
 * in, to prove a video item survives an `updateSlides()` append.
 */
function fetchPage(page: number): Promise<GalleryItem[]> {
  const start = (page - 1) * PAGE_SIZE;
  const slice = images.slice(start, start + PAGE_SIZE);
  const items: GalleryItem[] = slice.map((src, i) => ({
    id: `page-${page}-${i}`,
    src,
    thumb: src,
    caption: `Page ${page}, item ${i + 1}`,
  }));

  if (page === 2 && video) {
    items.push({
      id: 'sample-video',
      src: video,
      thumb: images[0], // grid thumbnail — this page's own renderThumb() reads item.thumb
      poster: images[0], // lightbox slide — SlideManager reads item.poster, a separate field
      video: { provider: 'html5' },
      sources: [{ src: video, type: guessMimeType(video) }],
      caption: 'A video, mixed into the infinite-scroll stream',
    });
  }

  return new Promise((resolve) => setTimeout(() => resolve(items), SIMULATED_LATENCY));
}

/**
 * Ported from a real shashin class (`Accessed`) that drove the reference
 * library's dynamic mode from an infinitely-scrolling, paginated grid. What changed
 * in the port, and why, per the design discussion this is based on:
 *
 * - `.refresh(mediaContentList)` → `gallery.updateSlides(this.items)`.
 * - The hand-maintained running index (`lastLgIndex`, with a comment
 *   about DOM order needing to match array order for next/prev to work)
 *   is gone entirely — `updateSlides()` diffs by `id`, so nothing needs
 *   manual index bookkeeping.
 * - `shashin.lg` / its old instance-getter method (a hand-rolled instance
 *   registry) is gone — `this.gallery` is just a class field, same as
 *   `this.page`.
 * - The `reinit()`-at-EOL call is dropped; nothing here suggested Shoji
 *   needs an equivalent, and it wasn't demonstrably necessary in testing.
 * - `lgMetadataDetail`/`lgVideoThumbnail` (shashin's own custom plugins,
 *   never part of Shoji) become plain `gallery.on(...)` listeners — see
 *   the commented extension points below, which intentionally do nothing
 *   beyond logging, since the real hooks are app-specific to shashin.
 * - Date-grouped `<section>` headers are NOT ported: that's DESIGN.md
 *   §5's Layout plugin (not built yet), and was never Shoji's job even in
 *   the original — the grid markup stays 100% host-rendered either way.
 */
class InfiniteScrollGallery {
  private readonly gallery: Gallery;
  private items: GalleryItem[] = [];
  private page = 1;
  private rendering = false; // in-flight de-dupe, same role as shashin's `this.rendering`
  private eol = false;
  private readonly observer: IntersectionObserver;

  constructor(
    private readonly grid: HTMLElement,
    private readonly sentinel: HTMLElement,
    private readonly status: HTMLElement,
  ) {
    // Dynamic mode: no DOM scanning, this class owns rendering the grid itself.
    this.gallery = new Shoji(grid, { items: this.items, counter: false });
    wireStatus(this.gallery, status);

    // Extension points where shashin's lgMetadataDetail/lgVideoThumbnail
    // plugins would hook in today, as gallery.on(...) listeners instead of
    // registered plugins — see the class doc comment above.
    this.gallery.on('afterOpen', ({ index }) => {
      console.log('[metadata modal would open here]', this.items[index]?.id);
    });

    // No separate "seed page 1" call on purpose: observe() itself delivers
    // an initial notification reflecting the sentinel's current visibility,
    // and the sentinel is visible (nothing above it yet) from the very
    // first frame — that's what loads page 1. A second, explicit seed call
    // here would race it: whichever wins sets `rendering`, silently
    // swallowing the other, and since IntersectionObserver only fires on
    // *state changes* (not "still visible"), a sentinel that never leaves
    // the viewport — true on a short first page — would then never fire
    // again, i.e. infinite scroll would silently load exactly one page.
    this.observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) void this.loadNextPage();
    });
    this.observer.observe(sentinel);
  }

  private renderThumb(item: GalleryItem): HTMLAnchorElement {
    const a = document.createElement('a');
    a.href = '#';
    a.setAttribute('data-shoji-id', item.id!);
    a.innerHTML = item.video
      ? `<video muted playsinline poster="${item.thumb ?? ''}"><source src="${item.src}" type="${guessMimeType(item.src)}" /></video>`
      : `<img src="${item.thumb ?? item.src}" alt="" loading="lazy" />`;

    a.addEventListener('click', (event) => {
      event.preventDefault();
      // id-based lookup, not a captured index — stays correct even after
      // updateSlides() has grown/reordered the list since this thumbnail
      // was rendered (DESIGN.md §2.1 id-diffing is what makes this safe).
      const index = this.items.findIndex((i) => i.id === item.id);
      if (index === -1) return;
      // Both calls, always: open() does the work if closed and no-ops if
      // already open; goTo() does the work if already open (elsewhere) and
      // no-ops if open() just landed on this exact index. Covers both cases
      // without the caller needing to track open/closed state itself.
      this.gallery.open(index);
      this.gallery.goTo(index);
    });

    return a;
  }

  private async loadNextPage(): Promise<void> {
    if (this.rendering || this.eol) return;
    this.rendering = true;
    this.sentinel.textContent = 'Loading…';

    const newItems = await fetchPage(this.page);

    if (newItems.length === 0) {
      this.eol = true;
      this.sentinel.textContent = 'No more photos.';
    } else {
      this.page++;
      this.items = [...this.items, ...newItems];
      this.gallery.updateSlides(this.items);
      for (const item of newItems) this.grid.appendChild(this.renderThumb(item));
      this.sentinel.textContent = 'Scroll for more…';
    }

    // Always reflects total loaded count, even at immediate EOL (e.g. zero
    // demo assets on a fresh checkout) — consistent with every other page.
    this.status.textContent = `Loaded ${this.items.length} item(s).`;
    this.rendering = false;

    // Force a fresh visibility check regardless of whether intersection
    // *state* actually changed — see the constructor comment. Re-observing
    // (not just observing) is what makes this deliver a new notification
    // even if the sentinel was already, and still is, visible.
    if (!this.eol) {
      this.observer.unobserve(this.sentinel);
      this.observer.observe(this.sentinel);
    }
  }
}

const grid = document.querySelector<HTMLDivElement>('#gallery');
const sentinel = document.querySelector<HTMLParagraphElement>('#sentinel');
const status = document.querySelector<HTMLParagraphElement>('#status');

if (grid && sentinel && status) {
  new InfiniteScrollGallery(grid, sentinel, status);
}
