import { PLAY_ICON } from './icons';
import type { VideoProviderRenderer } from './plugin';
import type { GalleryItem } from './types';
import { containedBox } from './zoomTransition';

/** Native scrub-bar dragging genuinely pauses `<video>` for its duration — showing the play-overlay immediately on every `pause` would flash it on every seek. Long enough to swallow that, short enough a real pause doesn't feel delayed. */
const PAUSE_OVERLAY_DELAY_MS = 200;

interface Slot {
  root: HTMLElement;
  media: HTMLElement;
  /** Which pool position (`-preload…+preload`) this slot represents — reassigned by `render()`, not fixed at construction (see the class comment below). */
  offset: number;
  /** The index this slot currently wants to show, whether or not content has arrived — also how a later-resolving decode (`pending` below) finds the right slot. */
  assignedIndex: number | null;
  /** False from the moment a slot is (re)assigned a new index until that index's content has actually swapped in — see `isActiveReady()`. */
  ready: boolean;
}

/** A fully-built, ready-to-display node for a given item index — survives slot reassignment (see `cache` below), unlike `Slot.ready`, which resets the moment its slot moves on to a different index. */
interface CacheEntry {
  node: HTMLElement;
  item: GalleryItem;
  /** Video play-overlay button, if any — travels with `node` across cache reuse. */
  extra?: HTMLElement;
}

export interface SlideManagerOptions {
  preload: number;
  /** Play-overlay button's label. */
  playVideoLabel: string;
  videoProviders: Map<string, VideoProviderRenderer>;
}

/**
 * DESIGN.md §2.3 — only `currentIndex ± preload` exist in the DOM. Content
 * already resident and ready is never moved between slots — the slot that
 * already holds it just gets its own `offset` relabeled to its new pool
 * position; only content resident nowhere yet gets built fresh into
 * whatever's left over. O(preload) re-render cost either way, but never a
 * DOM reparent — which matters for a provider video's `<iframe>` (§4.3):
 * most browsers reload an iframe moved to a new parent, so a live embed can
 * only safely change position by relabeling, never by being moved.
 */
export class SlideManager {
  readonly element: HTMLElement;
  private readonly slots: Slot[];
  private readonly preload: number;
  private readonly playVideoLabel: string;
  private readonly videoProviders: Map<string, VideoProviderRenderer>;
  private dragOffsetPx = 0;

  /** Ready nodes keyed by item index — trimmed to `centerIndex ± preload` each `render()`, same window the slots cover, so an evicted entry's video/iframe resources get released even if no slot ever reclaims it. */
  private readonly cache = new Map<number, CacheEntry>();

  /**
   * Image decodes in flight, keyed by item index, not by whichever slot
   * started them — a real bug this fixes: navigating before a preload
   * decode resolved used to reassign that slot, abandoning the decode and
   * starting a duplicate elsewhere, so a slow preload could never finish,
   * only restart. `reveal()` looks up which slot currently wants this
   * index at resolve time, so a reshuffled pool still lands it correctly.
   */
  private readonly pending = new Map<number, HTMLImageElement>();

  constructor(options: SlideManagerOptions) {
    this.element = document.createElement('div');
    this.element.className = 'shoji-slides';
    this.preload = options.preload;
    this.playVideoLabel = options.playVideoLabel;
    this.videoProviders = options.videoProviders;

    const count = options.preload * 2 + 1;
    this.slots = Array.from({ length: count }, (_, i) => {
      const offset = i - options.preload;
      const root = document.createElement('div');
      root.className = 'shoji-slide';

      const media = document.createElement('div');
      media.className = 'shoji-slide-media';
      root.appendChild(media);

      this.element.appendChild(root);
      return { root, media, offset, assignedIndex: null, ready: false };
    });
    this.applyTransforms(null);
  }

  /** The active slot's `.shoji-slide-media` — not `.shoji-slide`, whose transform is owned by pool-offset positioning. */
  getActiveMedia(): HTMLElement | null {
    return this.slots.find((slot) => slot.offset === 0)?.media ?? null;
  }

  /** False while the active slot's content is still decoding — Gallery.ts uses this right after `render()` to show the loading state immediately, without waiting for `onLoad`. */
  isActiveReady(): boolean {
    return this.slots.find((slot) => slot.offset === 0)?.ready ?? false;
  }

  /**
   * DESIGN.md §2.4 — live drag-to-navigate feedback: every slot's
   * structural `offset * 100%` position gets this same `px` added on top,
   * so dragging left/right visually slides the whole pool together (the
   * adjacent preloaded slot already exists at `±100%`) — no new DOM, no
   * content re-render mid-drag. `transition`: `null` during the live drag
   * (1:1 with the pointer); a real value only for the post-release settle
   * animation, reset back to `null` once that transition ends.
   */
  setDragOffset(px: number, transition: string | null): void {
    this.dragOffsetPx = px;
    this.applyTransforms(transition);
  }

  /** The pool slot's `.shoji-slide` root at a structural offset — what the drag settle animation (§2.4) waits for `transitionend` on. */
  getSlotRoot(offset: number): HTMLElement | null {
    return this.slots.find((slot) => slot.offset === offset)?.root ?? null;
  }

  private applyTransforms(transition: string | null): void {
    for (const slot of this.slots) {
      slot.root.style.transition = transition ?? '';
      slot.root.style.transform = `translateX(calc(${slot.offset * 100}% + ${this.dragOffsetPx}px))`;
    }
  }

  /** Re-renders whichever slots need a different item; `onLoad` fires per index once its media settles. `openPlaceholderSrc` (only from `Gallery.open()`) swaps the centerIndex slot's spinner for a low-res placeholder once it decodes, if not already ready. */
  render(
    items: readonly GalleryItem[],
    centerIndex: number,
    onLoad: (index: number) => void,
    openPlaceholderSrc?: string,
  ): void {
    // Trim the cache to the same centerIndex ± preload window the slots
    // cover — releases a dropped video here rather than just letting the
    // reference disappear (which would leave it paused-in-place, never
    // actually released).
    for (const [index, entry] of this.cache) {
      if (index < centerIndex - this.preload || index > centerIndex + this.preload) {
        releaseVideoNode(entry.node);
        this.cache.delete(index);
      }
    }

    const targets = this.slots.map((_, i) => {
      const offset = i - this.preload;
      const index = centerIndex + offset;
      const item = index >= 0 && index < items.length ? items[index] : undefined;
      return { offset, index, item };
    });

    // Phase 1 — claim in place, before anything gets destructively
    // released. A target already resident and ready in *some* slot (not
    // necessarily the one whose own offset happens to match) stays exactly
    // where it is — only that slot's `offset` moves (see the class comment
    // above). Still mid-decode elsewhere isn't claimed here (no `ready`
    // slot yet) — falls through to phase 2, where `ensureImageDecoding`'s
    // in-flight guard reconciles it once the one real decode resolves.
    const claimedIndices = new Set<number>();
    const claimedSlots = new Set<Slot>();
    for (const target of targets) {
      if (!target.item) continue;
      const owner = this.slots.find((s) => s.assignedIndex === target.index && s.ready);
      if (!owner) continue;
      claimedIndices.add(target.index);
      claimedSlots.add(owner);
      if (owner.offset === target.offset) continue; // already exactly right, nothing to do
      owner.offset = target.offset;
      onLoad(target.index);
    }

    // Phase 2 — whatever's left: slots phase 1 didn't claim are free to
    // clear (out-of-range target) or take on fresh content (a genuinely
    // new index, or one already mid-decode elsewhere).
    const freeSlots = this.slots.filter((s) => !claimedSlots.has(s));
    const freeTargets = targets.filter((t) => !t.item || !claimedIndices.has(t.index));

    freeTargets.forEach((target, i) => {
      const slot = freeSlots[i]!;
      slot.offset = target.offset;
      const { index, item } = target;

      if (!item) {
        slot.assignedIndex = null;
        slot.ready = false;
        releaseVideo(slot.media);
        slot.media.replaceChildren();
        return;
      }
      if (slot.assignedIndex === index) return; // unchanged — a decode already in flight here

      slot.assignedIndex = index;
      slot.ready = false;
      releaseVideo(slot.media);
      slot.media.replaceChildren(createSpinner());
      if (index === centerIndex && openPlaceholderSrc) {
        const naturalSize =
          item.width && item.height ? { width: item.width, height: item.height } : undefined;
        this.revealOpenPlaceholder(openPlaceholderSrc, slot, index, naturalSize);
      }

      if (item.video?.provider === 'html5') {
        this.renderVideo(item, slot, index, onLoad);
      } else if (item.video) {
        this.renderProviderVideo(item, slot, index, onLoad);
      } else {
        this.ensureImageDecoding(item, index, onLoad); // no-ops if index is already being decoded elsewhere
      }
    });

    // Reflect any relabeling above immediately, never animated — masked
    // either by SlideTransition's own ghost-clone crossfade, or by landing
    // exactly on a completed drag's already-settled position (§2.4);
    // animating this too would fight both.
    this.applyTransforms(null);
  }

  private applyAspect(slot: Slot, item: GalleryItem): void {
    if (item.width && item.height) {
      slot.media.style.aspectRatio = `${item.width} / ${item.height}`;
    } else {
      slot.media.style.removeProperty('aspect-ratio');
    }
  }

  /** Releases the slot's old content and swaps the new node in, caching it. `extra` rides as a second child. `ensureImageDecoding` goes through `moveIn` instead. */
  private swapIn(
    slot: Slot,
    node: HTMLElement,
    item: GalleryItem,
    index: number,
    extra?: HTMLElement,
  ): void {
    releaseVideo(slot.media);
    this.applyAspect(slot, item);
    if (extra) slot.media.replaceChildren(node, extra);
    else slot.media.replaceChildren(node);
    slot.ready = true;
    this.cache.set(index, { node, item, extra });
  }

  /**
   * Inserts a just-decoded node into the slot waiting on it — skips
   * `releaseVideo`, unlike `swapIn`: this is its first insertion anywhere,
   * nothing outgoing to release. `render()`'s claim pass (Phase 1) never
   * calls this — it reuses `ready` content in place, no DOM touch at all.
   */
  private moveIn(slot: Slot, entry: CacheEntry, index: number): void {
    this.applyAspect(slot, entry.item);
    if (entry.extra) slot.media.replaceChildren(entry.node, entry.extra);
    else slot.media.replaceChildren(entry.node);
    slot.ready = true;
    this.cache.set(index, entry);
  }

  /** Starts decoding `item` for `index`, only if nothing already is (see `pending`). Resolves by looking up whichever slot currently wants this index, not the one active when the decode started. */
  private ensureImageDecoding(
    item: GalleryItem,
    index: number,
    onLoad: (index: number) => void,
  ): void {
    if (this.pending.has(index)) return;

    const img = document.createElement('img');
    img.className = 'shoji-slide-img';
    img.alt = item.alt ?? '';
    // A real bug: <img> is natively draggable by default in every browser
    // (drag-to-save-elsewhere). Left on, a real drag gesture — navigate,
    // vertical-close, or the zoom plugin's own pan — can lose the race to
    // the browser's own "start a native image drag" recognition, which
    // fires pointercancel and hands the interaction off to dragstart/drag
    // instead: the gesture appears to move once, then stop dead, since
    // every pointer event after the cancel is simply never dispatched here
    // again. Disabling native drag makes Pointer Events own the gesture
    // unconditionally.
    img.draggable = false;
    // The one image the viewer is actually waiting on — hint the browser to
    // schedule it ahead of any lower-priority background fetches contending
    // for the same connection pool.
    if ('fetchPriority' in img) img.fetchPriority = 'high';
    if (item.srcset) img.srcset = item.srcset;
    if (item.sizes) img.sizes = item.sizes;
    img.src = item.src;
    this.pending.set(index, img);

    const reveal = (): void => {
      this.pending.delete(index);
      const entry: CacheEntry = { node: img, item };
      this.cache.set(index, entry);
      const slot = this.slots.find((s) => s.assignedIndex === index);
      if (!slot) return; // nobody currently wants it anymore
      this.moveIn(slot, entry, index);
      onLoad(index);
    };

    if (typeof img.decode === 'function') {
      img.decode().then(reveal, reveal);
    } else {
      img.addEventListener('load', reveal, { once: true });
      img.addEventListener('error', reveal, { once: true });
    }
  }

  /**
   * DESIGN.md §2.3 — swaps the spinner for the placeholder once *it*
   * decodes, not immediately: `item.thumb` is often just `item.src` again,
   * so an undecoded placeholder can leave as long a blank gap as the
   * spinner it replaces.
   *
   * A real bug: `.shoji-slide-open-placeholder`'s CSS unconditionally
   * force-fills the frame (deliberate default: a real photo is usually
   * bigger than the dialog). Wrong for a genuinely small photo with known
   * `item.width`/`item.height` — same "grows too big, snaps down once real"
   * symptom the zoom-in transition itself had (§2.3b), but that fix only
   * governs the animated *transform*, not this placeholder's own CSS box
   * once it settles. When `naturalSize` is known, sizes the placeholder
   * explicitly instead, reusing `containedBox` (`zoomTransition.ts`) —
   * unknown-size items keep the original force-fill guess.
   */
  private revealOpenPlaceholder(
    src: string,
    slot: Slot,
    index: number,
    naturalSize?: { width: number; height: number },
  ): void {
    const img = createOpenPlaceholder(src);
    const reveal = (): void => {
      if (slot.assignedIndex !== index || slot.ready) return; // stale, or the real content already won the race
      // Only the spinner, not slot.media wholesale — a provider video may
      // have already appended its own (still-hidden) container alongside it.
      slot.media.querySelector('.shoji-slide-spinner')?.remove();
      slot.media.appendChild(img);
      if (naturalSize) {
        const containerRect = slot.media.getBoundingClientRect();
        const box = containedBox(
          { left: 0, top: 0, width: containerRect.width, height: containerRect.height },
          naturalSize.width / naturalSize.height,
          naturalSize,
        );
        img.style.width = `${box.width}px`;
        img.style.height = `${box.height}px`;
      }
    };
    if (typeof img.decode === 'function') {
      img.decode().then(reveal, reveal);
    } else {
      img.addEventListener('load', reveal, { once: true });
      img.addEventListener('error', reveal, { once: true });
    }
  }

  /** Native `<video controls>` — real playback, not just a poster. Not autoplayed/muted: a deliberate click-to-play, not a background loop. */
  private renderVideo(
    item: GalleryItem,
    slot: Slot,
    index: number,
    onLoad: (index: number) => void,
  ): void {
    const hasSource = Boolean(item.src) || Boolean(item.sources && item.sources.length > 0);
    if (!hasSource) {
      const placeholder = document.createElement('div');
      placeholder.className = 'shoji-slide-placeholder';
      placeholder.textContent = 'Video';
      this.swapIn(slot, placeholder, item, index);
      onLoad(index);
      return;
    }

    const video = document.createElement('video');
    video.className = 'shoji-slide-video';
    video.controls = true;
    video.playsInline = true;
    if (item.poster) video.poster = item.poster;

    if (item.sources && item.sources.length > 0) {
      for (const s of item.sources) {
        const source = document.createElement('source');
        source.src = s.src;
        source.type = s.type;
        video.appendChild(source);
      }
    } else {
      video.src = item.src;
    }

    // Inserted immediately (unlike the image path above) — the native
    // `poster` attribute already shows something meaningful without
    // waiting on `loadedmetadata`, so there's no decode-style gap to close
    // here; deferring would only make video slides slower to show anything.
    this.swapIn(slot, video, item, index, this.createVideoPlayOverlay(video));
    const reveal = (): void => onLoad(index);
    video.addEventListener('loadedmetadata', reveal, { once: true });
    video.addEventListener('error', reveal, { once: true });
  }

  /** Tracks the video's own play/pause/ended state. Hide `.shoji-video-play-overlay` in CSS to opt out. */
  private createVideoPlayOverlay(video: HTMLVideoElement): HTMLElement {
    const overlay = document.createElement('button');
    overlay.type = 'button';
    overlay.className = 'shoji-video-play-overlay';
    overlay.innerHTML = PLAY_ICON;
    overlay.ariaLabel = overlay.title = this.playVideoLabel;
    overlay.hidden = !video.paused;

    let pauseTimer: ReturnType<typeof setTimeout> | null = null;
    const clearPauseTimer = (): void => {
      if (pauseTimer === null) return;
      clearTimeout(pauseTimer);
      pauseTimer = null;
    };

    overlay.addEventListener('click', (event) => {
      event.stopPropagation();
      // A broken/missing source (bad path, unsupported format) rejects with
      // NotSupportedError — a real, if unusual, host-data problem, not a
      // reason to crash with an unhandled rejection; the native controls
      // already show their own error state once the 'error' event fires.
      video.play().catch(() => {});
    });
    video.addEventListener('play', () => {
      clearPauseTimer();
      overlay.hidden = true;
    });
    video.addEventListener('pause', () => {
      clearPauseTimer();
      pauseTimer = setTimeout(() => {
        pauseTimer = null;
        if (video.paused) overlay.hidden = false;
      }, PAUSE_OVERLAY_DELAY_MS);
    });
    video.addEventListener('ended', () => {
      clearPauseTimer();
      overlay.hidden = false;
    });
    return overlay;
  }

  /** DESIGN.md §4-video. Unregistered provider → same placeholder as no-source video. */
  private renderProviderVideo(
    item: GalleryItem,
    slot: Slot,
    index: number,
    onLoad: (index: number) => void,
  ): void {
    const video = item.video!;
    const renderFn =
      video.provider === 'custom' ? video.render : this.videoProviders.get(video.provider);

    if (!renderFn) {
      const placeholder = document.createElement('div');
      placeholder.className = 'shoji-slide-placeholder';
      placeholder.textContent = 'Video';
      this.swapIn(slot, placeholder, item, index);
      onLoad(index);
      return;
    }

    const container = document.createElement('div');
    container.className = 'shoji-slide-provider-video';
    container.hidden = true;
    const controller = new AbortController();
    providerAbortControllers.set(container, controller);

    // Unlike an <img> decode, an iframe embed only actually loads once
    // attached to the live document — attach now, hidden behind the
    // still-visible spinner, instead of deferring attachment until ready.
    slot.media.appendChild(container);

    let revealed = false;
    const onReady = (): void => {
      if (revealed || controller.signal.aborted) return;
      revealed = true;
      container.hidden = false;
      // Whichever loading indicator (Phase 2's spinner, or an open placeholder) is
      // still sitting behind the now-visible embed — never the embed itself.
      slot.media.querySelector('.shoji-slide-spinner, .shoji-slide-open-placeholder')?.remove();
      this.applyAspect(slot, item);
      slot.ready = true;
      this.cache.set(index, { node: container, item });
      onLoad(index);
    };
    renderFn(container, item, onReady, controller.signal);
  }

  destroy(): void {
    for (const slot of this.slots) {
      releaseVideo(slot.media);
      slot.media.replaceChildren();
      slot.assignedIndex = null; // any decode still in `pending` correctly finds no slot wanting it once it resolves
      slot.ready = false;
    }
    this.cache.clear();
    this.pending.clear();
    this.element.remove();
  }
}

/** DESIGN.md §2.3 — low-res open() placeholder; reuses .shoji-slide-img's sizing so the zoom-in FLIP measures it like real content (zoomTransition.ts's effectiveTargetBox only special-cases the spinner as non-content). */
function createOpenPlaceholder(src: string): HTMLImageElement {
  const img = document.createElement('img');
  img.className = 'shoji-slide-img shoji-slide-open-placeholder';
  img.alt = '';
  img.draggable = false;
  img.src = src;
  return img;
}

/** DESIGN.md §2.3 — shown in a slot while its content is still decoding/loading, replacing whatever a stale "keep the old image visible" approach would have left there (a previous version of this did that; it read as broken, not helpful, since the old image no longer matches the caption/counter/URL that already moved on). Purely CSS-animated (a rotating ring via `border`), no JS-driven layout. */
function createSpinner(): HTMLElement {
  const spinner = document.createElement('div');
  spinner.className = 'shoji-slide-spinner';
  spinner.setAttribute('aria-hidden', 'true');
  return spinner;
}

const providerAbortControllers = new WeakMap<HTMLElement, AbortController>();

/** Pause/release a slot's previous <video> or provider content, if any. */
function releaseVideo(media: HTMLElement): void {
  const video = media.querySelector('video');
  if (video) releaseVideoNode(video);
  const provider = media.querySelector<HTMLElement>('.shoji-slide-provider-video');
  if (provider) releaseProviderNode(provider);
}

/**
 * Pauses whatever's playing in `media` — native `<video>`, or a provider
 * embed wired via `wirePlayableContract` (§4-video) — without
 * releasing/destroying it, unlike `releaseVideo` above. `Gallery` calls
 * this on `close()` and before every navigation, on the outgoing slide.
 */
export function pauseMedia(media: HTMLElement | null): void {
  const video = media?.querySelector('video');
  if (video) {
    video.pause();
    return;
  }
  const provider = media?.querySelector<HTMLElement & { pause?: () => void }>(
    '.shoji-slide-provider-video',
  );
  if (provider && typeof provider.pause === 'function') provider.pause();
}

/** Cache-eviction counterpart — the node itself might *be* the content. */
function releaseVideoNode(node: HTMLElement): void {
  if (node.tagName !== 'VIDEO') {
    releaseProviderNode(node);
    return;
  }
  const video = node as HTMLVideoElement;
  video.pause();
  video.removeAttribute('src');
  video.load();
}

function releaseProviderNode(node: HTMLElement): void {
  const controller = providerAbortControllers.get(node);
  if (!controller) return;
  providerAbortControllers.delete(node);
  controller.abort();
}
