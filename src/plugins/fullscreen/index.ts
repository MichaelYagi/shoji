import type { PluginContext, ShojiPlugin } from '../../core/plugin';
import { COMPRESS_ICON, EXPAND_ICON } from './icons';

/**
 * Vendor-prefixed Fullscreen API surface (older Safari) — not in standard
 * `lib.dom.d.ts`, so this is a documented interop boundary (CLAUDE.md: `any`
 * only there). Everything else in this file uses the standard,
 * already-typed `Element.requestFullscreen`/`Document.exitFullscreen`/
 * `Document.fullscreenElement`/`Document.fullscreenEnabled`.
 */
interface WebkitFullscreenElement extends HTMLElement {
  webkitRequestFullscreen?: () => void;
}
interface WebkitFullscreenDocument extends Document {
  webkitExitFullscreen?: () => void;
  webkitFullscreenElement?: Element | null;
  webkitFullscreenEnabled?: boolean;
}

function isSupported(): boolean {
  return !!(
    document.fullscreenEnabled || (document as WebkitFullscreenDocument).webkitFullscreenEnabled
  );
}

function currentFullscreenElement(): Element | null {
  return (
    document.fullscreenElement ??
    (document as WebkitFullscreenDocument).webkitFullscreenElement ??
    null
  );
}

function requestFullscreen(el: HTMLElement): void {
  const target = el as WebkitFullscreenElement;
  if (target.requestFullscreen) target.requestFullscreen().catch(() => {});
  else target.webkitRequestFullscreen?.();
}

function exitFullscreen(): void {
  const doc = document as WebkitFullscreenDocument;
  if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
  else doc.webkitExitFullscreen?.();
}

/**
 * DESIGN.md §4 — native Fullscreen API toggle, `.shoji-outer` (`ctx.ui.outer()`,
 * the whole lightbox — backdrop, dialog, controls) is what goes fullscreen,
 * not just the slide media. No toolbar button at all — not a disabled one —
 * on a browser with no Fullscreen API support (checked once at `init()`;
 * historically Safari on iOS), rather than shipping a dead control.
 *
 * `fullscreenchange` (plus the `webkitfullscreenchange` vendor variant) is
 * the single source of truth for button state, not the click handler
 * directly — a real Fullscreen API `request`/`exit` call can be rejected
 * (permission, another element already fullscreen, etc.), and the browser's
 * own Escape-key fullscreen exit doesn't go through this plugin's click
 * handler at all. Reacting to the event instead of the request keeps the
 * button correct regardless of *why* fullscreen state changed.
 */
export const Fullscreen: ShojiPlugin = {
  name: 'fullscreen',

  init(ctx: PluginContext): (() => void) | void {
    if (!isSupported()) return;

    const outer = ctx.ui.outer();
    const locale = (ctx.gallery.options.locale ?? {}) as Record<string, string>;
    const enterLabel = locale.enterFullscreen ?? 'Enter fullscreen';
    const exitLabel = locale.exitFullscreen ?? 'Exit fullscreen';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'shoji-toolbar-button';
    button.innerHTML = EXPAND_ICON;
    button.setAttribute('aria-label', enterLabel);
    button.title = enterLabel;
    button.setAttribute('aria-pressed', 'false');

    function isActive(): boolean {
      return currentFullscreenElement() === outer;
    }

    function setState(active: boolean): void {
      button.innerHTML = active ? COMPRESS_ICON : EXPAND_ICON;
      button.setAttribute('aria-label', active ? exitLabel : enterLabel);
      button.title = active ? exitLabel : enterLabel;
      button.setAttribute('aria-pressed', String(active));
    }

    /** Shared by the toolbar button and `requestFullscreenToggle` below. */
    function toggleFullscreen(): void {
      if (isActive()) exitFullscreen();
      else requestFullscreen(outer);
    }
    button.addEventListener('click', toggleFullscreen);

    const onChange = (): void => {
      const active = isActive();
      setState(active);
      ctx.emit('fullscreenChange', { fullscreen: active });
    };
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange);

    // 'right' — clusters immediately before the close button (DESIGN.md §3.1).
    const removeButton = ctx.ui.toolbar('right', button);

    // Browser-level Escape-to-exit-fullscreen behavior is inconsistent
    // across browsers (some exit fullscreen and still deliver the page its
    // own Escape keydown, some don't) — closing the gallery explicitly
    // exits fullscreen too, rather than risking the page getting stuck
    // fullscreen-on-nothing after the lightbox itself is gone.
    const offClose = ctx.on('close', () => {
      if (isActive()) exitFullscreen();
    });
    /**
     * A generic command surface, requested directly (DESIGN.md §4.4), so a
     * *custom* (host-authored) plugin's own button can toggle fullscreen
     * without importing this plugin at all — same "events over
     * inheritance" decoupling `close` above already uses.
     * `GalleryEvents` (`core/types.ts`) already extends `Record<string,
     * unknown>`, so `ctx.emit('requestFullscreenToggle', {})` from any
     * plugin — official or custom — type-checks with zero core changes;
     * this is just the listening half.
     */
    const offRequestToggle = ctx.on('requestFullscreenToggle', toggleFullscreen);

    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('webkitfullscreenchange', onChange);
      removeButton();
      offClose();
      offRequestToggle();
      if (isActive()) exitFullscreen();
    };
  },
};
