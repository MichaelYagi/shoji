import { test, expect, type Page } from '@playwright/test';

/**
 * Real CSS transform composition — the normalization math itself is unit
 * tested (tests/unit/rotateFlipNormalize.test.ts); this verifies the actual
 * transform string lands on the real DOM element and the reset-per-slide
 * behavior works against a real afterSlide firing.
 *
 * Reads the transform via the fixture page's `__shojiGallery.getActiveMedia()`
 * hook (demo/pages/e2e-plugins.ts) rather than a `.shoji-slide-media` CSS
 * locator — the slide pool keeps up to `preload * 2 + 1` of those elements
 * in the DOM at once, so picking "the active one" by DOM order isn't
 * reliable; `getActiveMedia()` is the exact same lookup the plugin itself
 * uses to apply the transform in the first place.
 */

async function openLightbox(page: Page): Promise<void> {
  await page.goto('/pages/e2e-plugins.html');
  await page.locator('#thumbs a[data-index="0"]').click();
  await expect(page.locator('.shoji-dialog')).toBeVisible();
}

function activeMediaTransform(page: Page): Promise<string> {
  return page.evaluate(
    () =>
      (
        window as unknown as { __shojiGallery: { getActiveMedia(): HTMLElement | null } }
      ).__shojiGallery.getActiveMedia()?.style.transform ?? '',
  );
}

test('rotate right applies a real rotate() transform, twice compounds to 180deg', async ({
  page,
}) => {
  await openLightbox(page);

  await page.locator('.shoji-toolbar-button[aria-label="Rotate right"]').click();
  await expect.poll(() => activeMediaTransform(page)).toMatch(/rotate\(90deg\)/);

  await page.locator('.shoji-toolbar-button[aria-label="Rotate right"]').click();
  await expect.poll(() => activeMediaTransform(page)).toMatch(/rotate\(180deg\)/);
});

test('rotate left goes the other direction, normalized into [0, 360) — never a negative degree value', async ({
  page,
}) => {
  await openLightbox(page);

  // rotation -90 normalizes to 270 (((-90 % 360) + 360) % 360), per
  // normalizeRotateFlip (src/core/rotateFlipNormalize.ts) — the style
  // string never contains a negative rotate() value.
  await page.locator('.shoji-toolbar-button[aria-label="Rotate left"]').click();
  await expect.poll(() => activeMediaTransform(page)).toMatch(/rotate\(270deg\)/);
});

test('flip horizontal composes scaleX(-1) with the current rotation, aria-pressed reflects state', async ({
  page,
}) => {
  await openLightbox(page);
  const flipHBtn = page.locator('.shoji-toolbar-button[aria-label="Flip horizontal"]');

  await expect(flipHBtn).toHaveAttribute('aria-pressed', 'false');
  await flipHBtn.click();
  await expect(flipHBtn).toHaveAttribute('aria-pressed', 'true');
  await expect
    .poll(() => activeMediaTransform(page))
    .toMatch(/scaleX\(-1\) scaleY\(1\) rotate\(0deg\)/);
});

test('flipping both axes canonicalizes to no flip + 180deg rotation (DESIGN.md §8.1 table)', async ({
  page,
}) => {
  await openLightbox(page);
  const flipHBtn = page.locator('.shoji-toolbar-button[aria-label="Flip horizontal"]');
  const flipVBtn = page.locator('.shoji-toolbar-button[aria-label="Flip vertical"]');

  await flipHBtn.click();
  await flipVBtn.click();

  await expect(flipHBtn).toHaveAttribute('aria-pressed', 'false');
  await expect(flipVBtn).toHaveAttribute('aria-pressed', 'false');
  await expect
    .poll(() => activeMediaTransform(page))
    .toMatch(/scaleX\(1\) scaleY\(1\) rotate\(180deg\)/);
});

test('navigating to the next slide resets rotation/flip to neutral', async ({ page }) => {
  await openLightbox(page);

  await page.locator('.shoji-toolbar-button[aria-label="Rotate right"]').click();
  await expect.poll(() => activeMediaTransform(page)).toMatch(/rotate\(90deg\)/);

  await page.locator('.shoji-nav-next').click();
  await expect(page.locator('.shoji-counter')).toHaveText('2 / 4');
  await expect.poll(() => activeMediaTransform(page)).not.toMatch(/rotate\(90deg\)/);
});
