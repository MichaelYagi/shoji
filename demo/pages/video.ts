import Shoji from '../../src/index';
import { images } from '../media';
import { wireStatus } from '../status';

const gallery = document.querySelector<HTMLDivElement>('#gallery');
const status = document.querySelector<HTMLParagraphElement>('#status');

// "Me at the zoo" — the first video ever uploaded to YouTube, permanently
// preserved; a stable, always-available id for a demo that has to keep
// working in CI and on a fresh clone, unlike locally-dropped demo/assets/.
const YOUTUBE_ID = 'jNQXAC9IVRw';

if (gallery && status) {
  const photoTiles = images
    .slice(0, 3)
    .map(
      (src, i) => `<a href="${src}"><img src="${src}" alt="Photo ${i + 1}" loading="lazy" /></a>`,
    )
    .join('');

  gallery.innerHTML = `${photoTiles}
    <a
      data-shoji-id="yt-1"
      data-shoji-video="https://youtu.be/${YOUTUBE_ID}"
      data-shoji-caption="Me at the zoo — the first video ever uploaded to YouTube"
    >
      <img
        src="https://img.youtube.com/vi/${YOUTUBE_ID}/hqdefault.jpg"
        alt="Me at the zoo"
        loading="lazy"
      />
    </a>`;

  const instance = new Shoji(gallery, { plugins: [Shoji.Video, Shoji.Autoplay] });
  wireStatus(instance, status);
}
