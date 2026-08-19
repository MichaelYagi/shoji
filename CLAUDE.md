# CLAUDE.md

## Project

**Shoji** (障子 — the translucent sliding screen that diffuses light) is a modern, zero-dependency, TypeScript lightbox/gallery library intended as a full replacement for lightGallery. It reaches feature parity with lightGallery's core, plus a first-class plugin system, slideshow, video (HTML5 + YouTube + Vimeo), and a grid/masonry/justified layout engine — with a smaller, cleaner core. v1 scope is closed: core plus seven official plugins (Zoom, Fullscreen, RotateFlip, Autoplay, ActiveThumbnail, Video, Layout). Multi-select, a WebGL edit mode, bidirectional infinite scroll, Hash/deep-links, Share, Comments, and Pagers were all scoped at one point and later decided **not implementing** — see DESIGN.md §4/§6/§7/§8 for why each was cut. Don't build toward them speculatively; add one back only if an actual use case needs it.

Read `DESIGN.md` before writing any code. It is the source of truth for architecture, the plugin API contract, and per-feature specs. If an implementation decision contradicts DESIGN.md, stop and update DESIGN.md first (or flag the conflict) — never let the two drift silently.

## Hard constraints

- **Clean-room only.** lightGallery is GPL-3.0: never read, fetch, or paste its source (minified or not) into this project or into Claude Code sessions. Parity is defined by DESIGN.md's behavior specs and public docs, not their implementation.
- **Zero runtime dependencies.** No jQuery, no lodash, no framework. Vanilla TS/DOM only. Dev dependencies (build, test, lint) are fine.
- **TypeScript strict mode.** `strict: true`, no `any` except at documented interop boundaries, explicit public API types.
- **Core stays small.** Everything that can be a plugin is a plugin. Core budget: ≤ 22.4 kB min+gzip (see DESIGN.md's running budget-history for why it's grown past its original 20 kB). Each official plugin: ≤ 8 kB min+gzip. Full bundle: ≤ 90 kB min+gzip. CI fails on budget breach.
- **Single-file distribution is the primary artifact.** `npm run build` must always emit `dist/shoji.js` + `dist/shoji.css` (and `.min` variants): one JS file and one CSS file containing core **and all official plugins**, self-registering, zero setup — drop two `<script>`/`<link>` tags in and everything works. Tree-shakable per-plugin ESM entries are also emitted for bundler users, but the single-file pair is what releases are cut from and what the demo site loads; it must never break or lag behind.
- **No global namespace pollution.** ESM-first. UMD build exposes exactly one global (`Shoji`).
- **CSS is theme-able via custom properties.** No hardcoded colors/sizes/timings in JS — this includes animation/transition durations and easing curves, not just visual color/size values (see DESIGN.md §2.4's `--shoji-momentum-easing` precedent). All styling through `--shoji-*` custom properties with sane defaults. CSS-only sizing/resizing for media (no JS layout thrash on resize where avoidable).
- **Accessibility is not a plugin.** Keyboard nav, focus trapping, ARIA roles, and screen-reader announcements live in core and cannot be disabled by accident.
- **Progressive enhancement.** A feature resting on browser API support that isn't universal degrades gracefully — no toolbar button at all rather than a broken one (e.g. Fullscreen's own no-Fullscreen-API-support handling). Touch features must not break mouse/keyboard, and vice versa.

## Repository layout

```
/src
  /core            # Gallery core: lifecycle, state, slide manager, event bus
  /gestures        # Pointer/touch/wheel gesture engine
  /transitions     # Built-in animations (CSS3, hardware-accelerated)
  /a11y            # Focus trap, ARIA, announcements
  /plugins
    /zoom
    /fullscreen
    /rotateFlip    # Rotate/flip view controls (non-destructive)
    /autoplay      # Slideshow
    /activeThumbnail  # Syncs a host's own thumbnail grid to the active slide
    /video         # HTML5 + YouTube + Vimeo
    /layout        # Inline gallery layouts: grid, masonry, justified rows
  /styles          # shoji.css + per-plugin css, custom-property driven
/tests
  /unit            # Vitest, jsdom
  /e2e             # Playwright: gestures, keyboard, focus, visual
/demo              # Vite demo site; every feature demonstrated here
/docs              # API docs (typedoc) + guides
```

## Commands

```bash
npm run dev          # Vite dev server with /demo
npm run build        # dist/shoji.(min.)js + dist/shoji.(min.)css (core+all plugins, UMD+ESM)
                     # plus per-plugin ESM entries + d.ts for bundler users
npm run test         # Vitest unit tests
npm run test:e2e     # Playwright
npm run lint         # eslint + prettier check
npm run size         # size-limit check against budgets above
```

Run `lint`, `test`, and `size` before considering any task done. New features require: unit tests, an e2e test if user-interactive, a demo page entry, and a docs page.

## Coding conventions

- One class/module per file; files ≤ ~400 lines — split before they grow past that.
- Public API surface is defined in `src/index.ts` and per-plugin `index.ts` only. Everything else is internal and may change freely.
- Events over inheritance: features communicate via the typed event bus (`gallery.on/emit`), never by reaching into another plugin's internals.
- DOM writes batched via rAF where they can thrash layout. No forced synchronous layout in hot paths (gestures, scroll, transitions).
- Passive event listeners for scroll/touch unless `preventDefault` is genuinely required (document each non-passive listener with a comment).
- All user-visible strings go through the `locale` option (flat key map) — no hardcoded English in UI.
- No `data-*` attribute squatting outside the `data-shoji-*` prefix.
- Every plugin must be destroyable: `destroy()` removes all listeners, DOM, and observers it added. Leak tests assert this.

## Definition of done (per feature)

1. Matches the spec in DESIGN.md (update DESIGN.md if the spec evolved).
2. Unit + e2e tests green, including destroy/leak test.
3. Works with keyboard only and with screen reader landmarks intact.
4. Works on touch (Playwright mobile emulation) and desktop.
5. Size budget respected.
6. Demo page updated.

## Things to be careful about (learned the hard way upstream)

- **Masonry + prepend/reflow**: masonry positions are computed from item aspect ratios (`width`/`height` in the item model), never from measuring loaded images — measuring causes layout jumps as images arrive. Prepending into a masonry layout relayouts everything below it; there's no scroll-anchoring coordination for that today (it was scoped against a bidirectional infinite-scroll plugin that's since been cut, not just deferred) — a prepend can shift the viewport's scroll position. See DESIGN.md §5.
- **Progressive image loading / GPU tile seams**: large images decoded progressively can show tile seam artifacts during GPU-composited transitions. Decode fully (`img.decode()`) before running enter animations.
- **Flip + rotate compose non-commutatively.** Use the normalization table in `src/core/rotateFlipNormalize.ts` (DESIGN.md §4.5) verbatim; don't re-derive it.
