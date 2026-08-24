import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';

const corePath = () => '/@fs' + path.join(process.cwd(), 'src/core/index.ts').replace(/\\/g, '/');

/**
 * DESIGN.md §2.4/§4.3 — swipe-to-navigate/drag-to-close over an HTML5 video
 * slide, requested directly: a native `<video controls>`'s own interactive
 * surface (tap-to-toggle, the scrub-bar drag) isn't real DOM Shoji can
 * measure, so it's approximated as a fixed reserved margin along the bottom
 * (`--shoji-video-gesture-margin`, default 56px) — everywhere above it
 * behaves like a photo slide (swipe navigates, vertical drag closes);
 * touches starting inside it are left alone for the browser's own controls.
 * `tests/unit/gallery-gestures-video.test.ts` covers the threshold/margin
 * math with synthetic events; this confirms a real mouse drag against a
 * real, laid-out `<video>` element produces the same behavior end to end.
 * A data: URI src (no real playback needed — these tests are about gesture
 * routing, not the video actually decoding) with explicit width/height, so
 * the element has a known, real on-screen size to compute margin/above-
 * margin coordinates against.
 */
async function openVideoGallery(page: Page, itemCount = 2): Promise<void> {
  await page.goto('/pages/e2e-plugins.html');
  await page.evaluate(
    async ({ corePath, itemCount }) => {
      const { Gallery } = await import(/* @vite-ignore */ corePath);
      const el = document.createElement('div');
      document.body.appendChild(el);
      const items = Array.from({ length: itemCount }, (_, i) => ({
        id: String(i),
        src: 'data:video/mp4;base64,',
        video: { provider: 'html5' },
        width: 640,
        height: 360,
      }));
      const gallery = new Gallery(el, { items });
      gallery.open(0);
    },
    { corePath: corePath(), itemCount },
  );
  await expect(page.locator('.shoji-dialog').last()).toBeVisible();
}

test('a horizontal drag starting above the reserved bottom margin navigates to the next video slide', async ({
  page,
}) => {
  await openVideoGallery(page);
  const counter = page.locator('.shoji-counter').last();
  await expect(counter).toHaveText('1 / 2');

  const video = page.locator('.shoji-slide-video').last();
  const box = (await video.boundingBox())!;
  const margin = 56; // --shoji-video-gesture-margin's default
  const y = box.y + Math.max(0, box.height - margin - 30); // comfortably above the reserved margin
  const startX = box.x + box.width * 0.8;
  const endX = box.x + box.width * 0.2;

  await page.mouse.move(startX, y);
  await page.mouse.down();
  await page.mouse.move(endX, y, { steps: 10 });
  await page.mouse.up();

  await expect(counter).toHaveText('2 / 2');
});

test('a horizontal drag starting inside the reserved bottom margin does not navigate — native scrub-bar territory', async ({
  page,
}) => {
  await openVideoGallery(page);
  const counter = page.locator('.shoji-counter').last();
  await expect(counter).toHaveText('1 / 2');

  const video = page.locator('.shoji-slide-video').last();
  const box = (await video.boundingBox())!;
  const y = box.y + box.height - 15; // well inside the 56px margin
  const startX = box.x + box.width * 0.8;
  const endX = box.x + box.width * 0.2;

  await page.mouse.move(startX, y);
  await page.mouse.down();
  await page.mouse.move(endX, y, { steps: 10 });
  await page.mouse.up();

  await expect(counter).toHaveText('1 / 2'); // unchanged
});

test('a vertical drag starting above the reserved bottom margin closes the gallery, same as a photo slide', async ({
  page,
}) => {
  await openVideoGallery(page, 1);
  const dialog = page.locator('.shoji-dialog').last();
  await expect(dialog).toBeVisible();

  const video = page.locator('.shoji-slide-video').last();
  const box = (await video.boundingBox())!;
  const margin = 56;
  const startY = box.y + Math.max(0, box.height - margin - 60);
  const x = box.x + box.width / 2;

  await page.mouse.move(x, startY);
  await page.mouse.down();
  await page.mouse.move(x, startY + 200, { steps: 10 });
  await page.mouse.up();

  await expect(dialog).toBeHidden();
});

test('a vertical drag starting inside the reserved bottom margin does not close — native scrub-bar territory', async ({
  page,
}) => {
  await openVideoGallery(page, 1);
  const dialog = page.locator('.shoji-dialog').last();
  await expect(dialog).toBeVisible();

  const video = page.locator('.shoji-slide-video').last();
  const box = (await video.boundingBox())!;
  const startY = box.y + box.height - 15; // well inside the 56px margin
  const x = box.x + box.width / 2;

  await page.mouse.move(x, startY);
  await page.mouse.down();
  await page.mouse.move(x, startY + 200, { steps: 10 });
  await page.mouse.up();

  await expect(dialog).toBeVisible();
});

test('a plain click on the video (no drag) is unaffected — still does not navigate or close', async ({
  page,
}) => {
  await openVideoGallery(page);
  const counter = page.locator('.shoji-counter').last();
  await expect(counter).toHaveText('1 / 2');

  await page
    .locator('.shoji-slide-video')
    .last()
    .click({ position: { x: 20, y: 20 } });

  await expect(counter).toHaveText('1 / 2');
  await expect(page.locator('.shoji-dialog').last()).toBeVisible();
});
