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
