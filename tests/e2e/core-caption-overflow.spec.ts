import { test, expect } from '@playwright/test';
import path from 'node:path';

/**
 * A real bug, reported from real usage: `.shoji-caption`'s height was
 * unbounded (`width: fit-content`, no `max-height`) — a long enough caption
 * word-wraps until it fills its own `max-width`, then keeps growing taller
 * with every extra line, eventually creeping up over a video slide's native
 * control bar underneath it (same bottom-left corner, same z-index stack).
 * There's no DOM-level fix for "don't cover the browser's own native video
 * controls" — capping the caption's own height (with internal scroll for
 * the overflow) is what keeps its footprint predictable regardless of
 * caption length. See DESIGN.md §2.3a.
 */
test('a very long caption stays height-capped and scrollable, instead of growing over the video controls beneath it', async ({
  page,
}) => {
  await page.goto('/pages/e2e-plugins.html');

  const corePath = '/@fs' + path.join(process.cwd(), 'src/core/index.ts').replace(/\\/g, '/');
  const longCaption = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(30);

  await page.evaluate(
    async ({ corePath, longCaption }: { corePath: string; longCaption: string }) => {
      const { Gallery } = await import(/* @vite-ignore */ corePath);
      const el = document.createElement('div');
      document.body.appendChild(el);
      const gallery = new Gallery(el, {
        // A real video file isn't needed — SlideManager inserts <video>
        // immediately regardless of whether the src ever loads (unlike
        // images, gated on decode()); this test only measures DOM geometry.
        // Not under demo/assets/ on purpose — that folder is gitignored,
        // user-local sample media, absent in CI/a fresh clone.
        items: [
          {
            id: 'v',
            src: 'nonexistent.mp4',
            video: { provider: 'html5' },
            caption: longCaption,
          },
        ],
      });
      gallery.open(0);
      (window as unknown as { __captionTestGallery: unknown }).__captionTestGallery = gallery;
    },
    { corePath, longCaption },
  );

  // .last() — the fixture page's own gallery (closed, but already
  // constructed) has its own empty `.shoji-caption` in the DOM too; this
  // test's freshly-constructed gallery is the one opened just above.
  const caption = page.locator('.shoji-caption').last();
  await expect(caption).toBeVisible();

  const box = (await caption.boundingBox())!;
  const dialogBox = (await page.locator('.shoji-dialog').last().boundingBox())!;

  // The exact cap is a theme-able custom property (--shoji-caption-max-height,
  // shoji.css), not a magic number worth hardcoding here — the regression
  // this guards is "unbounded," so asserting it stays comfortably short of
  // the full dialog height is the meaningful, implementation-detail-free
  // check, not pinning an exact pixel value.
  expect(box.height).toBeLessThan(dialogBox.height * 0.5);

  // The full text is still reachable — scrollable, not truncated/lost.
  const isScrollable = await caption.evaluate((el) => el.scrollHeight > el.clientHeight);
  expect(isScrollable).toBe(true);

  // A point clearly inside the video's own box but below the (now-capped)
  // caption's bottom-left footprint hits the <video> itself, not the
  // caption sitting on top of it — proof the video's native controls in
  // that region are reachable again, not swallowed by an oversized caption.
  const video = page.locator('video.shoji-slide-video').last();
  const videoBox = (await video.boundingBox())!;
  const probeX = videoBox.x + videoBox.width - 20; // right edge of the video, clear of the caption's left-anchored box
  const probeY = videoBox.y + videoBox.height - 10; // bottom edge, where native controls render
  const hitsVideo = await page.evaluate(
    ({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      return el?.tagName === 'VIDEO';
    },
    { x: probeX, y: probeY },
  );
  expect(hitsVideo).toBe(true);
});
