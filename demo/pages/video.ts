import Shoji from '../../src/index';
import { images } from '../media';
import { wireStatus } from '../status';

const gallery = document.querySelector<HTMLDivElement>('#gallery');
const status = document.querySelector<HTMLParagraphElement>('#status');

// "Me at the zoo" — the first video ever uploaded to YouTube, permanently
// preserved; a stable, always-available id for a demo that has to keep
// working in CI and on a fresh clone, unlike locally-dropped demo/assets/.
const YOUTUBE_ID = 'jNQXAC9IVRw';

// "Big Buck Bunny" — Blender Foundation's open-source demo film, uploaded to
// Vimeo by the foundation's own account; the standard open test video used
// across the industry, same permanence reasoning as YOUTUBE_ID above.
const VIMEO_ID = '1084537';
// Vimeo has no img.youtube.com-style predictable thumbnail URL (its real
// one only comes back from an async oEmbed call) — this is that video's own
// oEmbed thumbnail_url, fetched once and hardcoded, same "no runtime
// fetch/no local demo/assets/ dependency" reasoning as YOUTUBE_ID's poster.
const VIMEO_POSTER =
  'https://i.vimeocdn.com/video/20963649-f02817456fc48e7c317ef4c07ba259cd4b40a3649bd8eb50a4418b59ec3f5af5-d_640?region=us';

// A self-contained inline SVG, not a demo/assets/ photo (gitignored, so CI
// and a fresh clone have none) — its only job is sitting between the two
// video tiles below so neither is the other's preload:1 neighbor. Without
// it they're adjacent regardless of how many real photos precede them, and
// both providers' `.shoji-slide-provider-video` containers can be resident
// in the DOM at once, which the e2e tests (locating "the" provider
// container) depend on never happening.
const SPACER_TILE =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#607d8b"/><text x="400" y="300" font-size="120" fill="white" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif">Photo</text></svg>',
  );

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
    </a>
    <a href="${SPACER_TILE}"><img src="${SPACER_TILE}" alt="Photo" loading="lazy" /></a>
    <a
      data-shoji-id="vimeo-1"
      data-shoji-video="https://vimeo.com/${VIMEO_ID}"
      data-shoji-caption="Big Buck Bunny — Blender Foundation's open-source demo film, on Vimeo"
    >
      <img
        src="${VIMEO_POSTER}"
        alt="Big Buck Bunny"
        loading="lazy"
      />
    </a>`;

  const instance = new Shoji(gallery, { plugins: [Shoji.Video, Shoji.Autoplay] });
  wireStatus(instance, status);
}
