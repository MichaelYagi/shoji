import Shoji from '../../src/index';
import type { Gallery, GalleryItem, ShojiPlugin } from '../../src/core';
import { wireStatus } from '../status';

const thumbs = document.querySelector<HTMLDivElement>('#thumbs');
const status = document.querySelector<HTMLParagraphElement>('#status');

const COLORS = ['#c0392b', '#2980b9', '#27ae60', '#8e44ad'];

/**
 * Self-contained fixture images — inline SVG data URIs, not files under
 * demo/assets/ (gitignored personal media the user drops in locally, absent
 * in CI/a fresh clone). Fixed 800x600, so `width`/`height` are supplied up
 * front and no autoMeasure/decode-driven relayout is in play — deterministic
 * geometry for assertions.
 */
function photoSrc(n: number, color: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="${color}"/><text x="400" y="300" font-size="160" fill="white" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif">${n}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function buildItems(): GalleryItem[] {
  return COLORS.map((color, i) => ({
    id: `photo-${i}`,
    src: photoSrc(i + 1, color),
    thumb: photoSrc(i + 1, color),
    width: 800,
    height: 600,
    caption: `Fixture photo ${i + 1}`,
  }));
}

function renderThumbs(gallery: Gallery, items: GalleryItem[]): void {
  if (!thumbs) return;
  thumbs.innerHTML = items
    .map(
      (item, i) => `
        <a href="#" data-index="${i}" data-shoji-id="${item.id}">
          <img src="${item.thumb}" alt="${item.caption ?? ''}" />
        </a>`,
    )
    .join('');

  thumbs.querySelectorAll<HTMLAnchorElement>('a[data-index]').forEach((a) => {
    a.addEventListener('click', (event) => {
      event.preventDefault();
      gallery.open(Number(a.dataset.index));
    });
  });
}

if (thumbs && status) {
  const items = buildItems();
  // 300 by default — short, so most e2e assertions here don't need to wait
  // out a real 5s default. A test whose own timing would otherwise race that
  // fixed interval can override it via ?interval=<ms> instead of this page
  // guessing a value that avoids every possible collision for every test.
  const intervalParam = Number(new URLSearchParams(location.search).get('interval'));
  const interval = intervalParam > 0 ? intervalParam : 300;
  // Undefined (the default, Gallery's own 5000ms) unless a test needs a
  // short one to exercise the idle auto-hide timer without a multi-second
  // real wait — same override pattern as ?interval= above.
  const autoHideDelayParam = Number(new URLSearchParams(location.search).get('autoHideDelay'));
  const autoHideDelay = autoHideDelayParam > 0 ? autoHideDelayParam : undefined;
  // DESIGN.md §3.1a — deterministically forces the toolbar to overflow,
  // same override pattern as ?interval=/?autoHideDelay= above: a handful of
  // inert `ctx.ui.toolbar('right', ...)` buttons, one plugin per button so
  // registration order (the popover's own collapse priority) is legible in
  // a test. Absent by default — the five real plugins below don't overflow
  // a normal viewport on their own.
  const extraButtonsParam = Number(new URLSearchParams(location.search).get('extraToolbarButtons'));
  const extraButtonPlugins: ShojiPlugin[] = Array.from(
    { length: extraButtonsParam > 0 ? extraButtonsParam : 0 },
    (_, i) => ({
      name: `e2e-extra-button-${i}`,
      init(ctx) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'shoji-toolbar-button e2e-extra-button';
        button.dataset.e2eButton = String(i);
        button.textContent = String(i);
        ctx.ui.toolbar('right', button);
      },
    }),
  );
  // DESIGN.md §3.1a — regression fixture for a real bug: a plugin that
  // reaches into `.shoji-toolbar-right` directly (not through
  // `ctx.ui.toolbar()`) and toggles its own element's visibility via
  // `style.display` rather than the `hidden` attribute, mirroring exactly
  // how it was found (a host plugin's loading spinner, appended alongside
  // its own button). Absent by default; `?foreignToolbarElement=1` adds it.
  const foreignElementPlugin: ShojiPlugin[] = new URLSearchParams(location.search).get(
    'foreignToolbarElement',
  )
    ? [
        {
          name: 'e2e-foreign-toolbar-element',
          init(ctx) {
            const el = document.createElement('div');
            el.className = 'e2e-foreign-toolbar-element';
            el.style.display = 'none'; // visually hidden, but el.hidden stays false
            ctx.ui.outer().querySelector('.shoji-toolbar-right')?.appendChild(el);
            return () => el.remove();
          },
        },
      ]
    : [];
  const gallery = new Shoji(thumbs, {
    items,
    plugins: [
      Shoji.Zoom,
      Shoji.Fullscreen,
      Shoji.RotateFlip,
      Shoji.Autoplay,
      Shoji.ActiveThumbnail,
      ...extraButtonPlugins,
      ...foreignElementPlugin,
    ],
    autoplay: { interval },
    ...(autoHideDelay !== undefined ? { autoHideDelay } : {}),
  });

  renderThumbs(gallery, items);
  wireStatus(gallery, status);

  // Test-only hook: the DOM has up to `preload * 2 + 1` `.shoji-slide-media`
  // elements at once (SlideManager's pool), so a plain CSS locator can't
  // reliably pick out the *active* one from outside — this exposes the same
  // `getActiveMedia()` every plugin itself uses, so tests/e2e/plugins/*.spec.ts
  // can read it unambiguously instead of guessing DOM order.
  (window as unknown as { __shojiGallery: Gallery }).__shojiGallery = gallery;
}
