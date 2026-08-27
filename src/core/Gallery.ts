import {
  lockBodyScroll,
  unlockBodyScroll,
  markIntentionalScroll as markIntentionalScrollInternal,
} from './bodyScrollLock';
import { EventBus, type Unsubscribe } from './EventBus';
import { buildLightboxDom, type LightboxDom } from './dom';
import { FocusTrap } from './FocusTrap';
import { GestureController, INTERACTIVE_CONTROL_SELECTOR } from './GestureController';
import { LiveRegion } from './LiveRegion';
import type { ButtonSpec, PluginContext, ShojiPlugin, VideoProviderRenderer } from './plugin';
import { DEFAULT_SELECTOR, resolveDynamicVideoItems, scanContainer } from './scan';
import { pauseMedia, SlideManager } from './SlideManager';
import type {
  DangerousHtmlCaption,
  GalleryEvents,
  GalleryItem,
  GalleryItemInput,
  GalleryOptions,
} from './types';
import { TRANSITION_PRESETS } from '../transitions/presets';
import { SlideTransition } from '../transitions/SlideTransition';
import { zoomIn, zoomOut, type Box, type FrozenDragTransform } from './zoomTransition';

function itemKey(item: GalleryItem | GalleryItemInput): string {
  return item.id ?? item.src;
}

function resolveElement(target: HTMLElement | string): HTMLElement {
  if (typeof target !== 'string') return target;
  const el = document.querySelector<HTMLElement>(target);
  if (!el) throw new Error(`Shoji: no element matches selector "${target}"`);
  return el;
}

/**
 * DESIGN.md §2.7 — lets code that never held a closure reference to a
 * gallery (a callback resolving long after the call site is gone, a
 * separate `<script>`, devtools) reach the live instance anyway, via
 * `Gallery.getInstance()`/`Gallery.instances()`. Two structures kept in
 * lockstep rather than one: the `WeakMap` gives O(1) lookup-by-element
 * without leaking (an entry is only reachable through an element the host
 * still holds a reference to itself), but WeakMaps aren't iterable, so
 * `instances()` needs the parallel `Set` too. The constructor adds to
 * both; `destroy()` removes from both.
 */
const instanceRegistry = new WeakMap<HTMLElement, Gallery>();
const allInstances = new Set<Gallery>();

/** CLAUDE.md — all user-visible strings go through `locale`; these are the fallback defaults. */
const DEFAULT_LOCALE = {
  close: 'Close',
  previous: 'Previous image',
  next: 'Next image',
  showCaption: 'Show caption',
  hideCaption: 'Hide caption',
  fullCaption: 'Full caption', // DESIGN.md §2.3a
  moreControls: 'More controls', // DESIGN.md §3.1a
};

/**
 * A click that isn't on the image, a button, a video, or an overlay
 * (counter/caption) counts as "clicked outside the content." Walks
 * `event.composedPath()` (captured at dispatch time) rather than
 * `event.target.closest(...)` — a click handler earlier in the same bubble
 * phase can synchronously replace the clicked element's subtree (e.g. a
 * toolbar button swapping its own icon via `innerHTML` in its click
 * handler), which detaches the original target from the document before
 * this listener (attached higher up, on `.shoji-outer`) ever runs;
 * `.closest()` on a detached node finds no ancestors and would wrongly
 * read as "clicked outside," closing the gallery. `composedPath()` isn't
 * affected by DOM mutations that happen after dispatch.
 *
 * Provider video (YouTube/Vimeo): exclude only the actual iframe/mount
 * element, not the entire `.shoji-slide-provider-video` container. This
 * allows clicks on the blank space around the embed (sides, padding-top
 * toolbar inset) to close the gallery, matching image and HTML5 video
 * behaviour. Clicks that land inside the cross-origin iframe never bubble
 * to the parent at all, so no special handling is needed there; `iframe`
 * covers the edge case where the frame hasn't yet captured focus and a
 * click registers on the element itself from the parent-page perspective.
 * `.shoji-video-mount` is the Vimeo SDK wrapper; YouTube uses a bare
 * `<iframe>` directly inside `.shoji-slide-provider-video`.
 *
 * `caption` — a real bug, reported from real usage: `.shoji-caption--video`
 * (DESIGN.md §2.3a) is `pointer-events: none` so a click on it reaches the
 * video's own native controls underneath, which works fine when the video
 * fills enough of the slide to actually BE underneath it. A letterboxed
 * video (narrower or shorter than the dialog, so the caption's own
 * bottom-left position sits over plain `.shoji-slide-media` background
 * instead) has nothing there to click through *to* — the click fell all
 * the way through to a genuine backdrop click, closing the gallery on what
 * was meant as an interaction with the caption/video area, not "click
 * outside to close." `pointer-events: none` is exactly what removes the
 * caption from `composedPath()` in the first place, so this can't be fixed
 * by adding `.shoji-caption` to the selector above (already there — it
 * already protects a normal, non-click-through caption on a photo slide)
 * — checked by coordinates instead, the one place in this function that
 * has to be.
 */
function isBackdropClick(event: MouseEvent, caption: HTMLElement | null): boolean {
  const hitsProtectedElement = event
    .composedPath()
    .some(
      (node) =>
        node instanceof Element &&
        node.matches(
          `.shoji-slide-img, .shoji-video-mount, iframe, .shoji-counter, ${INTERACTIVE_CONTROL_SELECTOR}`,
        ),
    );
  if (hitsProtectedElement) return false;

  if (caption && !caption.hidden && caption.classList.contains('shoji-caption--video')) {
    const rect = caption.getBoundingClientRect();
    const withinCaption =
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom;
    if (withinCaption) return false;
  }

  return true;
}

function isDangerousHtmlCaption(value: unknown): value is DangerousHtmlCaption {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as DangerousHtmlCaption).dangerouslySetInnerHTML === 'string'
  );
}

/**
 * Core lifecycle (DESIGN.md §2.2), item model / DOM scanning (§2.1), and the
 * lightbox itself: pooled slides (§2.3), dialog semantics/focus trap/live
 * region (§2.6, non-optional), gestures (§2.4, via `GestureController`) and
 * slide-to-slide transitions (§2.5, via `SlideTransition`).
 */
export class Gallery {
  /** DESIGN.md §2.7 — the live instance mounted on `el`, or `undefined` if none exists there (or it's since been destroyed). */
  static getInstance(el: HTMLElement): Gallery | undefined {
    return instanceRegistry.get(el);
  }

  /** DESIGN.md §2.7 — every live instance, e.g. for page-wide teardown or devtools inspection. */
  static instances(): IterableIterator<Gallery> {
    return allInstances.values();
  }

  /** Not `readonly` — `reinit()` (§2.7) reassigns this + every option-derived field below; initializers here just satisfy strict-init. */
  options: GalleryOptions = {};
  readonly element: HTMLElement;

  private readonly bus = new EventBus<GalleryEvents>();
  private selector: string = DEFAULT_SELECTOR;
  private isDynamicMode = false;
  private preload = 1;
  private locale: typeof DEFAULT_LOCALE = DEFAULT_LOCALE;
  private showCounter = true;
  private captionVisibleOnVideo = false; // DESIGN.md §2.3a
  // DESIGN.md §2.5 — true from the moment transitionCaption()/open()'s own
  // fade-in starts hiding the caption until the midpoint (or, for open(),
  // the end) where content is swapped and it's revealed again. The async
  // image-load callback in renderCurrentSlide() checks this too, not just
  // the synchronous call in the same function — decode() resolves on a
  // microtask, which can beat the caption's own self-timed reveal for an
  // already-preloaded slide, and updating caption content the instant it
  // fires would show the *new* slide's caption fading, not the outgoing
  // one — same content-swap-timing bug either call site could cause alone.
  private captionFadePending = false;
  private loop = true;
  private closable = true;
  private autoHideDelay: number | false = 5000;
  /** DESIGN.md §3.1a — GalleryOptions.maxPinnedToolbarButtons; see measureToolbarOverflow(). */
  private maxPinnedToolbarButtons = 2;
  private readonly focusTrap = new FocusTrap();
  private readonly liveRegion = new LiveRegion();
  private autoHideTimer: ReturnType<typeof setTimeout> | null = null;
  private autoHidden = false;
  /**
   * Every control `wireControlHover()` has ever wired — the full candidate
   * list `reconcileHover()` (below) checks `:hover` against, kept separate
   * from `hoveringElements` (elements *believed* to be hovered) so
   * reconciliation can also *add* one currently missing from that set, not
   * just remove a stale one.
   */
  private readonly hoverableElements = new Set<HTMLElement>();
  /**
   * The subset of `hoverableElements` the pointer is currently considered
   * to be over — a `Set`, not a plain incrementing counter, so
   * `onActivity()` (below) can reconcile it against the browser's own live
   * `:hover` ground truth on every real pointer movement, self-healing from
   * a `pointerenter`/`pointerleave` pair that never fired at all. Two real
   * bugs, both reported from real usage, both variations on the same
   * browser behavior already leveraged elsewhere in this file (`hidden`
   * doesn't fire `pointerleave` under a stationary cursor, §2.3a): (1) a
   * control that synchronously replaces its own children while the pointer
   * sits stationary over it (Autoplay's own play/pause icon swap) can
   * desync the browser's internal hover-chain tracking badly enough that
   * the *next* real pointer movement away from it never fires `pointerleave`
   * — a plain counter has no way to detect a leave that never reports
   * itself. (2) the mirror image: a control that *appears* under an
   * already-stationary cursor (the common case right after `open()` —
   * whatever the viewer clicked to get here is often right where a
   * toolbar/caption/nav control ends up) never gets a `pointerenter`
   * either, since browsers only recompute hover state on actual pointer
   * movement, not on an element materializing under one already sitting
   * still — so idle auto-hide could fire and hide a control the viewer's
   * cursor is, visibly, still resting directly on top of. Re-deriving "is
   * this actually hovered" fresh from the browser on every real pointer
   * move fixes both directions at once, since neither depends on any
   * event having fired correctly in the first place.
   */
  private readonly hoveringElements = new Set<HTMLElement>();
  private isClosing = false;
  /** True while a vertical drag has hidden controls past its own distance threshold (`setControlsHiddenForDrag`) — `onActivity()` defers to it, since the drag's own continuous pointermove stream would otherwise immediately re-reveal what it just hid on every single move. */
  private controlsHiddenByDrag = false;
  private itemList: GalleryItem[] = [];
  private scannedElements: HTMLElement[] = [];
  private activeIndex = 0;
  private opened = false;
  private destroyed = false;
  private slides: SlideManager | null = null;
  private dom: LightboxDom | null = null;
  private gesture: GestureController | null = null;
  private transition: SlideTransition | null = null;
  /** DESIGN.md §2.3a — measures `.shoji-toolbar`'s real rendered height (it can wrap to multiple rows on a narrow viewport with many toolbar buttons registered) so the caption's own height cap can reserve exactly that much space, not a fixed single-row guess. */
  private toolbarHeightObserver: ResizeObserver | null = null;
  private toolbarHeightFrame: number | null = null;
  private captionTruncationFrame: number | null = null;
  /** DESIGN.md §2.3a — a truncated caption's own click/Enter/Space target opens this; also gates `GestureController`'s `isZoomed` (alongside the real zoom gate) so a drag over the open modal can't also navigate/close the lightbox underneath it. */
  private captionModalOpen = false;
  private captionModalReturnFocus: HTMLElement | null = null;
  /**
   * DESIGN.md §2.3a — every real path into `openCaptionModal()` starts from
   * a click *or* a keydown on the caption, so `captionModalReturnFocus`
   * above is always the caption itself either way; this instead
   * distinguishes *how* it got there, so `closeCaptionModal()` only
   * actually calls `.focus()` for the keyboard path (a real Tab+Enter user,
   * where restoring focus continues their tab sequence correctly) and
   * leaves it alone for a mouse click (where the resulting focus was
   * purely incidental — nothing about clicking to read a caption means the
   * *next* keypress, e.g. a plugin's own Space shortcut, should still
   * silently target it).
   */
  private captionModalOpenedViaKeyboard = false;
  /**
   * DESIGN.md §3.1a — every `ctx.ui.toolbar()`-registered button, in
   * registration order, alongside the slot it was registered into (so a
   * collapsed one can be restored to the right place, not just anywhere).
   * Registration order is what decides overflow priority: up to
   * `maxPinnedToolbarButtons` stay pinned, the rest collapse into the
   * popover before them, latest-registered first — see
   * `measureToolbarOverflow()`.
   */
  private readonly pluginToolbarButtons: Array<{
    el: HTMLElement;
    slot: 'left' | 'center' | 'right';
  }> = [];
  private toolbarOverflowOpen = false;
  private toolbarOverflowReturnFocus: HTMLElement | null = null;
  private readonly shortcuts = new Map<string, (e: KeyboardEvent) => void>();
  private readonly pluginStorage = new Map<string, unknown>();
  /** Backs `getActivePlugins()`. */
  private readonly activePluginNames = new Set<string>();
  private readonly videoProviders = new Map<string, VideoProviderRenderer>();
  private zoomGate: (() => boolean) | null = null;
  /** DESIGN.md §2.6a/§4.6 — the zoomed `<img>`'s own real on-screen rect, read by `beginClose()` before `beforeClose` fires (see `registerZoomStartProvider()`), so a button-close continues the zoom-out from wherever the viewer was actually zoomed/panned to instead of snapping back to neutral first. */
  private zoomStartProvider: (() => Box | null) | null = null;
  /** DESIGN.md §2.5/§4.5 — plugins with a per-slide visual override (RotateFlip's rotate/flip, Zoom's scale/pan) that reset unanimated on `beforeSlide` (must clear before `SlideManager.render()` reparents the outgoing node). Multi-slot: more than one can be active on the same slide, each targeting a different part of the clone, so they don't conflict. See `registerSlideLeaveDecorator()`. */
  private readonly slideLeaveDecorators = new Set<
    (clonedMedia: HTMLElement) => (() => void) | void
  >();
  private pluginCleanups: Array<() => void> = [];

  private readonly onContainerClick = (event: MouseEvent): void => {
    let node = event.target as Node | null;
    while (node && node !== this.element) {
      if (node instanceof HTMLElement) {
        const index = this.scannedElements.indexOf(node);
        if (index !== -1) {
          event.preventDefault();
          this.open(index);
          return;
        }
      }
      node = node.parentNode;
    }
  };

  private readonly onOuterClick = (event: MouseEvent): void => {
    if (this.closable && isBackdropClick(event, this.dom?.caption ?? null)) this.close();
  };

  /**
   * DESIGN.md §2.8 — any interaction re-shows controls, restarts the idle
   * clock. `autoHideDelay: 0` = "never show controls" — a no-op here.
   * `autoHideDelay: false` = "always visible" — also a no-op: nothing to
   * reveal (already shown) or reschedule (no timer ever runs). Also a no-op
   * once `isClosing` — a real bug, reported from real usage: moving the
   * mouse during close()'s own controls-fade-then-zoom-out sequence (§2.6a)
   * re-showed the just-hidden controls mid-animation, since these listeners
   * stay wired for the whole close sequence. Same reasoning for
   * `controlsHiddenByDrag` (§2.4/§2.8): a vertical drag's own `pointermove`
   * stream would otherwise re-reveal what it just hid, every single frame.
   */
  private readonly onActivity = (): void => {
    this.reconcileHover();
    if (
      this.autoHideDelay === 0 ||
      this.autoHideDelay === false ||
      this.isClosing ||
      this.controlsHiddenByDrag ||
      // DESIGN.md §2.3a — requested directly: mouse movement/interaction
      // over the open caption modal shouldn't re-reveal controls already
      // hidden behind it — `dom.outer`'s own pointermove/pointerdown/etc.
      // listeners (below) still see it bubble through, same as any other
      // activity, so without this an idle-hidden toolbar would pop back
      // the instant the viewer so much as moved the mouse to read.
      this.captionModalOpen
    )
      return;
    this.showControls();
    this.scheduleAutoHide();
  };

  /** x */
  private controlsHiddenAtGestureStart = false;
  private readonly captureGestureStartState = (): void => {
    this.controlsHiddenAtGestureStart = this.autoHidden;
  };

  /**
   * A real mobile bug (DESIGN.md §2.6a): after scrolling far enough to
   * collapse a mobile browser's own URL bar, `window.innerHeight` grows
   * but `.shoji-outer`'s painted size didn't follow, off-centering the
   * photo. `visualViewport.height` reflects the true visible area;
   * `window`'s `resize` is the fallback where it's unsupported.
   */
  private readonly syncViewportHeight = (): void => {
    if (!this.dom) return;
    const height = window.visualViewport?.height ?? window.innerHeight;
    this.dom.outer.style.height = `${height}px`;
  };

  private readonly onKeydown = (event: KeyboardEvent): void => {
    // A focused <video>'s native controls own arrow/space/home/end for
    // seeking, volume, and play/pause — don't let slide navigation hijack
    // those while the viewer is actually interacting with the video. Escape
    // still closes the gallery regardless.
    if (document.activeElement instanceof HTMLVideoElement && event.key !== 'Escape') return;

    this.onActivity();
    switch (event.key) {
      case 'Escape':
        if (this.closable) this.close();
        break;
      case 'ArrowLeft':
      case 'a':
      case 'A':
        this.prev();
        break;
      case 'ArrowRight':
      case 'd':
      case 'D':
        this.next();
        break;
      case 'Home':
        this.goTo(0);
        break;
      case 'End':
        this.goTo(this.itemList.length - 1);
        break;
      default: {
        // DESIGN.md §3 — ctx.ui.registerShortcut(); unhandled keys still
        // fall through with no preventDefault, same as before plugins existed.
        const shortcut = this.shortcuts.get(event.key);
        if (!shortcut) return;
        shortcut(event);
      }
    }
    event.preventDefault();
  };

  /**
   * DESIGN.md §2.3a — capture phase, added only while the caption modal is
   * open (not from `open()` onward like `onKeydown`, which is bubble
   * phase): capture always finishes before bubble starts, so
   * `stopPropagation()` here reliably beats `onKeydown`'s own bubble-phase
   * handling regardless of where in the dialog focus happens to be. A real
   * bug, reported from real usage: an earlier version of this only special-
   * cased `Escape`, leaving every other key (`Space` — Autoplay's own
   * play/pause shortcut if that plugin's loaded, arrow keys, `w`/`s` for
   * Zoom, any plugin-registered shortcut) to fall straight through to
   * `onKeydown` while the modal sat open on screen. A modal dialog should
   * make the background fully inert to keyboard input while it's open, not
   * just for one key — so this now stops propagation for *every* key
   * unconditionally, closing the modal as the one piece of extra behavior
   * layered on top for `Escape` specifically. Deliberately no
   * `preventDefault()` here — the modal's own contents (the close button,
   * a scrollable panel) keep their normal native key behavior (Space
   * activating a focused button, arrow/Space scrolling), only the
   * *background* gallery is what this isolates it from.
   */
  private readonly onCaptionModalKeydown = (event: KeyboardEvent): void => {
    event.stopPropagation();
    if (event.key === 'Escape') this.closeCaptionModal();
  };

  constructor(target: HTMLElement | string, options: GalleryOptions = {}) {
    this.element = resolveElement(target);
    instanceRegistry.set(this.element, this);
    allInstances.add(this);
    this.applyOptions(options);
  }

  /** Everything the constructor does after `this.element` is resolved — shared with `reinit()` (§2.7). */
  private applyOptions(options: GalleryOptions): void {
    this.options = options;
    this.selector = options.selector ?? DEFAULT_SELECTOR;
    this.isDynamicMode = options.items !== undefined;
    this.preload = options.preload ?? 1;
    this.locale = { ...DEFAULT_LOCALE, ...options.locale };
    this.showCounter = options.counter ?? true;
    this.loop = options.loop ?? true;
    this.closable = options.closable ?? true;
    this.autoHideDelay = options.autoHideDelay ?? 5000;
    this.maxPinnedToolbarButtons = options.maxPinnedToolbarButtons ?? 2;
    // Reset explicitly — a reinit() call must not inherit these from before.
    this.activeIndex = 0;
    this.scannedElements = [];

    if (this.isDynamicMode) {
      this.itemList = resolveDynamicVideoItems(options.items ?? []);
    } else {
      const scanned = scanContainer(this.element, this.selector);
      this.itemList = scanned.map((s) => s.item);
      this.scannedElements = scanned.map((s) => s.element);
      this.element.addEventListener('click', this.onContainerClick);
    }

    // DESIGN.md §3.1 — plugins init here, at construction, not lazily on
    // first open(): a layout plugin needs to render the *inline* container
    // (this.element, always available) before open() is ever called — it's
    // what the viewer clicks to open in the first place. ensureLightbox()'s
    // `if (this.dom) return;` guard makes the later, harmless no-op call
    // from open() safe; building the (hidden, display:none until opened)
    // lightbox DOM this early costs one inert subtree per instance, which is
    // negligible next to the thumbnail images already loading regardless.
    this.ensureLightbox();
    // Set after ensureLightbox() (not inside it) so a reinit() with a
    // different `closable` value updates the already-built button too —
    // ensureLightbox() only builds the DOM once (`if (this.dom) return;`).
    this.dom!.closeButton.hidden = !this.closable;

    // Default is closed — the host clicks a thumbnail or calls open()
    // itself. openOnInit is the explicit, opt-in exception (deep-link-style
    // integrations); guarded on having at least one item so an empty
    // gallery can't "open" onto nothing.
    if (options.openOnInit && this.itemList.length > 0) {
      this.open(options.index ?? 0);
    }
  }

  get items(): readonly GalleryItem[] {
    return this.itemList;
  }

  get currentIndex(): number {
    return this.activeIndex;
  }

  /** True from the first `open()` until `close()`/`destroy()`. */
  get isOpen(): boolean {
    return this.opened;
  }

  /** True once `destroy()` has run. */
  get isDestroyed(): boolean {
    return this.destroyed;
  }

  /** Whether auto-hide (§2.8) currently has controls faded. */
  get controlsHidden(): boolean {
    return this.autoHidden;
  }

  /** Names of plugins that actually initialized. */
  getActivePlugins(): string[] {
    return [...this.activePluginNames];
  }

  /** The active slide's `.shoji-slide-media` container. Empty before the first `open()`; `null` only after `destroy()`. */
  getActiveMedia(): HTMLElement | null {
    return this.slides?.getActiveMedia() ?? null;
  }

  /** DESIGN.md §4-zoom — suspends drag-to-navigate/close while zoomed. Single slot, not a multi-subscriber event. */
  registerZoomGate(isZoomed: () => boolean): () => void {
    this.zoomGate = isZoomed;
    return () => {
      if (this.zoomGate === isZoomed) this.zoomGate = null;
    };
  }

  /** DESIGN.md §2.6a/§4.6 — returns the zoomed image's current on-screen rect (`getBoundingClientRect()`), or `null` when not zoomed. Single slot, same pattern as `registerZoomGate` above. */
  registerZoomStartProvider(provider: () => Box | null): () => void {
    this.zoomStartProvider = provider;
    return () => {
      if (this.zoomStartProvider === provider) this.zoomStartProvider = null;
    };
  }

  /**
   * DESIGN.md §2.5/§4.5 — called once per navigation with the leave-
   * ghost's clone, right after `SlideTransition` creates it. Freeze
   * whatever per-slide visual state is about to be reset onto the clone
   * (or a descendant, e.g. Zoom's own `<img>`) and return a `() => void`
   * to trigger the transition back to neutral once committed — or return
   * nothing if there's nothing to animate away this time.
   */
  registerSlideLeaveDecorator(
    decorator: (clonedMedia: HTMLElement) => (() => void) | void,
  ): () => void {
    this.slideLeaveDecorators.add(decorator);
    return () => {
      this.slideLeaveDecorators.delete(decorator);
    };
  }

  on<K extends keyof GalleryEvents>(event: K, fn: (detail: GalleryEvents[K]) => void): Unsubscribe {
    return this.bus.on(event, fn);
  }

  private clampToRange(index: number): number {
    return Math.min(Math.max(index, 0), Math.max(this.itemList.length - 1, 0));
  }

  private ensureLightbox(): void {
    if (this.dom) return;
    this.slides = new SlideManager({
      preload: this.preload,
      videoProviders: this.videoProviders,
    });
    this.transition = new SlideTransition(this.slides, (clonedMedia) => {
      const settlers: Array<() => void> = [];
      for (const decorate of this.slideLeaveDecorators) {
        const settle = decorate(clonedMedia);
        if (settle) settlers.push(settle);
      }
      return () => {
        for (const settle of settlers) settle();
      };
    });
    const dom = buildLightboxDom(this.slides.element, this.locale);
    this.dom = dom;
    if (this.options.backdropOpacity != null) {
      const clamped = Math.min(Math.max(this.options.backdropOpacity, 0), 1);
      dom.outer.style.setProperty('--shoji-backdrop-opacity', String(clamped));
    }
    if (this.options.transitionDuration != null) {
      const clamped = Math.max(this.options.transitionDuration, 0);
      dom.outer.style.setProperty('--shoji-duration', `${clamped}ms`);
    }
    // DESIGN.md §2.8 — autoHideDelay: 0 means Shoji's own controls stay
    // permanently invisible (a host building fully custom chrome), not that
    // the whole gallery should behave like nothing is there — the mouse
    // cursor itself should still behave normally, not force-hidden along
    // with controls that were never meant to be seen in the first place.
    // Requested directly; `.shoji-cursor-visible` overrides the
    // `.shoji-controls-hidden` cursor:none rule via higher specificity.
    if (this.autoHideDelay === 0) dom.dialog.classList.add('shoji-cursor-visible');
    dom.outer.appendChild(this.liveRegion.element);
    dom.closeButton.addEventListener('click', () => this.close());
    dom.prevButton.addEventListener('click', () => this.prev());
    dom.nextButton.addEventListener('click', () => this.next());
    dom.captionToggleButton.addEventListener('click', () => {
      this.captionVisibleOnVideo = !this.captionVisibleOnVideo;
      this.updateCaptionVisibility();
    });
    dom.caption.addEventListener('click', this.onCaptionActivate);
    dom.caption.addEventListener('keydown', this.onCaptionActivate);
    dom.captionModalCloseButton.addEventListener('click', () => this.closeCaptionModal());
    // Closes on a genuine backdrop click (the modal element itself, not a
    // descendant) — always stops propagation regardless, since without it
    // *any* click anywhere inside the modal (the panel, its content, even
    // the close button) would keep bubbling up to onOuterClick below and
    // get misread as "clicked outside the real content," closing the whole
    // lightbox out from under it.
    dom.captionModal.addEventListener('click', (event) => {
      event.stopPropagation();
      if (event.target === dom.captionModal) this.closeCaptionModal();
    });
    dom.toolbarOverflowButton.addEventListener('click', (event) => {
      event.stopPropagation();
      this.toggleToolbarOverflow();
    });
    // Closes on any click outside the panel and off the caret itself —
    // registered ahead of onOuterClick below (same-node listeners run in
    // registration order) so it can stop the click there too, the same
    // reasoning the caption modal's own backdrop-click listener above uses:
    // without it, a click that closes the popover would also keep bubbling
    // and get misread by onOuterClick as "clicked outside the real
    // content," closing the whole lightbox in the same click.
    dom.outer.addEventListener('click', (event) => {
      if (!this.toolbarOverflowOpen) return;
      // event.composedPath(), not event.target — a real bug, found testing
      // this against Autoplay's own play/pause button (icon-swap-on-click,
      // same class of button CLAUDE.md/DESIGN.md §2.8 already documents):
      // if the click's own handler replaces the button's innerHTML
      // synchronously (as that pattern does), `event.target` can already be
      // a now-detached node by the time this bubble-phase listener runs —
      // `.contains(target)` then reads false even though the click
      // genuinely originated inside the panel, and the popover (wrongly)
      // closes out from under the very button that was just clicked.
      // composedPath() is captured at dispatch time, before any such
      // mutation, so it stays accurate regardless.
      const insidePanel = event
        .composedPath()
        .some((node) => node === dom.toolbarOverflowPanel || node === dom.toolbarOverflowButton);
      if (insidePanel) return;
      event.stopPropagation();
      this.closeToolbarOverflow();
    });
    dom.outer.addEventListener('click', this.onOuterClick);
    dom.outer.addEventListener('pointermove', this.onActivity, { passive: true });
    // Registered before onActivity's own pointerdown listener — order matters, see captureGestureStartState's doc comment.
    dom.outer.addEventListener('pointerdown', this.captureGestureStartState, { passive: true });
    dom.outer.addEventListener('pointerdown', this.onActivity, { passive: true });
    dom.outer.addEventListener('touchstart', this.onActivity, { passive: true });
    dom.outer.addEventListener('wheel', this.onActivity, { passive: true });
    dom.outer.addEventListener('focusin', this.onActivity);
    dom.outer.addEventListener('focusout', () => this.scheduleAutoHide());

    // Hovering pauses auto-hide (pointermove alone wouldn't catch a still
    // mouse) — every part of the overlay, not just individual buttons
    // (toolbarLeft/Center/Right cover the bar's own padding/gaps too, not
    // just the buttons already nested inside them). Plugin toolbar
    // buttons/overlays get this wiring at their own call sites.
    for (const el of [
      dom.closeButton,
      dom.prevButton,
      dom.nextButton,
      dom.captionToggleButton,
      dom.caption,
      dom.captionModalPanel,
      dom.counter,
      dom.toolbarLeft,
      dom.toolbarCenter,
      dom.toolbarRight,
    ]) {
      this.wireControlHover(el);
    }

    document.body.appendChild(dom.outer);

    // DESIGN.md §2.3a — a fixed single-row assumption undercounted a busy
    // toolbar (many plugins registering buttons) wrapping to multiple rows
    // on a narrow viewport, letting the caption's own height cap grow up
    // over the real controls instead of stopping below them. Measuring the
    // real rendered height instead of guessing is correct regardless of
    // plugin count or viewport width. rAF-batched, same pattern the Layout
    // plugin's own resize handling already uses (CLAUDE.md: batch DOM
    // writes that can thrash layout).
    this.toolbarHeightObserver = new ResizeObserver(() => this.scheduleToolbarOverflowMeasure());
    this.toolbarHeightObserver.observe(dom.toolbar);

    // DESIGN.md §2.4 — attached to the whole dialog (not just .shoji-slides)
    // so vertical swipe-to-close works from anywhere in it, not only over
    // the image; shouldIgnoreGesture() excludes real controls so their
    // native click/touch behavior is unaffected.
    this.gesture = new GestureController(
      {
        dialog: dom.dialog,
        caption: dom.caption,
        slides: this.slides,
        canGoNext: () => this.loop || this.activeIndex < this.itemList.length - 1,
        canGoPrev: () => this.loop || this.activeIndex > 0,
        // animate:false — a completed swipe already played its own
        // live-drag/settle animation (§2.4); running the §2.5 `mode`
        // transition on top would double-animate. See navigate()'s doc.
        next: () => this.navigate(this.nextIndex(), 1, false),
        prev: () => this.navigate(this.prevIndex(), -1, false),
        close: () => this.close(),
        closeFromSwipe: (frozenDrag) => this.closeFromSwipe(frozenDrag),
        setControlsHiddenForDrag: (hidden) => this.setControlsHiddenForDrag(hidden),
        canClose: () => this.closable,
        onActivity: () => this.onActivity(),
        // DESIGN.md §2.3a — also suspends drag-to-navigate/close while the
        // caption modal is open, same mechanism the Zoom plugin's own gate
        // already uses, so a drag starting over the modal can't also
        // navigate/close the lightbox underneath it.
        isZoomed: () =>
          (this.zoomGate?.() ?? false) || this.captionModalOpen || this.toolbarOverflowOpen,
      },
      {
        onTap: (x, y) =>
          this.bus.emit('tap', {
            x,
            y,
            controlsWereHidden: this.controlsHiddenAtGestureStart,
          }),
        onDoubleTap: (x, y) => this.bus.emit('doubleTap', { x, y }),
        onPinchStart: (centerX, centerY) => this.bus.emit('pinchStart', { centerX, centerY }),
        onPinchMove: (scale, centerX, centerY) =>
          this.bus.emit('pinchMove', { scale, centerX, centerY }),
        onPinchEnd: () => this.bus.emit('pinchEnd', {}),
        onWheelZoom: (deltaScale, x, y) => this.bus.emit('wheelZoom', { deltaScale, x, y }),
      },
      this.options.gestures,
    );

    this.initPlugins();
  }

  /**
   * DESIGN.md §3 — which of `declared`'s plugins will actually load,
   * resolved as a fixed point rather than a single pass: start with every
   * *structurally* valid entry (a real object with an `init` function),
   * then repeatedly drop any whose `requires` points at a name no longer
   * in the set, until a full pass drops nothing. That repetition is what
   * makes a chain cascade correctly — if a plugin gets dropped because
   * *its* own requirement failed, anything requiring that plugin drops on
   * the very next pass, the same as if the original problem were its own.
   * A genuine mutual requirement (A needs B, B needs A, both otherwise
   * fine) never gets caught in this — each still finds the other present
   * whenever it's checked, so both stay valid. That's correct, not a
   * missed case: this only ever decides *whether* something loads, never
   * *when* — nothing here reorders execution, so two plugins depending on
   * each other creates no actual ordering conflict to detect in the first
   * place.
   */
  private resolveValidPluginNames(declared: readonly ShojiPlugin[]): Set<string> {
    const validNames = new Set<string>();
    for (const plugin of declared) {
      if (plugin && typeof plugin.init === 'function') validNames.add(plugin.name);
    }
    let changed = true;
    while (changed) {
      changed = false;
      for (const plugin of declared) {
        if (!plugin || typeof plugin.init !== 'function' || !validNames.has(plugin.name)) continue;
        const unmet = (plugin.requires ?? []).some((name) => !validNames.has(name));
        if (unmet) {
          validNames.delete(plugin.name);
          changed = true;
        }
      }
    }
    return validNames;
  }

  /**
   * DESIGN.md §3 — plugins init here, not the constructor. `requires` is
   * resolved against the *whole* declared `plugins` list up front, not
   * registration order — a real friction point, reported directly: a host
   * with a `requires` chain had to carefully order the array by hand, with
   * no actual reason to (nothing about *execution* order needs to match
   * declaration order for a name-presence check). `resolveValidPluginNames()`
   * decides who's actually going to load, independent of position; this
   * loop still runs — and every `ctx.ui.toolbar()` registration still
   * lands — in exactly the array's own order regardless, so toolbar/
   * collapse-priority order (also array-order-driven, DESIGN.md §3.1a)
   * is completely unaffected by this. Cleared up front so a `reinit()`
   * doesn't inherit names from before.
   */
  private initPlugins(): void {
    this.activePluginNames.clear();
    this.videoProviders.clear();
    const declared = this.options.plugins ?? [];
    const validNames = this.resolveValidPluginNames(declared);

    for (const plugin of declared) {
      // Guards a real, easy-to-hit host mistake: `plugins: [Shoji.SomePlugin]`
      // silently becomes `plugins: [undefined]` if the referenced static
      // (e.g. Shoji.Autoplay) doesn't actually exist yet — a stale dist
      // build predating that plugin's addition is the most common cause.
      // One bad entry shouldn't crash plugin init for every entry after it.
      if (!plugin || typeof plugin.init !== 'function') {
        console.error(
          'Shoji: skipping an invalid plugins[] entry (not a ShojiPlugin object):',
          plugin,
        );
        continue;
      }
      if (!validNames.has(plugin.name)) {
        const missing = (plugin.requires ?? []).filter((name) => !validNames.has(name));
        console.error(
          `Shoji: plugin "${plugin.name}" requires [${missing.join(', ')}], which failed to load (missing, invalid, or itself had an unmet requires) — skipping.`,
        );
        continue;
      }

      const pluginOptions: Record<string, unknown> = {
        ...plugin.defaults,
        ...(this.options[plugin.name] as Record<string, unknown> | undefined),
      };
      const ctx: PluginContext = {
        gallery: this,
        options: pluginOptions,
        on: this.on.bind(this),
        emit: (event, detail) => this.bus.emit(event, detail),
        ui: {
          toolbar: (slot, el) => this.pluginToolbar(slot, el),
          overlay: (el, layer) => this.pluginOverlay(el, layer),
          outer: () => this.dom!.outer,
          registerShortcut: (key, fn) => {
            this.shortcuts.set(key, fn);
            return () => this.shortcuts.delete(key);
          },
          registerVideoProvider: (name, render) => {
            this.videoProviders.set(name, render);
            return () => {
              if (this.videoProviders.get(name) === render) this.videoProviders.delete(name);
            };
          },
        },
        storage: {
          get: (key) => this.pluginStorage.get(key),
          set: (key, value) => {
            this.pluginStorage.set(key, value);
          },
        },
      };

      const cleanup = plugin.init(ctx);
      if (typeof cleanup === 'function') this.pluginCleanups.push(cleanup);
      this.activePluginNames.add(plugin.name);
    }
  }

  /**
   * DESIGN.md §3.1 — 'right' inserts immediately before the overflow caret
   * (DESIGN.md §3.1a — never after, and never after close either), so
   * close stays fixed absolute-rightmost, the caret sits just to its left,
   * and plugins cluster further left still, in registration order:
   * `plugins: [A, B, C]` reads A, B, C, caret, close. 'left'/'center' are
   * independent zones for a plugin that doesn't want to sit next to close.
   */
  private pluginToolbar(
    slot: 'left' | 'center' | 'right',
    el: HTMLElement | ButtonSpec,
  ): Unsubscribe {
    const dom = this.dom!;
    // buildToolbarButton() below already wires hover for ButtonSpec; a raw
    // element needs it here instead, once, not double-wired either way.
    const isRawElement = el instanceof HTMLElement;
    const node = isRawElement ? el : this.buildToolbarButton(el);
    const unhover = isRawElement ? this.wireControlHover(node) : null;
    if (slot === 'right') {
      dom.toolbarRight.insertBefore(node, dom.toolbarOverflowButton);
    } else {
      (slot === 'left' ? dom.toolbarLeft : dom.toolbarCenter).appendChild(node);
    }
    this.pluginToolbarButtons.push({ el: node, slot });
    this.scheduleToolbarOverflowMeasure();
    return () => {
      unhover?.();
      node.remove();
      const index = this.pluginToolbarButtons.findIndex((b) => b.el === node);
      if (index !== -1) this.pluginToolbarButtons.splice(index, 1);
      this.scheduleToolbarOverflowMeasure();
    };
  }

  private buildToolbarButton(spec: ButtonSpec): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'shoji-toolbar-button';
    if (spec.icon) {
      button.ariaLabel = button.title = spec.label;
      button.innerHTML = spec.icon;
    } else {
      button.textContent = spec.label;
    }
    button.addEventListener('click', spec.onClick);
    this.wireControlHover(button);
    return button;
  }

  /**
   * DESIGN.md §3.1a — coalesces both toolbar-overflow measurement and the
   * pre-existing `--shoji-toolbar-height` update into one rAF-batched pass
   * (CLAUDE.md: batch DOM writes that can thrash layout), triggered by the
   * toolbar's own `ResizeObserver` (width *or* height changes — a busy
   * toolbar wrapping counts as both) and by `pluginToolbar()` registering
   * or unregistering a button. Order matters: overflow collapse has to run
   * *before* the height read, so the height custom property reflects the
   * settled (ideally single-row, post-collapse) toolbar, not a momentarily
   * wrapped one the caption's own height cap would otherwise over-reserve
   * space for.
   */
  private scheduleToolbarOverflowMeasure(): void {
    if (this.toolbarHeightFrame !== null) return;
    this.toolbarHeightFrame = requestAnimationFrame(() => {
      this.toolbarHeightFrame = null;
      if (!this.dom) return;
      this.measureToolbarOverflow();
      this.dom.dialog.style.setProperty(
        '--shoji-toolbar-height',
        `${this.dom.toolbar.getBoundingClientRect().height}px`,
      );
    });
  }

  /**
   * DESIGN.md §3.1a — collapses plugin toolbar buttons into
   * `toolbarOverflowPanel` once they don't fit in one row, instead of
   * letting the toolbar wrap to a second/third one. Always restores every
   * plugin button to its own original slot first and recomputes from that
   * clean slate, rather than incrementally adjusting whatever the previous
   * pass left behind — the *set* of buttons and the viewport width can
   * both have changed since then, and a fresh, deterministic pass is both
   * simpler and self-correcting than trying to reason about a delta.
   *
   * "Fits in one row" is measured, not assumed: each slot's own rendered
   * height is compared against `closeButton`'s (always exactly one row
   * tall, always present) — a slot has wrapped if it's taller than that,
   * regardless of *which* slot a plugin happened to register into (the
   * three slots wrap independently, DESIGN.md §3.1a's own CSS notes).
   *
   * Collapses latest-registered first (DESIGN.md §3's own registration-
   * order-is-priority convention — `plugins: [A, B, C]` keeps A pinned
   * before B/C). `maxPinnedToolbarButtons` (default 2, see
   * `GalleryOptions.maxPinnedToolbarButtons`) is a ceiling, not a
   * guarantee: collapsing always goes down to at most that many pinned,
   * but keeps going *below* it — down to zero if it must — whenever even
   * that many still leaves a slot wrapped. `closeButton` and the counter
   * (`toolbarLeft`) must never wrap onto their own line, and `fitsOneRow()`
   * already checks every slot's height, not just `toolbarRight`'s, so a
   * wide counter or other left-slot content competing for the same row
   * pushes the pinned count down too, not just the right slot's own
   * button count. `closeButton`/`toolbarOverflowButton` themselves are
   * never candidates for collapse — everything else relocates into the
   * popover, which renders directly below that row.
   */
  private measureToolbarOverflow(): void {
    if (!this.dom) return;
    const dom = this.dom;
    for (const { el, slot } of this.pluginToolbarButtons) {
      if (slot === 'right') dom.toolbarRight.insertBefore(el, dom.toolbarOverflowButton);
      else (slot === 'left' ? dom.toolbarLeft : dom.toolbarCenter).appendChild(el);
    }
    dom.toolbarOverflowPanel.replaceChildren();
    dom.toolbarOverflowButton.hidden = true;
    if (this.toolbarOverflowOpen) this.closeToolbarOverflow();

    const rowHeight = dom.closeButton.getBoundingClientRect().height;
    const fitsOneRow = (): boolean =>
      [dom.toolbarLeft, dom.toolbarCenter, dom.toolbarRight].every(
        (slotEl) => slotEl.getBoundingClientRect().height <= rowHeight + 1,
      );

    if (fitsOneRow()) return;

    const pinnedCeiling = Math.min(this.maxPinnedToolbarButtons, this.pluginToolbarButtons.length);
    dom.toolbarOverflowButton.hidden = false;
    for (let i = this.pluginToolbarButtons.length - 1; i >= 0; i--) {
      // Below the ceiling, stop as soon as it fits; at/above it, keep
      // collapsing regardless of fit — the ceiling is enforced first, then
      // fit is what decides whether to go further still.
      if (i < pinnedCeiling && fitsOneRow()) break;
      // Collapsed latest-registered first (the decision above), but
      // inserted at the *front* of the panel each time — the panel should
      // read in the same left-to-right registration order the toolbar row
      // itself would have shown, not reversed just because that's the order
      // they were evaluated in.
      dom.toolbarOverflowPanel.insertBefore(
        this.pluginToolbarButtons[i]!.el,
        dom.toolbarOverflowPanel.firstChild,
      );
    }
  }

  private readonly onToolbarOverflowKeydown = (event: KeyboardEvent): void => {
    event.stopPropagation();
    if (event.key === 'Escape') this.closeToolbarOverflow();
  };

  private toggleToolbarOverflow(): void {
    if (this.toolbarOverflowOpen) this.closeToolbarOverflow();
    else this.openToolbarOverflow();
  }

  private openToolbarOverflow(): void {
    if (!this.dom || this.toolbarOverflowOpen) return;
    this.toolbarOverflowReturnFocus = document.activeElement as HTMLElement | null;
    this.dom.toolbarOverflowPanel.hidden = false;
    this.positionToolbarOverflowPanel();
    this.dom.toolbarOverflowButton.setAttribute('aria-expanded', 'true');
    this.toolbarOverflowOpen = true;
    this.focusTrap.retarget(this.dom.toolbarOverflowPanel);
    document.addEventListener('keydown', this.onToolbarOverflowKeydown, true);
  }

  /**
   * DESIGN.md §3.1a — the panel's `right` offset is set here, per open,
   * rather than as a fixed CSS value: the caret's own x-position isn't
   * fixed, it shifts with how many buttons are pinned ahead of it
   * (`maxPinnedToolbarButtons` is host-configurable, and can itself be
   * reduced further at measure time, DESIGN.md §3.1a), so a static
   * `right: var(--shoji-spacing-md)` only happened to line up with the
   * caret at one particular pinned-button count and viewport width. It
   * otherwise anchored to the toolbar/dialog's own right edge — under
   * `closeButton`, which sits to the right of the caret, not under the
   * caret that actually opens it.
   *
   * Aligns the panel's own *content* edge (inside its padding), not just
   * its border box, with the caret's right edge — the panel's grid pitch
   * (44px columns, `--shoji-spacing-sm` gaps, `.shoji-toolbar-overflow-
   * panel` in shoji.css) already matches the toolbar row's own button
   * size/gap, so subtracting the panel's own right padding here is what
   * makes the popover's icon columns actually line up with the toolbar
   * row's icons above them, not just the panel block sitting roughly
   * nearby.
   *
   * Also sets the grid's own column count to match the toolbar row's own
   * column count right now: however many buttons are *actually* still
   * pinned on `toolbarRight`, *plus the caret itself* — requested directly:
   * the popover should read as the same row of columns continuing
   * downward, caret included, not a fixed 3 columns regardless of how many
   * ended up pinned. At the default `maxPinnedToolbarButtons` (2), that's 2
   * pinned + the caret = 3 columns. Collapsed buttons beyond that count
   * still wrap onto further rows within it, same as before.
   *
   * **A real bug: "pinned" is counted from `this.pluginToolbarButtons`
   * (registered via `ctx.ui.toolbar()`), never by querying `toolbarRight`'s
   * DOM children.** The old filter (`toolbarRight.children`, excluding
   * `closeButton`/`toolbarOverflowButton` by identity, `!el.hidden`) broke
   * once a host appended an unrelated element straight into `toolbarRight`
   * — not a documented extension point, but nothing stops it. Reported from
   * real usage: a plugin's own loading spinner, toggled via `style.display`
   * rather than the `hidden` attribute, passed `!el.hidden` and got
   * miscounted as a pinned button, turning a 3-column popover into 4.
   * Counting from the registry instead is immune to this regardless of how
   * such an element manages its own visibility. `closeButton`/
   * `toolbarOverflowButton` were never in `pluginToolbarButtons`, so
   * excluding them by identity is no longer needed either.
   */
  private positionToolbarOverflowPanel(): void {
    if (!this.dom) return;
    const {
      dialog,
      toolbarOverflowButton,
      toolbarOverflowPanel,
      toolbarRight,
      captionToggleButton,
    } = this.dom;
    const dialogRight = dialog.getBoundingClientRect().right;
    const caretRight = toolbarOverflowButton.getBoundingClientRect().right;
    const paddingRight = parseFloat(getComputedStyle(toolbarOverflowPanel).paddingRight) || 0;
    const right = dialogRight - caretRight - paddingRight;
    toolbarOverflowPanel.style.right = `${Math.max(0, right)}px`;

    // A second real bug, reported from real usage on a video slide: still
    // over/undercounts, even immune to the DOM-parentage issue above.
    // Undercounts by not knowing about `captionToggleButton` at all — a
    // real, space-consuming, never-collapsible button that only exists on
    // video slides, added directly in dom.ts rather than through
    // `ctx.ui.toolbar()`, so it was never in `pluginToolbarButtons` to
    // begin with. Overcounts separately, in the other direction: a
    // registered button hidden for its own content reasons (e.g. Zoom's
    // zoomIn/zoomOut/actualSize buttons hiding themselves on video slides,
    // §4.6) still passes the parentage check — hidden means zero layout
    // size, so `measureToolbarOverflow()`'s collapse loop never needed to
    // move it into the panel, leaving it sitting in `toolbarRight`,
    // invisible but still counted as if it occupied a column. Both fixed
    // by also checking `!b.el.hidden`, and adding one more for
    // `captionToggleButton` whenever it's currently shown.
    const pinnedCount =
      this.pluginToolbarButtons.filter(
        (b) => b.slot === 'right' && b.el.parentElement === toolbarRight && !b.el.hidden,
      ).length + (captionToggleButton.hidden ? 0 : 1);
    const columnCount = pinnedCount + 1; // + the caret itself
    toolbarOverflowPanel.style.gridTemplateColumns = `repeat(${columnCount}, 44px)`;
  }

  private closeToolbarOverflow(): void {
    if (!this.dom || !this.toolbarOverflowOpen) return;
    document.removeEventListener('keydown', this.onToolbarOverflowKeydown, true);
    this.dom.toolbarOverflowPanel.hidden = true;
    this.dom.toolbarOverflowButton.setAttribute('aria-expanded', 'false');
    this.toolbarOverflowOpen = false;
    this.focusTrap.retarget(this.dom.dialog);
    this.toolbarOverflowReturnFocus?.focus({ preventScroll: true });
    this.toolbarOverflowReturnFocus = null;
  }

  private pluginOverlay(el: HTMLElement, layer?: number): Unsubscribe {
    if (layer !== undefined) el.style.zIndex = String(layer);
    this.dom!.dialog.appendChild(el);
    const unhover = this.wireControlHover(el);
    return () => {
      unhover();
      el.remove();
    };
  }

  /** DESIGN.md §2.8/§3 — pauses auto-hide while genuinely hovered: controls, caption, and any plugin overlay (`ctx.ui.overlay()`). Unsubscribe also corrects the set if removed mid-hover — a real risk for overlay content a plugin can toggle while the gallery stays open, unlike static buttons. */
  private wireControlHover(el: HTMLElement): Unsubscribe {
    this.hoverableElements.add(el);
    const onEnter = (): void => {
      this.hoveringElements.add(el);
      this.onActivity();
    };
    const onLeave = (): void => {
      if (!this.hoveringElements.delete(el)) return;
      this.scheduleAutoHide();
    };
    el.addEventListener('pointerenter', onEnter);
    el.addEventListener('pointerleave', onLeave);
    return () => {
      el.removeEventListener('pointerenter', onEnter);
      el.removeEventListener('pointerleave', onLeave);
      this.hoverableElements.delete(el);
      if (this.hoveringElements.delete(el)) this.scheduleAutoHide();
    };
  }

  /**
   * DESIGN.md §2.8 — paused only by a real *hover*. Used to also treat a
   * *focused* control as active via `document.activeElement`, but a click
   * leaves a `<button>` focused indefinitely, permanently blocking
   * `hideControls()`. Focus still counts as activity (`focusin` →
   * `onActivity()`), it just no longer blocks the eventual hide.
   */
  private isControlActive(): boolean {
    return this.hoveringElements.size > 0;
  }

  /**
   * Syncs `hoveringElements` to the browser's own live `:hover` truth for
   * every registered control — both directions, not just dropping a stale
   * entry: also picks up one that's genuinely hovered but never got a
   * `pointerenter` of its own (see `hoveringElements`'s own doc comment for
   * why either direction can happen). Whichever ends up true here is what
   * `isControlActive()` reads immediately after, in the same `onActivity()`
   * call — no separate reveal step needed for a newly-added element; that
   * call already does it for any activity, hover included. Cheap in
   * practice: `hoverableElements` is normally single digits, and `:hover`
   * matching is a native, already-computed browser check, not a
   * layout-triggering one.
   */
  private reconcileHover(): void {
    for (const el of this.hoverableElements) {
      if (el.matches(':hover')) this.hoveringElements.add(el);
      else this.hoveringElements.delete(el);
    }
  }

  /**
   * The thumbnail for `index` — what the zoom transition animates to/from,
   * and what `activeThumbnail` marks/scrolls-to. `data-shoji-id` is an
   * explicit opt-in that works in any mode (needed for dynamic mode, which
   * has no scanned DOM); checked first so it can override selector mode's
   * default `scannedElements[index]` too, e.g. to target an inner element.
   */
  getOriginElement(index: number): HTMLElement | null {
    const item = this.itemList[index];
    if (item?.id && typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
      const marked = document.querySelector<HTMLElement>(
        `[data-shoji-id="${CSS.escape(item.id)}"]`,
      );
      if (marked) return marked;
    }
    return this.scannedElements[index] ?? null;
  }

  /** Lets a plugin's background-page `scrollIntoView()` survive `close()`'s scroll restore, routed through this shared instance rather than importing `bodyScrollLock` directly — required for the standalone core+plugins distribution, where a direct import would get its own disconnected module copy (DESIGN.md §4.2/§10). Same reasoning `getOriginElement`/`getActiveMedia` were made public for. */
  markIntentionalScroll(): void {
    markIntentionalScrollInternal();
  }

  private scheduleAutoHide(): void {
    if (this.autoHideTimer !== null) {
      clearTimeout(this.autoHideTimer);
      this.autoHideTimer = null;
    }
    if (!this.opened) return;
    if (this.autoHideDelay === false) return; // always visible — no timer to arm
    if (this.autoHideDelay === 0) {
      this.hideControls(); // 0 = hidden immediately, no reveal — see onActivity
      return;
    }
    this.autoHideTimer = setTimeout(() => this.hideControls(), this.autoHideDelay);
  }

  /**
   * Forces the same fade §2.8's idle timer would eventually trigger —
   * public so a plugin can hide controls on its own trigger. Same
   * `isControlActive()` guard as the timer. Also a no-op under
   * `autoHideDelay: false` — a real bug, reported from real usage: Autoplay's
   * tap-to-toggle-chrome behavior called this directly and ignored `false`
   * entirely, since only the idle timer checked it. `false` has to hold for
   * every caller, not just the timer. `forceHideControls()`/
   * `setControlsHiddenForDrag()` (close, drag-to-close) deliberately don't
   * check this — direct user actions with their own feedback, not auto-hide.
   */
  hideControls(): void {
    // A real bug, reported from real usage: an idle timer already ticking
    // down before the caption modal opened isn't cancelled by opening it
    // (DESIGN.md §2.3a) — `onActivity()`'s own `captionModalOpen` guard
    // only stops a *new* timer being armed while it's open, it doesn't stop
    // one already in flight from firing. Left unguarded here, that timer
    // could still call this mid-read, and `.shoji-controls-hidden`'s own
    // `cursor: none` (shoji.css) applies to the whole dialog including the
    // modal's own backdrop/panel — the cursor visibly vanishing over text
    // the viewer is actively reading, not idling on.
    //
    // A real bug, found testing this cross-browser: `hoveringElements` is
    // normally kept in sync by `reconcileHover()` running inside
    // `onActivity()`, on every real pointer event — but that only helps if
    // one actually fires *after* the pointer reaches wherever it's really
    // ending up. Confirmed directly: some browser pointer-simulation paths
    // (reproduced consistently under Firefox automation, though nothing
    // rules out a genuine — if rarer — real-hardware equivalent) fire their
    // last bubbling pointer event mid-transition, before the browser's own
    // `:hover` state has caught up to the pointer's actual final position —
    // reconciling *then* just recorded the wrong, stale answer, and with no
    // further pointer event ever arriving, nothing was left to correct it
    // before this timer fired. A plain counter would have the identical gap
    // (whatever event it's trusted to fire is the same one that didn't).
    // Fixed by re-reconciling right here too, immediately before the
    // decision that actually depends on the answer being fresh — this is
    // the one moment `hoveringElements` being even briefly stale actually
    // matters, so it's also the one moment worth an extra, authoritative
    // check instead of trusting whatever the last activity event happened
    // to leave behind.
    this.reconcileHover();
    if (
      !this.dom ||
      this.autoHidden ||
      this.isControlActive() ||
      this.autoHideDelay === false ||
      this.captionModalOpen ||
      // DESIGN.md §3.1a — same reasoning as `captionModalOpen` immediately
      // above: an idle timer already ticking down before the toolbar
      // overflow popover opened isn't cancelled by opening it, and the
      // popover is anchored to (visually part of) the toolbar this would
      // hide out from under it.
      this.toolbarOverflowOpen
    )
      return;
    this.autoHidden = true;
    this.dom.dialog.classList.add('shoji-controls-hidden');
    this.bus.emit('controls:hide', {});
  }

  private showControls(): void {
    if (!this.dom || !this.autoHidden) return;
    this.autoHidden = false;
    this.dom.dialog.classList.remove('shoji-controls-hidden', 'shoji-controls-hidden-for-close');
    this.bus.emit('controls:show', {});
  }

  /**
   * DESIGN.md §2.1 — `caption` is `string | HTMLElement | DangerousHtmlCaption`:
   * a plain string renders as text (`textContent`, auto-escaped, safe by
   * default); an `HTMLElement` is appended as real DOM (the host built it);
   * `{ dangerouslySetInnerHTML }` renders raw, unescaped HTML via `innerHTML`
   * — Shoji does not sanitize it, the host must, same contract as React's
   * identically-named escape hatch. Returns whether the caption element
   * should be hidden.
   */
  private renderCaption(
    el: HTMLElement,
    caption: string | HTMLElement | DangerousHtmlCaption | undefined,
  ): boolean {
    if (caption instanceof HTMLElement) {
      el.replaceChildren(caption);
      return false;
    }
    if (isDangerousHtmlCaption(caption)) {
      el.innerHTML = caption.dangerouslySetInnerHTML;
      return caption.dangerouslySetInnerHTML === '';
    }
    el.textContent = caption ?? '';
    return !caption;
  }

  /**
   * `.shoji-toolbar-button` only — never `.shoji-close`/`.shoji-nav`, which
   * are different classes entirely, so this can't accidentally block
   * closing or navigating away from a slow-loading slide. `tabIndex = -1`
   * (not just the CSS below) so a keyboard user tabbing through the
   * toolbar skips these entirely while disabled, not just visually dims
   * them — `pointer-events: none` alone wouldn't stop Enter/Space
   * activating an already-focused button.
   */
  private setSlideLoading(loading: boolean): void {
    if (!this.dom) return;
    this.dom.outer.classList.toggle('shoji-slide-loading', loading);
    for (const button of this.dom.outer.querySelectorAll<HTMLButtonElement>(
      '.shoji-toolbar-button',
    )) {
      button.ariaDisabled = loading ? 'true' : null;
      if (loading) button.tabIndex = -1;
      else button.removeAttribute('tabindex');
    }
  }

  /**
   * DESIGN.md §2.5 — the caption's disappear-then-reappear fits inside the
   * *same* `--shoji-duration` window the slide's own mode animation runs
   * in, not a separate one after it: fades out over the first half, swaps
   * content invisibly at the midpoint, fades back in over the second half
   * — timed to finish exactly when the mode animation does, not still
   * catching up a beat behind it. Self-timed off the resolved
   * `--shoji-duration` value rather than hooked to the mode animation's
   * own completion event: both are driven by the same duration either way,
   * and the fade-in's own completion is what has to line up, which a
   * "start on completion, then animate" hook can't give — by definition,
   * a fade started only once something else finishes hasn't finished
   * *with* it.
   */
  private transitionCaption(): void {
    const dom = this.dom;
    if (!dom) return;
    if (
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      return; // --shoji-duration is already 0ms; nothing to sequence
    }

    // .shoji-caption's own `transition: opacity var(--shoji-duration) ...`
    // rule transitions a single property, so the computed shorthand
    // resolves to exactly --shoji-duration's own value — same read as
    // `zoomTransition.ts`/`SlideTransition.ts` already use elsewhere,
    // rather than `getPropertyValue('--shoji-duration')` directly.
    const raw = getComputedStyle(dom.caption).transitionDuration.split(',')[0]?.trim() ?? '';
    const fullMs = raw.endsWith('ms')
      ? parseFloat(raw)
      : raw.endsWith('s')
        ? parseFloat(raw) * 1000
        : 0;
    const half = fullMs / 2;

    this.captionFadePending = true;
    dom.caption.style.transitionDuration = `${half}ms`;
    dom.caption.style.opacity = '0';

    setTimeout(() => {
      if (!this.dom) return;
      this.captionFadePending = false;
      this.updateCaptionVisibility();
      this.dom.caption.style.opacity = '';
      setTimeout(() => {
        // Only the temporary half-duration override — restores the
        // caption's normal full-duration transition (e.g. for idle
        // auto-hide) once this fade-in has actually finished with it.
        if (this.dom) this.dom.caption.style.transitionDuration = '';
      }, half);
    }, half);
  }

  /**
   * Content is always kept current (correct the instant loading finishes,
   * no text flash) — only `hidden` also gates on `isActiveReady()`, so a
   * caption for the *new* slide can't sit there readable while the
   * image/video it describes is still a spinner.
   */
  private updateCaptionVisibility(): void {
    if (!this.dom || !this.slides) return;
    const item = this.itemList[this.activeIndex];
    const noCaption = this.renderCaption(this.dom.caption, item?.caption);
    const isVideo = !!item?.video;
    this.dom.caption.classList.toggle('shoji-caption--video', isVideo);
    const hiddenByToggle = isVideo && !this.captionVisibleOnVideo;
    this.dom.caption.hidden = noCaption || !this.slides.isActiveReady() || hiddenByToggle;

    const btn = this.dom.captionToggleButton;
    btn.hidden = !isVideo || noCaption;
    if (!btn.hidden) {
      btn.setAttribute('aria-pressed', String(this.captionVisibleOnVideo));
      btn.ariaLabel = btn.title = this.captionVisibleOnVideo
        ? this.locale.hideCaption
        : this.locale.showCaption;
    }
    this.updateCaptionTruncation();
    // A real bug, reported from real usage: reopening an already-loaded
    // slide (e.g. clicking the same thumbnail twice) skips the async
    // image-decode path entirely — nothing re-runs this measurement once
    // the dialog actually finishes laying out, so the synchronous call
    // above can catch it mid-layout (still effectively 0×0 at that exact
    // point, even though `hidden` itself is already correctly false) and
    // wrongly conclude nothing overflows. A fresh *first* open happens to
    // dodge this because real image decode work is slow enough that by the
    // time it resolves, layout has already settled — not something a
    // reopen (cached, near-instant) can rely on. Re-checking one frame
    // later, after layout has actually been committed, catches the case the
    // synchronous read above can miss without regressing it (the sync call
    // already got it right whenever it can, so this is a rarely-needed
    // correction, not a routine double-measurement).
    if (this.captionTruncationFrame !== null) cancelAnimationFrame(this.captionTruncationFrame);
    this.captionTruncationFrame = requestAnimationFrame(() => {
      this.captionTruncationFrame = null;
      this.updateCaptionTruncation();
    });
  }

  /**
   * DESIGN.md §2.3a — the caption's own default height cap (above) already
   * keeps it clear of the toolbar, but says nothing about the vertically-
   * centered prev/next nav arrows sharing its same left edge; a long
   * enough caption could still grow up over one of those. `--shoji-*`
   * collapses it to roughly one line by default (shoji.css) regardless, so
   * this only ever needs to detect whether that collapse actually clipped
   * something — `scrollHeight > clientHeight` after layout, the same
   * technique already used elsewhere in this codebase (and its own tests)
   * to detect caption overflow. Marks it truncated/interactive only when
   * there's genuinely more to read; a caption that already fits shouldn't
   * look or behave clickable.
   *
   * A real bug, reported from real usage: the first version only capped
   * `max-height` + `overflow: hidden` — a plain pixel clip with no regard
   * for where a line of text actually ends, so the cutoff routinely sliced
   * straight through the middle of the last visible line instead of
   * stopping at a clean line boundary, reading as broken rather than
   * intentionally truncated.
   *
   * Two follow-up attempts, both also wrong, both worth recording so they
   * aren't retried: `-webkit-line-clamp` never cleanly stopped at a line
   * boundary here regardless of the line count fed into it. Replacing it
   * with `lines * lineHeight + paddingY` arithmetic (using
   * `getComputedStyle(el).lineHeight`) still left a sliver of the next
   * line visible in a real browser — confirmed by screenshot, not just
   * this sandbox. Root cause: a browser doesn't necessarily lay out N
   * stacked lines at exactly N times the CSS `line-height` value: text
   * layout does its own sub-pixel rounding per line, so arithmetic
   * multiplication drifts from the real rendered geometry by enough to
   * expose part of an extra line, and no fixed safety margin is correct
   * for every font/zoom/line-count combination.
   *
   * This version doesn't compute line boundaries at all — it reads them
   * straight from the browser's own layout via `Range.getClientRects()`,
   * which returns one rect per actual rendered line fragment (rich
   * captions with inline markup can put more than one rect on the same
   * visual row; each is handled independently below rather than grouped,
   * since only the topmost/bottommost edges per row matter here). The cap
   * is set to the bottom edge of the last line whose bottom still fits
   * inside the current (arbitrary, CSS-calc'd) height budget — a real
   * measured boundary, never an assumed one.
   *
   * A third real bug, caught after switching to this measured approach:
   * padding the box out by a full `padding-bottom` past that last line's
   * *measured* bottom still isn't safe, because line boxes butt up much
   * closer together than the padding value — the next (excluded) line's
   * own top can fall well inside that padding band, so its glyph
   * ascenders paint into what was supposed to be empty breathing room.
   * Fixed by also finding that next line's top and never letting the cap
   * reach it, regardless of how much of `padding-bottom` that leaves.
   */
  private updateCaptionTruncation(): void {
    if (!this.dom) return;
    const el = this.dom.caption;
    el.style.removeProperty('max-height');
    const truncated = !el.hidden && el.scrollHeight > el.clientHeight;
    if (truncated) {
      const paddingBottom = parseFloat(getComputedStyle(el).paddingBottom) || 0;
      const budget = el.clientHeight - paddingBottom;
      const elTop = el.getBoundingClientRect().top;
      const range = document.createRange();
      range.selectNodeContents(el);
      let lastFittingBottom = 0;
      let nextLineTop = Infinity;
      for (const rect of range.getClientRects()) {
        if (rect.height === 0) continue;
        const relTop = rect.top - elTop;
        const relBottom = rect.bottom - elTop;
        if (relBottom <= budget) {
          if (relBottom > lastFittingBottom) lastFittingBottom = relBottom;
        } else if (relTop < nextLineTop) {
          nextLineTop = relTop;
        }
      }
      const cutBottom = lastFittingBottom > 0 ? lastFittingBottom : budget;
      const desired = cutBottom + paddingBottom;
      const cap = Number.isFinite(nextLineTop) ? Math.min(desired, nextLineTop) : desired;
      el.style.maxHeight = `${Math.max(0, Math.floor(cap) - 1)}px`;
    }
    el.classList.toggle('shoji-caption--truncated', truncated);
    if (truncated) {
      el.tabIndex = 0;
      el.setAttribute('role', 'button');
      el.setAttribute('aria-haspopup', 'dialog');
    } else {
      el.removeAttribute('tabindex');
      el.removeAttribute('role');
      el.removeAttribute('aria-haspopup');
      if (this.captionModalOpen) this.closeCaptionModal();
    }
  }

  private readonly onCaptionActivate = (event: Event): void => {
    if (!this.dom?.caption.classList.contains('shoji-caption--truncated')) return;
    this.captionModalOpenedViaKeyboard = event instanceof KeyboardEvent;
    if (event instanceof KeyboardEvent) {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      // A real bug, reported from real usage against Autoplay's
      // pauseOnCaptionExpand (§4.1 point 18): a *keyboard* activation here
      // (Tab+Enter/Space, the only path this branch actually runs for)
      // must not also bubble up to onKeydown's shortcut dispatch — this is
      // unambiguously "activate this control," not also a global shortcut
      // key, same reasoning the caption modal's own keydown handler
      // already uses to isolate itself from onKeydown. This alone doesn't
      // cover the click path below reopening on a *later*, unrelated
      // keypress — see `captionModalOpenedViaKeyboard`'s own doc comment
      // for that half of the fix.
      event.stopPropagation();
    } else {
      // A mouse-drag that ended in a real text selection is not a click to
      // open — `.shoji-caption` is deliberately excluded from drag-to-
      // navigate (GestureController's INTERACTIVE_CONTROL_SELECTOR) so the
      // viewer can select/copy caption text; without this check, finishing
      // that selection would also toggle the modal open on every drag.
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed) return;
      // A link/button inside a rich-HTML caption keeps its own click
      // behavior — this only opens the modal for a click on the caption
      // itself, not one that's actually aimed at interactive content
      // inside it.
      if (event.target instanceof Element && event.target.closest('a, button')) return;
    }
    this.openCaptionModal();
  };

  /**
   * DESIGN.md §2.3a — shows the full caption (re-rendered via the same
   * `renderCaption()` the truncated one already used, so a rich-HTML
   * caption's own links/formatting are identical in both places) in a
   * small nested dialog, scrollable if it's still taller than the
   * viewport allows. `FocusTrap.retarget()` narrows Tab-cycling to just
   * this modal without touching the outer trap's own focus-restore state
   * (see its own doc comment for why a second `FocusTrap` instance isn't
   * used instead). Requested directly: the modal *replaces* the truncated
   * caption rather than just visually sitting on top of it — hiding
   * `dom.caption` too, not only because the modal's own opaque backdrop
   * already covers it, but so it can't still be reached by a screen
   * reader's browse-mode cursor (unlike Tab, `FocusTrap`/`retarget()`
   * don't affect that) while a completely different dialog is the one
   * actually open.
   */
  private openCaptionModal(): void {
    if (!this.dom || this.captionModalOpen) return;
    const item = this.itemList[this.activeIndex];
    this.renderCaption(this.dom.captionModalContent, item?.caption);
    this.dom.captionModal.hidden = false;
    // Captured before hiding the caption below (a real bug, caught by e2e
    // regression: hiding the currently-focused caption blurs it immediately
    // — a hidden element can't hold focus — so reading `activeElement`
    // *after* that line ended up capturing wherever the browser's own
    // focus-loss fallback landed (the dialog), not the caption itself.
    // Escape/close-button/backdrop then "restored" focus to the dialog
    // instead of back to the caption that was actually focused when this
    // opened.
    this.captionModalReturnFocus = document.activeElement as HTMLElement | null;
    this.dom.caption.hidden = true;
    // A real bug, caught testing this: the click that opens the modal
    // typically leaves the pointer sitting right over the caption —
    // hiding it out from under a *stationary* cursor never fires the
    // `pointerleave` `wireControlHover()` needs to drop it from
    // `hoveringElements` (browsers only fire that on actual pointer
    // movement past an element's edge, not on the element disappearing).
    // `reconcileHover()` would eventually self-heal this on the next real
    // pointer move anyway, but nothing meaningful should still read as
    // "hovered" once the modal has taken over — clearing it immediately
    // here is more deterministic than waiting for that.
    this.hoveringElements.clear();
    this.captionModalOpen = true;
    this.focusTrap.retarget(this.dom.captionModalPanel);
    document.addEventListener('keydown', this.onCaptionModalKeydown, true);
    this.bus.emit('captionModalChange', { open: true });
  }

  /**
   * Requested directly: closing should leave the viewer looking at a fully
   * normal, fully visible gallery — not just the modal gone, but the
   * truncated caption back (via `updateCaptionVisibility()`, which
   * recomputes its real hidden state from scratch rather than blindly
   * flipping a flag back — the more robust "recompute from source of
   * truth" this codebase already prefers elsewhere) and any auto-hidden
   * toolbar/nav explicitly re-shown (`onActivity()`, same pairing every
   * other real interaction already uses) rather than left hidden until
   * the viewer happens to move the mouse.
   */
  private closeCaptionModal(): void {
    if (!this.dom || !this.captionModalOpen) return;
    document.removeEventListener('keydown', this.onCaptionModalKeydown, true);
    this.dom.captionModal.hidden = true;
    this.captionModalOpen = false;
    this.updateCaptionVisibility();
    this.focusTrap.retarget(this.dom.dialog);
    if (this.captionModalOpenedViaKeyboard) {
      this.captionModalReturnFocus?.focus({ preventScroll: true });
    }
    this.captionModalReturnFocus = null;
    this.captionModalOpenedViaKeyboard = false;
    this.onActivity();
    this.bus.emit('captionModalChange', { open: false });
  }

  private renderCurrentSlide(openPlaceholderSrc?: string): void {
    if (!this.slides || !this.dom) return;
    const dom = this.dom;
    this.slides.render(
      this.itemList,
      this.activeIndex,
      (loadedIndex) => {
        if (loadedIndex === this.activeIndex) {
          this.bus.emit('slideItemLoad', { index: loadedIndex });
          this.setSlideLoading(false);
          // captionFadePending: skip here too, not just the synchronous
          // call below — decode() resolves on a microtask, which can win
          // the race against the mode animation's own onComplete (the one
          // that's actually supposed to update it), especially for an
          // already-preloaded slide.
          if (!this.captionFadePending) this.updateCaptionVisibility();
        }
      },
      openPlaceholderSrc,
      this.loop,
    );
    this.setSlideLoading(!this.slides.isActiveReady());

    const item = this.itemList[this.activeIndex];
    const total = this.itemList.length;
    dom.counter.textContent = total > 0 ? `${this.activeIndex + 1} / ${total}` : '';
    dom.counter.hidden = !this.showCounter || total === 0;
    // navigate()'s animated path already faded the outgoing caption out
    // and updates content itself, once that fade (and the slide's own mode
    // transition) actually finishes — updating it here too, immediately,
    // would flash the new caption's text mid-fade instead of the outgoing
    // one.
    if (!this.captionFadePending) this.updateCaptionVisibility();
    const label = `Image ${this.activeIndex + 1} of ${total}${item?.alt ? `: ${item.alt}` : ''}`;
    this.liveRegion.announce(label);

    dom.prevButton.hidden = total <= 1;
    dom.nextButton.hidden = total <= 1;
    dom.prevButton.disabled = !this.loop && this.activeIndex <= 0;
    dom.nextButton.disabled = !this.loop && this.activeIndex >= total - 1;
  }

  open(index = this.options.index ?? 0): void {
    if (this.destroyed || this.opened) return;
    this.bus.emit('beforeOpen', { index });
    this.ensureLightbox();
    this.opened = true;
    this.activeIndex = index;
    this.captionVisibleOnVideo = !!this.options.showVideoCaption;
    lockBodyScroll();
    const origin = this.getOriginElement(index);
    // Both the open placeholder and the zoom-in animation below need a size
    // to show/grow toward before the real image has loaded — without
    // item.width/height, that size can only ever be guessed ("probably
    // fills the dialog"), which is exactly what visibly overshoots for a
    // genuinely small photo (§2.3/§2.3b's own real-bug history). Rather
    // than guess, skip both entirely when naturalSize is unknown: the
    // ordinary spinner shows, and the real image just appears once it's
    // ready — no animation of its own, deliberately (same "no second,
    // disconnected transition" reasoning the placeholder-to-real-image
    // handoff already uses elsewhere).
    const naturalSize = this.resolveNaturalSize(index);
    // The first slide's caption fades in alongside zoomIn() the same way a
    // navigated-to one fades in alongside the mode transition (§2.5) —
    // only when there's actually a zoom to sync with, same "no second,
    // disconnected transition" reasoning as the comment above: nothing
    // grows in from the thumbnail without known dimensions, so nothing
    // should fade in disconnected from that either.
    const fadeInOnOpen =
      !!(origin && naturalSize) &&
      !(
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches
      );
    if (fadeInOnOpen && this.dom) {
      this.captionFadePending = true;
      this.dom.caption.style.opacity = '0';
    }
    // A real bug/inconsistency: a video item *does* have a known naturalSize
    // (its aspect ratio), but the low-res placeholder this unlocks is a
    // dead end — it's a static photo, immediately replaced by something
    // entirely different (an error state, or the real embed), not the same
    // image sharpening the way a photo's placeholder-to-full-res handoff
    // is. That made a fresh open() inconsistent with navigating back to an
    // already-cached video slide (no placeholder shown there at all, since
    // navigate() never passes one) — same "no second, disconnected
    // transition" reasoning as the naturalSize-unknown case above, just
    // triggered by content type instead of missing dimensions.
    this.renderCurrentSlide(
      naturalSize && !this.itemList[index]?.video
        ? this.resolveOpenPlaceholderSrc(this.itemList[index], origin)
        : undefined,
    );
    this.dom!.outer.classList.add('shoji-open');
    this.syncViewportHeight();
    if (window.visualViewport)
      window.visualViewport.addEventListener('resize', this.syncViewportHeight);
    else window.addEventListener('resize', this.syncViewportHeight);
    document.addEventListener('keydown', this.onKeydown);
    this.focusTrap.activate(this.dom!.dialog);
    this.scheduleAutoHide();

    const media = this.slides?.getActiveMedia();
    if (media && origin && naturalSize) {
      zoomIn({
        origin,
        target: media,
        aspectRatio: this.resolveAspectRatio(index, origin),
        naturalSize,
      });
    }
    if (fadeInOnOpen && this.dom) {
      // No half-duration split here, unlike transitionCaption() — there's
      // no outgoing caption to fade out first, just this one fading in
      // from nothing, over the same full --shoji-duration zoomIn() itself
      // runs on.
      this.captionFadePending = false;
      this.updateCaptionVisibility();
      this.dom.caption.style.opacity = '';
    }

    this.bus.emit('open', { index });
    this.bus.emit('afterOpen', { index });
  }

  /** DESIGN.md §2.3 — low-res open() placeholder source, checked in order: item.thumb, a live data-shoji-thumb on origin, else origin's own rendered <img>. */
  private resolveOpenPlaceholderSrc(
    item: GalleryItem | undefined,
    origin: HTMLElement | null,
  ): string | undefined {
    if (item?.thumb) return item.thumb;
    const dataThumb = origin?.getAttribute('data-shoji-thumb');
    if (dataThumb) return dataThumb;
    const img = origin?.querySelector('img');
    return img?.currentSrc || img?.src || undefined;
  }

  /**
   * DESIGN.md §2.2/§2.6 — navigates while open; always clamps an explicit
   * out-of-range index (this is a directed jump, not a step — `loop` only
   * affects `next()`/`prev()`, see below). No-op if not open. `animate`
   * (default `true`) runs the configured §2.5 transition; hosts that want
   * an instant jump — e.g. syncing to an external index without a visual
   * flourish — can pass `{ animate: false }`.
   */
  goTo(index: number, options?: { animate?: boolean }): void {
    if (this.destroyed || !this.opened || this.itemList.length === 0) return;
    const target = this.clampToRange(index);
    if (target === this.activeIndex) return;
    const direction: 1 | -1 = target > this.activeIndex ? 1 : -1;
    this.navigate(target, direction, options?.animate ?? true);
  }

  next(): void {
    this.navigate(this.nextIndex(), 1, true);
  }

  prev(): void {
    this.navigate(this.prevIndex(), -1, true);
  }

  private nextIndex(): number {
    const atEnd = this.activeIndex >= this.itemList.length - 1;
    return atEnd && this.loop ? 0 : this.activeIndex + 1;
  }

  private prevIndex(): number {
    const atStart = this.activeIndex <= 0;
    return atStart && this.loop ? this.itemList.length - 1 : this.activeIndex - 1;
  }

  /**
   * DESIGN.md §2.5 — the shared path behind `goTo()`/`next()`/`prev()`.
   * `animate` is `false` only for `GestureController`'s own host callbacks
   * (see `ensureLightbox()`): a gesture-completed swipe already played its
   * own live-drag/settle animation, so running a *second*, `mode`-based
   * transition on top of it would visibly double-animate. Every other
   * caller — buttons, keyboard, autoplay, a plugin calling `goTo()` — gets
   * the real, configured transition.
   */
  private navigate(target: number, direction: 1 | -1, animate: boolean): void {
    if (this.destroyed || !this.opened || this.itemList.length === 0) return;
    const clamped = this.clampToRange(target);
    if (clamped === this.activeIndex) return;
    // DESIGN.md §2.3a — the modal shows a specific slide's caption; leaving
    // it open across a navigation (arrow keys reach it even while the
    // gesture gate above suspends drag-navigate) would keep showing the
    // outgoing slide's text over the new slide.
    if (this.captionModalOpen) this.closeCaptionModal();
    // DESIGN.md §3.1a — the popover's own position depends on the current
    // toolbar height, which can change slide-to-slide (e.g. a video slide's
    // caption-toggle button appearing/disappearing); simplest to just close
    // it rather than reposition it mid-navigation.
    if (this.toolbarOverflowOpen) this.closeToolbarOverflow();
    const from = this.activeIndex;
    // beforeSlide fires first so a listener (e.g. Autoplay) can detach its
    // own 'pause' listener from the outgoing video before pauseMedia() below
    // triggers a native 'pause' event on it — otherwise that listener is
    // still attached and misreads this programmatic pause as the viewer
    // manually pausing the video, a real regression this caused once
    // (advancing past a stuck video called next(), which paused it here,
    // which the still-attached listener treated as a manual pause and
    // stopped the whole slideshow before the new slide's afterSlide handler
    // ever got a chance to run). activeIndex hasn't changed yet at this
    // point, so getActiveMedia() still resolves to the outgoing slide either
    // way — only the listener-detach ordering relative to pauseMedia matters.
    this.bus.emit('beforeSlide', { from, to: clamped });
    // A video started by the viewer keeps playing otherwise — this slide
    // stays cached (still within `preload`), and only pausing (not
    // releasing) lets it resume right where it left off if revisited.
    pauseMedia(this.slides?.getActiveMedia() ?? null);
    this.activeIndex = clamped;

    if (animate && this.transition) {
      // Not layered onto a gesture-completed swipe (the `else` branch) —
      // same scoping as the mode transition itself (§2.4/§2.5).
      this.transitionCaption();
      const swap = (): void => this.renderCurrentSlide();
      const modeName = this.resolveTransitionMode();
      const builtin = TRANSITION_PRESETS[modeName];
      if (builtin) {
        this.transition.animate(builtin, direction, swap);
      } else {
        this.transition.animateCustom(modeName, direction, swap);
      }
    } else {
      const swap = (): void => this.renderCurrentSlide();
      swap();
    }

    this.bus.emit('afterSlide', { from, to: clamped });
  }

  private resolveTransitionMode(): string {
    return this.options.mode ?? 'slide';
  }

  close(): void {
    this.beginClose();
  }

  /**
   * DESIGN.md §2.4/§2.6a — same effect as `close()`, from a completed
   * vertical swipe. `frozenDrag` is threaded through to `zoomOut()`'s own
   * `dragStart`, so the whole close continues as one motion from exactly
   * where the drag left off (see `GestureController.
   * takeFrozenDragTransform`).
   */
  private closeFromSwipe(frozenDrag: FrozenDragTransform): void {
    this.beginClose(frozenDrag);
  }

  /**
   * `frozenDrag` — see `closeFromSwipe()`'s doc comment; absent for a
   * button-close, which has no drag to continue from. Controls fade and the
   * zoom-out run concurrently, both starting the instant `forceHideControls()`
   * runs — not sequenced one after the other. (A previous version waited for
   * the controls' own fade to fully finish before starting the zoom-out, for
   * a button-close specifically — requested directly, to avoid stationary
   * chrome hovering over an already-shrinking photo. Reversed on later,
   * explicit feedback: waiting read as two distinct steps rather than one
   * motion; starting both together still avoids stationary chrome, since
   * the chrome is disappearing too, just without the pause.)
   */
  private beginClose(frozenDrag?: FrozenDragTransform): void {
    if (this.destroyed || !this.opened || this.isClosing) return;
    // DESIGN.md §2.3a — every close path (button, swipe, Escape, backdrop
    // click, destroy-while-open) funnels through here; the modal must not
    // linger past the lightbox itself closing, and its own document-level
    // keydown listener needs removing before that.
    if (this.captionModalOpen) this.closeCaptionModal();
    if (this.toolbarOverflowOpen) this.closeToolbarOverflow();
    // Read before beforeClose fires — the Zoom plugin's own beforeClose
    // handler resets its scale/pan back to neutral there (so zoomOut()'s
    // measurement below stays correct, same reasoning dragStart's own doc
    // comment explains), which would otherwise erase the very state this
    // is capturing.
    const zoomStart = this.zoomStartProvider?.() ?? undefined;
    this.bus.emit('beforeClose', {});

    // .shoji-outer must stay display:block for the zoom-out to be visible,
    // so the actual state flip (isOpen, focus restore, etc.) is deferred
    // until the animation finishes — see finishClose(). isClosing guards
    // against a second close() (e.g. a repeated Escape) re-triggering the
    // animation mid-flight while isOpen is still (deliberately) true.
    this.isClosing = true;

    const media = this.slides?.getActiveMedia();
    // close() never tears down the slide pool (reopening should be
    // instant), so nothing else stops a viewer-started video just because
    // the lightbox is now hidden.
    pauseMedia(media ?? null);

    const origin = this.getOriginElement(this.activeIndex);
    const naturalSize = this.resolveNaturalSize(this.activeIndex);
    // Real content already rendered doesn't need naturalSize at all —
    // effectiveTargetBox() (zoomTransition.ts) measures it directly, no
    // guessing involved. Only closing before it ever finished loading (no
    // real content, no naturalSize to fall back on either) would have
    // nothing but a guessed target to shrink toward — same "don't guess"
    // reasoning open() above already applies to its own animation.
    if (media && origin && (this.slides?.isActiveReady() || naturalSize)) {
      const aspectRatio = this.resolveAspectRatio(this.activeIndex, origin);
      this.forceHideControls();
      // Starts at the same instant as the zoom-out and the controls fade —
      // see the comment on .shoji-backdrop's own transition (shoji.css) for
      // why this can't just be left to the instant display:none cut at the
      // end of finishClose().
      if (this.dom) this.dom.backdrop.style.opacity = '0';
      zoomOut(
        { origin, target: media, aspectRatio, naturalSize, dragStart: frozenDrag, zoomStart },
        () => this.finishClose(),
      );
    } else {
      this.finishClose();
    }
  }

  /**
   * Forces the same fade §2.8's idle timer would eventually trigger, bypassing `hideControls()`'s own `isControlActive()` hover guard — the most common close path (clicking close) is hovering a control at this exact instant, and a deliberate close should hide regardless. No-op if already hidden.
   *
   * Also marks `.shoji-controls-hidden-for-close` alongside the ordinary
   * class — a real bug, reported from real usage: a plugin's own overlay
   * (Autoplay's progress bar, `autoplay.css`) was wired to fade on plain
   * `.shoji-controls-hidden`, the same class *ordinary idle auto-hide* also
   * applies — so it faded out and stayed gone through every idle period
   * too, not just the close animation the original request was actually
   * about. That went unnoticed for a while because until recently, tapping
   * the image toggled play/pause *and* revealed controls on the same tap,
   * papering over how often it was actually gone; once that tap-to-toggle
   * was removed (§4.1 point 15) as a separate, unrelated fix, an idle
   * slideshow now visibly loses its own progress indicator and never gets
   * it back without an unrelated interaction — surfacing this as a real
   * regression in practice, even though no code touching this class had
   * changed. This second class is the hook a plugin's CSS can key off
   * specifically for "closing," without it ever matching ordinary idle-hide.
   */
  private forceHideControls(): void {
    if (!this.dom || this.autoHidden) return;
    this.autoHidden = true;
    this.dom.dialog.classList.add('shoji-controls-hidden', 'shoji-controls-hidden-for-close');
    this.bus.emit('controls:hide', {});
  }

  /**
   * DESIGN.md §2.4/§2.8 — `GestureController`'s live vertical-drag cue: hide
   * past the same distance a release would close, reveal again on retreat.
   * `hidden: false` only reveals if visible when *this* gesture started
   * (`controlsHiddenAtGestureStart`) — shouldn't resurrect controls already
   * separately hidden (idle, or `autoHideDelay: 0`) before the drag began.
   * `dragCloseThreshold` (bus event) fires on every crossing regardless of
   * that guard — Autoplay (§4-autoplay) needs to know about the crossing
   * itself, not just whether controls visibly moved.
   */
  private setControlsHiddenForDrag(hidden: boolean): void {
    this.controlsHiddenByDrag = hidden;
    if (hidden) this.forceHideControls();
    else if (!this.controlsHiddenAtGestureStart) this.showControls();
    // A real bug, reported from real usage: `.shoji-controls-hidden` also
    // hides the cursor (shoji.css) — fine for an idle/inactive hide, but
    // this hide happens *during* an active drag, so the cursor vanished
    // right when the viewer most needs to see it. This marker class scopes
    // a cursor override to specifically this case (see shoji.css).
    this.dom?.dialog.classList.toggle('shoji-controls-hidden-for-drag', hidden);
    this.bus.emit('dragCloseThreshold', { hidden });
  }

  /** `item.width`/`height`, else origin's `naturalWidth`/`naturalHeight` (accurate when `item.thumb` is unset). Feeds `computeTransform`'s letterbox-aware sizing. */
  private resolveAspectRatio(index: number, origin: HTMLElement | null): number | undefined {
    const item = this.itemList[index];
    if (item?.width && item.height) return item.width / item.height;
    const thumbImg = origin?.querySelector('img');
    if (thumbImg?.naturalWidth && thumbImg.naturalHeight) {
      return thumbImg.naturalWidth / thumbImg.naturalHeight;
    }
    return undefined;
  }

  /**
   * `item.width`/`height` only — deliberately never a thumbnail's own
   * `naturalWidth`/`naturalHeight` the way `resolveAspectRatio` above will:
   * that's a fine stand-in for *shape*, but using it as the real photo's
   * true pixel size would under-cap a genuinely large photo down to
   * thumbnail resolution. `undefined` here just means "genuinely unknown,"
   * not "assume small" — `zoomTransition.ts`'s `containedBox` already
   * treats it that way (no cap applied at all).
   */
  private resolveNaturalSize(index: number): { width: number; height: number } | undefined {
    const item = this.itemList[index];
    return item?.width && item.height ? { width: item.width, height: item.height } : undefined;
  }

  /**
   * Idempotent on purpose: a pending zoom-out's `transitionend`/fallback
   * timeout can still fire after `destroy()` has already force-finished the
   * close (§ destroy() below) — the `!this.opened` guard makes that a no-op
   * instead of a second `close`/`afterClose` emission on a torn-down gallery.
   */
  private finishClose(): void {
    if (!this.opened) return;
    this.isClosing = false;
    this.opened = false;
    unlockBodyScroll();
    document.removeEventListener('keydown', this.onKeydown);
    if (window.visualViewport)
      window.visualViewport.removeEventListener('resize', this.syncViewportHeight);
    else window.removeEventListener('resize', this.syncViewportHeight);
    this.focusTrap.deactivate();
    this.dom?.outer.classList.remove('shoji-open');
    if (this.dom) this.dom.outer.style.height = '';
    // Cleared, not left at '0' — a fresh open() must start fully opaque
    // again, not still faded out from the last close.
    if (this.dom) this.dom.backdrop.style.opacity = '';
    if (this.autoHideTimer !== null) {
      clearTimeout(this.autoHideTimer);
      this.autoHideTimer = null;
    }
    this.autoHidden = false;
    this.hoveringElements.clear();
    this.controlsHiddenByDrag = false;
    this.dom?.dialog.classList.remove('shoji-controls-hidden', 'shoji-controls-hidden-for-close');
    // A completed drag-close never calls setControlsHiddenForDrag(false)
    // (nothing left to un-hide for) — clean up the marker here instead, so
    // it can't linger into the next open().
    this.dom?.dialog.classList.remove('shoji-controls-hidden-for-drag');
    this.bus.emit('close', {});
    this.bus.emit('afterClose', {});
  }

  /** DESIGN.md §2.1 — diffs by id (fallback src), preserving the active slide. */
  updateSlides(items: GalleryItemInput[], currentIndex?: number): void {
    if (this.destroyed) return;

    const activeItem = this.itemList[this.activeIndex];
    const activeKey = activeItem ? itemKey(activeItem) : undefined;
    this.itemList = resolveDynamicVideoItems(items);

    let nextIndex = currentIndex;
    if (nextIndex === undefined && activeKey !== undefined) {
      const preserved = items.findIndex((item) => itemKey(item) === activeKey);
      if (preserved !== -1) nextIndex = preserved;
    }
    this.activeIndex = Math.min(
      Math.max(nextIndex ?? this.activeIndex, 0),
      Math.max(items.length - 1, 0),
    );

    if (this.opened) this.renderCurrentSlide();
    this.bus.emit('itemsUpdated', { items: this.itemList });
  }

  /**
   * Sugar over `updateSlides()` for the common "insert some items" case —
   * splices `items` into a copy of the current list at `atIndex` (default:
   * append at the end) and hands the result to `updateSlides()`, which
   * still does all the real work (active-item preservation, live re-render
   * if open, `itemsUpdated`). `atIndex` follows `Array.prototype.splice`'s
   * own semantics (negative counts from the end, out-of-range clamps) —
   * no extra validation on top of that.
   */
  addSlides(items: GalleryItemInput[], atIndex?: number): void {
    if (this.destroyed) return;
    const next: GalleryItemInput[] = [...this.itemList];
    next.splice(atIndex ?? next.length, 0, ...items);
    this.updateSlides(next);
  }

  /**
   * Sugar over `updateSlides()` for the common "remove some items" case.
   * Accepts a single id/index or an array mixing both: a `string` matches
   * the same `id ?? src` key `updateSlides()` already uses for active-item
   * preservation, a `number` matches that position in the *current*
   * `items` list (resolved against the list as it is now, before any
   * removal — passing `[0, 1]` removes the first two items, not "index 0,
   * then whatever became index 1 after that").
   */
  removeSlides(match: string | number | Array<string | number>): void {
    if (this.destroyed) return;
    const matches = Array.isArray(match) ? match : [match];
    const indices = new Set(matches.filter((m): m is number => typeof m === 'number'));
    const keys = new Set(matches.filter((m): m is string => typeof m === 'string'));
    const next = this.itemList.filter((item, i) => !indices.has(i) && !keys.has(itemKey(item)));
    this.updateSlides(next);
  }

  /** DESIGN.md §2.7 — selector-mode only; sugar over updateSlides() sourced from a DOM rescan. */
  refresh(): void {
    if (this.destroyed) return;
    if (this.isDynamicMode) {
      console.warn('Shoji: refresh() is a no-op in dynamic mode — call updateSlides() instead.');
      return;
    }
    const scanned = scanContainer(this.element, this.selector);
    this.scannedElements = scanned.map((s) => s.element);
    this.updateSlides(scanned.map((s) => s.item));
  }

  /** Shared by `destroy()`/`reinit()` (§2.7): force-close, run plugin cleanups, drop gesture/transition/slide/dialog. */
  private teardown(): void {
    if (this.opened) {
      // A real bug, caught by cross-test interference in the unit suite —
      // never reproduced as a simple direct assertion because the existing
      // "destroy() while the modal is open" test's `removeEventListener`
      // spy assertion was too loose to actually catch it (FocusTrap's own
      // unrelated document keydown listener removal satisfied the same
      // `expect.any(Function)` matcher). `beginClose()` closes the caption
      // modal first (DESIGN.md §2.3a) — `teardown()` calls `finishClose()`
      // directly instead, skipping `beginClose()` and its own close-path
      // entirely, so destroying a gallery while its caption modal was open
      // never removed that modal's document-level keydown listener. Left
      // unfixed, it leaks forever: a capture-phase listener bound to the
      // destroyed instance, `stopPropagation()`-ing every future keydown on
      // the page regardless of what it's for.
      if (this.captionModalOpen) this.closeCaptionModal();
      // Same gap, same fix, for the toolbar overflow popover (§3.1a) —
      // teardown() skips beginClose() entirely, so a destroy()/reinit()
      // while it happened to be open would leak its own document-level
      // keydown listener the same way.
      if (this.toolbarOverflowOpen) this.closeToolbarOverflow();
      if (!this.isClosing) this.bus.emit('beforeClose', {});
      this.finishClose();
    }
    for (const cleanup of this.pluginCleanups) cleanup();
    this.pluginCleanups = [];
    this.shortcuts.clear();
    this.pluginStorage.clear();
    this.activePluginNames.clear();
    this.videoProviders.clear();
    if (!this.isDynamicMode) {
      this.element.removeEventListener('click', this.onContainerClick);
    }
    this.gesture?.destroy();
    this.gesture = null;
    this.transition = null;
    this.toolbarHeightObserver?.disconnect();
    this.toolbarHeightObserver = null;
    if (this.toolbarHeightFrame !== null) cancelAnimationFrame(this.toolbarHeightFrame);
    this.toolbarHeightFrame = null;
    if (this.captionTruncationFrame !== null) cancelAnimationFrame(this.captionTruncationFrame);
    this.captionTruncationFrame = null;
    this.captionFadePending = false;
    this.slides?.destroy();
    this.dom?.outer.remove();
    this.slides = null;
    this.dom = null;
    // A real leak, caught by inspection: core's own `wireControlHover()`
    // calls in `ensureLightbox()` (closeButton, toolbar slots, caption,
    // counter, ...) never store/call the unsubscribe they return, since
    // there was never anywhere else that needed it before — those elements
    // were expected to just live and die with the rest of `dom` above.
    // `reinit()` routes through here too, though, and rebuilds a whole new
    // `dom` afterward (`ensureLightbox()` runs again) — without this,
    // `hoverableElements` would keep every previous reinit cycle's now-
    // detached elements forever, growing unbounded across repeated calls.
    this.hoverableElements.clear();
    this.hoveringElements.clear();
    // Same reasoning: a plugin's own `ctx.ui.toolbar()` unsubscribe not
    // being called for some reason must not leave stale, now-detached
    // elements in here across a `reinit()` cycle either.
    this.pluginToolbarButtons.length = 0;
  }

  destroy(): void {
    if (this.destroyed) return;
    // Guarded, not a plain delete(): if a second Gallery was constructed on
    // this same element without the first ever being destroyed, the
    // registry entry already points at that newer instance — an old,
    // stale `this` being destroyed later must not evict it.
    if (instanceRegistry.get(this.element) === this) instanceRegistry.delete(this.element);
    allInstances.delete(this);
    this.teardown();
    this.bus.emit('destroy', {});
    this.bus.clear();
    this.destroyed = true;
  }

  /**
   * DESIGN.md §2.7 — full teardown + reconstruction on `this`, not a new
   * object: `Shoji.getInstance(el)`/any held reference keeps working across
   * the call, unlike `destroy()` + `new Shoji(...)`. Omit `options` to
   * rebuild unchanged (a hard reset); pass options to reconfigure
   * structurally. `gallery.on(...)` listeners do NOT survive — the event
   * bus is fully cleared, same as `destroy()` — re-`on()` anything needed.
   */
  reinit(options: GalleryOptions = this.options): void {
    if (this.destroyed) return;
    this.teardown();
    this.bus.clear();
    this.applyOptions(options);
  }
}
