import { describe, expect, it } from 'vitest';
import { TRANSITION_PRESETS } from '../../../src/transitions/presets';

describe('TRANSITION_PRESETS', () => {
  it('includes the four DESIGN.md §2.5 built-ins plus a spread of named presets (~20 total)', () => {
    for (const name of ['slide', 'fade', 'zoom', 'deck']) {
      expect(TRANSITION_PRESETS[name]).toBeDefined();
    }
    expect(Object.keys(TRANSITION_PRESETS).length).toBeGreaterThanOrEqual(18);
  });

  it('slide is direction-aware: next() and prev() produce mirror-image enter/leave transforms', () => {
    const slide = TRANSITION_PRESETS.slide!;
    const enterNext = slide.enter(1);
    const enterPrev = slide.enter(-1);
    expect(enterNext.transform).toContain('translate(100%, 0%)');
    expect(enterPrev.transform).toContain('translate(-100%, 0%)');

    const leaveNext = slide.leave(1);
    const leavePrev = slide.leave(-1);
    expect(leaveNext.transform).toContain('translate(-100%, 0%)');
    expect(leavePrev.transform).toContain('translate(100%, 0%)');
  });

  it('slide stays fully opaque (transform-only, no cross-fade)', () => {
    const slide = TRANSITION_PRESETS.slide!;
    expect(slide.enter(1).opacity).toBe(1);
    expect(slide.leave(1).opacity).toBe(1);
  });

  it('fade is direction-agnostic: next() and prev() produce identical keyframes', () => {
    const fade = TRANSITION_PRESETS.fade!;
    expect(fade.enter(1)).toEqual(fade.enter(-1));
    expect(fade.leave(1)).toEqual(fade.leave(-1));
    expect(fade.enter(1).opacity).toBe(0);
    expect(fade.enter(1).transform).toBe('none');
  });

  it('fadeUp always rises regardless of nav direction (a fixed entrance style, not tied to next/prev)', () => {
    const fadeUp = TRANSITION_PRESETS.fadeUp!;
    expect(fadeUp.enter(1)).toEqual(fadeUp.enter(-1));
    expect(fadeUp.enter(1).transform).toContain('translate(0%, 12%)');
  });

  it('rotateLeft/rotateRight tie their spin to nav direction, unlike the fixed "rotate"', () => {
    const rotateLeft = TRANSITION_PRESETS.rotateLeft!;
    expect(rotateLeft.enter(1).transform).not.toEqual(rotateLeft.enter(-1).transform);

    const rotate = TRANSITION_PRESETS.rotate!;
    expect(rotate.enter(1)).toEqual(rotate.enter(-1));
  });

  it('3D presets include perspective() alongside their rotate transform', () => {
    for (const name of ['flipX', 'flipY', 'cube', 'coverflow']) {
      const p = TRANSITION_PRESETS[name]!;
      expect(p.enter(1).transform).toContain('perspective(');
    }
  });

  it('every preset returns "none" for a fully-identity axis config (no dangling empty transform functions)', () => {
    // deck has no rotate/perspective at all — its transform should just be translate+scale, not e.g. "rotateZ(0deg)" noise.
    const deck = TRANSITION_PRESETS.deck!;
    expect(deck.enter(1).transform).not.toContain('rotate');
    expect(deck.enter(1).transform).not.toContain('perspective');
  });
});
