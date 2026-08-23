import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Gallery } from '../../src/core';
import type { ShojiPlugin } from '../../src/core/plugin';

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

/** DESIGN.md §2.5 — a navigated-to caption's content is deferred (`captionFadePending`, `Gallery.ts`) until its half-duration fade-out timer fires, not applied synchronously inside next()/prev() anymore. */
async function flushCaptionFade(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function click(el: Element): void {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

describe('Gallery — close/nav buttons', () => {
  it('close button closes the gallery', () => {
    const gallery = makeGallery();
    gallery.open(0);

    click(document.querySelector('.shoji-close')!);

    expect(document.querySelector('.shoji-outer.shoji-open')).toBeNull();
    gallery.destroy();
  });

  it('next/prev buttons navigate', () => {
    const gallery = makeGallery();
    gallery.open(1);

    click(document.querySelector('.shoji-nav-next')!);
    expect(gallery.currentIndex).toBe(2);

    click(document.querySelector('.shoji-nav-prev')!);
    expect(gallery.currentIndex).toBe(1);

    gallery.destroy();
  });

  it('next() wraps from the last item to the first by default (loop: true)', () => {
    const gallery = makeGallery(3);
    gallery.open(2);

    gallery.next();
    expect(gallery.currentIndex).toBe(0);

    gallery.destroy();
  });

  it('prev() wraps from the first item to the last by default (loop: true)', () => {
    const gallery = makeGallery(3);
    gallery.open(0);

    gallery.prev();
    expect(gallery.currentIndex).toBe(2);

    gallery.destroy();
  });

  it('nav buttons are never disabled at the boundaries with the default loop: true', () => {
    const gallery = makeGallery(3);
    gallery.open(0);

    expect((document.querySelector('.shoji-nav-prev') as HTMLButtonElement).disabled).toBe(false);
    expect((document.querySelector('.shoji-nav-next') as HTMLButtonElement).disabled).toBe(false);

    gallery.goTo(2);
    expect((document.querySelector('.shoji-nav-prev') as HTMLButtonElement).disabled).toBe(false);
    expect((document.querySelector('.shoji-nav-next') as HTMLButtonElement).disabled).toBe(false);

    gallery.destroy();
  });

  it('clicking next/prev at the boundary wraps, matching loop: true', () => {
    const gallery = makeGallery(3);
    gallery.open(0);

    click(document.querySelector('.shoji-nav-prev')!);
    expect(gallery.currentIndex).toBe(2);

    click(document.querySelector('.shoji-nav-next')!);
    expect(gallery.currentIndex).toBe(0);

    gallery.destroy();
  });

  it('goTo() with an out-of-range index still clamps regardless of loop', () => {
    const gallery = makeGallery(3);
    gallery.open(0);

    gallery.goTo(99);
    expect(gallery.currentIndex).toBe(2);

    gallery.goTo(-99);
    expect(gallery.currentIndex).toBe(0);

    gallery.destroy();
  });

  describe('loop: false', () => {
    it('prev is disabled at the first item, next at the last', () => {
      const gallery = makeGallery(3, { loop: false });
      gallery.open(0);

      expect((document.querySelector('.shoji-nav-prev') as HTMLButtonElement).disabled).toBe(true);
      expect((document.querySelector('.shoji-nav-next') as HTMLButtonElement).disabled).toBe(false);

      gallery.goTo(2);
      expect((document.querySelector('.shoji-nav-prev') as HTMLButtonElement).disabled).toBe(false);
      expect((document.querySelector('.shoji-nav-next') as HTMLButtonElement).disabled).toBe(true);

      gallery.destroy();
    });

    it('clicking a disabled nav button does not navigate', () => {
      const gallery = makeGallery(3, { loop: false });
      gallery.open(0);

      click(document.querySelector('.shoji-nav-prev')!);

      expect(gallery.currentIndex).toBe(0);
      gallery.destroy();
    });

    it('next()/prev() stop at the boundary instead of wrapping', () => {
      const gallery = makeGallery(3, { loop: false });
      gallery.open(0);

      gallery.prev();
      expect(gallery.currentIndex).toBe(0);

      gallery.goTo(2);
      gallery.next();
      expect(gallery.currentIndex).toBe(2);

      gallery.destroy();
    });
  });

  it('hides both nav buttons when there is only one item', () => {
    const gallery = makeGallery(1);
    gallery.open(0);

    expect((document.querySelector('.shoji-nav-prev') as HTMLButtonElement).hidden).toBe(true);
    expect((document.querySelector('.shoji-nav-next') as HTMLButtonElement).hidden).toBe(true);

    gallery.destroy();
  });

  it('gives each button a real accessible label via aria-label', () => {
    const gallery = makeGallery();
    gallery.open(0);

    expect(document.querySelector('.shoji-close')?.getAttribute('aria-label')).toBe('Close');
    expect(document.querySelector('.shoji-nav-prev')?.getAttribute('aria-label')).toBe(
      'Previous image',
    );
    expect(document.querySelector('.shoji-nav-next')?.getAttribute('aria-label')).toBe(
      'Next image',
    );

    gallery.destroy();
  });

  it('uses custom locale strings for aria-labels when provided', () => {
    const gallery = makeGallery(5, {
      locale: { close: 'Fermer', previous: 'Précédent', next: 'Suivant' },
    });
    gallery.open(0);

    expect(document.querySelector('.shoji-close')?.getAttribute('aria-label')).toBe('Fermer');
    expect(document.querySelector('.shoji-nav-prev')?.getAttribute('aria-label')).toBe('Précédent');
    expect(document.querySelector('.shoji-nav-next')?.getAttribute('aria-label')).toBe('Suivant');

    gallery.destroy();
  });
});

describe('Gallery — counter & caption', () => {
  it('shows the counter by default', () => {
    const gallery = makeGallery(5);
    gallery.open(2);

    const counter = document.querySelector('.shoji-counter') as HTMLElement;
    expect(counter.hidden).toBe(false);
    expect(counter.textContent).toBe('3 / 5');

    gallery.destroy();
  });

  it('hides the counter when counter:false, but the live region still announces position', () => {
    const gallery = makeGallery(5, { counter: false });
    const announcements: string[] = [];
    const live = () => document.querySelector('.shoji-live-region')?.textContent ?? '';

    gallery.open(2);
    announcements.push(live());

    const counter = document.querySelector('.shoji-counter') as HTMLElement;
    expect(counter.hidden).toBe(true);
    expect(announcements[0]).toContain('Image 3 of 5');

    gallery.destroy();
  });

  it('hides the caption bar when the item has no caption', () => {
    const el = document.createElement('div');
    const gallery = new Gallery(el, { items: [{ id: 'a', src: 'a.jpg' }] });
    gallery.open(0);

    expect((document.querySelector('.shoji-caption') as HTMLElement).hidden).toBe(true);

    gallery.destroy();
  });

  it('shows the caption bar with the item text when present, once the slide is done loading', async () => {
    const el = document.createElement('div');
    const gallery = new Gallery(el, {
      items: [{ id: 'a', src: 'a.jpg', caption: 'A sunset' }],
    });
    gallery.open(0);
    await Promise.resolve();
    await Promise.resolve();

    const caption = document.querySelector('.shoji-caption') as HTMLElement;
    expect(caption.hidden).toBe(false);
    expect(caption.textContent).toBe('A sunset');

    gallery.destroy();
  });

  it('hides the caption while the active slide is still loading, even though it has caption text', () => {
    const el = document.createElement('div');
    const gallery = new Gallery(el, {
      items: [{ id: 'a', src: 'a.jpg', caption: 'A sunset' }],
    });
    gallery.open(0); // decode() hasn't resolved yet — no await here, on purpose

    const caption = document.querySelector('.shoji-caption') as HTMLElement;
    expect(caption.hidden).toBe(true);
    expect(caption.textContent).toBe('A sunset'); // content is already correct, just not shown yet

    gallery.destroy();
  });

  it('renders an HTMLElement caption as real DOM, not escaped text', async () => {
    const el = document.createElement('div');
    const rich = document.createElement('span');
    rich.innerHTML = '<strong>Bold</strong> caption';
    const gallery = new Gallery(el, { items: [{ id: 'a', src: 'a.jpg', caption: rich }] });
    gallery.open(0);
    await Promise.resolve();
    await Promise.resolve();

    const caption = document.querySelector('.shoji-caption') as HTMLElement;
    expect(caption.hidden).toBe(false);
    expect(caption.querySelector('strong')?.textContent).toBe('Bold');
    expect(caption.contains(rich)).toBe(true);

    gallery.destroy();
  });

  it('escapes a plain string caption rather than treating it as HTML', () => {
    const el = document.createElement('div');
    const gallery = new Gallery(el, {
      items: [{ id: 'a', src: 'a.jpg', caption: '<strong>not bold</strong>' }],
    });
    gallery.open(0);

    const caption = document.querySelector('.shoji-caption') as HTMLElement;
    expect(caption.querySelector('strong')).toBeNull();
    expect(caption.textContent).toBe('<strong>not bold</strong>');

    gallery.destroy();
  });

  it('swaps cleanly from an HTMLElement caption to a string caption on navigation', async () => {
    const el = document.createElement('div');
    const rich = document.createElement('span');
    rich.textContent = 'Rich';
    const gallery = new Gallery(el, {
      items: [
        { id: 'a', src: 'a.jpg', caption: rich },
        { id: 'b', src: 'b.jpg', caption: 'Plain' },
      ],
    });
    gallery.open(0);
    gallery.next();
    await flushCaptionFade();

    const caption = document.querySelector('.shoji-caption') as HTMLElement;
    expect(caption.querySelector('span')).toBeNull();
    expect(caption.textContent).toBe('Plain');

    gallery.destroy();
  });

  it('renders dangerouslySetInnerHTML as raw, unescaped HTML', async () => {
    const el = document.createElement('div');
    const gallery = new Gallery(el, {
      items: [
        {
          id: 'a',
          src: 'a.jpg',
          caption: { dangerouslySetInnerHTML: '<strong>Bold</strong> caption' },
        },
      ],
    });
    gallery.open(0);
    await Promise.resolve();
    await Promise.resolve();

    const caption = document.querySelector('.shoji-caption') as HTMLElement;
    expect(caption.hidden).toBe(false);
    expect(caption.querySelector('strong')?.textContent).toBe('Bold');

    gallery.destroy();
  });

  it('hides the caption when dangerouslySetInnerHTML is an empty string', () => {
    const el = document.createElement('div');
    const gallery = new Gallery(el, {
      items: [{ id: 'a', src: 'a.jpg', caption: { dangerouslySetInnerHTML: '' } }],
    });
    gallery.open(0);

    expect((document.querySelector('.shoji-caption') as HTMLElement).hidden).toBe(true);
    gallery.destroy();
  });
});

describe('Gallery — click-outside-to-close', () => {
  it('clicking the backdrop closes the gallery', () => {
    const gallery = makeGallery();
    gallery.open(0);

    click(document.querySelector('.shoji-backdrop')!);

    expect(document.querySelector('.shoji-outer.shoji-open')).toBeNull();
    gallery.destroy();
  });

  it('clicking empty dialog space (not the image) closes the gallery', () => {
    const gallery = makeGallery();
    gallery.open(0);

    click(document.querySelector('.shoji-dialog')!);

    expect(document.querySelector('.shoji-outer.shoji-open')).toBeNull();
    gallery.destroy();
  });

  it('clicking the caption does not close the gallery', () => {
    const el = document.createElement('div');
    const gallery = new Gallery(el, {
      items: [{ id: 'a', src: 'a.jpg', caption: 'Caption text' }],
    });
    gallery.open(0);

    click(document.querySelector('.shoji-caption')!);

    expect(document.querySelector('.shoji-outer.shoji-open')).not.toBeNull();
    gallery.destroy();
  });

  it('clicking the counter does not close the gallery', () => {
    const gallery = makeGallery();
    gallery.open(0);

    click(document.querySelector('.shoji-counter')!);

    expect(document.querySelector('.shoji-outer.shoji-open')).not.toBeNull();
    gallery.destroy();
  });

  it('a toolbar button that replaces its own icon (innerHTML) in its click handler does not trigger a false backdrop-close', () => {
    // Regression test: clicking an icon-only button's inner <svg>/<path> makes
    // THAT descendant the click event's target, not the <button> itself. If
    // the button's own click handler synchronously replaces its innerHTML
    // (e.g. an autoplay-style play/pause icon swap) before the event finishes
    // bubbling, the original target gets detached from the document — and a
    // naive `event.target.closest(...)` check higher up (the click-outside-
    // to-close listener on .shoji-outer) would then find no ancestors and
    // wrongly read it as "clicked outside," closing the gallery. Only
    // reproducible by clicking a *descendant* of the button, not the button
    // itself (which stays attached even after its children are replaced).
    const el = document.createElement('div');
    const plugin: ShojiPlugin = {
      name: 'icon-swap',
      init(ctx) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'shoji-toolbar-button';
        button.innerHTML = '<svg><path d="M0 0"></path></svg>';
        button.addEventListener('click', () => {
          button.innerHTML = '<svg><path d="M1 1"></path></svg>'; // swap mid-bubble, same as autoplay's setButtonState
        });
        ctx.ui.toolbar('left', button);
      },
    };
    const gallery = new Gallery(el, {
      items: [{ id: 'a', src: 'a.jpg' }],
      plugins: [plugin],
    });
    gallery.open(0);

    const path = document.querySelector('.shoji-toolbar-button path')!;
    click(path);

    expect(document.querySelector('.shoji-outer.shoji-open')).not.toBeNull();
    gallery.destroy();
  });

  it('clicking the slide image does not close the gallery', async () => {
    const gallery = makeGallery();
    gallery.open(0);
    await Promise.resolve();
    await Promise.resolve();

    const img = document.querySelector('.shoji-slide-img');
    expect(img).not.toBeNull();
    click(img!);

    expect(document.querySelector('.shoji-outer.shoji-open')).not.toBeNull();
    gallery.destroy();
  });

  it("clicking blank space in a provider-video slide's container closes the gallery — matching image/HTML5 video parity. The exclusion was narrowed from the whole .shoji-slide-provider-video container to only .shoji-video-mount and iframe, so blank areas (sides, toolbar-inset padding) now read as backdrop clicks.", () => {
    const el = document.createElement('div');
    const gallery = new Gallery(el, {
      items: [
        {
          id: 'yt',
          src: 'x',
          video: {
            provider: 'custom',
            render: (container, _item, onReady) => {
              container.appendChild(document.createElement('iframe'));
              onReady();
            },
          },
        },
      ],
    });
    gallery.open(0);

    // Click the container itself (blank space around the embed) — should close
    click(document.querySelector('.shoji-slide-provider-video')!);

    expect(document.querySelector('.shoji-outer.shoji-open')).toBeNull();
    gallery.destroy();
  });

  it("clicking the iframe inside a provider-video slide does not close the gallery — the iframe element itself is excluded so an unfocused-frame first-click from the parent-page's hit-testing doesn't trigger a false backdrop-close", () => {
    const el = document.createElement('div');
    const gallery = new Gallery(el, {
      items: [
        {
          id: 'yt',
          src: 'x',
          video: {
            provider: 'custom',
            render: (container, _item, onReady) => {
              container.appendChild(document.createElement('iframe'));
              onReady();
            },
          },
        },
      ],
    });
    gallery.open(0);

    // Click the iframe element directly — should not close
    click(document.querySelector('.shoji-slide-provider-video iframe')!);

    expect(document.querySelector('.shoji-outer.shoji-open')).not.toBeNull();
    gallery.destroy();
  });

  it('clicking a nav button does not also trigger a close', () => {
    const gallery = makeGallery();
    gallery.open(1);

    click(document.querySelector('.shoji-nav-next')!);

    expect(document.querySelector('.shoji-outer.shoji-open')).not.toBeNull();
    expect(gallery.currentIndex).toBe(2);
    gallery.destroy();
  });

  it('clicking a plugin-mounted <select>/<input>/<textarea>/<a href> control does not trigger a false backdrop-close', () => {
    // Regression: isBackdropClick() used to have its own, narrower exclusion
    // list than GestureController's shouldIgnoreGesture() — missing select/
    // input/textarea/a[href]/[data-shoji-no-drag]. A plugin mounting anything
    // other than a bare <button> into the toolbar/overlay (e.g. a <select>
    // theme picker) had every click on it misread as "clicked outside,"
    // closing the gallery instead of letting the control work.
    const el = document.createElement('div');
    const plugin: ShojiPlugin = {
      name: 'controls',
      init(ctx) {
        const select = document.createElement('select');
        select.className = 'my-select';
        select.appendChild(new Option('a'));
        ctx.ui.toolbar('right', select);

        const input = document.createElement('input');
        input.className = 'my-input';
        ctx.ui.overlay(input);

        const textarea = document.createElement('textarea');
        textarea.className = 'my-textarea';
        ctx.ui.overlay(textarea);

        const link = document.createElement('a');
        link.href = '#';
        link.className = 'my-link';
        ctx.ui.overlay(link);
      },
    };
    const gallery = new Gallery(el, { items: [{ id: 'a', src: 'a.jpg' }], plugins: [plugin] });
    gallery.open(0);

    for (const selector of ['.my-select', '.my-input', '.my-textarea', '.my-link']) {
      click(document.querySelector(selector)!);
      expect(document.querySelector('.shoji-outer.shoji-open')).not.toBeNull();
    }
    gallery.destroy();
  });

  /**
   * DESIGN.md §2.3a/§2.6a — a real bug, reported from real usage:
   * `.shoji-caption--video`'s `pointer-events: none` (letting a click reach
   * a video's own native controls underneath it) only stays safe when the
   * video actually fills the space the caption sits over. A letterboxed
   * video (narrower/shorter than the dialog) leaves the caption's own
   * bottom-left position over plain `.shoji-slide-media` background
   * instead — `pointer-events: none` removes the caption from
   * `composedPath()` entirely, so the click fell all the way through to a
   * genuine backdrop click and closed the gallery. Fixed with a coordinate
   * check in `isBackdropClick()` (the one place in that function that has
   * to be coordinate-based, since `pointer-events: none` is exactly what
   * makes the selector-based check unable to see the caption at all).
   *
   * jsdom has no real layout engine — `getBoundingClientRect()` always
   * returns an all-zero rect, and a plain `click()` dispatch defaults
   * `clientX`/`clientY` to `0` too, so every click would trivially read as
   * "inside" a zeroed rect without mocking both explicitly, same reasoning
   * `gallery-lightbox.test.ts`'s own `mockTruncated()` documents for a
   * different geometry-dependent feature.
   */
  describe('a video caption whose click-through lands on empty space (letterboxed video), not the video itself', () => {
    function mockCaptionRect(): void {
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
        this: HTMLElement,
      ) {
        if (this.classList.contains('shoji-caption')) {
          return {
            left: 0,
            right: 100,
            top: 500,
            bottom: 540,
            width: 100,
            height: 40,
            x: 0,
            y: 500,
            toJSON: () => ({}),
          } as DOMRect;
        }
        return {
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
          width: 0,
          height: 0,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        } as DOMRect;
      });
    }

    function clickAt(el: Element, x: number, y: number): void {
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y }));
    }

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('does not close the gallery when the click lands within the caption’s own bounding box, even though it hit plain slide-media background', () => {
      mockCaptionRect();
      const gallery = new Gallery(document.createElement('div'), {
        items: [{ id: 'v', src: 'x.mp4', video: { provider: 'html5' }, caption: 'short' }],
        showVideoCaption: true,
      });
      gallery.open(0);

      clickAt(document.querySelector('.shoji-slide-media')!, 50, 520); // inside the mocked caption rect

      expect(document.querySelector('.shoji-outer.shoji-open')).not.toBeNull();
      gallery.destroy();
    });

    it('still closes the gallery for a click outside the caption’s bounding box — the fix is scoped to the caption’s own area, not all of .shoji-slide-media', () => {
      mockCaptionRect();
      const gallery = new Gallery(document.createElement('div'), {
        items: [{ id: 'v', src: 'x.mp4', video: { provider: 'html5' }, caption: 'short' }],
        showVideoCaption: true,
      });
      gallery.open(0);

      clickAt(document.querySelector('.shoji-slide-media')!, 500, 10); // well outside the mocked caption rect

      expect(document.querySelector('.shoji-outer.shoji-open')).toBeNull();
    });

    it('does not protect that same area when the caption is hidden (showVideoCaption defaults to false)', () => {
      mockCaptionRect();
      const gallery = new Gallery(document.createElement('div'), {
        items: [{ id: 'v', src: 'x.mp4', video: { provider: 'html5' }, caption: 'short' }],
      });
      gallery.open(0);

      clickAt(document.querySelector('.shoji-slide-media')!, 50, 520); // same coordinates as the first test above

      expect(document.querySelector('.shoji-outer.shoji-open')).toBeNull();
    });

    it('does not protect a photo slide’s caption area — there’s nothing underneath it that click-through was ever needed for', () => {
      mockCaptionRect();
      const gallery = new Gallery(document.createElement('div'), {
        items: [{ id: 'p', src: 'p.jpg', caption: 'short' }],
      });
      gallery.open(0);

      clickAt(document.querySelector('.shoji-slide-media')!, 50, 520);

      expect(document.querySelector('.shoji-outer.shoji-open')).toBeNull();
    });
  });
});

describe('Gallery — backdropOpacity', () => {
  function backdrop(): HTMLElement {
    return document.querySelector('.shoji-backdrop') as HTMLElement;
  }

  it('sets the --shoji-backdrop-opacity custom property on .shoji-outer', () => {
    const gallery = makeGallery(3, { backdropOpacity: 0.5 });
    gallery.open(0);

    const outer = document.querySelector('.shoji-outer') as HTMLElement;
    expect(outer.style.getPropertyValue('--shoji-backdrop-opacity')).toBe('0.5');
    gallery.destroy();
  });

  it('clamps a value above 1 down to 1', () => {
    const gallery = makeGallery(3, { backdropOpacity: 1.5 });
    gallery.open(0);

    const outer = document.querySelector('.shoji-outer') as HTMLElement;
    expect(outer.style.getPropertyValue('--shoji-backdrop-opacity')).toBe('1');
    gallery.destroy();
  });

  it('clamps a negative value up to 0', () => {
    const gallery = makeGallery(3, { backdropOpacity: -0.5 });
    gallery.open(0);

    const outer = document.querySelector('.shoji-outer') as HTMLElement;
    expect(outer.style.getPropertyValue('--shoji-backdrop-opacity')).toBe('0');
    gallery.destroy();
  });

  it('leaves the custom property unset when the option is omitted — a host theming --shoji-backdrop-opacity directly in CSS is unaffected', () => {
    const gallery = makeGallery(3);
    gallery.open(0);

    const outer = document.querySelector('.shoji-outer') as HTMLElement;
    expect(outer.style.getPropertyValue('--shoji-backdrop-opacity')).toBe('');
    gallery.destroy();
  });

  it('.shoji-backdrop itself has no inline style — the option only ever sets the custom property, styling stays in CSS', () => {
    const gallery = makeGallery(3, { backdropOpacity: 0.5 });
    gallery.open(0);

    expect(backdrop().getAttribute('style')).toBeNull();
    gallery.destroy();
  });
});

describe('Gallery — transitionDuration', () => {
  it('sets the --shoji-duration custom property (in ms) on .shoji-outer', () => {
    const gallery = makeGallery(3, { transitionDuration: 150 });
    gallery.open(0);

    const outer = document.querySelector('.shoji-outer') as HTMLElement;
    expect(outer.style.getPropertyValue('--shoji-duration')).toBe('150ms');
    gallery.destroy();
  });

  it('clamps a negative value up to 0', () => {
    const gallery = makeGallery(3, { transitionDuration: -50 });
    gallery.open(0);

    const outer = document.querySelector('.shoji-outer') as HTMLElement;
    expect(outer.style.getPropertyValue('--shoji-duration')).toBe('0ms');
    gallery.destroy();
  });

  it('leaves the custom property unset when the option is omitted — a host theming --shoji-duration directly in CSS is unaffected', () => {
    const gallery = makeGallery(3);
    gallery.open(0);

    const outer = document.querySelector('.shoji-outer') as HTMLElement;
    expect(outer.style.getPropertyValue('--shoji-duration')).toBe('');
    gallery.destroy();
  });
});

describe('Gallery — closable: false', () => {
  function press(key: string): void {
    document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  }

  it('hides the close button entirely, not just disables it', () => {
    const gallery = makeGallery(5, { closable: false });
    gallery.open(0);

    expect(document.querySelector('.shoji-close')!.hasAttribute('hidden')).toBe(true);
    gallery.destroy();
  });

  it('clicking the backdrop does not close the gallery', () => {
    const gallery = makeGallery(5, { closable: false });
    gallery.open(0);

    click(document.querySelector('.shoji-backdrop')!);

    expect(document.querySelector('.shoji-outer.shoji-open')).not.toBeNull();
    gallery.destroy();
  });

  it('Escape does not close the gallery', () => {
    const gallery = makeGallery(5, { closable: false });
    gallery.open(0);

    press('Escape');

    expect(document.querySelector('.shoji-outer.shoji-open')).not.toBeNull();
    gallery.destroy();
  });

  it('gallery.close() still works — only the viewer-triggered paths are gated', () => {
    const gallery = makeGallery(5, { closable: false });
    gallery.open(0);

    gallery.close();

    expect(document.querySelector('.shoji-outer.shoji-open')).toBeNull();
    gallery.destroy();
  });

  it('reinit() with closable: true re-shows the close button and re-enables backdrop-click', () => {
    const el = document.createElement('div');
    const items = Array.from({ length: 3 }, (_, i) => ({ id: `${i}`, src: `${i}.jpg` }));
    const gallery = new Gallery(el, { items, closable: false });
    gallery.open(0);
    expect(document.querySelector('.shoji-close')!.hasAttribute('hidden')).toBe(true);

    gallery.reinit({ items, closable: true });
    gallery.open(0);
    expect(document.querySelector('.shoji-close')!.hasAttribute('hidden')).toBe(false);

    click(document.querySelector('.shoji-backdrop')!);
    expect(document.querySelector('.shoji-outer.shoji-open')).toBeNull();
    gallery.destroy();
  });
});

describe('Gallery — loading state while the active slide loads', () => {
  const plugin: ShojiPlugin = {
    name: 'toolbar-button-plugin',
    init(ctx) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'shoji-toolbar-button';
      button.textContent = 'Feature';
      ctx.ui.toolbar('right', button);
    },
  };

  /** Replaces the auto-resolving global decode() stub with one under manual control, so tests can observe the mid-load state. */
  function controlledDecode(): () => void {
    let resolve!: () => void;
    HTMLImageElement.prototype.decode = vi.fn(() => new Promise<void>((r) => (resolve = r)));
    return () => resolve();
  }

  it('disables feature toolbar buttons (not close/nav) while the very first slide is loading, re-enables once it settles', async () => {
    const resolveDecode = controlledDecode();
    const el = document.createElement('div');
    const gallery = new Gallery(el, {
      items: [{ id: 'a', src: 'a.jpg' }],
      plugins: [plugin],
    });
    gallery.open(0);

    const featureButton = document.querySelector('.shoji-toolbar-button')!;
    expect(document.querySelector('.shoji-outer')!.classList.contains('shoji-slide-loading')).toBe(
      true,
    );
    expect(featureButton.getAttribute('aria-disabled')).toBe('true');
    expect((featureButton as HTMLElement).tabIndex).toBe(-1);
    // Close/prev/next are never gated by loading — a slow image must not trap the viewer.
    expect(document.querySelector('.shoji-close')!.getAttribute('aria-disabled')).toBeNull();

    resolveDecode();
    await Promise.resolve();
    await Promise.resolve();

    expect(document.querySelector('.shoji-outer')!.classList.contains('shoji-slide-loading')).toBe(
      false,
    );
    expect(featureButton.getAttribute('aria-disabled')).toBeNull();
    expect((featureButton as HTMLElement).tabIndex).not.toBe(-1);
    gallery.destroy();
  });

  it('does not re-trigger the loading state navigating to an already-preloaded neighbor — SlideManager caches ready content by item index (not just structural slot offset), so the pool reshuffling itself never re-triggers a decode', async () => {
    const el = document.createElement('div');
    const gallery = new Gallery(el, {
      items: [
        { id: 'a', src: 'a.jpg' },
        { id: 'b', src: 'b.jpg' },
      ],
      plugins: [plugin],
      preload: 1, // default, but explicit: 'b' is already decoded in the pool alongside 'a'
    });
    gallery.open(0);
    await Promise.resolve();
    await Promise.resolve();
    expect(document.querySelector('.shoji-outer')!.classList.contains('shoji-slide-loading')).toBe(
      false,
    );

    gallery.next(); // to 'b' — already decoded and cached by index; no fresh decode needed

    expect(document.querySelector('.shoji-outer')!.classList.contains('shoji-slide-loading')).toBe(
      false,
    );
    expect(
      document.querySelector('.shoji-toolbar-button')!.getAttribute('aria-disabled'),
    ).toBeNull();
    gallery.destroy();
  });

  it('does re-trigger the loading state navigating past the preloaded window (not cached)', async () => {
    const el = document.createElement('div');
    const gallery = new Gallery(el, {
      items: [
        { id: 'a', src: 'a.jpg' },
        { id: 'b', src: 'b.jpg' },
        { id: 'c', src: 'c.jpg' },
      ],
      plugins: [plugin],
      preload: 1, // 'b' is preloaded alongside 'a'; 'c' is not
    });
    gallery.open(0);
    await Promise.resolve();
    await Promise.resolve();

    const resolveDecode = controlledDecode();
    gallery.goTo(2); // to 'c' — outside the preloaded window, needs a fresh decode

    expect(document.querySelector('.shoji-outer')!.classList.contains('shoji-slide-loading')).toBe(
      true,
    );
    expect(document.querySelector('.shoji-toolbar-button')!.getAttribute('aria-disabled')).toBe(
      'true',
    );

    resolveDecode();
    await Promise.resolve();
    await Promise.resolve();
    expect(document.querySelector('.shoji-outer')!.classList.contains('shoji-slide-loading')).toBe(
      false,
    );
    gallery.destroy();
  });
});

describe('Gallery — pausing a playing video on close/navigate', () => {
  // A real bug, reported from real usage: neither closing the lightbox nor
  // navigating to another slide ever touched a still-playing video — a
  // slide within the preload window stays cached on purpose (closing
  // doesn't tear down the pool; reopening should be instant), and only
  // genuine eviction from that window released anything. A video the
  // viewer started manually kept playing — audibly, invisibly — after
  // close() or after moving on to a different slide entirely.

  it('close() pauses a playing HTML5 video', () => {
    const el = document.createElement('div');
    const gallery = new Gallery(el, {
      items: [{ id: 'v', src: 'clip.mp4', video: { provider: 'html5' } }],
    });
    gallery.open(0);
    const video = document.querySelector('video')!;
    const pauseSpy = vi.spyOn(video, 'pause').mockImplementation(() => {});
    vi.spyOn(video, 'load').mockImplementation(() => {}); // silences destroy()'s own teardown below

    gallery.close();

    expect(pauseSpy).toHaveBeenCalled();
    gallery.destroy();
  });

  it("navigating away pauses the outgoing slide's playing HTML5 video, without releasing/evicting it — still cached, ready to resume if navigated back to", () => {
    const el = document.createElement('div');
    const gallery = new Gallery(el, {
      items: [
        { id: 'v', src: 'clip.mp4', video: { provider: 'html5' } },
        { id: 'b', src: 'b.jpg' },
      ],
      preload: 1, // 'v' stays cached as the -1 neighbor after stepping to 'b'
    });
    gallery.open(0);
    const video = document.querySelector('video')!;
    const pauseSpy = vi.spyOn(video, 'pause').mockImplementation(() => {});
    const loadSpy = vi.spyOn(video, 'load').mockImplementation(() => {});

    gallery.next();

    expect(pauseSpy).toHaveBeenCalled();
    expect(loadSpy).not.toHaveBeenCalled(); // pause, not release — src is untouched
    expect(document.querySelector('video')).toBe(video); // same node, still in the pool
    gallery.destroy();
  });

  it('close() pauses a playing provider (e.g. YouTube) video via its wired .pause(), without aborting/destroying the embed', () => {
    const el = document.createElement('div');
    const abortSpy = vi.fn();
    const pauseSpy = vi.fn();
    const gallery = new Gallery(el, {
      items: [
        {
          id: 'yt',
          src: 'x',
          video: {
            provider: 'custom',
            render: (container, _item, onReady, signal) => {
              signal.addEventListener('abort', abortSpy);
              const providerEl = container as HTMLElement & { pause: () => void };
              providerEl.pause = pauseSpy;
              container.appendChild(document.createElement('iframe'));
              onReady();
            },
          },
        },
      ],
    });
    gallery.open(0);

    gallery.close();

    expect(pauseSpy).toHaveBeenCalled();
    expect(abortSpy).not.toHaveBeenCalled(); // still cached, not torn down
    gallery.destroy();
  });
});
