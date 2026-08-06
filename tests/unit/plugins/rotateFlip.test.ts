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

  it('rotate left applies a -90deg rotation, normalized to 270', () => {
    const gallery = makeGallery();
    gallery.open(0);

    click(button('Rotate left'));

    expect(activeMedia().style.transform).toBe('scaleX(1) scaleY(1) rotate(270deg)');
    gallery.destroy();
  });

  it('four rotate-right clicks return to neutral (transform: none)', () => {
    const gallery = makeGallery();
    gallery.open(0);
    const rotateRight = button('Rotate right');

    click(rotateRight);
    click(rotateRight);
    click(rotateRight);
    click(rotateRight);

    expect(activeMedia().style.transform).toBe('none');
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

  it('flipping both axes at once canonicalizes to a pure 180deg rotation, not a double-scale', () => {
    const gallery = makeGallery();
    gallery.open(0);

    click(button('Flip horizontal'));
    click(button('Flip vertical'));

    expect(activeMedia().style.transform).toBe('scaleX(1) scaleY(1) rotate(180deg)');
    // Both toggle buttons reflect the canonicalized (un-flipped) state, not
    // the raw click history — this is the DESIGN.md §8.1 table in action.
    expect(button('Flip horizontal').getAttribute('aria-pressed')).toBe('false');
    expect(button('Flip vertical').getAttribute('aria-pressed')).toBe('false');
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
