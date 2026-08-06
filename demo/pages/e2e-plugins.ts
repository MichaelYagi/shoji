import Shoji from '../../src/index';
import type { Gallery, GalleryItem } from '../../src/core';
import { wireStatus } from '../status';

const thumbs = document.querySelector<HTMLDivElement>('#thumbs');
const status = document.querySelector<HTMLParagraphElement>('#status');

const COLORS = ['#c0392b', '#2980b9', '#27ae60', '#8e44ad'];

/**
 * Self-contained fixture images — inline SVG data URIs, not files under
 * demo/assets/ (gitignored personal media the user drops in locally, absent
 * in CI/a fresh clone). Fixed 800x600, so `width`/`height` are supplied up
 * front and no autoMeasure/decode-driven relayout is in play — deterministic
 * geometry for assertions.
 */
function photoSrc(n: number, color: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="${color}"/><text x="400" y="300" font-size="160" fill="white" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif">${n}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function buildItems(): GalleryItem[] {
  return COLORS.map((color, i) => ({
    id: `photo-${i}`,
    src: photoSrc(i + 1, color),
    thumb: photoSrc(i + 1, color),
    width: 800,
    height: 600,
    caption: `Fixture photo ${i + 1}`,
  }));
}

function renderThumbs(gallery: Gallery, items: GalleryItem[]): void {
  if (!thumbs) return;
  thumbs.innerHTML = items
    .map(
      (item, i) => `
        <a href="#" data-index="${i}" data-shoji-id="${item.id}">
          <img src="${item.thumb}" alt="${item.caption ?? ''}" />
        </a>`,
    )
    .join('');

  thumbs.querySelectorAll<HTMLAnchorElement>('a[data-index]').forEach((a) => {
    a.addEventListener('click', (event) => {
      event.preventDefault();
      gallery.open(Number(a.dataset.index));
    });
  });
}

if (thumbs && status) {
  const items = buildItems();
  const gallery = new Shoji(thumbs, {
    items,
    plugins: [
      Shoji.Zoom,
      Shoji.Fullscreen,
      Shoji.RotateFlip,
      Shoji.Autoplay,
      Shoji.ActiveThumbnail,
    ],
    autoplay: { interval: 300 }, // short — this page exists only for fast, deterministic e2e assertions
  });

  renderThumbs(gallery, items);
  wireStatus(gallery, status);

  // Test-only hook: the DOM has up to `preload * 2 + 1` `.shoji-slide-media`
  // elements at once (SlideManager's pool), so a plain CSS locator can't
  // reliably pick out the *active* one from outside — this exposes the same
  // `getActiveMedia()` every plugin itself uses, so tests/e2e/plugins/*.spec.ts
  // can read it unambiguously instead of guessing DOM order.
  (window as unknown as { __shojiGallery: Gallery }).__shojiGallery = gallery;
}
