import Shoji from '../../src/index';
import { images } from '../media';
import { wireStatus } from '../status';

const container = document.querySelector<HTMLUListElement>('#gallery');
const status = document.querySelector<HTMLParagraphElement>('#status');

if (container && status) {
  container.innerHTML = images
    .slice(0, 6)
    .map(
      (src, i) => `
        <li class="photo-item" data-shoji-src="${src}">
          <img src="${src}" alt="Photo ${i + 1}" loading="lazy" />
        </li>`,
    )
    .join('');

  const gallery = new Shoji(container, { selector: '.photo-item' });
  wireStatus(gallery, status);
}
