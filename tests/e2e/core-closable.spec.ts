import { test, expect } from '@playwright/test';

/**
 * Real-browser coverage for `closable: false` (GalleryOptions) — specifically
 * the close button's `hidden` attribute, which jsdom unit tests can only
 * assert is *present*, not that it actually takes visual effect. It didn't:
 * `.shoji-close`'s own `display: flex` base rule silently outranked the
 * native `[hidden]` UA style (no `.shoji-close[hidden]` override existed,
 * unlike `.shoji-nav`/`.shoji-counter`/`.shoji-caption`, which already had
 * one) — the button stayed visible and clickable despite `hidden` being set.
 * Fixed in `shoji.css`; this test is what would have caught it.
 */
test('closable: false hides the close button (real CSS, not just the attribute) and gates backdrop/Escape, while gallery.close() still works', async ({
  page,
}) => {
  await page.goto('/pages/e2e-plugins.html');

  await page.evaluate(async () => {
    // A non-literal specifier — Vite's dev-server-only /@fs/ path isn't a
    // real module tsc can resolve; building it from a variable (rather than
    // a string literal) keeps the dynamic import() untyped (Promise<any>)
    // instead of erroring at typecheck time.
    const corePath = '/@fs' + '/mnt/c/Users/Michael/Documents/development/shoji/src/core/index.ts';
    const { Gallery } = await import(/* @vite-ignore */ corePath);
    const el = document.createElement('div');
    document.body.appendChild(el);
    const gallery = new Gallery(el, {
      items: [
        { id: 'a', src: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>' },
        { id: 'b', src: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>' },
      ],
      closable: false,
    });
    gallery.open(0);
    (window as unknown as { __closableTestGallery: unknown }).__closableTestGallery = gallery;
  });

  await expect(page.locator('.shoji-outer.shoji-open')).toBeVisible();
  await expect(page.locator('.shoji-close').last()).toBeHidden(); // real computed style, not just the attribute

  await page.locator('.shoji-backdrop').last().click({ force: true });
  await expect(page.locator('.shoji-outer.shoji-open')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.locator('.shoji-outer.shoji-open')).toBeVisible();

  await page.evaluate(() =>
    (
      window as unknown as { __closableTestGallery: { close(): void } }
    ).__closableTestGallery.close(),
  );
  await expect(page.locator('.shoji-outer.shoji-open')).toHaveCount(0);
});
