import { test, expect } from '@playwright/test';

/**
 * DESIGN.md §2.4 — a real bug, reported from real usage: completing a
 * horizontal mouse drag-to-navigate closed the gallery immediately
 * afterward, instead of just moving to the next/previous slide.
 * `GestureEngine` correctly calls `setPointerCapture()` once a drag's
 * direction locks (needed so native scroll/back-gesture doesn't fight it),
 * but a captured pointer's *release* still fires a real, ordinary browser
 * `click` event afterward — targeted at the captured element itself
 * (`.shoji-dialog`) regardless of where the pointer visually ends up, not
 * wherever it's actually over. `Gallery.ts`'s click-outside-to-close
 * (`isBackdropClick`) read that retargeted click as "landed on nothing
 * recognizable" and closed the gallery. `tests/unit/GestureEngine.test.ts`
 * covers the suppression mechanism itself with synthetic events (jsdom
 * doesn't synthesize a real click after a captured pointer release the way
 * a real browser does); this confirms the actual real-browser behavior a
 * genuine mouse drag produces end to end.
 */
test('completing a horizontal drag navigates to the next slide and does not close the gallery', async ({
  page,
}) => {
  await page.goto('/pages/e2e-plugins.html');
  await page.locator('#thumbs a[data-index="0"]').click();
  await expect(page.locator('.shoji-dialog')).toBeVisible();
  await expect(page.locator('.shoji-counter')).toHaveText('1 / 4');

  const media = page.locator('.shoji-slide-media:has(img)').first();
  const box = (await media.boundingBox())!;
  const startX = box.x + box.width * 0.8;
  const endX = box.x + box.width * 0.2;
  const y = box.y + box.height / 2;

  await page.mouse.move(startX, y);
  await page.mouse.down();
  await page.mouse.move(endX, y, { steps: 10 });
  await page.mouse.up();

  await expect(page.locator('.shoji-counter')).toHaveText('2 / 4');
  await expect(page.locator('.shoji-dialog')).toBeVisible(); // still open — the bug closed it here
});

test('completing a vertical drag still closes the gallery — the fix only suppresses the click a captured drag leaves behind, it does not disable click-outside-to-close entirely', async ({
  page,
}) => {
  await page.goto('/pages/e2e-plugins.html');
  await page.locator('#thumbs a[data-index="0"]').click();
  await expect(page.locator('.shoji-dialog')).toBeVisible();

  const media = page.locator('.shoji-slide-media:has(img)').first();
  const box = (await media.boundingBox())!;
  const x = box.x + box.width / 2;
  const startY = box.y + box.height * 0.3;
  const endY = box.y + box.height * 0.3 + 200;

  await page.mouse.move(x, startY);
  await page.mouse.down();
  await page.mouse.move(x, endY, { steps: 10 });
  await page.mouse.up();

  await expect(page.locator('.shoji-dialog')).toBeHidden();
});

test('a plain click on the image (no drag at all) is unaffected — still does not close the gallery', async ({
  page,
}) => {
  await page.goto('/pages/e2e-plugins.html');
  await page.locator('#thumbs a[data-index="0"]').click();
  await expect(page.locator('.shoji-dialog')).toBeVisible();

  const media = page.locator('.shoji-slide-media:has(img)').first();
  await media.click();

  await expect(page.locator('.shoji-dialog')).toBeVisible();
  await expect(page.locator('.shoji-counter')).toHaveText('1 / 4'); // no navigation either — a plain click, not a drag
});
