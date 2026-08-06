import Shoji from '../../src/index';
import type { Gallery, GalleryItem } from '../../src/core';
import { guessMimeType, images, video } from '../media';
import { wireStatus } from '../status';

const container = document.querySelector<HTMLDivElement>('#gallery');
const status = document.querySelector<HTMLParagraphElement>('#status');
const loadMoreBtn = document.querySelector<HTMLButtonElement>('#load-more');
const typeButtons = {
  grid: document.querySelector<HTMLButtonElement>('#type-grid'),
  masonry: document.querySelector<HTMLButtonElement>('#type-masonry'),
  'masonry-horizontal': document.querySelector<HTMLButtonElement>('#type-masonry-horizontal'),
  justified: document.querySelector<HTMLButtonElement>('#type-justified'),
} as const;
const groupByToggle = document.querySelector<HTMLInputElement>('#toggle-group-by');

// Demo-only synthetic "date section" per photo — a real integration would
// derive this from the photo's actual capture/upload date instead.
const SECTIONS = ['Today', 'Yesterday', 'Last week', 'March 2024'];
function sectionFor(index: number): string {
  return SECTIONS[Math.min(Math.floor(index / 3), SECTIONS.length - 1)]!;
}

/**
 * No pre-measuring step here — deliberately. This static file server has
 * nothing but image URLs, no metadata about their dimensions, and this demo
 * doesn't supply `width`/`height` on any item. The Layout plugin's
 * `autoMeasure` option (default `true`, DESIGN.md §5.4) fills them in
 * itself: the *first* layout pass uses a 4:3 placeholder immediately (never
 * blocked on an image load), then each tile's own `<img>` — already
 * fetching for display — gets measured once it loads, and a single
 * coalesced relayout corrects every tile that needed it. A real backend
 * would normally already know each photo's dimensions from upload/processing
 * time and supply them directly (the zero-extra-work, zero-placeholder-frame
 * path) — this demo is deliberately the "you don't have that" case instead,
 * to exercise the fallback.
 */
function buildItems(sources: string[], startAt = 0): GalleryItem[] {
  return sources.map((src, i) => ({
    id: `photo-${src}`,
    src,
    thumb: src,
    caption: `Photo ${i + 1}`,
    data: { section: sectionFor(startAt + i) },
  }));
}

function buildVideoItem(src: string, poster: string): GalleryItem {
  return {
    id: `video-${src}`,
    src,
    poster,
    video: { provider: 'html5' },
    sources: [{ src, type: guessMimeType(src) }],
    caption: 'Sample video',
  };
}

type DemoType = 'grid' | 'masonry' | 'masonry-horizontal' | 'justified';

const LAYOUT_CONFIG: Record<DemoType, Record<string, unknown>> = {
  grid: { type: 'grid', gutter: 8, columnWidth: 220 },
  masonry: { type: 'masonry', gutter: 8, columnWidth: 220, fill: 'shortest' },
  // orientation: 'horizontal' — fixed-height rows packed left-to-right,
  // wrapping to a new row instead of stretching once the next tile would
  // overflow the container (ragged right edge, mirroring vertical masonry's
  // ragged bottom edge). Grows the page downward like every other layout
  // type here — never scrolls sideways, satisfying CLAUDE.md's "gallery
  // must never scroll horizontally".
  'masonry-horizontal': { type: 'masonry', orientation: 'horizontal', gutter: 8, rowHeight: 220 },
  justified: { type: 'justified', gutter: 8, rowHeight: 220, lastRow: 'justify' },
};

function layoutOptionsFor(type: DemoType, grouped: boolean): Record<string, unknown> {
  if (!grouped) return LAYOUT_CONFIG[type];
  return {
    ...LAYOUT_CONFIG[type],
    groupBy: (item: GalleryItem) => (item.data?.section as string | undefined) ?? 'Video',
    // { title, subtitle } is the built-in structured heading form.
    // headingOverflow: 'fit' (default 'show', which always renders both
    // parts in full) opts justified into dropping the subtitle — then
    // pushing the section onto a fresh row (never wrapping the label
    // text) — when a compact label doesn't fit the gap before the next
    // section's label sharing its row; see both options' doc comments in
    // src/plugins/layout/index.ts.
    renderHeading: (key: string) => ({ title: key, subtitle: 'Vancouver, BC' }),
    headingOverflow: 'fit',
  };
}

function main(): void {
  if (!container || !status) return;

  const firstPage = images.slice(0, 12);
  const rest = images.slice(12);

  const firstPageItems = buildItems(firstPage);
  if (video) firstPageItems.push(buildVideoItem(video, images[0]!));

  let currentType: DemoType = 'masonry';
  let grouped = groupByToggle?.checked ?? false;
  // Never reassigned — DESIGN.md §2.7's reinit() rebuilds in place on the
  // same instance, unlike the destroy()-then-reconstruct pattern this demo
  // used before reinit() existed.
  const gallery: Gallery = new Shoji(container, {
    items: firstPageItems,
    plugins: [Shoji.Layout],
    layout: layoutOptionsFor(currentType, grouped),
  });
  wireStatus(gallery, status);

  function setActiveButton(): void {
    for (const [type, btn] of Object.entries(typeButtons)) {
      btn?.classList.toggle('active', type === currentType);
      btn?.setAttribute('aria-current', type === currentType ? 'true' : 'false');
    }
  }
  setActiveButton();

  function rebuild(): void {
    gallery.reinit({
      items: [...gallery.items],
      plugins: [Shoji.Layout],
      layout: layoutOptionsFor(currentType, grouped),
    });
    // reinit() clears the event bus (DESIGN.md §2.7 — host listeners don't
    // survive a hard reset), so the afterOpen subscription wireStatus set up
    // needs re-attaching, same as any other host listener would.
    wireStatus(gallery, status!);
    setActiveButton();
  }

  function switchTo(type: DemoType): void {
    if (type === currentType) return;
    currentType = type;
    rebuild();
  }
  typeButtons.grid?.addEventListener('click', () => switchTo('grid'));
  typeButtons.masonry?.addEventListener('click', () => switchTo('masonry'));
  typeButtons['masonry-horizontal']?.addEventListener('click', () =>
    switchTo('masonry-horizontal'),
  );
  typeButtons.justified?.addEventListener('click', () => switchTo('justified'));

  groupByToggle?.addEventListener('change', () => {
    grouped = groupByToggle.checked;
    rebuild();
  });

  if (rest.length === 0) loadMoreBtn?.remove();
  loadMoreBtn?.addEventListener(
    'click',
    () => {
      const appended = buildItems(rest, firstPage.length);
      gallery.updateSlides([...gallery.items, ...appended]);
      loadMoreBtn.remove(); // one simulated page is enough to demonstrate the append path
    },
    { once: true },
  );
}

main();
