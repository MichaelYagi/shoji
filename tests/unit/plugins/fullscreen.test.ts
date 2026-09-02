import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Gallery } from '../../../src/core';
import { Fullscreen } from '../../../src/plugins/fullscreen';
import type { PluginContext } from '../../../src/core/plugin';

/** A minimal stand-in for a host-authored custom plugin — captures `ctx.emit` so a test can fire a `request*` command the same way a real custom plugin's own button click would, with zero import of Fullscreen itself. */
class EmitterPlugin {
  name = 'test-emitter';
  emit!: PluginContext['emit'];
  init(ctx: PluginContext): void {
    this.emit = ctx.emit;
  }
}

let fullscreenElement: Element | null = null;

function mockFullscreenSupport(): void {
  fullscreenElement = null;
  Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true });
  Object.defineProperty(document, 'fullscreenElement', {
    configurable: true,
    get: () => fullscreenElement,
  });
  // The plugin only ever calls requestFullscreen() on .shoji-outer, so the
  // mock doesn't need to track `this` (avoids the no-this-alias lint rule
  // too) — it just looks up the one element these tests care about.
  Element.prototype.requestFullscreen = vi.fn((): Promise<void> => {
    fullscreenElement = document.querySelector('.shoji-outer');
    document.dispatchEvent(new Event('fullscreenchange'));
    return Promise.resolve();
  }) as unknown as typeof Element.prototype.requestFullscreen;
  document.exitFullscreen = vi.fn(() => {
    fullscreenElement = null;
    document.dispatchEvent(new Event('fullscreenchange'));
    return Promise.resolve();
  });
}

function clearFullscreenSupport(): void {
  // @ts-expect-error - removing the test-only stubs added above
  delete document.fullscreenEnabled;
  // @ts-expect-error - removing the test-only stubs added above
  delete document.fullscreenElement;
  // @ts-expect-error - removing the test-only stubs added above
  delete Element.prototype.requestFullscreen;
  // @ts-expect-error - removing the test-only stubs added above
  delete document.exitFullscreen;
}

beforeEach(() => {
  HTMLImageElement.prototype.decode = vi.fn().mockResolvedValue(undefined);
  mockFullscreenSupport();
});

afterEach(() => {
  vi.restoreAllMocks();
  clearFullscreenSupport();
  // @ts-expect-error - removing the test-only stub added above
  delete HTMLImageElement.prototype.decode;
  document.body.innerHTML = '';
});

function toggleButton(): HTMLButtonElement {
  // :not(.shoji-caption-toggle):not(.shoji-toolbar-overflow) excludes core's
  // own video-caption toggle and toolbar-overflow caret, which also live in
  // this slot (both hidden unless needed, but still real
  // .shoji-toolbar-button elements in the DOM — DESIGN.md §3.1a).
  return document.querySelector(
    '.shoji-toolbar-right .shoji-toolbar-button:not(.shoji-caption-toggle):not(.shoji-toolbar-overflow)',
  ) as HTMLButtonElement;
}

function outer(): HTMLElement {
  return document.querySelector('.shoji-outer') as HTMLElement;
}

function click(el: Element): void {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

function makeGallery(options: Record<string, unknown> = {}): Gallery {
  return new Gallery(document.createElement('div'), { plugins: [Fullscreen], ...options });
}

describe('Fullscreen — support detection', () => {
  it('adds a toolbar button when the Fullscreen API is supported', () => {
    const gallery = makeGallery();
    expect(toggleButton()).not.toBeNull();
    gallery.destroy();
  });

  it('adds no toolbar button at all when unsupported, rather than a disabled one', () => {
    clearFullscreenSupport();
    const gallery = makeGallery();
    expect(toggleButton()).toBeNull();
    gallery.destroy();
  });
});

describe('Fullscreen — toggling', () => {
  it('starts in the "enter" state', () => {
    const gallery = makeGallery();
    const button = toggleButton();
    expect(button.getAttribute('aria-label')).toBe('Enter fullscreen');
    expect(button.getAttribute('aria-pressed')).toBe('false');
    gallery.destroy();
  });

  it('clicking requests fullscreen on .shoji-outer (the whole lightbox), not just the slide', () => {
    const gallery = makeGallery();
    click(toggleButton());

    expect(outer().requestFullscreen).toHaveBeenCalledTimes(1);
    expect(fullscreenElement).toBe(outer());
    gallery.destroy();
  });

  it('the fullscreenchange event (not the click itself) drives the button state', () => {
    const gallery = makeGallery();
    const button = toggleButton();

    click(button);

    expect(button.getAttribute('aria-label')).toBe('Exit fullscreen');
    expect(button.getAttribute('aria-pressed')).toBe('true');
    gallery.destroy();
  });

  it('the icon-swap wrapper (src/core/iconSwap.ts) reflects state via its modifier class, not a raw icon swap', () => {
    const gallery = makeGallery();
    const button = toggleButton();
    const swap = button.querySelector('.shoji-icon-swap');
    expect(swap).not.toBeNull();
    expect(swap!.classList.contains('shoji-icon-swap--on')).toBe(false);

    click(button);
    expect(swap!.classList.contains('shoji-icon-swap--on')).toBe(true);

    click(button);
    expect(swap!.classList.contains('shoji-icon-swap--on')).toBe(false);
    gallery.destroy();
  });

  it('clicking again while active exits fullscreen', () => {
    const gallery = makeGallery();
    const button = toggleButton();
    click(button); // enter
    click(button); // exit

    expect(document.exitFullscreen).toHaveBeenCalledTimes(1);
    expect(button.getAttribute('aria-pressed')).toBe('false');
    gallery.destroy();
  });

  it('emits fullscreenChange on the gallery bus, reflecting the real fullscreenchange event', () => {
    const gallery = makeGallery();
    const onChange = vi.fn();
    gallery.on('fullscreenChange', onChange);

    click(toggleButton());
    expect(onChange).toHaveBeenLastCalledWith({ fullscreen: true });

    click(toggleButton());
    expect(onChange).toHaveBeenLastCalledWith({ fullscreen: false });

    gallery.destroy();
  });

  it('reacts correctly to fullscreen exiting by means other than the button (e.g. browser Escape handling)', () => {
    const gallery = makeGallery();
    const button = toggleButton();
    click(button); // enter via button

    // Simulate the browser itself exiting fullscreen (Escape), bypassing our click handler.
    fullscreenElement = null;
    document.dispatchEvent(new Event('fullscreenchange'));

    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(button.getAttribute('aria-label')).toBe('Enter fullscreen');
    gallery.destroy();
  });
});

describe('Fullscreen — gallery close', () => {
  it('exits fullscreen when the gallery closes while still fullscreen', () => {
    const gallery = makeGallery({ items: [{ id: 'a', src: 'a.jpg' }] });
    gallery.open(0);
    click(toggleButton());
    expect(fullscreenElement).toBe(outer());

    gallery.close();

    expect(document.exitFullscreen).toHaveBeenCalledTimes(1);
    gallery.destroy();
  });

  it('does not call exitFullscreen on close if never entered fullscreen', () => {
    const gallery = makeGallery({ items: [{ id: 'a', src: 'a.jpg' }] });
    gallery.open(0);
    gallery.close();

    expect(document.exitFullscreen).not.toHaveBeenCalled();
    gallery.destroy();
  });
});

describe('Fullscreen — locale', () => {
  it('reads enter/exit labels from the gallery-wide locale map', () => {
    const gallery = new Gallery(document.createElement('div'), {
      plugins: [Fullscreen],
      locale: { enterFullscreen: 'Agrandir', exitFullscreen: 'Réduire' },
    });

    expect(toggleButton().getAttribute('aria-label')).toBe('Agrandir');
    click(toggleButton());
    expect(toggleButton().getAttribute('aria-label')).toBe('Réduire');

    gallery.destroy();
  });
});

describe('Fullscreen — cleanup', () => {
  it('destroy() removes the toolbar button and exits fullscreen if still active', () => {
    const gallery = makeGallery();
    click(toggleButton());
    expect(fullscreenElement).toBe(outer());

    gallery.destroy();

    expect(document.exitFullscreen).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.shoji-toolbar-button')).toBeNull();
  });

  it('destroy() does not throw or call exitFullscreen when never entered fullscreen', () => {
    const gallery = makeGallery();
    expect(() => gallery.destroy()).not.toThrow();
    expect(document.exitFullscreen).not.toHaveBeenCalled();
  });
});

describe('Fullscreen — requestFullscreenToggle (DESIGN.md §4.4), a generic surface for a custom plugin', () => {
  it('mirrors the toolbar button exactly, both directions', () => {
    const emitter = new EmitterPlugin();
    const gallery = new Gallery(document.createElement('div'), { plugins: [Fullscreen, emitter] });
    const button = toggleButton();

    emitter.emit('requestFullscreenToggle', {});
    expect(outer().requestFullscreen).toHaveBeenCalledTimes(1);
    expect(button.getAttribute('aria-pressed')).toBe('true');

    emitter.emit('requestFullscreenToggle', {});
    expect(document.exitFullscreen).toHaveBeenCalledTimes(1);
    expect(button.getAttribute('aria-pressed')).toBe('false');

    gallery.destroy();
  });
});
