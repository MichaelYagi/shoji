import { afterEach, describe, expect, it } from 'vitest';
import { FocusTrap } from '../../src/core/FocusTrap';

function pressTab(opts: { shiftKey?: boolean } = {}): void {
  const event = new KeyboardEvent('keydown', {
    key: 'Tab',
    shiftKey: opts.shiftKey ?? false,
    bubbles: true,
    cancelable: true,
  });
  document.dispatchEvent(event);
}

describe('FocusTrap', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('moves focus into the container on activate', () => {
    const container = document.createElement('div');
    container.tabIndex = -1;
    document.body.appendChild(container);

    new FocusTrap().activate(container);

    expect(document.activeElement).toBe(container);
  });

  it('wraps Tab from the last focusable element back to the first', () => {
    const container = document.createElement('div');
    container.tabIndex = -1;
    const first = document.createElement('button');
    const last = document.createElement('button');
    container.append(first, last);
    document.body.appendChild(container);

    const trap = new FocusTrap();
    trap.activate(container);
    last.focus();
    pressTab();

    expect(document.activeElement).toBe(first);
  });

  it('wraps Shift+Tab from the first focusable element back to the last', () => {
    const container = document.createElement('div');
    container.tabIndex = -1;
    const first = document.createElement('button');
    const last = document.createElement('button');
    container.append(first, last);
    document.body.appendChild(container);

    const trap = new FocusTrap();
    trap.activate(container);
    first.focus();
    pressTab({ shiftKey: true });

    expect(document.activeElement).toBe(last);
  });

  it('keeps focus on the container when nothing inside is focusable', () => {
    const container = document.createElement('div');
    container.tabIndex = -1;
    document.body.appendChild(container);

    const trap = new FocusTrap();
    trap.activate(container);
    pressTab();

    expect(document.activeElement).toBe(container);
  });

  it('restores the previously focused element on deactivate', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();

    const container = document.createElement('div');
    container.tabIndex = -1;
    document.body.appendChild(container);

    const trap = new FocusTrap();
    trap.activate(container);
    expect(document.activeElement).toBe(container);

    trap.deactivate();
    expect(document.activeElement).toBe(trigger);
  });

  it('stops trapping Tab after deactivate', () => {
    const container = document.createElement('div');
    container.tabIndex = -1;
    const first = document.createElement('button');
    const last = document.createElement('button');
    container.append(first, last);
    document.body.appendChild(container);

    const trap = new FocusTrap();
    trap.activate(container);
    trap.deactivate();
    last.focus();
    pressTab();

    expect(document.activeElement).toBe(last); // no wrap — trap is inactive
  });
});
