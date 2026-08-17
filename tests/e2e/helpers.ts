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
 */
export async function revealToolbarButton(page: Page, button: Locator): Promise<void> {
  if (await button.isVisible()) return;
  await page.locator('.shoji-toolbar-overflow').last().click();
}

/**
 * Reveal-then-click, retried — for a button whose popover can close itself
 * out from under an in-flight click (e.g. Autoplay, mid-slideshow: each
 * `navigate()` auto-closes the popover, DESIGN.md §3.1a, and that can land
 * in the gap between this helper's own `revealToolbarButton` check and the
 * click actually landing). A plain `button.click()` would otherwise wait
 * out its full timeout for a "visible" state that never returns, since
 * nothing re-opens the popover on its own.
 */
export async function revealAndClickToolbarButton(page: Page, button: Locator): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    await revealToolbarButton(page, button);
    try {
      await button.click({ timeout: 1000 });
      return;
    } catch {
      // Popover likely auto-closed (a slide navigated) between the reveal
      // check above and this click actually landing — retry the whole pair.
    }
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
