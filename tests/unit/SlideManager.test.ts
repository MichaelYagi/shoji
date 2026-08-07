import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SlideManager } from '../../src/core/SlideManager';
import type { GalleryItem } from '../../src/core/types';

// This jsdom doesn't implement HTMLImageElement.decode() at all (and doesn't do
// real resource loading, so 'load'/'error' never fire either) — stub decode()
// the way a real browser would resolve it, so the reveal path is exercised.
beforeEach(() => {
  HTMLImageElement.prototype.decode = vi.fn().mockResolvedValue(undefined);
});

afterEach(() => {
  // @ts-expect-error - removing the test-only stub added above
  delete HTMLImageElement.prototype.decode;
});

const items: GalleryItem[] = [
  { id: 'a', src: 'a.jpg', width: 800, height: 600, alt: 'A' },
  { id: 'b', src: 'b.jpg' },
  { id: 'c', src: 'c.jpg' },
  { id: 'video', src: 'v.mp4', video: { provider: 'html5' }, poster: 'poster.jpg' },
  { id: 'video-no-source', src: '', video: { provider: 'html5' } }, // no playable src or sources
];

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('SlideManager', () => {
  it('creates 2*preload+1 pool slots, positioned by fixed offset', () => {
    const manager = new SlideManager({ preload: 1 });
    const slots = manager.element.querySelectorAll('.shoji-slide');
    expect(slots).toHaveLength(3);
    // DESIGN.md §2.4 — each slot's transform is now offset*100% plus a live
    // drag-offset px term (0 at rest) so the gesture engine's setDragOffset
    // can animate the whole pool without SlideManager needing a second
    // code path for "structural position" vs. "structural position + drag".
    expect((slots[0] as HTMLElement).style.transform).toBe('translateX(calc(-100% + 0px))');
    expect((slots[1] as HTMLElement).style.transform).toBe('translateX(calc(0% + 0px))');
    expect((slots[2] as HTMLElement).style.transform).toBe('translateX(calc(100% + 0px))');
  });

  it('supports preload:0 (single slot)', () => {
    const manager = new SlideManager({ preload: 0 });
    expect(manager.element.querySelectorAll('.shoji-slide')).toHaveLength(1);
  });

  it('renders the image, calls onLoad, and sets aspect-ratio when width/height are known', async () => {
    const manager = new SlideManager({ preload: 0 });
    const onLoad = vi.fn();

    manager.render(items, 0, onLoad);
    await flush();

    const media = manager.element.querySelector('.shoji-slide-media') as HTMLElement;
    expect(media.style.aspectRatio).toBe('800 / 600');
    const img = media.querySelector('img.shoji-slide-img') as HTMLImageElement;
    expect(img.src).toContain('a.jpg');
    expect(img.alt).toBe('A');
    expect(onLoad).toHaveBeenCalledWith(0);
  });

  it('keeps the previous image on screen until the new one finishes decoding, then swaps atomically', async () => {
    const manager = new SlideManager({ preload: 0 });
    manager.render(items, 0, vi.fn()); // image 'a'
    await flush();
    const imgA = manager.element.querySelector('img') as HTMLImageElement;
    expect(imgA.src).toContain('a.jpg');

    // Control exactly when 'b' finishes decoding, instead of the global
    // auto-resolving mock, to observe the mid-flight state.
    let resolveDecode!: () => void;
    HTMLImageElement.prototype.decode = vi.fn(
      () => new Promise<void>((resolve) => (resolveDecode = resolve)),
    );

    manager.render(items, 1, vi.fn()); // navigate to image 'b'

    // Still showing 'a' — the slot was never cleared while 'b' decodes.
    expect(manager.element.querySelector('img')).toBe(imgA);
    expect(manager.element.querySelector('img')?.getAttribute('src')).toContain('a.jpg');

    resolveDecode();
    await flush();

    const imgB = manager.element.querySelector('img') as HTMLImageElement;
    expect(imgB).not.toBe(imgA);
    expect(imgB.src).toContain('b.jpg');
  });

  it('isActiveReady() is false while the active slide is still loading and true once it settles', async () => {
    const manager = new SlideManager({ preload: 0 });
    expect(manager.isActiveReady()).toBe(false); // nothing rendered yet

    manager.render(items, 0, vi.fn());
    expect(manager.isActiveReady()).toBe(false); // decode() is always async, never resolved synchronously
    await flush();
    expect(manager.isActiveReady()).toBe(true);
  });

  it('isActiveReady() stays true immediately when re-navigating to an already-rendered index (no new load triggered)', async () => {
    const manager = new SlideManager({ preload: 0 });
    manager.render(items, 0, vi.fn());
    await flush();
    expect(manager.isActiveReady()).toBe(true);

    manager.render(items, 0, vi.fn()); // same index — render() skips it entirely
    expect(manager.isActiveReady()).toBe(true);
  });

  it('disables native image drag (real bug: browser-native "drag this image out" cancels the pointer sequence a real drag/pan gesture needs)', async () => {
    const manager = new SlideManager({ preload: 0 });
    manager.render(items, 0, vi.fn());
    await flush();

    const img = manager.element.querySelector('img.shoji-slide-img') as HTMLImageElement;
    expect(img.draggable).toBe(false);
  });

  it('leaves out aspect-ratio when width/height are absent', async () => {
    const manager = new SlideManager({ preload: 0 });
    manager.render(items, 1, vi.fn());
    await flush();

    const media = manager.element.querySelector('.shoji-slide-media') as HTMLElement;
    expect(media.style.aspectRatio).toBe('');
  });

  it('renders a video item as a real, natively-controllable <video>', () => {
    const manager = new SlideManager({ preload: 0 });
    const onLoad = vi.fn();

    manager.render(items, 3, onLoad);

    const video = manager.element.querySelector('video.shoji-slide-video') as HTMLVideoElement;
    expect(video).not.toBeNull();
    expect(video.controls).toBe(true);
    expect(video.playsInline).toBe(true);
    expect(video.poster).toContain('poster.jpg');
    expect(video.src).toContain('v.mp4');
    expect(video.muted).toBe(false); // deliberate click-to-play, not an autoplay preview
    expect(onLoad).not.toHaveBeenCalled(); // only once loadedmetadata actually fires

    video.dispatchEvent(new Event('loadedmetadata'));
    expect(onLoad).toHaveBeenCalledWith(3);
  });

  it('renders item.sources as <source> children instead of a bare src', () => {
    const withSources: GalleryItem = {
      id: 'v-sources',
      src: 'ignored.mp4',
      video: { provider: 'html5' },
      sources: [
        { src: 'v.webm', type: 'video/webm' },
        { src: 'v.mp4', type: 'video/mp4' },
      ],
    };
    const manager = new SlideManager({ preload: 0 });

    manager.render([withSources], 0, vi.fn());

    const video = manager.element.querySelector('video.shoji-slide-video') as HTMLVideoElement;
    const sources = Array.from(video.querySelectorAll('source'));
    expect(sources).toHaveLength(2);
    expect(sources[0]?.type).toBe('video/webm');
    expect(sources[1]?.type).toBe('video/mp4');
  });

  it('renders a placeholder when a video item has no src or sources at all', () => {
    const manager = new SlideManager({ preload: 0 });
    const onLoad = vi.fn();

    manager.render(items, 4, onLoad);

    const placeholder = manager.element.querySelector('.shoji-slide-placeholder');
    expect(placeholder?.textContent).toBe('Video');
    expect(manager.element.querySelector('video')).toBeNull();
    expect(onLoad).toHaveBeenCalledWith(4);
  });

  it('keeps the previous video visible/playing until the new content actually swaps in, then pauses and releases it', async () => {
    // The old video stays up (not pause()'d, not removed) for the entire
    // decode() wait — a real navigation gap used to clear it immediately,
    // leaving the slot blank until the new image resolved. DESIGN.md §2.3.
    const manager = new SlideManager({ preload: 0 });
    manager.render(items, 3, vi.fn()); // video item
    const video = manager.element.querySelector('video') as HTMLVideoElement;
    const pauseSpy = vi.spyOn(video, 'pause').mockImplementation(() => {});
    const loadSpy = vi.spyOn(video, 'load').mockImplementation(() => {});

    manager.render(items, 0, vi.fn()); // switch this slot to an image item

    expect(pauseSpy).not.toHaveBeenCalled();
    expect(loadSpy).not.toHaveBeenCalled();
    expect(manager.element.querySelector('video')).toBe(video); // still the same old video, still up

    await flush(); // the new image's decode() resolves

    expect(pauseSpy).toHaveBeenCalled();
    expect(loadSpy).toHaveBeenCalled();
    expect(manager.element.querySelector('video')).toBeNull();
    expect(manager.element.querySelector('img')).not.toBeNull();
  });

  it('clears a slot when its offset falls outside the item range', async () => {
    const manager = new SlideManager({ preload: 1 });
    manager.render(items, 0, vi.fn());
    await flush();

    const prevSlot = manager.element.querySelectorAll('.shoji-slide-media')[0] as HTMLElement;
    expect(prevSlot.children).toHaveLength(0); // offset -1 from index 0 is out of range
  });

  it('does not re-render a slot already showing the requested index', async () => {
    const manager = new SlideManager({ preload: 0 });
    manager.render(items, 0, vi.fn());
    await flush();
    const imgBefore = manager.element.querySelector('img');

    manager.render(items, 0, vi.fn());
    const imgAfter = manager.element.querySelector('img');

    expect(imgAfter).toBe(imgBefore);
  });

  it('destroy() empties all slots and detaches the element', async () => {
    const manager = new SlideManager({ preload: 0 });
    const root = document.createElement('div');
    root.appendChild(manager.element);
    manager.render(items, 0, vi.fn());
    await flush();

    manager.destroy();

    expect(manager.element.querySelector('.shoji-slide-media')?.children).toHaveLength(0);
    expect(manager.element.parentElement).toBeNull();
  });

  it('destroy() pauses and releases a currently-playing video', () => {
    const manager = new SlideManager({ preload: 0 });
    manager.render(items, 3, vi.fn()); // video item
    const video = manager.element.querySelector('video') as HTMLVideoElement;
    const pauseSpy = vi.spyOn(video, 'pause').mockImplementation(() => {});
    const loadSpy = vi.spyOn(video, 'load').mockImplementation(() => {});

    manager.destroy();

    expect(pauseSpy).toHaveBeenCalled();
    expect(loadSpy).toHaveBeenCalled();
  });
});
