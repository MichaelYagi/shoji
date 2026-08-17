import { test, expect, type Page } from '@playwright/test';
import { revealToolbarButton } from '../helpers';

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
  const rotateRight = page.locator('.shoji-toolbar-button[aria-label="Rotate right"]');

  // RotateFlip is the third of four toolbar plugins in the fixture
  // (DESIGN.md §3.1a) — its buttons collapse into the overflow popover on
  // any viewport too narrow to fit all four (mobile-chrome's own default
  // viewport included), same as a real viewer would need to reveal them.
  await revealToolbarButton(page, rotateRight);
  await rotateRight.click();
  await expect.poll(() => activeMediaTransform(page)).toMatch(/rotate\(90deg\)/);

  await revealToolbarButton(page, rotateRight);
  await rotateRight.click();
  await expect.poll(() => activeMediaTransform(page)).toMatch(/rotate\(180deg\)/);
});

test('rotate left animates to a negative degree value, not the normalized 270deg — real browsers interpolate a wrapped value as a backward spin, so the animated transform stays unbounded/unwrapped on purpose (unlike the emitted rotateFlipChange state, which does normalize to 270 — src/core/rotateFlipNormalize.ts)', async ({
  page,
}) => {
  await openLightbox(page);
  const rotateLeft = page.locator('.shoji-toolbar-button[aria-label="Rotate left"]');

  await revealToolbarButton(page, rotateLeft);
  await rotateLeft.click();
  await expect.poll(() => activeMediaTransform(page)).toMatch(/rotate\(-90deg\)/);
});

test('regression: four rotate-right clicks keep animating forward to 360deg, not backward from 270 to 0 (a real bug — animating straight to the wrapped 0deg value made the browser interpolate a 270deg decrease instead of continuing the same 90deg step being clicked through)', async ({
  page,
}) => {
  await openLightbox(page);
  const rotateRight = page.locator('.shoji-toolbar-button[aria-label="Rotate right"]');
  await revealToolbarButton(page, rotateRight);

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
  await revealToolbarButton(page, flipHBtn);

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
  await revealToolbarButton(page, flipHBtn);

  await flipHBtn.click();
  await flipVBtn.click();

  await expect(flipHBtn).toHaveAttribute('aria-pressed', 'false');
  await expect(flipVBtn).toHaveAttribute('aria-pressed', 'false');
  await expect
    .poll(() => activeMediaTransform(page))
    .toMatch(/scaleX\(-1\) scaleY\(-1\) rotate\(0deg\)/);
});

test('regression: "Rotate right" while flipped horizontally still spins clockwise — applies a negative raw rotate() delta, since a single-axis mirror reverses a plain +90 delta\'s visual handedness', async ({
  page,
}) => {
  await openLightbox(page);
  const flipHBtn = page.locator('.shoji-toolbar-button[aria-label="Flip horizontal"]');
  const rotateRightBtn = page.locator('.shoji-toolbar-button[aria-label="Rotate right"]');
  await revealToolbarButton(page, flipHBtn);

  await flipHBtn.click();
  await rotateRightBtn.click();

  await expect.poll(() => activeMediaTransform(page)).toMatch(/rotate\(-90deg\)/);
  // scaleX/scaleY aren't asserted as exactly -1/1 here: the fixture image
  // has a real aspect ratio (800x600), so the fit-scale (DESIGN.md §4.5)
  // now genuinely applies at this 90°-family rotation — scaleX and scaleY
  // still carry the same magnitude, opposite sign (flipH, not flipV), just
  // scaled by whatever factor keeps the rotated photo contained.
  const [scaleX, scaleY] = await page.evaluate(() => {
    const media = (
      window as unknown as { __shojiGallery: { getActiveMedia(): HTMLElement | null } }
    ).__shojiGallery.getActiveMedia();
    const m = media?.style.transform.match(/scaleX\(([-\d.]+)\) scaleY\(([-\d.]+)\)/);
    return [Number(m?.[1]), Number(m?.[2])];
  });
  expect(scaleX).toBeCloseTo(-scaleY, 5);
  expect(scaleY).toBeGreaterThan(0);
});

test("regression: a rotated photo's own visible box stays within .shoji-slides instead of getting its edges clipped — before the fit-scale (DESIGN.md §4.5), rotating painted the photo well outside its available space, cropped by .shoji-slides' overflow:hidden rather than shrunk to fit", async ({
  page,
}) => {
  // Checked against the <img>'s own box, not .shoji-slide-media's (the
  // full container) — .shoji-slide-media can still legitimately paint
  // outside .shoji-slides once rotated (its own invisible letterbox
  // margins, harmlessly clipped, DESIGN.md §4.5's own writeup), only the
  // *visible* photo staying uncropped is the actual invariant that matters
  // here. getBoundingClientRect() reflects the live, currently-*painted*
  // geometry — mid-transition that can briefly be larger than the settled
  // end state (a non-square rectangle's rotated bounding box peaks
  // partway through a 0->90 sweep, not at either endpoint, same reasoning
  // as the mobile viewport-widening bug, DESIGN.md §2.6a). Emulating
  // reduced motion collapses --shoji-duration to 0ms (shoji.css), making
  // the rotate instant instead of racing a real CSS transition under
  // parallel-test CPU contention — a real flake this test hit before this
  // change.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openLightbox(page);

  const slidesBox = (await page.locator('.shoji-slides').boundingBox())!;
  const rotateRight = page.locator('.shoji-toolbar-button[aria-label="Rotate right"]');
  await revealToolbarButton(page, rotateRight);
  await rotateRight.click();
  await expect.poll(() => activeMediaTransform(page)).toMatch(/rotate\(90deg\)/);

  const imgBox = await page.evaluate(() =>
    (
      window as unknown as { __shojiGallery: { getActiveMedia(): HTMLElement | null } }
    ).__shojiGallery
      .getActiveMedia()!
      .querySelector('img')!
      .getBoundingClientRect(),
  );
  expect(imgBox.width).toBeLessThanOrEqual(slidesBox.width + 1);
  expect(imgBox.height).toBeLessThanOrEqual(slidesBox.height + 1);
});

/**
 * The fixture's own items are always 800x600 (e2e-plugins.ts) — plenty of
 * native resolution for any of this suite's viewports, so it never
 * exercises the resolution ceiling (DESIGN.md §4.5) on its own. Overriding
 * `item.width`/`height` directly (the exact input `resolveNaturalSize`
 * reads, fresh, on every rotate click — a live reference off `gallery.items`,
 * not a defensive copy) is more robust than trying to reverse-engineer a
 * viewport/DPR combination that happens to trigger it.
 */
async function setActiveItemNaturalSize(page: Page, width: number, height: number): Promise<void> {
  await page.evaluate(
    ({ width, height }) => {
      const gallery = (
        window as unknown as {
          __shojiGallery: {
            items: Array<{ width?: number; height?: number }>;
            currentIndex: number;
          };
        }
      ).__shojiGallery;
      const item = gallery.items[gallery.currentIndex]!;
      item.width = width;
      item.height = height;
    },
    { width, height },
  );
}

test('regression: a low-resolution photo does not grow when rotated, even though its ideal best-fit size for the new orientation would be larger — reported from real usage: recomputing the ideal size on every rotation made small photos visibly balloon, which read as a glitch since nothing that dramatic happens to a large, high-resolution photo in the same rotation', async ({
  page,
}) => {
  // Portrait-ish viewport: what makes this specific photo (letterboxed
  // vertically, matching its own aspect ratio) the "ideal fit would grow"
  // case this test targets — a wide desktop viewport instead lands it in
  // the ordinary shrink case already covered by the test above.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' }); // see the test above for why
  await openLightbox(page);
  await setActiveItemNaturalSize(page, 80, 60); // same 4:3 shape as the fixture default, but low-res

  const before = await page.evaluate(() =>
    (
      window as unknown as { __shojiGallery: { getActiveMedia(): HTMLElement | null } }
    ).__shojiGallery
      .getActiveMedia()!
      .querySelector('img')!
      .getBoundingClientRect(),
  );

  // This viewport is narrow enough that RotateFlip's own buttons (the third
  // plugin registered, DESIGN.md §3.1a) collapse into the overflow popover —
  // reveal one before clicking, same as a real viewer would.
  const rotateRight = page.locator('.shoji-toolbar-button[aria-label="Rotate right"]');
  await revealToolbarButton(page, rotateRight);
  await rotateRight.click();
  await expect.poll(() => activeMediaTransform(page)).toMatch(/rotate\(90deg\)/);

  const after = await page.evaluate(() =>
    (
      window as unknown as { __shojiGallery: { getActiveMedia(): HTMLElement | null } }
    ).__shojiGallery
      .getActiveMedia()!
      .querySelector('img')!
      .getBoundingClientRect(),
  );

  // The photo's own dimensions swap (it's now rotated 90°), but its size
  // as an object doesn't change — before's width becomes after's height
  // and vice versa, not some larger recomputed "ideal" size for the new
  // orientation.
  expect(after.height).toBeCloseTo(before.width, 0);
  expect(after.width).toBeCloseTo(before.height, 0);
});

test('regression: a high-resolution photo grows fully to fill newly-available space when rotated — reported from real usage: a 6144x8160 photo on a 1080p monitor did not fill the screen after rotating, because an earlier fix capped ALL growth at 1x regardless of how much real resolution the photo had to spare', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 }); // same "ideal fit would grow" shape as the test above
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openLightbox(page);
  await setActiveItemNaturalSize(page, 8000, 6000); // same 4:3 shape, but ample resolution

  const before = await page.evaluate(() =>
    (
      window as unknown as { __shojiGallery: { getActiveMedia(): HTMLElement | null } }
    ).__shojiGallery
      .getActiveMedia()!
      .querySelector('img')!
      .getBoundingClientRect(),
  );

  const rotateRight = page.locator('.shoji-toolbar-button[aria-label="Rotate right"]');
  await revealToolbarButton(page, rotateRight);
  await rotateRight.click();
  await expect.poll(() => activeMediaTransform(page)).toMatch(/rotate\(90deg\)/);

  const after = await page.evaluate(() =>
    (
      window as unknown as { __shojiGallery: { getActiveMedia(): HTMLElement | null } }
    ).__shojiGallery
      .getActiveMedia()!
      .querySelector('img')!
      .getBoundingClientRect(),
  );

  // Genuinely grew, not just rotated in place — the opposite assertion
  // from the low-resolution test above.
  expect(after.width * after.height).toBeGreaterThan(before.width * before.height * 1.1);
});

test("regression: the real bug as originally reported — a small photo with no item.width/height at all (relying entirely on the <img>'s own natural size, exactly like docs/examples/*.html's inline-SVG items) does not change size when rotated in a wide desktop-shaped window, even though a naive 'as if object-fit: contain always scales to fill' calculation would have shrunk it", async ({
  page,
}) => {
  // The window shape that exposed this on the real deployed docs site —
  // wide and comparatively short, unlike the narrow/tall viewport the
  // other tests here use.
  await page.setViewportSize({ width: 1920, height: 950 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openLightbox(page);
  // No setActiveItemNaturalSize call — item.width/height stay whatever the
  // fixture set (800x600), deliberately deleted here so resolveNaturalSize
  // must fall through to the <img>'s own naturalWidth/naturalHeight, the
  // exact path the real bug went through.
  await page.evaluate(() => {
    const gallery = (
      window as unknown as {
        __shojiGallery: { items: Array<{ width?: number; height?: number }>; currentIndex: number };
      }
    ).__shojiGallery;
    const item = gallery.items[gallery.currentIndex]!;
    delete item.width;
    delete item.height;
  });

  const before = await page.evaluate(() =>
    (
      window as unknown as { __shojiGallery: { getActiveMedia(): HTMLElement | null } }
    ).__shojiGallery
      .getActiveMedia()!
      .querySelector('img')!
      .getBoundingClientRect(),
  );

  const rotateRight = page.locator('.shoji-toolbar-button[aria-label="Rotate right"]');
  await revealToolbarButton(page, rotateRight);
  await rotateRight.click();
  await expect.poll(() => activeMediaTransform(page)).toMatch(/rotate\(90deg\)/);

  const after = await page.evaluate(() =>
    (
      window as unknown as { __shojiGallery: { getActiveMedia(): HTMLElement | null } }
    ).__shojiGallery
      .getActiveMedia()!
      .querySelector('img')!
      .getBoundingClientRect(),
  );

  expect(after.height).toBeCloseTo(before.width, 0);
  expect(after.width).toBeCloseTo(before.height, 0);
});

test('navigating to the next slide resets rotation/flip to neutral', async ({ page }) => {
  await openLightbox(page);
  const rotateRight = page.locator('.shoji-toolbar-button[aria-label="Rotate right"]');

  await revealToolbarButton(page, rotateRight);
  await rotateRight.click();
  await expect.poll(() => activeMediaTransform(page)).toMatch(/rotate\(90deg\)/);

  await page.locator('.shoji-nav-next').click();
  await expect(page.locator('.shoji-counter')).toHaveText('2 / 4');
  await expect.poll(() => activeMediaTransform(page)).not.toMatch(/rotate\(90deg\)/);
});
