import Shoji from '../../src/index';
import { images } from '../media';
import { wireStatus } from '../status';

const container = document.querySelector<HTMLDivElement>('#gallery');
const status = document.querySelector<HTMLParagraphElement>('#status');

if (container && status) {
  container.innerHTML = images
    .slice(0, 6)
    .map(
      (src, i) => `
        <figure
          data-shoji-src="${src}"
          data-shoji-thumb="${src}"
          data-shoji-caption="Figure ${i + 1}"
          data-shoji-width="1600"
          data-shoji-height="1200"
          data-shoji-metadata-id="meta-${i + 1}"
          data-shoji-album="demo"
        >
          <img src="${src}" alt="Figure ${i + 1}" loading="lazy" />
        </figure>`,
    )
    .join('');

  const gallery = new Shoji(container);
  wireStatus(gallery, status);

  // data-shoji-metadata-id and data-shoji-album above aren't part of any
  // named GalleryItem field — scan.ts (src/core/scan.ts) captures any
  // data-shoji-* attribute it doesn't already have a mapping for into
  // item.data, keyed by the attribute name with the data-shoji- prefix
  // stripped. A real integration would read gallery.items[index].data from
  // a plugin (e.g. to look up a photo's record in its own backend); this
  // just prints it so the mapping is visible.
  const dataDump = document.createElement('p');
  dataDump.id = 'data-dump';
  status.after(dataDump);
  gallery.on('afterOpen', ({ index }) => {
    dataDump.textContent = `item.data: ${JSON.stringify(gallery.items[index]?.data ?? null)}`;
  });
}
