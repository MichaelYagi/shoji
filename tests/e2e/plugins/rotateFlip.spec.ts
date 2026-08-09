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

test('rotate left animates to a negative degree value, not the normalized 270deg — real browsers interpolate a wrapped value as a backward spin, so the animated transform stays unbounded/unwrapped on purpose (unlike the emitted rotateFlipChange state, which does normalize to 270 — src/core/rotateFlipNormalize.ts)', async ({
  page,
}) => {
  await openLightbox(page);

  await page.locator('.shoji-toolbar-button[aria-label="Rotate left"]').click();
  await expect.poll(() => activeMediaTransform(page)).toMatch(/rotate\(-90deg\)/);
});

test('regression: four rotate-right clicks keep animating forward to 360deg, not backward from 270 to 0 (a real bug — animating straight to the wrapped 0deg value made the browser interpolate a 270deg decrease instead of continuing the same 90deg step being clicked through)', async ({
  page,
}) => {
  await openLightbox(page);
  const rotateRight = page.locator('.shoji-toolbar-button[aria-label="Rotate right"]');

  for (let i = 0; i < 4; i++) {
    await rotateRight.click();
  }

  await expect.poll(() => activeMediaTransform(page)).toMatch(/rotate\(360deg\)/);
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

test('aria-pressed canonicalizes flipping both axes to no flip (DESIGN.md §8.1 table), but the animated transform stays a plain double-scale — a real bug, reported from real usage: animating straight to the canonicalized rotate(180deg) form made the browser interpolate scaleX and rotate simultaneously, a visibly "twisting" compound motion for what should look like a normal vertical-flip', async ({
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
    .toMatch(/scaleX\(-1\) scaleY\(-1\) rotate\(0deg\)/);
});

test('navigating to the next slide resets rotation/flip to neutral', async ({ page }) => {
  await openLightbox(page);

  await page.locator('.shoji-toolbar-button[aria-label="Rotate right"]').click();
  await expect.poll(() => activeMediaTransform(page)).toMatch(/rotate\(90deg\)/);

  await page.locator('.shoji-nav-next').click();
  await expect(page.locator('.shoji-counter')).toHaveText('2 / 4');
  await expect.poll(() => activeMediaTransform(page)).not.toMatch(/rotate\(90deg\)/);
});
