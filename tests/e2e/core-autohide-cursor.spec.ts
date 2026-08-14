import { test, expect } from '@playwright/test';
import path from 'node:path';

/**
 * DESIGN.md §2.8 — once the overlay auto-hides, the mouse cursor itself
 * hides too (`cursor: none`), including over the slide media where a
 * plugin (e.g. Zoom) might otherwise set its own cursor affordance
 * (zoom-in/grab) — real CSS cascade/specificity behavior a jsdom unit test
 * can't verify.
 */
const corePath = () => '/@fs' + path.join(process.cwd(), 'src/core/index.ts').replace(/\\/g, '/');

test('cursor hides once controls auto-hide, and comes back once activity reveals them again', async ({
  page,
}) => {
  await page.goto('/pages/e2e-plugins.html');

  await page.evaluate(
    async ({ corePath }) => {
      const { Gallery } = await import(/* @vite-ignore */ corePath);
      const mount = document.createElement('div');
      document.body.appendChild(mount);
      // @ts-expect-error - test-only global, stashed for later cleanup
      window.__testGallery = new Gallery(mount, {
        items: [{ id: 'p', src: 'a.jpg' }],
        autoHideDelay: 2000,
      });
      // @ts-expect-error - test-only global
      window.__testGallery.open(0);
    },
    { corePath: corePath() },
  );

  const dialog = page.locator('.shoji-dialog').last();
  await expect(dialog).not.toHaveClass(/shoji-controls-hidden/);
  await expect(dialog).toHaveCSS('cursor', /^(?!none$)/); // not 'none' yet

  await page.waitForTimeout(2300);

  await expect(dialog).toHaveClass(/shoji-controls-hidden/);
  await expect(dialog).toHaveCSS('cursor', 'none');

  await dialog.dispatchEvent('pointermove');

  await expect(dialog).not.toHaveClass(/shoji-controls-hidden/);
  await expect(dialog).toHaveCSS('cursor', /^(?!none$)/);

  await page.evaluate(() => {
    // @ts-expect-error - test-only global
    window.__testGallery.destroy();
    // @ts-expect-error - test-only global
    delete window.__testGallery;
  });
});

/**
 * DESIGN.md §2.8 — requested directly: `autoHideDelay: 0` means Shoji's own
 * controls stay permanently invisible (a host building fully custom
 * chrome), but that's not a signal the whole gallery should behave like
 * nothing is there — the mouse cursor should stay normal, unlike the
 * ordinary idle-hide case above, where the cursor genuinely does hide along
 * with the controls. Real CSS specificity (`.shoji-cursor-visible`
 * overriding `.shoji-controls-hidden`'s own `cursor: none !important`), not
 * verifiable from a jsdom unit test.
 */
test('autoHideDelay: 0 hides the toolbar but leaves the cursor alone — unlike the ordinary idle-hide case, where the cursor hides too', async ({
  page,
}) => {
  await page.goto('/pages/e2e-plugins.html');

  await page.evaluate(
    async ({ corePath }) => {
      const { Gallery } = await import(/* @vite-ignore */ corePath);
      const mount = document.createElement('div');
      document.body.appendChild(mount);
      // @ts-expect-error - test-only global, stashed for later cleanup
      window.__testGallery = new Gallery(mount, {
        items: [{ id: 'p', src: 'a.jpg' }],
        autoHideDelay: 0,
      });
      // @ts-expect-error - test-only global
      window.__testGallery.open(0);
    },
    { corePath: corePath() },
  );

  const dialog = page.locator('.shoji-dialog').last();
  await expect(dialog).toHaveClass(/shoji-controls-hidden/); // hidden immediately, per autoHideDelay: 0
  await expect(dialog).toHaveCSS('cursor', /^(?!none$)/); // but the cursor itself is untouched

  await page.evaluate(() => {
    // @ts-expect-error - test-only global
    window.__testGallery.destroy();
    // @ts-expect-error - test-only global
    delete window.__testGallery;
  });
});

/**
 * DESIGN.md §2.8 — `autoHideDelay: false` is the real "always visible"
 * value (the opposite of `0`, which hides permanently): the idle timer
 * never arms at all, so controls simply never auto-hide, no matter how
 * long the gallery sits idle. A jsdom unit test (`tests/unit/
 * gallery-autohide.test.ts`) already covers the timer/class logic with
 * fake timers; this confirms it holds over a real wall-clock wait in an
 * actual browser, cursor included.
 */
test('autoHideDelay: false keeps controls (and the cursor) visible indefinitely', async ({
  page,
}) => {
  await page.goto('/pages/e2e-plugins.html');

  await page.evaluate(
    async ({ corePath }) => {
      const { Gallery } = await import(/* @vite-ignore */ corePath);
      const mount = document.createElement('div');
      document.body.appendChild(mount);
      // @ts-expect-error - test-only global, stashed for later cleanup
      window.__testGallery = new Gallery(mount, {
        items: [{ id: 'p', src: 'a.jpg' }],
        autoHideDelay: false,
      });
      // @ts-expect-error - test-only global
      window.__testGallery.open(0);
    },
    { corePath: corePath() },
  );

  const dialog = page.locator('.shoji-dialog').last();
  await expect(dialog).not.toHaveClass(/shoji-controls-hidden/);
  await expect(dialog).toHaveCSS('cursor', /^(?!none$)/);

  await page.waitForTimeout(2300); // well past what a short autoHideDelay would have used above

  await expect(dialog).not.toHaveClass(/shoji-controls-hidden/);
  await expect(dialog).toHaveCSS('cursor', /^(?!none$)/);

  await page.evaluate(() => {
    // @ts-expect-error - test-only global
    window.__testGallery.destroy();
    // @ts-expect-error - test-only global
    delete window.__testGallery;
  });
});
