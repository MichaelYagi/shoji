import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Gallery } from '../../src/core';
import type { ShojiPlugin } from '../../src/core';

beforeEach(() => {
  HTMLImageElement.prototype.decode = vi.fn().mockResolvedValue(undefined);
});

afterEach(() => {
  // @ts-expect-error - removing the test-only stub added above
  delete HTMLImageElement.prototype.decode;
  document.body.innerHTML = '';
});

function makeGallery(count = 5, options: Record<string, unknown> = {}) {
  const el = document.createElement('div');
  const items = Array.from({ length: count }, (_, i) => ({
    id: `item-${i}`,
    src: `${i}.jpg`,
    alt: `Photo ${i}`,
  }));
  return new Gallery(el, { items, ...options });
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('Gallery — lightbox DOM', () => {
  it('builds the dialog with role/aria-modal on first open, appended to body', () => {
    const gallery = makeGallery();
    gallery.open(0);

    const dialog = document.querySelector('.shoji-dialog');
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute('role')).toBe('dialog');
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(document.querySelector('.shoji-outer.shoji-open')).not.toBeNull();

    gallery.destroy();
  });

  it('reuses the same DOM across close/reopen instead of rebuilding', () => {
    const gallery = makeGallery();
    gallery.open(0);
    const dialog1 = document.querySelector('.shoji-dialog');
    gallery.close();
    gallery.open(1);
    const dialog2 = document.querySelector('.shoji-dialog');

    expect(dialog2).toBe(dialog1);
    gallery.destroy();
  });

  it('close() hides the outer element but leaves it in the DOM', () => {
    const gallery = makeGallery();
    gallery.open(0);
    gallery.close();

    const outer = document.querySelector('.shoji-outer');
    expect(outer).not.toBeNull();
    expect(outer?.classList.contains('shoji-open')).toBe(false);
    gallery.destroy();
  });

  it('destroy() removes the lightbox DOM entirely', () => {
    const gallery = makeGallery();
    gallery.open(0);
    gallery.destroy();

    expect(document.querySelector('.shoji-outer')).toBeNull();
  });

  it('updates counter and caption text on open and navigate', () => {
    const el = document.createElement('div');
    const gallery = new Gallery(el, {
      items: [
        { id: 'a', src: 'a.jpg', caption: 'First' },
        { id: 'b', src: 'b.jpg', caption: 'Second' },
      ],
    });

    gallery.open(0);
    expect(document.querySelector('.shoji-counter')?.textContent).toBe('1 / 2');
    expect(document.querySelector('.shoji-caption')?.textContent).toBe('First');

    gallery.next();
    expect(document.querySelector('.shoji-counter')?.textContent).toBe('2 / 2');
    expect(document.querySelector('.shoji-caption')?.textContent).toBe('Second');

    gallery.destroy();
  });

  it('regression: a video slide (HTML5 or provider, e.g. YouTube) marks its caption with shoji-caption--video so it click-throughs to the video underneath (shoji.css); a photo slide never does', () => {
    // A real bug: even height-capped (shoji.css §2.3a), the caption's
    // opaque background could still sit directly over a video's native
    // control bar — a video filling most of the dialog leaves little to no
    // letterboxing gap, so even a short caption could land on top of it,
    // with no way to reach scrub/volume/fullscreen underneath. The actual
    // fix is CSS (pointer-events: none on this class); this only covers the
    // half jsdom can verify — that the class lands on the right slides.
    const el = document.createElement('div');
    const gallery = new Gallery(el, {
      items: [
        { id: 'photo', src: 'a.jpg', caption: 'A photo caption' },
        {
          id: 'html5-video',
          src: 'v.mp4',
          video: { provider: 'html5' },
          caption: 'A video caption',
        },
        {
          id: 'yt-video',
          src: 'https://youtu.be/x',
          video: { provider: 'youtube', id: 'x' },
          caption: 'A YouTube caption',
        },
      ],
    });

    gallery.open(0); // photo
    expect(
      document.querySelector('.shoji-caption')?.classList.contains('shoji-caption--video'),
    ).toBe(false);

    gallery.next(); // html5 video
    expect(
      document.querySelector('.shoji-caption')?.classList.contains('shoji-caption--video'),
    ).toBe(true);

    gallery.next(); // youtube (provider) video
    expect(
      document.querySelector('.shoji-caption')?.classList.contains('shoji-caption--video'),
    ).toBe(true);

    gallery.prev();
    gallery.prev(); // back to the photo
    expect(
      document.querySelector('.shoji-caption')?.classList.contains('shoji-caption--video'),
    ).toBe(false);

    gallery.destroy();
  });

  describe('video-slide caption toggle (DESIGN.md §2.3a)', () => {
    function captionToggleButton(): HTMLButtonElement {
      return document.querySelector('.shoji-caption-toggle') as HTMLButtonElement;
    }

    function click(el: Element): void {
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }

    const videoItems = [
      { id: 'photo', src: 'a.jpg', caption: 'A photo caption' },
      {
        id: 'video',
        src: 'v.mp4',
        video: { provider: 'html5' as const },
        caption: 'A video caption',
      },
      { id: 'silent-video', src: 'w.mp4', video: { provider: 'html5' as const } }, // no caption at all
    ];

    it('defaults to hidden on a video slide — the caption itself hidden, the toggle button visible, aria-pressed false', () => {
      const el = document.createElement('div');
      const gallery = new Gallery(el, { items: videoItems });

      gallery.open(1); // the captioned video
      expect(document.querySelector('.shoji-caption')?.hasAttribute('hidden')).toBe(true);
      expect(captionToggleButton().hidden).toBe(false);
      expect(captionToggleButton().getAttribute('aria-pressed')).toBe('false');
      expect(captionToggleButton().getAttribute('aria-label')).toBe('Show caption');

      gallery.destroy();
    });

    it('clicking the toggle shows the caption immediately, and again hides it — a plain synchronous flip, no animation/delay', () => {
      const el = document.createElement('div');
      const gallery = new Gallery(el, { items: videoItems });
      gallery.open(1);

      click(captionToggleButton());
      expect(document.querySelector('.shoji-caption')?.hasAttribute('hidden')).toBe(false);
      expect(captionToggleButton().getAttribute('aria-pressed')).toBe('true');
      expect(captionToggleButton().getAttribute('aria-label')).toBe('Hide caption');

      click(captionToggleButton());
      expect(document.querySelector('.shoji-caption')?.hasAttribute('hidden')).toBe(true);
      expect(captionToggleButton().getAttribute('aria-pressed')).toBe('false');

      gallery.destroy();
    });

    it('showVideoCaption: true starts a video caption visible instead, toggle still works both ways', () => {
      const el = document.createElement('div');
      const gallery = new Gallery(el, { items: videoItems, showVideoCaption: true });
      gallery.open(1);

      expect(document.querySelector('.shoji-caption')?.hasAttribute('hidden')).toBe(false);
      expect(captionToggleButton().getAttribute('aria-pressed')).toBe('true');

      click(captionToggleButton());
      expect(document.querySelector('.shoji-caption')?.hasAttribute('hidden')).toBe(true);

      gallery.destroy();
    });

    it('the toggle button itself is hidden entirely on a photo slide, and on a video slide with no caption at all', () => {
      const el = document.createElement('div');
      const gallery = new Gallery(el, { items: videoItems });

      gallery.open(0); // photo
      expect(captionToggleButton().hidden).toBe(true);

      gallery.next(); // captioned video
      expect(captionToggleButton().hidden).toBe(false);

      gallery.next(); // video with no caption
      expect(captionToggleButton().hidden).toBe(true);

      gallery.destroy();
    });

    it('persists across slide navigation within one open session — toggling on for one video keeps it on for the next', () => {
      const el = document.createElement('div');
      const gallery = new Gallery(el, {
        items: [
          { id: 'v1', src: 'a.mp4', video: { provider: 'html5' as const }, caption: 'First' },
          { id: 'v2', src: 'b.mp4', video: { provider: 'html5' as const }, caption: 'Second' },
        ],
      });
      gallery.open(0);

      click(captionToggleButton());
      expect(document.querySelector('.shoji-caption')?.hasAttribute('hidden')).toBe(false);

      gallery.next();
      expect(document.querySelector('.shoji-caption')?.hasAttribute('hidden')).toBe(false);
      expect(document.querySelector('.shoji-caption')?.textContent).toBe('Second');

      gallery.destroy();
    });

    it('resets to the configured default on close/reopen — a session preference, not a permanent one', () => {
      const el = document.createElement('div');
      const gallery = new Gallery(el, { items: videoItems });
      gallery.open(1);

      click(captionToggleButton());
      expect(document.querySelector('.shoji-caption')?.hasAttribute('hidden')).toBe(false);

      gallery.close();
      gallery.open(1);
      expect(document.querySelector('.shoji-caption')?.hasAttribute('hidden')).toBe(true);
      expect(captionToggleButton().getAttribute('aria-pressed')).toBe('false');

      gallery.destroy();
    });

    it('honors locale overrides for the toggle labels', () => {
      const el = document.createElement('div');
      const gallery = new Gallery(el, {
        items: videoItems,
        locale: { showCaption: 'Mostrar leyenda', hideCaption: 'Ocultar leyenda' },
      });
      gallery.open(1);

      expect(captionToggleButton().getAttribute('aria-label')).toBe('Mostrar leyenda');
      click(captionToggleButton());
      expect(captionToggleButton().getAttribute('aria-label')).toBe('Ocultar leyenda');

      gallery.destroy();
    });
  });

  it('announces the live region text on open and navigate', () => {
    const gallery = makeGallery();
    gallery.open(1);

    const live = document.querySelector('.shoji-live-region');
    expect(live?.textContent).toBe('Image 2 of 5: Photo 1');

    gallery.next();
    expect(live?.textContent).toBe('Image 3 of 5: Photo 2');

    gallery.destroy();
  });
});

describe('Gallery — navigation', () => {
  it('next()/prev() move the active index and emit beforeSlide/afterSlide', () => {
    const gallery = makeGallery();
    gallery.open(1);

    const before = vi.fn();
    const after = vi.fn();
    gallery.on('beforeSlide', before);
    gallery.on('afterSlide', after);

    gallery.next();
    expect(gallery.currentIndex).toBe(2);
    expect(before).toHaveBeenCalledWith({ from: 1, to: 2 });
    expect(after).toHaveBeenCalledWith({ from: 1, to: 2 });

    gallery.prev();
    expect(gallery.currentIndex).toBe(1);

    gallery.destroy();
  });

  it('wraps past the last item to the first by default (loop: true)', () => {
    const gallery = makeGallery(3);
    gallery.open(2);
    const after = vi.fn();
    gallery.on('afterSlide', after);

    gallery.next();

    expect(gallery.currentIndex).toBe(0);
    expect(after).toHaveBeenCalledWith({ from: 2, to: 0 });
    gallery.destroy();
  });

  it('wraps past the first item to the last by default (loop: true)', () => {
    const gallery = makeGallery(3);
    gallery.open(0);
    const after = vi.fn();
    gallery.on('afterSlide', after);

    gallery.prev();

    expect(gallery.currentIndex).toBe(2);
    expect(after).toHaveBeenCalledWith({ from: 0, to: 2 });
    gallery.destroy();
  });

  it('clamps at the last item and does not wrap with loop: false', () => {
    const gallery = makeGallery(3, { loop: false });
    gallery.open(2);
    const after = vi.fn();
    gallery.on('afterSlide', after);

    gallery.next();

    expect(gallery.currentIndex).toBe(2);
    expect(after).not.toHaveBeenCalled();
    gallery.destroy();
  });

  it('clamps at the first item and does not wrap with loop: false', () => {
    const gallery = makeGallery(3, { loop: false });
    gallery.open(0);
    const after = vi.fn();
    gallery.on('afterSlide', after);

    gallery.prev();

    expect(gallery.currentIndex).toBe(0);
    expect(after).not.toHaveBeenCalled();
    gallery.destroy();
  });

  it('goTo/next/prev are no-ops while closed', () => {
    const gallery = makeGallery();
    gallery.goTo(3);
    expect(gallery.currentIndex).toBe(0);
    gallery.destroy();
  });

  it('emits slideItemLoad after the active slide settles', async () => {
    const gallery = makeGallery();
    const loaded = vi.fn();
    gallery.on('slideItemLoad', loaded);

    gallery.open(0);
    await flush();

    expect(loaded).toHaveBeenCalledWith({ index: 0 });
    gallery.destroy();
  });
});

describe('Gallery — keyboard navigation', () => {
  function press(key: string, shiftKey = false): void {
    document.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true }));
  }

  it('Escape closes the gallery', () => {
    const gallery = makeGallery();
    gallery.open(0);
    press('Escape');
    expect(document.querySelector('.shoji-outer.shoji-open')).toBeNull();
    gallery.destroy();
  });

  it('ArrowRight/ArrowLeft navigate', () => {
    const gallery = makeGallery();
    gallery.open(1);
    press('ArrowRight');
    expect(gallery.currentIndex).toBe(2);
    press('ArrowLeft');
    expect(gallery.currentIndex).toBe(1);
    gallery.destroy();
  });

  it('a/d navigate too — the same prev/next as ArrowLeft/ArrowRight, both letter cases', () => {
    const gallery = makeGallery();
    gallery.open(1);
    press('d');
    expect(gallery.currentIndex).toBe(2);
    press('a');
    expect(gallery.currentIndex).toBe(1);
    press('D');
    expect(gallery.currentIndex).toBe(2);
    press('A');
    expect(gallery.currentIndex).toBe(1);
    gallery.destroy();
  });

  it('ignores ArrowLeft/ArrowRight/Home/End while a video has focus, but Escape still closes', () => {
    // jsdom doesn't support focusing <video> at all (confirmed: .focus() is a
    // silent no-op, activeElement never changes) — a documented gap, same
    // category as the media-loading limitations elsewhere in this suite.
    // Force document.activeElement directly to unit-test the guard's logic;
    // real-browser video-focus behavior is covered by e2e instead.
    const el = document.createElement('div');
    const gallery = new Gallery(el, {
      items: [
        { id: 'a', src: 'a.jpg' },
        { id: 'vid', src: 'v.mp4', video: { provider: 'html5' }, poster: 'poster.jpg' },
        { id: 'c', src: 'c.jpg' },
      ],
    });
    gallery.open(1);
    const video = document.querySelector('.shoji-slide-video') as HTMLVideoElement;
    // This creates an *own* property on the document instance, shadowing the
    // real inherited getter — deleting it afterward (not "restoring" a saved
    // descriptor) is what un-shadows it and brings back real behavior.
    Object.defineProperty(document, 'activeElement', { value: video, configurable: true });

    try {
      press('ArrowRight');
      press('ArrowLeft');
      press('Home');
      press('End');
      expect(gallery.currentIndex).toBe(1); // unchanged — the video owns these keys while focused

      press('Escape');
      expect(document.querySelector('.shoji-outer.shoji-open')).toBeNull();
    } finally {
      delete (document as { activeElement?: unknown }).activeElement;
    }
    gallery.destroy();
  });

  it('Home/End jump to the first/last item', () => {
    const gallery = makeGallery(5);
    gallery.open(2);
    press('End');
    expect(gallery.currentIndex).toBe(4);
    press('Home');
    expect(gallery.currentIndex).toBe(0);
    gallery.destroy();
  });

  it('stops responding to keys after close', () => {
    const gallery = makeGallery();
    gallery.open(1);
    gallery.close();
    press('ArrowRight');
    expect(gallery.currentIndex).toBe(1);
    gallery.destroy();
  });
});

describe('Gallery — focus management', () => {
  it('moves focus into the dialog on open and restores it on close', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();

    const gallery = makeGallery();
    gallery.open(0);
    expect(document.activeElement).toBe(document.querySelector('.shoji-dialog'));

    gallery.close();
    expect(document.activeElement).toBe(trigger);

    gallery.destroy();
  });
});

describe('Gallery — updateSlides while open', () => {
  it('re-renders the current slide when the item list changes', () => {
    const el = document.createElement('div');
    const gallery = new Gallery(el, {
      items: [
        { id: 'a', src: 'a.jpg', caption: 'A' },
        { id: 'b', src: 'b.jpg', caption: 'B' },
      ],
    });
    gallery.open(1); // active item "b"

    gallery.updateSlides([
      { id: 'b', src: 'b.jpg', caption: 'B' },
      { id: 'a', src: 'a.jpg', caption: 'A' },
    ]);

    expect(gallery.currentIndex).toBe(0); // "b" preserved at its new index
    expect(document.querySelector('.shoji-caption')?.textContent).toBe('B');

    gallery.destroy();
  });
});

describe('Gallery — toolbar height measurement for caption sizing (DESIGN.md §2.3a)', () => {
  const originalRO = window.ResizeObserver;
  const originalRaf = window.requestAnimationFrame;

  afterEach(() => {
    window.ResizeObserver = originalRO;
    window.requestAnimationFrame = originalRaf;
  });

  function mockResizeObserver(): {
    fire: () => void;
    observed: Element[];
    disconnect: ReturnType<typeof vi.fn>;
  } {
    const observed: Element[] = [];
    const disconnect = vi.fn();
    let callback: (() => void) | undefined;
    window.ResizeObserver = vi.fn().mockImplementation((cb: () => void) => {
      callback = cb;
      return {
        observe: (el: Element) => observed.push(el),
        unobserve: vi.fn(),
        disconnect,
      };
    }) as unknown as typeof ResizeObserver;
    window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    }) as typeof window.requestAnimationFrame;
    return { fire: () => callback?.(), observed, disconnect };
  }

  it("sets --shoji-toolbar-height on .shoji-dialog from the toolbar's real measured height, not a fixed guess", () => {
    const { fire } = mockResizeObserver();
    const gallery = makeGallery();
    gallery.open(0);

    const toolbar = document.querySelector('.shoji-toolbar') as HTMLElement;
    vi.spyOn(toolbar, 'getBoundingClientRect').mockReturnValue({
      height: 164,
    } as DOMRect);
    fire();

    const dialog = document.querySelector('.shoji-dialog') as HTMLElement;
    expect(dialog.style.getPropertyValue('--shoji-toolbar-height')).toBe('164px');

    gallery.destroy();
  });

  it('observes the toolbar element itself, and disconnects the observer on destroy() — no leaked observer', () => {
    const { observed, disconnect } = mockResizeObserver();
    const gallery = makeGallery();
    gallery.open(0);

    const toolbar = document.querySelector('.shoji-toolbar');
    expect(observed).toEqual([toolbar]);

    gallery.destroy();
    expect(disconnect).toHaveBeenCalled();
  });
});

describe('Gallery — toolbar overflow popover (DESIGN.md §3.1a)', () => {
  const originalRaf = window.requestAnimationFrame;

  afterEach(() => {
    window.requestAnimationFrame = originalRaf;
    vi.restoreAllMocks();
  });

  /**
   * `scheduleToolbarOverflowMeasure()` coalesces same-tick calls behind a
   * `toolbarHeightFrame !== null` guard, exactly like a real (async) rAF
   * would — several plugins registering synchronously in the constructor
   * schedule only ONE measurement, which then runs against the final state.
   * A mock that ran the callback synchronously inline broke that: the
   * `this.toolbarHeightFrame = requestAnimationFrame(cb)` assignment
   * completes *after* `cb` already ran and reset the field to `null`,
   * clobbering it back to non-null and silently swallowing every
   * registration after the first. Other unrelated code (e.g. `open()`'s own
   * transition) also calls `requestAnimationFrame` — a single-slot mock lets
   * that clobber the still-pending toolbar callback before it ever runs.
   * Queuing every scheduled callback and flushing them all, in order, once
   * after setup — mirroring how real, independently-fired frames actually
   * land — avoids both traps.
   */
  function mockRaf(): { flush: () => void } {
    const queue: FrameRequestCallback[] = [];
    let nextId = 1;
    window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      queue.push(cb);
      return nextId++;
    }) as typeof window.requestAnimationFrame;
    return {
      flush: () => queue.splice(0).forEach((cb) => cb(0)),
    };
  }

  /**
   * jsdom has no real layout engine — `getBoundingClientRect()` is 0 for
   * everything by default, so `measureToolbarOverflow()` never sees a slot
   * wrap. Simulates it: `.shoji-close` (the row-height reference) is a fixed
   * 44px; any `.shoji-toolbar-slot` reports a height driven by how many of
   * its *visible* (`!hidden`) children there are, wrapping every
   * `buttonsPerRow`.
   */
  function mockToolbarWrap(buttonsPerRow: number): void {
    // jsdom defines getBoundingClientRect as an own property of
    // Element.prototype, not HTMLElement.prototype — spying on the latter
    // silently never intercepts real element instances.
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ): DOMRect {
      const base = {
        x: 0,
        y: 0,
        width: 0,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        toJSON: () => ({}),
      };
      if (this.classList.contains('shoji-toolbar-slot')) {
        const visible = Array.from(this.children).filter(
          (child) => !(child as HTMLElement).hidden,
        ).length;
        const rows = Math.max(1, Math.ceil(visible / buttonsPerRow));
        return { ...base, height: rows * 44 } as DOMRect;
      }
      return { ...base, height: 44 } as DOMRect;
    });
  }

  function makeButtonPlugins(n: number): ShojiPlugin[] {
    return Array.from({ length: n }, (_, i) => ({
      name: `btn-${i}`,
      init(ctx) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'shoji-toolbar-button';
        button.dataset.testId = `btn-${i}`;
        ctx.ui.toolbar('right', button);
      },
    }));
  }

  function panelIds(dialog: HTMLElement | Document = document): string[] {
    return Array.from(dialog.querySelectorAll('.shoji-toolbar-overflow-panel [data-test-id]')).map(
      (el) => (el as HTMLElement).dataset.testId!,
    );
  }

  function pinnedIds(): string[] {
    return Array.from(document.querySelectorAll('.shoji-toolbar-right [data-test-id]')).map(
      (el) => (el as HTMLElement).dataset.testId!,
    );
  }

  it('leaves every plugin button pinned and the caret hidden when the row already fits', () => {
    const { flush } = mockRaf();
    mockToolbarWrap(8);
    const gallery = makeGallery(3, { plugins: makeButtonPlugins(3) });
    gallery.open(0);
    flush();

    const caret = document.querySelector('.shoji-toolbar-overflow') as HTMLButtonElement;
    expect(caret.hidden).toBe(true);
    expect(pinnedIds()).toEqual(['btn-0', 'btn-1', 'btn-2']);
    expect(panelIds()).toEqual([]);

    gallery.destroy();
  });

  it('collapses down to MIN_PINNED_PLUGIN_BUTTONS (1) pinned button plus close and the caret when it overflows, latest-registered first', () => {
    const { flush } = mockRaf();
    mockToolbarWrap(3);
    const gallery = makeGallery(3, { plugins: makeButtonPlugins(7) });
    gallery.open(0);
    flush();

    const caret = document.querySelector('.shoji-toolbar-overflow') as HTMLButtonElement;
    expect(caret.hidden).toBe(false);
    // Exactly 3 icons share the row once collapsed: 1 pinned plugin button,
    // close, and the caret — requested directly, see MIN_PINNED_PLUGIN_BUTTONS.
    expect(pinnedIds()).toEqual(['btn-0']);
    // Collapsed latest-registered first (btn-6 drops off the row before
    // btn-1 does), but the panel itself reads in the same ascending
    // registration order the toolbar row would have shown, not reversed.
    expect(panelIds()).toEqual(['btn-1', 'btn-2', 'btn-3', 'btn-4', 'btn-5', 'btn-6']);

    gallery.destroy();
  });

  it('restores collapsed buttons to the toolbar and re-hides the caret once they fit again (e.g. after a plugin unsubscribes)', () => {
    const { flush } = mockRaf();
    mockToolbarWrap(3);
    let unsubscribeExtra: (() => void) | undefined;
    const extraPlugin: ShojiPlugin = {
      name: 'extra',
      init(ctx) {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.testId = 'extra';
        unsubscribeExtra = ctx.ui.toolbar('right', button);
      },
    };
    const gallery = makeGallery(3, { plugins: [...makeButtonPlugins(2), extraPlugin] });
    gallery.open(0);
    flush();

    const caret = document.querySelector('.shoji-toolbar-overflow') as HTMLButtonElement;
    expect(caret.hidden).toBe(false);

    unsubscribeExtra!();
    flush();
    expect(caret.hidden).toBe(true);
    expect(pinnedIds()).toEqual(['btn-0', 'btn-1']);
    expect(panelIds()).toEqual([]);

    gallery.destroy();
  });

  it('opens the popover on caret click, closes it on Escape, and does not lose the underlying gallery on either', () => {
    const { flush } = mockRaf();
    mockToolbarWrap(3);
    const gallery = makeGallery(3, { plugins: makeButtonPlugins(7) });
    gallery.open(0);
    flush();

    const caret = document.querySelector('.shoji-toolbar-overflow') as HTMLButtonElement;
    const panel = document.querySelector('.shoji-toolbar-overflow-panel') as HTMLElement;
    caret.click();
    expect(panel.hidden).toBe(false);
    expect(caret.getAttribute('aria-expanded')).toBe('true');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(panel.hidden).toBe(true);
    expect(caret.getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelector('.shoji-outer.shoji-open')).not.toBeNull();

    gallery.destroy();
  });

  it('closes the popover on an outside click, but a click on one of its own buttons does not close it or the gallery', () => {
    const { flush } = mockRaf();
    mockToolbarWrap(3);
    const gallery = makeGallery(3, { plugins: makeButtonPlugins(7) });
    gallery.open(0);
    flush();

    const caret = document.querySelector('.shoji-toolbar-overflow') as HTMLButtonElement;
    const panel = document.querySelector('.shoji-toolbar-overflow-panel') as HTMLElement;
    caret.click();
    expect(panel.hidden).toBe(false);

    (panel.querySelector('[data-test-id]') as HTMLButtonElement).click();
    expect(panel.hidden).toBe(false);
    expect(document.querySelector('.shoji-outer.shoji-open')).not.toBeNull();

    (document.querySelector('.shoji-backdrop') as HTMLElement).click();
    expect(panel.hidden).toBe(true);

    gallery.destroy();
  });

  it('destroying the gallery while the popover is open removes its document-level Escape listener — no leak', () => {
    const { flush } = mockRaf();
    mockToolbarWrap(3);
    const gallery = makeGallery(3, { plugins: makeButtonPlugins(7) });
    gallery.open(0);
    flush();

    (document.querySelector('.shoji-toolbar-overflow') as HTMLButtonElement).click();
    expect((document.querySelector('.shoji-toolbar-overflow-panel') as HTMLElement).hidden).toBe(
      false,
    );

    const removeSpy = vi.spyOn(document, 'removeEventListener');
    gallery.destroy();
    expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function), true);
  });
});

describe('Gallery — truncated-caption modal (DESIGN.md §2.3a)', () => {
  // No file-level vi.restoreAllMocks() — the prototype-level scrollHeight/
  // clientHeight/getSelection spies below would otherwise leak into
  // whichever test runs next.
  afterEach(() => {
    vi.restoreAllMocks();
    // vi.restoreAllMocks() only undoes vi.spyOn() wrapping — getClientRects
    // was assigned outright (jsdom's Range never had it to spy on), so it
    // has to be deleted explicitly or it leaks into every test file after
    // this one for the rest of the run.
    delete (Range.prototype as { getClientRects?: unknown }).getClientRects;
  });

  // jsdom has no real layout engine — scrollHeight/clientHeight are always 0
  // there, so truncation can't be exercised end to end the way
  // tests/e2e/core-caption-modal.spec.ts does against a real browser. This
  // mocks the comparisons updateCaptionTruncation() actually makes, so the
  // DOM-state behavior built on top of it (class/attrs/click/keyboard/
  // focus/cleanup) is still covered here without needing real geometry.
  // jsdom also has no `Range.prototype.getClientRects()` at all (throws,
  // not just returns empty) — mocked to an empty list, which exercises the
  // same "found no fitting line" fallback path real code takes when a
  // caption is a single unbroken run with no wrap point below the budget.
  function mockTruncated(truncated: boolean): void {
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(truncated ? 100 : 10);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(10);
    // Not vi.spyOn — jsdom's Range doesn't define this method at all (spyOn
    // requires an existing property to wrap), so it has to be added outright.
    Range.prototype.getClientRects = vi.fn().mockReturnValue([]);
  }

  function caption(): HTMLElement {
    return document.querySelector('.shoji-caption') as HTMLElement;
  }

  function modal(): HTMLElement {
    return document.querySelector('.shoji-caption-modal') as HTMLElement;
  }

  it('marks a genuinely overflowing caption truncated — class, tabindex, role, aria-haspopup — and a fitting one plain', async () => {
    mockTruncated(true);
    const gallery = makeGallery(1, {
      items: [{ id: 'a', src: 'a.jpg', caption: 'long one' }],
    });
    gallery.open(0);
    await flush(); // caption stays `hidden` (isActiveReady() false) until decode() resolves

    expect(caption().classList.contains('shoji-caption--truncated')).toBe(true);
    expect(caption().tabIndex).toBe(0);
    expect(caption().getAttribute('role')).toBe('button');
    expect(caption().getAttribute('aria-haspopup')).toBe('dialog');

    gallery.destroy();

    mockTruncated(false);
    const gallery2 = makeGallery(1, { items: [{ id: 'a', src: 'a.jpg', caption: 'short' }] });
    gallery2.open(0);
    await flush();

    expect(caption().classList.contains('shoji-caption--truncated')).toBe(false);
    expect(caption().hasAttribute('tabindex')).toBe(false);
    expect(caption().hasAttribute('role')).toBe(false);
    expect(caption().hasAttribute('aria-haspopup')).toBe(false);

    gallery2.destroy();
  });

  it('a click on a truncated caption opens the modal with that slide’s full caption re-rendered into it; a click on a non-truncated one does nothing', async () => {
    mockTruncated(true);
    const gallery = makeGallery(1, {
      items: [{ id: 'a', src: 'a.jpg', caption: 'the full text' }],
    });
    gallery.open(0);
    await flush();

    expect(modal().hidden).toBe(true);
    caption().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(modal().hidden).toBe(false);
    expect(document.querySelector('.shoji-caption-modal-content')?.textContent).toBe(
      'the full text',
    );

    gallery.destroy();

    mockTruncated(false);
    const gallery2 = makeGallery(1, { items: [{ id: 'a', src: 'a.jpg', caption: 'short' }] });
    gallery2.open(0);
    await flush();
    caption().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(modal().hidden).toBe(true);

    gallery2.destroy();
  });

  it('Enter/Space open it when the caption is focused; other keys do not', async () => {
    mockTruncated(true);
    const gallery = makeGallery(1, { items: [{ id: 'a', src: 'a.jpg', caption: 'text' }] });
    gallery.open(0);
    await flush();

    caption().dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    expect(modal().hidden).toBe(true);

    caption().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(modal().hidden).toBe(false);

    gallery.destroy();
  });

  it('a text selection does not count as a click-to-open — the drag-to-select behavior stays intact', async () => {
    mockTruncated(true);
    const gallery = makeGallery(1, { items: [{ id: 'a', src: 'a.jpg', caption: 'text' }] });
    gallery.open(0);
    await flush();

    vi.spyOn(window, 'getSelection').mockReturnValue({
      isCollapsed: false,
    } as unknown as Selection);
    caption().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(modal().hidden).toBe(true);

    gallery.destroy();
  });

  it('closes on Escape (and only the modal — the lightbox itself stays open), on a backdrop click, and on the close button', async () => {
    mockTruncated(true);
    const gallery = makeGallery(1, { items: [{ id: 'a', src: 'a.jpg', caption: 'text' }] });
    gallery.open(0);
    await flush();

    caption().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(modal().hidden).toBe(false);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(modal().hidden).toBe(true);
    expect(document.querySelector('.shoji-outer.shoji-open')).not.toBeNull();

    caption().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    modal().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(modal().hidden).toBe(true);

    caption().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    document
      .querySelector('.shoji-caption-modal-close')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(modal().hidden).toBe(true);

    gallery.destroy();
  });

  it('any other key is absorbed while the modal is open — never reaches the gallery’s own shortcut handling', async () => {
    mockTruncated(true);
    const gallery = makeGallery(1, { items: [{ id: 'a', src: 'a.jpg', caption: 'text' }] });
    gallery.open(0);
    await flush();
    caption().dispatchEvent(new MouseEvent('click', { bubbles: true }));

    const closeSpy = vi.spyOn(gallery, 'close');
    // ' ' (Space) would otherwise be a plugin-registered shortcut in a real
    // integration (e.g. Autoplay's play/pause) — nothing is registered
    // here, so the meaningful assertion is that it doesn't fall through to
    // close()/navigate either, not a specific plugin's own reaction.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    expect(modal().hidden).toBe(false);
    expect(closeSpy).not.toHaveBeenCalled();

    gallery.destroy();
  });

  it('closing (however it happens) removes the document-level keydown listener — no leak', async () => {
    mockTruncated(true);
    const gallery = makeGallery(1, { items: [{ id: 'a', src: 'a.jpg', caption: 'text' }] });
    gallery.open(0);
    await flush();
    caption().dispatchEvent(new MouseEvent('click', { bubbles: true }));

    const removeSpy = vi.spyOn(document, 'removeEventListener');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function), true);

    gallery.destroy();
  });

  it('destroy() while the modal is open cleans it up too — no dangling listener left on document', async () => {
    mockTruncated(true);
    const gallery = makeGallery(1, { items: [{ id: 'a', src: 'a.jpg', caption: 'text' }] });
    gallery.open(0);
    await flush();
    caption().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(modal().hidden).toBe(false);

    gallery.destroy();

    // A real bug, caught here: asserting only that *some*
    // `removeEventListener('keydown', ..., true)` call happened (the
    // original version of this test) passed even when the modal's own
    // listener specifically leaked — FocusTrap's own unrelated document
    // keydown listener removal satisfied the same loose matcher. The
    // leaked listener's own damage is specifically a *capture-phase*
    // `stopPropagation()` on `document` swallowing a keydown before it
    // ever reaches a descendant's own bubble-phase listener — dispatching
    // straight on `document` itself wouldn't exercise that (same-node
    // listeners all run regardless of an earlier one's stopPropagation());
    // a descendant is what actually proves the leaked listener is gone.
    const probe = document.body.appendChild(document.createElement('div'));
    let reached = false;
    probe.addEventListener('keydown', () => (reached = true));
    probe.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    probe.remove();
    expect(reached).toBe(true);
  });

  it('navigating away from the slide the modal is showing closes it first', async () => {
    mockTruncated(true);
    const gallery = makeGallery(2, {
      items: [
        { id: 'a', src: 'a.jpg', caption: 'first' },
        { id: 'b', src: 'b.jpg', caption: 'second' },
      ],
    });
    gallery.open(0);
    await flush();
    caption().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(modal().hidden).toBe(false);

    gallery.next();
    expect(modal().hidden).toBe(true);

    gallery.destroy();
  });
});
