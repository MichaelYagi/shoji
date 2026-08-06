import { describe, expect, it } from 'vitest';
import { LiveRegion } from '../../src/core/LiveRegion';

describe('LiveRegion', () => {
  it('creates a role=status, aria-live=polite element', () => {
    const region = new LiveRegion();
    expect(region.element.getAttribute('role')).toBe('status');
    expect(region.element.getAttribute('aria-live')).toBe('polite');
  });

  it('announce() sets the text content', () => {
    const region = new LiveRegion();
    region.announce('Image 3 of 20: Sunset');
    expect(region.element.textContent).toBe('Image 3 of 20: Sunset');
  });

  it('announce() with the same text still results in that text (clear-then-set)', () => {
    const region = new LiveRegion();
    region.announce('Image 1 of 5');
    region.announce('Image 1 of 5');
    expect(region.element.textContent).toBe('Image 1 of 5');
  });
});
