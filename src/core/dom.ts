import { CAPTION_ICON, CLOSE_ICON, NEXT_ICON, PREV_ICON } from './icons';

let idCounter = 0;

export interface LightboxLabels {
  close: string;
  previous: string;
  next: string;
  showCaption: string;
  hideCaption: string;
}

export interface LightboxDom {
  outer: HTMLElement;
  dialog: HTMLElement;
  counter: HTMLElement;
  caption: HTMLElement;
  closeButton: HTMLButtonElement;
  prevButton: HTMLButtonElement;
  nextButton: HTMLButtonElement;
  captionToggleButton: HTMLButtonElement; // DESIGN.md §2.3a
  /** The `.shoji-toolbar` wrapper itself — always present, unlike its slots' individual contents, so it's the one reliable element to key a controls-fade `transitionend` wait off of (Gallery.ts's close()). */
  toolbar: HTMLElement;
  /** DESIGN.md §3 — `ctx.ui.toolbar(slot, ...)` inserts into these; close lives in `right`. */
  toolbarLeft: HTMLElement;
  toolbarCenter: HTMLElement;
  toolbarRight: HTMLElement;
}

function iconButton(className: string, icon: string, label: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.ariaLabel = button.title = label;
  button.innerHTML = icon;
  return button;
}

/**
 * DESIGN.md §2.6 — `.shoji-outer` is the exact element `ctx.ui.outer()` (§3)
 * will return to plugins once the real plugin loader exists. Close/prev/next
 * are core-owned baseline controls, not routed through any plugin API.
 */
export function buildLightboxDom(slides: HTMLElement, labels: LightboxLabels): LightboxDom {
  const labelId = `shoji-counter-${++idCounter}`;

  const outer = document.createElement('div');
  outer.className = 'shoji-outer';

  const backdrop = document.createElement('div');
  backdrop.className = 'shoji-backdrop';
  outer.appendChild(backdrop);

  const dialog = document.createElement('div');
  dialog.className = 'shoji-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', labelId);
  dialog.tabIndex = -1;

  const toolbar = document.createElement('div');
  toolbar.className = 'shoji-toolbar';
  const toolbarLeft = document.createElement('div');
  toolbarLeft.className = 'shoji-toolbar-slot shoji-toolbar-left';
  const toolbarCenter = document.createElement('div');
  toolbarCenter.className = 'shoji-toolbar-slot shoji-toolbar-center';
  const toolbarRight = document.createElement('div');
  toolbarRight.className = 'shoji-toolbar-slot shoji-toolbar-right';
  const closeButton = iconButton('shoji-close', CLOSE_ICON, labels.close);
  // Ahead of close so plugin buttons (always inserted right before close) land between the two.
  const captionToggleButton = iconButton(
    'shoji-toolbar-button shoji-caption-toggle',
    CAPTION_ICON,
    labels.showCaption,
  );
  captionToggleButton.setAttribute('aria-pressed', 'false');
  captionToggleButton.hidden = true;
  toolbarRight.append(captionToggleButton, closeButton);

  // The counter lives in the toolbar's own left slot (flex flow, not
  // independent absolute positioning) specifically so a plugin button
  // sharing that slot (e.g. autoplay's play/pause, ctx.ui.toolbar('left', ...))
  // sits next to it instead of the two overlapping and fighting over clicks.
  const counter = document.createElement('div');
  counter.className = 'shoji-counter';
  counter.id = labelId;
  toolbarLeft.appendChild(counter);

  toolbar.append(toolbarLeft, toolbarCenter, toolbarRight);
  dialog.appendChild(toolbar);

  const prevButton = iconButton('shoji-nav shoji-nav-prev', PREV_ICON, labels.previous);
  const nextButton = iconButton('shoji-nav shoji-nav-next', NEXT_ICON, labels.next);
  dialog.appendChild(prevButton);
  dialog.appendChild(nextButton);

  dialog.appendChild(slides);

  const caption = document.createElement('div');
  caption.className = 'shoji-caption';
  dialog.appendChild(caption);

  outer.appendChild(dialog);

  return {
    outer,
    dialog,
    counter,
    caption,
    closeButton,
    prevButton,
    nextButton,
    captionToggleButton,
    toolbar,
    toolbarLeft,
    toolbarCenter,
    toolbarRight,
  };
}
