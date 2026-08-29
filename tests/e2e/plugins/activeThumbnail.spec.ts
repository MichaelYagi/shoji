import { test, expect } from '@playwright/test';
import path from 'node:path';

const corePath = () => '/@fs' + path.join(process.cwd(), 'src/core/index.ts').replace(/\\/g, '/');
const pluginPath = (name: string) =>
  '/@fs' + path.join(process.cwd(), `src/plugins/${name}/index.ts`).replace(/\\/g, '/');

/**
 * Verifies the plugin finds the real thumbnail via `data-shoji-id` in a real
 * DOM (Gallery.getOriginElement, src/core/Gallery.ts) and keeps it in sync
 * with the real activeIndex as navigation happens — dynamic mode has no
 * scanned-element fallback, so the data-shoji-id lookup path is the one
 * this fixture page actually exercises (demo/pages/e2e-plugins.ts sets it
 * on each thumbnail anchor).
 */

test('the origin thumbnail gets the active class on open and it moves on navigation', async ({
  page,
}) => {
  await page.goto('/pages/e2e-plugins.html');

  const thumb0 = page.locator('#thumbs a[data-shoji-id="photo-0"]');
  const thumb1 = page.locator('#thumbs a[data-shoji-id="photo-1"]');

  await expect(thumb0).not.toHaveClass(/shoji-thumb-active/);
  await thumb0.click();
  await expect(thumb0).toHaveClass(/shoji-thumb-active/);
  await expect(thumb1).not.toHaveClass(/shoji-thumb-active/);

  await page.locator('.shoji-nav-next').click();
  await expect(page.locator('.shoji-counter')).toHaveText('2 / 4');
  await expect(thumb1).toHaveClass(/shoji-thumb-active/);
  await expect(thumb0).not.toHaveClass(/shoji-thumb-active/);
});

test('active class persists after close — the point of a visible marker is seeing it once the lightbox is out of the way, so it no longer clears on close (only a genuinely different slide becoming active moves it)', async ({
  page,
}) => {
  await page.goto('/pages/e2e-plugins.html');
  const thumb0 = page.locator('#thumbs a[data-shoji-id="photo-0"]');

  await thumb0.click();
  await expect(thumb0).toHaveClass(/shoji-thumb-active/);

  await page.locator('.shoji-close').click();
  await expect(thumb0).toHaveClass(/shoji-thumb-active/);
});

test('reopening at a different index highlights that thumbnail, not the previous one', async ({
  page,
}) => {
  await page.goto('/pages/e2e-plugins.html');
  const thumb0 = page.locator('#thumbs a[data-shoji-id="photo-0"]');
  const thumb2 = page.locator('#thumbs a[data-shoji-id="photo-2"]');

  await thumb0.click();
  await page.locator('.shoji-close').click();

  await thumb2.click();
  await expect(thumb2).toHaveClass(/shoji-thumb-active/);
  await expect(thumb0).not.toHaveClass(/shoji-thumb-active/);
});

/**
 * A real bug, reported from real usage combining Layout's `animate: true`
 * with this plugin's `highlight`/`highlightFadeDuration`: CSS's
 * `transition` shorthand doesn't merge across separate rules matching the
 * same element — only the highest-specificity one applies, in full,
 * discarding whatever the loser declared. Layout's own
 * `.shoji-layout--*.shoji-layout--animate .shoji-layout-tile` rule (three
 * classes) beat this plugin's plain `.shoji-thumb-active--highlight` (one
 * class) outright on a Layout-rendered tile, silently dropping the
 * outline-color transition entirely — the border still went transparent
 * on schedule, just instantly instead of fading, no matter what
 * `highlightFadeDuration` was set to. A jsdom unit test can't catch this —
 * it needs a real browser's own cascade/specificity resolution
 * (`getComputedStyle().transitionProperty`), not just the inline custom
 * property values `tests/unit/plugins/activeThumbnail.test.ts` already
 * covers. Fixed in `activeThumbnail.css` by re-declaring both transitions
 * together, at higher specificity, for this specific class combination.
 */
test("the highlight fade still animates when Layout's animate:true is also on, not just plain DOM/selector-mode thumbnails", async ({
  page,
}) => {
  await page.goto('/pages/e2e-plugins.html');

  const result = await page.evaluate(
    async ({ corePath, layoutPath, activeThumbnailPath }) => {
      const { Gallery } = await import(/* @vite-ignore */ corePath);
      const { Layout } = await import(/* @vite-ignore */ layoutPath);
      const { ActiveThumbnail } = await import(/* @vite-ignore */ activeThumbnailPath);

      const mount = document.createElement('div');
      mount.style.width = '600px';
      document.body.appendChild(mount);

      const gallery = new Gallery(mount, {
        items: [
          { id: 'a', src: 'a.jpg', width: 800, height: 600 },
          { id: 'b', src: 'b.jpg', width: 800, height: 600 },
        ],
        plugins: [Layout, ActiveThumbnail],
        layout: { type: 'justified', animate: true },
        activeThumbnail: {
          highlight: true,
          highlightDuration: 100,
          highlightFadeDuration: 2000,
          borderColor: 'red',
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 100)); // let Layout render tiles

      gallery.open(0);
      await new Promise((resolve) => setTimeout(resolve, 50));
      gallery.close();

      const tile = mount.querySelector('.shoji-thumb-active') as HTMLElement;
      // No timing dependency at all — this is the actual regression: with
      // the bug, Layout's rule wins the cascade and `transitionProperty`
      // here is just `transform`, missing `outline-color` entirely,
      // regardless of how long anything is waited for afterward.
      const transitionProperty = getComputedStyle(tile).transitionProperty;

      // Comfortably past highlightDuration (100ms), comfortably short of
      // the full 2000ms fade — still mid-fade if the transition actually
      // ran, fully transparent almost immediately after highlightDuration
      // if it didn't (the bug).
      await new Promise((resolve) => setTimeout(resolve, 100 + 800));
      const midFadeColor = getComputedStyle(tile).outlineColor;

      gallery.destroy();
      mount.remove();

      return { transitionProperty, midFadeColor };
    },
    {
      corePath: corePath(),
      layoutPath: pluginPath('layout'),
      activeThumbnailPath: pluginPath('activeThumbnail'),
    },
  );

  expect(result.transitionProperty).toContain('outline-color');
  const match = result.midFadeColor.match(/rgba?\((\d+), 0, 0(?:, ([\d.]+))?\)/);
  expect(match).not.toBeNull();
  const alpha = match![2] !== undefined ? Number(match![2]) : 1;
  expect(alpha).toBeGreaterThan(0.05); // still visibly red mid-fade, not already transparent
});
