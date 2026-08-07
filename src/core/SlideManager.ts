import type { GalleryItem } from './types';

interface Slot {
  root: HTMLElement;
  media: HTMLElement;
  offset: number;
  assignedIndex: number | null;
  requestId: number;
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
  private nextRequestId = 0;
  private dragOffsetPx = 0;

  /**
   * Ready-to-display nodes keyed by item index, not slot offset — the piece
   * that makes `preload` actually prevent a spinner on a "preloaded"
   * neighbor, not just keep something mounted for the drag illusion. A
   * `Slot` only remembers *its own* previous index (`assignedIndex`); it has
   * no way to know that some *other* slot already finished decoding the
   * exact index it's now being asked to show (a routine case — navigating
   * forward one step needs today's +1 slot content moved into the 0 slot).
   * Without this cache, that already-decoded content gets thrown away and
   * redecoded from scratch on every single step, spinner included, even
   * though nothing about the image itself changed. Trimmed to
   * `centerIndex ± preload` on every `render()` call, same window the
   * slots themselves cover, so it never grows past what's actually still
   * relevant.
   */
  private readonly cache = new Map<number, CacheEntry>();

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
      return { root, media, offset, assignedIndex: null, requestId: 0, ready: false };
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
    // themselves cover — an index that's fallen out of range for every
    // slot is never coming back without a fresh decode anyway (the pool
    // can only ever hold this many neighbors at once). Releases a video
    // being dropped here (its node isn't attached to any slot that's about
    // to reclaim it — see moveIn's doc comment) rather than just letting
    // the reference disappear, which would leave it paused-in-place but
    // never actually released.
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

    // Phase 1 — claim every cache hit first, moving already-decoded content
    // into its new slot before anything gets destructively released. Order
    // matters: navigating can require slot A's *current* content to become
    // slot B's *new* content within this same call (stepping backward
    // shifts every slot's content down by one, all at once) — releasing a
    // slot's outgoing content (pausing/clearing a <video>) before some
    // other slot has had a chance to reclaim it via the cache would
    // destroy content that's still needed a few lines later.
    for (const { slot, index, item } of targets) {
      if (!item || slot.assignedIndex === index) continue;
      const cached = this.cache.get(index);
      if (!cached) continue;
      slot.assignedIndex = index;
      // Invalidates any in-flight decode this slot itself was mid-request
      // for (e.g. a rapid back-and-forth landing back on an index whose
      // decode from a moment ago hadn't resolved yet) so that stale reveal
      // can't land after this one.
      slot.requestId = ++this.nextRequestId;
      this.moveIn(slot, cached, index);
      onLoad(index);
    }

    // Phase 2 — whatever's left: out-of-range slots get cleared, and
    // anything not already resolved above starts a fresh decode behind a
    // spinner. Anything still sitting in one of these slots at this point
    // is confirmed stale — phase 1 already reclaimed everything reusable,
    // via simple reparenting, without releasing it.
    for (const { slot, index, item } of targets) {
      if (!item) {
        slot.assignedIndex = null;
        slot.ready = false;
        slot.requestId = ++this.nextRequestId; // invalidate any in-flight decode still targeting this slot
        releaseVideo(slot.media);
        slot.media.replaceChildren();
        continue;
      }
      if (slot.assignedIndex === index) continue; // unchanged, or already resolved by phase 1

      slot.assignedIndex = index;
      slot.ready = false;
      releaseVideo(slot.media);
      slot.media.replaceChildren(createSpinner());
      const requestId = ++this.nextRequestId;
      slot.requestId = requestId;
      this.renderItem(item, slot, index, requestId, onLoad);
    }
  }

  private renderItem(
    item: GalleryItem,
    slot: Slot,
    index: number,
    requestId: number,
    onLoad: (index: number) => void,
  ): void {
    if (item.video) {
      this.renderVideo(item, slot, index, onLoad);
    } else {
      this.renderImage(item, slot, requestId, index, onLoad);
    }
  }

  private applyAspect(slot: Slot, item: GalleryItem): void {
    if (item.width && item.height) {
      slot.media.style.aspectRatio = `${item.width} / ${item.height}`;
    } else {
      slot.media.style.removeProperty('aspect-ratio');
    }
  }

  /** Only called once genuinely new content (a fresh decode, or the no-source video placeholder) is ready to display — releases whatever stale content the slot held (always just the loading spinner by the time this fires; `render()`'s fresh-decode branch already released and replaced the slot's real previous content up front) and swaps the new node in. Also populates `cache`, so a later navigation back to this exact index can reuse it via `moveIn` instead of redecoding. */
  private swapIn(slot: Slot, node: HTMLElement, item: GalleryItem, index: number): void {
    releaseVideo(slot.media);
    this.applyAspect(slot, item);
    slot.media.replaceChildren(node);
    slot.ready = true;
    this.cache.set(index, { node, item });
  }

  /**
   * Moves an already-cached, ready node from wherever it currently sits
   * (another slot, or this slot's own earlier content) into `slot` —
   * deliberately does *not* call `releaseVideo` first, unlike `swapIn`:
   * whatever `slot` currently holds might itself still be a live cache
   * entry that some *other* slot in this same `render()` pass is about to
   * reclaim (see the "Phase 1" comment there). Plain reparenting via
   * `replaceChildren` is always safe regardless of what it displaces — it
   * doesn't pause or reset a `<video>`, only an explicit `releaseVideo`
   * call does that; only `render()`'s later fresh/clear pass, once every
   * reusable node has already been claimed, is where genuinely stale
   * leftover content gets released for good.
   */
  private moveIn(slot: Slot, entry: CacheEntry, index: number): void {
    this.applyAspect(slot, entry.item);
    slot.media.replaceChildren(entry.node);
    slot.ready = true;
    this.cache.set(index, entry);
  }

  private renderImage(
    item: GalleryItem,
    slot: Slot,
    requestId: number,
    index: number,
    onLoad: (index: number) => void,
  ): void {
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

    const reveal = (): void => {
      if (slot.requestId !== requestId) return; // superseded by a newer render for this slot
      this.swapIn(slot, img, item, index);
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
    this.nextRequestId++; // invalidates any in-flight decode() callbacks
    for (const slot of this.slots) {
      releaseVideo(slot.media);
      slot.media.replaceChildren();
      slot.assignedIndex = null;
      slot.ready = false;
    }
    this.cache.clear();
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

/** Pause and release a slot's previous <video>, if any — removing it from the DOM alone doesn't stop playback or free network/decoder resources. Scoped to a *container* (a slot's `.shoji-slide-media`); see `releaseVideoNode` for the cache-eviction case, where the node in hand might be the `<video>` itself rather than a wrapper around one. */
function releaseVideo(media: HTMLElement): void {
  const video = media.querySelector('video');
  if (video) releaseVideoNode(video);
}

/** The cache-eviction counterpart to `releaseVideo` above — `entry.node` (a cache value) is directly whatever `renderVideo`/`renderImage` built, so it might *be* the `<video>` element rather than contain one; a plain `querySelector('video')` on it would never match itself. No-ops for an `<img>` or the no-source placeholder `<div>`. */
function releaseVideoNode(node: HTMLElement): void {
  if (node.tagName !== 'VIDEO') return;
  const video = node as HTMLVideoElement;
  video.pause();
  video.removeAttribute('src');
  video.load();
}
