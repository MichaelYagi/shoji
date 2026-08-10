# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows
[Semantic Versioning](https://semver.org/) (pre-1.0, so minor bumps may
still include breaking changes).

## [Unreleased]

### Fixed

- Rotating or flipping a photo on a narrow (mobile) viewport could grow the
  page itself wider than the screen, pushing the toolbar off-screen until
  the whole page was scrolled right to reach it. The rotated/flipped slide
  painting outside its own box was already clipped correctly within the
  lightbox, but some mobile browsers decide whether to widen the page's own
  layout viewport by checking `<html>`'s own overflow, not what's already
  clipped further down the tree. The scroll lock already applied while the
  lightbox is open now also locks `document.documentElement`'s `overflow`
  for the same duration, not just `document.body`'s.
- RotateFlip plugin: rotating a photo could crop its edges instead of
  shrinking it to fit — rotating by 90°/270° swaps the container's own
  footprint width/height, and on a non-square dialog (the common case,
  especially on mobile) the swapped footprint no longer fit back within the
  original space, so the far edges were clipped away rather than the whole
  rotated photo staying visible. A photo is now shrunk exactly as much as
  needed to avoid that, and grown back up to fill newly-available space on
  rotation — but never past its own native resolution, so a genuinely
  low-resolution photo doesn't visibly blur from being upscaled larger than
  its real pixel size, while a high-resolution one grows to fill the screen
  the way it should.

## [0.1.0-alpha.6] - 2026-08-09

### Added

- `a`/`d` (either letter case) now work as prev/next aliases alongside the
  existing arrow keys. `w`/`s` zoom in/out by the same step as the Zoom
  plugin's own toolbar buttons — only when that plugin is loaded, since
  core has no concept of "zoom" at all.
- Autoplay now skips a YouTube slide that errors out (removed, private,
  embedding disabled, ...) instead of stalling on it — the Video plugin
  surfaces YouTube's own `onError` as a bubbling `error` event, and
  Autoplay advances to the next slide on it, the same as it would once an
  ordinary video's `ended` event fires.

### Fixed

- The open() placeholder could itself show as a blank/black gap — most
  visibly with the Layout plugin, whose tiles (including Shoji's own demo)
  commonly reuse the full-resolution image as `item.thumb`, with only CSS
  shrinking its on-screen size. A brand-new `<img>` still has to fully
  decode a large file before it paints anything, regardless of cache
  status, so inserting the placeholder immediately could leave a longer
  blank gap than just showing the spinner would have. It now waits for its
  own decode to finish before appearing — a genuinely small/fast thumb is
  unaffected, a slow one just leaves the spinner up a little longer instead
  of showing nothing.
- Zoom plugin: evenly-spaced horizontal lines could appear across a zoomed
  photo at certain zoom levels on real GPU hardware — a known Chromium
  rendering quirk (GPU raster-tile seams) with 2D `scale()` transforms on
  large scaled content, also independently observed in lightGalleryJS. Now
  uses `translate3d`/`scale3d` instead, the standard mitigation for this
  class of bug. A milder version of the same artifact on the toolbar's own
  buttons (a sibling of the zoomed image) is addressed by giving the
  toolbar its own stable compositing layer (`will-change: transform`).
- Opening/closing the lightbox felt sluggish, most noticeably with the
  Layout plugin's masonry/justified modes. Two contributing fixes: the
  open/close zoom-from-thumbnail animation now uses `translate3d`/`scale3d`
  and a scoped `will-change: transform` (same GPU-compositing fix as the
  Zoom plugin, above); and masonry/justified's own container now uses
  `contain: layout style`, so opening/closing (which has to measure layout)
  no longer forces the browser to needlessly recompute that container's
  own — often large — set of individually positioned tiles.
- RotateFlip plugin: "Rotate right" visibly spun the image counter-clockwise
  instead, whenever exactly one flip axis (horizontal or vertical, not both)
  was active — a single-axis mirror reverses a rotation's visual handedness.
  The rotate buttons now invert their delta in that case, so they always
  spin the image the way they're labeled, regardless of flip state.

## [0.1.0-alpha.5] - 2026-08-09

### Added

- The mouse cursor now hides along with the controls once auto-hide kicks
  in, instead of lingering visibly over the photo — including overriding a
  plugin's own cursor styling (e.g. Zoom's zoom-in/grab affordance).
- RotateFlip's four toolbar buttons now ease into their new rotation/flip
  instead of jumping instantly, same "discrete jumps animate" treatment the
  Zoom plugin's buttons already had. The per-slide reset on open/navigate
  stays instant — there's nothing to animate from on a slide that was never
  rotated. A full rotation (four rotate-right clicks) keeps animating
  forward the whole way through instead of visibly spinning backward on the
  last click — the animated value is now a separate, unbounded counter, not
  the normalized 0-360 state a browser would otherwise interpolate as a
  large decrease once it wraps back to 0. Flipping horizontal then vertical
  now animates as a plain flip too, instead of a simultaneous twist+spin —
  the end orientation was always correct, only the animated path looked
  wrong before.

## [0.1.0-alpha.4] - 2026-08-09

### Added

- On a fresh `open()`, a low-res placeholder (scaled by the same zoom-in
  animation as the real content) now shows in place of the loading spinner
  when one's available, swapping to the real image the instant it decodes.
  Checked in order: `item.thumb`, a live `data-shoji-thumb` attribute on the
  origin element, then whatever `<img>` is already rendered inside it — no
  new config, existing spinner behavior unchanged if none apply. Only
  applies to `open()`, never ordinary slide-to-slide navigation. The
  animation always sizes itself to the real photo's dimensions, not the
  placeholder's own (often differently-cropped) shape. The placeholder is
  forced to fill the frame (blurry, deliberately) rather than rendering at
  its own small native size; the real content then swaps in instantly, with
  no animation of its own — the outer zoom already does the growing.

### Fixed

- Zoom plugin: zooming in via "Actual size" (or any zoom), then navigating
  to the next/previous slide, could leave a strip of the old, still-zoomed
  photo visibly bled into the new slide along one edge — the zoom reset ran
  after the old slide's content had already been reused into a different,
  unclipped pool slot, too late to find and clear its transform. Now also
  resets before that reassignment happens, not just after.
- Zoom-from-thumbnail worked on the first `open()` of a session, then
  silently stopped working on every `open()` after a `close()` — closing
  left the zoom-out-to-thumbnail transform permanently stuck on the slide,
  which the next open then mistook for the slide's natural (un-transformed)
  size, computing a barely-visible zoom instead of a real one. Caused by a
  real-browser quirk (the CSSOM reformats a transform's numeric values when
  read back, so comparing it against the raw string that was set never
  matched) that only reproduces in a real browser, not a unit test.
- Auto-hide's hover-pause (never hiding while a control is hovered) used to
  only cover the close/prev/next/caption-toggle buttons — the caption text,
  the counter, the toolbar bar's own padding, and any plugin-added overlay
  (`ctx.ui.overlay()`, `ctx.ui.toolbar()`) had no effect on it, so hovering
  any of those could still let the whole overlay vanish underneath the
  viewer. Now covers everything in the overlay except the slide media
  itself (photos still auto-hide on schedule while just being looked at,
  which is the point).

## [0.1.0-alpha.3] - 2026-08-08

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
- `Shoji.Video` plugin — renders `{ video: { provider: 'youtube', id } }`
  items as a real YouTube embed (core's native `<video>` rendering only
  handles `provider: 'html5'`). No poster/thumbnail handling; Autoplay's
  slideshow waits for the real player's own `ended` state, same as native
  video. `data-shoji-video` URLs pointing at `youtube.com`/`youtu.be` are
  now auto-detected in selector mode.
- `ctx.ui.registerVideoProvider(name, renderFn)` — new plugin hook for
  supplying the embed for a non-`'html5'` video provider.
- Autoplay's `showProgress` option (default `true`) — set to `false` to
  turn off the timed-slide progress bar entirely; purely presentational,
  doesn't affect timing.
- A video slide's caption now starts hidden by default, with a toolbar
  toggle button to show it on demand — `showVideoCaption: boolean`
  (`GalleryOptions`, default `false`) overrides the starting point. Photo
  slides are unaffected; their captions are always shown as before.
  Core's size budget is raised 20 kB → 21 kB min+gzip for this baseline
  feature (CLAUDE.md/DESIGN.md updated to match).

### Fixed

- Zoom plugin's toolbar buttons, double-click/double-tap, and "Actual
  size" now ease into their new scale/pan instead of jumping instantly —
  pinch, pan-drag, and ctrl+wheel are left untransitioned since they
  already track the input frame by frame.
- The open (zoom-in) transition's loading spinner no longer flashes
  briefly oversized on a fresh open with nothing decoded yet (e.g. a hard
  refresh, opening the first slide) — it was being mistaken for the real
  photo and used as the animation's target size.
- A caption on a video slide (HTML5 or a provider like YouTube) could
  cover the native control bar underneath it, leaving no way to
  scrub/adjust volume/go fullscreen — a long caption by growing tall
  enough to reach it, or even a short one on a video that fills most of
  the dialog. Fixed in three layers: the caption box is height-capped
  (`--shoji-caption-max-height`) and scrolls internally instead of
  growing without bound; on a video slide, clicks pass straight through
  its background to the video underneath (any actual links in a rich
  caption stay clickable); and, since a caption you can click past but
  still can't see past is still confusing, a video slide's caption now
  defaults to hidden entirely (see `showVideoCaption` above).
- A provider video's (e.g. YouTube) own title bar, shown at the top on
  hover, could end up under Shoji's own toolbar — the same problem as
  above but at the top edge. The embed now reserves a top gutter
  (`--shoji-provider-video-top-inset`) matching the toolbar's height, so
  the two never overlap regardless of toolbar visibility. HTML5 video is
  unaffected — native controls never render anything at the top.
- Autoplay's automatic play on a provider video (e.g. YouTube) could
  silently never take effect on a slow/CPU-constrained device — the
  embed's postMessage bridge can need more real time after "ready"
  before it reliably processes its first command. Now retries a few
  times with a short delay instead of a single best-effort attempt,
  giving up gracefully (pausing the slideshow) if every retry is
  exhausted.
- The HTML5 video play-overlay's click handler could throw an uncaught
  `NotSupportedError` (`Uncaught (in promise) ... The element has no
supported sources.`) when clicked on a video whose `src`/`sources`
  don't actually resolve to anything playable (a bad path, a removed
  file, an unsupported format) — the rejected `play()` promise had
  nothing to catch it.

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
