import { test, expect, type Page } from '@playwright/test';

/**
 * DESIGN.md §2.3a — a truncated caption's own click/tap/Enter/Space target
 * opens a scrollable modal with the full text, so a long caption never has
 * to grow tall enough to risk covering the nav arrows or scroll forever in
 * place. Two real bugs, both caught testing this end to end and both the
 * same underlying mistake (assuming a `click`-layer `stopPropagation()` was
 * enough to isolate the modal, when the actual leak was in a different,
 * independent event system): the modal's own keydown handling originally
 * special-cased only `Escape`, leaving every other key (`Space` — Autoplay's
 * own play/pause shortcut) to fall through to the background gallery; and
 * `GestureEngine`'s own tap recognition runs on pointer events entirely
 * independent of `click`, so a tap inside the modal still read as a tap on
 * the dialog and fired the `tap` bus event (at the time, Autoplay's own
 * tap-to-toggle-play/pause was listening for it — that feature has since
 * been removed, but the underlying leak and its fix are unrelated to that
 * one consumer, so the isolation test below asserts on the `tap` event
 * itself rather than on a specific plugin's reaction to it). Uses the
 * shared e2e fixture (`demo/pages/e2e-plugins.html`) specifically because
 * it already loads Autoplay — the keyboard-leak half of this still needs a
 * real plugin listening for `Space`.
 */

const LONG_CAPTION =
  'A caption long enough to exceed even the arrow-aware collapsed height, not just one line. '.repeat(
    20,
  );

async function openWithLongCaption(page: Page): Promise<void> {
  await page.goto('/pages/e2e-plugins.html');
  await page.locator('#thumbs a[data-index="0"]').click();
  await expect(page.locator('.shoji-dialog')).toBeVisible();
  await page.evaluate((caption) => {
    type Item = { id: string; caption?: unknown };
    type GalleryHandle = { items: Item[]; updateSlides(items: Item[]): void };
    const gallery = (window as unknown as { __shojiGallery: GalleryHandle }).__shojiGallery;
    const items = gallery.items.map((item, i) => (i === 0 ? { ...item, caption } : item));
    gallery.updateSlides(items);
  }, LONG_CAPTION);
}

test('a caption long enough to exceed the arrow-aware cap truncates with an ellipsis, never overlapping the nav arrow', async ({
  page,
}) => {
  await openWithLongCaption(page);

  const caption = page.locator('.shoji-caption').last();
  const navPrev = page.locator('.shoji-nav-prev').last();
  await expect(caption).toHaveClass(/shoji-caption--truncated/);

  const captionBox = (await caption.boundingBox())!;
  const navBox = (await navPrev.boundingBox())!;
  const overlaps =
    captionBox.y < navBox.y + navBox.height && captionBox.y + captionBox.height > navBox.y;
  expect(overlaps).toBe(false);

  const ellipsisContent = await caption.evaluate((el) => getComputedStyle(el, '::after').content);
  expect(ellipsisContent).toContain('…');
});

test('a short caption stays plain, non-interactive text — no truncation class, no click/keyboard affordance', async ({
  page,
}) => {
  await page.goto('/pages/e2e-plugins.html');
  await page.locator('#thumbs a[data-index="0"]').click();
  await expect(page.locator('.shoji-dialog')).toBeVisible();

  const caption = page.locator('.shoji-caption').last(); // fixture's own short default caption
  await expect(caption).not.toHaveClass(/shoji-caption--truncated/);
  await expect(caption).not.toHaveAttribute('tabindex');
  await caption.click();
  await expect(page.locator('.shoji-caption-modal').last()).toBeHidden();
});

test('clicking a truncated caption opens a modal with the full text, scrollable, closable three ways', async ({
  page,
}) => {
  await openWithLongCaption(page);
  const caption = page.locator('.shoji-caption').last();
  const modal = page.locator('.shoji-caption-modal').last();

  await caption.click();
  await expect(modal).toBeVisible();
  const modalText = await page.locator('.shoji-caption-modal-content').last().textContent();
  expect(modalText?.length).toBeGreaterThan(500);

  // Escape closes only the modal, not the lightbox.
  await page.keyboard.press('Escape');
  await expect(modal).toBeHidden();
  await expect(page.locator('.shoji-outer.shoji-open')).toHaveCount(1);

  // Backdrop click closes it too.
  await caption.click();
  await expect(modal).toBeVisible();
  await modal.click({ position: { x: 5, y: 5 } });
  await expect(modal).toBeHidden();

  // The close button.
  await caption.click();
  await expect(modal).toBeVisible();
  await page.locator('.shoji-caption-modal-close').last().click();
  await expect(modal).toBeHidden();
});

test('Enter opens the modal when the truncated caption is focused, and Tab stays confined to it while open', async ({
  page,
}) => {
  await openWithLongCaption(page);
  const caption = page.locator('.shoji-caption').last();
  const modal = page.locator('.shoji-caption-modal').last();

  await caption.focus();
  await page.keyboard.press('Enter');
  await expect(modal).toBeVisible();

  const focusInModal = await page.evaluate(
    () => document.querySelector('.shoji-caption-modal')?.contains(document.activeElement) ?? false,
  );
  expect(focusInModal).toBe(true);

  await page.keyboard.press('Tab');
  const stillInModal = await page.evaluate(
    () => document.querySelector('.shoji-caption-modal')?.contains(document.activeElement) ?? false,
  );
  expect(stillInModal).toBe(true);

  await page.keyboard.press('Escape');
  await expect(modal).toBeHidden();
  const focusReturned = await page.evaluate(
    () => document.activeElement === document.querySelector('.shoji-caption'),
  );
  expect(focusReturned).toBe(true);
});

test('the open modal fully isolates the background gallery: Space does not toggle Autoplay, and a click inside it never fires a background tap', async ({
  page,
}) => {
  await openWithLongCaption(page);
  const caption = page.locator('.shoji-caption').last();
  const modal = page.locator('.shoji-caption-modal').last();
  const autoplayButton = page.locator('.shoji-autoplay-toggle').last();

  await expect(autoplayButton).toHaveAttribute('aria-label', 'Play slideshow');

  // Count `tap` bus events instead of relying on a specific plugin's
  // reaction to one — no built-in plugin currently listens for it, so
  // asserting on the event itself is what keeps this test meaningful
  // regardless of what (if anything) consumes it.
  await page.evaluate(() => {
    type GalleryHandle = { on(event: string, cb: () => void): void };
    const gallery = (window as unknown as { __shojiGallery: GalleryHandle }).__shojiGallery;
    (window as unknown as { __tapCount: number }).__tapCount = 0;
    gallery.on('tap', () => {
      (window as unknown as { __tapCount: number }).__tapCount++;
    });
  });

  // Keyboard leak: Space is Autoplay's own play/pause shortcut.
  await caption.click();
  await expect(modal).toBeVisible();
  await page.keyboard.press('Space');
  await page.waitForTimeout(300);
  await expect(autoplayButton).toHaveAttribute('aria-label', 'Play slideshow');
  await expect(modal).toBeVisible(); // Space didn't leak to anything that closed it either

  // Gesture/tap leak: a click inside the modal's own content area — not the
  // close button, which was already a real <button> and so already excluded.
  await page.locator('.shoji-caption-modal-content').last().click();
  await page.waitForTimeout(300);
  const tapCount = await page.evaluate(
    () => (window as unknown as { __tapCount: number }).__tapCount,
  );
  expect(tapCount).toBe(0);
  await expect(modal).toBeVisible();

  // Arrow-key navigation is absorbed too, not "navigate then close."
  const counterBefore = await page.locator('.shoji-counter').last().textContent();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(200);
  await expect(page.locator('.shoji-counter').last()).toHaveText(counterBefore ?? '');
  await expect(modal).toBeVisible();
});

/**
 * A real bug, reported from real usage: reopening an already-loaded slide
 * (e.g. clicking the same thumbnail twice) could show its caption with no
 * truncation/ellipsis at all — inconsistent with that same slide's own
 * first open. A fresh first open works because the real async delay of
 * `img.decode()` gives the dialog time to finish laying out before the
 * truncation measurement runs; a cached reopen has no such delay, so the
 * measurement could run while the dialog was still mid-layout. See
 * DESIGN.md §2.3a.
 */
test('reopening the same slide truncates identically to its first open', async ({ page }) => {
  await openWithLongCaption(page);
  const caption = page.locator('.shoji-caption').last();
  await expect(caption).toHaveClass(/shoji-caption--truncated/);
  const firstOpenHeight = (await caption.boundingBox())!.height;

  await page.keyboard.press('Escape'); // close the lightbox entirely
  await expect(page.locator('.shoji-outer.shoji-open')).toHaveCount(0);

  await page.locator('#thumbs a[data-index="0"]').click(); // reopen, same slide
  await expect(page.locator('.shoji-dialog')).toBeVisible();
  await expect(caption).toHaveClass(/shoji-caption--truncated/);
  const secondOpenHeight = (await caption.boundingBox())!.height;
  expect(secondOpenHeight).toBe(firstOpenHeight);
});

/**
 * A real bug, reported from real usage, confirmed via real-browser
 * screenshots (not just this project's headless sandbox): a sliver of the
 * next line could bleed through below the truncated caption's own `…`
 * ellipsis. Fixed by snapping the height cap to a real measured line
 * boundary (`Range.getClientRects()`) instead of an assumed one — this
 * checks that boundary directly: no line box may start inside the visible
 * box while ending outside it (a real, would-render sliver), for the
 * range of viewport sizes the arrow-avoidance/toolbar-avoidance geometry
 * (§2.3a) actually varies across. See DESIGN.md §2.3a.
 */
test('a truncated caption never bleeds a partial line through below its own ellipsis, across viewport sizes', async ({
  page,
}) => {
  for (const viewport of [
    { width: 375, height: 667 },
    { width: 500, height: 1400 },
    { width: 1280, height: 800 },
  ]) {
    await page.setViewportSize(viewport);
    await openWithLongCaption(page);
    const caption = page.locator('.shoji-caption').last();
    await expect(caption).toHaveClass(/shoji-caption--truncated/);

    const worstOverflow = await caption.evaluate((el) => {
      const elTop = el.getBoundingClientRect().top;
      const range = document.createRange();
      range.selectNodeContents(el);
      let worst = 0;
      for (const rect of range.getClientRects()) {
        if (rect.height === 0) continue;
        const relTop = rect.top - elTop;
        if (relTop >= 0 && relTop < el.clientHeight) {
          worst = Math.max(worst, rect.bottom - elTop - el.clientHeight);
        }
      }
      return worst;
    });
    expect(worstOverflow, `viewport ${viewport.width}x${viewport.height}`).toBeLessThanOrEqual(1);

    await page.keyboard.press('Escape');
  }
});

/**
 * Two requested behaviors, tested together since they share one open/close
 * cycle: the collapsed caption is replaced by its modal (not left visible
 * underneath), and every auto-hidden control — including the collapsed
 * caption itself — comes back on close rather than staying hidden until
 * the viewer happens to move the mouse. A related real bug, reported from
 * real usage: the cursor itself could vanish while the modal was being
 * read, if an idle auto-hide timer already ticking down before the modal
 * opened was still in flight when it fired — `hideControls()` didn't know
 * to stay a no-op for the modal's own lifetime. See DESIGN.md §2.3a/§2.8.
 */
test('the modal replaces the collapsed caption (not layered over it), keeps the cursor visible for its whole lifetime, and restores everything on close', async ({
  page,
}) => {
  await page.goto('/pages/e2e-plugins.html?autoHideDelay=600');
  await page.locator('#thumbs a[data-index="0"]').click();
  await expect(page.locator('.shoji-dialog')).toBeVisible();
  await page.evaluate((caption) => {
    type Item = { id: string; caption?: unknown };
    type GalleryHandle = { items: Item[]; updateSlides(items: Item[]): void };
    const gallery = (window as unknown as { __shojiGallery: GalleryHandle }).__shojiGallery;
    const items = gallery.items.map((item, i) => (i === 0 ? { ...item, caption } : item));
    gallery.updateSlides(items);
  }, LONG_CAPTION);

  const caption = page.locator('.shoji-caption').last();
  const modal = page.locator('.shoji-caption-modal').last();
  const dialog = page.locator('.shoji-dialog').last();
  await expect(caption).toHaveClass(/shoji-caption--truncated/);

  await caption.click();
  await expect(modal).toBeVisible();
  await expect(caption).toBeHidden(); // replaced, not layered underneath

  // Well past the 600ms idle delay — controls (and the cursor, via
  // .shoji-controls-hidden) must never hide while the modal is open.
  await page.waitForTimeout(1200);
  await expect(dialog).not.toHaveClass(/shoji-controls-hidden/);
  await expect(modal).toBeVisible();

  await page.locator('.shoji-caption-modal-close').last().click();
  await expect(modal).toBeHidden();
  await expect(caption).toBeVisible(); // restored
  await expect(dialog).not.toHaveClass(/shoji-controls-hidden/); // controls shown, not left hidden
});
