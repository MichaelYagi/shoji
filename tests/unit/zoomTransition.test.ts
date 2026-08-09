import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { zoomIn, zoomOut } from '../../src/core/zoomTransition';

function mockRect(el: HTMLElement, rect: Partial<DOMRect>): void {
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: 0,
    height: 0,
    x: 0,
    y: 0,
    toJSON: () => ({}),
    ...rect,
  });
}

function makeMatchMedia(matches: boolean): typeof window.matchMedia {
  return vi.fn().mockReturnValue({ matches }) as unknown as typeof window.matchMedia;
}

describe('zoomTransition', () => {
  let origin: HTMLElement;
  let target: HTMLElement;

  beforeEach(() => {
    origin = document.createElement('div');
    target = document.createElement('div');
    document.body.append(origin, target);
    window.matchMedia = makeMatchMedia(false);
  });

  afterEach(() => {
    origin.remove();
    target.remove();
    vi.restoreAllMocks();
  });

  describe('zoomIn', () => {
    it('applies an instant transform then transitions it away to natural size', () => {
      mockRect(origin, { top: 100, left: 50, width: 40, height: 30 });
      mockRect(target, { top: 0, left: 0, width: 800, height: 600 });

      zoomIn({ origin, target });

      // After the synchronous zoomIn() call, the transition should already
      // be set to animate *toward* the natural (no-transform) state.
      expect(target.style.transition).toContain('var(--shoji-duration)');
      expect(target.style.transform).toBe('none');
    });

    it('regression: the instant jump actually lands the target on top of origin, not offset from it', () => {
      // Bug this pins down: computeTransform's translateX/Y is center-to-center
      // math, which only lands correctly if transform-origin is also center —
      // pairing it with 'top left' silently shipped once and put the animated
      // box wherever origin's center happens to sit from ITS OWN top-left
      // corner, nowhere near origin's actual rect. Only reproducible with real
      // (non-zero) rects, which is why this didn't fail as a jsdom zero-layout
      // no-op — it required this test to mock real geometry to catch it.
      const originRect = { top: 534, left: 1007, width: 192, height: 255 };
      const targetRect = { top: 0, left: 0, width: 1400, height: 1170 };
      mockRect(origin, originRect);
      mockRect(target, targetRect);

      let firstTransform = '';
      let capturedOrigin = '';
      const styleProto = Object.getPrototypeOf(target.style) as CSSStyleDeclaration;
      const transformDesc = Object.getOwnPropertyDescriptor(styleProto, 'transform')!;
      const originDesc = Object.getOwnPropertyDescriptor(styleProto, 'transformOrigin')!;
      Object.defineProperty(target.style, 'transform', {
        configurable: true,
        get() {
          return transformDesc.get!.call(target.style);
        },
        set(v: string) {
          if (!firstTransform && v && v !== 'none') firstTransform = v;
          transformDesc.set!.call(target.style, v);
        },
      });
      Object.defineProperty(target.style, 'transformOrigin', {
        configurable: true,
        get() {
          return originDesc.get!.call(target.style);
        },
        set(v: string) {
          capturedOrigin = v;
          originDesc.set!.call(target.style, v);
        },
      });

      zoomIn({ origin, target });

      // Single uniform scale factor now, not independent scale(x, y) — see
      // computeTransform's own doc comment for why (the "squeezed image"
      // regression this same fixture's aspect-ratio mismatch used to hit).
      const match = firstTransform.match(
        /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([-\d.]+)\)/,
      );
      expect(match).not.toBeNull();
      const [, tx, ty, s] = match!.map(Number);

      // Replicate CSS semantics for a center transform-origin: scale happens
      // about the box's own center, then translate shifts that result.
      expect(capturedOrigin).toBe('center');
      const targetCenterX = targetRect.left + targetRect.width / 2;
      const targetCenterY = targetRect.top + targetRect.height / 2;
      const finalCenterX = targetCenterX + tx!;
      const finalCenterY = targetCenterY + ty!;
      const finalWidth = targetRect.width * s!;
      const finalHeight = targetRect.height * s!;

      // Center always lands exactly on origin's center, regardless of
      // aspect ratio — only the *edges* on the non-constraining axis may
      // fall short of origin's own (contained within it, this fixture's
      // origin/target aspect ratios deliberately differ — 192:255 vs
      // 1400:1170 — the same mismatch that used to cause visible squeezing).
      expect(finalCenterX).toBeCloseTo(originRect.left + originRect.width / 2, 0);
      expect(finalCenterY).toBeCloseTo(originRect.top + originRect.height / 2, 0);
      expect(finalWidth).toBeLessThanOrEqual(originRect.width + 0.5);
      expect(finalHeight).toBeLessThanOrEqual(originRect.height + 0.5);
      // width was the more constraining axis for this fixture (192/1400 <
      // 255/1170) — it should land exactly on origin's, height falls short.
      expect(finalWidth).toBeCloseTo(originRect.width, 0);
    });

    it("regression: never distorts the image's aspect ratio, even when origin and target are shaped very differently", () => {
      // The actual bug this whole fix addresses: independently scaling x
      // and y to force an exact rect match on both axes visibly
      // squeezes/stretches the image whenever origin (a thumbnail tile,
      // often cropped to a uniform grid shape) and target (the lightbox's
      // full viewport-shaped slide area) don't share an aspect ratio —
      // which is the common case, not an edge case. Uses zoomOut, whose
      // computed transform is the last thing written to target.style —
      // zoomIn's synchronous jump is immediately overwritten to 'none'
      // before this function returns, so it isn't observable this simply.
      mockRect(origin, { top: 0, left: 0, width: 100, height: 100 }); // square tile
      mockRect(target, { top: 0, left: 0, width: 1600, height: 900 }); // wide 16:9 slide

      zoomOut({ origin, target }, () => {});

      const match = target.style.transform.match(/scale\(([-\d.]+)(?:,\s*([-\d.]+))?\)/);
      expect(match).not.toBeNull();
      const [, first, second] = match!;
      // Either a single scale() argument, or two identical ones — never two
      // *different* values, which is what would distort the image.
      if (second !== undefined) {
        expect(Number(second)).toBeCloseTo(Number(first), 5);
      }
    });

    it('does nothing when either rect has zero size (e.g. jsdom, or a genuinely 0x0 element)', () => {
      mockRect(origin, { width: 0, height: 0 });
      mockRect(target, { width: 800, height: 600 });

      zoomIn({ origin, target });

      expect(target.style.transform).toBe('');
    });

    it('does nothing under prefers-reduced-motion', () => {
      window.matchMedia = makeMatchMedia(true);
      mockRect(origin, { top: 100, left: 50, width: 40, height: 30 });
      mockRect(target, { top: 0, left: 0, width: 800, height: 600 });

      zoomIn({ origin, target });

      expect(target.style.transform).toBe('');
    });

    it('cleans up inline styles once the transition ends', () => {
      mockRect(origin, { top: 100, left: 50, width: 40, height: 30 });
      mockRect(target, { top: 0, left: 0, width: 800, height: 600 });
      vi.spyOn(window, 'getComputedStyle').mockReturnValue({
        transitionDuration: '300ms',
      } as CSSStyleDeclaration);

      zoomIn({ origin, target });

      const event = new Event('transitionend') as Event & { propertyName?: string };
      Object.defineProperty(event, 'propertyName', { value: 'transform' });
      target.dispatchEvent(event);

      expect(target.style.transform).toBe('');
      expect(target.style.transition).toBe('');
    });

    it("regression: does not clobber another plugin's transform set on the same element before cleanup runs (e.g. rotateFlip, applied between open() and the delayed transitionend/timeout cleanup)", () => {
      mockRect(origin, { top: 100, left: 50, width: 40, height: 30 });
      mockRect(target, { top: 0, left: 0, width: 800, height: 600 });
      vi.spyOn(window, 'getComputedStyle').mockReturnValue({
        transitionDuration: '300ms',
      } as CSSStyleDeclaration);

      zoomIn({ origin, target });
      // another plugin (rotateFlip) sets its own transform on the same
      // element before this animation's own transitionend fires
      target.style.transform = 'scaleX(1) scaleY(1) rotate(90deg)';

      const event = new Event('transitionend') as Event & { propertyName?: string };
      Object.defineProperty(event, 'propertyName', { value: 'transform' });
      target.dispatchEvent(event);

      // the other plugin's value survives; transition/transformOrigin still
      // get cleaned up since nothing else owns those
      expect(target.style.transform).toBe('scaleX(1) scaleY(1) rotate(90deg)');
      expect(target.style.transition).toBe('');
      expect(target.style.transformOrigin).toBe('');
    });
  });

  describe('zoomOut', () => {
    it('regression: uses the letterboxed photo box, not the full container, when aspectRatio is known — a real bug that made the animation shrink to something much smaller than the thumbnail', () => {
      // origin: a real thumbnail tile. target container: the full
      // dialog-shaped slide area (.shoji-slide-media, always
      // width/height:100%) — much wider than the 3:2 photo will ever
      // actually render at once object-fit:contain letterboxes it inside.
      const originRect = { top: 500, left: 500, width: 140, height: 105 }; // 4:3 thumb
      const containerRect = { top: 0, left: 0, width: 1200, height: 400 }; // very wide (3:1) container
      mockRect(origin, originRect);
      mockRect(target, containerRect);

      zoomOut({ origin, target, aspectRatio: 3 / 2 }, () => {});

      const match = target.style.transform.match(
        /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([-\d.]+)\)/,
      );
      expect(match).not.toBeNull();
      const [, , , scale] = match!.map(Number);

      // Contained box for a 3:2 photo in a 1200x400 (3:1) container is
      // height-constrained: width = 400*1.5 = 600, height = 400.
      // Correct scale = min(140/600, 105/400) = min(0.2333, 0.2625) = 0.2333
      expect(scale).toBeCloseTo(140 / 600, 3);
      // The wrong (container-only) computation would instead have used the
      // full 1200x400 container: min(140/1200, 105/400) = 0.1167 — under
      // half the correct scale, exactly the "shrinks to something much
      // smaller than the thumbnail" bug this fixes.
      expect(scale).not.toBeCloseTo(140 / 1200, 3);
    });

    it('prefers the real rendered media child over both the container and aspectRatio, when one is already attached', () => {
      const img = document.createElement('img');
      target.appendChild(img);
      mockRect(origin, { top: 500, left: 500, width: 140, height: 105 });
      mockRect(target, { top: 0, left: 0, width: 1200, height: 400 }); // container — should be ignored
      mockRect(img, { top: 100, left: 300, width: 600, height: 400 }); // the real rendered photo

      zoomOut({ origin, target, aspectRatio: 3 / 2 }, () => {}); // aspectRatio present too — should still be ignored in favor of the real element

      const match = target.style.transform.match(
        /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([-\d.]+)\)/,
      );
      const [, , , s] = match!.map(Number);
      // scale = min(140/600, 105/400) — computed from the real img's rect
      expect(s).toBeCloseTo(Math.min(140 / 600, 105 / 400), 3);
    });

    it("regression: ignores the loading spinner as target's child instead of trusting its tiny rect — a real bug that made the FLIP transition scale up (>1) instead of down, rendering the spinner briefly oversized on a fresh open with nothing decoded yet", () => {
      const spinner = document.createElement('div');
      spinner.className = 'shoji-slide-spinner';
      target.appendChild(spinner);
      mockRect(origin, { top: 500, left: 500, width: 140, height: 105 }); // thumbnail
      mockRect(target, { top: 0, left: 0, width: 1200, height: 400 }); // container — ignored either way
      mockRect(spinner, { top: 190, left: 580, width: 40, height: 40 }); // the loading spinner, not real media

      zoomOut({ origin, target, aspectRatio: 3 / 2 }, () => {});

      const match = target.style.transform.match(
        /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([-\d.]+)\)/,
      );
      expect(match).not.toBeNull();
      const [, , , scale] = match!.map(Number);

      // Should fall through to the aspectRatio-derived contained box (same
      // as the "no child at all" case), not the spinner's own tiny rect.
      // Contained box for a 3:2 photo in a 1200x400 container: width =
      // 400*1.5 = 600, height = 400 -> scale = min(140/600, 105/400).
      const correctScale = Math.min(140 / 600, 105 / 400);
      expect(scale).toBeCloseTo(correctScale, 3);
      // The buggy computation trusted the 40x40 spinner as the target box:
      // scale = min(140/40, 105/40) = 2.625 — inverted (>1) and roughly 10x
      // the correct value, which is what rendered it visibly oversized.
      expect(scale).not.toBeCloseTo(Math.min(140 / 40, 105 / 40), 3);
      expect(scale).toBeLessThan(1);
    });

    it("regression: ignores the open-transition placeholder as target's child too — its rect reflects its own crop/aspect ratio, not the real photo's", () => {
      const placeholder = document.createElement('img');
      placeholder.className = 'shoji-slide-img shoji-slide-open-placeholder';
      target.appendChild(placeholder);
      mockRect(origin, { top: 500, left: 500, width: 140, height: 105 }); // thumbnail
      mockRect(target, { top: 0, left: 0, width: 1200, height: 400 }); // container — ignored either way
      mockRect(placeholder, { top: 150, left: 500, width: 200, height: 200 }); // low-res thumb's own square crop, not the real 3:2 photo

      zoomOut({ origin, target, aspectRatio: 3 / 2 }, () => {});

      const match = target.style.transform.match(
        /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([-\d.]+)\)/,
      );
      expect(match).not.toBeNull();
      const [, , , scale] = match!.map(Number);

      // Should fall through to the aspectRatio-derived contained box, same as
      // the spinner case — not the placeholder's own 200x200 rect.
      const correctScale = Math.min(140 / 600, 105 / 400);
      expect(scale).toBeCloseTo(correctScale, 3);
      expect(scale).not.toBeCloseTo(Math.min(140 / 200, 105 / 200), 3);
    });

    it('transitions target toward the origin rect, then calls onComplete once settled', () => {
      mockRect(origin, { top: 100, left: 50, width: 40, height: 30 });
      mockRect(target, { top: 0, left: 0, width: 800, height: 600 });
      vi.spyOn(window, 'getComputedStyle').mockReturnValue({
        transitionDuration: '300ms',
      } as CSSStyleDeclaration);
      const onComplete = vi.fn();

      zoomOut({ origin, target }, onComplete);

      expect(target.style.transform).not.toBe('');
      expect(target.style.transform).not.toBe('none');
      expect(onComplete).not.toHaveBeenCalled();

      const event = new Event('transitionend') as Event & { propertyName?: string };
      Object.defineProperty(event, 'propertyName', { value: 'transform' });
      target.dispatchEvent(event);

      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(target.style.transform).toBe(''); // cleaned up
    });

    it("regression: does not clobber another plugin's transform set between zoomOut() starting and its cleanup firing", () => {
      mockRect(origin, { top: 100, left: 50, width: 40, height: 30 });
      mockRect(target, { top: 0, left: 0, width: 800, height: 600 });
      vi.spyOn(window, 'getComputedStyle').mockReturnValue({
        transitionDuration: '300ms',
      } as CSSStyleDeclaration);
      const onComplete = vi.fn();

      zoomOut({ origin, target }, onComplete);
      target.style.transform = 'scaleX(1) scaleY(1) rotate(90deg)';

      const event = new Event('transitionend') as Event & { propertyName?: string };
      Object.defineProperty(event, 'propertyName', { value: 'transform' });
      target.dispatchEvent(event);

      expect(onComplete).toHaveBeenCalledTimes(1); // still fires, regardless
      expect(target.style.transform).toBe('scaleX(1) scaleY(1) rotate(90deg)');
    });

    it('calls onComplete synchronously when there is no valid rect to animate to', () => {
      mockRect(origin, { width: 0, height: 0 });
      mockRect(target, { width: 800, height: 600 });
      const onComplete = vi.fn();

      zoomOut({ origin, target }, onComplete);

      expect(onComplete).toHaveBeenCalledTimes(1);
    });

    it('calls onComplete synchronously under prefers-reduced-motion', () => {
      window.matchMedia = makeMatchMedia(true);
      mockRect(origin, { top: 100, left: 50, width: 40, height: 30 });
      mockRect(target, { top: 0, left: 0, width: 800, height: 600 });
      const onComplete = vi.fn();

      zoomOut({ origin, target }, onComplete);

      expect(onComplete).toHaveBeenCalledTimes(1);
    });

    it('falls back to calling onComplete via timeout if transitionend never fires', () => {
      vi.useFakeTimers();
      mockRect(origin, { top: 100, left: 50, width: 40, height: 30 });
      mockRect(target, { top: 0, left: 0, width: 800, height: 600 });
      vi.spyOn(window, 'getComputedStyle').mockReturnValue({
        transitionDuration: '300ms',
      } as CSSStyleDeclaration);
      const onComplete = vi.fn();

      zoomOut({ origin, target }, onComplete);
      expect(onComplete).not.toHaveBeenCalled();

      vi.advanceTimersByTime(500); // 300ms duration + 100ms safety margin
      expect(onComplete).toHaveBeenCalledTimes(1);

      vi.useRealTimers();
    });

    it('only calls onComplete once even if transitionend fires after the fallback timeout', () => {
      vi.useFakeTimers();
      mockRect(origin, { top: 100, left: 50, width: 40, height: 30 });
      mockRect(target, { top: 0, left: 0, width: 800, height: 600 });
      vi.spyOn(window, 'getComputedStyle').mockReturnValue({
        transitionDuration: '300ms',
      } as CSSStyleDeclaration);
      const onComplete = vi.fn();

      zoomOut({ origin, target }, onComplete);
      vi.advanceTimersByTime(500);
      expect(onComplete).toHaveBeenCalledTimes(1);

      const event = new Event('transitionend') as Event & { propertyName?: string };
      Object.defineProperty(event, 'propertyName', { value: 'transform' });
      target.dispatchEvent(event);

      expect(onComplete).toHaveBeenCalledTimes(1); // still just once
      vi.useRealTimers();
    });
  });
});
