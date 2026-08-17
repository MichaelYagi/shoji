import { test, expect, type Page } from '@playwright/test';
import { clickToolbarButton, closeToolbarOverflowIfOpen } from '../helpers';

/**
 * Real timer-driven advance — the video-interrupt state machine (§4.1) is
 * covered in depth by jsdom unit tests (tests/unit/plugins/autoplay.test.ts)
 * with fake timers; this covers the ordinary (non-video) real-time behavior
 * against the fixture page's 300ms interval (demo/pages/e2e-plugins.ts —
 * short deliberately, so these tests don't need to wait out a real 5s
 * default).
 */

async function openLightbox(page: Page): Promise<void> {
  await page.goto('/pages/e2e-plugins.html');
  await page.locator('#thumbs a[data-index="0"]').click();
  await expect(page.locator('.shoji-dialog')).toBeVisible();
}

// Autoplay is the fourth (last) of four toolbar plugins in the fixture
// (DESIGN.md §3.1a) — its play/pause button is the first to collapse into
// the overflow popover on any viewport too narrow to fit all four
// (mobile-chrome's own default viewport included). `clickToolbarButton`
// opens the popover first (only if the target isn't already on the row,
// same as a real viewer would) before a click; navigating to a new slide
// auto-closes it again (its position depends on the current toolbar
// height), which can happen mid-test once autoplay is actually running, so
// a click can need a fresh reveal even after an earlier one already
// happened. Post-click *state* is checked via `toHaveCount(1)` (matching
// the single toggling button node by its current aria-label) rather than
// `toBeVisible()` — what these tests care about is whether play/pause
// state flipped, not whether the toolbar happens to be showing it at that
// exact moment.

test('play button starts auto-advance and flips to a pause label', async ({ page }) => {
  await openLightbox(page);
  const button = page.locator('.shoji-toolbar-button[aria-label="Play slideshow"]');

  await expect(page.locator('.shoji-counter')).toHaveText('1 / 4');
  await clickToolbarButton(page, button);
  await expect(page.locator('.shoji-toolbar-button[aria-label="Pause slideshow"]')).toHaveCount(1);

  await expect
    .poll(() => page.locator('.shoji-counter').textContent(), { timeout: 3000 })
    .toBe('2 / 4');
});

test('pause stops the advance', async ({ page }) => {
  await openLightbox(page);
  const playButton = page.locator('.shoji-toolbar-button[aria-label="Play slideshow"]');
  await clickToolbarButton(page, playButton);
  await expect
    .poll(() => page.locator('.shoji-counter').textContent(), { timeout: 3000 })
    .toBe('2 / 4');

  // autoplay is actively running at this point, so a navigate() (which
  // auto-closes the popover) can land mid-reveal — clickToolbarButton
  // retries its own reveal check right up until the click itself, not just
  // once up front.
  const pauseButton = page.locator('.shoji-toolbar-button[aria-label="Pause slideshow"]');
  await clickToolbarButton(page, pauseButton);
  await expect(page.locator('.shoji-toolbar-button[aria-label="Play slideshow"]')).toHaveCount(1);

  const afterPause = await page.locator('.shoji-counter').textContent();
  await page.waitForTimeout(700); // several intervals' worth — must not have advanced
  await expect(page.locator('.shoji-counter')).toHaveText(afterPause!);
});

test('Space toggles play/pause', async ({ page }) => {
  await openLightbox(page);
  // Deliberately does NOT reveal the button first: while the overflow
  // popover is open, its own keydown handler swallows every key but
  // Escape in the capture phase (DESIGN.md §3.1a, same isolation the
  // caption modal's own keydown handling established) — opening it here
  // would break the very shortcut this test exists to check. The toggle is
  // verified on the DOM state itself (the aria-label the single button
  // node swaps between), not visibility, since the button may be sitting
  // collapsed, off-screen, in a closed popover on a narrow viewport.
  await page.keyboard.press('Space');
  await expect(page.locator('.shoji-toolbar-button[aria-label="Pause slideshow"]')).toHaveCount(1);

  await page.keyboard.press('Space');
  await expect(page.locator('.shoji-toolbar-button[aria-label="Play slideshow"]')).toHaveCount(1);
});

test('loops back to the first slide after the last, by default (loop: true)', async ({ page }) => {
  await page.goto('/pages/e2e-plugins.html');
  await page.locator('#thumbs a[data-index="3"]').click(); // open() no-ops while already open, so open directly at the last item instead of opening then re-clicking
  await expect(page.locator('.shoji-dialog')).toBeVisible();
  await expect(page.locator('.shoji-counter')).toHaveText('4 / 4');

  const playButton = page.locator('.shoji-toolbar-button[aria-label="Play slideshow"]');
  await clickToolbarButton(page, playButton);
  await expect
    .poll(() => page.locator('.shoji-counter').textContent(), { timeout: 3000 })
    .toBe('1 / 4');
});

/**
 * DESIGN.md §2.6a/§2.8 — a real bug, reported from real usage: the progress
 * bar stayed fully visible through the entire close animation, unlike the
 * toolbar/nav/counter/caption, which all fade out first. It lived outside
 * `.shoji-controls-hidden`'s CSS selector list (autoplay.css is a separate
 * stylesheet from core's shoji.css, easy to miss when that list grows) —
 * fixed by adding it there instead of only its own `[hidden]` rule.
 *
 * A second real bug, found later: keying that fix off plain
 * `.shoji-controls-hidden` also faded the bar out on *ordinary idle
 * auto-hide* (§2.8), not just closing — the one piece of the UI actively
 * telling the viewer "still counting down" disappearing during every idle
 * period, not just the close animation the original report was actually
 * about. Rescoped to the close-only `.shoji-controls-hidden-for-close`
 * marker (`Gallery.ts`'s `forceHideControls()`) instead.
 */
test('the progress bar fades out with the rest of the controls when the close animation starts, instead of staying visible through it', async ({
  page,
}) => {
  await page.goto('/pages/e2e-plugins.html?interval=60000'); // long enough it never advances mid-test
  await page.locator('#thumbs a[data-index="0"]').click();
  await expect(page.locator('.shoji-dialog')).toBeVisible();
  const playButton = page.locator('.shoji-toolbar-button[aria-label="Play slideshow"]');
  await clickToolbarButton(page, playButton);

  const progress = page.locator('.shoji-autoplay-progress');
  await expect(progress).toBeVisible();
  await expect(progress).toHaveCSS('opacity', '1');

  await page.locator('.shoji-close').click();

  // Checked synchronously, right after the click, not via toHaveCSS polling
  // on the interpolating opacity value — same reasoning as
  // core-close-controls-fade.spec.ts's own tests: the whole close sequence
  // can finish faster than a poll reliably samples, passing straight
  // through the fade and landing back on a fully-closed, reset state
  // (.shoji-controls-hidden(-for-close) removed again by finishClose(),
  // progress bar hidden by Autoplay's own close listener) between polls —
  // flakily reading as "never faded." The class is the deterministic
  // signal — specifically the close-only marker, not plain
  // `.shoji-controls-hidden` (idle auto-hide sets that too, but must NOT
  // fade this bar — see the describe comment above).
  const controlsHiddenForCloseRightAfterClick = await progress.evaluate((el) =>
    el.closest('.shoji-dialog')!.classList.contains('shoji-controls-hidden-for-close'),
  );
  expect(controlsHiddenForCloseRightAfterClick).toBe(true);

  // A real opacity sample too, partway through the fade (well under its
  // 300ms duration and the close sequence's ~600-700ms total) — confirms
  // the progress bar's own CSS actually responds to the class landing,
  // not just that the class itself landed on the dialog.
  await page.waitForTimeout(100);
  const midFadeOpacity = await progress.evaluate((el) => Number(getComputedStyle(el).opacity));
  expect(midFadeOpacity).toBeLessThan(1);
});

/**
 * The actual bug reported from real usage, distinct from the close-fade
 * test above: the fix for that one over-applied — keying the progress
 * bar's fade off plain `.shoji-controls-hidden` also faded it out on
 * ordinary idle auto-hide (§2.8), not just closing. See DESIGN.md §2.6a/§2.8.
 */
test('the progress bar stays visible through ordinary idle auto-hide, unlike the toolbar/nav/caption it hides alongside', async ({
  page,
}) => {
  await page.goto('/pages/e2e-plugins.html?interval=60000&autoHideDelay=600');
  await page.locator('#thumbs a[data-index="0"]').click();
  await expect(page.locator('.shoji-dialog')).toBeVisible();
  const playButton = page.locator('.shoji-toolbar-button[aria-label="Play slideshow"]');
  await clickToolbarButton(page, playButton);
  // Not what this test is about — an open popover would itself block idle
  // auto-hide (DESIGN.md §3.1a), silently defeating the assertions below.
  await closeToolbarOverflowIfOpen(page);
  await page.mouse.move(5, 5); // off any control, so idle auto-hide isn't paused by hover

  const progress = page.locator('.shoji-autoplay-progress');
  const toolbar = page.locator('.shoji-toolbar');
  await expect(progress).toHaveCSS('opacity', '1');

  // Well past the 600ms idle delay.
  await page.waitForTimeout(2000);
  const dialogHidden = await page.evaluate(() =>
    document.querySelector('.shoji-dialog')!.classList.contains('shoji-controls-hidden'),
  );
  expect(dialogHidden).toBe(true); // idle auto-hide genuinely triggered
  await expect(toolbar).toHaveCSS('opacity', '0'); // the toolbar it hides alongside really did fade
  await expect(progress).toHaveCSS('opacity', '1'); // the progress bar itself did not
});
