import type { Locator, Page } from '@playwright/test';

/**
 * DESIGN.md §3.1a — a toolbar button lives either pinned directly on the
 * toolbar row or, once the row doesn't fit, collapsed into the overflow
 * popover behind a caret. Which one depends on viewport width and how many
 * other plugins are registered ahead of it, not on anything a test should
 * have to special-case per call site. A real viewer reaches either the same
 * way (click the button, or open the popover first if it's not on the row);
 * this makes e2e locators do the same, transparently, rather than assuming
 * every toolbar button is always directly clickable.
 *
 * Retried, not a one-shot check-then-click: a real CI run (slower, more
 * contended than a local one — confirmed directly, this exact one-shot
 * version passed consistently locally across chromium/firefox/mobile-chrome
 * but failed extensively in CI on mobile-chrome/webkit/mobile-safari) can
 * still be mid-open-transition, or the popover can still be settling from
 * its own click, at the instant a single `isVisible()` check runs — a false
 * "not visible yet" there previously meant the caret was never clicked at
 * all, since `revealToolbarButton` only ever tried once. Retrying re-checks
 * and, if needed, re-clicks the caret (skipped if it's already open, so
 * this can't toggle it back closed) until the target genuinely becomes
 * visible or the budget below is spent.
 */
export async function revealToolbarButton(page: Page, button: Locator): Promise<void> {
  const caret = page.locator('.shoji-toolbar-overflow').last();
  for (let attempt = 0; attempt < 30; attempt++) {
    if (await button.isVisible()) return;
    if ((await caret.isVisible()) && (await caret.getAttribute('aria-expanded')) !== 'true') {
      await caret.click().catch(() => {});
    }
    await page.waitForTimeout(200);
  }
}

/**
 * Reveal-then-click, retried — for a button whose popover can close itself
 * out from under an in-flight click (e.g. Autoplay, mid-slideshow: each
 * `navigate()` auto-closes the popover, DESIGN.md §3.1a, and it stays open
 * for only as long as the fixture's own interval — genuinely on the order
 * of a couple hundred ms, not a generous window).
 *
 * Clicks via `element.click()` inside `page.evaluate()`, not
 * `locator.click()` — a real bug in this test helper itself, found running
 * with tracing on (`playwright.config.ts`'s `trace: 'retain-on-failure'`,
 * always recording so it has something to keep on failure): `locator.click()`
 * does its own actionability wait first (stable across two consecutive
 * frames), and that extra round-trip is exactly what a slower/more-loaded
 * run (tracing, or real CI contention) can't reliably fit inside the
 * popover's own open window before `navigate()` closes it again — reliably
 * reproducible locally by re-running with `--trace=on` even though the
 * exact same test passed consistently with tracing off. Once this helper's
 * own `isVisible()` check has already confirmed the element is visible and
 * attached *right now*, a direct DOM `.click()` needs no further waiting —
 * it either lands in that same tick or the button wasn't really visible,
 * in which case the next loop iteration's `isVisible()` check catches it.
 */
export async function revealAndClickToolbarButton(page: Page, button: Locator): Promise<void> {
  const caret = page.locator('.shoji-toolbar-overflow').last();
  for (let attempt = 0; attempt < 60; attempt++) {
    if (await button.isVisible()) {
      await button.evaluate((el) => (el as HTMLElement).click());
      return;
    }
    if ((await caret.isVisible()) && (await caret.getAttribute('aria-expanded')) !== 'true') {
      await caret.click().catch(() => {});
    }
    await page.waitForTimeout(50);
  }
  await button.click(); // final attempt — let a genuine failure throw normally
}

/**
 * The popover doesn't auto-close after a click on one of its own buttons
 * (only Escape/an outside click/navigating does) — and while it's open,
 * `hideControls()` is a deliberate no-op (DESIGN.md §3.1a, same reasoning
 * as the caption modal), which would otherwise silently defeat a test
 * that's actually about idle auto-hide, not the popover. A blind
 * `Escape` press isn't safe here — with the popover already closed, that
 * key is the gallery's own close shortcut — so this only acts if it's
 * actually open.
 */
export async function closeToolbarOverflowIfOpen(page: Page): Promise<void> {
  const caret = page.locator('.shoji-toolbar-overflow').last();
  if ((await caret.getAttribute('aria-expanded')) === 'true') {
    await page.keyboard.press('Escape');
  }
}
