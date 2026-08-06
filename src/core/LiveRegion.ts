/** DESIGN.md §2.6 — visually-hidden `aria-live` region announcing slide changes. */
export class LiveRegion {
  readonly element: HTMLElement;

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'shoji-live-region';
    this.element.setAttribute('role', 'status');
    this.element.setAttribute('aria-live', 'polite');
  }

  announce(text: string): void {
    // Clear-then-set (with a forced reflow between) so repeated identical
    // announcements still fire in real assistive tech, which otherwise
    // ignores a text node set to the same value it already held.
    this.element.textContent = '';
    void this.element.offsetWidth;
    this.element.textContent = text;
  }
}
