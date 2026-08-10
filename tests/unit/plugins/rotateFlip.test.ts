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
