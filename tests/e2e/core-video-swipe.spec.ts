import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';

const corePath = () => '/@fs' + path.join(process.cwd(), 'src/core/index.ts').replace(/\\/g, '/');

/**
 * A genuinely tiny (1.6 KB), real, valid 640x360 H.264 MP4 (generated via
 * `ffmpeg -f lavfi -i color=c=blue:s=640x360:d=0.1:r=1 ...`, one frame) —
 * not an empty/invalid `data:` URI. A real bug found writing this test:
 * with an empty src, the element never gets real intrinsic dimensions and
 * `loadedmetadata` never fires, so `<video>`'s rendered size (governed by
 * `aspect-ratio` alone with no natural size to resolve against, per
 * `.shoji-slide-video`'s `max-width/max-height: 100%; object-fit: contain`)
 * can land far smaller than `item.width`/`item.height` would suggest —
 * self-contained, no dependency on `demo/assets/` (gitignored personal
 * media, same reasoning `demo/pages/e2e-plugins.ts`'s own inline-SVG photo
 * fixtures document).
 */
const TINY_MP4 =
  'data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAMXbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAA+gAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAkJ0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAA+gAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAoAAAAFoAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAPoAAAAAAABAAAAAAG6bWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAABAAAAAQABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABZW1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAASVzdGJsAAAAwXN0c2QAAAAAAAAAAQAAALFhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAoABaABIAAAASAAAAAAAAAABFUxhdmM2MS4xOS4xMDEgbGlieDI2NAAAAAAAAAAAAAAAGP//AAAAN2F2Y0MBZAAW/+EAGmdkABas2UCgL/lwEQAAAwABAAADAAIPFi2WAQAGaOvjyyLA/fj4AAAAABBwYXNwAAAAAQAAAAEAAAAUYnRydAAAAAAAABi4AAAAAAAAABhzdHRzAAAAAAAAAAEAAAABAABAAAAAABxzdHNjAAAAAAAAAAEAAAABAAAAAQAAAAEAAAAUc3RzegAAAAAAAAMXAAAAAQAAABRzdGNvAAAAAAAAAAEAAANHAAAAYXVkdGEAAABZbWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAbWRpcmFwcGwAAAAAAAAAAAAAAAAsaWxzdAAAACSpdG9vAAAAHGRhdGEAAAABAAAAAExhdmY2MS43LjEwMwAAAAhmcmVlAAADH21kYXQAAAKuBgX//6rcRem95tlIt5Ys2CDZI+7veDI2NCAtIGNvcmUgMTY0IHIzMTA4IDMxZTE5ZjkgLSBILjI2NC9NUEVHLTQgQVZDIGNvZGVjIC0gQ29weWxlZnQgMjAwMy0yMDIzIC0gaHR0cDovL3d3dy52aWRlb2xhbi5vcmcveDI2NC5odG1sIC0gb3B0aW9uczogY2FiYWM9MSByZWY9MyBkZWJsb2NrPTE6MDowIGFuYWx5c2U9MHgzOjB4MTEzIG1lPWhleCBzdWJtZT03IHBzeT0xIHBzeV9yZD0xLjAwOjAuMDAgbWl4ZWRfcmVmPTEgbWVfcmFuZ2U9MTYgY2hyb21hX21lPTEgdHJlbGxpcz0xIDh4OGRjdD0xIGNxbT0wIGRlYWR6b25lPTIxLDExIGZhc3RfcHNraXA9MSBjaHJvbWFfcXBfb2Zmc2V0PS0yIHRocmVhZHM9MTEgbG9va2FoZWFkX3RocmVhZHM9MSBzbGljZWRfdGhyZWFkcz0wIG5yPTAgZGVjaW1hdGU9MSBpbnRlcmxhY2VkPTAgYmx1cmF5X2NvbXBhdD0wIGNvbnN0cmFpbmVkX2ludHJhPTAgYmZyYW1lcz0zIGJfcHlyYW1pZD0yIGJfYWRhcHQ9MSBiX2JpYXM9MCBkaXJlY3Q9MSB3ZWlnaHRiPTEgb3Blbl9nb3A9MCB3ZWlnaHRwPTIga2V5aW50PTI1MCBrZXlpbnRfbWluPTEgc2NlbmVjdXQ9NDAgaW50cmFfcmVmcmVzaD0wIHJjX2xvb2thaGVhZD00MCByYz1jcmYgbWJ0cmVlPTEgY3JmPTIzLjAgcWNvbXA9MC42MCBxcG1pbj0wIHFwbWF4PTY5IHFwc3RlcD00IGlwX3JhdGlvPTEuNDAgYXE9MToxLjAwAIAAAABhZYiEABX//uzPfgU3IDyL9ZQIdLVudeOY06aGeK6v9N6hcRjDjyW4AAADAAADAAAF4/JsjfdiAPBjYAAAGpAC3BAwgAUIRUQcRoZwlRCx0jJAAAADAAADAAADAAADAABAQQ==';

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
 *
 * Y coordinates below are computed from the *real*, measured margin
 * boundary (`rect.bottom - marginPx`, both read live from the page) rather
 * than an assumed absolute pixel offset — robust to whatever the video
 * actually renders at, not just the `item.width`/`item.height` declared.
 * Clamped to stay within the video's own bounds either way.
 */
async function openVideoGallery(page: Page, itemCount = 2): Promise<void> {
  await page.goto('/pages/e2e-plugins.html');
  await page.evaluate(
    async ({ corePath, itemCount, src }) => {
      const { Gallery } = await import(/* @vite-ignore */ corePath);
      const el = document.createElement('div');
      document.body.appendChild(el);
      const items = Array.from({ length: itemCount }, (_, i) => ({
        id: String(i),
        src,
        video: { provider: 'html5' },
        width: 640,
        height: 360,
      }));
      const gallery = new Gallery(el, { items });
      gallery.open(0);
    },
    { corePath: corePath(), itemCount, src: TINY_MP4 },
  );
  await expect(page.locator('.shoji-dialog').last()).toBeVisible();
  // Real metadata this time (unlike an empty src) — wait for it so the
  // element has settled into its real intrinsic/aspect-ratio size before
  // any geometry below is measured, not a still-transient one.
  await page
    .locator('.shoji-slide-video')
    .last()
    .evaluate(
      (el) =>
        new Promise<void>((resolve) => {
          const video = el as HTMLVideoElement;
          if (video.readyState >= 1) return resolve();
          video.addEventListener('loadedmetadata', () => resolve(), { once: true });
        }),
    );
}

/** `rect.bottom - marginPx`, both read live in the same `evaluate()` call — no Playwright round-trip staleness between measuring the box and the margin. Clamped 20px inside the video's own top edge, in case the video renders shorter than `marginPx` itself. */
async function marginBoundary(page: Page): Promise<{ boundary: number; box: DOMRect }> {
  return page
    .locator('.shoji-slide-video')
    .last()
    .evaluate((el) => {
      const rect = el.getBoundingClientRect();
      const marginPx = parseFloat(
        getComputedStyle(el).getPropertyValue('--shoji-video-gesture-margin'),
      );
      const margin = Number.isFinite(marginPx) ? marginPx : 0;
      return { boundary: rect.bottom - margin, box: rect.toJSON() };
    });
}

test('a horizontal drag starting above the reserved bottom margin navigates to the next video slide', async ({
  page,
}) => {
  await openVideoGallery(page);
  const counter = page.locator('.shoji-counter').last();
  await expect(counter).toHaveText('1 / 2');

  const { boundary, box } = await marginBoundary(page);
  const y = Math.max(box.y + 5, boundary - 20);
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

  const { boundary, box } = await marginBoundary(page);
  const y = Math.min(box.y + box.height - 5, boundary + 15);
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

  const { boundary, box } = await marginBoundary(page);
  const startY = Math.max(box.y + 5, boundary - 40);
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

  const { boundary, box } = await marginBoundary(page);
  const startY = Math.min(box.y + box.height - 5, boundary + 15);
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
