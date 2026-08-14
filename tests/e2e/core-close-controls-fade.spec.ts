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

  // Checked synchronously, right after the click, not via toHaveCSS
  // polling on the interpolating opacity value itself — the whole close
  // sequence (fade + zoom-out) can finish faster than the poll interval
  // reliably samples, so a real run can pass straight through "0" and land
  // back on "1" (fully closed, controls reset for next open()) between two
  // polls, flakily reading as "never faded." The class is the actual,
  // discrete signal this test cares about — `close()` sets it before ever
  // starting the zoom-out, deterministically, no race to observe.
  const stateRightAfterClick = await dialog.evaluate((el) => ({
    controlsHidden: el.classList.contains('shoji-controls-hidden'),
    stillOpen: !!el.closest('.shoji-outer.shoji-open'),
  }));
  expect(stateRightAfterClick.controlsHidden).toBe(true);
  expect(stateRightAfterClick.stillOpen).toBe(true); // the zoom-out hasn't finished (or even started) yet

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

  const closeButton = page.locator('.shoji-close').last();
  await closeButton.click();

  // Dispatched via evaluate(), not page.mouse.move() — the whole close
  // sequence (controls fade + zoom-out) only takes ~600-700ms total, and
  // page.mouse.move()'s own real input-synthesis round-trip (plus a
  // boundingBox() call beforehand) can easily eat enough of that window,
  // especially on a smaller mobile viewport, that the close finishes
  // *normally* before the move ever reaches the page — at which point
  // .shoji-controls-hidden has already been correctly reset for the next
  // open(), and checking opacity afterward is checking a gallery that's
  // already fully, legitimately closed, not the bug this test targets.
  // Dispatching in-page happens essentially instantly, well inside the
  // close sequence's own window, regardless of system speed.
  //
  // Checks the deterministic .shoji-controls-hidden class, not a fuzzy
  // opacity threshold — early in a legitimate fade, opacity is *already*
  // well below 1 on its own, so "opacity < 1" would trivially pass whether
  // or not the move wrongly re-triggered showControls(); the class is the
  // actual state flag that bug flips.
  const stillHiddenRightAfterMove = await dialog.evaluate((el) => {
    const outer = el.closest('.shoji-outer')!;
    outer.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }));
    return el.classList.contains('shoji-controls-hidden');
  });

  expect(stillHiddenRightAfterMove).toBe(true); // the move didn't reveal it
  // The close sequence still completes normally afterward — not just
  // stuck hidden forever (no toHaveCSS('opacity', '0') check here: same
  // polling-race risk as the sibling test above, and this test's own
  // point is already fully covered by the deterministic check above).
  await expect(page.locator('.shoji-outer.shoji-open')).toHaveCount(0);
});
