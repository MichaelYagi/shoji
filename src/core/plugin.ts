import type { Gallery } from './Gallery';
import type { GalleryEvents } from './types';
import type { Unsubscribe } from './EventBus';

/**
 * DESIGN.md §3 — the plugin contract. Plugins init at `new Shoji()`
 * construction time — the lightbox DOM (hidden, `display:none` until the
 * first `open()`) is built eagerly specifically so `init()` can rely on
 * `ctx.ui.*` synchronously, with zero queueing, from the very start. This
 * also means a plugin can act *before* any `open()` call — the layout
 * plugin (§5) depends on that: it renders `ctx.gallery.element` (the inline
 * thumbnail container) immediately, since that's what the viewer clicks to
 * open in the first place, not something that only matters once already open.
 */
export interface ShojiPlugin {
  name: string;
  version?: string;
  requires?: string[];
  defaults?: Record<string, unknown>;
  init(ctx: PluginContext): void | (() => void);
}

export interface ButtonSpec {
  label: string;
  icon?: string;
  onClick: (event: MouseEvent) => void;
}

export type KeySpec = string;

export interface PluginContext {
  gallery: Gallery;
  options: Readonly<Record<string, unknown>>;
  on: Gallery['on'];
  /** Emits through the same typed bus `gallery.on()` reads from — this is how plugin-contributed events (e.g. `autoplayStart`/`autoplayStop`) reach host listeners. */
  emit<K extends keyof GalleryEvents>(event: K, detail: GalleryEvents[K]): void;
  ui: {
    toolbar(slot: 'left' | 'center' | 'right', el: HTMLElement | ButtonSpec): Unsubscribe;
    overlay(el: HTMLElement, layer?: number): Unsubscribe;
    outer(): HTMLElement;
    registerShortcut(key: KeySpec, fn: (e: KeyboardEvent) => void): Unsubscribe;
  };
  storage: {
    get(key: string): unknown;
    set(key: string, value: unknown): void;
  };
}
