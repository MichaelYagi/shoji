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
