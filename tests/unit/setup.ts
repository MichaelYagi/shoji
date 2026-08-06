// jsdom doesn't implement CSS.escape (every real browser does) — polyfill it
// so code paths that use it (e.g. the data-shoji-id origin lookup) are
// actually exercised under test instead of silently no-op'ing.
if (typeof globalThis.CSS === 'undefined') {
  (globalThis as unknown as { CSS: { escape: (v: string) => string } }).CSS = {
    escape: (value: string) => value.replace(/([^\w-])/g, '\\$1'),
  };
} else if (typeof globalThis.CSS.escape !== 'function') {
  globalThis.CSS.escape = (value: string) => value.replace(/([^\w-])/g, '\\$1');
}

// jsdom doesn't implement ResizeObserver at all — a minimal, inert stub so
// code that constructs one (the layout plugin's masonry resize handling)
// doesn't crash with "ResizeObserver is not defined". Tests that need to
// actually exercise a resize callback override `window.ResizeObserver` with
// their own vi.fn()-based mock locally instead of relying on this default.
if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}

// jsdom has no PointerEvent at all (every real browser does) — the gesture
// engine (DESIGN.md §2.4) is built entirely on it. A minimal polyfill on top
// of MouseEvent (which jsdom does implement, and which PointerEvent extends
// in real browsers) gives tests the fields GestureEngine actually reads:
// pointerId, pointerType, isPrimary. `new PointerEvent(...)` in tests then
// exercises the real code path instead of every gesture test needing its
// own ad hoc Event-plus-manually-assigned-properties workaround.
if (typeof globalThis.PointerEvent === 'undefined') {
  class PointerEventPolyfill extends MouseEvent {
    readonly pointerId: number;
    readonly pointerType: string;
    readonly isPrimary: boolean;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
      this.pointerType = init.pointerType ?? 'mouse';
      this.isPrimary = init.isPrimary ?? true;
    }
  }
  globalThis.PointerEvent = PointerEventPolyfill as unknown as typeof PointerEvent;
}

// jsdom doesn't implement pointer capture at all — GestureEngine calls
// setPointerCapture() on drag start (real browsers use it to keep receiving
// move/up events even if the pointer leaves the element) and it must not
// throw under test; a no-op is a faithful enough stand-in since jsdom
// dispatches events manually anyway, not via real OS pointer routing.
if (typeof Element.prototype.setPointerCapture === 'undefined') {
  Element.prototype.setPointerCapture = function (): void {};
  Element.prototype.releasePointerCapture = function (): void {};
  Element.prototype.hasPointerCapture = function (): boolean {
    return false;
  };
}

// jsdom doesn't implement scrollIntoView at all — the activeThumbnail
// plugin calls it on every navigation by default (scrollIntoView: true), so
// without a stub every test exercising that default path would throw.
if (typeof Element.prototype.scrollIntoView === 'undefined') {
  Element.prototype.scrollIntoView = function (): void {};
}
