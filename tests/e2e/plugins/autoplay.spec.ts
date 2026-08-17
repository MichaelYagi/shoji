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

/**
 * DESIGN.md §2.6a/§2.8 — a real bug, reported from real usage: the progress
 * bar stayed fully visible through the entire close animation, unlike the
 * toolbar/nav/counter/caption, which all fade out first. It lived outside
 * `.shoji-controls-hidden`'s CSS selector list (autoplay.css is a separate
 * stylesheet from core's shoji.css, easy to miss when that list grows) —
 * fixed by adding it there instead of only its own `[hidden]` rule.
 */
test('the progress bar fades out with the rest of the controls when the close animation starts, instead of staying visible through it', async ({
  page,
}) => {
  await page.goto('/pages/e2e-plugins.html?interval=60000'); // long enough it never advances mid-test
  await page.locator('#thumbs a[data-index="0"]').click();
  await expect(page.locator('.shoji-dialog')).toBeVisible();
  await page.locator('.shoji-toolbar-button[aria-label="Play slideshow"]').click();

  const progress = page.locator('.shoji-autoplay-progress');
  await expect(progress).toBeVisible();
  await expect(progress).toHaveCSS('opacity', '1');

  await page.locator('.shoji-close').click();

  // Checked synchronously, right after the click, not via toHaveCSS polling
  // on the interpolating opacity value — same reasoning as
  // core-close-controls-fade.spec.ts's own tests: the whole close sequence
  // can finish faster than a poll reliably samples, passing straight
  // through the fade and landing back on a fully-closed, reset state
  // (.shoji-controls-hidden removed again by finishClose(), progress bar
  // hidden by Autoplay's own close listener) between polls — flakily
  // reading as "never faded." The class is the deterministic signal.
  const controlsHiddenRightAfterClick = await progress.evaluate((el) =>
    el.closest('.shoji-dialog')!.classList.contains('shoji-controls-hidden'),
  );
  expect(controlsHiddenRightAfterClick).toBe(true);

  // A real opacity sample too, partway through the fade (well under its
  // 300ms duration and the close sequence's ~600-700ms total) — confirms
  // the progress bar's own CSS actually responds to the class landing,
  // not just that the class itself landed on the dialog.
  await page.waitForTimeout(100);
  const midFadeOpacity = await progress.evaluate((el) => Number(getComputedStyle(el).opacity));
  expect(midFadeOpacity).toBeLessThan(1);
});
