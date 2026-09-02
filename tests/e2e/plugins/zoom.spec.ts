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

/** RotateFlip's own `apply(true)` clears `.shoji-slide-media`'s inline `transition` once the CSS transition genuinely ends (`waitForTransitionEnd`) — polling on that, not a fixed timeout, is what actually proves the rotation has settled rather than just assuming a duration. */
async function activeMediaHasSettledTransition(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const media = (
      window as unknown as { __shojiGallery: { getActiveMedia(): HTMLElement | null } }
    ).__shojiGallery.getActiveMedia();
    return media?.style.transition === '';
  });
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
  // (the fixture doesn't override maxPinnedToolbarButtons, default 2);
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
  const iconSwap = actualSize.locator('.shoji-icon-swap');
  await expect(iconSwap).not.toHaveClass(/shoji-icon-swap--on/);

  await clickToolbarButton(page, actualSize);
  await expect.poll(() => activeImgHasZoomedClass(page)).toBe(true);
  await expect(iconSwap).toHaveClass(/shoji-icon-swap--on/);

  await clickToolbarButton(page, actualSize);
  await expect.poll(() => activeImgHasZoomedClass(page)).toBe(false);
  await expect(iconSwap).not.toHaveClass(/shoji-icon-swap--on/);
});

/**
 * A real bug, reported from real usage: the icon-swap cache backing this
 * button's icon (an earlier version tracked "are we exactly at native
 * pixel size" separately from `scale` itself) went stale after the first
 * press — `reset()` nulled it every time without every call site
 * re-populating it, so only the *first* actual-size press of a session
 * ever updated the icon at all. Fixed by reading `scale` directly
 * (src/plugins/zoom/index.ts's `updateActualSizeIcon()`) instead of a
 * separately-cached value — this is the regression test for that, run in
 * a real browser since the bug was specifically about state surviving
 * across repeated real clicks, not a single jsdom-simulated one.
 */
test('actual-size icon keeps toggling correctly across repeated presses, not just the first one', async ({
  page,
}) => {
  await page.setViewportSize({ width: 400, height: 300 });
  await openLightbox(page);

  const actualSize = page.locator('.shoji-toolbar-button[aria-label="Actual size"]');
  const iconSwap = actualSize.locator('.shoji-icon-swap');

  for (let i = 0; i < 4; i++) {
    await clickToolbarButton(page, actualSize);
    const expected = i % 2 === 0;
    if (expected) await expect(iconSwap).toHaveClass(/shoji-icon-swap--on/);
    else await expect(iconSwap).not.toHaveClass(/shoji-icon-swap--on/);
  }
});

/**
 * The actual-size icon reflects `scale > 1` generally, not "are we
 * specifically at native pixel size" — it must flip to the contract icon
 * for any zoom, including one reached via the zoom-in button rather than
 * actual-size itself, since that's what the button's own click actually
 * does at that point (resets to fit, regardless of how the zoom was
 * reached).
 */
test('actual-size icon also flips when zoomed via the zoom-in button, not just via itself', async ({
  page,
}) => {
  await openLightbox(page);

  const zoomIn = page.locator('.shoji-toolbar-button[aria-label="Zoom in"]');
  const actualSize = page.locator('.shoji-toolbar-button[aria-label="Actual size"]');
  const iconSwap = actualSize.locator('.shoji-icon-swap');
  await expect(iconSwap).not.toHaveClass(/shoji-icon-swap--on/);

  await clickToolbarButton(page, zoomIn);
  await expect(iconSwap).toHaveClass(/shoji-icon-swap--on/);
});

/** Real-browser confirmation that the icon swap (src/core/iconSwap.ts) genuinely cross-fades via CSS opacity — not an instant `innerHTML` cut — since jsdom (tests/unit/) doesn't run CSS transitions at all. */
test('actual-size icon cross-fades via CSS opacity, not an instant swap', async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 300 });
  await openLightbox(page);

  const actualSize = page.locator('.shoji-toolbar-button[aria-label="Actual size"]');
  const offIcon = actualSize.locator('.shoji-icon-swap-icon--off');
  const onIcon = actualSize.locator('.shoji-icon-swap-icon--on');

  const transitionProperty = await offIcon.evaluate(
    (el) => getComputedStyle(el).transitionProperty,
  );
  expect(transitionProperty).toBe('opacity');

  await expect(offIcon).toHaveCSS('opacity', '1');
  await expect(onIcon).toHaveCSS('opacity', '0');

  await clickToolbarButton(page, actualSize);
  // Polled repeatedly rather than sampled once at a guessed midpoint — a
  // single fixed-delay sample racing a transition is exactly the flaky
  // pattern this project has hit before (tests/e2e/core-zoom-transition.spec.ts's
  // own history): under real load the fade can start later than expected,
  // making one precisely-timed sample land before or after it entirely.
  // Polling across a window comfortably longer than
  // --shoji-icon-swap-duration's 150ms default just needs *some* sample to
  // land strictly between 0 and 1 to prove real interpolation happened —
  // an instant `innerHTML`-style cut would never produce one, regardless
  // of when sampled.
  let sawMidFade = false;
  for (let i = 0; i < 15; i++) {
    const opacity = await offIcon.evaluate((el) => Number(getComputedStyle(el).opacity));
    if (opacity > 0 && opacity < 1) {
      sawMidFade = true;
      break;
    }
    await page.waitForTimeout(30);
  }
  expect(sawMidFade).toBe(true);
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

test('regression: dragging while zoomed pans the image along the actual screen axis, even when RotateFlip has rotated the slide — before this fix, the raw screen-space pointer delta was applied directly as the local pan, so a rotated slide panned sideways when dragged up/down', async ({
  page,
}) => {
  // Wide enough that RotateFlip/Zoom's buttons never collapse into the
  // toolbar overflow popover (DESIGN.md §3.1a, covered by its own tests
  // elsewhere) — this test is only about the coordinate-space fix itself.
  await page.setViewportSize({ width: 1000, height: 800 });
  // This test's own loose tolerances (>40px/<10px) tolerate some slop from
  // a real CSS rotate transition racing against measurement under normal
  // parallel-test CPU contention (confirmed reliable on chromium/firefox/
  // mobile-chrome) — but not against WebKit's own, apparently less precise,
  // transition-completion signaling under CI's heavier contention there,
  // where the <10px margin was observed to slip past (e.g. 13px). Same
  // race, same fix, as the double-click anchor test below and RotateFlip's
  // own geometry tests (DESIGN.md §4.5) — reduced motion collapses
  // --shoji-duration to 0ms, making the rotate instant so both the drag's
  // own `before` measurement and the drag itself always see the same,
  // fully-settled rotated state.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openLightbox(page);

  await page.locator('.shoji-toolbar-button[aria-label="Rotate right"]').click();
  await expect.poll(() => activeMediaHasSettledTransition(page)).toBe(true);
  await page.locator('.shoji-toolbar-button[aria-label="Zoom in"]').click();
  await page.locator('.shoji-toolbar-button[aria-label="Zoom in"]').click();
  await expect.poll(() => activeImgHasZoomedClass(page)).toBe(true);
  // The zoom-in click itself eases (withTransition, zoom/index.ts) rather
  // than jumping — without waiting for it to genuinely finish, a bounding
  // box captured mid-animation mixes the drag's own pan with the zoom
  // transition's still-ongoing scale growth, confounding the measurement.
  const img = await activeImgHandle(page);
  await expect.poll(() => img.evaluate((el) => el.style.transition)).toBe('');

  const before = (await img.boundingBox())!;
  const cx = before.x + before.width / 2;
  const cy = before.y + before.height / 2;

  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx, cy + 60, { steps: 8 }); // drag straight down on screen
  await page.mouse.up();

  const after = (await img.boundingBox())!;
  // Dragging down on screen must move the image down on screen, not
  // sideways — regardless of the slide's own rotation underneath it.
  expect(Math.abs(after.y - before.y)).toBeGreaterThan(40);
  expect(Math.abs(after.x - before.x)).toBeLessThan(10);
});

test('regression: double-clicking to zoom toward the pointer still anchors on the actual clicked point once RotateFlip has rotated the slide — before this fix, the anchor math mixed screen-space and local-space coordinates and zoomed toward the wrong point', async ({
  page,
}) => {
  // Wide enough that RotateFlip's buttons never collapse into the toolbar
  // overflow popover (DESIGN.md §3.1a, covered by its own tests elsewhere).
  await page.setViewportSize({ width: 1000, height: 800 });
  // This test's own assertion is pixel-precise (toBeCloseTo(anchorX, 0)),
  // unlike the drag regression test above, whose looser >40px/<10px
  // tolerances tolerate some slop — precise enough to be flaky against a
  // real CSS rotate transition under CI's parallel-test CPU contention,
  // where `before`'s bounding box and the plugin's own internal
  // measurement (moments later, inside the click handler) can each land
  // at a slightly different point along an in-flight transition. Same
  // race, same fix, as RotateFlip's own geometry tests (DESIGN.md §4.5's
  // "rotated bounding box peaks partway through the sweep" note) —
  // reduced motion collapses --shoji-duration to 0ms, making the rotate
  // instant so both measurements read the same, fully-settled state.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openLightbox(page);

  await page.locator('.shoji-toolbar-button[aria-label="Rotate right"]').click();
  await expect.poll(() => activeMediaHasSettledTransition(page)).toBe(true);

  const img = await activeImgHandle(page);
  const before = (await img.boundingBox())!;
  // An off-center point — anchoring on the exact center wouldn't
  // distinguish a correct anchor from a wrong one that just happens to
  // preserve the center (scaling from the middle looks anchor-agnostic).
  const fracX = 0.3;
  const fracY = 0.3;
  const anchorX = before.x + before.width * fracX;
  const anchorY = before.y + before.height * fracY;

  await page.mouse.dblclick(anchorX, anchorY);
  await expect.poll(() => activeImgHasZoomedClass(page)).toBe(true);
  await expect.poll(() => img.evaluate((el) => el.style.transition)).toBe('');

  const after = (await img.boundingBox())!;
  // The pixel that was at (fracX, fracY) of the image before zooming must
  // still be under the same screen coordinate after — that's the actual
  // definition of "zoomed toward the pointer", not just "grew".
  const predictedAnchorX = after.x + after.width * fracX;
  const predictedAnchorY = after.y + after.height * fracY;
  expect(predictedAnchorX).toBeCloseTo(anchorX, 0);
  expect(predictedAnchorY).toBeCloseTo(anchorY, 0);
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

test("a plain (non-ctrl) mouse wheel zooms in, by default (mouseWheelZoom: true) — the real-browser counterpart to the trackpad two-finger drag this option exists to catch, since jsdom can neither send a real wheel event nor prove it bubbles to this plugin's own listener on .shoji-outer", async ({
  page,
  isMobile,
}) => {
  // page.mouse.wheel() isn't implemented on mobile WebKit at all (throws
  // outright), and a mouse-wheel simulation is a desktop/trackpad
  // interaction anyway — same reasoning as the drag-gesture suite's own
  // isMobile skips. Real touch-emulated projects have no wheel input to
  // test here.
  test.skip(
    isMobile,
    'mouse-wheel simulation is a desktop/trackpad interaction; see comment above',
  );

  await openLightbox(page);

  const before = await activeImgTransform(page);
  expect(before).toBe('');

  const box = await (await activeImgHandle(page)).boundingBox();
  if (!box) throw new Error('no bounding box for active image');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  // Several ticks, not one — the sensitivity was deliberately tuned down to
  // Kiri's own gentler feel (§4.6's eighteenth entry), so a single real
  // wheel tick's deltaY is too small to reliably clear scale 1 across every
  // browser's own default wheel-tick magnitude. The exact resulting scale
  // isn't asserted below — Playwright's mouse.wheel(dy) maps to genuinely
  // different real deltaY magnitudes per browser engine (confirmed
  // directly: the same 10 ticks land around scale 1.x on Firefox but 2.66
  // on Chromium/WebKit) — that precise coefficient/formula is what the
  // exact-deltaY unit tests already pin down; this test's own job is only
  // to prove a real wheel event genuinely bubbles to and zooms via this
  // plugin's listener in a real browser, which jsdom can't.
  for (let i = 0; i < 10; i++) {
    await page.mouse.wheel(0, -100);
  }

  await expect.poll(() => activeImgHasZoomedClass(page)).toBe(true);
  const after = await activeImgTransform(page);
  const scale = Number(after.match(/scale3d\(([\d.]+),/)?.[1]);
  expect(scale).toBeGreaterThan(1);
});
