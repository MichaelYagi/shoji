import { test, expect, type Page } from '@playwright/test';

/**
 * DESIGN.md §2.3a — `videoPlayOverlay` (GalleryOptions) flipped from
 * always-on to opt-in, default `false`: a host supplying its own play
 * affordance for an HTML5 video slide shouldn't get a second, Shoji-drawn
 * button competing with it. Uses `demo/pages/e2e-plugins.ts`'s own
 * `?videoSlide=1` fixture (turns item 0 into an html5 video slide) plus
 * the new `?videoPlayOverlay=1` override.
 */

async function openVideoSlide(page: Page, extraParams = ''): Promise<void> {
  await page.goto(`/pages/e2e-plugins.html?videoSlide=1${extraParams}`);
  await page.locator('#thumbs a[data-index="0"]').click();
  await expect(page.locator('.shoji-dialog')).toBeVisible();
}

test('videoPlayOverlay: false (default) — no overlay button at all on an html5 video slide, native controls only', async ({
  page,
}) => {
  await openVideoSlide(page);

  const video = page.locator('.shoji-slide-video');
  await expect(video).toHaveCount(1);
  await expect(video).toHaveJSProperty('controls', true); // native controls still present
  await expect(page.locator('.shoji-video-play-overlay')).toHaveCount(0);
});

test('videoPlayOverlay: true — the overlay button renders over a paused video, and clicking it calls play() without an unhandled rejection', async ({
  page,
}) => {
  // This fixture's video item has no real playable source (it reuses the
  // thumbnail's own SVG data URI, per demo/pages/e2e-plugins.ts's
  // ?videoSlide=1) — genuine playback isn't what this test is about (no
  // e2e test in this repo asserts real HTML5 <video> playback for that
  // reason; see the nonexistent.mp4 fixtures elsewhere). What matters
  // here is the opt-in overlay's own presence and click wiring.
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await openVideoSlide(page, '&videoPlayOverlay=1');

  const overlay = page.locator('.shoji-video-play-overlay');
  await expect(overlay).toBeVisible();
  await expect(overlay).not.toHaveAttribute('hidden', '');

  await overlay.click();
  await page.waitForTimeout(200); // let a rejected play() settle
  expect(pageErrors).toEqual([]); // DESIGN.md §2.3a — play().catch(() => {}) swallows NotSupportedError
});
