import Shoji from '../../src/index';
import type { Gallery, GalleryItem } from '../../src/core';
import { TRANSITION_PRESETS } from '../../src/transitions/presets';
import { images } from '../media';
import { wireStatus } from '../status';

const thumbs = document.querySelector<HTMLDivElement>('#gallery');
const status = document.querySelector<HTMLParagraphElement>('#status');
const modeSelect = document.querySelector<HTMLSelectElement>('#mode-select');

function buildItems(): GalleryItem[] {
  return images.slice(0, 6).map((src, i) => ({
    id: `photo-${i}`,
    src,
    thumb: src,
    caption: `Photo ${i + 1}`,
  }));
}

function renderThumbs(gallery: Gallery, items: GalleryItem[]): void {
  if (!thumbs) return;
  thumbs.innerHTML = items
    .map(
      (item, i) =>
        `<a href="#" data-index="${i}" data-shoji-id="${item.id}"><img src="${item.thumb ?? item.src}" alt="${item.caption ?? ''}" loading="lazy" /></a>`,
    )
    .join('');

  thumbs.querySelectorAll<HTMLAnchorElement>('a[data-index]').forEach((a) => {
    a.addEventListener('click', (event) => {
      event.preventDefault();
      gallery.open(Number(a.dataset.index));
    });
  });
}

if (thumbs && status && modeSelect) {
  const items = buildItems();

  // DESIGN.md §2.5 — every built-in preset name, plus a custom CSS-class-pair
  // mode (my-shutter, defined in transitions.html's own <style>) to prove the
  // "not a built-in? treated as a class pair" fallback works end to end.
  const modeNames = [...Object.keys(TRANSITION_PRESETS), 'my-shutter'];
  modeSelect.innerHTML = modeNames
    .map((name) => `<option value="${name}">${name}</option>`)
    .join('');
  modeSelect.value = 'slide';

  let gallery = new Shoji(thumbs, { items, mode: modeSelect.value });
  renderThumbs(gallery, items);
  wireStatus(gallery, status);

  // mode isn't reactive on a live instance (it's read fresh per navigation,
  // but changing it after construction still needs re-registering plugins/
  // listeners the same way any other option change does) — rebuilding the
  // instance on each dropdown change is simplest and matches how the Layout
  // demo swaps `layout.type` live too.
  modeSelect.addEventListener('change', () => {
    const activeIndex = gallery.currentIndex;
    gallery.destroy();
    gallery = new Shoji(thumbs, { items, mode: modeSelect.value, index: activeIndex });
    renderThumbs(gallery, items);
    wireStatus(gallery, status);
  });
}
