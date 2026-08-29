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

/**
 * DESIGN.md §4.1 point 19 — `stopOnManualNavigate` (default true):
 * navigating manually mid-slideshow pauses it instead of silently
 * re-timing on the newly active slide. Real keyboard arrow press against a
 * real running interval timer, not a synthetic event.
 *
 * A real bug found running this in CI on mobile-chrome, not in this test's
 * own product-code target: `clickToolbarButton`'s popover doesn't
 * auto-close after a click on one of its own buttons (its own doc comment)
 * — with Autoplay's button collapsed there on a narrow viewport, the arrow
 * key press right after landed while the popover was still open, and its
 * own capture-phase keydown handler (`onToolbarOverflowKeydown`,
 * `Gallery.ts`) swallows every key but Escape, so it never reached
 * Gallery's own arrow-key navigation at all — confirmed directly via the
 * failed run's own page snapshot, still showing '1 / 4' and the overflow
 * caret focused. `closeToolbarOverflowIfOpen` (same helper the progress-bar
 * test above already needs, for the same "an open popover changes what
 * this test is actually exercising" reasoning) fixes it.
 */
test('pressing the right arrow key mid-slideshow pauses it instead of just re-timing on the new slide', async ({
  page,
}) => {
  await openLightbox(page);
  const playButton = page.locator('.shoji-toolbar-button[aria-label="Play slideshow"]');
  await clickToolbarButton(page, playButton);
  await expect(page.locator('.shoji-toolbar-button[aria-label="Pause slideshow"]')).toHaveCount(1);
  await closeToolbarOverflowIfOpen(page);

  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.shoji-counter')).toHaveText('2 / 4');
  await expect(page.locator('.shoji-toolbar-button[aria-label="Play slideshow"]')).toHaveCount(1); // paused, not still playing

  const afterManualNav = await page.locator('.shoji-counter').textContent();
  await page.waitForTimeout(700); // several intervals' worth — must not have advanced on its own
  await expect(page.locator('.shoji-counter')).toHaveText(afterManualNav!);
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

/**
 * DESIGN.md §4.1 — a real UX gap, not a reported bug: nothing stopped the
 * slideshow from auto-advancing out from under a viewer actively zoomed
 * into a detail, unlike the drag-to-close pause above. Fixed by listening
 * for Zoom's own zoomChange event (and RotateFlip's rotateFlipChange, its
 * own equivalent test below) — no dependency on either plugin beyond the
 * event shape, so this test loads all three together, the same as the
 * fixture's other cross-plugin tests.
 *
 * Deliberately **stays paused** once zoomed back out to neutral — no
 * auto-resume. An earlier design tried auto-resuming (matching the
 * drag-to-close pause's own resume-on-retreat behavior) and hit two real
 * problems: a manual restart while still zoomed left it unable to
 * re-pause on a further zoom, and even once fixed, landing back on
 * neutral still isn't the same as "the viewer is done" — see
 * RotateFlip's own equivalent test below for why that distinction
 * matters concretely.
 */
test('zooming in pauses the slideshow, and it stays paused once zoomed back out — the viewer never gets yanked to the next slide mid-examination, and isn’t auto-resumed just because the numbers happen to land back on 1x', async ({
  page,
}) => {
  // Wide enough that no toolbar button collapses into the overflow popover
  // (DESIGN.md §3.1a, covered by its own tests elsewhere) — this test is
  // only about the pause behavior itself. onZoom defaults to 'stop';
  // ?onZoom=stop (demo/pages/e2e-plugins.ts) is redundant with the
  // default now, kept only so this test stays explicit about what it's
  // actually exercising rather than relying on an option it never sets.
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.goto('/pages/e2e-plugins.html?interval=300&onZoom=stop');
  await page.locator('#thumbs a[data-index="0"]').click();
  await expect(page.locator('.shoji-dialog')).toBeVisible();

  await page.locator('.shoji-toolbar-button[aria-label="Play slideshow"]').click();
  await expect(page.locator('.shoji-toolbar-button[aria-label="Pause slideshow"]')).toHaveCount(1);

  await page.locator('.shoji-toolbar-button[aria-label="Zoom in"]').click();
  await expect(page.locator('.shoji-toolbar-button[aria-label="Play slideshow"]')).toHaveCount(1); // paused

  const counterWhileZoomed = await page.locator('.shoji-counter').textContent();
  await page.waitForTimeout(700); // several intervals' worth — must not have advanced
  await expect(page.locator('.shoji-counter')).toHaveText(counterWhileZoomed!);

  await page.locator('.shoji-toolbar-button[aria-label="Zoom out"]').click();
  await expect(page.locator('.shoji-toolbar-button[aria-label="Play slideshow"]')).toHaveCount(1); // still paused, not auto-resumed
  await page.waitForTimeout(700);
  await expect(page.locator('.shoji-counter')).toHaveText(counterWhileZoomed!); // still hasn't advanced
});

/**
 * onRotateFlip defaults to 'stop' (DESIGN.md §4.1) — ?onRotateFlip=stop
 * (demo/pages/e2e-plugins.ts) is redundant with the default now, kept
 * only for explicitness.
 *
 * Also deliberately **stays paused**, same reasoning as zoom above — but
 * unlike zoom, every one of the four rotate clicks pauses here, including
 * the one landing back on the original orientation: a real bug, reported
 * from real usage against the earlier auto-resume design, where that
 * specific click silently let the slideshow keep running instead — a
 * rotate landing back at 0deg is still an active interaction with the
 * view controls, not "nothing happened."
 */
test('rotating pauses the slideshow, and every rotate click keeps it paused — including the one landing back on the original orientation', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.goto('/pages/e2e-plugins.html?interval=300&onRotateFlip=stop');
  await page.locator('#thumbs a[data-index="0"]').click();
  await expect(page.locator('.shoji-dialog')).toBeVisible();

  await page.locator('.shoji-toolbar-button[aria-label="Play slideshow"]').click();
  await expect(page.locator('.shoji-toolbar-button[aria-label="Pause slideshow"]')).toHaveCount(1);

  const rotateRight = page.locator('.shoji-toolbar-button[aria-label="Rotate right"]');
  await rotateRight.click();
  await expect(page.locator('.shoji-toolbar-button[aria-label="Play slideshow"]')).toHaveCount(1); // paused

  const counterWhileRotated = await page.locator('.shoji-counter').textContent();
  await page.waitForTimeout(700);
  await expect(page.locator('.shoji-counter')).toHaveText(counterWhileRotated!);

  // Back to 0deg (360, normalized) — three more clicks, each re-confirming
  // the pause; the slideshow itself was never manually restarted in
  // between here, so re-pausing is a no-op each time (still just paused).
  await rotateRight.click();
  await rotateRight.click();
  await rotateRight.click(); // lands back on the original orientation
  await expect(page.locator('.shoji-toolbar-button[aria-label="Play slideshow"]')).toHaveCount(1); // still paused
  await page.waitForTimeout(700);
  await expect(page.locator('.shoji-counter')).toHaveText(counterWhileRotated!);
});

/**
 * DESIGN.md §4.1 — a real bug, reported from real usage right after the
 * pause-on-rotate feature above shipped: rotate (pauses), zoom/rotate in
 * such a way that it lands back on the original position, then press
 * Play — the slideshow ran unpaused instead of immediately re-pausing.
 * Root cause: nothing fires zoomChange/rotateFlipChange just from
 * clicking Play, and toggling straight back to neutral (a single-step
 * "back to original" action) only ever emits the *already-neutral*
 * event, never one crossing the engaged threshold — so nothing would
 * ever have caught it. Fixed by re-checking the *current* zoom/rotate
 * state right after a manual Play, not just reacting to future events.
 *
 * Exercised via the Space shortcut, not the Play button itself: the
 * button is now disabled whenever this check would matter (see the
 * regression test below), which correctly makes a real mouse click
 * impossible — but Space bypasses the button's own disabled state
 * entirely, so this re-check is still real, load-bearing logic, not
 * dead code the disabled button alone would make unreachable.
 */
test('regression: pressing Space while already rotated immediately re-pauses, instead of running unpaused', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.goto('/pages/e2e-plugins.html?interval=300&onRotateFlip=stop');
  await page.locator('#thumbs a[data-index="0"]').click();
  await expect(page.locator('.shoji-dialog')).toBeVisible();

  const playButton = page.locator('.shoji-toolbar-button[aria-label="Play slideshow"]');
  const pauseButton = page.locator('.shoji-toolbar-button[aria-label="Pause slideshow"]');

  await page.locator('.shoji-toolbar-button[aria-label="Rotate right"]').click(); // rotate first, while not playing
  await page.keyboard.press(' '); // Space, bypassing the (disabled) Play button entirely
  await expect(playButton).toHaveCount(1); // must immediately re-pause, not run unpaused

  const counterAfterPlay = await page.locator('.shoji-counter').textContent();
  await page.waitForTimeout(700); // several intervals' worth — must not have advanced
  await expect(page.locator('.shoji-counter')).toHaveText(counterAfterPlay!);
  await expect(pauseButton).toHaveCount(0);
});

/**
 * DESIGN.md §4.1 — a real UX gap, asked about directly: pressing Play
 * while resume is blocked re-pauses in the same synchronous tick, with
 * no paint in between — the button never visibly flips to "Pause" at
 * all, so a click just silently does nothing. Now disabled instead,
 * matching core's own slide-loading disable (`aria-disabled` + dimmed +
 * `pointer-events: none`, `Gallery.ts`'s `setSlideLoading()`).
 */
test('regression: the Play button visibly disables while resume is blocked (zoomed/rotated), instead of a click silently doing nothing', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.goto('/pages/e2e-plugins.html?interval=300&onZoom=stop&onRotateFlip=stop');
  await page.locator('#thumbs a[data-index="0"]').click();
  await expect(page.locator('.shoji-dialog')).toBeVisible();

  const playButton = page.locator('.shoji-toolbar-button[aria-label="Play slideshow"]');
  await expect(playButton).not.toHaveAttribute('aria-disabled', 'true');

  await page.locator('.shoji-toolbar-button[aria-label="Zoom in"]').click();
  await expect(playButton).toHaveAttribute('aria-disabled', 'true');
  await expect(playButton).toHaveCSS('pointer-events', 'none');

  await page.locator('.shoji-toolbar-button[aria-label="Zoom out"]').click();
  await expect(playButton).not.toHaveAttribute('aria-disabled', 'true');

  await page.locator('.shoji-toolbar-button[aria-label="Rotate right"]').click();
  await expect(playButton).toHaveAttribute('aria-disabled', 'true');
});

/**
 * DESIGN.md §2.3a/§4.1 — `onCaptionExpand` (default 'stop';
 * ?onCaptionExpand=stop is redundant with the default now, kept only for
 * explicitness). Unlike onZoom/onRotateFlip above,
 * there's no separate "Play button visibly disables while blocked" test and
 * no Space-bypass regression test for this one — the caption modal already
 * makes the Play button (and every other key/click behind it) physically
 * unreachable while open, core's own doing (focus trap + capture-phase
 * keydown blocking every key), not something this plugin has to enforce or
 * that a real browser lets this test attempt in the first place.
 */
test('expanding a truncated caption pauses the slideshow, and it stays paused once the caption modal closes', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.goto('/pages/e2e-plugins.html?interval=300&onCaptionExpand=stop');
  await page.locator('#thumbs a[data-index="0"]').click();
  await expect(page.locator('.shoji-dialog')).toBeVisible();

  const longCaption =
    'A caption long enough to exceed even the arrow-aware collapsed height, not just one line. '.repeat(
      20,
    );
  await page.evaluate((caption) => {
    type Item = { id: string; caption?: unknown };
    type GalleryHandle = { items: Item[]; updateSlides(items: Item[]): void };
    const gallery = (window as unknown as { __shojiGallery: GalleryHandle }).__shojiGallery;
    const items = gallery.items.map((item, i) => (i === 0 ? { ...item, caption } : item));
    gallery.updateSlides(items);
  }, longCaption);
  const caption = page.locator('.shoji-caption').last();
  await expect(caption).toHaveClass(/shoji-caption--truncated/);

  await page.locator('.shoji-toolbar-button[aria-label="Play slideshow"]').click();
  await expect(page.locator('.shoji-toolbar-button[aria-label="Pause slideshow"]')).toHaveCount(1);

  await caption.click();
  await expect(page.locator('.shoji-caption-modal').last()).toBeVisible();
  await expect(page.locator('.shoji-toolbar-button[aria-label="Play slideshow"]')).toHaveCount(1); // paused

  const counterWhileExpanded = await page.locator('.shoji-counter').textContent();
  await page.waitForTimeout(700); // several intervals' worth — must not have advanced
  await expect(page.locator('.shoji-counter')).toHaveText(counterWhileExpanded!);

  await page.locator('.shoji-caption-modal-close').last().click();
  await expect(page.locator('.shoji-caption-modal').last()).toBeHidden();
  await expect(page.locator('.shoji-toolbar-button[aria-label="Play slideshow"]')).toHaveCount(1); // still paused, not auto-resumed
  await page.waitForTimeout(700);
  await expect(page.locator('.shoji-counter')).toHaveText(counterWhileExpanded!);
});

/**
 * DESIGN.md §2.3a — a real bug, reported from real usage against the
 * feature directly above: `closeCaptionModal()` restores focus to whatever
 * had it when the modal opened, which for a mouse click is the caption
 * itself (clicking a tabindex=0 element focuses it as a native browser side
 * effect). Pressing Space right after to resume the slideshow landed back
 * on that residually-focused caption first, which reopened the modal
 * instead of — or alongside — actually resuming. Fixed by only restoring
 * focus for a genuine keyboard-driven open (Tab+Enter/Space), where
 * continuing the viewer's tab sequence is the correct, intended behavior;
 * a mouse-click open no longer force-refocuses the caption on close at all.
 */
test('regression: pressing Space to resume right after closing a click-opened caption modal just resumes — it does not also reopen the modal', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.goto('/pages/e2e-plugins.html?interval=300&onCaptionExpand=stop');
  await page.locator('#thumbs a[data-index="0"]').click();
  await expect(page.locator('.shoji-dialog')).toBeVisible();

  const longCaption =
    'A caption long enough to exceed even the arrow-aware collapsed height, not just one line. '.repeat(
      20,
    );
  await page.evaluate((caption) => {
    type Item = { id: string; caption?: unknown };
    type GalleryHandle = { items: Item[]; updateSlides(items: Item[]): void };
    const gallery = (window as unknown as { __shojiGallery: GalleryHandle }).__shojiGallery;
    const items = gallery.items.map((item, i) => (i === 0 ? { ...item, caption } : item));
    gallery.updateSlides(items);
  }, longCaption);
  const caption = page.locator('.shoji-caption').last();
  await expect(caption).toHaveClass(/shoji-caption--truncated/);

  await caption.click(); // mouse-opened, same as a real viewer clicking to read it
  await expect(page.locator('.shoji-caption-modal').last()).toBeVisible();
  await page.locator('.shoji-caption-modal-close').last().click();
  await expect(page.locator('.shoji-caption-modal').last()).toBeHidden();

  await page.keyboard.press(' ');
  await expect(page.locator('.shoji-caption-modal').last()).toBeHidden(); // must not have reopened
  await expect(page.locator('.shoji-toolbar-button[aria-label="Pause slideshow"]')).toHaveCount(1); // the slideshow actually resumed
});
