import type { GalleryItem } from './types';

interface Slot {
  root: HTMLElement;
  media: HTMLElement;
  offset: number;
  /** The index this slot currently wants to show, whether or not that content has arrived yet — also how a later-resolving decode (`pending` below) finds its way to the right slot. */
  assignedIndex: number | null;
  /** False from the moment a slot is (re)assigned a new index until that index's content has actually swapped in — see `isActiveReady()`. */
  ready: boolean;
}

/** A fully-built, ready-to-display node for a given item index — survives slot reassignment (see `cache` below), unlike `Slot.ready`, which resets the moment its slot moves on to a different index. */
interface CacheEntry {
  node: HTMLElement;
  item: GalleryItem;
}

export interface SlideManagerOptions {
  preload: number;
}

/**
 * DESIGN.md §2.3 — only `currentIndex ± preload` exist in the DOM. Rather
 * than diffing which physical node maps to which item, each pool slot has a
 * fixed structural offset (-preload…+preload) and its *content* is what gets
 * reassigned on navigation — same pattern most virtualized carousels use,
 * and it keeps re-render cost O(preload), never O(item count).
 */
export class SlideManager {
  readonly element: HTMLElement;
  private readonly slots: Slot[];
  private readonly preload: number;
  private dragOffsetPx = 0;

  /**
   * Ready nodes keyed by item index, not slot offset — a `Slot` only
   * remembers its *own* previous index, so it can't tell that some *other*
   * slot already decoded the exact index it's now asked to show (the
   * routine case: stepping forward moves the +1 slot's content into the 0
   * slot). Without this, already-decoded content is thrown away and
   * redecoded on every step. Trimmed to `centerIndex ± preload` each
   * `render()`, same window the slots cover.
   */
  private readonly cache = new Map<number, CacheEntry>();

  /**
   * Image decodes in flight, keyed by item index rather than by whichever
   * slot started them — a real bug this fixes: navigating before a preload
   * decode resolved used to reassign that slot to a different target,
   * abandoning the decode and starting a duplicate one elsewhere, so a
   * slow preload could never actually finish, only ever restart. `reveal()`
   * looks up which slot currently wants this index at resolve time (not
   * the slot that started the request), so a reshuffled pool still lands
   * it correctly, and it's a harmless no-op if nothing wants it anymore.
   */
  private readonly pending = new Map<number, HTMLImageElement>();

  constructor(options: SlideManagerOptions) {
    this.element = document.createElement('div');
    this.element.className = 'shoji-slides';
    this.preload = options.preload;

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

  /** The active (offset 0) slot's `.shoji-slide-media` element — not `.shoji-slide`, whose transform is already owned by pool-offset positioning. */
  getActiveMedia(): HTMLElement | null {
    return this.slots.find((slot) => slot.offset === 0)?.media ?? null;
  }

  /** False while the active (offset 0) slot's content is still decoding/loading — Gallery.ts uses this right after `render()` to know whether to show the loading state immediately, without waiting for `onLoad`. */
  isActiveReady(): boolean {
    return this.slots.find((slot) => slot.offset === 0)?.ready ?? false;
  }

  /**
   * DESIGN.md §2.4 — the gesture engine's live drag-to-navigate feedback:
   * every slot's structural `offset * 100%` position gets this same `px`
   * added on top, so dragging left/right visually slides the whole pool
   * together (the adjacent preloaded slot already exists at `±100%`,
   * sliding into view is exactly what makes the pooled-slide illusion
   * work — no new DOM, no content re-render mid-drag).
   *
   * `transition`: `null` during the live drag itself (1:1 with the
   * pointer, no lag) — a real CSS transition value (`momentumEasing`) only
   * for the settle animation after release, and *only* for that one
   * animated call; the caller is responsible for resetting it back to
   * `null` once the transition ends (matches the instant-jump-then-
   * transition-away FLIP pattern `zoomTransition.ts` already uses).
   */
  setDragOffset(px: number, transition: string | null): void {
    this.dragOffsetPx = px;
    this.applyTransforms(transition);
  }

  /** The pool slot's `.shoji-slide` root at a structural offset from center (0 = active) — what the drag settle animation (§2.4) waits for `transitionend` on. */
  getSlotRoot(offset: number): HTMLElement | null {
    return this.slots.find((slot) => slot.offset === offset)?.root ?? null;
  }

  private applyTransforms(transition: string | null): void {
    for (const slot of this.slots) {
      slot.root.style.transition = transition ?? '';
      slot.root.style.transform = `translateX(calc(${slot.offset * 100}% + ${this.dragOffsetPx}px))`;
    }
  }

  /** Re-renders whichever slots need a different item; `onLoad` fires per index once its media settles. */
  render(
    items: readonly GalleryItem[],
    centerIndex: number,
    onLoad: (index: number) => void,
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

    const targets = this.slots.map((slot) => {
      const index = centerIndex + slot.offset;
      const item = index >= 0 && index < items.length ? items[index] : undefined;
      return { slot, index, item };
    });

    // Phase 1 — claim every cache hit first, before anything gets
    // destructively released. Stepping backward can need slot A's current
    // content to become slot B's new content in this same call — releasing
    // it (pausing a <video>) before B reclaims it would destroy content
    // still needed a few lines later.
    for (const { slot, index, item } of targets) {
      if (!item || slot.assignedIndex === index) continue;
      const cached = this.cache.get(index);
      if (!cached) continue;
      slot.assignedIndex = index;
      this.moveIn(slot, cached, index);
      onLoad(index);
    }

    // Phase 2 — whatever's left: clear out-of-range slots, start/await a
    // decode behind a spinner for the rest. Anything still here is
    // confirmed stale — phase 1 already reclaimed what's reusable.
    for (const { slot, index, item } of targets) {
      if (!item) {
        slot.assignedIndex = null;
        slot.ready = false;
        releaseVideo(slot.media);
        slot.media.replaceChildren();
        continue;
      }
      if (slot.assignedIndex === index) continue; // unchanged, or already resolved by phase 1

      slot.assignedIndex = index;
      slot.ready = false;
      releaseVideo(slot.media);
      slot.media.replaceChildren(createSpinner());

      if (item.video) {
        this.renderVideo(item, slot, index, onLoad);
      } else {
        this.ensureImageDecoding(item, index, onLoad); // no-ops if index is already being decoded elsewhere
      }
    }
  }

  private applyAspect(slot: Slot, item: GalleryItem): void {
    if (item.width && item.height) {
      slot.media.style.aspectRatio = `${item.width} / ${item.height}`;
    } else {
      slot.media.style.removeProperty('aspect-ratio');
    }
  }

  /** Used by `renderVideo`'s two synchronous paths (the slot is already known at call time) — releases the slot's old content (always just a spinner by now) and swaps the new node in, caching it. `ensureImageDecoding` instead goes through `moveIn` once its decode settles, since which slot (if any) still wants it is only knowable then. */
  private swapIn(slot: Slot, node: HTMLElement, item: GalleryItem, index: number): void {
    releaseVideo(slot.media);
    this.applyAspect(slot, item);
    slot.media.replaceChildren(node);
    slot.ready = true;
    this.cache.set(index, { node, item });
  }

  /**
   * Moves an already-cached, ready node into `slot` — deliberately skips
   * `releaseVideo`, unlike `swapIn`: what `slot` currently holds might
   * still be a live cache entry another slot is about to reclaim this same
   * `render()` pass (see "Phase 1" above). Plain reparenting is always
   * safe; only `render()`'s later fresh/clear pass releases genuinely
   * stale content.
   */
  private moveIn(slot: Slot, entry: CacheEntry, index: number): void {
    this.applyAspect(slot, entry.item);
    slot.media.replaceChildren(entry.node);
    slot.ready = true;
    this.cache.set(index, entry);
  }

  /** Starts decoding `item` for `index`, but only if nothing is already decoding it (see `pending`) — dedup is the whole fix. Resolves by looking up whichever slot currently wants this index, not the one active when the decode started. */
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
   * Real, natively-controllable playback — not just the poster. Native
   * `<video controls>` gives play/pause/seek/volume/fullscreen for free, no
   * custom control UI needed. Not autoplayed and not muted: this is a
   * deliberate click-to-play by the viewer, not a background/preview loop,
   * so there's no browser autoplay-policy reason to mute it.
   */
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
    this.swapIn(slot, video, item, index);
    const reveal = (): void => onLoad(index);
    video.addEventListener('loadedmetadata', reveal, { once: true });
    video.addEventListener('error', reveal, { once: true });
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

/** DESIGN.md §2.3 — shown in a slot while its content is still decoding/loading, replacing whatever a stale "keep the old image visible" approach would have left there (a previous version of this did that; it read as broken, not helpful, since the old image no longer matches the caption/counter/URL that already moved on). Purely CSS-animated (a rotating ring via `border`), no JS-driven layout. */
function createSpinner(): HTMLElement {
  const spinner = document.createElement('div');
  spinner.className = 'shoji-slide-spinner';
  spinner.setAttribute('aria-hidden', 'true');
  return spinner;
}

/** Pause/release a slot's previous <video>, if any — removing it from the DOM alone doesn't stop playback or free decoder resources. Scoped to a *container* (`.shoji-slide-media`); see `releaseVideoNode` for when the node in hand might be the `<video>` itself. */
function releaseVideo(media: HTMLElement): void {
  const video = media.querySelector('video');
  if (video) releaseVideoNode(video);
}

/** Cache-eviction counterpart to `releaseVideo` — a cache entry's node is directly whatever `renderVideo`/`ensureImageDecoding` built, so it might *be* the `<video>`, not contain one. No-ops for an `<img>` or the placeholder `<div>`. */
function releaseVideoNode(node: HTMLElement): void {
  if (node.tagName !== 'VIDEO') return;
  const video = node as HTMLVideoElement;
  video.pause();
  video.removeAttribute('src');
  video.load();
}
