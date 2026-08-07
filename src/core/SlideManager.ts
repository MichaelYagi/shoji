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
  private nextRequestId = 0;
  private dragOffsetPx = 0;

  constructor(options: SlideManagerOptions) {
    this.element = document.createElement('div');
    this.element.className = 'shoji-slides';

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
    for (const slot of this.slots) {
      const index = centerIndex + slot.offset;
      const item = index >= 0 && index < items.length ? items[index] : undefined;

      if (!item) {
        slot.assignedIndex = null;
        slot.ready = false;
        releaseVideo(slot.media);
        slot.media.replaceChildren();
        continue;
      }
      if (slot.assignedIndex === index) continue;

      slot.assignedIndex = index;
      slot.ready = false;
      const requestId = ++this.nextRequestId;
      slot.requestId = requestId;
      this.renderItem(item, slot, index, requestId, onLoad);
    }
  }

  /**
   * Deliberately does *not* touch `slot.media` up front — whatever was
   * showing before (the previous index's image/video) stays on screen
   * until the new content is actually ready to replace it, in `swapIn()`
   * below. Navigating used to clear the slot immediately, then leave it
   * blank until `img.decode()` resolved — a real, always-there gap (not
   * just a slow-network edge case), since `decode()` is never synchronous.
   * DESIGN.md §2.3.
   */
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

  /** Only called once new content is actually ready to display — releases whatever the slot showed before and swaps the new node in, atomically (old and new are never both visible, and there's never a gap with neither). */
  private swapIn(slot: Slot, node: Node, item: GalleryItem): void {
    releaseVideo(slot.media);
    if (item.width && item.height) {
      slot.media.style.aspectRatio = `${item.width} / ${item.height}`;
    } else {
      slot.media.style.removeProperty('aspect-ratio');
    }
    slot.media.replaceChildren(node);
    slot.ready = true;
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
      this.swapIn(slot, img, item);
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
      this.swapIn(slot, placeholder, item);
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
    this.swapIn(slot, video, item);
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
    this.element.remove();
  }
}

/** Pause and release a slot's previous <video>, if any — removing it from the DOM alone doesn't stop playback or free network/decoder resources. */
function releaseVideo(media: HTMLElement): void {
  const video = media.querySelector('video');
  if (!video) return;
  video.pause();
  video.removeAttribute('src');
  video.load();
}
