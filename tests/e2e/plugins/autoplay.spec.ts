import { test, expect, type Page } from '@playwright/test';

/**
 * Real timer-driven advance — the video-interrupt state machine (§4.1) is
 * covered in depth by jsdom unit tests (tests/unit/plugins/autoplay.test.ts)
 * with fake timers; this covers the ordinary (non-video) real-time behavior
 * against the fixture page's 300ms interval (demo/pages/e2e-plugins.ts —
 * short deliberately, so these tests don't need to wait out a real 5s
 * default).
 */

async function openLightbox(page: Page): Promise<void> {
  await page.goto('/pages/e2e-plugins.html');
  await page.locator('#thumbs a[data-index="0"]').click();
  await expect(page.locator('.shoji-dialog')).toBeVisible();
}

test('play button starts auto-advance and flips to a pause label', async ({ page }) => {
  await openLightbox(page);
  const button = page.locator('.shoji-toolbar-button[aria-label="Play slideshow"]');

  await expect(page.locator('.shoji-counter')).toHaveText('1 / 4');
  await button.click();
  await expect(page.locator('.shoji-toolbar-button[aria-label="Pause slideshow"]')).toBeVisible();

  await expect
    .poll(() => page.locator('.shoji-counter').textContent(), { timeout: 3000 })
    .toBe('2 / 4');
});

test('pause stops the advance', async ({ page }) => {
  await openLightbox(page);
  await page.locator('.shoji-toolbar-button[aria-label="Play slideshow"]').click();
  await expect
    .poll(() => page.locator('.shoji-counter').textContent(), { timeout: 3000 })
    .toBe('2 / 4');

  await page.locator('.shoji-toolbar-button[aria-label="Pause slideshow"]').click();
  await expect(page.locator('.shoji-toolbar-button[aria-label="Play slideshow"]')).toBeVisible();

  const afterPause = await page.locator('.shoji-counter').textContent();
  await page.waitForTimeout(700); // several intervals' worth — must not have advanced
  await expect(page.locator('.shoji-counter')).toHaveText(afterPause!);
});

test('Space toggles play/pause', async ({ page }) => {
  await openLightbox(page);

  await page.keyboard.press('Space');
  await expect(page.locator('.shoji-toolbar-button[aria-label="Pause slideshow"]')).toBeVisible();

  await page.keyboard.press('Space');
  await expect(page.locator('.shoji-toolbar-button[aria-label="Play slideshow"]')).toBeVisible();
});

test('loops back to the first slide after the last, by default (loop: true)', async ({ page }) => {
  await page.goto('/pages/e2e-plugins.html');
  await page.locator('#thumbs a[data-index="3"]').click(); // open() no-ops while already open, so open directly at the last item instead of opening then re-clicking
  await expect(page.locator('.shoji-dialog')).toBeVisible();
  await expect(page.locator('.shoji-counter')).toHaveText('4 / 4');

  await page.locator('.shoji-toolbar-button[aria-label="Play slideshow"]').click();
  await expect
    .poll(() => page.locator('.shoji-counter').textContent(), { timeout: 3000 })
    .toBe('1 / 4');
});
