import type { GestureEngineOptions } from '../gestures/GestureEngine';
import type { ShojiPlugin } from './plugin';

/** See DESIGN.md §2.1 — the full item model grows plugin-by-plugin (editor, ...). */
export interface GalleryItem {
  id?: string;
  src: string;
  srcset?: string;
  sizes?: string;
  sources?: MediaSource[];
  thumb?: string;
  poster?: string;
  video?: VideoDescriptor;
  width?: number;
  height?: number;
  alt?: string;
  caption?: string | HTMLElement | DangerousHtmlCaption;
  download?: string | false;
  /** Free-form payload, untouched by core beyond one thing: in selector mode, `scan.ts` populates this from any `data-shoji-*` attribute that isn't already one of the named fields above (e.g. `data-shoji-metadata-id="123"` → `data.{'metadata-id': '123'}`) — dynamic-mode items only ever get whatever the host puts here directly. */
  data?: Record<string, unknown>;
}

/**
 * Dynamic-mode-only input shape, widening `video` to also accept `true` —
 * shorthand for "figure it out from `src`," mirroring a bare
 * `data-shoji-video="<url>"` attribute with no explicit provider/id. Always
 * resolved into a real `VideoDescriptor` (or left `undefined`) before an
 * item ever reaches `gallery.items`/rendering — `scan.ts`'s
 * `resolveDynamicVideoItems`, run by `applyOptions()`/`updateSlides()`. Not
 * usable in selector mode: DOM attributes have no boolean shorthand of their
 * own, and `scanContainer()` always returns real `GalleryItem`s already
 * resolved to a concrete descriptor (see `data-shoji-video`/
 * `data-shoji-video-id` in `scan.ts`).
 */
export type GalleryItemInput = Omit<GalleryItem, 'video'> & { video?: VideoDescriptor | true };

/**
 * Explicit, self-documenting opt-in for raw HTML in a caption — named after
 * React's identical escape hatch on purpose, so it can't be triggered by
 * accident and anyone who's seen that convention knows what it means. Shoji
 * does not sanitize this string; the host must, if it isn't already trusted.
 */
export interface DangerousHtmlCaption {
  dangerouslySetInnerHTML: string;
}

/** Mirrors a `<source src type>` child. */
export interface MediaSource {
  src: string;
  type: string;
}

/**
 * `'youtube'`/`'vimeo'` are detected by core's DOM scanning too (§2.1) —
 * cheap, dependency-free URL parsing, not the provider's SDK. *Rendering*
 * any non-`'html5'` provider is a plugin's job (§4-video), via
 * `ctx.ui.registerVideoProvider()` or `'custom'`'s own `render`.
 *
 * `id` is optional on the youtube/vimeo variant so dynamic-mode hosts can
 * write `video: { provider: 'youtube' }` and let `id` be filled in from
 * `src` (`scan.ts`'s `resolveDynamicVideoItems`) — same reasoning as
 * `video: true` above, just with the provider spelled out explicitly. A
 * rendered item with no `id` (src wasn't a recognized URL either) shows a
 * placeholder instead of a broken embed — see `youtube.ts`/`vimeo.ts`.
 */
export type VideoDescriptor =
  | { provider: 'html5' }
  | { provider: 'youtube' | 'vimeo'; id?: string; url?: string }
  | {
      provider: 'custom';
      /** Same contract as `plugin.ts`'s `VideoProviderRenderer` — see its doc comment. */
      render: (
        el: HTMLElement,
        item: GalleryItem,
        onReady: () => void,
        signal: AbortSignal,
      ) => void;
    };

export interface GalleryOptions {
  /** DOM selector for gallery items when not using dynamic mode. */
  selector?: string;
  /** Dynamic-mode item list; mutate live via gallery.updateSlides(). */
  items?: GalleryItemInput[];
  /** Index to open on — used both as `open()`'s default argument and, with `openOnInit`, as the index opened automatically at construction. */
  index?: number;
  /**
   * Opens the lightbox immediately at construction (to `index`, default 0),
   * instead of the normal default of staying closed until the host calls
   * `open()` or a scanned/layout-rendered thumbnail is clicked. Default
   * `false`. Useful for hash/deep-link-style integrations that should land
   * straight in the lightbox; everyone else should leave this off — a
   * gallery that pops open on page load without a click is rarely what's
   * wanted.
   */
  openOnInit?: boolean;
  /** Flat locale key map — see CLAUDE.md: no hardcoded English in UI. */
  locale?: Record<string, string>;
  /** Registered plugins; each plugin's own options nest under options[plugin.name]. */
  plugins?: ShojiPlugin[];
  /**
   * DESIGN.md §2.8 — ms of inactivity before all buttons/overlays (toolbar,
   * prev/next, counter, caption) auto-hide; default 5000. `0` is a distinct
   * mode, not "disabled": controls never show at all, regardless of activity.
   */
  autoHideDelay?: number;
  /**
   * DESIGN.md §2.3 — how many slides on each side of the active one are
   * kept mounted *and* proactively decoded ahead of time; default 1.
   * Navigating to any index within that window shows instantly, no loading
   * spinner — its content was already decoded and cached (by item index,
   * surviving the pool's internal slot reshuffling) before you got there.
   * Navigating further than `preload` away (a fast flick through several
   * slides, or a direct `goTo()`/deep link) still shows the spinner while
   * that one decodes, same as ever — this only changes what counts as
   * "already ready."
   */
  preload?: number;
  /** Shows the "N / M" counter badge; default true. Purely visual — the live-region announcement (§2.6) always includes position regardless. */
  counter?: boolean;
  /** DESIGN.md §2.3a — starts a video slide's caption shown instead of hidden; default `false`. No effect on a photo's caption. */
  showVideoCaption?: boolean;
  /**
   * DESIGN.md §2.2 — `next()`/`prev()` (and the arrow-key/toolbar-button paths
   * that call them) wrap past the last/first item instead of stopping; default
   * true. Does not affect `goTo(index)` with an explicit out-of-range index
   * (still clamps — a directed jump, not a step) or `Home`/`End` (still an
   * absolute jump to the first/last item).
   */
  loop?: boolean;
  /**
   * Default `true`. `false` disables every viewer-facing way to close the
   * lightbox: the close button (hidden entirely, not just inert), clicking
   * the backdrop, `Escape`, and vertical swipe-to-close (no live drag
   * feedback either, not just a release that fails to close). For
   * non-closable embeds — a gallery meant to stay open permanently once
   * shown. `gallery.close()` itself is unaffected — this only gates the
   * four built-in viewer-triggered paths, host code can still close it
   * programmatically at any time.
   */
  closable?: boolean;
  /**
   * DESIGN.md §2.4 — overrides the gesture engine's `lockThreshold`/
   * `swipeThreshold`/`swipeVelocity` (defaults: 10px, 50px, 0.3px/ms).
   * Partial: any field left out keeps its default. Momentum easing is not
   * configurable here — it's the CSS custom property
   * `--shoji-momentum-easing`, per CLAUDE.md's "no hardcoded sizes/timings
   * in JS, everything through --shoji-* custom properties."
   */
  gestures?: Partial<GestureEngineOptions>;
  /**
   * DESIGN.md §2.5 — the slide-to-slide transition for programmatic
   * navigation (buttons, keyboard, autoplay, `goTo()`); never affects a
   * gesture-driven swipe, which always uses its own live-drag/settle
   * animation regardless of `mode` (§2.4). Default `'slide'`. One of the
   * built-in preset names (`slide`, `fade`, `zoom`, `deck`, `slideVertical`,
   * `push`, `fadeUp`, `fadeDown`, `fadeLeft`, `fadeRight`, `zoomOut`,
   * `scaleUp`, `scaleDown`, `rotate`, `rotateLeft`, `rotateRight`, `flipX`,
   * `flipY`, `cube`, `coverflow`, `drop`) — or any other string, treated as
   * a custom CSS class pair (`shoji-transition-<mode>-enter`/`-leave`) the
   * host supplies its own `transition`/`@keyframes animation` for; no JS
   * needed on the host's end.
   */
  mode?: string;
  /**
   * DESIGN.md §2.5 — overrides `mode`/hides baseline controls (§2.6a) under
   * a `(pointer: coarse)` device (touch-primary, not a viewport-width
   * breakpoint — a narrow desktop window isn't "mobile" here). Deliberately
   * scoped to just these two fields, matching this section's own example,
   * rather than a general "override any GalleryOptions field under a media
   * query" mechanism — nothing in the roster needs broader coverage yet,
   * and that would be a substantially larger, riskier feature to build
   * speculatively (CLAUDE.md).
   */
  mobileSettings?: {
    mode?: string;
    /** `false` starts controls hidden on a coarse-pointer device (via the existing §2.8 auto-hide, not a separate permanent-hide state) — they still reveal on any activity, same as normal auto-hide; a viewer is never actually stranded without a way to reach Close. */
    controls?: boolean;
  };
  [key: string]: unknown;
}

/** See DESIGN.md §2.2 — grows as core lifecycle stages and plugins land. */
export interface GalleryEvents extends Record<string, unknown> {
  beforeOpen: { index: number };
  open: { index: number };
  afterOpen: { index: number };
  beforeClose: Record<string, never>;
  close: Record<string, never>;
  afterClose: Record<string, never>;
  destroy: Record<string, never>;
  /** DESIGN.md §2.1 — fires after the item list changes via updateSlides()/refresh(). */
  itemsUpdated: { items: GalleryItem[] };
  /**
   * DESIGN.md §2.2 lists these as cancelable; that isn't implemented yet (no
   * plugin needs it yet) — detail is plain `{from, to}` for now, same as the
   * other lifecycle events, not the `event.preventDefault()` shape §2.2 describes.
   */
  beforeSlide: { from: number; to: number };
  afterSlide: { from: number; to: number };
  /** DESIGN.md §2.3 — fires once a slide's media has decoded/settled. */
  slideItemLoad: { index: number };
  /** DESIGN.md §2.8 — toolbar auto-hide sync points for plugins with their own overlays. */
  'controls:hide': Record<string, never>;
  'controls:show': Record<string, never>;
  /** DESIGN.md §2.2a-autoplay — emitted by the autoplay plugin, not core. */
  autoplayStart: Record<string, never>;
  autoplayStop: Record<string, never>;
  /**
   * DESIGN.md §2.4 — core drives horizontal drag-to-navigate and vertical
   * drag-to-close itself (no event needed for either — they just call
   * next()/prev()/close()); tap/doubleTap/pinch/wheelZoom have no built-in
   * effect in core and exist purely as a relay for a future Zoom plugin
   * (double-tap toggles zoom, pinch/wheel+ctrl zoom, per §4) to consume
   * without core depending on that plugin existing. Coordinates are
   * viewport (client) pixels, same as the underlying PointerEvent/WheelEvent.
   */
  tap: { x: number; y: number };
  doubleTap: { x: number; y: number };
  pinchStart: { centerX: number; centerY: number };
  /** scale is relative to this pinch gesture's own start distance (1 = unchanged), not cumulative across separate pinches. */
  pinchMove: { scale: number; centerX: number; centerY: number };
  pinchEnd: Record<string, never>;
  /** deltaScale is a small per-event increment (positive = zoom in); a consumer accumulates it, it isn't an absolute scale. */
  wheelZoom: { deltaScale: number; x: number; y: number };
  /** DESIGN.md §4-fullscreen — emitted by the fullscreen plugin, not core; fires from the native `fullscreenchange` event, not the toolbar button's own click, so it reflects reality even when fullscreen was entered/exited by other means (browser Escape handling, a request rejected). */
  fullscreenChange: { fullscreen: boolean };
  /** DESIGN.md §4-rotate/flip — emitted by the rotateFlip plugin, not core, on every rotate/flip click; the plugin itself never persists this (resets per slide) — a host wanting to keep it stores this event's payload themselves. */
  rotateFlipChange: { index: number; flipH: boolean; flipV: boolean; rotation: number };
  /** DESIGN.md §4-zoom — emitted by the zoom plugin, not core, on every scale change (gesture or button-driven); resets per slide, not persisted by the plugin itself, same pattern as rotateFlipChange. */
  zoomChange: { index: number; scale: number };
  /**
   * DESIGN.md §5 — emitted by the layout plugin, not core, once a render
   * pass has built and appended tile DOM: after `fullRender()` (every tile
   * currently in the container — a full rebuild, e.g. from a non-append
   * items change), or after `appendRender()` (just the newly-created tiles
   * — existing ones are untouched, per the plugin's own incremental-append
   * behavior). `tiles` is exactly the elements built *this pass*, in item
   * order — a host injecting custom content into tiles (a badge, a
   * selection checkbox, anything not itself part of the layout plugin)
   * uses `element` directly and `index` to look the item back up via
   * `gallery.items[index]`; `element.dataset.shojiIndex` (also set on
   * every tile, matching `index` here) is the same lookup from the DOM
   * side, for code that only has the element itself later (e.g. a click
   * handler on injected content) and needs the index back without having
   * kept this event's payload around.
   */
  layoutRender: { tiles: { index: number; element: HTMLElement }[] };
}
