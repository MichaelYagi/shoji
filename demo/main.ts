import Shoji from '../src/index';
import { guessMimeType, images, video } from './media';
import { wireStatus } from './status';

const container = document.querySelector<HTMLDivElement>('#gallery');
const status = document.querySelector<HTMLParagraphElement>('#status');

if (container && status) {
  let html = images
    .map(
      (src, i) => `
        <a href="${src}" data-shoji-caption="Photo ${i + 1}">
          <img src="${src}" alt="Photo ${i + 1}" loading="lazy" />
        </a>`,
    )
    .join('');

  if (video) {
    html += `
      <a data-shoji-id="sample-video">
        <video muted playsinline>
          <source src="${video}" type="${guessMimeType(video)}" />
        </video>
      </a>`;
  }

  container.innerHTML = html;

  // ActiveThumbnail (DESIGN.md §4.2) alongside Autoplay: as the slideshow
  // advances (or the viewer uses the arrow keys), the corresponding
  // thumbnail below gets .shoji-thumb-active — styled in demo.css — and
  // scrolls into view if it's off-screen.
  // Fullscreen (§4): native Fullscreen API toggle for the whole lightbox.
  // RotateFlip (§4): non-destructive view rotate/flip, resets every time you
  // navigate — rotate a photo, then hit next/prev and watch it snap back.
  // Zoom (§4): pinch/double-tap/ctrl+wheel/buttons zoom into the active
  // photo, pan while zoomed, resets every time you navigate.
  const gallery = new Shoji(container, {
    plugins: [
      Shoji.Autoplay,
      Shoji.ActiveThumbnail,
      Shoji.Fullscreen,
      Shoji.RotateFlip,
      Shoji.Zoom,
    ],
  });
  wireStatus(gallery, status);
}
