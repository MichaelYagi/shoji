import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Gallery } from '../../src/core';
import type { PluginContext, ShojiPlugin } from '../../src/core/plugin';

beforeEach(() => {
  HTMLImageElement.prototype.decode = vi.fn().mockResolvedValue(undefined);
});

afterEach(() => {
  // @ts-expect-error - removing the test-only stub added above
  delete HTMLImageElement.prototype.decode;
  document.body.innerHTML = '';
});

function makeGallery(plugins: ShojiPlugin[], extraOptions: Record<string, unknown> = {}) {
  const el = document.createElement('div');
  const items = [
    { id: 'a', src: 'a.jpg' },
    { id: 'b', src: 'b.jpg' },
  ];
  return new Gallery(el, { items, plugins, ...extraOptions });
}

function stubPlugin(
  overrides: Partial<ShojiPlugin> = {},
): ShojiPlugin & { initCalls: PluginContext[] } {
  const initCalls: PluginContext[] = [];
  return {
    name: 'stub',
    initCalls,
    init(ctx) {
      initCalls.push(ctx);
    },
    ...overrides,
  };
}

describe('Plugin loader', () => {
  it('calls init() at construction time, before any open() — layout (§5) needs the inline container ready pre-open', () => {
    const plugin = stubPlugin();
    makeGallery([plugin]);

    expect(plugin.initCalls).toHaveLength(1);
  });

  it('calls init() exactly once — opening/closing/reopening does not re-init', () => {
    const plugin = stubPlugin();
    const gallery = makeGallery([plugin]);
    expect(plugin.initCalls).toHaveLength(1);

    gallery.open(0);
    gallery.close();
    gallery.open(0);
    expect(plugin.initCalls).toHaveLength(1);

    gallery.destroy();
  });

  it('merges plugin.defaults with the host-supplied options[plugin.name]', () => {
    const plugin = stubPlugin({
      name: 'greeter',
      defaults: { greeting: 'hello', volume: 1 },
    });
    const gallery = makeGallery([plugin], { greeter: { volume: 11 } });

    gallery.open(0);

    expect(plugin.initCalls[0]?.options).toEqual({ greeting: 'hello', volume: 11 });
    gallery.destroy();
  });

  it('skips a plugin whose requires dependency is missing from the plugins array entirely, without throwing', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const dependent = stubPlugin({ name: 'dependent', requires: ['missing-dep'] });
    const gallery = makeGallery([dependent]);

    expect(() => gallery.open(0)).not.toThrow();
    expect(dependent.initCalls).toHaveLength(0);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('missing-dep'));

    gallery.destroy();
    errorSpy.mockRestore();
  });

  it('skips an undefined plugins[] entry without crashing the rest — e.g. plugins: [Shoji.Autoplay] against a stale dist build predating that plugin', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const real = stubPlugin({ name: 'real' });
    // @ts-expect-error - deliberately malformed, simulating a host referencing
    // a plugin static that doesn't exist on their (stale) UMD global
    const gallery = makeGallery([undefined, real]);

    expect(() => gallery.open(0)).not.toThrow();
    expect(real.initCalls).toHaveLength(1); // the valid entry after it still loads
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('invalid plugins[] entry'),
      undefined,
    );

    gallery.destroy();
    errorSpy.mockRestore();
  });

  it('a satisfied requires dependency declared earlier in the array still initializes', () => {
    const base = stubPlugin({ name: 'base' });
    const dependent = stubPlugin({ name: 'dependent', requires: ['base'] });
    const gallery = makeGallery([base, dependent]);

    gallery.open(0);

    expect(base.initCalls).toHaveLength(1);
    expect(dependent.initCalls).toHaveLength(1);
    gallery.destroy();
  });

  it('a satisfied requires dependency declared LATER in the array also initializes — requires is resolved against the whole list, not registration order', () => {
    const dependent = stubPlugin({ name: 'dependent', requires: ['base'] });
    const base = stubPlugin({ name: 'base' });
    const gallery = makeGallery([dependent, base]); // dependent declared first, on purpose

    gallery.open(0);

    expect(dependent.initCalls).toHaveLength(1);
    expect(base.initCalls).toHaveLength(1);
    // init() still runs in declared array order regardless — dependent's
    // own init() isn't deferred until after base's, only the *validity*
    // check is order-independent, not execution order.
    expect(gallery.getActivePlugins()).toEqual(['dependent', 'base']);
    gallery.destroy();
  });

  it('a requires chain cascades: if the required plugin itself has an unmet requires, the plugin depending on it is skipped too', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const b = stubPlugin({ name: 'plugin-b', requires: ['nonexistent'] });
    const c = stubPlugin({ name: 'plugin-c', requires: ['plugin-b'] });
    const gallery = makeGallery([b, c]);

    expect(b.initCalls).toHaveLength(0);
    expect(c.initCalls).toHaveLength(0);
    expect(gallery.getActivePlugins()).toEqual([]);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('nonexistent'));
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('plugin-b'));

    gallery.destroy();
    errorSpy.mockRestore();
  });

  it('a genuine mutual requirement (A requires B, B requires A) — both otherwise valid — loads both, not neither', () => {
    const a = stubPlugin({ name: 'plugin-a', requires: ['plugin-b'] });
    const b = stubPlugin({ name: 'plugin-b', requires: ['plugin-a'] });
    const gallery = makeGallery([a, b]);

    expect(a.initCalls).toHaveLength(1);
    expect(b.initCalls).toHaveLength(1);
    expect(gallery.getActivePlugins()).toEqual(['plugin-a', 'plugin-b']);
    gallery.destroy();
  });

  it('calls a plugin-returned cleanup function on destroy()', () => {
    const cleanup = vi.fn();
    const plugin = stubPlugin({ init: () => cleanup });
    const gallery = makeGallery([plugin]);

    gallery.open(0);
    expect(cleanup).not.toHaveBeenCalled();

    gallery.destroy();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('ctx.ui.toolbar(slot, ButtonSpec) builds and inserts a real button; the unsubscribe removes it', () => {
    const onClick = vi.fn();
    let unsubscribe: () => void = () => {};
    const plugin = stubPlugin({
      init(ctx) {
        unsubscribe = ctx.ui.toolbar('left', { label: 'Do thing', icon: '<svg></svg>', onClick });
      },
    });
    const gallery = makeGallery([plugin]);
    gallery.open(0);

    const button = document.querySelector(
      '.shoji-toolbar-left .shoji-toolbar-button',
    ) as HTMLButtonElement;
    expect(button).not.toBeNull();
    expect(button.getAttribute('aria-label')).toBe('Do thing');

    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onClick).toHaveBeenCalledTimes(1);

    unsubscribe();
    expect(document.querySelector('.shoji-toolbar-left .shoji-toolbar-button')).toBeNull();

    gallery.destroy();
  });

  it("ctx.ui.toolbar('right', ...) inserts before the close button, not after — plugin buttons end up to its left", () => {
    const plugin = stubPlugin({
      init(ctx) {
        const button = document.createElement('button');
        button.textContent = 'A';
        ctx.ui.toolbar('right', button);
      },
    });
    const gallery = makeGallery([plugin]);
    gallery.open(0);

    const children = Array.from(document.querySelector('.shoji-toolbar-right')!.children);
    const closeIndex = children.findIndex((el) => el.classList.contains('shoji-close'));
    const buttonIndex = children.findIndex((el) => el.textContent === 'A');
    expect(buttonIndex).toBeGreaterThanOrEqual(0);
    expect(buttonIndex).toBeLessThan(closeIndex); // to close's left, not its right

    gallery.destroy();
  });

  it("multiple plugins using 'right' preserve registration order, immediately followed by the overflow caret then close — [A, B, C] reads A, B, C, caret, close", () => {
    const makeButtonPlugin = (name: string, label: string): ShojiPlugin =>
      stubPlugin({
        name,
        init(ctx) {
          const button = document.createElement('button');
          button.textContent = label;
          ctx.ui.toolbar('right', button);
        },
      });
    const gallery = makeGallery([
      makeButtonPlugin('p1', 'A'),
      makeButtonPlugin('p2', 'B'),
      makeButtonPlugin('p3', 'C'),
    ]);
    gallery.open(0);

    const children = Array.from(document.querySelector('.shoji-toolbar-right')!.children);
    // Leading '' — core's own video-caption toggle button (hidden here, no
    // video slide active, but still a real child of this slot); trailing two
    // '' — the (also hidden here) toolbar-overflow caret, then close, per
    // DESIGN.md §3.1a — all icon-only, no text.
    expect(children.map((el) => el.textContent)).toEqual(['', 'A', 'B', 'C', '', '']);
    expect(children.at(-2)!.classList.contains('shoji-toolbar-overflow')).toBe(true);
    expect(children.at(-1)!.classList.contains('shoji-close')).toBe(true);

    gallery.destroy();
  });

  it('ctx.ui.toolbar accepts a raw HTMLElement directly, inserted as-is', () => {
    const custom = document.createElement('span');
    custom.className = 'my-custom-widget';
    const plugin = stubPlugin({
      init(ctx) {
        ctx.ui.toolbar('center', custom);
      },
    });
    const gallery = makeGallery([plugin]);
    gallery.open(0);

    expect(document.querySelector('.shoji-toolbar-center .my-custom-widget')).toBe(custom);
    gallery.destroy();
  });

  it('ctx.ui.overlay(el) appends into the dialog; the unsubscribe removes it', () => {
    const overlay = document.createElement('div');
    overlay.className = 'my-overlay';
    let unsubscribe: () => void = () => {};
    const plugin = stubPlugin({
      init(ctx) {
        unsubscribe = ctx.ui.overlay(overlay, 5);
      },
    });
    const gallery = makeGallery([plugin]);
    gallery.open(0);

    expect(document.querySelector('.shoji-dialog > .my-overlay')).toBe(overlay);
    expect(overlay.style.zIndex).toBe('5');

    unsubscribe();
    expect(document.querySelector('.my-overlay')).toBeNull();
    gallery.destroy();
  });

  it('ctx.ui.registerShortcut(key, fn) fires on matching keydown while open; unsubscribe removes it', () => {
    const fn = vi.fn();
    let unsubscribe: () => void = () => {};
    const plugin = stubPlugin({
      init(ctx) {
        unsubscribe = ctx.ui.registerShortcut('p', fn);
      },
    });
    const gallery = makeGallery([plugin]);
    gallery.open(0);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'p' }));
    expect(fn).toHaveBeenCalledTimes(1);

    unsubscribe();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'p' }));
    expect(fn).toHaveBeenCalledTimes(1); // still just once

    gallery.destroy();
  });

  it('ctx.storage.get/set round-trips a value scoped to this gallery instance', () => {
    const plugin = stubPlugin({
      init(ctx) {
        expect(ctx.storage.get('x')).toBeUndefined();
        ctx.storage.set('x', 42);
        expect(ctx.storage.get('x')).toBe(42);
      },
    });
    const gallery = makeGallery([plugin]);
    gallery.open(0);
    gallery.destroy();
  });

  it('ctx.emit() delivers to gallery.on() — the same bus host code listens on', () => {
    const handler = vi.fn();
    let emitLater: (() => void) | undefined;
    const plugin = stubPlugin({
      // init() now runs at construction (before the host can call gallery.on()
      // on the not-yet-returned instance), so this captures ctx.emit to fire
      // on demand instead of emitting synchronously inside init() itself.
      init(ctx) {
        emitLater = () => ctx.emit('autoplayStart', {});
      },
    });
    const gallery = makeGallery([plugin]);
    gallery.on('autoplayStart', handler);

    emitLater!();

    expect(handler).toHaveBeenCalledWith({});
    gallery.destroy();
  });

  it('getActiveMedia() returns the (empty) active slide-media container even before the first open() now that the lightbox builds eagerly, and null once destroyed', () => {
    const gallery = makeGallery([]);
    expect(gallery.getActiveMedia()).not.toBeNull();
    expect(gallery.getActiveMedia()?.className).toContain('shoji-slide-media');

    gallery.open(0);
    expect(gallery.getActiveMedia()).not.toBeNull();
    expect(gallery.getActiveMedia()?.className).toContain('shoji-slide-media');

    gallery.destroy();
    expect(gallery.getActiveMedia()).toBeNull();
  });

  describe('getActivePlugins()', () => {
    it('lists successfully initialized plugin names, in registration order', () => {
      const a = stubPlugin({ name: 'a' });
      const b = stubPlugin({ name: 'b' });
      const gallery = makeGallery([a, b]);

      expect(gallery.getActivePlugins()).toEqual(['a', 'b']);
      gallery.destroy();
    });

    it('excludes an invalid (undefined) plugins[] entry', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const real = stubPlugin({ name: 'real' });
      // @ts-expect-error - deliberately malformed, same as the invalid-entry test above
      const gallery = makeGallery([undefined, real]);

      expect(gallery.getActivePlugins()).toEqual(['real']);

      gallery.destroy();
      errorSpy.mockRestore();
    });

    it('excludes a plugin skipped for an unmet requires dependency', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const dependent = stubPlugin({ name: 'dependent', requires: ['missing-dep'] });
      const gallery = makeGallery([dependent]);

      expect(gallery.getActivePlugins()).toEqual([]);

      gallery.destroy();
      errorSpy.mockRestore();
    });

    it('deduplicates a name registered twice', () => {
      const first = stubPlugin({ name: 'dup' });
      const second = stubPlugin({ name: 'dup' });
      const gallery = makeGallery([first, second]);

      expect(gallery.getActivePlugins()).toEqual(['dup']);
      gallery.destroy();
    });

    it('reflects a reinit() with a different plugin list, not the union of both', () => {
      const original = stubPlugin({ name: 'original' });
      const gallery = makeGallery([original]);
      expect(gallery.getActivePlugins()).toEqual(['original']);

      const replacement = stubPlugin({ name: 'replacement' });
      gallery.reinit({ ...gallery.options, plugins: [replacement] });

      expect(gallery.getActivePlugins()).toEqual(['replacement']);
      gallery.destroy();
    });

    it('is empty after destroy()', () => {
      const gallery = makeGallery([stubPlugin({ name: 'a' })]);
      expect(gallery.getActivePlugins()).toEqual(['a']);

      gallery.destroy();
      expect(gallery.getActivePlugins()).toEqual([]);
    });
  });
});
