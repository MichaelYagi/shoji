/**
 * DESIGN.md §2.5 — built-in presets, generated from a small config→transform
 * DSL rather than ~20 hand-written keyframe functions. `enter(direction)` is
 * where the incoming slide starts (then transitions to natural: `transform:
 * none; opacity: 1`); `leave(direction)` is where the outgoing clone (see
 * `SlideTransition.ts`) ends up (starts at natural, transitions to this).
 * `direction` is `1` for next()-style, `-1` for prev()-style — presets that
 * don't care (fade, zoom, flipX, deck, drop...) never read it. transform/
 * opacity only, per CLAUDE.md's hardware-accelerated-CSS3 constraint.
 */

export interface TransitionState {
  transform: string;
  opacity: number;
}

export interface TransitionPreset {
  name: string;
  enter(direction: 1 | -1): TransitionState;
  leave(direction: 1 | -1): TransitionState;
}

/** One end of one preset. `directional: true` multiplies translateX/Y/rotateZ/Y by nav direction (mirror-image next vs prev — the "slide" family); omitted means the same fixed transform either way (the "fade" family — fadeUp always rises). */
interface AxisConfig {
  directional?: boolean;
  translateX?: number; // %
  translateY?: number; // %
  scale?: number;
  rotateX?: number; // deg, never direction-multiplied
  rotateY?: number; // deg
  rotateZ?: number; // deg
  perspective?: number; // px, needed alongside rotateX/Y for real 3D depth
  opacity?: number; // default 1
}

function resolveAxis(config: AxisConfig, direction: 1 | -1): TransitionState {
  const sign = config.directional ? direction : 1;
  const parts: string[] = [];
  if (config.perspective) parts.push(`perspective(${config.perspective}px)`);
  const tx = config.translateX !== undefined ? config.translateX * sign : 0;
  const ty = config.translateY ?? 0;
  if (tx !== 0 || ty !== 0) parts.push(`translate(${tx}%, ${ty}%)`);
  if (config.rotateY !== undefined) parts.push(`rotateY(${config.rotateY * sign}deg)`);
  if (config.rotateX !== undefined) parts.push(`rotateX(${config.rotateX}deg)`);
  if (config.rotateZ !== undefined) parts.push(`rotateZ(${config.rotateZ * sign}deg)`);
  if (config.scale !== undefined) parts.push(`scale(${config.scale})`);
  return { transform: parts.length > 0 ? parts.join(' ') : 'none', opacity: config.opacity ?? 1 };
}

interface PresetSpec {
  name: string;
  enter: AxisConfig;
  leave: AxisConfig;
}

function preset(spec: PresetSpec): TransitionPreset {
  return {
    name: spec.name,
    enter: (direction) => resolveAxis(spec.enter, direction),
    leave: (direction) => resolveAxis(spec.leave, direction),
  };
}

const PRESET_LIST: TransitionPreset[] = [
  // The four DESIGN.md calls out by name: default mode, plus fade/zoom/deck.
  preset({
    name: 'slide',
    enter: { directional: true, translateX: 100 },
    leave: { directional: true, translateX: -100 },
  }),
  preset({
    name: 'fade',
    enter: { opacity: 0 },
    leave: { opacity: 0 },
  }),
  preset({
    name: 'zoom',
    enter: { scale: 0.6, opacity: 0 },
    leave: { scale: 1.4, opacity: 0 },
  }),
  preset({
    // "lg-style deck": the incoming slide drops into place from slightly
    // above/small while the outgoing one recedes back and fades, like a
    // card being placed on top of a deck — not direction-dependent, a deck
    // doesn't care whether the card came from the left or right.
    name: 'deck',
    enter: { translateY: 6, scale: 0.85, opacity: 0 },
    leave: { translateY: -4, scale: 0.92, opacity: 0 },
  }),

  // Positional siblings of `slide`.
  preset({
    name: 'slideVertical',
    enter: { directional: true, translateY: 100 },
    leave: { directional: true, translateY: -100 },
  }),
  preset({
    name: 'push',
    // Same geometry as `slide` but travels further (120% vs 100%) and with
    // no cross-fade at all — a harder, snappier "shove it off" feel.
    enter: { directional: true, translateX: 120 },
    leave: { directional: true, translateX: -120 },
  }),

  // Fixed-direction fades (not nav-direction-aware — a named entrance style).
  preset({
    name: 'fadeUp',
    enter: { translateY: 12, opacity: 0 },
    leave: { translateY: -12, opacity: 0 },
  }),
  preset({
    name: 'fadeDown',
    enter: { translateY: -12, opacity: 0 },
    leave: { translateY: 12, opacity: 0 },
  }),
  preset({
    name: 'fadeLeft',
    enter: { translateX: -12, opacity: 0 },
    leave: { translateX: 12, opacity: 0 },
  }),
  preset({
    name: 'fadeRight',
    enter: { translateX: 12, opacity: 0 },
    leave: { translateX: -12, opacity: 0 },
  }),

  // Zoom family.
  preset({ name: 'zoomOut', enter: { scale: 1.4, opacity: 0 }, leave: { scale: 0.6, opacity: 0 } }),
  preset({ name: 'scaleUp', enter: { scale: 0.7 }, leave: { scale: 1.3 } }),
  preset({ name: 'scaleDown', enter: { scale: 1.3 }, leave: { scale: 0.7 } }),

  // Rotation family — `rotate` is fixed-direction; `rotateLeft`/`rotateRight`
  // tie their spin to nav direction instead.
  preset({
    name: 'rotate',
    enter: { rotateZ: 15, opacity: 0 },
    leave: { rotateZ: -15, opacity: 0 },
  }),
  preset({
    name: 'rotateLeft',
    enter: { directional: true, rotateZ: -25, opacity: 0 },
    leave: { directional: true, rotateZ: 25, opacity: 0 },
  }),
  preset({
    name: 'rotateRight',
    enter: { directional: true, rotateZ: 25, opacity: 0 },
    leave: { directional: true, rotateZ: -25, opacity: 0 },
  }),

  // 3D family — needs `perspective()` in the same transform for real depth.
  preset({
    name: 'flipX',
    enter: { rotateX: 90, perspective: 1200, opacity: 0 },
    leave: { rotateX: -90, perspective: 1200, opacity: 0 },
  }),
  preset({
    name: 'flipY',
    enter: { directional: true, rotateY: 90, perspective: 1200, opacity: 0 },
    leave: { directional: true, rotateY: -90, perspective: 1200, opacity: 0 },
  }),
  preset({
    name: 'cube',
    enter: { directional: true, rotateY: 70, translateX: 40, perspective: 1600, opacity: 1 },
    leave: { directional: true, rotateY: -70, translateX: -40, perspective: 1600, opacity: 1 },
  }),
  preset({
    name: 'coverflow',
    enter: {
      directional: true,
      rotateY: 35,
      translateX: 60,
      scale: 0.8,
      perspective: 1400,
      opacity: 0,
    },
    leave: {
      directional: true,
      rotateY: -35,
      translateX: -60,
      scale: 0.8,
      perspective: 1400,
      opacity: 0,
    },
  }),

  // Fixed-direction drop.
  preset({
    name: 'drop',
    enter: { translateY: -30, opacity: 0 },
    leave: { translateY: 20, opacity: 0 },
  }),
];

/** Keyed by name for `Gallery`'s `mode`/`mobileSettings.mode` lookup — an unrecognized string is treated as a custom CSS-class-pair mode instead (see `SlideTransition.animateCustom`), not an error. */
export const TRANSITION_PRESETS: Readonly<Record<string, TransitionPreset>> = Object.fromEntries(
  PRESET_LIST.map((p) => [p.name, p]),
);
