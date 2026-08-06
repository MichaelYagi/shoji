import Shoji from '../../src/index';
import type { Gallery, GalleryItem } from '../../src/core';
import { guessMimeType, images, video } from '../media';
import { wireStatus } from '../status';

const thumbs = document.querySelector<HTMLDivElement>('#thumbs');
const status = document.querySelector<HTMLParagraphElement>('#status');
const shuffleBtn = document.querySelector<HTMLButtonElement>('#shuffle');

function buildItems(): GalleryItem[] {
  const items: GalleryItem[] = images.slice(0, 6).map((src, i) => ({
    id: `photo-${i}`,
    src,
    thumb: src,
    caption: `Photo ${i + 1}`,
  }));

  if (video) {
    items.push({
      id: 'sample-video',
      src: video,
      video: { provider: 'html5' },
      sources: [{ src: video, type: guessMimeType(video) }],
      caption: 'Sample video',
    });
  }

  return items;
}

function renderThumbs(gallery: Gallery, items: GalleryItem[]): void {
  if (!thumbs) return;
  thumbs.innerHTML = items
    .map(
      (item, i) => `
        <a href="#" data-index="${i}">
          ${
            item.video
              ? `<video muted playsinline><source src="${item.src}" type="${guessMimeType(item.src)}" /></video>`
              : `<img src="${item.thumb ?? item.src}" alt="${item.caption ?? ''}" loading="lazy" />`
          }
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
  let currentItems = buildItems();
  const gallery = new Shoji(thumbs, { items: currentItems });

  renderThumbs(gallery, currentItems);
  wireStatus(gallery, status);

  shuffleBtn?.addEventListener('click', () => {
    currentItems = [...currentItems].sort(() => Math.random() - 0.5);
    gallery.updateSlides(currentItems);
    renderThumbs(gallery, currentItems);
  });
}
