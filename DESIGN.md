# DESIGN.md — Shoji

A zero-dependency, plugin-first lightbox/gallery library. Feature parity with lightGallery, plus multi-select, WebGL edit mode, bidirectional infinite scroll, and slideshow — with a smaller, cleaner core.

---

## 1. Goals & non-goals

**Goals**

- Drop-in replacement use case for lightGallery: open a lightbox from thumbnails or programmatically (dynamic mode), navigate with touch/drag/keyboard, virtual slides for huge galleries.
- Everything beyond the minimal lightbox is a plugin with a stable, documented API.
- First-class: multi-select, edit mode (client-side WebGL adjustments with server persistence hooks), bidirectional infinite scroll, slideshow, deep links, video, thumbnails/pagers, share, comments, fullscreen, rotate/flip, responsive images, a11y.
- Buttery performance: hardware-accelerated CSS transitions, ≤ 3 slides in DOM, no layout thrash in gesture paths.

**Non-goals**

- No framework wrappers in core (React/Vue adapters can come later as thin packages).
- No server component — server interactions are user-provided hooks (editor save, infinite-scroll data source, share URLs).
- No IE / legacy support. Baseline: last 2 versions of evergreen browsers + iOS Safari 16+.

---

## 2. Core architecture

```
┌───────────────────────────────────────────────────┐
│ Gallery (core)                                    │
│  • Options & item model      • Slide manager      │
│  • Typed event bus           • Virtual DOM window │
│  • Lifecycle (open/close/destroy)                 │
│  • A11y (focus trap, ARIA, announcements)         │
├──────────────┬────────────────┬───────────────────┤
│ GestureEngine│ TransitionMgr  │ Toolbar/UI slots  │
├──────────────┴────────────────┴───────────────────┤
│ Plugins: thumbnails · pagers · zoom · video ·     │
│ autoplay · fullscreen · hash · share · comments · │
│ rotate · editor · select · scroll · layout        │
└───────────────────────────────────────────────────┘
```

### 2.1 Item model

```ts
interface GalleryItem {
  id?: string;               // stable id (required for editor/select persistence)
  src: string;               // full-size source
  srcset?: string;           // responsive sources
  sizes?: string;
  sources?: MediaSource[];   // <picture>/video sources incl. webp/avif
  thumb?: string;
  poster?: string;           // video poster
  video?: VideoDescriptor;   // html5 | youtube | vimeo | wistia | custom
  width?: number; height?: number;  // for aspect-ratio placeholder
  alt?: string;
  caption?: string | HTMLElement;
  download?: string | false;
  edits?: EditState;         // persisted editor transforms (see §8)
  data?: Record<string, unknown>;   // user payload, untouched by core
}
```

Items come from DOM scanning (`selector` mode), or arrays (**dynamic mode**), and can be mutated live via `gallery.updateSlides(items, currentIndex?)` — core diffs by `id` (fallback: `src`), preserving the active slide when possible, matching lightGallery's updateSlides semantics.

### 2.2 Lifecycle & events

Typed event bus; every feature is observable and cancelable where sensible:

```
beforeOpen → open → afterOpen
beforeSlide(from,to) → slideItemLoad → afterSlide
beforeClose → close → afterClose
itemsUpdated · dragStart/drag/dragEnd · zoomChange
select:change · edit:open/apply/save/restore · scroll:append/prepend
posterDefined · fullscreenChange · autoplayStart/Stop/Progress
```

`gallery.on(event, fn)` returns an unsubscribe function. Events carry typed detail objects. Cancelable events (`before*`) support `event.preventDefault()`.

### 2.3 Virtual slides

Only `currentIndex − 1 … currentIndex + 1` exist in the DOM (configurable `preload`). Slide elements are pooled and recycled; media loads on demand with `loading` states, aspect-ratio placeholders (from `width/height`), and `img.decode()` before enter transitions to avoid progressive-decode/GPU tile seam artifacts. Galleries of 100k items must open in O(1).

### 2.4 Gesture engine

One Pointer-Events-based engine feeding all consumers (core drag, zoom plugin, vertical-swipe close):

- swipe/drag horizontal → navigate (mouse drag included, desktop parity)
- vertical swipe/drag → close (with opacity/scale feedback)
- pinch → zoom; double-tap → toggle zoom; pan while zoomed
- wheel + ctrl → zoom (desktop)
- All thresholds/velocities configurable; passive listeners except where `preventDefault` is required (documented).

Gesture state machine: `idle → pending(dir?) → dragging(h|v) → settling`. Direction lock decided after `lockThreshold` px; momentum with configurable easing on release.

### 2.5 Transitions

Hardware-accelerated CSS3 (`transform`/`opacity` only). Built-ins: `slide`, `fade`, `zoom`, `lg-style deck`, plus ~20 named presets generated from a small keyframe DSL. Custom animation = provide a CSS class pair + duration; no JS needed:

```ts
new Shoji(el, { mode: 'shoji-flip', mobileSettings: { mode: 'fade', controls: false } });
```

Separate `mobileSettings` override bag (applied under a media/pointer query) mirrors lightGallery's mobile-specific settings.

### 2.6 Accessibility (core, non-optional)

- Dialog semantics: `role="dialog"`, `aria-modal`, labelled by caption/counter.
- Focus trap on open; focus restore on close; `Escape` closes; arrows navigate; `Home/End` jump; `Tab` cycles toolbar.
- Live region announces "Image 12 of 480: {alt}".
- All toolbar buttons real `<button>`s with labels; visible focus rings via `--shoji-focus-ring`.
- Reduced-motion: honors `prefers-reduced-motion` (fades instead of slides).

---

## 3. Plugin system

Design goal: **an "elegant and simple" plugin is a function.** No base classes required.

```ts
export interface ShojiPlugin {
  name: string;
  version?: string;
  requires?: string[];                    // plugin dependency names
  defaults?: Record<string, unknown>;     // merged into options.<name>
  init(ctx: PluginContext): void | (() => void);  // return = cleanup
}

interface PluginContext {
  gallery: Gallery;                 // full public API
  options: Readonly<any>;           // merged options for this plugin
  on: Gallery['on'];                // auto-unsubscribed on destroy
  ui: {
    toolbar(slot: 'left'|'center'|'right', el: HTMLElement | ButtonSpec): Disposer;
    overlay(el: HTMLElement, layer?: number): Disposer;   // above slides, below toolbar
    outer(): HTMLElement;                                  // .shoji-outer
    registerShortcut(key: KeySpec, fn: (e) => void): Disposer;
  };
  storage: { get(k: string): unknown; set(k: string, v: unknown): void }; // per-gallery scratch
}
```

Rules:

- Plugins register UI only through `ctx.ui` slots → consistent styling/theming, automatic cleanup, no z-index wars.
- Plugins communicate via events, never direct imports of other plugins. `requires` enforces load order and hard deps.
- Everything a plugin creates through `ctx` is disposed automatically on `destroy()`; the optional returned cleanup handles anything else.
- Options: `new Shoji(el, { plugins: [Thumbnails, Editor], thumbnails: {...}, editor: {...} })`.

A "hello world" plugin is ~10 lines. That's the bar for "simple".

---

## 4. Feature specs (lightGallery parity)

- **Thumbnails**: strip below slides; optional **animated thumbnails** (smooth translate of the strip following current index); auto thumbnails for YouTube/Vimeo via provider oEmbed/thumbnail URLs; toggleable; swipeable itself.
- **Pagers**: minimal dot/bar pagers as an alternative to thumbnails; hover shows the corresponding thumbnail in a popover.
- **Zoom**: pinch, double-tap/click, wheel+ctrl, zoom in/out/actual-size buttons; pan when zoomed; zoom respects `srcset` (may swap to larger candidate when zoomed).
- **Video**: HTML5 (MP4/WebM/Ogg) with optional video.js integration hook; YouTube/Vimeo/Wistia providers via iframe API; autoplay-on-slide, pause-on-leave; `posterDefined` event; custom provider registration.
- **Autoplay / slideshow**: configurable interval, progress bar (`--shoji-progress`), pause on interaction (drag/zoom/hover configurable), resume rules, loop, shuffle option, start/stop toolbar button + `Space` shortcut. Doubles as the "slideshow" feature.
- **Fullscreen**: native Fullscreen API toggle with vendor fallbacks; `fullscreenChange` event.
- **Hash / browser history**: `#shoji-<galleryId>-<slideId|index>` deep links; open-on-load if hash matches; back/forward navigates slides; `history.replaceState` during swipes to avoid history spam (pushState only on settle; configurable).
- **Share**: URL builders per network (X/Twitter, Facebook, Pinterest, WhatsApp, copy-link) using the hash plugin's deep link; fully customizable button list; no SDKs loaded.
- **Comments**: mount-point overlay panel with adapters for Facebook Comments and Disqus, plus a `custom` adapter receiving the current item — the widget itself is user-supplied.
- **Rotate/flip (view)**: rotate ±90°, flip H/V of the *view* (CSS transform, non-destructive, resets per slide); emits values via hooks so hosts can persist. (Persistent, pixel-level editing lives in the Editor plugin.)
- **Responsive images**: `srcset`/`sizes`/`<picture>` passthrough, DPR-aware selection, any format (webp/avif/jxl) — core never re-encodes.
- **Dynamic mode & updateSlides**: covered in §2.1.
- **Mobile**: `mobileSettings` overrides; CSS-only media sizing; 44px touch targets.

---

## 5. Layout plugin (grid · tight masonry · justified)

Turns the inline gallery container into a fully managed, config-driven layout. No extra markup, no external masonry library — the host provides a container and items (DOM or dynamic mode), and picks a layout in options.

### 5.1 Config

```ts
layout: {
  type: 'grid' | 'masonry' | 'justified',   // default 'grid'
  gutter: number | { x: number, y: number },// px; 0 = tight/gap-free
  // masonry
  columns: number | 'auto',                 // 'auto' derives from columnWidth
  columnWidth?: number,                     // target px used when columns:'auto'
  fill: 'shortest' | 'ordered',             // shortest-column packing vs strict order
  // justified
  rowHeight?: number,                       // target row height; rows scale to fit
  lastRow?: 'justify' | 'left' | 'hide',
  // shared
  breakpoints?: Record<number, Partial<LayoutOptions>>, // maxWidth → overrides
  animate?: boolean,                        // FLIP transitions on relayout (default true)
  // headings / sections
  groupBy?: (item: GalleryItem) => string,  // derive section key (e.g. month from item.data)
  renderHeading?: (key: string, items: GalleryItem[]) => string | HTMLElement,
  stickyHeadings?: boolean,                 // headings stick while their section scrolls (default false)
}
```

Headings can come from either source, or both mixed:

1. **Explicit heading items** in the item stream: `{ type: 'heading', title: 'July 2026' }` (or `content: HTMLElement`). Useful when the server already emits grouped pages.
2. **Derived via `groupBy`**: the plugin inserts a heading whenever the group key changes across consecutive items, rendered through `renderHeading` (default: an `<h2>` with the key).

“Tight masonry” is simply `{ type: 'masonry', gutter: 0 }` (or a small gutter) — tiles pack flush with no ragged gaps because widths are uniform per column and heights come from true aspect ratios.

### 5.2 Algorithm & rendering

- **Deterministic, measure-free layout**: positions are computed purely from item aspect ratios (`width`/`height` in the item model; required for layout, warn + fallback to on-load measure if absent). This means the full layout — including container height — is known before a single image loads: no reflow jumps, correct scrollbar from frame one.
- **Masonry**: column count from config or `containerWidth / columnWidth`; each tile placed into the shortest column (`fill:'shortest'`, tightest packing) or round-robin in DOM order (`fill:'ordered'`, preserves reading order at slight tightness cost). Tiles are absolutely positioned via `transform: translate()` (compositor-only moves); container gets explicit height.
- **Justified**: greedy row filler scaling each row to exactly the container width at ~`rowHeight` (Flickr-style); also “tight” by construction.
- **Grid**: uniform CSS grid with `aspect-ratio` cells + object-fit crop; cheapest option, no JS positioning.
- **Responsive**: single `ResizeObserver` on the container; relayout is O(n) arithmetic + n transform writes, batched in one rAF. `breakpoints` override any option below a given width. FLIP-animated relayout when `animate` (disabled under `prefers-reduced-motion`).
- **Headings/sections**: a heading is a full-width layout element that **terminates the current section and resets all column heights** — the next tile row starts flush beneath it, so each section is its own tight masonry block (same rule flattens rows in `justified`, and starts a fresh grid row in `grid`). Heading heights are measured once on insert (text content is cheap to measure, unlike images) and cached per width; they participate in the same deterministic position map, so container height stays exact. Headings are **not slides**: they're skipped by lightbox indexing, keyboard nav, and the counter. `stickyHeadings` pins the active section's heading via `position: sticky` on a per-section wrapper (no scroll listeners). Semantics: headings render as real `<h2>`–`<h6>` (level configurable) so the grid remains a navigable document outline for screen readers.
- **Incremental updates**: append is O(new items) — column heights/row state are kept, nothing above moves. When `groupBy` is set, appended/prepended pages **merge across load boundaries**: if the incoming page starts with the same group key the adjacent section ends with, no duplicate heading is inserted and the tiles join the existing section (prepend into a section relayouts that section only where possible). **Prepend relayouts everything below** (masonry columns shift); the plugin computes the container height delta and hands it to the scroll plugin's anchoring step in the same frame, so bidirectional infinite scroll stays jump-free (§7).
- Layout emits `layout:update { positions, height }`; lazy-loading uses the computed rects (not element visibility) so `loading="lazy"`/IO thresholds work with absolutely positioned tiles.

### 5.3 Interop

- **Scroll plugin**: windowing collapses far-off tiles to positioned placeholders using the already-known rects — masonry math is unaffected by eviction.
- **Select plugin**: marquee hit-testing uses layout rects (fast AABB checks), not `getBoundingClientRect` per tile. In selection mode, headings grow a section checkbox — clicking it selects/deselects the whole section (the Google-Photos "select this day" gesture); indeterminate state when partially selected.
- **Lightbox**: clicking a tile opens the lightbox at that index as usual; zoom-from-tile transitions use the layout rect as the animation origin.

## 6. Multi-select plugin

Intuitive = matches OS file-manager muscle memory, on both inline grids and inside the lightbox.

**Interactions (inline/grid mode)**

- Click = select single (clears others). `Ctrl/Cmd+click` = toggle. `Shift+click` = range from anchor.
- **Drag rubber-band** on empty space = marquee select (`Ctrl` adds, `Alt` subtracts).
- Touch: **long-press enters selection mode** (haptic if available, checkboxes fade in on tiles); then tap toggles; drag across tiles paints selection; a selection action bar slides in (count + actions).
- `Ctrl/Cmd+A` select all (within loaded set), `Escape` clears/exits selection mode.
- Selection survives infinite-scroll loads (keyed by item `id`).

**Interactions (lightbox mode)**

- Toolbar checkbox toggles current slide's membership; badge shows count; `S` shortcut.

**API**

```ts
select: {
  enabled: true, max?: number, persist?: boolean,
  actions?: SelectionAction[],   // rendered in the action bar
}
gallery.selection.get(): GalleryItem[]
gallery.selection.set(ids: string[]) / .clear() / .toggle(id)
// events: select:change { added, removed, all }
```

---

## 7. Infinite scroll plugin (uni- & bidirectional)

For inline gallery/grid mode (and thumbnail strips), with lightbox staying in sync.

- **Data source contract**: `loadAfter(cursor) → { items, cursor }` and `loadBefore(cursor)` for bidirectional; both return promises; core appends/prepends via `updateSlides` internally.
- **Sentinels**: two `IntersectionObserver` sentinels (top/bottom) with configurable `rootMargin` prefetch distance; in-flight de-dupe; retry with backoff; `scroll:append/prepend` events.
- **Scroll anchoring on prepend** (the hard part): measure the first stable element's offset before insertion, insert, then adjust `scrollTop` by the delta in the same frame (before paint, in rAF-before-commit). Use CSS `overflow-anchor` where available as belt-and-suspenders, but never rely on it (Safari). Zero visible jump is an e2e-tested requirement.
- **DOM windowing**: optional cap on rendered tiles; far-off tiles collapse to sized placeholders (aspect-ratio boxes) so scroll height stays truthful while memory stays flat. Bidirectional eviction mirrors bidirectional loading.
- **Deep-link entry**: opening mid-collection (via hash) starts a bidirectional window around that item — this is the primary reason `loadBefore` exists.
- URL/state restoration: optionally sync a `cursor`/index into the hash for reload-in-place.

---

## 8. Editor plugin (edit mode)

Non-destructive image editing in the lightbox, modeled on the proven Shashin editor, generalized and de-jQuery-ified.

### 8.1 Edit state

```ts
interface EditState {
  rotation: 0|90|180|270;
  flipH: boolean; flipV: boolean;
  brightness: number;  // 1.0 = neutral, multiplicative
  contrast: number;    // ((c−0.5)·contrast)+0.5
  saturation: number;  // luma-preserving w/ red-dampening & perceptual boost >1.0
  sharpness: number;   // unsharp-mask weight, >1.0 engages
}
```

- Opens seeded from `item.edits` (host-persisted values); missing keys default to neutral.
- **Three baselines** drive button state: *neutral* (all defaults), *original* (persisted values at open), *current*. 
  - **Reset** → back to *original* (enabled iff current ≠ original).
  - **Restore** → back to *neutral* (enabled iff current ≠ neutral) and signals host to drop stored edits/derived thumbs.
  - **Save** → enabled iff current ≠ original; hands `EditState` to the host hook.
- **Flip/rotation normalization**: flipH+flipV ≡ rotate 180°. Canonicalize before comparisons and before save, per this table (rotation always normalized to `((r % 360)+360)%360`):

| flipH | flipV | rot | → canonical |
|---|---|---|---|
| ✓ | ✓ | 0   | no flips, rot 180 |
| ✓ | ✓ | 90  | no flips, rot 270 |
| ✓ | ✓ | 180 | no flips, rot 0 |
| ✓ | ✓ | 270 | no flips, rot 90 |

Comparisons for button enablement use canonical forms on both sides (this is what makes Reset/Save enablement correct when the user "undoes" via an equivalent transform).

### 8.2 Rendering pipeline

1. **Primary: WebGL** single-pass fragment shader — brightness → contrast → saturation (RGB-domain, `dot(c, [0.299,0.587,0.114])` gray; red-dampening `1 − 0.10·(s−1)` and `+0.006·(s−1)` perceptual boost when s > 1) → optional 5-tap unsharp mask (`weight = (sharpness−1)/4.5`, resolution-scaled offset `clamp(√(w·h)/512, 0.5, 2.0)`), with color adjust applied per-tap *before* combining. Order must byte-match the server implementation so preview == saved result.
2. Rotation/flip applied as CSS transform on the preview element (not in-shader), with even/odd-rotation aware max-width/height fitting to the viewport.
3. **Resource management**: per-canvas WeakMap cache of `{gl, program, buffers, texture, uniform locations, lastParams}`; `texSubImage2D` on same-size re-uploads; uniforms set only on change; `UNPACK_FLIP_Y_WEBGL`; output via `canvas.toBlob` → object URL (revoke previous URL each pass); low-quality JPEG for interactive preview, full quality only on demand.
4. **Fallback chain**: WebGL unavailable/failed → CSS-filter live preview (brightness/contrast/saturate map directly; sharpness disabled with UI hint) → optional host hook `editor.renderPreview(item, state) → dataURL/blob` for server-side rendering (Shashin's fallback path).

### 8.3 UI & shortcuts

- Overlay module over the lightbox (lightbox toolbar hidden while open); toolbar: rotate L/R, flip H/V, four sliders (brightness/contrast/saturation/sharpness) with center-tick snap and icon-click-to-reset per slider, Restore, Reset, Save, Close; disabled-state styling via custom properties.
- Busy model: spinner + all controls disabled during a render pass; close blocked while busy.
- Shortcuts: `←/→` rotate, `↑/↓` flip H/V, `R` reset, `O` restore, `S` save, `Escape` close. Click outside tool areas closes (when idle).
- "Current settings" info toast shows persisted values with non-neutral ones highlighted.
- Scroll locking of the page while editor is open; full state cleanup + GL/object-URL disposal on close.

### 8.4 Host integration

```ts
editor: {
  source: (item) => string | Blob,          // full-res original fetcher (cache-busted)
  save:   (item, state, blob?) => Promise,  // persist EditState (+ optional rendered blob)
  restore:(item) => Promise,                // drop stored edits/derived assets
  renderPreview?: (item, state) => Promise<Blob>,  // server fallback
}
```

After save/restore, editor emits `edit:save`/`edit:restore` and calls `updateSlides` so the lightbox and thumbnails refresh.

---

## 9. Styling & theming

- Single `shoji.css` + optional per-plugin css; all colors, spacing, z-layers, easing via `--shoji-*` custom properties; dark default theme; light theme = one class.
- Icon set: inline SVG sprites (stroke = `currentColor`), overridable per-button.
- No !important; layered z-index scale documented (`backdrop:0 · slides:10 · overlay:20 · toolbar:30 · toast:40`).

## 10. Packaging, performance budgets & testing

**Distribution** — the primary artifact is a single-file pair:

- `dist/shoji.js` + `dist/shoji.css` (and minified variants): core + **all** official plugins in one JS and one CSS file. Plugins ship registered-but-inert — nothing activates until enabled via options, so the all-in-one bundle adds zero runtime cost for unused features. UMD wrapper (global `Shoji`) so the same file works via `<script>` tag or `import`. Sourcemaps included.
- Secondary: per-plugin ESM entries (`shoji/core`, `shoji/plugins/editor`, …) + `.d.ts` for bundler users who want tree-shaking. Same source, same version, built in the same `npm run build`.
- CSS mirrors this: one `shoji.css` concatenating core + all plugin styles (safe because everything is namespaced `.shoji-*` / `--shoji-*` and plugin styles are inert without their plugin's DOM), with per-plugin css files as the secondary output.

**Budgets** — Core ≤ 18 kB, plugins ≤ 8 kB (editor ≤ 20 kB), full single-file bundle ≤ 90 kB JS / ≤ 20 kB CSS, all min+gzip; enforced via size-limit in CI.
- 60 fps drag on a mid-tier Android profile (Playwright trace-based assertion on long tasks during gesture).
- Open-to-first-image < 300 ms with warmed cache; virtualization keeps DOM ≤ 3 slides + pooled nodes.
- E2E must cover: gesture nav (touch + mouse drag), keyboard-only flow, focus trap, hash deep-link, bidirectional prepend with zero scroll jump, editor save/reset/restore enablement matrix (canonicalization cases), multi-select marquee + long-press mode, destroy/leak checks.

## 11. Milestones

1. **M1 Core**: item model, lifecycle, virtual slides, gestures, transitions, a11y, dynamic mode + updateSlides.
2. **M2 Essentials**: zoom, thumbnails, fullscreen, autoplay/slideshow, hash, video (HTML5 + YT/Vimeo).
3. **M3 Differentiators**: layout plugin (grid → masonry → justified), multi-select, infinite scroll (uni → bidirectional), rotate/flip view.
4. **M4 Editor**: WebGL pipeline, fallbacks, host hooks.
5. **M5 Long tail**: share, comments, pagers, animated thumbnails, Wistia, theming polish, docs site.
