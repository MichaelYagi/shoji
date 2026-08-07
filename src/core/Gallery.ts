import { lockBodyScroll, unlockBodyScroll } from './bodyScrollLock';
import { EventBus, type Unsubscribe } from './EventBus';
import { buildLightboxDom, type LightboxDom } from './dom';
import { FocusTrap } from './FocusTrap';
import { GestureController } from './GestureController';
import { LiveRegion } from './LiveRegion';
import type { ButtonSpec, PluginContext } from './plugin';
import { DEFAULT_SELECTOR, scanContainer } from './scan';
import { SlideManager } from './SlideManager';
import type { DangerousHtmlCaption, GalleryEvents, GalleryItem, GalleryOptions } from './types';
import { TRANSITION_PRESETS } from '../transitions/presets';
import { SlideTransition } from '../transitions/SlideTransition';
import { zoomIn, zoomOut } from './zoomTransition';

function itemKey(item: GalleryItem): string {
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
 */
function isBackdropClick(event: Event): boolean {
  return !event
    .composedPath()
    .some(
      (node) =>
        node instanceof Element &&
        node.matches('.shoji-slide-img, button, video, .shoji-counter, .shoji-caption'),
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
  private loop = true;
  private closable = true;
  private autoHideDelay = 5000;
  private readonly focusTrap = new FocusTrap();
  private readonly liveRegion = new LiveRegion();
  private autoHideTimer: ReturnType<typeof setTimeout> | null = null;
  private controlsHidden = false;
  private hoveredControlCount = 0;
  private isClosing = false;
  private itemList: GalleryItem[] = [];
  private scannedElements: HTMLElement[] = [];
  private activeIndex = 0;
  private isOpen = false;
  private isDestroyed = false;
  private slides: SlideManager | null = null;
  private dom: LightboxDom | null = null;
  private gesture: GestureController | null = null;
  private transition: SlideTransition | null = null;
  private readonly shortcuts = new Map<string, (e: KeyboardEvent) => void>();
  private readonly pluginStorage = new Map<string, unknown>();
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

  /** DESIGN.md §2.8 — any interaction re-shows controls, restarts the idle clock. `autoHideDelay: 0` = "never show controls" — a no-op here. */
  private readonly onActivity = (): void => {
    if (this.autoHideDelay === 0) return;
    this.showControls();
    this.scheduleAutoHide();
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
        this.prev();
        break;
      case 'ArrowRight':
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
      this.itemList = options.items ?? [];
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
    this.slides = new SlideManager({ preload: this.preload });
    this.transition = new SlideTransition(this.slides);
    const dom = buildLightboxDom(this.slides.element, this.locale);
    this.dom = dom;
    dom.outer.appendChild(this.liveRegion.element);
    dom.closeButton.addEventListener('click', () => this.close());
    dom.prevButton.addEventListener('click', () => this.prev());
    dom.nextButton.addEventListener('click', () => this.next());
    dom.outer.addEventListener('click', this.onOuterClick);
    dom.outer.addEventListener('pointermove', this.onActivity, { passive: true });
    dom.outer.addEventListener('pointerdown', this.onActivity, { passive: true });
    dom.outer.addEventListener('touchstart', this.onActivity, { passive: true });
    dom.outer.addEventListener('wheel', this.onActivity, { passive: true });
    dom.outer.addEventListener('focusin', this.onActivity);
    dom.outer.addEventListener('focusout', () => this.scheduleAutoHide());

    // Hovering a *button* pauses auto-hide even while the mouse sits still
    // (pointermove alone wouldn't catch that); the counter/caption are
    // informational, not interactive, so they're deliberately excluded. Wired
    // to the shared class selector (below), not an enumerated element list,
    // so a plugin-added ctx.ui.toolbar() button (e.g. autoplay's play/pause)
    // participates automatically instead of vanishing mid-hover.
    for (const button of [dom.closeButton, dom.prevButton, dom.nextButton]) {
      this.wireControlHover(button);
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
        canClose: () => this.closable,
        onActivity: () => this.onActivity(),
        isZoomed: () => this.zoomGate?.() ?? false,
      },
      {
        onTap: (x, y) => this.bus.emit('tap', { x, y }),
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

  /** DESIGN.md §3 — plugins init here, not the constructor. `requires` checks names loaded earlier in the array; an unmet one is skipped (logged), not thrown. */
  private initPlugins(): void {
    const loaded = new Set<string>();
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
      const missing = (plugin.requires ?? []).filter((name) => !loaded.has(name));
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
      loaded.add(plugin.name);
    }
  }

  /**
   * DESIGN.md §3.1 — 'right' is where plugin controls belong: each one
   * inserts immediately before the close button (never after), so close
   * stays the fixed rightmost element and plugins cluster directly to its
   * left, in registration order — `plugins: [A, B, C]` reads left-to-right
   * as A, B, C, close, since each later plugin's `initPlugins()` call runs
   * after the earlier ones and inserts at the same "right before close"
   * point, pushing earlier buttons further left. 'left'/'center' remain
   * independent zones elsewhere in the toolbar for a plugin that
   * deliberately doesn't want to sit next to close.
   */
  private pluginToolbar(
    slot: 'left' | 'center' | 'right',
    el: HTMLElement | ButtonSpec,
  ): Unsubscribe {
    const dom = this.dom!;
    const node = el instanceof HTMLElement ? el : this.buildToolbarButton(el);
    if (slot === 'right') {
      dom.toolbarRight.insertBefore(node, dom.closeButton);
    } else {
      (slot === 'left' ? dom.toolbarLeft : dom.toolbarCenter).appendChild(node);
    }
    return () => node.remove();
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
    return () => el.remove();
  }

  /** DESIGN.md §3 — every `ButtonSpec` toolbar button gets hover-pauses-auto-hide, like close/prev/next. */
  private wireControlHover(button: HTMLElement): void {
    button.addEventListener('pointerenter', () => {
      this.hoveredControlCount++;
      this.onActivity();
    });
    button.addEventListener('pointerleave', () => {
      this.hoveredControlCount--;
      this.scheduleAutoHide();
    });
  }

  /** DESIGN.md §2.8 — opacity-only, never while focused/hovered. Matches by class so plugin toolbar buttons participate. */
  private isControlActive(): boolean {
    if (!this.dom) return false;
    if (this.hoveredControlCount > 0) return true;
    const active = document.activeElement;
    return (
      active instanceof HTMLElement &&
      active.matches('.shoji-close, .shoji-nav, .shoji-toolbar-button')
    );
  }

  /**
   * The thumbnail for `index` — what the zoom transition animates to/from,
   * and what a plugin like `activeThumbnail` marks/scrolls-to as the active
   * slide changes. `data-shoji-id="<item.id>"` is an explicit opt-in that
   * works in *any* mode — primarily for dynamic mode, where Shoji has no
   * automatic knowledge of the host's own thumbnail DOM (the layout plugin's
   * own rendered tiles set this automatically when `item.id` is present).
   * Selector mode needs no markup: `scannedElements[index]` is already the
   * real matched element. Checked in that order so a marker can override
   * selector mode's default too, e.g. to target an inner element instead of
   * the outer wrapper.
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
    if (!this.isOpen) return;
    if (this.autoHideDelay === 0) {
      this.hideControls(); // 0 = hidden immediately, no reveal — see onActivity
      return;
    }
    this.autoHideTimer = setTimeout(() => this.hideControls(), this.autoHideDelay);
  }

  private hideControls(): void {
    if (!this.dom || this.controlsHidden || this.isControlActive()) return;
    this.controlsHidden = true;
    this.dom.dialog.classList.add('shoji-controls-hidden');
    this.bus.emit('controls:hide', {});
  }

  private showControls(): void {
    if (!this.dom || !this.controlsHidden) return;
    this.controlsHidden = false;
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

  private renderCurrentSlide(): void {
    if (!this.slides || !this.dom) return;
    const dom = this.dom;
    this.slides.render(this.itemList, this.activeIndex, (loadedIndex) => {
      if (loadedIndex === this.activeIndex) {
        this.bus.emit('slideItemLoad', { index: loadedIndex });
        this.setSlideLoading(false);
      }
    });
    this.setSlideLoading(!this.slides.isActiveReady());

    const item = this.itemList[this.activeIndex];
    const total = this.itemList.length;
    dom.counter.textContent = total > 0 ? `${this.activeIndex + 1} / ${total}` : '';
    dom.counter.hidden = !this.showCounter || total === 0;
    dom.caption.hidden = this.renderCaption(dom.caption, item?.caption);
    const label = `Image ${this.activeIndex + 1} of ${total}${item?.alt ? `: ${item.alt}` : ''}`;
    this.liveRegion.announce(label);

    dom.prevButton.hidden = total <= 1;
    dom.nextButton.hidden = total <= 1;
    dom.prevButton.disabled = !this.loop && this.activeIndex <= 0;
    dom.nextButton.disabled = !this.loop && this.activeIndex >= total - 1;
  }

  open(index = this.options.index ?? 0): void {
    if (this.isDestroyed || this.isOpen) return;
    this.bus.emit('beforeOpen', { index });
    this.ensureLightbox();
    this.isOpen = true;
    this.activeIndex = index;
    lockBodyScroll();
    this.renderCurrentSlide();
    this.dom!.outer.classList.add('shoji-open');
    document.addEventListener('keydown', this.onKeydown);
    this.focusTrap.activate(this.dom!.dialog);
    this.scheduleAutoHide();
    this.applyMobileControlsSetting();

    const media = this.slides?.getActiveMedia();
    const origin = this.getOriginElement(index);
    if (media && origin) {
      zoomIn({ origin, target: media, aspectRatio: this.resolveAspectRatio(index, origin) });
    }

    this.bus.emit('open', { index });
    this.bus.emit('afterOpen', { index });
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
    if (this.isDestroyed || !this.isOpen || this.itemList.length === 0) return;
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
    if (this.isDestroyed || !this.isOpen || this.itemList.length === 0) return;
    const clamped = this.clampToRange(target);
    if (clamped === this.activeIndex) return;
    const from = this.activeIndex;
    this.bus.emit('beforeSlide', { from, to: clamped });
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
    if (this.isDestroyed || !this.isOpen || this.isClosing) return;
    this.bus.emit('beforeClose', {});

    // .shoji-outer must stay display:block for the zoom-out to be visible,
    // so the actual state flip (isOpen, focus restore, etc.) is deferred
    // until the animation finishes — see finishClose(). isClosing guards
    // against a second close() (e.g. a repeated Escape) re-triggering the
    // animation mid-flight while isOpen is still (deliberately) true.
    this.isClosing = true;

    const media = this.slides?.getActiveMedia();
    const origin = this.getOriginElement(this.activeIndex);
    if (media && origin) {
      const aspectRatio = this.resolveAspectRatio(this.activeIndex, origin);
      zoomOut({ origin, target: media, aspectRatio }, () => this.finishClose());
    } else {
      this.finishClose();
    }
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
   * Idempotent on purpose: a pending zoom-out's `transitionend`/fallback
   * timeout can still fire after `destroy()` has already force-finished the
   * close (§ destroy() below) — the `!this.isOpen` guard makes that a no-op
   * instead of a second `close`/`afterClose` emission on a torn-down gallery.
   */
  private finishClose(): void {
    if (!this.isOpen) return;
    this.isClosing = false;
    this.isOpen = false;
    unlockBodyScroll();
    document.removeEventListener('keydown', this.onKeydown);
    this.focusTrap.deactivate();
    this.dom?.outer.classList.remove('shoji-open');
    if (this.autoHideTimer !== null) {
      clearTimeout(this.autoHideTimer);
      this.autoHideTimer = null;
    }
    this.controlsHidden = false;
    this.hoveredControlCount = 0;
    this.dom?.dialog.classList.remove('shoji-controls-hidden');
    this.bus.emit('close', {});
    this.bus.emit('afterClose', {});
  }

  /** DESIGN.md §2.1 — diffs by id (fallback src), preserving the active slide. */
  updateSlides(items: GalleryItem[], currentIndex?: number): void {
    if (this.isDestroyed) return;

    const activeItem = this.itemList[this.activeIndex];
    const activeKey = activeItem ? itemKey(activeItem) : undefined;
    this.itemList = items;

    let nextIndex = currentIndex;
    if (nextIndex === undefined && activeKey !== undefined) {
      const preserved = items.findIndex((item) => itemKey(item) === activeKey);
      if (preserved !== -1) nextIndex = preserved;
    }
    this.activeIndex = Math.min(
      Math.max(nextIndex ?? this.activeIndex, 0),
      Math.max(items.length - 1, 0),
    );

    if (this.isOpen) this.renderCurrentSlide();
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
  addSlides(items: GalleryItem[], atIndex?: number): void {
    if (this.isDestroyed) return;
    const next = [...this.itemList];
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
    if (this.isDestroyed) return;
    const matches = Array.isArray(match) ? match : [match];
    const indices = new Set(matches.filter((m): m is number => typeof m === 'number'));
    const keys = new Set(matches.filter((m): m is string => typeof m === 'string'));
    const next = this.itemList.filter((item, i) => !indices.has(i) && !keys.has(itemKey(item)));
    this.updateSlides(next);
  }

  /** DESIGN.md §2.7 — selector-mode only; sugar over updateSlides() sourced from a DOM rescan. */
  refresh(): void {
    if (this.isDestroyed) return;
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
    if (this.isOpen) {
      if (!this.isClosing) this.bus.emit('beforeClose', {});
      this.finishClose();
    }
    for (const cleanup of this.pluginCleanups) cleanup();
    this.pluginCleanups = [];
    this.shortcuts.clear();
    this.pluginStorage.clear();
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
    if (this.isDestroyed) return;
    // Guarded, not a plain delete(): if a second Gallery was constructed on
    // this same element without the first ever being destroyed, the
    // registry entry already points at that newer instance — an old,
    // stale `this` being destroyed later must not evict it.
    if (instanceRegistry.get(this.element) === this) instanceRegistry.delete(this.element);
    allInstances.delete(this);
    this.teardown();
    this.bus.emit('destroy', {});
    this.bus.clear();
    this.isDestroyed = true;
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
    if (this.isDestroyed) return;
    this.teardown();
    this.bus.clear();
    this.applyOptions(options);
  }
}
