import { test, expect } from '@playwright/test';

/**
 * Verifies the plugin finds the real thumbnail via `data-shoji-id` in a real
 * DOM (Gallery.getOriginElement, src/core/Gallery.ts) and keeps it in sync
 * with the real activeIndex as navigation happens — dynamic mode has no
 * scanned-element fallback, so the data-shoji-id lookup path is the one
 * this fixture page actually exercises (demo/pages/e2e-plugins.ts sets it
 * on each thumbnail anchor).
 */

test('the origin thumbnail gets the active class on open and it moves on navigation', async ({
  page,
}) => {
  await page.goto('/pages/e2e-plugins.html');

  const thumb0 = page.locator('#thumbs a[data-shoji-id="photo-0"]');
  const thumb1 = page.locator('#thumbs a[data-shoji-id="photo-1"]');

  await expect(thumb0).not.toHaveClass(/shoji-thumb-active/);
  await thumb0.click();
  await expect(thumb0).toHaveClass(/shoji-thumb-active/);
  await expect(thumb1).not.toHaveClass(/shoji-thumb-active/);

  await page.locator('.shoji-nav-next').click();
  await expect(page.locator('.shoji-counter')).toHaveText('2 / 4');
  await expect(thumb1).toHaveClass(/shoji-thumb-active/);
  await expect(thumb0).not.toHaveClass(/shoji-thumb-active/);
});

test('active class persists after close — the point of a visible marker is seeing it once the lightbox is out of the way, so it no longer clears on close (only a genuinely different slide becoming active moves it)', async ({
  page,
}) => {
  await page.goto('/pages/e2e-plugins.html');
  const thumb0 = page.locator('#thumbs a[data-shoji-id="photo-0"]');

  await thumb0.click();
  await expect(thumb0).toHaveClass(/shoji-thumb-active/);

  await page.locator('.shoji-close').click();
  await expect(thumb0).toHaveClass(/shoji-thumb-active/);
});

test('reopening at a different index highlights that thumbnail, not the previous one', async ({
  page,
}) => {
  await page.goto('/pages/e2e-plugins.html');
  const thumb0 = page.locator('#thumbs a[data-shoji-id="photo-0"]');
  const thumb2 = page.locator('#thumbs a[data-shoji-id="photo-2"]');

  await thumb0.click();
  await page.locator('.shoji-close').click();

  await thumb2.click();
  await expect(thumb2).toHaveClass(/shoji-thumb-active/);
  await expect(thumb0).not.toHaveClass(/shoji-thumb-active/);
});
