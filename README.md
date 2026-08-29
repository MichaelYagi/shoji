# Shoji

[![CI](https://github.com/MichaelYagi/shoji/actions/workflows/ci.yml/badge.svg)](https://github.com/MichaelYagi/shoji/actions/workflows/ci.yml)
[![npm (beta)](https://img.shields.io/npm/v/%40michaelyagi%2Fshoji/beta.svg)](https://www.npmjs.com/package/@michaelyagi/shoji)

> **AI-authored.** 100% of the code was written by Claude (Anthropic); I shaped the architecture, scope, and every decision, and did all the testing.

A zero-dependency, plugin-first TypeScript lightbox/gallery. Drop in two `<script>`/`<link>` tags, or install from npm — everything beyond the minimal lightbox, including every official plugin, is opt-in.

## Features

- **Zero runtime dependencies**, TypeScript strict mode throughout.
- **Selector mode or dynamic mode** — scan existing DOM markup, or hand it an `items` array.
- **Plugin system** — zoom (pinch/pan/wheel), fullscreen, rotate/flip, autoplay/slideshow, active-thumbnail sync, YouTube video embeds, and a grid/masonry/justified layout engine, each independently opt-in.
- **Accessibility is not a plugin** — keyboard nav, focus trapping, ARIA roles, and screen-reader announcements live in core.
- **Themeable via CSS custom properties** — no hardcoded colors/sizes in JS.
- **Three distributions** — single-file (`dist/shoji.js` + `dist/shoji.css`, core + every plugin, self-registering) for zero-setup `<script>` tag use; core + individual plugin files (`dist/core/shoji-core.(min.)js` + `dist/plugins/{name}.(min.)js`) for `<script>`-tag consumers who want to pick exactly which plugins ship; and tree-shakable per-plugin ESM entries for bundler users.
- Size-budgeted and CI-enforced: core ≤ 21 kB, each plugin ≤ 8 kB, full bundle ≤ 90 kB (all min+gzip).

## Install

```html
<link rel="stylesheet" href="shoji.min.css" />
<script src="shoji.min.js"></script>
<script>
  new Shoji('#gallery');
</script>
```

```bash
npm install @michaelyagi/shoji@beta
```

```js
import Shoji from '@michaelyagi/shoji';
import '@michaelyagi/shoji/style.css';

new Shoji('#gallery', { plugins: [Shoji.Zoom] });
```

## CDN

Skip npm and load the built files straight from [jsDelivr](https://www.jsdelivr.net/), which mirrors every npm release automatically:

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@michaelyagi/shoji/dist/shoji.min.css" />
<script src="https://cdn.jsdelivr.net/npm/@michaelyagi/shoji/dist/shoji.min.js"></script>
```

- **Full bundle** (core + every plugin) — `dist/shoji.min.js` / `dist/shoji.min.css`, or unminified: `dist/shoji.js` / `dist/shoji.css`.
- **Core alone** — `dist/core/shoji-core.min.js` + `dist/core/shoji-core.min.css`.
- **Individual plugins**, loaded alongside core — `dist/plugins/<name>.min.js`, e.g. `zoom.min.js`, `layout.min.js`. Not every plugin ships CSS: `activeThumbnail`, `autoplay`, `layout`, and `zoom` do; `fullscreen`, `rotateFlip`, and `video` don't need any.

No version in the URL resolves to the latest release. To pin an exact one instead, add `@<version>` right after the package name — see [npmjs.com/package/@michaelyagi/shoji?activeTab=code](https://www.npmjs.com/package/@michaelyagi/shoji?activeTab=code) for what that currently is:

```html
<script src="https://cdn.jsdelivr.net/npm/@michaelyagi/shoji@0.1.0-beta.9/dist/shoji.min.js"></script>
```

## Quickstart

```html
<div id="gallery">
  <a href="photo-1-full.jpg"><img src="photo-1-thumb.jpg" alt="Sunset over the bay" /></a>
  <a href="photo-2-full.jpg"><img src="photo-2-thumb.jpg" alt="Mountain trail" /></a>
</div>
```

```js
new Shoji('#gallery');
```

No items array, no options object, no plugins — every default is chosen so this is a complete integration. See [`docs/guides/getting-started.html`](docs/guides/getting-started.html) for dynamic mode, the full `data-shoji-*` attribute mapping, and every `GalleryItem` field.

## Docs

- **[michaelyagi.github.io/shoji](https://michaelyagi.github.io/shoji)** — the published docs site, auto-deployed from `main` (see `.github/workflows/ci.yml`'s `publish-docs` job).
- **[npmjs.com/package/@michaelyagi/shoji](https://www.npmjs.com/package/@michaelyagi/shoji)** — the published package, auto-published on tagged releases (see `.github/workflows/ci.yml`'s `publish-npm` job).
- [`docs/index.html`](docs/index.html) — the same guides/examples/API reference, as local static HTML (open directly, or run `npm run docs` first to regenerate the API reference from source).
- [`docs/examples/`](docs/examples/) — real, runnable, self-contained example pages (copy one wholesale into your own project).
- [`DESIGN.md`](DESIGN.md) — the living architecture/spec document this project is built from.

## Development

```bash
npm install
npm run dev        # Vite dev server over demo/
npm run build      # dist/shoji.(min.)js + .css, plus per-plugin ESM entries
npm test           # Vitest unit tests
npm run test:e2e   # Playwright e2e (chromium/firefox/webkit/mobile)
npm run lint       # eslint + prettier check
npm run typecheck  # tsc --noEmit
npm run size       # build + size-limit budget check
npm run docs       # regenerate docs/api/ (typedoc)
npm run verify     # the full gate: typecheck + lint + unit + e2e + size
```

`demo/assets/` (sample photos/video for the local demo pages) is gitignored — drop your own media there, or the demo pages just render with 0 items.

## Releasing

1. Bump `package.json`'s `version` to `<version>`, commit, and push to `main`.
2. Tag that same version and push the tag:

```bash
git tag v<version>   # matching package.json exactly, e.g. v0.1.0-beta.11
git push --tags
```

Pushing the tag triggers `.github/workflows/ci.yml`'s `publish-npm` job — it runs the full verify gate (typecheck, lint, unit, e2e, size) first and only publishes if that passes. The dist-tag is derived automatically from the version string: a prerelease (e.g. `0.1.0-beta.11`) publishes under its own tag (`beta`) and is also promoted to `latest`; a plain version (e.g. `1.0.0`) just publishes as `latest` directly.

## License

MIT © Michael Yagi
