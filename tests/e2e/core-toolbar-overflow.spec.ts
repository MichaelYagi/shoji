import { test, expect, type Page } from '@playwright/test';

/**
 * DESIGN.md §3.1a — once the toolbar's own `right` slot has more buttons
 * than a viewport has room for in one row, they collapse (latest-registered
 * first) into a floating popover behind a caret past the close button,
 * instead of letting the toolbar wrap to a second/third row. Replaces the
 * removed `mobileSettings.controls` (§2.5) as the real, measured-overflow
 * answer to a busy toolbar. `?extraToolbarButtons=<n>` (demo/pages/
 * e2e-plugins.ts) deterministically forces overflow — the fixture's five
 * real plugins don't overflow a normal viewport on their own.
 */

async function openOverflowing(page: Page): Promise<void> {
  // Wide enough that the pinned set itself (maxPinnedToolbarButtons (2) +
  // close + caret = 4 icons) still fits comfortably in one row — this is
  // about the *extra* buttons overflowing, not the pinned ones.
  await page.setViewportSize({ width: 500, height: 700 });
  await page.goto('/pages/e2e-plugins.html?extraToolbarButtons=6');
  await page.locator('#thumbs a[data-index="0"]').click();
  await expect(page.locator('.shoji-dialog')).toBeVisible();
  await expect(page.locator('.shoji-toolbar-overflow').last()).toBeVisible();
}

test('no caret, no popover, when the toolbar fits in one row', async ({ page }) => {
  // Explicit, comfortably-wide viewport — the fixture's five real toolbar
  // plugins (Zoom, Fullscreen, RotateFlip, Autoplay, plus close) already
  // overflow a mobile-emulation project's own default (narrower) viewport,
  // which is the correct, working behavior (that's what this whole feature
  // is for), not something this "fits" case should assume away.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/pages/e2e-plugins.html');
  await page.locator('#thumbs a[data-index="0"]').click();
  await expect(page.locator('.shoji-dialog')).toBeVisible();

  await expect(page.locator('.shoji-toolbar-overflow').last()).toBeHidden();
  await expect(page.locator('.shoji-toolbar-overflow-panel').last()).toBeHidden();
});

test('an overflowing toolbar collapses buttons (latest-registered first) into the popover, keeping close and 2 pinned plugin buttons on the row', async ({
  page,
}) => {
  await openOverflowing(page);

  const closeButton = page.locator('.shoji-close').last();
  const caret = page.locator('.shoji-toolbar-overflow').last();
  await expect(closeButton).toBeVisible();
  await expect(caret).toBeVisible();

  // The row itself stays a single line — the point of collapsing at all.
  const rowHeight = (await closeButton.boundingBox())!.height;
  const toolbarRightHeight = (await page.locator('.shoji-toolbar-right').last().boundingBox())!
    .height;
  expect(toolbarRightHeight).toBeLessThanOrEqual(rowHeight + 1);

  // The fixture registers 15 plugin buttons total (Zoom 3, Fullscreen 1,
  // RotateFlip 4, Autoplay 1, plus the 6 forced extras) — the default
  // maxPinnedToolbarButtons (2) keeps only Zoom's own first 2 pinned; the
  // latest-registered extra button (#5) is nowhere near that front, so
  // it's collapsed into the popover.
  await expect(page.locator('.shoji-toolbar-right [data-e2e-button="5"]')).toHaveCount(0);
  const panel = page.locator('.shoji-toolbar-overflow-panel').last();
  await caret.click();
  await expect(panel).toBeVisible();
  await expect(panel.locator('[data-e2e-button="5"]')).toBeVisible();
});

test('opens the popover on caret click, in a 3-column grid, and closes it on Escape without closing the gallery', async ({
  page,
}) => {
  await openOverflowing(page);
  const caret = page.locator('.shoji-toolbar-overflow').last();
  const panel = page.locator('.shoji-toolbar-overflow-panel').last();

  await caret.click();
  await expect(panel).toBeVisible();
  await expect(caret).toHaveAttribute('aria-expanded', 'true');

  const columns = await panel.evaluate(
    (el) => getComputedStyle(el).gridTemplateColumns.split(' ').length,
  );
  expect(columns).toBe(3);

  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(caret).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.shoji-outer.shoji-open')).toHaveCount(1);
});

test('an outside click closes the popover, but a click on one of its own buttons does not close it or the gallery', async ({
  page,
}) => {
  await openOverflowing(page);
  const caret = page.locator('.shoji-toolbar-overflow').last();
  const panel = page.locator('.shoji-toolbar-overflow-panel').last();

  await caret.click();
  await expect(panel).toBeVisible();

  await panel.locator('[data-e2e-button]').first().click();
  await expect(panel).toBeVisible();
  await expect(page.locator('.shoji-outer.shoji-open')).toHaveCount(1);

  // The counter (toolbar-left) rather than the backdrop — at this viewport
  // width the fixture's slide fills essentially the whole dialog, leaving
  // no backdrop area a real click could land on; the counter is a real
  // "outside the popover" target the same close-on-outside-click listener
  // (registered on .shoji-outer) still covers.
  await page.locator('.shoji-counter').last().click();
  await expect(panel).toBeHidden();
});

test('Tab stays confined to the open popover, and focus returns to the caret on close', async ({
  page,
}) => {
  await openOverflowing(page);
  const caret = page.locator('.shoji-toolbar-overflow').last();
  const panel = page.locator('.shoji-toolbar-overflow-panel').last();

  await caret.click();
  await expect(panel).toBeVisible();

  const focusInPanel = await page.evaluate(
    () =>
      document.querySelector('.shoji-toolbar-overflow-panel')?.contains(document.activeElement) ??
      false,
  );
  expect(focusInPanel).toBe(true);

  await page.keyboard.press('Tab');
  const stillInPanel = await page.evaluate(
    () =>
      document.querySelector('.shoji-toolbar-overflow-panel')?.contains(document.activeElement) ??
      false,
  );
  expect(stillInPanel).toBe(true);

  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  const focusReturned = await page.evaluate(
    () => document.activeElement === document.querySelector('.shoji-toolbar-overflow'),
  );
  expect(focusReturned).toBe(true);
});

test('regression: the popover opens aligned under the caret, not the close button further to its right', async ({
  page,
}) => {
  await openOverflowing(page);
  const caret = page.locator('.shoji-toolbar-overflow').last();
  const closeButton = page.locator('.shoji-close').last();
  const panel = page.locator('.shoji-toolbar-overflow-panel').last();

  await caret.click();
  await expect(panel).toBeVisible();

  const caretBox = (await caret.boundingBox())!;
  const closeBox = (await closeButton.boundingBox())!;
  const panelBox = (await panel.boundingBox())!;
  const paddingRight = await panel.evaluate(
    (el) => parseFloat(getComputedStyle(el).paddingRight) || 0,
  );

  // The panel's own padding sits outside its grid content, so the panel's
  // border-box right edge lands one padding-width past the caret's own
  // right edge — that's what puts the *grid content* (the actual icon
  // columns) flush with the caret, not the panel's outer box. That
  // padding (--shoji-spacing-sm) happens to equal the toolbar's own
  // inter-button gap, so in practice the panel's border-box edge lands
  // exactly flush against the close button's own left edge — real,
  // confirmed behavior, not a bug — hence `toBeLessThanOrEqual`, not a
  // strict `toBeLessThan`: it must never land *past* the close button's
  // edge (an actual overlap), but landing exactly on it is fine.
  expect(panelBox.x + panelBox.width).toBeCloseTo(caretBox.x + caretBox.width + paddingRight, 0);
  expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(closeBox.x + 1);
});

test('regression: the popover grid is as many columns wide as the pinned buttons plus the caret, not a fixed count', async ({
  page,
}) => {
  await openOverflowing(page);
  const caret = page.locator('.shoji-toolbar-overflow').last();
  const panel = page.locator('.shoji-toolbar-overflow-panel').last();

  await caret.click();
  await expect(panel).toBeVisible();

  // openOverflowing()'s fixture keeps the default maxPinnedToolbarButtons
  // (2) — 2 pinned plugin buttons + the caret itself = 3 columns. The
  // close button is never one of them.
  const columns = await panel.evaluate(
    (el) => getComputedStyle(el).gridTemplateColumns.split(' ').length,
  );
  expect(columns).toBe(3);
});

test('navigating to another slide closes the popover rather than leaving it stranded', async ({
  page,
}) => {
  await openOverflowing(page);
  const caret = page.locator('.shoji-toolbar-overflow').last();
  const panel = page.locator('.shoji-toolbar-overflow-panel').last();

  await caret.click();
  await expect(panel).toBeVisible();

  // Not a keyboard press — while the popover is open, its own keydown
  // handler absorbs every key except Escape (same as the caption modal),
  // so ArrowRight would never reach navigation at all. The nav button is a
  // real <button>, untouched by that keydown interception.
  await page.locator('.shoji-nav-next').last().click();
  await expect(panel).toBeHidden();
});
