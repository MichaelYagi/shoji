import { lockBodyScroll, unlockBodyScroll } from './bodyScrollLock';
import { EventBus, type Unsubscribe } from './EventBus';
import { buildLightboxDom, type LightboxDom } from './dom';
import { FocusTrap } from './FocusTrap';
import { GestureController, INTERACTIVE_CONTROL_SELECTOR } from './GestureController';
import { LiveRegion } from './LiveRegion';
import type { ButtonSpec, PluginContext, VideoProviderRenderer } from './plugin';
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
import { zoomIn, zoomOut, waitForTransitionEnd } from './zoomTransition';

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
  playVideo: 'Play video',
  showCaption: 'Show caption',
  hideCaption: 'Hide caption',
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
 * `.shoji-slide-provider-video` (a real bug, reported from real usage,
 * mobile-specific): a provider embed (YouTube) isn't a `<video>` element —
 * it's a plain `<div>` wrapping a cross-origin `<iframe>` — so it never
 * matched `INTERACTIVE_CONTROL_SELECTOR`'s `video` term the way a native
 * HTML5 video slide already did. `.shoji-toolbar`'s own empty space is
 * `pointer-events: none` (so it doesn't block the content underneath), so a
 * tap there falls through to this container and — without this exclusion —
 * read as "clicked outside," closing the gallery on the exact same tap
 * that was meant to reveal auto-hidden controls again. Desktop rarely hit
 * this (hovering reveals controls without ever generating a `click`), but
 * on mobile every reveal attempt is a tap, and a tap is a click.
 */
function isBackdropClick(event: Event): boolean {
  return !event
    .composedPath()
    .some(
      (node) =>
        node instanceof Element &&
        node.matches(
          `.shoji-slide-img, .shoji-slide-provider-video, .shoji-counter, ${INTERACTIVE_CONTROL_SELECTOR}`,
        ),
    );
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
  private loop = true;
  private closable = true;
  private autoHideDelay = 5000;
  private readonly focusTrap = new FocusTrap();
  private readonly liveRegion = new LiveRegion();
  private autoHideTimer: ReturnType<typeof setTimeout> | null = null;
  private autoHidden = false;
  private hoveredControlCount = 0;
  private isClosing = false;
  private itemList: GalleryItem[] = [];
  private scannedElements: HTMLElement[] = [];
  private activeIndex = 0;
  private opened = false;
  private destroyed = false;
  private slides: SlideManager | null = null;
  private dom: LightboxDom | null = null;
  private gesture: GestureController | null = null;
  private transition: SlideTransition | null = null;
  private readonly shortcuts = new Map<string, (e: KeyboardEvent) => void>();
  private readonly pluginStorage = new Map<string, unknown>();
  /** Backs `getActivePlugins()`. */
  private readonly activePluginNames = new Set<string>();
  private readonly videoProviders = new Map<string, VideoProviderRenderer>();
  private zoomGate: (() => boolean) | null = null;
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
    if (this.closable && isBackdropClick(event)) this.close();
  };

  /**
   * DESIGN.md §2.8 — any interaction re-shows controls, restarts the idle
   * clock. `autoHideDelay: 0` = "never show controls" — a no-op here.
   * Also a no-op once `isClosing` — a real bug, reported from real usage:
   * moving the mouse during close()'s own controls-fade-then-zoom-out
   * sequence (§2.6a) re-showed the just-hidden controls mid-animation, since
   * these same activity listeners stay wired for the whole close sequence,
   * not torn down until finishClose(). Nothing to reveal controls *for*
   * once closing has actually started.
   */
  private readonly onActivity = (): void => {
    if (this.autoHideDelay === 0 || this.isClosing) return;
    this.showControls();
    this.scheduleAutoHide();
  };

  /** x */
  private controlsHiddenAtGestureStart = false;
  private readonly captureGestureStartState = (): void => {
    this.controlsHiddenAtGestureStart = this.autoHidden;
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
      playVideoLabel: this.locale.playVideo,
      videoProviders: this.videoProviders,
    });
    this.transition = new SlideTransition(this.slides);
    const dom = buildLightboxDom(this.slides.element, this.locale);
    this.dom = dom;
    if (this.options.backdropOpacity != null) {
      const clamped = Math.min(Math.max(this.options.backdropOpacity, 0), 1);
      dom.outer.style.setProperty('--shoji-backdrop-opacity', String(clamped));
    }
    dom.outer.appendChild(this.liveRegion.element);
    dom.closeButton.addEventListener('click', () => this.close());
    dom.prevButton.addEventListener('click', () => this.prev());
    dom.nextButton.addEventListener('click', () => this.next());
    dom.captionToggleButton.addEventListener('click', () => {
      this.captionVisibleOnVideo = !this.captionVisibleOnVideo;
      this.updateCaptionVisibility();
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
      dom.counter,
      dom.toolbarLeft,
      dom.toolbarCenter,
      dom.toolbarRight,
    ]) {
      this.wireControlHover(el);
    }

    document.body.appendChild(dom.outer);

    // DESIGN.md §2.4 — attached to the whole dialog (not just .shoji-slides)
    // so vertical swipe-to-close works from anywhere in it, not only over
    // the image; shouldIgnoreGesture() excludes real controls so their
    // native click/touch behavior is unaffected.
    this.gesture = new GestureController(
      {
        dialog: dom.dialog,
        slides: this.slides,
        canGoNext: () => this.loop || this.activeIndex < this.itemList.length - 1,
        canGoPrev: () => this.loop || this.activeIndex > 0,
        // animate:false — a completed swipe already played its own
        // live-drag/settle animation (§2.4); running the §2.5 `mode`
        // transition on top would double-animate. See navigate()'s doc.
        next: () => this.navigate(this.nextIndex(), 1, false),
        prev: () => this.navigate(this.prevIndex(), -1, false),
        close: () => this.close(),
        closeFromSwipe: () => this.closeFromSwipe(),
        canClose: () => this.closable,
        onActivity: () => this.onActivity(),
        isZoomed: () => this.zoomGate?.() ?? false,
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

  /** DESIGN.md §3 — plugins init here, not the constructor. `requires` checks names loaded earlier; an unmet one is skipped (logged), not thrown. Cleared up front so a `reinit()` doesn't inherit names from before. */
  private initPlugins(): void {
    this.activePluginNames.clear();
    this.videoProviders.clear();
    for (const plugin of this.options.plugins ?? []) {
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
      const missing = (plugin.requires ?? []).filter((name) => !this.activePluginNames.has(name));
      if (missing.length > 0) {
        console.error(
          `Shoji: plugin "${plugin.name}" requires [${missing.join(', ')}] to be registered first — skipping.`,
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
   * DESIGN.md §3.1 — 'right' inserts immediately before the close button
   * (never after), so close stays fixed rightmost and plugins cluster to
   * its left in registration order: `plugins: [A, B, C]` reads A, B, C,
   * close. 'left'/'center' are independent zones for a plugin that doesn't
   * want to sit next to close.
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
      dom.toolbarRight.insertBefore(node, dom.closeButton);
    } else {
      (slot === 'left' ? dom.toolbarLeft : dom.toolbarCenter).appendChild(node);
    }
    return () => {
      unhover?.();
      node.remove();
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

  private pluginOverlay(el: HTMLElement, layer?: number): Unsubscribe {
    if (layer !== undefined) el.style.zIndex = String(layer);
    this.dom!.dialog.appendChild(el);
    const unhover = this.wireControlHover(el);
    return () => {
      unhover();
      el.remove();
    };
  }

  /** DESIGN.md §2.8/§3 — pauses auto-hide while genuinely hovered: controls, caption, and any plugin overlay (`ctx.ui.overlay()`). Unsubscribe also corrects the count if removed mid-hover — a real risk for overlay content a plugin can toggle while the gallery stays open, unlike static buttons. */
  private wireControlHover(el: HTMLElement): Unsubscribe {
    let hovering = false;
    const onEnter = (): void => {
      hovering = true;
      this.hoveredControlCount++;
      this.onActivity();
    };
    const onLeave = (): void => {
      hovering = false;
      this.hoveredControlCount--;
      this.scheduleAutoHide();
    };
    el.addEventListener('pointerenter', onEnter);
    el.addEventListener('pointerleave', onLeave);
    return () => {
      el.removeEventListener('pointerenter', onEnter);
      el.removeEventListener('pointerleave', onLeave);
      if (hovering) {
        hovering = false;
        this.hoveredControlCount--;
        this.scheduleAutoHide();
      }
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
    return this.hoveredControlCount > 0;
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

  private scheduleAutoHide(): void {
    if (this.autoHideTimer !== null) {
      clearTimeout(this.autoHideTimer);
      this.autoHideTimer = null;
    }
    if (!this.opened) return;
    if (this.autoHideDelay === 0) {
      this.hideControls(); // 0 = hidden immediately, no reveal — see onActivity
      return;
    }
    this.autoHideTimer = setTimeout(() => this.hideControls(), this.autoHideDelay);
  }

  /** Forces the same fade §2.8's idle timer would eventually trigger — public so a plugin can hide controls on its own trigger. Same `isControlActive()` guard as the timer. */
  hideControls(): void {
    if (!this.dom || this.autoHidden || this.isControlActive()) return;
    this.autoHidden = true;
    this.dom.dialog.classList.add('shoji-controls-hidden');
    this.bus.emit('controls:hide', {});
  }

  private showControls(): void {
    if (!this.dom || !this.autoHidden) return;
    this.autoHidden = false;
    this.dom.dialog.classList.remove('shoji-controls-hidden');
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
          this.updateCaptionVisibility();
        }
      },
      openPlaceholderSrc,
    );
    this.setSlideLoading(!this.slides.isActiveReady());

    const item = this.itemList[this.activeIndex];
    const total = this.itemList.length;
    dom.counter.textContent = total > 0 ? `${this.activeIndex + 1} / ${total}` : '';
    dom.counter.hidden = !this.showCounter || total === 0;
    this.updateCaptionVisibility();
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
    this.renderCurrentSlide(
      naturalSize ? this.resolveOpenPlaceholderSrc(this.itemList[index], origin) : undefined,
    );
    this.dom!.outer.classList.add('shoji-open');
    document.addEventListener('keydown', this.onKeydown);
    this.focusTrap.activate(this.dom!.dialog);
    this.scheduleAutoHide();
    this.applyMobileControlsSetting();

    const media = this.slides?.getActiveMedia();
    if (media && origin && naturalSize) {
      zoomIn({
        origin,
        target: media,
        aspectRatio: this.resolveAspectRatio(index, origin),
        naturalSize,
      });
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

    const swap = (): void => this.renderCurrentSlide();
    if (animate && this.transition) {
      const modeName = this.resolveTransitionMode();
      const builtin = TRANSITION_PRESETS[modeName];
      if (builtin) {
        this.transition.animate(builtin, direction, swap);
      } else {
        this.transition.animateCustom(modeName, direction, swap);
      }
    } else {
      swap();
    }

    this.bus.emit('afterSlide', { from, to: clamped });
  }

  /** DESIGN.md §2.5 — `mobileSettings.mode` overrides `mode` on a coarse-pointer device, evaluated fresh each navigation. */
  private resolveTransitionMode(): string {
    if (this.isMobileQuery() && this.options.mobileSettings?.mode) {
      return this.options.mobileSettings.mode;
    }
    return this.options.mode ?? 'slide';
  }

  private isMobileQuery(): boolean {
    return (
      typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches
    );
  }

  /**
   * DESIGN.md §2.5 — `mobileSettings.controls: false` starts controls
   * hidden on a coarse-pointer device, reusing the existing §2.8 auto-hide
   * mechanism (`hideControls()`) rather than a separate permanent-hide
   * state: auto-hide is opacity-only, never removed from the tab order,
   * and already reveals on any activity — a genuinely *permanent* hide
   * would strand a touch user with no way to ever reach Close.
   */
  private applyMobileControlsSetting(): void {
    if (this.isMobileQuery() && this.options.mobileSettings?.controls === false) {
      this.hideControls();
    }
  }

  close(): void {
    this.beginClose(true);
  }

  /**
   * DESIGN.md §2.4/§2.6a — same effect as `close()`, from a completed
   * vertical swipe. The drag already has its own closing motion in progress
   * (live feedback easing back to neutral, `GestureController`) — sequencing
   * a separate controls-fade pause in front of the zoom-out would interrupt
   * it. Controls still hide, just concurrently, not blocking.
   */
  private closeFromSwipe(): void {
    this.beginClose(false);
  }

  /** `waitForControlsFade` — true for `close()` (nothing else is animating, so fading first avoids stationary chrome over a shrinking photo); false for `closeFromSwipe()`, which already has a concurrent closing motion. */
  private beginClose(waitForControlsFade: boolean): void {
    if (this.destroyed || !this.opened || this.isClosing) return;
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
    // closeFromSwipe(): target's current rect is still wherever the drag
    // left it (its own reset eases back concurrently, not yet finished), so
    // this naturally continues from that position instead of neutral.
    if (media && origin && (this.slides?.isActiveReady() || naturalSize)) {
      const aspectRatio = this.resolveAspectRatio(this.activeIndex, origin);
      const runZoomOut = (): void => {
        zoomOut({ origin, target: media, aspectRatio, naturalSize }, () => this.finishClose());
      };
      const alreadyHidden = this.autoHidden;
      this.forceHideControls();
      if (waitForControlsFade && !alreadyHidden && this.dom) {
        waitForTransitionEnd(this.dom.toolbar, runZoomOut, 'opacity');
      } else {
        runZoomOut();
      }
    } else {
      this.finishClose();
    }
  }

  /** Forces the same fade §2.8's idle timer would eventually trigger, bypassing `hideControls()`'s own `isControlActive()` hover guard — the most common close path (clicking close) is hovering a control at this exact instant, and a deliberate close should hide regardless. No-op if already hidden. */
  private forceHideControls(): void {
    if (!this.dom || this.autoHidden) return;
    this.autoHidden = true;
    this.dom.dialog.classList.add('shoji-controls-hidden');
    this.bus.emit('controls:hide', {});
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
    this.focusTrap.deactivate();
    this.dom?.outer.classList.remove('shoji-open');
    if (this.autoHideTimer !== null) {
      clearTimeout(this.autoHideTimer);
      this.autoHideTimer = null;
    }
    this.autoHidden = false;
    this.hoveredControlCount = 0;
    this.dom?.dialog.classList.remove('shoji-controls-hidden');
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
    this.slides?.destroy();
    this.dom?.outer.remove();
    this.slides = null;
    this.dom = null;
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
