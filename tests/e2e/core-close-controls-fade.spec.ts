import { test, expect } from '@playwright/test';

/**
 * DESIGN.md §2.6a — real-usage feedback: closing the lightbox used to run
 * the controls (toolbar/nav/counter/caption) at full opacity for the entire
 * zoom-out-to-thumbnail animation, then vanish everything together in one
 * abrupt cut once it finished — the stationary chrome visually clashed with
 * the shrinking photo underneath it. Controls now fade out first; the
 * zoom-out only starts once that fade genuinely finishes. Unit tests
 * (`tests/unit/gallery-zoom.test.ts`) cover the JS-level sequencing with
 * synthetic events; this confirms the real CSS actually produces it.
 */
test('closing fades the toolbar out before the photo starts visibly shrinking toward its thumbnail', async ({
  page,
}) => {
  await page.goto('/pages/e2e-plugins.html');
  await page.locator('#thumbs a[data-index="0"]').click();
  const dialog = page.locator('.shoji-dialog').last();
  await expect(dialog).toBeVisible();

  const toolbar = page.locator('.shoji-toolbar').last();
  await expect(toolbar).toHaveCSS('opacity', '1');

  await page.locator('.shoji-close').last().click();

  // Mid-close: the toolbar has faded, but the dialog is still around — the
  // zoom-out hasn't been allowed to finish (or even start) yet.
  await expect(toolbar).toHaveCSS('opacity', '0');
  await expect(dialog).toBeVisible();

  // Eventually the whole thing closes.
  await expect(page.locator('.shoji-outer.shoji-open')).toHaveCount(0);
});

/**
 * A real bug, reported from real usage immediately after the fade-first
 * sequencing above shipped: moving the mouse during the close sequence
 * re-showed the just-hidden controls. `onActivity()` (wired to
 * pointermove/pointerdown/touchstart/wheel/focusin, DESIGN.md §2.8) stays
 * attached for the entire close sequence, not torn down until
 * `finishClose()` — a stray mouse move mid-close called its own
 * `showControls()`, undoing the fade this feature exists to guarantee.
 * Fixed by making `onActivity()` a no-op once `close()` has actually
 * started (`isClosing`).
 */
test('moving the mouse during close does not bring the toolbar back', async ({ page }) => {
  await page.goto('/pages/e2e-plugins.html');
  await page.locator('#thumbs a[data-index="0"]').click();
  const dialog = page.locator('.shoji-dialog').last();
  await expect(dialog).toBeVisible();

  const toolbar = page.locator('.shoji-toolbar').last();
  const closeButton = page.locator('.shoji-close').last();
  await closeButton.click();
  await expect(toolbar).toHaveCSS('opacity', '0');

  // Move the mouse elsewhere in the still-open dialog, mid-close.
  const box = (await dialog.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.move(box.x + box.width / 3, box.y + box.height / 3, { steps: 5 });

  await expect(toolbar).toHaveCSS('opacity', '0'); // still hidden — the move didn't reveal it
  await expect(page.locator('.shoji-outer.shoji-open')).toHaveCount(0);
});
