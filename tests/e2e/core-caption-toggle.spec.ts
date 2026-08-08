import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import path from 'node:path';

/**
 * DESIGN.md §2.3a — a video slide's caption defaults to hidden (the
 * click-through fix, core-caption-overflow.spec.ts, was necessary but not
 * sufficient: a caption you can click through but still can't *see past* to
 * use the controls underneath is still bad UX). A toolbar toggle button
 * lets the viewer show it on demand instead.
 *
 * Real-browser coverage matters here specifically because of a known class
 * of bug in this codebase: an element's own `display` base rule can
 * silently outrank the native `[hidden]` UA style unless there's a matching
 * `[hidden] { display: none }` override (core-closable.spec.ts's own
 * docblock covers the first time this bit `.shoji-close`) — jsdom unit
 * tests can only assert the `hidden` *attribute* is present, not that it
 * actually took visual effect. `.shoji-toolbar-button[hidden]` needed the
 * same override once this button also became a `.shoji-toolbar-button`.
 */

const corePath = () => '/@fs' + path.join(process.cwd(), 'src/core/index.ts').replace(/\\/g, '/');

async function openGallery(
  page: Page,
  startIndex: number,
  options: Record<string, unknown> = {},
): Promise<void> {
  await page.evaluate(
    async ({
      corePath,
      startIndex,
      options,
    }: {
      corePath: string;
      startIndex: number;
      options: Record<string, unknown>;
    }) => {
      const { Gallery } = await import(/* @vite-ignore */ corePath);
      const el = document.createElement('div');
      document.body.appendChild(el);
      const gallery = new Gallery(el, {
        items: [
          { id: 'p', src: 'a.jpg', caption: 'A photo caption' },
          // Not under demo/assets/ on purpose — gitignored, user-local
          // sample media, absent in CI/a fresh clone. A real file isn't
          // needed: SlideManager inserts <video> immediately regardless of
          // whether the src ever loads.
          { id: 'v', src: 'nonexistent.mp4', video: { provider: 'html5' }, caption: 'A caption' },
        ],
        ...options,
      });
      gallery.open(startIndex);
    },
    { corePath: corePath(), startIndex, options },
  );
}

test('the toggle button is really invisible (real CSS, not just the hidden attribute) on a photo slide, and really visible on a captioned video slide', async ({
  page,
}) => {
  await page.goto('/pages/e2e-plugins.html');
  await openGallery(page, 0); // the photo slide

  // .last() — the fixture page's own (closed) gallery has its own toggle
  // button in the DOM too; this test's freshly-constructed gallery is the
  // one opened just above.
  const toggle = page.locator('.shoji-caption-toggle').last();
  await expect(toggle).toBeHidden();

  await page.locator('.shoji-nav-next').last().click(); // to the video slide
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
});

test('clicking the toggle reveals the caption (real CSS, not just the hidden attribute), a second click hides it again', async ({
  page,
}) => {
  await page.goto('/pages/e2e-plugins.html');
  await openGallery(page, 1); // straight onto the video slide

  const toggle = page.locator('.shoji-caption-toggle').last();
  const caption = page.locator('.shoji-caption').last();
  await expect(caption).toBeHidden();

  await toggle.click();
  await expect(caption).toBeVisible();
  await expect(caption).toHaveText('A caption');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');

  await toggle.click();
  await expect(caption).toBeHidden();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
});

test('showVideoCaption: true starts the caption visible instead', async ({ page }) => {
  await page.goto('/pages/e2e-plugins.html');
  await openGallery(page, 1, { showVideoCaption: true }); // straight onto the video slide

  const caption = page.locator('.shoji-caption').last();
  await expect(caption).toBeVisible();
});
