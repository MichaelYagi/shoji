import { expect, test, type Page } from '@playwright/test';

// demo/assets/ is gitignored (personal sample media, dropped in locally — see demo/media.ts) so
// these run against zero assets: real scanning/click/video behavior is covered against synthetic
// markup by the jsdom unit tests (tests/unit/gallery-items.test.ts, scan.test.ts). What's e2e-only
// here is that each integration page's wiring survives a real browser without erroring, regardless
// of how many assets are actually present.

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  return errors;
}

const pages = [
  { path: '/', label: 'zero-config' },
  { path: '/pages/data-attributes.html', label: 'data-shoji-* attributes' },
  { path: '/pages/custom-selector.html', label: 'custom selector' },
  { path: '/pages/dynamic-mode.html', label: 'dynamic mode' },
  { path: '/pages/infinite-scroll.html', label: 'infinite scroll' },
];

for (const { path, label } of pages) {
  test(`${label} page loads and initializes without console errors`, async ({ page }) => {
    const errors = trackErrors(page);

    await page.goto(path);

    await expect(page.locator('#status')).toHaveText(/Loaded \d+ item\(s\)\./);
    expect(errors).toEqual([]);
  });
}

test('nav links between all four integration pages resolve', async ({ page }) => {
  await page.goto('/');
  for (const { path } of pages) {
    await page.goto(path);
    await expect(page.locator('.demo-nav a[aria-current="page"]')).toBeVisible();
  }
});

test('dynamic-mode shuffle button is wired up', async ({ page }) => {
  const errors = trackErrors(page);

  await page.goto('/pages/dynamic-mode.html');
  await page.locator('#shuffle').click();

  expect(errors).toEqual([]);
});
