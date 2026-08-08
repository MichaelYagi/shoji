# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows
[Semantic Versioning](https://semver.org/) (pre-1.0, so minor bumps may
still include breaking changes).

## [Unreleased]

### Added

- `gallery.isOpen`/`isDestroyed`/`controlsHidden` getters and
  `gallery.getActivePlugins()` — instance introspection that was tracked
  internally already but had no public read path.
- `Shoji.version` — static, sourced from `package.json` so it can't drift
  from the actual release.
- A faint, semi-transparent play-button overlay on paused HTML5 video
  slides (core baseline, not a plugin) — tracks the `<video>`'s own
  `play`/`pause`/`ended` state, doubles as a click target, always stays
  visible regardless of auto-hide. Presentational only: no
  `GalleryOptions` toggle, hide `.shoji-video-play-overlay` in CSS instead.
- Dedicated docs guide pages: Transitions, Methods, Events, Settings.

### Fixed

- Zoom plugin's toolbar buttons, double-click/double-tap, and "Actual
  size" now ease into their new scale/pan instead of jumping instantly —
  pinch, pan-drag, and ctrl+wheel are left untransitioned since they
  already track the input frame by frame.

## [0.1.0-alpha.2] - 2026-08-07

### Added

- `closable: boolean` (`GalleryOptions`, default `true`) — `false` disables
  every viewer-facing way to close the lightbox (close button, backdrop
  click, `Escape`, vertical swipe-to-close). `gallery.close()` remains
  callable programmatically either way.
- `preload` (`GalleryOptions`) now actually prevents the loading spinner
  within its window, not just keeps slots mounted — `SlideManager` caches
  ready content by item index (surviving pool slot reshuffling), so
  navigating to an already-decoded neighbor swaps it in instantly.
- Slow/in-flight decodes are now deduplicated by item index — navigating to
  a slide before its preload finished used to abandon that decode and start
  a duplicate one from zero; now it reuses the same in-flight request.
- A loading spinner (`.shoji-slide-spinner`, CSS-only, themeable via
  `--shoji-spinner-size`/`--shoji-spinner-thickness`) now shows on a slide
  while its content is still decoding, replacing an earlier "keep the
  previous image visible" approach that read as broken rather than helpful.
- Feature toolbar buttons (zoom, rotate, fullscreen, autoplay, any
  plugin-registered button) grey out and become inert while the active
  slide is still loading — never close/prev/next, so a slow image can't
  trap the viewer.
- The caption now hides for the same window the active slide is loading
  (matching the toolbar-button behavior above), instead of showing text for
  a photo that hasn't actually appeared yet.
- `layoutRender` event (Layout plugin) — fires after a render pass builds
  tile DOM, with `{ tiles: { index, element }[] }` for tiles built that
  pass, so a host can inject custom content (badges, selection checkboxes)
  into tiles without re-deriving which ones are new.
- `data-shoji-index` — always set on every Layout tile (unlike the
  pre-existing, optional `data-shoji-id`), for reliable element → item-index
  lookup from a click handler or other DOM-only context.
- `headingOverflow: 'wrap'` (Layout plugin, justified + structured
  `{title, subtitle}` headings) — a label that doesn't fit wraps onto extra
  lines instead of either overflowing (`'show'`) or pushing its section
  onto a fresh row (`'fit'`), capped by `maxRowHeight` via line-clamp. Real
  Google Photos behavior for date headers.
- `data-shoji-*` custom attributes on scanned elements now populate
  `item.data` automatically in selector mode.
- Generic `--shoji-z-base` custom property controlling `.shoji-outer`'s
  page-level z-index, separate from the internal 0–40 stacking scale used
  only between elements inside the lightbox.
- `title`/`aria-label` tooltips on every toolbar/nav/close button.
- CI now auto-publishes `docs/` to `michaelyagi.github.io/shoji` on every
  push to `main` (`.github/workflows/ci.yml`, `publish-docs` job).

### Changed

- Layout plugin's structured heading form (`{title, subtitle}`) default
  styling swapped: title (the label, e.g. "Taken") is now muted/normal
  weight, subtitle (the value, e.g. a date) is bold — the inverse of the
  previous default — and both share the same font-size (`0.875rem` by
  default) instead of the title inheriting an unrelated, oversized
  browser-default `<h2>` size.
- Core size budget raised from 18 kB to 20 kB min+gzip (`CLAUDE.md`,
  `.size-limit.json`) to accommodate the above features.

### Fixed

- **Auto-hide controls could get stuck visible forever.** Clicking any
  toolbar/nav button leaves it focused as an ordinary side effect (not just
  deliberate keyboard navigation) — auto-hide used to treat any focused
  control as a permanent block, so if the viewer simply stopped interacting
  after a click (moved the mouse away, switched windows) without focusing
  anything else first, the controls never faded. Focus still resets the
  idle clock like any other activity; it no longer stands as a standing
  block once nothing further happens. Only a genuinely _hovered_ control
  (a real, continuously-tracked state) still pauses the countdown.
- **Zoom plugin's "Actual size" (and any zoom action landing right as the
  lightbox opens) could silently no-op or produce a wrong pan/scale.** The
  open transition (`zoomIn`) applies its own transform directly to
  `.shoji-slide-media`, the same element the zoom plugin measures for its
  "natural size" baseline — a zoom action firing before that transition
  settled captured a wildly wrong, mid-animation rect and permanently
  poisoned that slide's zoom math. Zoom actions now defer until the open
  transition has actually settled.
- `.shoji-close[hidden]` had no visual effect (`closable: false` didn't
  actually hide the close button) — its own `display: flex` base rule
  outranked the native `[hidden]` UA style, unlike `.shoji-nav`/
  `.shoji-counter`/`.shoji-caption`, which already had the override.
- A slot's outgoing content (particularly a `<video>`) could be
  destructively released (paused, `src` cleared) while still needed by a
  _different_ slot within the same navigation — e.g. stepping backward
  shifts every slot's content down by one, all in one pass. Content that's
  still reusable is now reclaimed before anything gets released.
- `GalleryItem.srcset`/`sizes` were declared on the type from the start but
  never actually applied to the rendered `<img>`.
- Closing while zoomed animated the zoom-out-to-thumbnail transition from
  the image's current zoomed/panned rect instead of its natural one.
- A pan drag while zoomed could still retarget its release `click` to the
  dialog (closing the lightbox) instead of being fully suspended.
- The active `<img>`'s native browser drag (drag-to-save-elsewhere) could
  win the race against a real pan/navigate/close gesture, silently cancelling it mid-drag.

## [0.1.0-alpha.1] - 2026-08-06

Initial alpha release: core lightbox (virtualized slides, gestures,
transitions, accessibility) plus six official plugins (Zoom, Fullscreen,
RotateFlip, Autoplay, ActiveThumbnail, Layout), full unit + e2e test suite,
demo site, and docs (guides, API reference, runnable examples).
