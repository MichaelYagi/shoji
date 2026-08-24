import { test, expect, type Page, type Locator } from '@playwright/test';
import path from 'node:path';

const corePath = () => '/@fs' + path.join(process.cwd(), 'src/core/index.ts').replace(/\\/g, '/');

/**
 * `.shoji-slide-video').last()` picked the last `.shoji-slide-video` in DOM
 * order — with `preload:1` (the default) and a real next item to preload,
 * that's the *upcoming* slide's video, not the active one, regardless of
 * looping (preload doesn't require wrap). Confirmed directly: measuring
 * `.last()`'s bounding box here returns the off-screen next-slot video, so
 * every mouse coordinate computed from it lands nowhere near the visible
 * video, and the drag silently does nothing. The active slot's
 * `.shoji-slide` root always carries `translateX(calc(0% ...))`
 * (`SlideManager.ts`'s `applyTransforms`) — the same real, DOM-order-
 * independent discriminator `core-drag-gesture.spec.ts`'s `activeMedia()`
 * uses.
 */
function activeVideo(page: Page): Locator {
  return page.locator('.shoji-slide[style*="calc(0%"] .shoji-slide-video');
}

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
 * Two real bugs found getting this to pass consistently across every
 * browser project in CI (never reproduced locally — this sandbox's e2e
 * harness has its own unrelated networking issue, DESIGN.md's own
 * documented gap class for this kind of thing):
 * 1. An empty/invalid `data:` URI never gives the video real intrinsic
 *    dimensions (fixed above, `TINY_MP4`).
 * 2. Reading `--shoji-video-gesture-margin` back via `getComputedStyle()`
 *    from *this test itself* and computing an exact boundary position
 *    (`rect.bottom - margin ± a few px`) was itself a second, independent
 *    source of imprecision — close enough to the real boundary that
 *    cross-browser sub-pixel/rendering differences could land a "should
 *    be just outside the margin" point on the wrong side of it. Dropped
 *    entirely: the two "should engage" tests below start at the video's
 *    own *top* edge, and the two "should be ignored" tests start at its
 *    very *bottom* edge — unambiguously on the correct side of any
 *    plausible margin value, not dependent on computing the boundary at
 *    all.
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
  await activeVideo(page).evaluate(
    (el) =>
      new Promise<void>((resolve) => {
        const video = el as HTMLVideoElement;
        if (video.readyState >= 1) return resolve();
        video.addEventListener('loadedmetadata', () => resolve(), { once: true });
      }),
  );
}

/**
 * Real, confirmed Firefox limitation, not a Shoji bug: with `video.controls
 * = true` (`SlideManager.ts`'s `renderVideo`, deliberate — real native
 * playback controls, DESIGN.md §4.3), Firefox never dispatches pointerdown
 * (or even a plain `mousedown`) for a synthetic `page.mouse.down()` landing
 * on a `<video controls>` element at all — confirmed directly: toggling
 * `controls` off in the same page restores pointerdown/up immediately,
 * isolating it to Firefox's native-controls UA widget specifically, not
 * this test's coordinates or Shoji's own event wiring (which works
 * correctly on every other engine, chromium/webkit/mobile-chrome/mobile-
 * safari included, and correctly on Firefox too for `<img>`-based drags —
 * see `core-drag-gesture.spec.ts`). No workaround found within Playwright's
 * own input APIs; skipped here rather than left silently failing.
 */
test('a horizontal drag starting at the top of the video (unambiguously above any reserved margin) navigates to the next video slide', async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName === 'firefox',
    'Firefox never fires pointerdown on <video controls> for synthetic input — see comment above',
  );
  await openVideoGallery(page);
  const counter = page.locator('.shoji-counter').last();
  await expect(counter).toHaveText('1 / 2');

  const video = activeVideo(page);
  const box = (await video.boundingBox())!;
  const y = box.y + 10;
  const startX = box.x + box.width * 0.8;
  const endX = box.x + box.width * 0.2;

  await page.mouse.move(startX, y);
  await page.mouse.down();
  await page.mouse.move(endX, y, { steps: 10 });
  await page.mouse.up();

  await expect(counter).toHaveText('2 / 2');
});

test('a horizontal drag starting at the very bottom edge of the video (unambiguously inside any reserved margin) does not navigate — native scrub-bar territory', async ({
  page,
}) => {
  await openVideoGallery(page);
  const counter = page.locator('.shoji-counter').last();
  await expect(counter).toHaveText('1 / 2');

  const video = activeVideo(page);
  const box = (await video.boundingBox())!;
  const y = box.y + box.height - 5;
  const startX = box.x + box.width * 0.8;
  const endX = box.x + box.width * 0.2;

  await page.mouse.move(startX, y);
  await page.mouse.down();
  await page.mouse.move(endX, y, { steps: 10 });
  await page.mouse.up();

  await expect(counter).toHaveText('1 / 2'); // unchanged
});

/** Same real Firefox limitation as the horizontal test above — see that test's own doc comment. */
test('a vertical drag starting at the top of the video (unambiguously above any reserved margin) closes the gallery, same as a photo slide', async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName === 'firefox',
    'Firefox never fires pointerdown on <video controls> for synthetic input — see the horizontal test above',
  );
  await openVideoGallery(page, 1);
  const dialog = page.locator('.shoji-dialog').last();
  await expect(dialog).toBeVisible();

  const video = activeVideo(page);
  const box = (await video.boundingBox())!;
  const startY = box.y + 10;
  const x = box.x + box.width / 2;

  await page.mouse.move(x, startY);
  await page.mouse.down();
  await page.mouse.move(x, startY + 200, { steps: 10 });
  await page.mouse.up();

  await expect(dialog).toBeHidden();
});

test('a vertical drag starting at the very bottom edge of the video (unambiguously inside any reserved margin) does not close — native scrub-bar territory', async ({
  page,
}) => {
  await openVideoGallery(page, 1);
  const dialog = page.locator('.shoji-dialog').last();
  await expect(dialog).toBeVisible();

  const video = activeVideo(page);
  const box = (await video.boundingBox())!;
  const startY = box.y + box.height - 5;
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

  await activeVideo(page).click({ position: { x: 20, y: 20 } });

  await expect(counter).toHaveText('1 / 2');
  await expect(page.locator('.shoji-dialog').last()).toBeVisible();
});
