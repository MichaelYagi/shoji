import { test, expect } from '@playwright/test';
import path from 'node:path';

const corePath = () => '/@fs' + path.join(process.cwd(), 'src/core/index.ts').replace(/\\/g, '/');

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

/**
 * DESIGN.md §2.4/§2.6a — a real bug, reported from real usage: completing a
 * vertical swipe-to-close visibly popped the photo back to fully opaque/
 * full-size for a beat before the separate zoom-out-to-thumbnail animation
 * took over — instead of one continuous fade/shrink. The drag's own live
 * feedback (translateY/scale/opacity on `.shoji-slides`, requested directly
 * to move here from `.shoji-dialog` so the toolbar/nav/counter/caption stay
 * anchored in place instead of moving with the photo) used to reset
 * instantly to neutral on release, before the zoom-out even started. Now it
 * eases back to neutral concurrently with the zoom-out instead of snapping
 * first. This can't fully verify the visual result is *smooth* (that needs
 * a human or a screenshot diff), but it confirms the specific regression —
 * an instant, full-opacity frame right after release — doesn't recur.
 */
test('completing a vertical drag does not pop the image back to full opacity before closing', async ({
  page,
}) => {
  await page.goto('/pages/e2e-plugins.html');
  await page.locator('#thumbs a[data-index="0"]').click();
  const dialog = page.locator('.shoji-dialog');
  await expect(dialog).toBeVisible();
  const slides = page.locator('.shoji-slides').last();

  const media = page.locator('.shoji-slide-media:has(img)').first();
  const box = (await media.boundingBox())!;
  const x = box.x + box.width / 2;
  const startY = box.y + box.height * 0.3;
  const endY = startY + 200;

  await page.mouse.move(x, startY);
  await page.mouse.down();
  await page.mouse.move(x, endY, { steps: 10 });
  await page.mouse.up();

  // Immediately after release — before the dialog disappears — opacity
  // must not have snapped back to fully opaque.
  const opacityRightAfterRelease = await slides.evaluate((el) => getComputedStyle(el).opacity);
  expect(Number(opacityRightAfterRelease)).toBeLessThan(1);

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

/**
 * A related real bug found auditing this area for other mouse-specific
 * parity drifts: `.shoji-caption` wasn't in `INTERACTIVE_CONTROL_SELECTOR`
 * (`GestureController.ts`), so a click-drag meant to select/copy caption
 * text got captured as a navigate/close gesture instead — `preventDefault()`
 * on the locked-direction `pointermove` broke native text selection.
 * Confirmed directly: the same drag technique selects real text on a plain
 * `<p>`, but inside `.shoji-caption` it selected almost nothing. Fixed by
 * adding `.shoji-caption` to the shared selector.
 */
test('a mouse drag starting on caption text selects it, instead of being captured as a navigate/close gesture', async ({
  page,
  isMobile,
}) => {
  // Touch text selection is a long-press-then-drag gesture, not a plain
  // drag — genuinely different from the mouse-drag-to-select this covers,
  // so it's out of scope on touch/mobile-emulated projects.
  test.skip(isMobile, 'text-selection-by-drag is a desktop mouse interaction');

  await page.goto('/pages/e2e-plugins.html');
  await page.evaluate(
    async ({ corePath }) => {
      const { Gallery } = await import(/* @vite-ignore */ corePath);
      const el = document.createElement('div');
      document.body.appendChild(el);
      const svg =
        'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"/>';
      const gallery = new Gallery(el, {
        items: [
          {
            id: 'a',
            src: svg,
            caption:
              'A fairly long caption with several words in it that a user might want to select and copy with the mouse',
          },
          { id: 'b', src: svg, caption: 'second' },
        ],
      });
      gallery.open(0);
    },
    { corePath: corePath() },
  );

  const dialog = page.locator('.shoji-dialog').last();
  await expect(dialog).toBeVisible();
  const counter = page.locator('.shoji-counter').last();
  await expect(counter).toHaveText('1 / 2');

  const caption = page.locator('.shoji-caption').last();
  await expect(caption).toBeVisible();
  const box = (await caption.boundingBox())!;
  const startX = box.x + 5;
  const endX = box.x + box.width - 5;
  const y = box.y + box.height / 2;

  await page.mouse.move(startX, y);
  await page.mouse.down();
  await page.mouse.move(endX, y, { steps: 10 });
  await page.mouse.up();

  const selectedText = await page.evaluate(() => window.getSelection()?.toString());
  expect(selectedText).toContain('words');
  await expect(counter).toHaveText('1 / 2'); // no navigation
  await expect(dialog).toBeVisible(); // no close
});

/**
 * DESIGN.md §2.4/§2.8 — requested directly: a vertical drag past the same
 * distance a release would complete the close should hide the toolbar/nav/
 * counter/caption as a live "let go now and this closes" cue, and reveal
 * them again if the drag retreats back toward the original position before
 * release. Unit tests (`tests/unit/gallery-gestures.test.ts`) cover the
 * threshold-crossing logic with synthetic events; this confirms a real
 * mouse drag actually produces it, toolbar opacity included.
 */
test('a vertical drag past the close threshold hides the toolbar, and dragging back reveals it again — without closing', async ({
  page,
}) => {
  await page.goto('/pages/e2e-plugins.html');
  await page.locator('#thumbs a[data-index="0"]').click();
  const dialog = page.locator('.shoji-dialog').last();
  await expect(dialog).toBeVisible();

  const toolbar = page.locator('.shoji-toolbar').last();
  await expect(toolbar).toHaveCSS('opacity', '1');

  const media = page.locator('.shoji-slide-media:has(img)').first();
  const box = (await media.boundingBox())!;
  const x = box.x + box.width / 2;
  const startY = box.y + box.height * 0.3;

  await page.mouse.move(x, startY);
  await page.mouse.down();
  await page.mouse.move(x, startY + 80, { steps: 5 }); // past the default 50px threshold

  await expect(toolbar).toHaveCSS('opacity', '0');
  await expect(dialog).toBeVisible(); // still just a live cue, not closed yet

  await page.mouse.move(x, startY + 10, { steps: 5 }); // retreat back under it, still held down

  await expect(toolbar).toHaveCSS('opacity', '1');

  await page.mouse.up();
  await expect(dialog).toBeVisible(); // released well under threshold — did not close
});

/**
 * DESIGN.md §2.4 — requested directly: while dragging vertically to close,
 * the toolbar/nav overlay should stay anchored in its fixed screen
 * position — only the photo itself moves/shrinks/fades. Previously the
 * drag's live feedback transformed the whole `.shoji-dialog` (toolbar/nav
 * included) as one rigid unit. Unit tests
 * (`tests/unit/gallery-gestures.test.ts`) cover which element gets the
 * inline style; this confirms the toolbar's real on-screen position
 * genuinely doesn't move during a real drag.
 */
test('the toolbar stays visually anchored in place while a vertical drag moves the photo', async ({
  page,
}) => {
  await page.goto('/pages/e2e-plugins.html');
  await page.locator('#thumbs a[data-index="0"]').click();
  const toolbar = page.locator('.shoji-toolbar').last();
  await expect(toolbar).toBeVisible();
  const toolbarBoxBefore = (await toolbar.boundingBox())!;

  const media = page.locator('.shoji-slide-media:has(img)').first();
  const box = (await media.boundingBox())!;
  const x = box.x + box.width / 2;
  const startY = box.y + box.height * 0.3;

  await page.mouse.move(x, startY);
  await page.mouse.down();
  await page.mouse.move(x, startY + 30, { steps: 5 }); // under the controls-hide threshold — toolbar stays visible for this comparison

  const toolbarBoxDuring = (await toolbar.boundingBox())!;
  expect(toolbarBoxDuring.x).toBeCloseTo(toolbarBoxBefore.x, 0);
  expect(toolbarBoxDuring.y).toBeCloseTo(toolbarBoxBefore.y, 0);

  await page.mouse.up();
});
