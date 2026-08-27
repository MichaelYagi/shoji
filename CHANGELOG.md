# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows
[Semantic Versioning](https://semver.org/) (pre-1.0, so minor bumps may
still include breaking changes).

## [0.1.0-beta.5] - 2026-08-26

### Added

- **`ActiveThumbnail`'s `highlightDuration` option.** Opt-in auto-fade for
  the `highlight` styling, in milliseconds, counted from `close()` (when
  it actually becomes visible) rather than from whenever the slide became
  active. Default `undefined` — persists indefinitely, same as before.
  Fades `--shoji-active-thumbnail-border-color` to `transparent` via a
  CSS transition; reopening or navigating before it fires cancels it and
  resets to full color.

### Fixed

- **`ActiveThumbnail`'s `highlight` styling no longer bleeds into a
  neighboring image.** The `border` used since beta.4 reserves real
  layout space — correct for Layout's own fixed-size tiles, but for a
  plain DOM/selector-mode host anchor (no fixed size, sized to its
  content) it grows the anchor past the image's real edges. With zero
  gap between stacked host anchors, that extra space landed inside the
  _next_ image instead of staying contained. Switched to `outline` with
  a _negative_ `outline-offset` — unlike `border`, `outline` never
  affects an element's own box size, so it can't grow past a neighbor;
  unlike a plain (positive-offset) `outline`, pulling it inward keeps it
  from spilling outside the box the way that already-rejected approach
  did.
- **The `highlightDuration` fade now actually animates instead of
  cutting instantly.** CSS transitions don't animate a value driven by
  an _unregistered_ custom property change — the browser treats it as
  an instant substitution, not something to interpolate, even though the
  consuming property is itself transitionable. Fixed by registering
  `--shoji-active-thumbnail-border-color` with `@property` as a real
  `<color>`.
- **`tests/e2e/plugins/activeThumbnail.spec.ts` updated** to match
  beta.4's persist-after-close behavior — it still asserted the old
  clear-on-close behavior, which beta.4 shipped without updating it,
  breaking CI.

## [0.1.0-beta.4] - 2026-08-26

### Added

- **`ActiveThumbnail`'s `highlight`/`borderColor` options.** Opt-in
  (`highlight`, default `false`) default visual styling for the active
  thumbnail — previously the plugin only ever toggled a class
  (`activeClass`), leaving 100% of the look to the host, which meant a
  host with no thumbnail grid of its own to style had no way to actually
  see it working at all. `borderColor` (default `'blue'`) sets a real
  `border` around the active element via
  `--shoji-active-thumbnail-border-color`.

### Fixed

- **`ActiveThumbnail`'s active class (and `highlight` styling) is no
  longer cleared on `close()`.** The whole point of a visible "you were
  just looking at this one" marker is seeing it once the lightbox and its
  backdrop are out of the way — clearing it the instant the lightbox
  closed meant it could never actually be seen. It now persists until a
  genuinely different slide becomes active; only a real `destroy()`
  removes it.
- **`scrollIntoView` no longer silently fails to move the page when
  navigation and `close()` happen close together** (the normal case at
  ordinary clicking speed). The flush for a still-pending scroll now runs
  on `beforeClose` instead of `close` — before the core's own scroll-lock
  restore decision, not after — so it can no longer lose the race and get
  wrongly overridden.
- **`ActiveThumbnail`'s scroll-lock coordination now works correctly when
  loaded via the Core + plugins standalone distribution** (`dist/core/` +
  `dist/plugins/{name}.js` as separate script tags). It previously
  imported an internal core module directly, which — bundled separately
  from core in that distribution mode — silently became a disconnected
  copy of that module's state, no-op-ing the fix above specifically in
  that mode. Fixed via a new public `Gallery.markIntentionalScroll()`
  method, reached through the single shared `Gallery` instance instead.
- **`ActiveThumbnail`'s default highlight now uses a real `border`
  instead of `outline` or `box-shadow`**, after both were found to be
  effectively invisible in real use: `outline` draws outside the
  element's own box, which a tightly-gutter'd Layout grid has no room
  for; `box-shadow` (even `inset`) paints underneath child content, so a
  tile's own full-bleed `<img>` completely covered it. A real `border`
  has neither problem. Also now `display: inline-block` — a
  `display: inline` host anchor (plain DOM/selector-mode markup with no
  Layout) only drew the border at text-line height, not around a large
  child image's real size, a well-known CSS quirk for non-replaced
  inline elements.

## [0.1.0-beta.3] - 2026-08-26

### Added

- **A third distribution option, alongside the combined single-file
  bundle and the tree-shakable ESM entries.** `dist/core/shoji-core.(min.)js`
  and `.css` (Gallery alone, no plugin statics — ~63 kB/~17 kB gzip
  minified), plus `dist/plugins/{name}.(min.)js` and `.css`, one per
  official plugin. For a `<script>`-tag consumer who wants to pick
  exactly which plugins ship — Zoom and Autoplay but not the other
  five, say — without adopting a bundler just to trim them. Each
  plugin file attaches itself onto the already-loaded `Shoji` global
  (`Shoji.Autoplay`, etc.), the same "one global" mechanism the
  combined bundle uses, just one script tag at a time;
  `shoji-core.js` must load first. See the Getting Started guide's
  new "Core + individual plugin files" section, and DESIGN.md §10.

## [0.1.0-beta.2] - 2026-08-26

### Fixed

- **README's npm badge and install instructions still pointed at the
  `alpha` dist-tag** — a leftover from before the beta series started;
  the badge would have kept showing `0.1.0-alpha.39` forever regardless
  of what `latest`/`beta` point to. Now reads `beta`, matching `npm
install @michaelyagi/shoji@beta`.

## [0.1.0-beta.1] - 2026-08-26

First beta release — the alpha series is done; from here, `npm install
@michaelyagi/shoji@beta` tracks the newest beta build (`latest` now points
here too).

### Fixed

- **A Vimeo item whose declared `width`/`height` didn't match the video's
  real shape could show a white gap where Shoji's theme background should
  be** — Vimeo's own player fits itself to the video's real aspect ratio
  regardless of the box it's given, so a mismatch left Shoji's outer box a
  different shape than what Vimeo actually rendered inside it, exposing
  the (cross-origin, unreachable) iframe's default white background in
  the resulting gap. `vimeo.ts` now also queries the player's own
  `getVideoWidth()`/`getVideoHeight()` once ready and self-corrects,
  regardless of what `item.width`/`item.height` claims. YouTube is
  unaffected by this specific bug and isn't changed. See DESIGN.md §4.3.

## [0.1.0-alpha.39] - 2026-08-25

### Added

- **A generic `request*` command surface across Autoplay, Zoom,
  RotateFlip, and Fullscreen**, so a custom (host-authored) plugin's own
  toolbar button can drive any of these four plugins without importing
  them at all — no core changes needed, since `GalleryEvents` already
  extends `Record<string, unknown>`.
  - Autoplay: `requestAutoplayStart`, `requestAutoplayPause`
  - Zoom: `requestZoomIn`, `requestZoomOut`, `requestZoomActualSize`,
    `requestZoomReset`
  - RotateFlip: `requestRotateLeft`, `requestRotateRight`,
    `requestFlipHorizontal`, `requestFlipVertical`
  - Fullscreen: `requestFullscreenToggle`

  Each mirrors its real toolbar button exactly — same function, same
  behavior, same edge-case handling (e.g. Autoplay's `requestAutoplayStart`
  gets the same zoomed/rotated re-check the real Play button does). See
  DESIGN.md §4.1 point 20, §4.4, §4.5, §4.6.

## [0.1.0-alpha.38] - 2026-08-25

### Added

- **`Autoplay`'s new `pauseOnManualNavigate` option** — pauses the
  slideshow the moment the viewer navigates manually (arrows/buttons, a
  completed swipe, a thumbnail click, or any other `goTo()` not caused by
  Autoplay's own advance), instead of silently re-timing itself on
  whatever slide they land on. Default **`true`**.

### Changed

- **`pauseOnZoom`, `pauseOnRotateFlip`, and `pauseOnCaptionExpand` now
  default to `true`** (previously `false`/opt-in). Reaching for any view
  control is a clear, direct engagement signal — a slideshow that keeps
  advancing underneath that reads as broken, not helpful. Set any of them
  to `false` to restore the previous always-keep-running behavior. See
  DESIGN.md §4.1, points 17-19.

## [0.1.0-alpha.37] - 2026-08-24

### Fixed

- **A drag starting inside a video's reserved bottom margin (left alone
  for the browser's own scrub-bar controls) could still close the
  gallery**, if the pointer moved far enough that its un-captured trailing
  `click` landed outside the video's own rendered bounds, in the slide's
  empty letterbox padding — read as a genuine backdrop click. Confirmed on
  a mobile-sized viewport, where a 200px vertical drag routinely exceeds
  the video's own rendered height. Fixed by suppressing that one trailing
  click, the same way an already-captured drag's own retargeted click was
  already suppressed. See DESIGN.md §2.4.

## [0.1.0-alpha.36] - 2026-08-24

### Fixed

- **Hotfix for alpha.35's pool-wrap feature: two provider-video items that
  a real fixture deliberately keeps apart (a spacer tile between them,
  specifically so at most one embed is ever resident in the DOM at once)
  could end up wrapped into the same pool together anyway**, when the
  gallery's real item count exactly matched the pool size
  (`2*preload + 1`) — the "prev" slot at the first item and the "next"
  slot at the last item both wrap to the _other_ end regardless of what
  sits between them in the source array. alpha.35's own collision guard
  (`items.length >= pool size`) allowed exactly this case through, since
  no single index is ever assigned twice here — only strictly more items
  than pool slots (`>`, not `>=`) actually prevents the first and last
  items from becoming pool-adjacent. See DESIGN.md §2.3.

## [0.1.0-alpha.35] - 2026-08-24

### Fixed

- **Swiping past the last slide (or before the first) showed nothing
  coming in, even with `loop: true` (the default)** — the completed
  navigation itself already wrapped correctly, but the pool's own preload
  computation never accounted for looping at all, so the boundary-adjacent
  slot simply had no item to show during the drag. `SlideManager`'s pool
  now wraps around the ends the same way `Gallery`'s own navigation
  already does, whenever there are enough items to fill the pool without
  revisiting one twice — below that item count, a boundary slot still
  shows nothing, same as `loop: false`. See DESIGN.md §2.3.

## [0.1.0-alpha.34] - 2026-08-24

### Fixed

- **Swipe-to-navigate and drag-to-close over an HTML5 video slide could
  fail — most reliably for a horizontal navigate drag, in every browser.**
  `<video>` is natively draggable by default, same as `<img>` (already
  fixed for photos); left on, a real drag gesture could lose the race to
  the browser's own native media-drag recognition, which fires
  `pointercancel` and hands the interaction to `dragstart`/`drag` instead
  — the gesture appears to move once, then stop dead. `video.draggable =
false` now matches the existing photo fix. See DESIGN.md §2.4.

## [0.1.0-alpha.33] - 2026-08-24

### Fixed

- **Dragging to navigate or close a slide also started the browser's own
  native text/image selection**, visible as the photo or video
  highlighting blue mid-drag. `GestureEngine`'s own `preventDefault()`
  only ever fires once a horizontal drag's direction has locked (and
  never for a vertical one at all), so the browser's selection-start
  heuristic already had a head start regardless. Fixed with `user-select:
none` on the dialog, with the caption explicitly re-enabling it —
  selecting caption text is unaffected. See DESIGN.md §2.4.

## [0.1.0-alpha.32] - 2026-08-24

### Added

- **Swipe-to-navigate and vertical drag-to-close now also work over a
  provider video's own letterboxed margins (YouTube/Vimeo)** — the same
  reserved-margin approach alpha.31 added for HTML5. This was already
  possible (a provider's `<iframe>`/container was never in the gesture
  exclusion list to begin with) except for one gap: a video slide's
  caption is click-through (`pointer-events: none`), so it never appeared
  in the touch event's own path — meaning a swipe/drag starting visually
  over the caption would engage right through it. Fixed with a
  coordinate-based check (`isOverVideoCaption()`), the same approach
  `isBackdropClick()` already used for the identical click-through gap. As
  with the iframe body itself, this can only ever cover the _margins_
  around a provider embed — a touch starting inside the iframe is outside
  the browser's reach for Shoji entirely. See DESIGN.md §2.4.

## [0.1.0-alpha.31] - 2026-08-24

### Added

- **Swipe-to-navigate and vertical drag-to-close now work over an HTML5
  `<video>` slide**, the same as they already do over a photo — previously
  `<video>` was excluded from every gesture entirely. A native `<video
controls>`'s own scrub-bar/tap-to-toggle chrome isn't real DOM Shoji can
  measure, so it's approximated as a fixed reserved margin along the
  bottom (`--shoji-video-gesture-margin`, defaults to `56px`,
  host-overridable) — gestures only ever engage above that margin, leaving
  the browser's own touch handling untouched below it. Scoped to HTML5
  only: a touch starting inside a YouTube/Vimeo `<iframe>` never reaches
  Shoji's gesture engine at all (cross-origin isolation), so there's
  nothing to extend there. See DESIGN.md §2.4.

## [0.1.0-alpha.30] - 2026-08-23

### Fixed

- **A provider video (YouTube/Vimeo) with `item.width`/`item.height` set
  could render shifted half its own width off-screen**, cut down the
  middle of the dialog, with an unrelated poster/thumbnail image visible
  behind it. `.shoji-slide-provider-video` was sized as a centered flex
  item, which at least one Chromium build miscentered once combined with
  `container-type: size`; it's now positioned out of flex flow entirely
  (`position: absolute; inset: 0`).
- **A provider video's poster and `Gallery.open()`'s own low-res
  open-placeholder could both remain visible at once** — a small floating
  thumbnail next to a larger image — because the code that reveals the
  real embed only ever cleared the _first_ matching loading indicator, not
  every one still present. Fixed to clear all of them.
- **A small `item.poster` file rendered at its own tiny native pixel
  size** instead of filling the slide, unlike a native `<video poster>`,
  which always fills its element regardless of the poster image's own
  resolution.
- **Opening a video item always showed a low-res placeholder photo before
  swapping to the real (often visually unrelated) content** — inconsistent
  with navigating back to an already-cached video slide, which shows the
  final content directly. Video items now skip the placeholder on open,
  matching that behavior.
- **DOM-mode (`data-shoji-*`) video items silently lost `item.width`/
  `item.height`** — `scan.ts` never read those attributes for a video item
  the way it already did for a photo, so every fix above only ever worked
  in dynamic (`items: [...]`) mode.
- **A provider video always rendered as if it were exactly 16:9, regardless
  of its declared `item.width`/`item.height`** — the letterboxing formula
  had `16/9` hardcoded. Now driven by a CSS variable
  (`--shoji-provider-video-aspect`) set from the item's real dimensions,
  covering YouTube, Vimeo, and HTML5 `<video>` alike; HTML5 video also gets
  its shape immediately via `aspect-ratio`, instead of only once
  `loadedmetadata` fires. See DESIGN.md §4.3.

## [0.1.0-alpha.29] - 2026-08-23

### Fixed

- **The page scroll lock's touchmove blocker was too broad on Android**:
  it blocked touch-scrolling in _any_ host-app UI outside `.shoji-outer`,
  not just the page body behind the lightbox — a Bootstrap modal or
  sidebar opened on top of it, with its own genuinely scrollable content,
  couldn't be scrolled. `bodyScrollLock.ts` now also lets a touch through
  when it starts on a genuinely scrollable ancestor (real overflow, not
  just `overflow-y: auto`/`scroll` set with nothing to scroll) outside the
  lightbox, walking up and stopping at `document.documentElement` — the
  exact background scroll this lock exists to block. Computed once per
  gesture in a new `touchstart` listener and cached for `touchmove` to
  read, not recomputed on every move. See DESIGN.md §2.6a's fifth real bug.

## [0.1.0-alpha.28] - 2026-08-22

### Fixed

- **Clicking a shown video caption could close the gallery outright**, not
  just click through to a control underneath it. `.shoji-caption--video`'s
  `pointer-events: none` (letting a click reach a video's own native
  controls) only stayed safe when the video actually filled the space the
  caption sits over — a letterboxed video (narrower/shorter than the
  dialog) leaves the caption's own position sitting over plain
  `.shoji-slide-media` background instead, and the click fell all the way
  through to a genuine backdrop click. `isBackdropClick()` (`Gallery.ts`)
  now also checks whether the click landed within the caption's own
  bounding box while it's a visible video caption, the one coordinate-based
  check in an otherwise selector-based function — `pointer-events: none` is
  exactly what makes the existing selector exclusion unable to see the
  caption for these clicks. See DESIGN.md §2.3a's fourth real bug.

## [0.1.0-alpha.27] - 2026-08-22

### Changed

- **Clicking blank space around a YouTube/Vimeo embed now closes the gallery**,
  matching image and HTML5 video behaviour. The exclusion in `isBackdropClick`
  previously covered the entire `.shoji-slide-provider-video` container (a fix
  for a mobile tap-to-reveal-controls regression, §2.3); narrowed to cover only
  `.shoji-video-mount` (Vimeo's SDK wrapper) and `iframe` (YouTube's bare
  embed), so the sides and toolbar-inset area around the embed count as backdrop
  clicks. Clicks that land inside a cross-origin iframe never bubble to the
  parent page regardless, so no additional handling is needed there. See
  DESIGN.md §2.3.

### Added

- **Provider video (YouTube/Vimeo) slides now show a poster while the embed
  loads**, instead of just a bare spinner the whole time. Three tiers, in
  order: `item.poster`, if the host supplied one; else a provider-specific
  fallback thumbnail; else the plain spinner, unchanged. YouTube's fallback
  is a predictable, request-free URL (`img.youtube.com/vi/<id>/hqdefault.jpg`);
  Vimeo has no such pattern, so its fallback is a real fetch to Vimeo's own
  oEmbed endpoint. A slow-resolving fallback never displaces an
  already-showing real embed, or a host-supplied poster.
- **`VideoProviderRenderer`** (`core/plugin.ts`) gained a fifth parameter,
  `setPoster(url)`, for a custom video provider to opt into the same
  fallback-poster tiering. See DESIGN.md §4.3.

## [0.1.0-alpha.26] - 2026-08-22

### Added

- **`AutoplayOptions.pauseOnCaptionExpand`** (default `false`) — pauses the
  slideshow when the viewer opens the truncated-caption "read the rest"
  modal, and stays paused (no auto-resume) once it closes, same shape as
  `pauseOnZoom`/`pauseOnRotateFlip`. Backed by a new core event,
  `captionModalChange: { open: boolean }` (`core/types.ts`), emitted from
  `openCaptionModal()`/`closeCaptionModal()`. See DESIGN.md §4.1 point 18.

### Fixed

- **A real bug found building the feature above: closing the caption modal
  right before pressing Space to resume the slideshow could also reopen
  the modal.** `closeCaptionModal()` restored focus to the caption
  unconditionally, including for a mouse-click-driven open, where that
  focus was purely incidental — so an unrelated later keypress landed on
  the caption's own Enter/Space "reopen me" handler first. Focus is now
  only restored for a genuine keyboard-driven open (Tab+Enter/Space);
  clicking to open no longer force-refocuses the caption on close at all.
  See DESIGN.md §2.3a/§4.1.

## [0.1.0-alpha.25] - 2026-08-22

### Removed

- **Breaking:** the HTML5 video play overlay (`.shoji-video-play-overlay`,
  `GalleryOptions.videoPlayOverlay`) is removed entirely — no option, no
  CSS, no DOM node. Shipped in alpha.24 as opt-in; on further discussion,
  a host wanting genuinely custom video controls replaces native
  `controls` outright (`video.controls = false` + a plugin building its
  own UI via `gallery.getActiveMedia()`) rather than layering anything
  Shoji-drawn on top of native controls either way, which left the
  overlay's own middle ground not worth keeping. Native `<video
controls>` is the only play affordance now, same as before alpha.24.
  See DESIGN.md §2.3a.

## [0.1.0-alpha.24] - 2026-08-22

### Changed

- **Breaking:** the HTML5 video play overlay (`.shoji-video-play-overlay`)
  is now opt-in via `videoPlayOverlay: true` (`GalleryOptions`), default
  `false` — previously always rendered. Requested directly: a host
  supplying its own custom play affordance doesn't want a second,
  Shoji-drawn button competing with it. `false`/omitted skips creating
  the button entirely (no DOM node, no listeners), not just hiding it.
  No effect on YouTube/Vimeo/custom provider video, which never had this
  overlay. See DESIGN.md §2.3a.

## [0.1.0-alpha.23] - 2026-08-21

### Fixed

- The toolbar overflow popover could show a column count that matched
  neither what was actually pinned on the row nor what was actually in
  the popover, specifically on a video slide — reported from real usage:
  only 2 icons visibly pinned but a 4-column grid. Two compounding
  causes: the caption-toggle button (only shown on a captioned video
  slide) wasn't counted as pinned at all, while Zoom's own zoomIn/
  zoomOut/actualSize buttons — hidden on video slides — were still
  counted even though invisible. See DESIGN.md §3.1a.

## [0.1.0-alpha.22] - 2026-08-20

### Changed

- **Breaking (opt-in default flip):** Autoplay's `pauseOnZoom` now
  defaults to `false`, matching `pauseOnRotateFlip`. Both are opt-in — a
  host embedding Autoplay shouldn't have its slideshow's pause behavior
  silently change just because Zoom happens to also be loaded. Pass
  `autoplay: { pauseOnZoom: true }` to restore the alpha.21 behavior.

## [0.1.0-alpha.21] - 2026-08-20

### Added

- Autoplay now pauses the slideshow while the viewer is actively zoomed in
  (`pauseOnZoom`, default `true`) or interacting with rotate/flip
  (`pauseOnRotateFlip`, default `false`, opt-in) — previously the
  slideshow could auto-advance out from under someone mid-examination.
  Stays paused until Play is pressed again; no auto-resume, even once
  back at neutral zoom/rotation. Immediately re-pauses if Play is pressed
  while already zoomed/rotated — and the Play button now visibly disables
  whenever that's the case, instead of a click silently doing nothing.
  Both are a no-op if the corresponding plugin (Zoom/RotateFlip) isn't
  loaded. See DESIGN.md §4.1 (point 17) for the real bugs found refining
  this and why it lands on "stays paused, no auto-resume."

### Fixed

- `Zoom.reset()` never emitted `zoomChange` when returning to neutral
  scale, contradicting its own documented "emits on every scale change"
  contract — a host listening for it could never learn a slide stopped
  being zoomed unless something zoomed in again first. Now emits when
  there was an actual change to report. See DESIGN.md §4.6 (sixteenth
  bug).

## [0.1.0-alpha.20] - 2026-08-20

### Fixed

- Rotating or flipping a photo, then navigating to the next slide, snapped
  back to unrotated _before_ the slide transition played instead of the
  un-rotate/un-flip happening as part of it — both `RotateFlip` and
  `Zoom` reset their transform before `SlideTransition` ever cloned the
  outgoing slide, so there was nothing left to animate away. Fixed with
  a new core mechanism, `Gallery.registerSlideLeaveDecorator()`, that
  freezes the pre-reset visual state onto the transition's own leave-ghost
  clone and eases it back to neutral alongside the rest of the
  transition. See DESIGN.md §2.5.
- Dragging to pan while zoomed in, on a slide `RotateFlip` had also
  rotated, panned along the wrong screen axis (e.g. dragging down moved
  the image sideways), and which way was wrong changed with each
  rotation — the raw screen-space pointer delta was applied directly as
  the local pan offset, with nothing correcting for the parent's own
  rotation. See DESIGN.md §4.6 (fourteenth real bug).
- Double-clicking to zoom toward the pointer, on a rotated slide, zoomed
  toward the wrong point instead of the actual click — sometimes badly.
  The anchor math treated the rotated element's bounding-box corner as
  the image's local origin, which is only true unrotated; fixed by
  anchoring on the bounding box's rotation-invariant center instead. See
  DESIGN.md §4.6 (fifteenth real bug).

## [0.1.0-alpha.19] - 2026-08-20

### Fixed

- The toolbar overflow popover could render a wider grid than intended
  (e.g. 4 columns instead of 3) if a host or plugin appended an element
  directly into `.shoji-toolbar-right` outside `ctx.ui.toolbar()` and
  toggled its visibility via `style.display` rather than the `hidden`
  attribute — `positionToolbarOverflowPanel()`'s pinned-button count now
  reads from Shoji's own registered-button list instead of re-querying
  `toolbarRight`'s raw DOM children, making it immune to this regardless
  of how such an element manages its own visibility. See DESIGN.md §3.1a.

## [0.1.0-alpha.18] - 2026-08-20

### Fixed

- Rotating a slide, then navigating to the next one, could bleed the
  rotated photo into the new slide instead of it being replaced cleanly
  — `RotateFlip` only reset its transform on `afterOpen`/`afterSlide`,
  never `beforeSlide`, so a rotated slide reused later from the preload
  cache carried its stale rotation into wherever `SlideManager` reparented
  it. Same bug class, same fix, the Zoom plugin already had. See
  DESIGN.md §4.5 (sixth real bug).
- Rotating/flipping a photo on `docs/examples/view-controls.html` (and
  several other demo pages) on a narrow mobile viewport could widen the
  page itself, pushing the toolbar/nav arrows off-screen — not a Shoji
  bug: the demo pages' own debug status line printed event payloads via
  `JSON.stringify()` with no `overflow-wrap`, and that unbreakable text
  overflowed the page on narrow screens. Fixed with `overflow-wrap:
break-word` in `docs/docs.css`; no library code changed. See DESIGN.md
  §4.5 (seventh real bug) for the full, multi-attempt misdiagnosis.

## [0.1.0-alpha.17] - 2026-08-19

### Fixed

- Closing while zoomed in (Zoom plugin) snapped back to neutral zoom
  first, then shrank to the thumbnail, instead of continuing the
  shrink-to-thumbnail animation directly from the zoomed-in view. Fixed
  via a new `Gallery.registerZoomStartProvider()` (same pattern as the
  existing `registerZoomGate`), capturing the zoomed image's own live
  rect before the Zoom plugin's own close-time reset runs, and jumping to
  it the same way a completed vertical drag-close already continues from
  wherever the drag left off. Also fixes the same jump-cut when RotateFlip
  is active at the same time — closing while both rotated/flipped _and_
  zoomed now keeps the smooth combined un-rotate-while-shrinking motion,
  not just a plain un-zoom. See DESIGN.md §2.3b (fourteenth entry).
- Clicking the plain black backdrop (between the image and a nav arrow,
  say) while zoomed in no longer closed the lightbox, unlike the same
  click unzoomed — the Zoom plugin's own pan-pointerdown listener engaged
  and captured the pointer onto the image for _any_ pointerdown in the
  lightbox while zoomed, not just one that actually started on the image,
  which silently made every backdrop click misread as "on the image," not
  backdrop. See DESIGN.md §4.6 (thirteenth bug).

## [0.1.0-alpha.16] - 2026-08-18

### Added

- `transitionDuration` (`GalleryOptions`, ms, default `300`) — a convenience
  that sets the `--shoji-duration` CSS custom property for you, rather than
  a separate JS-side timing mechanism (CLAUDE.md's "no hardcoded
  colors/sizes/timings in JS" still holds — this only ever writes into the
  same CSS var every transition already reads). Same pattern
  `backdropOpacity` already uses for `--shoji-backdrop-opacity`: only
  applied when explicitly set, otherwise `--shoji-duration` (and its own
  `prefers-reduced-motion` override) is left untouched.
- A navigated-to slide's caption now fades out and back in alongside the
  `mode` transition, instead of swapping its text instantly mid-animation
  (a jump-cut against the otherwise-smooth slide). The very first `open()`
  fades its caption in too, alongside `zoomIn()` — only when there's
  actually a zoom to sync with (known dimensions), same as `zoomIn()`
  itself. See DESIGN.md §2.5.

## [0.1.0-alpha.15] - 2026-08-18

### Added

- A long caption now truncates (with a visible `…`) instead of growing
  tall enough to risk covering the nav arrows or scrolling forever in
  place — click, tap, or `Enter`/`Space` on a truncated caption opens a
  scrollable modal with the full text (rich HTML/links included, same
  rendering as the caption itself). Only ever shown/interactive when the
  caption genuinely doesn't fit; a caption that already fits is unaffected.
  While open, the modal fully isolates the background gallery from both
  keyboard input (nothing leaks through to shortcuts like Autoplay's own
  `Space` play/pause) and gesture/tap recognition (clicking inside it
  can't be misread as a tap-to-toggle on the photo underneath), and
  suspends drag-to-navigate/close the same way the Zoom plugin's own pan
  gesture already does. See DESIGN.md §2.3a.
- A toolbar with more plugin buttons than a narrow viewport has room for no
  longer wraps to a second/third row — once the row measurably doesn't fit,
  buttons collapse (latest-registered first) into a floating popover
  revealed by a caret just to the left of the close button. The popover
  itself lists them in the same order they'd have read on the toolbar, not
  reversed. `maxPinnedToolbarButtons` (new `GalleryOptions` field, default 2) caps how many plugin buttons stay pinned on the row — a ceiling, not
  a guarantee: if pinning even that many would still wrap the row (e.g. a
  wide counter leaves less room than usual), more collapse into the
  popover until it fits, down to zero if it must. The counter and close
  button are never allowed to wrap onto their own line. The popover opens
  anchored to the caret's own live position (not a fixed offset from the
  toolbar's edge), and its grid is exactly as many columns wide as the
  toolbar row's own pinned-buttons-plus-caret count, so it reads as that
  same row continuing downward rather than an independently-sized box.
  Opens on caret click, closes on Escape/an outside click, keyboard-
  confined while open (Tab cycling narrows to it, matching the caption
  modal's own focus-trap behavior), and restores every button to its
  normal slot the moment it fits again. Replaces the removed
  `mobileSettings.controls` (see "Removed" below) as the actual,
  measured-overflow answer to a busy toolbar. See DESIGN.md §3.1a.

### Changed

- The caption box's default max-width now narrows to roughly a quarter of
  the viewport (floored at `14rem`) above a 768px breakpoint, via the new
  `--shoji-caption-max-width` custom property — a long caption previously
  wrapped out to the dialog's near-full width on any viewport, reading as
  a bar rather than a caption sized to its own content. Desktop-only: a
  narrow/mobile viewport still spans (almost) the full width, unchanged.
- The caption box's default max-height no longer caps early at a fixed
  `min(8rem, 30%)` — it now grows naturally with its content up to
  whichever is smaller: the toolbar's real measured height (a new
  `ResizeObserver` in `Gallery.ts`, correct even when a busy toolbar wraps
  to multiple rows) or a pure-geometry ceiling that stays clear of the
  vertically-centered nav arrows sharing the caption's own left edge.
  Beyond that, see "Added" above — it truncates and opens a modal instead
  of scrolling in place. See DESIGN.md §2.3a.
- Core's size budget raised 26.9 kB → 36.2 kB (min+gzip) — 26.9 kB → 33 kB
  for the caption modal above and the real bugs fixed while testing it end
  to end, then 33 kB → 35 kB for the hover-tracking rewrite (see "Fixed"
  below) and the toolbar overflow popover above, then 35 kB → 35.2 kB for
  that popover's own collapse-policy inversion (`maxPinnedToolbarButtons`
  and the never-wrap guarantee), then 35.2 kB → 36.2 kB for the `requires`
  order-independence fix below — real, deliberate growth, not incidental.
  See DESIGN.md's own budget-history note.

### Removed

- `Autoplay`'s tap/click-to-toggle-play/pause on an image slide — requested
  directly ("too disruptive"). The toolbar play/pause button and the
  `Space` shortcut are unaffected; only the tap-on-the-photo path is gone.
- **Breaking:** `mobileSettings` (`{ mode?, controls? }`) removed entirely.
  Neither field's motivation held up under review: `mode` only ever
  affected _programmatic_ navigation (a gesture-completed swipe always
  plays its own animation regardless of `mode`), and `controls: false`
  only ever affected the very first instant of `open()`, not persisted
  per-slide. Neither had a validated use case behind it. See DESIGN.md
  §2.5.

### Fixed

- A truncated caption could show a sliver of clipped text bleeding through
  below its own `…` ellipsis, in a real browser, not just this project's
  own sandbox — a plain pixel `max-height` clip doesn't know where a line
  of text actually ends. Fixed by measuring the browser's own real line
  geometry (`Range.getClientRects()`) and snapping the cap to an exact line
  boundary, rather than assuming one arithmetically. See DESIGN.md §2.3a.
- Reopening the same already-loaded slide (e.g. clicking the same
  thumbnail twice) could show its caption with no truncation/ellipsis at
  all, inconsistent with that same slide's first open — the measurement
  could run before the dialog had actually finished laying out, on a path
  a fresh (slower, async) first open doesn't hit. See DESIGN.md §2.3a.
- The cursor (and the rest of the gallery's controls) could vanish while
  the caption modal was open and being read, if an idle auto-hide timer
  from before the modal opened was still in flight — `hideControls()`
  didn't know to stay a no-op for the modal's own lifetime. See DESIGN.md
  §2.3a/§2.8.
- `destroy()` while the caption modal was open left its document-level
  keydown listener attached forever — `teardown()` closes the lightbox via
  a different path than a normal close, one that skipped the modal
  cleanup. See DESIGN.md §2.3a.
- `Autoplay`'s progress bar faded out during ordinary idle auto-hide, not
  just the close animation the fix for it was originally about — the one
  piece of UI actively telling the viewer "still counting down" would
  disappear during every idle period on a running slideshow. See DESIGN.md
  §2.8/§4.1.
- The idle auto-hide hover guard (`hideControls()`'s "don't hide while a
  control is hovered" check) could get stuck — permanently paused, or
  intermittently stale depending on browser/automation timing — in a few
  real scenarios: a control that swaps its own children on click while the
  pointer sits stationary over it (Autoplay's own play/pause icon), a
  control that _appears_ under an already-stationary cursor (common right
  after `open()`), and a Firefox-specific pointer-simulation timing gap.
  Replaced the plain hover counter with a set reconciled against the
  browser's own live `:hover` state instead of trusting individual
  `pointerenter`/`pointerleave` events to always fire correctly. See
  DESIGN.md §2.8.
- `Zoom`'s pan-while-zoomed gesture never called `setPointerCapture`, unlike
  every other pointer-driven gesture in the codebase: a fast pan whose
  pointer exited the lightbox's bounds mid-drag stopped receiving further
  `pointermove`/`pointerup` events, leaving the gesture dead until the next
  `pointerdown`. Fixed by capturing on the active slide's `<img>` itself
  (not the dialog/backdrop `GestureEngine` would use) — capturing there
  would have retargeted the release `click` to a spot that reads as a
  backdrop click, closing the lightbox on every real pan. See DESIGN.md
  §4.6 (twelfth bug).
- The toolbar overflow popover above didn't reliably fit even its own
  default pinned-button count on a real narrow phone (reported and
  reproduced directly at a 360×640 viewport): `.shoji-toolbar-slot`'s own
  `max-width` (a pre-existing cap from before the popover replaced the old
  wrap-to-a-second-row fallback) was a flat percentage of the toolbar's
  width, unrelated to how much room the _other_ slot's content (the
  counter) actually needed — the right slot could get capped well below
  the real available space regardless of `maxPinnedToolbarButtons`. A
  first attempt raised the percentage from 45% to 60%, which only patched
  the specific default-pinned-count case; a follow-up report at a higher
  configured `maxPinnedToolbarButtons` (real usage: 4 pinned buttons
  configured, only 2 actually shown) exposed the same root cause. Removed
  the cap entirely — `measureToolbarOverflow()`'s own real, measured
  fit-check (already reading every slot's actual rendered height) is what
  decides how many buttons stay pinned now, not a static percentage
  assumption. See DESIGN.md §3.1a.
- The popover's own outside-click-to-close listener used `event.target`,
  which can already be a detached node by the time a bubble-phase listener
  runs if the clicked element replaces its own innerHTML synchronously
  (Autoplay's play/pause icon-swap) — `.contains(target)` then reads false
  even for a click genuinely inside the popover, wrongly closing it out
  from under the button that was just clicked. Switched to
  `event.composedPath()`, captured at dispatch time before any such
  mutation. See DESIGN.md §3.1a.
- `Layout`'s justified mode could isolate a tile into a row that fell short
  of the container's right edge — a visible gap — instead of grouping it
  with a neighbor: shedding a trailing tile down to a lone remaining one
  (to keep a pair from overflowing past `minRowHeight`) didn't check
  whether that lone tile's own natural height would itself need
  `maxRowHeight` to clamp it, which falls short of the right edge for the
  exact same reason. Reported and reproduced directly (a square thumbnail
  sandwiched between wider neighbors, narrow viewport) — fixed by keeping
  the wider grouping and letting `minRowHeight` yield instead, the same
  precedent already used for a single tile too wide to fit at
  `minRowHeight` at all. See DESIGN.md §5.2.
- The toolbar overflow popover opened aligned under the close button
  instead of the caret that actually reveals it — its position was a fixed
  offset from the toolbar's own right edge rather than anchored to the
  caret, which can itself sit at a different position depending on
  `maxPinnedToolbarButtons`/viewport width. Now positioned relative to the
  caret's own live location every time it opens, keeping its icon columns
  genuinely aligned with the toolbar row's icons above them. See DESIGN.md
  §3.1a.
- A `ShojiPlugin`'s `requires` only worked if every dependency happened to
  be declared _earlier_ in the `plugins` array than the plugin that needed
  it — checked against whichever plugins had already been processed in the
  same pass, not the full list. Reported directly as real integration
  friction: nothing about a dependency needing to _run_ first requires it
  to be _declared_ first, so hosts had to hand-order an otherwise-arbitrary
  `plugins` array purely to satisfy this check. `requires` is now resolved
  against the whole declared list up front (a fixed-point pass — repeatedly
  drops anything whose `requires` isn't met, so a chain of failures still
  cascades correctly), independent of position. Plugin `init()` still runs,
  and every `ctx.ui.toolbar()` button still lands, in exactly the order the
  `plugins` array declares — toolbar/collapse-priority order (§3.1a) is
  unaffected either way. See DESIGN.md §3.1.

## [0.1.0-alpha.14] - 2026-08-15

### Fixed

- `ActiveThumbnail` could silently lose track of the active slide when used
  together with the `Layout` plugin's `groupBy` option: any `autoMeasure`
  correction (most items missing explicit `width`/`height`) triggers a full
  tile-DOM rebuild under `groupBy`, orphaning the element `ActiveThumbnail`
  had marked active. Fixed by tracking the active index and re-marking the
  rebuilt tile via the `layoutRender` event. See DESIGN.md §4.2.
- `ActiveThumbnail`'s `scrollIntoView` tracking was silently a no-op the
  entire time the lightbox was open: a regression from alpha.13's own page
  scroll lock fix, which unconditionally snapped the page back to its
  pre-open position on close, undoing every scroll `ActiveThumbnail` made
  while navigating. Fixed with a `markIntentionalScroll()` escape hatch so
  the lock's own close-time restore no longer fights Shoji's own legitimate
  background scrolling. See DESIGN.md §2.6a (gap 2).

## [0.1.0-alpha.13] - 2026-08-15

### Fixed

- The page scroll lock (active while the lightbox is open) had four known
  gaps, all fixed together:
  - iOS Safari's own touch-driven rubber-band/bounce scroll wasn't
    reliably blocked by `overflow: hidden` alone — a background touch
    could still move the page while the lightbox was open. Fixed with a
    non-passive `touchmove` listener that blocks the default only for
    touches starting outside the lightbox, leaving Shoji's own in-dialog
    gestures untouched.
  - A plain `window.scrollTo()` (or setting `scrollTop` directly) wasn't
    blocked at all — if the host's own code scrolled the window while the
    lightbox was open, the page ended up somewhere different once it
    closed. The pre-lock scroll position is now captured and restored
    unconditionally on unlock.
  - The lock only defended against other `Gallery` instances, not
    unrelated code on the page — another library also touching
    `document.documentElement.style.overflow` could silently undo it. A
    `MutationObserver` now re-asserts the lock if that happens.
  - The scrollbar-width compensation (added in 0.1.0-alpha.12) assumed a
    right-side scrollbar; on a `direction: rtl` page it now compensates
    `padding-left` instead, matching where a classic scrollbar actually
    renders there.

## [0.1.0-alpha.12] - 2026-08-15

### Added

- `backdropOpacity` (`GalleryOptions`) — a real 0-1 alpha for the backdrop
  (`1` fully opaque, `0` fully transparent), without needing to know or
  override the full `--shoji-color-backdrop` CSS value. Left unset, nothing
  changes from before.
- `autoHideDelay: false` — the real "always visible" value: controls simply
  never auto-hide, no matter how long the gallery sits idle, holding up
  through every built-in path that can hide controls (including the
  Autoplay plugin's own tap-to-toggle-chrome behavior and
  `mobileSettings.controls: false`), not just the idle timer. (`0` remains
  its own, different mode — hidden immediately and permanently, not
  "disabled" — this is the setting that was actually missing.)
- `dragCloseThreshold` event — fires whenever a vertical drag crosses (or
  retreats back under) the same distance a release would complete the
  close. The Autoplay plugin now uses it to pause the slideshow the instant
  that threshold is crossed and resume it if the drag retreats back under it
  without closing.

### Changed

- The backdrop is now fully opaque by default (`--shoji-backdrop-opacity: 1`,
  both themes), rather than the previous ~92%/96% translucent look. A host
  that wants the old translucency back can set it via `backdropOpacity`
  (`GalleryOptions`) or the custom property directly.
- Closing the lightbox now starts fading the toolbar/nav/counter/caption out
  at the same instant the photo starts animating back to its thumbnail,
  instead of one strictly after the other — previously the fade ran to
  completion first, then the zoom-out began, reading as two separate steps
  rather than one motion. (An intermediate version of this fix waited for
  the fade before starting the zoom-out on a button-close specifically, to
  avoid stationary chrome hovering over a shrinking photo; reversed once
  that read as two steps too, in favor of starting both together — the
  chrome disappearing at the same time still avoids the stationary-chrome
  problem, just without the pause.)
- Completing a vertical swipe-to-close now fades and shrinks the photo
  toward its thumbnail in one continuous motion, instead of snapping back to
  fully visible for a beat before the zoom-out took over.
- Dragging up or down to close now hides the toolbar/nav/counter/caption
  once you've dragged far enough that releasing would actually close the
  gallery — a live cue for "let go now and this closes." Dragging back
  toward the original position before releasing brings them back.
- Dragging up or down to close now only moves the photo itself — the
  toolbar and nav overlay stay anchored in their fixed screen positions,
  instead of moving/shrinking along with the whole lightbox as one unit.
- `autoHideDelay: 0` no longer hides the mouse cursor along with the
  controls — that mode is for hosts building their own chrome around Shoji,
  not a signal that the whole gallery should act like nothing is there.
  Ordinary idle-hide still hides the cursor as before.

### Fixed

- Completing a horizontal mouse drag to navigate to the next/previous slide
  could immediately close the gallery instead — a browser quirk where a
  captured drag's release still fires an ordinary `click` event afterward,
  retargeted to the dialog itself regardless of where the pointer visually
  ended up, which click-outside-to-close misread as "clicked nothing." Fixed
  by consuming exactly that one retargeted click after a real drag ends.
  Touch drags and plain clicks were unaffected either way.
- Click-dragging over a caption to select/copy its text instead navigated to
  the next/previous slide (or panned, while zoomed) — captions weren't
  excluded from the gesture engine's drag recognition, so the drag hijacked
  native text selection. Captions are now excluded, same as buttons/links/
  form controls already were.
- The Zoom plugin's three toolbar buttons (zoom in, zoom out, actual size)
  did nothing on a video slide, with no indication why — clicking them was a
  silent no-op. They're now hidden entirely whenever the active slide is a
  video, and reappear when navigating back to a photo slide.
- A completed drag-close no longer lands off the thumbnail — it now lands
  exactly where a button-close does. Two compounding causes: the drag's own
  live feedback was easing back to neutral concurrently with the zoom-out's
  own animation, and even once that was fixed, the drag's live scale
  feedback was independently distorting the zoom-out's landing position
  (not its size, which always matched).
- The Autoplay plugin's progress bar stayed fully visible through the entire
  close animation instead of fading out with the rest of the controls.
- Drag-to-close now animates as one continuous motion picking up exactly
  from wherever the drag left off, however far that was — previously,
  releasing a long drag could visibly pop the photo, briefly pause partway
  through the shrink, or (dragged far enough) snap to a small, centered-
  looking position for a frame before the real close animation continued.
  The drag's own appearance now carries straight into the close animation
  on the photo itself, instead of being frozen on a separate container the
  photo then had to catch up to, with no artificial cap on the starting
  position.
- The mouse cursor no longer disappears when dragging past the point where
  Shoji would close the gallery on release — it stayed visible everywhere
  else during a drag, just not there, since that moment reused the same
  mechanism idle auto-hide uses to hide the cursor along with the toolbar.
- Opening or closing the lightbox on a host page with a real (non-overlay)
  scrollbar could visibly shift the page's layout — the body scroll lock
  hid the scrollbar by setting `overflow: hidden`, which reclaims its
  gutter and widens the usable content area for as long as the lightbox is
  open, then gives it back on close. The scrollbar's width is now measured
  before locking and, only when a real scrollbar was actually there,
  compensated with invisible `padding-right` on `<html>` for the same
  duration as the lock — so the usable width never changes and nothing
  reflows in either direction. Scoped to the lock itself, not set
  permanently — host page layout is unaffected while the lightbox is
  closed, and a page that never had a scrollbar gets no padding at all.
- The backdrop had no fade of its own — closing cut it from fully visible
  to fully gone in a single frame the instant the photo finished shrinking,
  reading as a flash of the page behind it. It now fades out over the same
  duration as the photo and the controls, starting at the same instant.
- Opening or closing the lightbox could visibly shift the page vertically,
  independent of the scrollbar-width issue above and not fixed by it —
  reproducible even on pages that fix couldn't touch. The scroll lock set
  `document.body`'s own `overflow` to `hidden`, which blocks top-margin
  collapsing between `body` and its first child; while locked, that child
  rendered pushed down by its own margin instead of sharing `body`'s, and
  snapped back up the instant the lock released. `document.body`'s
  `overflow` is no longer touched at all — locking `<html>`'s own `overflow`
  (already in place) is sufficient on its own to block scrolling.

## [0.1.0-alpha.11] - 2026-08-13

### Fixed

- A genuinely small photo visibly grew to fill the dialog on open, then
  snapped back down to its true small size the instant the real image
  finished loading — even with `item.width`/`item.height` supplied. The
  open-transition animation knew the photo's correct _shape_ from those
  dimensions but had no way to cap its _size_, so it always grew toward
  filling the dialog. Now caps the animation at the photo's real pixel
  size when known (`item.width`/`item.height`), same rule the image's own
  CSS already enforces once loaded. See the "Changed" entry below for
  photos without explicit dimensions, which no longer get a guessed size
  either.
- The fix above wasn't actually sufficient on its own: the open-transition
  placeholder (the low-res stand-in shown while the real photo loads) has
  its own separate CSS forcing it to fill the entire dialog, unrelated to
  the animation fixed above — so a small photo still visibly ballooned
  while the placeholder was showing, even after that fix. Now sized
  explicitly from `item.width`/`item.height` too, when known, instead of
  always force-filling.
- The fix above had its own bug: it measured the wrong element for "how
  much space is available," landing on whatever the zoom-in animation's
  own in-progress scale happened to be at that instant rather than the
  real dialog size — since the placeholder typically appears before that
  animation has painted even one frame, this usually meant the placeholder
  rendered at roughly the size of the thumbnail you clicked, not scaled up
  at all. Now measures a stable, never-animated element instead.

### Changed

- Following directly from the two fixes above: opening an item with no
  `item.width`/`item.height` at all no longer shows a guessed-size
  placeholder or plays the zoom-in-from-thumbnail animation — both relied
  on assuming "probably fills the dialog," which was the whole problem for
  a genuinely small photo. Now shows the ordinary loading spinner and
  reveals the real image the instant it's ready, with no animation of its
  own (nothing left to animate toward, once it's already loaded). Supply
  `item.width`/`item.height` to keep the full grow-from-thumbnail
  experience — see the Transitions guide.

### Added

- Autoplay: tapping/clicking a photo slide (not video — its own controls
  already cover this) now toggles the slideshow, same as the toolbar
  button — pauses if running, resumes if paused. A double-tap to zoom
  (Zoom plugin) is unaffected: the toggle is held for a brief window and
  dropped entirely if a second tap arrives, so tapping to zoom never also
  pauses or resumes. Also toggles the auto-hide controls overlay on the
  same tap: hides it if it was already visible, leaves it alone (already
  revealed for free) if it was hidden. `Gallery.hideControls()` is now
  public.

## [0.1.0-alpha.10] - 2026-08-12

### Changed

- Vimeo e2e coverage: CI runners were increasingly seeing Vimeo decline to
  ever call `player.ready()` for the fixture video (an `error` event
  instead — no code path treats that as a fallback reveal, mirroring an
  identical pre-existing gap in `youtube.ts`'s own `onError`), leaving the
  slide's `.shoji-slide-provider-video` container `hidden` forever rather
  than failing gracefully. Soft-waits for the reveal in CI now and skips
  the rest of the affected test if it never arrives, matching the
  tolerance the YouTube e2e tests already had for the same class of
  external-network unreliability; still hard-asserts locally. No library
  code changed — `tests/e2e/plugins/video.spec.ts` only.

## [0.1.0-alpha.9] - 2026-08-12

### Fixed

- Layout: rotating certain photos (via RotateFlip) never resized to fit the
  window — fit-scale silently computed to exactly `1` every time. Only
  affected items with a dynamic-mode `thumb` genuinely different from their
  `src` and no explicit `item.width`/`height`. Root cause: Layout's
  auto-measure feature was writing its own tile-thumbnail measurement
  straight onto the shared `item.width`/`item.height` fields — a
  convenient shortcut, but wrong, since RotateFlip's fit-scale (and
  `SlideManager`'s aspect-ratio open placeholder) read those same fields
  expecting the full photo's true dimensions, not a thumbnail's. Fixed by
  keeping Layout's auto-measurement cache private to the plugin; `item.
width`/`item.height` now only ever reflect what the host explicitly
  supplied. See DESIGN.md §4.5/§5.4 for the full investigation, including
  an initial (disproven) theory about the loading placeholder.
- Autoplay: a provider video's (e.g. YouTube) error event could go unheard
  after navigating to it — a regression from the `SlideManager` pool-slot
  relabeling change (see the `0.1.0-alpha.8` entry below). Autoplay used to
  capture `gallery.getActiveMedia()` once, at plugin init, and listen for
  `error` on that specific node — safe when a slot's own offset never
  changed after construction, no longer safe now that a slot's offset is
  relabeled as navigation happens. The node that was offset 0 at init can
  become a neighbor after a single navigation, going unheard while a
  different node becomes the actually-active one. Fixed by listening on the
  whole lightbox instead (never relabeled) and checking, fresh on every
  error, whether it came from whatever `getActiveMedia()` currently is.
- Autoplay: a native `<video>`'s rejected `play()` always stopped the
  slideshow, whether the video was genuinely broken or merely blocked by
  the browser's autoplay policy — indistinguishable by symptom alone, but
  needing opposite responses (asked directly: "a broken video should skip
  to the next slide," not stop the slideshow). Now branches on the
  rejection's `error.name`: `NotAllowedError` (blocked, video is fine)
  still stops and waits for the viewer; anything else (e.g.
  `NotSupportedError` — a broken/missing source) advances instead, matching
  how a provider video's own error event has always been handled.
- Autoplay: a provider video (e.g. YouTube) that never became playable
  could strand the slideshow even with the two fixes above in place —
  reported from real usage as a YouTube Error 153 sometimes never
  advancing. Two bugs, not one: `ensureProviderPlaying()`'s own
  retry-exhaustion path called `stop()` instead of `advance()`,
  inconsistent with how a provider's own error event was already handled;
  and separately, `Gallery.navigate()` paused the outgoing slide's video
  _before_ emitting `beforeSlide`, so Autoplay's still-attached manual-pause
  detector misread that programmatic pause as the viewer pausing it by hand
  and stopped the slideshow — sometimes from inside the very `advance()`
  call trying to move past it. Fixed both: exhaustion now advances, and
  `beforeSlide` fires before the pause so Autoplay can detach first.
- Vimeo embeds rendered wrong at every viewport shape tried, in sequence:
  first as a small, fixed-size box in a corner (Vimeo's SDK sizes its own
  wrapper div itself, regardless of the CSS already telling its `<iframe>`
  to fill 100% of that box); then, once sized to its parent, cropped —
  stretching to an arbitrary box ignored the video's own 16:9 shape,
  pushing its bottom (and Vimeo's own controls bar, always along that
  edge) below the visible area at any viewport that wasn't already 16:9
  itself; then, once fitted to a real 16:9 box, a white background showed
  in the resulting letterbox gap instead of Shoji's own dark one — neither
  YouTube's nor Vimeo's own player page renders with a background matching
  Shoji's theme there, and that content is cross-origin, unreachable from
  here either way. Fixed by containing the embed within its slide at a
  real 16:9 aspect ratio (CSS container query units — plain `aspect-ratio`
  can't do this alone for a non-replaced element like a div/iframe), so
  any gap lands outside the iframe, where Shoji's own backdrop shows
  through instead of the provider's white.
- Autoplay: a Vimeo video reached via the slideshow would never actually
  play — it either silently skipped to the next slide, or (if the
  slideshow was paused at exactly the right moment) started playing right
  afterward, the tell that something already in flight was being
  interrupted rather than never attempted. `ensureProviderPlaying()`'s
  retry loop reissued `play()` on every retry — correct for YouTube's
  fire-and-forget API, needed because a single command can silently get
  dropped before its postMessage bridge is ready — but Vimeo's `play()`
  genuinely returns a promise, and reissuing it resets the player's own
  in-progress start each time, so it could never finish what the first
  call had already begun. Now branches on whether `play()`'s return value
  is genuinely thenable: a real promise is issued exactly once per
  attempt cycle, only re-checking `.paused` afterward rather than calling
  `play()` again.
- Autoplay: a Vimeo video reaching its natural end stopped the slideshow
  instead of advancing to the next slide. Vimeo's own `'pause'` event
  arrives shortly _before_ `'ended'` when a video finishes (~20ms apart,
  confirmed directly) — unlike native `<video>`, whose `.ended` property
  the browser sets synchronously before firing either event, so Autoplay's
  own real-pause-vs-natural-end check reliably lost the race and treated
  the end as a manual pause. Fixed in the Vimeo renderer: `'pause'` is now
  held back briefly and dropped entirely if `'ended'` arrives first, which
  then becomes the only event a natural end produces; a genuine standalone
  pause still dispatches, just delayed by that same short, imperceptible
  window.

### Removed

- `wistia` as a `VideoDescriptor`/`data-shoji-video-provider` value. It was
  never more than typed — no URL detection, no renderer, and no use case has
  asked for it — so it's removed rather than left half-supported alongside
  Vimeo's new real implementation below. `data-shoji-video-provider="wistia"`
  now warns and falls back to normal auto-detection, same as any other
  unrecognized value.

### Added

- Video: Vimeo support, alongside the existing YouTube/HTML5 providers.
  `data-shoji-video="https://vimeo.com/<id>"` (or `player.vimeo.com/video/<id>`,
  or an unlisted video's `/<id>/<hash>` privacy-hash form) is now
  auto-detected the same way a YouTube link already was — no explicit
  `data-shoji-video-provider` needed — and `video: true`/`{ provider: 'vimeo' }`
  get the same `src`-based id auto-fill in dynamic mode YouTube items have.
  Fully integrates with Autoplay (play/pause/ended sync, the same video-aware
  slideshow state machine) and the toolbar top-gutter fix, no provider-specific
  work needed on either side.
- Autoplay: `autoStart: boolean` (default `false`) starts the slideshow
  automatically as soon as the gallery opens, every `open()` not just the
  first, instead of requiring a click on the toolbar button or `Space`.
- Autoplay's play/pause toolbar button now carries a stable
  `shoji-autoplay-toggle` class, for host code that needs to find/control it
  from outside (e.g. pausing the slideshow before opening a modal). Its
  `title`/`aria-label` swap with `locale`, so matching on that text instead
  breaks silently the moment the locale changes — the class doesn't.

### Fixed

- A video the viewer started playing (HTML5 or a provider like YouTube)
  kept playing — audibly, invisibly — after closing the lightbox, or after
  navigating to a different slide entirely. Neither ever touched it:
  `close()` doesn't tear down the slide pool (reopening is meant to be
  instant), and a slide within the `preload` window stays cached on
  navigation for the same reason — only genuinely evicting a slide from
  that window released anything. `SlideManager.pauseMedia()` pauses
  whichever slide is being left, on `close()` and before every navigation,
  without releasing it — the video resumes right where it left off if
  navigated back to, it just stops making noise the moment it's no longer
  the one on screen.

## [0.1.0-alpha.8] - 2026-08-11

### Fixed

- Mobile: tapping a YouTube slide to bring back auto-hidden controls closed
  the gallery instead. A provider embed is a `<div>` wrapping a
  cross-origin `<iframe>`, not a `<video>` element, so it never matched the
  click-outside-to-close exclusion list the way a native HTML5 video slide
  already did — a tap on the toolbar's own empty space (which is
  `pointer-events: none`, so it doesn't block the video underneath) fell
  through to the provider-video container and read as a backdrop click.
  Desktop rarely hit this (hovering reveals controls without a `click`);
  mobile always did, since every reveal attempt is a tap. Fixed by adding
  `.shoji-slide-provider-video` to the exclusion list.
- Layout plugin: opening/closing the lightbox on a `type: 'grid'` gallery
  never got the same `contain: layout style` optimization masonry/justified
  already had (see the `0.1.0-alpha.6` entry below) — excluded on the
  assumption that a grid's intrinsic, content-driven height couldn't safely
  decouple the same way. Re-investigated after being reported again,
  specifically for grid: that assumption doesn't hold. Layout containment
  isolates a subtree from _outside_ influence; it doesn't stop the box from
  sizing itself off its own children's normal layout, intrinsic or not —
  verified directly that a 300-tile grid's rendered height and every tile's
  position are identical with and without it applied. Now applies to all
  three layout types.

## [0.1.0-alpha.7] - 2026-08-11

### Added

- Published to npm as [`@michaelyagi/shoji`](https://www.npmjs.com/package/@michaelyagi/shoji)
  (the unscoped `shoji` name was already taken by an unrelated package).
  Tagged releases (`vX.Y.Z...`) now auto-publish via a new `publish-npm` CI
  job, which derives the npm dist-tag from the version's prerelease
  identifier (e.g. `0.1.0-alpha.6` → the `alpha` tag) so prerelease builds
  never become `latest`. A `prepublishOnly` script guarantees `dist/` is
  rebuilt fresh at publish time.
- YouTube video id detection is more thorough (`/live/`, `/v/` legacy links,
  `youtube-nocookie.com`, `music.youtube.com`) and no longer the only way to
  supply an id. A new `data-shoji-video-id` attribute (selector mode)
  overrides the id parsed out of `data-shoji-video`'s URL — useful to rescue
  a URL shape detection doesn't recognize, or skip parsing entirely; it's
  ignored (with a console warning) if set without a matching
  `data-shoji-video` URL, on a URL that clearly isn't YouTube, or on a real
  `<video>` element. Dynamic mode gets the same capability two ways: a
  `video.id` field can now be left out of a `{ provider: 'youtube' }`
  descriptor and gets filled in from `src`, or `video: true` can replace the
  whole descriptor — infers provider _and_ id from `src` in one step,
  mirroring a bare `data-shoji-video="<url>"` attribute. Either path warns
  (never throws) if no id can be found, and the YouTube renderer now shows a
  placeholder instead of hanging on a broken embed when that happens.
- A new `data-shoji-video-provider` attribute (selector mode) declares the
  provider outright, mirroring dynamic mode's explicit `video.provider`.
  It's what lets `data-shoji-video-id` be trusted even on a URL whose host
  isn't recognized as YouTube (e.g. an internal proxy link), and it's the
  only way to build `vimeo`/`wistia` items in selector mode — neither has
  URL-based id detection, so an id has to be supplied explicitly alongside
  it. No renderer exists for `vimeo`/`wistia` yet; those items scan
  correctly but show the same placeholder as any provider without a
  registered renderer, until one exists.

### Fixed

- Bouncing back and forth across a YouTube (or any registered provider)
  slide's neighbor boundary — clicking through a thumbnail strip, or
  autoplay ticking past it and back — rebuilt the video's `<iframe>` embed
  from scratch on every single crossing, not just once: a real network
  round-trip and a new player instance competing with the slide transition
  for the same frame budget, visibly jerky every time. Root cause:
  `SlideManager`'s slide pool could only keep already-loaded content at a
  _different_ pool position by physically moving its DOM node into a
  different slot, which reloads a live iframe in most browsers (the reason
  an earlier fix excluded provider video from reuse entirely, always
  rebuilding fresh instead — that avoided the reload but made the rebuild
  itself the new cost). Fixed at the root: `render()` no longer moves
  content between slots for any type — a slot that already holds the right,
  ready content just has its own position relabeled, so the DOM node never
  moves and a live embed can be reused exactly like a plain image always
  could. Ordinary photo-to-photo navigation is unaffected (already reused
  via a cheap, harmless reparent before; now via the same relabel).
- Closing the lightbox could drag a host's own thumbnail strip back to
  wherever the gallery was originally opened from, discarding wherever it
  had since scrolled to (most visible with `ActiveThumbnail`, but not
  specific to it) — focus restoration on close (`FocusTrap.deactivate()`)
  called a bare `focus()` on the element that triggered the open, and a
  bare `focus()` auto-scrolls its target into view within any scrollable
  ancestor by default. Now passes `{ preventScroll: true }`, keeping the
  accessibility behavior (focus correctly returns to where you opened from)
  without the side effect.
- `ActiveThumbnail`'s auto-scroll fired `scrollIntoView({ behavior: 'smooth' })`
  synchronously on every single navigation, with no coordination between
  calls. Navigating faster than one smooth-scroll animation can finish
  (autoplay ticking, or just clicking quickly) issued a new call per step,
  each interrupting the last — overlapping, unsettled scroll animations that
  don't get superseded outright, and can visibly resolve later, at some
  unrelated point (observed specifically as a small scroll shift exactly
  when the gallery closed, even after the `FocusTrap` fix above). The scroll
  is now debounced 80ms, reset on every navigation and canceled on close, so
  a rapid burst issues exactly one real `scrollIntoView` call for wherever
  the viewer actually lands, instead of one per step. The highlight itself
  (the active class) is unaffected — only the scroll is debounced.
- `isBackdropClick` (the "did the viewer click outside the lightbox" check)
  had its own hand-written interactive-control selector, narrower than
  `GestureController`'s equivalent — missing `select`/`input`/`textarea`/
  `a[href]`/`[data-shoji-no-drag]`. A plugin mounting anything other than a
  `<button>` into the toolbar/overlay (e.g. a `<select>` theme picker) had
  every click on it misread as a backdrop click, closing the gallery instead
  of letting the control work. Both checks now share one
  `INTERACTIVE_CONTROL_SELECTOR` constant.
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
  the way it should. Also fixes a related bug in that same fix: a photo
  smaller than the dialog renders at its own native size rather than being
  stretched to fill it (by design — see `shoji.css`), which an earlier
  version of this didn't account for, shrinking such photos on rotation
  even though they should have stayed exactly the same size.

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
