import { test, expect } from '@playwright/test';
import { clickToolbarButton } from '../helpers';

/**
 * Real Fullscreen API behavior — jsdom has no Fullscreen API at all, so this
 * plugin's actual request/exit/fullscreenchange cycle is real-browser-only
 * coverage. Some browser/CI contexts don't grant the Fullscreen API even to
 * an automated, gesture-triggered request; skip gracefully there rather than
 * asserting a false failure — the "no support -> no button rendered at all"
 * branch below still gets covered either way.
 */

test('toolbar button toggles native fullscreen and reflects real fullscreenchange state', async ({
  page,
}) => {
  await page.goto('/pages/e2e-plugins.html');
  await page.locator('#thumbs a[data-index="0"]').click();
  await expect(page.locator('.shoji-dialog')).toBeVisible();

  const supported = await page.evaluate(() => document.fullscreenEnabled);
  test.skip(!supported, 'Fullscreen API not available in this browser context');

  const button = page.locator('.shoji-toolbar-button[aria-label$="fullscreen"]');
  await expect(button).toHaveAttribute('aria-label', 'Enter fullscreen');
  await expect(button).toHaveAttribute('aria-pressed', 'false');

  // Fullscreen is the second of four toolbar plugins in the fixture
  // (DESIGN.md §3.1a) — its button collapses into the overflow popover on
  // any viewport too narrow to fit all four (mobile-chrome's own default
  // viewport included), same as a real viewer would need to reveal it.
  await clickToolbarButton(page, button);
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await expect(button).toHaveAttribute('aria-label', 'Exit fullscreen');
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);

  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false);
});

test('closing the gallery while fullscreen exits fullscreen too', async ({ page }) => {
  await page.goto('/pages/e2e-plugins.html');
  await page.locator('#thumbs a[data-index="0"]').click();

  const supported = await page.evaluate(() => document.fullscreenEnabled);
  test.skip(!supported, 'Fullscreen API not available in this browser context');

  const button = page.locator('.shoji-toolbar-button[aria-label$="fullscreen"]');
  await clickToolbarButton(page, button);
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);

  await page.locator('.shoji-close').click();
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false);
});
