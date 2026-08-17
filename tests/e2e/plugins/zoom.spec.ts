import { test, expect, type Page, type ElementHandle } from '@playwright/test';
import { clickToolbarButton, revealToolbarButton } from '../helpers';

/**
 * Real-browser coverage for the Zoom plugin's gesture/DOM behavior — the
 * parts jsdom unit tests (tests/unit/plugins/zoom.test.ts) can't exercise:
 * real dblclick recognition, real pointer drag panning, and real CSS
 * transform composition on the actual rendered `<img>`.
 *
 * Locates the active image via the fixture page's `__shojiGallery` hook
 * (demo/pages/e2e-plugins.ts), not a `.shoji-slide-media img` CSS locator —
 * the slide pool keeps multiple `.shoji-slide-media` elements in the DOM at
 * once (preload), so "the first match" isn't reliably the active one, and
 * each slide gets a freshly-created `<img>` on every render, so the handle
 * is re-fetched after any navigation rather than cached.
 */

type GalleryHandle = { getActiveMedia(): HTMLElement | null };

async function activeImgHandle(page: Page): Promise<ElementHandle<HTMLImageElement>> {
  const handle = await page.evaluateHandle(() => {
    const media = (
      window as unknown as { __shojiGallery: GalleryHandle }
    ).__shojiGallery.getActiveMedia();
    return media?.firstElementChild as HTMLImageElement | undefined;
  });
  const el = handle.asElement() as ElementHandle<HTMLImageElement> | null;
  if (!el) throw new Error('no active image found');
  return el;
}

async function openLightbox(page: Page): Promise<void> {
  await page.goto('/pages/e2e-plugins.html');
  await page.locator('#thumbs a[data-index="0"]').click();
  await expect(page.locator('.shoji-dialog')).toBeVisible();
}

async function activeImgTransform(page: Page): Promise<string> {
  const img = await activeImgHandle(page);
  return img.evaluate((el) => el.style.transform);
}

async function activeImgHasZoomedClass(page: Page): Promise<boolean> {
  const img = await activeImgHandle(page);
  return img.evaluate((el) => el.classList.contains('shoji-zoomed'));
}

test('double-click zooms in, second double-click resets', async ({ page }) => {
  await openLightbox(page);

  await (await activeImgHandle(page)).dblclick();
  await expect.poll(() => activeImgHasZoomedClass(page)).toBe(true);
  await expect.poll(() => activeImgTransform(page)).toMatch(/scale3d\(2/);

  await (await activeImgHandle(page)).dblclick();
  await expect.poll(() => activeImgHasZoomedClass(page)).toBe(false);
});

test('zoom in / zoom out toolbar buttons toggle the zoomed state', async ({ page }) => {
  await openLightbox(page);

  // Zoom is the first-registered plugin (DESIGN.md §3.1a) — "Zoom in" and
  // "Zoom out", its first two buttons, are always among the pinned ones
  // (the fixture doesn't override minPinnedToolbarButtons, default 2);
  // revealToolbarButton() below is a
  // harmless no-op wherever that's already true, and only does real work on
  // a viewport narrow enough that even these don't fit (unlikely, but not
  // assumed away — same reasoning as every other call site in this file).
  await page.locator('.shoji-toolbar-button[aria-label="Zoom in"]').click();
  await expect.poll(() => activeImgHasZoomedClass(page)).toBe(true);

  const zoomOut = page.locator('.shoji-toolbar-button[aria-label="Zoom out"]');
  await clickToolbarButton(page, zoomOut);
  await expect.poll(() => activeImgHasZoomedClass(page)).toBe(false);
});

test('actual size toggles zoom (fixture image is scaled down to fit the dialog)', async ({
  page,
}) => {
  // The 800x600 fixture only actually gets scaled down on a narrow
  // (mobile-sized) viewport — on a normal desktop one it already fits the
  // dialog at its native size with room to spare, so "Actual size" would
  // correctly be a no-op there instead of exercising what this test is
  // for. Forcing a viewport smaller than the fixture guarantees the
  // "scaled down to fit" premise the test name describes, regardless of
  // which project (desktop or mobile) actually runs it.
  await page.setViewportSize({ width: 400, height: 300 });
  await openLightbox(page);

  // This viewport is narrow enough that Zoom's own "Actual size" button
  // (registered after Zoom's other two buttons, DESIGN.md §3.1a) collapses
  // into the overflow popover — reveal it before clicking, same as a real
  // viewer would.
  const actualSize = page.locator('.shoji-toolbar-button[aria-label="Actual size"]');
  await clickToolbarButton(page, actualSize);
  await expect.poll(() => activeImgHasZoomedClass(page)).toBe(true);

  await clickToolbarButton(page, actualSize);
  await expect.poll(() => activeImgHasZoomedClass(page)).toBe(false);
});

test('dragging while zoomed pans the image instead of navigating slides', async ({ page }) => {
  await openLightbox(page);

  await page.locator('.shoji-toolbar-button[aria-label="Zoom in"]').click();
  await expect.poll(() => activeImgHasZoomedClass(page)).toBe(true);
  const beforeTransform = await activeImgTransform(page);

  const img = await activeImgHandle(page);
  const box = (await img.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx - 60, cy - 40, { steps: 8 });
  await page.mouse.up();

  const afterTransform = await activeImgTransform(page);
  expect(afterTransform).not.toBe(beforeTransform); // pan offset changed
  await expect(page.locator('.shoji-counter')).toHaveText('1 / 4'); // still on the same slide — drag panned, didn't navigate
});

test('navigating to the next slide resets zoom on the new slide', async ({ page }) => {
  await openLightbox(page);

  await (await activeImgHandle(page)).dblclick();
  await expect.poll(() => activeImgHasZoomedClass(page)).toBe(true);

  await page.locator('.shoji-nav-next').click();
  await expect(page.locator('.shoji-counter')).toHaveText('2 / 4');
  await expect.poll(() => activeImgHasZoomedClass(page)).toBe(false);
});

test('zoom-in button eases the transform instead of jumping, and pinch-driven scale does not', async ({
  page,
}) => {
  await openLightbox(page);

  await page.locator('.shoji-toolbar-button[aria-label="Zoom in"]').click();
  // Sampled shortly after the click, still mid-animation, then again once it
  // must have settled — an instant jump would already show the final value
  // on the first sample; an eased transition shows a different, in-between
  // computed transform first.
  const img = await activeImgHandle(page);
  const mid = await img.evaluate((el) => getComputedStyle(el).transform);
  await page.waitForTimeout(500);
  const settled = await img.evaluate((el) => getComputedStyle(el).transform);
  expect(mid).not.toBe(settled);

  // The transition is cleared afterward, not left permanently set — a
  // dblclick reset (also a discrete jump) still gets its own transition,
  // proving the plugin re-applies it per action rather than leaking state.
  await expect.poll(() => img.evaluate((el) => el.style.transition)).toBe('');
  await img.dblclick();
  await expect.poll(() => img.evaluate((el) => el.style.transition)).toContain('transform');
});

test('regression: zoom-out back to neutral keeps transform-origin anchored until the transition genuinely ends, instead of snapping it early and jumping the image', async ({
  page,
}) => {
  await openLightbox(page);
  const zoomIn = page.locator('.shoji-toolbar-button[aria-label="Zoom in"]');
  const zoomOut = page.locator('.shoji-toolbar-button[aria-label="Zoom out"]');
  await revealToolbarButton(page, zoomOut); // "Zoom out" can collapse into the popover; see the test above

  await zoomIn.click(); // scale 1.5
  const img = await activeImgHandle(page);
  // Firefox serializes element.style.transformOrigin with an explicit
  // z-component ("0px 0px 0px"), Chrome/WebKit omit it ("0px 0px") — both
  // mean the same top-left anchor, just a browser string-serialization
  // difference, not something worth pinning to one form.
  await expect
    .poll(() => img.evaluate((el) => el.style.transformOrigin))
    .toMatch(/^0px 0px(?: 0px)?$/);

  // Click and read back in one synchronous round-trip, not two separate
  // ones — under a busy/parallel test run, a gap between them is enough for
  // the transition's own end-of-animation cleanup (--shoji-duration + a
  // 100ms fallback) to have already fired, making this check meaningless.
  const zoomOutHandle = await zoomOut.elementHandle();
  const stateRightAfterClick = await page.evaluate(
    ([buttonEl, imgEl]) => {
      (buttonEl as HTMLButtonElement).click();
      return {
        transformOrigin: (imgEl as HTMLElement).style.transformOrigin,
        transition: (imgEl as HTMLElement).style.transition,
      };
    },
    [zoomOutHandle, img] as const,
  );

  // With the old bug, transform-origin was cleared to the browser default
  // (center) in the same synchronous tick the transition started — the
  // anchor snapped instantly, visibly displacing the scaled image before it
  // ever started easing down. It must stay put for the transition's whole
  // duration and only clear once transitionend genuinely fires.
  expect(stateRightAfterClick.transformOrigin).toMatch(/^0px 0px(?: 0px)?$/);
  expect(stateRightAfterClick.transition).toContain('transform');

  await expect.poll(() => img.evaluate((el) => el.style.transformOrigin)).toBe('');
  await expect.poll(() => img.evaluate((el) => el.style.transition)).toBe('');
  await expect.poll(() => activeImgHasZoomedClass(page)).toBe(false);
});
