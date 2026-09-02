import { describe, expect, it } from 'vitest';
import { createIconSwap } from '../../src/core/iconSwap';

describe('createIconSwap', () => {
  it('renders both icons into the DOM up front, off state visible by default', () => {
    const swap = createIconSwap('<svg data-off></svg>', '<svg data-on></svg>');

    expect(swap.el.className).toBe('shoji-icon-swap');
    expect(swap.el.classList.contains('shoji-icon-swap--on')).toBe(false);

    const off = swap.el.querySelector('.shoji-icon-swap-icon--off');
    const on = swap.el.querySelector('.shoji-icon-swap-icon--on');
    expect(off?.innerHTML).toBe('<svg data-off=""></svg>');
    expect(on?.innerHTML).toBe('<svg data-on=""></svg>');
  });

  it('setState(true) adds the modifier class; setState(false) removes it — both icons stay in the DOM either way', () => {
    const swap = createIconSwap('<svg data-off></svg>', '<svg data-on></svg>');

    swap.setState(true);
    expect(swap.el.classList.contains('shoji-icon-swap--on')).toBe(true);
    expect(swap.el.querySelector('.shoji-icon-swap-icon--off')).not.toBeNull();
    expect(swap.el.querySelector('.shoji-icon-swap-icon--on')).not.toBeNull();

    swap.setState(false);
    expect(swap.el.classList.contains('shoji-icon-swap--on')).toBe(false);
    expect(swap.el.querySelector('.shoji-icon-swap-icon--off')).not.toBeNull();
    expect(swap.el.querySelector('.shoji-icon-swap-icon--on')).not.toBeNull();
  });

  it('is idempotent — calling setState with the same value repeatedly does not toggle or duplicate anything', () => {
    const swap = createIconSwap('<svg data-off></svg>', '<svg data-on></svg>');

    swap.setState(true);
    swap.setState(true);
    swap.setState(true);
    expect(swap.el.classList.contains('shoji-icon-swap--on')).toBe(true);
    expect(swap.el.querySelectorAll('.shoji-icon-swap-icon').length).toBe(2);
  });
});
