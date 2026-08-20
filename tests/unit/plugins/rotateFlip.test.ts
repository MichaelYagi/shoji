import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Gallery } from '../../../src/core';
import { RotateFlip } from '../../../src/plugins/rotateFlip';

const items = [
  { id: 'a', src: 'a.jpg' },
  { id: 'b', src: 'b.jpg' },
];

beforeEach(() => {
  HTMLImageElement.prototype.decode = vi.fn().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  // @ts-expect-error - removing the test-only stub added above
  delete HTMLImageElement.prototype.decode;
  document.body.innerHTML = '';
});

function makeGallery(options: Record<string, unknown> = {}): Gallery {
  return new Gallery(document.createElement('div'), {
    items,
    plugins: [RotateFlip],
    preload: 0,
    ...options,
  });
}

function button(label: string): HTMLButtonElement {
  return document.querySelector(
    `.shoji-toolbar-button[aria-label="${label}"]`,
  ) as HTMLButtonElement;
}

function activeMedia(): HTMLElement {
  return document.querySelector('.shoji-slide-media') as HTMLElement;
}

function click(el: Element): void {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('RotateFlip — buttons', () => {
  it('inserts rotateLeft/rotateRight/flipH/flipV toolbar buttons', () => {
    const gallery = makeGallery();
    expect(button('Rotate left')).not.toBeNull();
    expect(button('Rotate right')).not.toBeNull();
    expect(button('Flip horizontal')).not.toBeNull();
    expect(button('Flip vertical')).not.toBeNull();
    gallery.destroy();
  });

  it('flipH/flipV start with aria-pressed="false"', () => {
    const gallery = makeGallery();
    expect(button('Flip horizontal').getAttribute('aria-pressed')).toBe('false');
    expect(button('Flip vertical').getAttribute('aria-pressed')).toBe('false');
    gallery.destroy();
  });
});

describe('RotateFlip — rotation', () => {
  it('rotate right applies a 90deg rotation to the active media', () => {
    const gallery = makeGallery();
    gallery.open(0);

    click(button('Rotate right'));

    expect(activeMedia().style.transform).toBe('scaleX(1) scaleY(1) rotate(90deg)');
    gallery.destroy();
  });

  it("rotate left animates to -90deg visually (not the normalized 270deg) — the canonical emitted state still normalizes to 270, just decoupled from what's actually animated", () => {
    const gallery = makeGallery();
    gallery.open(0);
    const onChange = vi.fn();
    gallery.on('rotateFlipChange', onChange);

    click(button('Rotate left'));

    expect(activeMedia().style.transform).toBe('scaleX(1) scaleY(1) rotate(-90deg)');
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ rotation: 270 }));
    gallery.destroy();
  });

  it('regression: four rotate-right clicks keep animating forward to 360deg, not backward from 270 to 0 — a real bug where the wrapped/normalized rotation value fed the animation directly, making the browser interpolate a 270deg decrease instead of continuing the same 90deg step being clicked through', () => {
    const gallery = makeGallery();
    gallery.open(0);
    const rotateRight = button('Rotate right');

    click(rotateRight);
    click(rotateRight);
    click(rotateRight);
    click(rotateRight);

    // Visually identical to neutral (a full turn), but 360deg — not the
    // normalized 0deg/'none' — so the transition from 270deg continued
    // forward instead of snapping backward to 0.
    expect(activeMedia().style.transform).toBe('scaleX(1) scaleY(1) rotate(360deg)');
    gallery.destroy();
  });

  it('a fifth rotate-right click after a full rotation continues to 450deg, not restarting from 90deg', () => {
    const gallery = makeGallery();
    gallery.open(0);
    const rotateRight = button('Rotate right');

    for (let i = 0; i < 5; i++) click(rotateRight);

    expect(activeMedia().style.transform).toBe('scaleX(1) scaleY(1) rotate(450deg)');
    gallery.destroy();
  });
});

describe('RotateFlip — rotate direction while flipped', () => {
  it('regression: with exactly one flip axis active, "Rotate right" must apply a negative raw delta so the image still spins clockwise visually — scaleX(-1)/scaleY(-1) mirrors the coordinate system, reversing a plain +90 delta\'s visual handedness', () => {
    const gallery = makeGallery();
    gallery.open(0);

    click(button('Flip horizontal'));
    click(button('Rotate right'));

    expect(activeMedia().style.transform).toBe('scaleX(-1) scaleY(1) rotate(-90deg)');
    gallery.destroy();
  });

  it('regression: "Rotate left" while flipped on one axis inverts the same way, applying a positive raw delta', () => {
    const gallery = makeGallery();
    gallery.open(0);

    click(button('Flip horizontal'));
    click(button('Rotate left'));

    expect(activeMedia().style.transform).toBe('scaleX(-1) scaleY(1) rotate(90deg)');
    gallery.destroy();
  });

  it('the inversion applies the same way for a vertical-only flip, not just horizontal', () => {
    const gallery = makeGallery();
    gallery.open(0);

    click(button('Flip vertical'));
    click(button('Rotate right'));

    expect(activeMedia().style.transform).toBe('scaleX(1) scaleY(-1) rotate(-90deg)');
    gallery.destroy();
  });

  it('flipping BOTH axes cancels the inversion back out — two reflections compose into a plain rotation, so "Rotate right" goes back to a normal +90 delta', () => {
    const gallery = makeGallery();
    gallery.open(0);

    click(button('Flip horizontal'));
    click(button('Flip vertical'));
    click(button('Rotate right'));

    expect(activeMedia().style.transform).toBe('scaleX(-1) scaleY(-1) rotate(90deg)');
    gallery.destroy();
  });

  it('the canonicalized emitted state reflects the inverted (negative) delta too, not just the raw animated transform', () => {
    const gallery = makeGallery();
    gallery.open(0);
    const onChange = vi.fn();
    gallery.on('rotateFlipChange', onChange);

    click(button('Flip horizontal'));
    click(button('Rotate right'));

    // -90 normalized into [0, 360) is 270.
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ flipH: true, rotation: 270 }),
    );
    gallery.destroy();
  });
});

/** jsdom always reports 0 for clientWidth/clientHeight (no real layout) — stubbed the same way other suites in this codebase stub geometry that jsdom can't compute itself. */
function mockMediaSize(media: HTMLElement, width: number, height: number): void {
  Object.defineProperty(media, 'clientWidth', { value: width, configurable: true });
  Object.defineProperty(media, 'clientHeight', { value: height, configurable: true });
}

describe('RotateFlip — fit-scale on 90°/270° rotation (DESIGN.md §4.5)', () => {
  it('regression: a photo with plenty of native resolution grows fully to fill newly-available space when rotated — reported from real usage: a 6144x8160 photo on a 1080p monitor did not fill the screen after rotating, unlike an equivalent landscape photo, because an earlier fix capped ALL growth at 1x regardless of how much real resolution the photo had to spare', () => {
    const gallery = makeGallery({
      items: [{ id: 'a', src: 'a.jpg', width: 4000, height: 2000 }], // 2:1, high-res
    });
    gallery.open(0);
    mockMediaSize(activeMedia(), 300, 600); // portrait container

    click(button('Rotate right'));

    // scaleAt0 = min(1, 300/4000, 600/2000) = 0.075 (needs shrinking even
    // unrotated — plenty of native resolution, so this is purely a
    // container-size constraint, not a resolution one).
    // scaleAt90 = min(1, 300/2000, 600/4000) = 0.15 (same, rotated).
    // fitScale = 0.15 / 0.075 = 2 — pure container-driven growth, neither
    // scale hits the native-resolution "1" ceiling.
    expect(activeMedia().style.transform).toBe('scaleX(2) scaleY(2) rotate(90deg)');
    gallery.destroy();
  });

  it('regression: a low-resolution photo does NOT grow when rotated, even though it would have room to in the container — reported from real usage: a small demo photo, comfortably smaller than the dialog in both orientations, still shrank on rotation because an earlier version of this formula wrongly assumed the photo was already stretched to fill the dialog before rotating, when it was actually rendering at its own native (untouched) size', () => {
    const gallery = makeGallery({
      items: [{ id: 'a', src: 'a.jpg', width: 170, height: 85 }], // 2:1, low-res
    });
    gallery.open(0);
    mockMediaSize(activeMedia(), 300, 600);

    click(button('Rotate right'));

    // scaleAt0 = min(1, 300/170, 600/85) = 1 (fits natively both ways —
    // renders untouched, matching the real CSS's max-width/max-height cap).
    // scaleAt90 = min(1, 300/85, 600/170) = 1 (still fits natively, rotated).
    // fitScale = 1/1 = 1 — no change at all, correctly.
    expect(activeMedia().style.transform).toBe('scaleX(1) scaleY(1) rotate(90deg)');
    gallery.destroy();
  });

  it('grows only partway when the photo has some, but not unlimited, resolution headroom — the cap is a real ceiling, not a binary all-or-nothing switch', () => {
    const gallery = makeGallery({
      items: [{ id: 'a', src: 'a.jpg', width: 375, height: 150 }], // 2.5:1
    });
    gallery.open(0);
    mockMediaSize(activeMedia(), 300, 600);

    click(button('Rotate right'));

    // scaleAt0 = min(1, 300/375, 600/150) = min(1, 0.8, 4) = 0.8 (needs a
    // little shrinking unrotated — its own width alone already exceeds the
    // container's, regardless of resolution).
    // scaleAt90 = min(1, 300/150, 600/375) = min(1, 2, 1.6) = 1 (once
    // rotated, its native size already fits without any scaling — this is
    // the "1" resolution ceiling, not a container-shape coincidence).
    // fitScale = 1 / 0.8 = 1.25 — grows, but only back up to native size,
    // not further.
    expect(activeMedia().style.transform).toBe('scaleX(1.25) scaleY(1.25) rotate(90deg)');
    gallery.destroy();
  });

  it('a large/near-full-bleed photo still shrinks exactly enough to avoid getting clipped when rotated', () => {
    const gallery = makeGallery({
      items: [{ id: 'a', src: 'a.jpg', width: 2400, height: 6000 }], // 0.4 AR portrait, high-res
    });
    gallery.open(0);
    mockMediaSize(activeMedia(), 300, 600);

    click(button('Rotate right'));

    // scaleAt0 = min(1, 300/2400, 600/6000) = 0.1 (shrinks to fit, plenty
    // of native resolution to spare either way).
    // scaleAt90 = min(1, 300/6000, 600/2400) = 0.05.
    // fitScale = 0.05 / 0.1 = 0.5.
    expect(activeMedia().style.transform).toBe('scaleX(0.5) scaleY(0.5) rotate(90deg)');
    gallery.destroy();
  });

  it('a photo that fits fine unrotated can still need to shrink once rotated — orientation mismatch, not a resolution limit', () => {
    const gallery = makeGallery({
      items: [{ id: 'a', src: 'a.jpg', width: 200, height: 400 }], // 0.5 AR
    });
    gallery.open(0);
    mockMediaSize(activeMedia(), 300, 600);

    click(button('Rotate right'));

    // scaleAt0 = min(1, 300/200, 600/400) = 1 (fits natively, untouched).
    // scaleAt90 = min(1, 300/400, 600/200) = 0.75 (rotated, its own now-wide
    // shape no longer fits the container's width without shrinking).
    // fitScale = 0.75 / 1 = 0.75.
    expect(activeMedia().style.transform).toBe('scaleX(0.75) scaleY(0.75) rotate(90deg)');
    gallery.destroy();
  });

  it("does not apply a fit-scale at 180° — a rectangle's own bounding box is unchanged by a half-turn, so there is nothing to re-fit", () => {
    const gallery = makeGallery({
      items: [{ id: 'a', src: 'a.jpg', width: 2400, height: 6000 }], // would shrink at 90°, if not for the 180° short-circuit
    });
    gallery.open(0);
    mockMediaSize(activeMedia(), 300, 600);
    const rotateRight = button('Rotate right');

    click(rotateRight);
    click(rotateRight);

    expect(activeMedia().style.transform).toBe('scaleX(1) scaleY(1) rotate(180deg)');
    gallery.destroy();
  });

  it('does not apply a fit-scale when no natural size is known at all (no item.width/height, and jsdom never actually decodes an <img>) — skipped entirely rather than guessing', () => {
    const gallery = makeGallery(); // default fixture items — no width/height
    gallery.open(0);
    mockMediaSize(activeMedia(), 300, 600);

    click(button('Rotate right'));

    expect(activeMedia().style.transform).toBe('scaleX(1) scaleY(1) rotate(90deg)');
    gallery.destroy();
  });

  it('does not apply a fit-scale when the container has not been measured yet (jsdom reports 0 for clientWidth/clientHeight by default, same as a not-yet-laid-out element in a real browser) — skipped entirely rather than dividing by zero', () => {
    const gallery = makeGallery({
      items: [{ id: 'a', src: 'a.jpg', width: 2400, height: 6000 }],
    });
    gallery.open(0); // mockMediaSize deliberately not called

    click(button('Rotate right'));

    expect(activeMedia().style.transform).toBe('scaleX(1) scaleY(1) rotate(90deg)');
    gallery.destroy();
  });

  it('composes with flip — the fit-scale multiplies into scaleX/scaleY alongside the -1, not a separate transform function', () => {
    const gallery = makeGallery({
      items: [{ id: 'a', src: 'a.jpg', width: 2400, height: 6000 }], // shrinks, so the composed value is distinguishable from a plain flip
    });
    gallery.open(0);
    mockMediaSize(activeMedia(), 300, 600);

    click(button('Flip horizontal'));
    // With exactly one flip axis active, "Rotate right" applies a negative
    // raw delta (the rotate-direction fix, above) — still an odd multiple
    // of 90°, so the fit-scale still applies the same way.
    click(button('Rotate right'));

    expect(activeMedia().style.transform).toBe('scaleX(-0.5) scaleY(0.5) rotate(-90deg)');
    gallery.destroy();
  });

  it("item.width/height take priority over the <img>'s own natural dimensions when both happen to be available", async () => {
    const gallery = makeGallery({
      items: [{ id: 'a', src: 'a.jpg', width: 2400, height: 6000 }], // 0.4 AR, high-res -> shrinks to 0.5
    });
    gallery.open(0);
    await flush(); // the <img> isn't in the DOM until decode() resolves (SlideManager's moveIn)
    const media = activeMedia();
    mockMediaSize(media, 300, 600);
    const img = media.querySelector('img')!;
    // AR 1, low-res -> would produce a completely different (capped-to-1)
    // result if wrongly preferred over item.width/height.
    Object.defineProperty(img, 'naturalWidth', { value: 100, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: 100, configurable: true });

    click(button('Rotate right'));

    expect(activeMedia().style.transform).toBe('scaleX(0.5) scaleY(0.5) rotate(90deg)');
    gallery.destroy();
  });

  it("falls back to the <img>'s own natural dimensions when item.width/height aren't supplied", async () => {
    const gallery = makeGallery(); // no width/height on the item
    gallery.open(0);
    await flush();
    const media = activeMedia();
    mockMediaSize(media, 300, 600);
    const img = media.querySelector('img')!;
    Object.defineProperty(img, 'naturalWidth', { value: 2400, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: 6000, configurable: true });

    click(button('Rotate right'));

    expect(activeMedia().style.transform).toBe('scaleX(0.5) scaleY(0.5) rotate(90deg)');
    gallery.destroy();
  });
});

describe('RotateFlip — flipping', () => {
  it('flip horizontal applies scaleX(-1) and sets aria-pressed', () => {
    const gallery = makeGallery();
    gallery.open(0);

    click(button('Flip horizontal'));

    expect(activeMedia().style.transform).toBe('scaleX(-1) scaleY(1) rotate(0deg)');
    expect(button('Flip horizontal').getAttribute('aria-pressed')).toBe('true');
    gallery.destroy();
  });

  it('clicking flip horizontal twice returns to unflipped', () => {
    const gallery = makeGallery();
    gallery.open(0);
    const flipH = button('Flip horizontal');

    click(flipH);
    click(flipH);

    expect(activeMedia().style.transform).toBe('none');
    expect(flipH.getAttribute('aria-pressed')).toBe('false');
    gallery.destroy();
  });

  it('flipping both axes animates as a plain double-scale (not a canonicalized 180deg rotation), even though aria-pressed reflects the canonicalized un-flipped state', () => {
    const gallery = makeGallery();
    gallery.open(0);
    const onChange = vi.fn();
    gallery.on('rotateFlipChange', onChange);

    click(button('Flip horizontal'));
    click(button('Flip vertical'));

    // The animated transform stays a plain double-scale, matching a normal
    // flip motion (only scaleY changes on the second click) — not the
    // canonicalized rotate(180deg) form, which would make the browser
    // interpolate scaleX and rotate simultaneously, a visibly "twisting"
    // compound motion instead of a clean flip.
    expect(activeMedia().style.transform).toBe('scaleX(-1) scaleY(-1) rotate(0deg)');
    // But the canonicalized state — aria-pressed and the emitted event —
    // still collapses to no flips + 180deg rotation, unaffected by the
    // above: this is the DESIGN.md §8.1 table in action, just decoupled
    // from what's actually animated.
    expect(button('Flip horizontal').getAttribute('aria-pressed')).toBe('false');
    expect(button('Flip vertical').getAttribute('aria-pressed')).toBe('false');
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ flipH: false, flipV: false, rotation: 180 }),
    );
    gallery.destroy();
  });
});

describe('RotateFlip — resets per slide', () => {
  it('resets to neutral on afterSlide', () => {
    const gallery = makeGallery();
    gallery.open(0);
    click(button('Rotate right'));
    expect(activeMedia().style.transform).not.toBe('none');

    gallery.next();

    expect(activeMedia().style.transform).toBe('none');
    expect(button('Flip horizontal').getAttribute('aria-pressed')).toBe('false');
    gallery.destroy();
  });

  it('resets to neutral on afterOpen (re-opening after a rotation was applied)', () => {
    const gallery = makeGallery();
    gallery.open(0);
    click(button('Rotate right'));
    gallery.close();

    gallery.open(1);

    expect(activeMedia().style.transform).toBe('none');
    gallery.destroy();
  });

  it("regression: resets a still-rotated slide before navigate() reparents it into a different pool slot via cache-reuse — otherwise it stays transformed, unclipped, bleeding into the new slide (reported from real usage, only reproduces with preload > 0, where the old slide's node actually survives to be reused)", () => {
    const gallery = makeGallery({
      preload: 1,
      items: [
        { id: 'a', src: 'a.jpg' },
        { id: 'b', src: 'b.jpg' },
        { id: 'c', src: 'c.jpg' },
      ],
    });
    gallery.open(0);
    const rotatedMedia = activeMedia();
    click(button('Rotate right'));
    expect(rotatedMedia.style.transform).not.toBe('none');

    gallery.next();

    // beforeSlide (where the fix resets) fires synchronously inside
    // next(), before SlideManager.render() ever reparents this same
    // cached node — no need to await anything to observe it. '', not
    // the literal 'none' apply(false) itself sets — SlideManager's own
    // reparent step clears the inline style right after, same final
    // (functionally identical) value the Zoom plugin's own equivalent
    // regression test already expects.
    expect(rotatedMedia.style.transform).toBe('');
    gallery.destroy();
  });
});

describe('RotateFlip — transition (button clicks animate)', () => {
  it('rotate applies a transform transition', () => {
    const gallery = makeGallery();
    gallery.open(0);

    click(button('Rotate right'));

    expect(activeMedia().style.transition).toContain('transform');
    gallery.destroy();
  });

  it('flip applies a transform transition', () => {
    const gallery = makeGallery();
    gallery.open(0);

    click(button('Flip horizontal'));

    expect(activeMedia().style.transition).toContain('transform');
    gallery.destroy();
  });
});

describe('RotateFlip — events', () => {
  it('emits rotateFlipChange with the current index and canonicalized state', () => {
    const gallery = makeGallery();
    gallery.open(1);
    const onChange = vi.fn();
    gallery.on('rotateFlipChange', onChange);

    click(button('Rotate right'));

    expect(onChange).toHaveBeenCalledWith({ index: 1, flipH: false, flipV: false, rotation: 90 });
    gallery.destroy();
  });
});

describe('RotateFlip — cleanup', () => {
  it('destroy() removes all four toolbar buttons', () => {
    const gallery = makeGallery();
    gallery.destroy();

    expect(document.querySelector('.shoji-toolbar-button')).toBeNull();
  });
});
