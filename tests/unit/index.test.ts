import { describe, expect, it } from 'vitest';
import Shoji from '../../src/index';
import { Gallery } from '../../src/core';
import pkg from '../../package.json';

describe('Shoji default export', () => {
  it('is the Gallery constructor itself, not a wrapper namespace', () => {
    expect(Shoji).toBe(Gallery);
  });

  it('attaches every official plugin as a static property', () => {
    for (const name of [
      'Autoplay',
      'Layout',
      'ActiveThumbnail',
      'Fullscreen',
      'RotateFlip',
      'Zoom',
    ]) {
      expect(typeof (Shoji as unknown as Record<string, unknown>)[name]).toBe('object');
    }
  });

  it('exposes version matching package.json, not a hand-duplicated copy', () => {
    expect(Shoji.version).toBe(pkg.version);
  });
});
