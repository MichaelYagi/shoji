import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import path from 'node:path';

/**
 * Real-browser coverage for `backdropOpacity` (GalleryOptions) — specifically
 * that `1` reaches genuine, fully opaque black, which jsdom unit tests can't
 * verify (they only assert the custom property string is set, not what it
 * actually composites to on screen). Reported from real usage: the shipped
 * default backdrop color baked its own alpha directly into the rgba() value
 * (`rgba(0, 0, 0, 0.92)`), so `backdropOpacity: 1` — layered as a *second*,
 * multiplicative `opacity` on top of that — could only ever reach 0.92, never
 * true 1. Fixed in `shoji.css` by splitting the default color into a fully
 * opaque hue (`#000000` / `#ffffff`) with the real alpha moved entirely into
 * `--shoji-backdrop-opacity` (default `0.92` dark / `0.96` light, preserving
 * the exact same default look) — now the option's `1` is honest.
 */
const corePath = () => '/@fs' + path.join(process.cwd(), 'src/core/index.ts').replace(/\\/g, '/');

async function openGallery(page: Page, options: object): Promise<void> {
  await page.evaluate(
    async ({ corePath, options }: { corePath: string; options: object }) => {
      const { Gallery } = await import(/* @vite-ignore */ corePath);
      const el = document.createElement('div');
      document.body.appendChild(el);
      const gallery = new Gallery(el, {
        items: [{ id: 'a', src: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>' }],
        ...options,
      });
      gallery.open(0);
    },
    { corePath: corePath(), options },
  );
}

test("backdropOpacity: 1 renders as genuinely, fully opaque — not capped at the theme color's own baked-in alpha", async ({
  page,
}) => {
  await page.goto('/pages/e2e-plugins.html');
  await openGallery(page, { backdropOpacity: 1 });

  const backdrop = page.locator('.shoji-backdrop').last();
  await expect(backdrop).toHaveCSS('opacity', '1');
  await expect(backdrop).toHaveCSS('background-color', 'rgb(0, 0, 0)');
});

test('default (no backdropOpacity given) renders the same 0.92 look as before this option existed', async ({
  page,
}) => {
  await page.goto('/pages/e2e-plugins.html');
  await openGallery(page, {});

  const backdrop = page.locator('.shoji-backdrop').last();
  await expect(backdrop).toHaveCSS('opacity', '0.92');
});

test('backdropOpacity: 0.3 renders visibly lighter than the default', async ({ page }) => {
  await page.goto('/pages/e2e-plugins.html');
  await openGallery(page, { backdropOpacity: 0.3 });

  const backdrop = page.locator('.shoji-backdrop').last();
  await expect(backdrop).toHaveCSS('opacity', '0.3');
});
