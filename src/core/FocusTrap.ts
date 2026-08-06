const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), video[controls], [tabindex]:not([tabindex="-1"])';

/** DESIGN.md §2.6 — focus trap on open, focus restore on close, Tab cycles within the dialog. */
export class FocusTrap {
  private container: HTMLElement | null = null;
  private previouslyFocused: HTMLElement | null = null;

  private readonly onKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Tab' || !this.container) return;

    const focusable = this.getFocusable();
    if (focusable.length === 0) {
      event.preventDefault();
      this.container.focus();
      return;
    }

    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    const active = document.activeElement;
    const activeIsInside = active instanceof HTMLElement && focusable.includes(active);

    if (event.shiftKey) {
      if (!activeIsInside || active === first) {
        event.preventDefault();
        last.focus();
      }
    } else if (!activeIsInside || active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  private getFocusable(): HTMLElement[] {
    if (!this.container) return [];
    return Array.from(this.container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
  }

  activate(container: HTMLElement): void {
    this.previouslyFocused = document.activeElement as HTMLElement | null;
    this.container = container;
    document.addEventListener('keydown', this.onKeydown, true);
    container.focus();
  }

  deactivate(): void {
    document.removeEventListener('keydown', this.onKeydown, true);
    this.container = null;
    this.previouslyFocused?.focus();
    this.previouslyFocused = null;
  }
}
