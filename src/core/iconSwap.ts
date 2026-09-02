/**
 * DESIGN.md §9 — a toolbar button whose icon reflects live state (Fullscreen's
 * enter/exit, Autoplay's play/pause, Zoom's actual-size expand/contract) used
 * to just replace `button.innerHTML` outright — an instant cut, no
 * transition, and each plugin reimplementing the same two-icon swap
 * independently. Requested directly: make every one of these a smooth
 * cross-fade, and make them all go through one shared mechanism rather than
 * three slightly different ones. Both icons are always in the DOM at once,
 * stacked via `position: absolute` inside a fixed-size wrapper
 * (`.shoji-icon-swap`, `shoji.css`) — swapping is just toggling which one is
 * `opacity: 1` via a single modifier class, so there's nothing to actually
 * replace, no risk of a flash-of-no-icon between the old node being removed
 * and the new one's fill/stroke painting in.
 */
export interface IconSwap {
  /** Append this into the button — it *is* the button's visible icon content. */
  el: HTMLSpanElement;
  /** `false` shows `iconOff`, `true` shows `iconOn` — cross-fades between them via CSS, respecting `prefers-reduced-motion` the same way every other transition in this codebase does (shoji.css zeroes `--shoji-icon-swap-duration` there). */
  setState(on: boolean): void;
}

export function createIconSwap(iconOff: string, iconOn: string): IconSwap {
  const el = document.createElement('span');
  el.className = 'shoji-icon-swap';

  const off = document.createElement('span');
  off.className = 'shoji-icon-swap-icon shoji-icon-swap-icon--off';
  off.innerHTML = iconOff;

  const on = document.createElement('span');
  on.className = 'shoji-icon-swap-icon shoji-icon-swap-icon--on';
  on.innerHTML = iconOn;

  el.append(off, on);

  return {
    el,
    setState(state: boolean): void {
      el.classList.toggle('shoji-icon-swap--on', state);
    },
  };
}
