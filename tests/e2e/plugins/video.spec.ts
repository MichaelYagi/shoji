import { test, expect } from '@playwright/test';

/**
 * The only e2e coverage in this repo that depends on a real external
 * network call (loading YouTube's own IFrame Player API) — deliberately:
 * confirming a real `<iframe>` actually loads isn't meaningfully testable
 * any other way, and `tests/unit/plugins/video-youtube.test.ts` already
 * covers the provider-renderer logic itself against a mocked `window.YT`.
 * Generous timeouts here account for that real network round trip, not
 * flakiness in Shoji's own code.
 */

test('opens a YouTube slide and loads a real embed, replacing the spinner', async ({ page }) => {
  await page.goto('/pages/video.html');
  await page.locator('#gallery > a').last().click();
  await expect(page.locator('.shoji-dialog')).toBeVisible();

  const container = page.locator('.shoji-slide-provider-video');
  await expect(container).toBeVisible({ timeout: 15000 });
  await expect(container).not.toHaveAttribute('hidden', '');
  await expect(page.locator('.shoji-slide-spinner')).toHaveCount(0);

  const iframe = container.locator('iframe');
  await expect(iframe).toHaveCount(1);
  await expect(iframe).toHaveAttribute('src', /youtube\.com\/embed\/jNQXAC9IVRw/);

  // The caption becomes visible once the slide is genuinely ready — same
  // isActiveReady() gate every other slide type goes through.
  await expect(page.locator('.shoji-caption')).toBeVisible();
  await expect(page.locator('.shoji-caption')).toHaveText(/Me at the zoo/);
});

test('Autoplay plays the YouTube embed and waits for its own ended state, not the fixed interval', async ({
  page,
}) => {
  await page.goto('/pages/video.html');
  await page.locator('#gallery > a').last().click();
  await expect(page.locator('.shoji-dialog')).toBeVisible();

  const container = page.locator('.shoji-slide-provider-video');
  await expect(container).toBeVisible({ timeout: 15000 });

  await page.locator('.shoji-toolbar-button[aria-label="Play slideshow"]').click();

  await expect
    .poll(async () => container.evaluate((el: HTMLElement & { paused?: boolean }) => el.paused), {
      timeout: 10000,
    })
    .toBe(false);

  // The default 5000ms interval must not apply to a video slide — confirm
  // the slideshow is still sitting on the video well past that point.
  await page.waitForTimeout(5500);
  const counter = await page.locator('.shoji-counter').textContent();
  expect(counter).toMatch(/^\d+ \/ \d+$/);
  const [current, total] = counter!.split(' / ').map(Number);
  expect(current).toBe(total); // the video is the last tile in this fixture
});
