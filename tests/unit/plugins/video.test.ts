import { afterEach, describe, expect, it } from 'vitest';
import { Gallery } from '../../../src/core';
import { Video } from '../../../src/plugins/video';
import { renderYouTube } from '../../../src/plugins/video/youtube';

afterEach(() => {
  document.body.innerHTML = '';
});

function makeGallery(): Gallery {
  const el = document.createElement('div');
  return new Gallery(el, { items: [{ id: 'a', src: 'a.jpg' }], plugins: [Video] });
}

describe('Video plugin', () => {
  it('is reported as active', () => {
    const gallery = makeGallery();
    expect(gallery.getActivePlugins()).toContain('video');
    gallery.destroy();
  });

  it("registers renderYouTube for the 'youtube' provider — a later render of a youtube item uses it, not the unregistered-provider placeholder", () => {
    const items = [
      { id: 'yt', src: 'https://youtu.be/x', video: { provider: 'youtube' as const, id: 'x' } },
    ];
    const el = document.createElement('div');
    const gallery = new Gallery(el, { items, plugins: [Video], preload: 0 });

    gallery.open(0);

    // renderYouTube kicks off async API loading (window.YT isn't mocked
    // here) — the point of this test is only that it was reached at all
    // (not the unregistered-provider fallback), not that it completes.
    expect(document.querySelector('.shoji-slide-placeholder')).toBeNull();
    expect(document.querySelector('.shoji-slide-provider-video')).not.toBeNull();

    gallery.destroy();
  });

  it('unregisters on reinit() without Video — the same instance falls back to the placeholder for a youtube item afterward', () => {
    const items = [
      { id: 'yt', src: 'https://youtu.be/x', video: { provider: 'youtube' as const, id: 'x' } },
    ];
    const gallery = new Gallery(document.createElement('div'), {
      items,
      plugins: [Video],
      preload: 0,
    });
    gallery.open(0);
    expect(document.querySelector('.shoji-slide-provider-video')).not.toBeNull();

    gallery.reinit({ items, preload: 0 }); // no plugins this time
    gallery.open(0);

    expect(document.querySelector('.shoji-slide-placeholder')?.textContent).toBe('Video');
    gallery.destroy();
  });

  it('exports renderYouTube as a real function (sanity check on the module shape this plugin depends on)', () => {
    expect(typeof renderYouTube).toBe('function');
  });
});
