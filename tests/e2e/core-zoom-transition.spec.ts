import { test, expect } from '@playwright/test';
import path from 'node:path';

/**
 * DESIGN.md §2.3b — a real bug found via reopening the lightbox:
 * `zoomOut()`'s cleanup compared the raw JS-computed transform string
 * (containing an arbitrary float, e.g. `scale(0.10416666666666667)`)
 * against what `target.style.transform` read back after the browser's own
 * CSSOM serializer reformatted it (e.g. `scale(0.104167)`) — those never
 * match for a scale factor without a short, clean decimal, so the
 * "only clear if nothing else touched it" safety check always failed,
 * permanently leaving the shrink transform applied to `.shoji-slide-media`
 * after close(). A jsdom unit test can't reproduce this — it needs a real
 * browser's own CSSOM string formatting.
 */
const corePath = () => '/@fs' + path.join(process.cwd(), 'src/core/index.ts').replace(/\\/g, '/');

test("close() actually clears the zoom-out transform — doesn't leave it stuck on .shoji-slide-media for the next open() to measure", async ({
  page,
}) => {
  await page.goto('/pages/e2e-plugins.html');

  const result = await page.evaluate(
    async ({ corePath }) => {
      const { Gallery } = await import(/* @vite-ignore */ corePath);

      const marker = document.createElement('div');
      marker.setAttribute('data-shoji-id', 'p');
      Object.assign(marker.style, {
        position: 'fixed',
        top: '10px',
        left: '10px',
        width: '100px',
        height: '100px',
      });
      document.body.appendChild(marker);

      const mount = document.createElement('div');
      document.body.appendChild(mount);
      const gallery = new Gallery(mount, {
        items: [{ id: 'p', src: 'a.jpg', width: 800, height: 600 }],
        preload: 0,
      });

      // .shoji-outer is appended to document.body regardless of host
      // container — the fixture page's own (never-opened) gallery is
      // already in the DOM first, so this freshly-constructed one is last.
      const outers = document.querySelectorAll('.shoji-outer');
      const myOuter = outers[outers.length - 1] as HTMLElement;
      const media = myOuter.querySelector('.shoji-slide-media') as HTMLElement;
      const settle = () =>
        new Promise<void>((resolve) => {
          media.addEventListener('transitionend', () => resolve(), { once: true });
          setTimeout(resolve, 500);
        });

      gallery.open(0);
      await settle();

      gallery.close();
      await settle();
      const transformAfterClose = media.style.transform;

      gallery.destroy();
      marker.remove();

      return { transformAfterClose };
    },
    { corePath: corePath() },
  );

  expect(result.transformAfterClose).toBe('');
});
