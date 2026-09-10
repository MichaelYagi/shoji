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
        /translate3d\(([-\d.]+)px, ([-\d.]+)px, 0\) scale3d\(([-\d.]+), [-\d.]+, 1\)/,
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

    it("regression: prefers origin's own child image rect over origin's degenerate own box — a plain inline <a> wrapping an <img> sizes to a text-line-height sliver, not the image, so the transform used to land at a tiny, essentially-random offset instead of the real thumbnail (only reproducible without Layout, whose tiles are display:block and don't hit this)", () => {
      mockRect(origin, { top: 350, left: 16, width: 240, height: 19 }); // the degenerate <a> sliver
      const img = document.createElement('img');
      origin.append(img);
      mockRect(img, { top: 45, left: 16, width: 240, height: 320 }); // the real, visible thumbnail
      mockRect(target, { top: 0, left: 0, width: 1400, height: 1170 });

      let firstTransform = '';
      const styleProto = Object.getPrototypeOf(target.style) as CSSStyleDeclaration;
      const transformDesc = Object.getOwnPropertyDescriptor(styleProto, 'transform')!;
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

      zoomIn({ origin, target });

      const match = firstTransform.match(
        /translate3d\(([-\d.]+)px, ([-\d.]+)px, 0\) scale3d\(([-\d.]+), [-\d.]+, 1\)/,
      );
      expect(match).not.toBeNull();
      const [, tx, ty, s] = match!.map(Number);
      const targetCenterX = 1400 / 2 + tx!;
      const targetCenterY = 1170 / 2 + ty!;

      // Lands on the real image's center/size (16+120, 45+160), not the
      // wrapper <a>'s (16+120, 350+9.5).
      expect(targetCenterX).toBeCloseTo(16 + 120, 0);
      expect(targetCenterY).toBeCloseTo(45 + 160, 0);
      expect(1400 * s!).toBeCloseTo(240, 0);
    });

    it("regression: finds the <img> via querySelector, not firstElementChild — a caption/badge element placed before the <img> in the host's own markup must not be measured instead", () => {
      mockRect(origin, { top: 350, left: 16, width: 240, height: 19 }); // the degenerate <a> sliver
      const badge = document.createElement('span');
      mockRect(badge, { top: 350, left: 16, width: 30, height: 12 }); // a small "NEW" badge, first child
      const img = document.createElement('img');
      origin.append(badge, img);
      mockRect(img, { top: 45, left: 16, width: 240, height: 320 }); // the real, visible thumbnail
      mockRect(target, { top: 0, left: 0, width: 1400, height: 1170 });

      let firstTransform = '';
      const styleProto = Object.getPrototypeOf(target.style) as CSSStyleDeclaration;
      const transformDesc = Object.getOwnPropertyDescriptor(styleProto, 'transform')!;
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

      zoomIn({ origin, target });

      const match = firstTransform.match(
        /translate3d\(([-\d.]+)px, ([-\d.]+)px, 0\) scale3d\(([-\d.]+), [-\d.]+, 1\)/,
      );
      expect(match).not.toBeNull();
      const [, tx, ty, s] = match!.map(Number);
      const targetCenterX = 1400 / 2 + tx!;
      const targetCenterY = 1170 / 2 + ty!;

      // Lands on the <img>'s center/size, not the badge's or the wrapper's.
      expect(targetCenterX).toBeCloseTo(16 + 120, 0);
      expect(targetCenterY).toBeCloseTo(45 + 160, 0);
      expect(1400 * s!).toBeCloseTo(240, 0);
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

      const match = target.style.transform.match(/scale3d\(([-\d.]+),\s*([-\d.]+),\s*1\)/);
      expect(match).not.toBeNull();
      const [, first, second] = match!;
      // scale3d's x/y args are always the same single scale factor — never
      // two *different* values, which is what would distort the image.
      expect(Number(second)).toBeCloseTo(Number(first), 5);
    });

    it('does nothing when either rect has zero size (e.g. jsdom, or a genuinely 0x0 element)', () => {
      mockRect(origin, { width: 0, height: 0 });
      mockRect(target, { width: 800, height: 600 });

      zoomIn({ origin, target });

      expect(target.style.transform).toBe('');
    });

    it("still jumps onto/transitions away from origin's box like the normal FLIP open, plus a simultaneous opacity fade, when the thumbnail is a deliberate crop whose aspect ratio has nothing to do with the photo's — a panoramic photo (3:1) against a center-cropped square thumbnail (1:1), the reported bug: transformBetween's single scale used to be the *only* thing shown, fully opaque, collapsing the photo into a thin horizontal strip instead of anything that reads as 'arriving at the thumbnail'. Fading it out alongside the same motion (not replacing the motion with a static in-place fade — reported back as unusable, 'can't tell where it fades to') keeps the sliver from ever being the fully-visible end state.", () => {
      mockRect(origin, { top: 100, left: 50, width: 225, height: 225 }); // center-cropped square thumb
      mockRect(target, { top: 0, left: 0, width: 1600, height: 533 }); // panoramic 3:1 slide

      zoomIn({ origin, target, aspectRatio: 3000 / 1000 });

      // Same FLIP target as the plain-zoom case — transitions toward natural
      // layout, not an in-place fade with no motion at all.
      expect(target.style.transform).toBe('none');
      expect(target.style.opacity).toBe('1');
      expect(target.style.transition).toContain('transform');
      expect(target.style.transition).toContain('opacity');
      expect(target.style.transition).toContain('var(--shoji-duration)');
    });

    it("falls back to the same transform-plus-fade combo when the target's true size is completely unknown, not just when it's known-but-mismatched — Gallery.ts's open() for an item with no declared width/height and nothing real rendered yet (no naturalSize, no real child in target): the analytical box effectiveTargetBox() would otherwise fall back to is an unguessed, uncapped size (\"probably fills the dialog\"), the exact overshoot Gallery.ts's own open() doc comment warns a genuinely small photo would suffer — fading it out the same way as an aspect-ratio mismatch sidesteps that regardless of which direction the guess is wrong in", () => {
      mockRect(origin, { top: 100, left: 50, width: 40, height: 30 });
      mockRect(target, { top: 0, left: 0, width: 800, height: 600 });

      zoomIn({ origin, target }); // no aspectRatio, no naturalSize, target has no real child

      expect(target.style.opacity).toBe('1');
      expect(target.style.transition).toContain('transform');
      expect(target.style.transition).toContain('opacity');
    });

    it('does not fall back to a fade for unknown target size when a real, already-rendered child is present — only actually unknown (no naturalSize AND nothing real to measure) triggers it', () => {
      const img = document.createElement('img');
      target.appendChild(img);
      mockRect(origin, { top: 100, left: 50, width: 40, height: 30 });
      mockRect(target, { top: 0, left: 0, width: 800, height: 600 });
      mockRect(img, { top: 0, left: 0, width: 800, height: 600 }); // real, already-rendered content

      zoomIn({ origin, target }); // still no aspectRatio, no naturalSize

      expect(target.style.transform).toBe('none'); // plain zoom, not the fade combo
      expect(target.style.opacity).toBe('');
    });

    it("does not fall back to a fade for unknown target size when naturalSize is known — Gallery.ts's own ordinary case (item.width/height declared, real image not loaded yet), unaffected by this fallback", () => {
      mockRect(origin, { top: 100, left: 50, width: 40, height: 30 });
      mockRect(target, { top: 0, left: 0, width: 800, height: 600 });

      zoomIn({ origin, target, naturalSize: { width: 1600, height: 1200 } });

      expect(target.style.transform).toBe('none');
      expect(target.style.opacity).toBe('');
    });

    it('does not fall back to a fade for a merely letterboxed (not extremely mismatched) aspect ratio — a square thumbnail against a 16:9 photo (ratio 1.778) still gets the real zoom transform, not every shape mismatch should trigger the fallback', () => {
      mockRect(origin, { top: 0, left: 0, width: 100, height: 100 }); // square tile
      mockRect(target, { top: 0, left: 0, width: 1600, height: 900 }); // 16:9 slide

      // naturalSize given — isolates this test to the aspect-ratio-mismatch
      // check specifically; without it, the *separate* "unknown target
      // size" fallback (no naturalSize, no real rendered child either)
      // would also apply here, for an unrelated reason.
      zoomIn({ origin, target, naturalSize: { width: 1600, height: 900 } });

      expect(target.style.transform).toBe('none'); // real FLIP transition target, not a fade
      expect(target.style.opacity).toBe('');
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
        /translate3d\(([-\d.]+)px, ([-\d.]+)px, 0\) scale3d\(([-\d.]+), [-\d.]+, 1\)/,
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

    it("regression: caps the letterboxed box at the real photo's own native size (naturalSize) instead of always growing to fill the container — reported from real usage: a genuinely small photo visibly ballooned to fill the dialog on open, then snapped back down to its true size the instant it finished loading, even with aspectRatio correctly known", () => {
      const originRect = { top: 500, left: 500, width: 140, height: 105 }; // 4:3 thumb
      const containerRect = { top: 0, left: 0, width: 1200, height: 400 }; // very wide (3:1) container
      mockRect(origin, originRect);
      mockRect(target, containerRect);

      // Same 3:2 aspectRatio as the test above (would otherwise compute the
      // exact same 600x400 contained box, scale 140/600) — the only
      // difference here is a genuinely small real photo's true pixel size.
      zoomOut(
        { origin, target, aspectRatio: 3 / 2, naturalSize: { width: 300, height: 200 } },
        () => {},
      );

      const match = target.style.transform.match(
        /translate3d\(([-\d.]+)px, ([-\d.]+)px, 0\) scale3d\(([-\d.]+), [-\d.]+, 1\)/,
      );
      expect(match).not.toBeNull();
      const [, , , scale] = match!.map(Number);

      // Contained box capped at 300x200 (cap = min(1, 300/600, 200/400) =
      // 0.5): scale = min(140/300, 105/200) = min(0.4667, 0.525) = 140/300.
      expect(scale).toBeCloseTo(140 / 300, 3);
      // The uncapped computation (previous test) would have used 140/600 —
      // half this value, exactly the "grows too far, snaps down hard" bug.
      expect(scale).not.toBeCloseTo(140 / 600, 3);
    });

    it('naturalSize is a no-op for a genuinely large photo — never grows the target box past what aspectRatio alone already computed', () => {
      const originRect = { top: 500, left: 500, width: 140, height: 105 };
      const containerRect = { top: 0, left: 0, width: 1200, height: 400 };
      mockRect(origin, originRect);
      mockRect(target, containerRect);

      // A real 4000x2667 photo — far larger than the 600x400 contained box
      // this would compute either way; the cap (min(1, ...)) must never
      // exceed 1 and grow the box, only ever shrink it.
      zoomOut(
        { origin, target, aspectRatio: 3 / 2, naturalSize: { width: 4000, height: 2667 } },
        () => {},
      );

      const match = target.style.transform.match(
        /translate3d\(([-\d.]+)px, ([-\d.]+)px, 0\) scale3d\(([-\d.]+), [-\d.]+, 1\)/,
      );
      expect(match).not.toBeNull();
      const [, , , scale] = match!.map(Number);
      expect(scale).toBeCloseTo(140 / 600, 3); // identical to the uncapped case
    });

    it('prefers the real rendered media child over both the container and aspectRatio, when one is already attached', () => {
      const img = document.createElement('img');
      target.appendChild(img);
      mockRect(origin, { top: 500, left: 500, width: 140, height: 105 });
      mockRect(target, { top: 0, left: 0, width: 1200, height: 400 }); // container — should be ignored
      mockRect(img, { top: 100, left: 300, width: 600, height: 400 }); // the real rendered photo

      zoomOut({ origin, target, aspectRatio: 3 / 2 }, () => {}); // aspectRatio present too — should still be ignored in favor of the real element

      const match = target.style.transform.match(
        /translate3d\(([-\d.]+)px, ([-\d.]+)px, 0\) scale3d\(([-\d.]+), [-\d.]+, 1\)/,
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
        /translate3d\(([-\d.]+)px, ([-\d.]+)px, 0\) scale3d\(([-\d.]+), [-\d.]+, 1\)/,
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
        /translate3d\(([-\d.]+)px, ([-\d.]+)px, 0\) scale3d\(([-\d.]+), [-\d.]+, 1\)/,
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

    it("clears a baked-in opacity (a completed drag-close's own dim, Gallery.beginClose) once the transition ends, same as transform/transition/transformOrigin", () => {
      mockRect(origin, { top: 100, left: 50, width: 40, height: 30 });
      mockRect(target, { top: 0, left: 0, width: 800, height: 600 });
      vi.spyOn(window, 'getComputedStyle').mockReturnValue({
        transitionDuration: '300ms',
      } as CSSStyleDeclaration);
      target.style.opacity = '0.7'; // baked in before zoomOut() runs, as Gallery.beginClose does

      // naturalSize given — a real close always has real content ready
      // (isActiveReady() gates zoomOut() itself, Gallery.ts) or a known
      // naturalSize; without either here, the *separate* "unknown target
      // size" fallback would also apply, immediately overwriting the
      // baked-in opacity as part of its own fade-in setup, for an
      // unrelated reason this test isn't about.
      zoomOut({ origin, target, naturalSize: { width: 800, height: 600 } }, () => {});
      expect(target.style.opacity).toBe('0.7'); // untouched while the transition is still running

      const event = new Event('transitionend') as Event & { propertyName?: string };
      Object.defineProperty(event, 'propertyName', { value: 'transform' });
      target.dispatchEvent(event);

      expect(target.style.opacity).toBe('');
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

    it("regression: with zoomStart, jumps instantly onto the zoomed image's own rect before transitioning toward origin — not from target's own natural (reset) position, and not from the zoom plugin's raw scale/pan replayed onto the wrong element/origin (the earlier, broken version of this)", () => {
      const originRect = { top: 534, left: 1007, width: 192, height: 255 };
      const targetRect = { top: 0, left: 0, width: 1400, height: 1170 };
      // Exactly 2x targetRect, same aspect ratio, centered at (500, 400) —
      // deliberately off in both axes from targetRect's own center
      // (700, 585), so a wrong (un-jumped, or wrong-origin) computation is
      // clearly distinguishable from the correct one below.
      const zoomStartRect = { top: -770, left: -900, width: 2800, height: 2340 };
      mockRect(origin, originRect);
      mockRect(target, targetRect);
      vi.spyOn(window, 'getComputedStyle').mockReturnValue({
        transitionDuration: '300ms',
      } as CSSStyleDeclaration);

      let firstTransform = '';
      const styleProto = Object.getPrototypeOf(target.style) as CSSStyleDeclaration;
      const transformDesc = Object.getOwnPropertyDescriptor(styleProto, 'transform')!;
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

      zoomOut({ origin, target, zoomStart: zoomStartRect as DOMRect }, () => {});

      const match = firstTransform.match(
        /translate3d\(([-\d.]+)px, ([-\d.]+)px, 0\) scale3d\(([-\d.]+), [-\d.]+, 1\)/,
      );
      expect(match).not.toBeNull();
      const [, tx, ty, s] = match!.map(Number);

      // Same center-to-center replication as the zoomIn regression test
      // above — the jump should land target's own natural box exactly on
      // zoomStartRect, not origin's box and not target's own untransformed
      // position.
      const targetCenterX = targetRect.left + targetRect.width / 2;
      const targetCenterY = targetRect.top + targetRect.height / 2;
      expect(targetCenterX + tx!).toBeCloseTo(zoomStartRect.left + zoomStartRect.width / 2, 0);
      expect(targetCenterY + ty!).toBeCloseTo(zoomStartRect.top + zoomStartRect.height / 2, 0);
      expect(targetRect.width * s!).toBeCloseTo(zoomStartRect.width, 0);

      // And it doesn't just stay jumped — the real, final transform (still
      // toward origin, unaffected by zoomStart) is what's left in place.
      expect(target.style.transform).not.toBe(firstTransform);
    });

    it('regression: with zoomStart, a rotate/flip transform already on target (RotateFlip, applied to this same .shoji-slide-media element) is preserved in the jump, not wiped instantly — closing both rotated and zoomed keeps the smooth combined un-rotate-while-shrinking motion instead of snapping to neutral rotation first', () => {
      mockRect(origin, { top: 100, left: 50, width: 40, height: 30 });
      mockRect(target, { top: 0, left: 0, width: 800, height: 600 });
      vi.spyOn(window, 'getComputedStyle').mockReturnValue({
        transitionDuration: '300ms',
      } as CSSStyleDeclaration);
      const rotateFlipTransform = 'scaleX(-1) scaleY(1) rotate(90deg)';
      target.style.transform = rotateFlipTransform; // RotateFlip's own inline style, as it would be at the moment close() starts

      let firstTransform = '';
      const styleProto = Object.getPrototypeOf(target.style) as CSSStyleDeclaration;
      const transformDesc = Object.getOwnPropertyDescriptor(styleProto, 'transform')!;
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

      zoomOut(
        {
          origin,
          target,
          zoomStart: { top: -300, left: -200, width: 1600, height: 1200 } as DOMRect,
        },
        () => {},
      );

      // The jump still carries RotateFlip's own functions forward — not
      // replaced by a plain translate/scale-only value.
      expect(firstTransform).toContain(rotateFlipTransform);
      // ...with the zoom's own translate3d/scale3d composed alongside it,
      // not just RotateFlip's value left untouched (i.e. the jump actually
      // did something for zoom continuity too).
      expect(firstTransform).toMatch(/translate3d\([-\d.]+px, [-\d.]+px, 0\) scale3d/);
    });

    it('dragStart takes priority over zoomStart if both are somehow present (not expected in practice — GestureController suspends drag entirely while zoomed)', () => {
      mockRect(origin, { top: 100, left: 50, width: 40, height: 30 });
      mockRect(target, { top: 0, left: 0, width: 800, height: 600 });
      vi.spyOn(window, 'getComputedStyle').mockReturnValue({
        transitionDuration: '300ms',
      } as CSSStyleDeclaration);

      let firstTransform = '';
      const styleProto = Object.getPrototypeOf(target.style) as CSSStyleDeclaration;
      const transformDesc = Object.getOwnPropertyDescriptor(styleProto, 'transform')!;
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

      zoomOut(
        {
          origin,
          target,
          dragStart: { translateY: 42, scale: 0.9, opacity: 0.5 },
          zoomStart: { top: -100, left: -100, width: 2000, height: 2000 } as DOMRect,
        },
        () => {},
      );

      expect(firstTransform).toBe('translate3d(0px, 42px, 0px) scale3d(0.9, 0.9, 1)');
    });

    it("still transitions toward origin's box like the normal zoom-out, plus a simultaneous opacity fade, when the thumbnail is a deliberate crop whose aspect ratio has nothing to do with the photo's (the reported bug: a panoramic 3:1 photo closing into a center-cropped 1:1 square thumbnail used to collapse into a thin, fully-opaque horizontal strip). Fading it out alongside the same motion — not replacing the motion with a static in-place fade, reported back as unusable ('can't tell where it fades to') — keeps the sliver from ever being fully visible.", () => {
      mockRect(origin, { top: 100, left: 50, width: 225, height: 225 });
      mockRect(target, { top: 0, left: 0, width: 1600, height: 533 });
      vi.spyOn(window, 'getComputedStyle').mockReturnValue({
        transitionDuration: '300ms',
      } as CSSStyleDeclaration);
      const onComplete = vi.fn();

      zoomOut({ origin, target, aspectRatio: 3000 / 1000 }, onComplete);

      // Same translate3d/scale3d landing transform the plain-zoom case
      // would use — the fallback doesn't skip it, just pairs it with a fade.
      expect(target.style.transform).toMatch(/translate3d\([-\d.]+px, [-\d.]+px, 0\) scale3d/);
      expect(target.style.opacity).toBe('0');
      expect(target.style.transition).toContain('transform');
      expect(target.style.transition).toContain('opacity');
      expect(onComplete).not.toHaveBeenCalled();

      // waitForTransitionEnd listens on the 'transform' property by default
      // (unchanged) — both properties share the same duration/start, so
      // either one's real transitionend signals "done" equally well.
      const event = new Event('transitionend') as Event & { propertyName?: string };
      Object.defineProperty(event, 'propertyName', { value: 'transform' });
      target.dispatchEvent(event);

      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(target.style.opacity).toBe('');
      expect(target.style.transition).toBe('');
      expect(target.style.transform).toBe(''); // cleaned up, matches what was written
    });

    it("regression: does not clobber another plugin's transform set on the same element before cleanup runs, via the aspect-mismatch fade-fallback path too — same protection as the plain-zoom path (clearInlineTransform only clears a transform that still matches what this animation itself last wrote), just reached via the fade branch", () => {
      mockRect(origin, { top: 100, left: 50, width: 225, height: 225 });
      mockRect(target, { top: 0, left: 0, width: 1600, height: 533 });
      vi.spyOn(window, 'getComputedStyle').mockReturnValue({
        transitionDuration: '300ms',
      } as CSSStyleDeclaration);
      const onComplete = vi.fn();

      zoomOut({ origin, target, aspectRatio: 3000 / 1000 }, onComplete);
      // another plugin (rotateFlip) sets its own transform on the same
      // element before this animation's own transitionend fires
      const rotateFlipTransform = 'scaleX(-1) scaleY(1) rotate(90deg)';
      target.style.transform = rotateFlipTransform;

      const event = new Event('transitionend') as Event & { propertyName?: string };
      Object.defineProperty(event, 'propertyName', { value: 'transform' });
      target.dispatchEvent(event);

      expect(onComplete).toHaveBeenCalledTimes(1); // still fires, regardless
      expect(target.style.transform).toBe(rotateFlipTransform);
      expect(target.style.opacity).toBe(''); // opacity still cleared unconditionally
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
