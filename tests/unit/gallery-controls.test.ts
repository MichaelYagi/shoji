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

  it('shows the caption bar with the item text when present', () => {
    const el = document.createElement('div');
    const gallery = new Gallery(el, {
      items: [{ id: 'a', src: 'a.jpg', caption: 'A sunset' }],
    });
    gallery.open(0);

    const caption = document.querySelector('.shoji-caption') as HTMLElement;
    expect(caption.hidden).toBe(false);
    expect(caption.textContent).toBe('A sunset');

    gallery.destroy();
  });

  it('renders an HTMLElement caption as real DOM, not escaped text', () => {
    const el = document.createElement('div');
    const rich = document.createElement('span');
    rich.innerHTML = '<strong>Bold</strong> caption';
    const gallery = new Gallery(el, { items: [{ id: 'a', src: 'a.jpg', caption: rich }] });
    gallery.open(0);

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

  it('swaps cleanly from an HTMLElement caption to a string caption on navigation', () => {
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

    const caption = document.querySelector('.shoji-caption') as HTMLElement;
    expect(caption.querySelector('span')).toBeNull();
    expect(caption.textContent).toBe('Plain');

    gallery.destroy();
  });

  it('renders dangerouslySetInnerHTML as raw, unescaped HTML', () => {
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

  it('clicking a nav button does not also trigger a close', () => {
    const gallery = makeGallery();
    gallery.open(1);

    click(document.querySelector('.shoji-nav-next')!);

    expect(document.querySelector('.shoji-outer.shoji-open')).not.toBeNull();
    expect(gallery.currentIndex).toBe(2);
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

  it("re-triggers the loading state on every navigation, even to a structurally-preloaded neighbor — SlideManager pool slots are keyed by structural offset, not by item index, so the slot that becomes active after a navigation is a different physical slot than the one that had the neighbor preloaded, and it decodes fresh (a known gap, not this feature's scope to fix)", async () => {
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

    gallery.next(); // to 'b' — already decoded in another slot, but that slot isn't the one becoming active

    expect(document.querySelector('.shoji-outer')!.classList.contains('shoji-slide-loading')).toBe(
      true,
    );
    expect(document.querySelector('.shoji-toolbar-button')!.getAttribute('aria-disabled')).toBe(
      'true',
    );
    gallery.destroy();
  });
});
