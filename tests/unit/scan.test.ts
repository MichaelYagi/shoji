import { describe, expect, it } from 'vitest';
import { scanContainer } from '../../src/core/scan';

function container(html: string): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = html;
  return el;
}

describe('scanContainer', () => {
  it('scans anchor+img children into image items with the default selector', () => {
    const el = container(`
      <a href="full-1.jpg" data-shoji-caption="First">
        <img src="thumb-1.jpg" alt="First photo">
      </a>
      <a href="full-2.jpg"><img src="thumb-2.jpg" alt="Second photo"></a>
    `);

    const scanned = scanContainer(el);

    expect(scanned).toHaveLength(2);
    expect(scanned[0]?.item).toMatchObject({
      id: 'full-1.jpg',
      src: 'full-1.jpg',
      thumb: 'thumb-1.jpg',
      alt: 'First photo',
      caption: 'First',
    });
    expect(scanned[1]?.item).toMatchObject({ src: 'full-2.jpg', thumb: 'thumb-2.jpg' });
  });

  it('only scans direct children, not nested anchors', () => {
    const el = container(`
      <a href="full-1.jpg"><img src="thumb-1.jpg"></a>
      <div><a href="nested.jpg">should not match</a></div>
    `);

    const scanned = scanContainer(el);

    expect(scanned).toHaveLength(1);
    expect(scanned[0]?.item.src).toBe('full-1.jpg');
  });

  it('uses data-shoji-src/thumb/id when there is no anchor', () => {
    const el = container(`
      <div data-shoji-src="full.jpg" data-shoji-thumb="thumb.jpg" data-shoji-id="custom-id"></div>
    `);

    const scanned = scanContainer(el);

    expect(scanned[0]?.item).toMatchObject({
      id: 'custom-id',
      src: 'full.jpg',
      thumb: 'thumb.jpg',
    });
  });

  it('detects html5 video from a nested <video> element', () => {
    const el = container(`
      <a href="poster-link.jpg" data-shoji-id="vid-1">
        <video poster="poster.jpg">
          <source src="video.webm" type="video/webm">
          <source src="video.mp4" type="video/mp4">
        </video>
      </a>
    `);

    const scanned = scanContainer(el);

    expect(scanned).toHaveLength(1);
    expect(scanned[0]?.item).toMatchObject({
      id: 'vid-1',
      src: 'video.webm',
      poster: 'poster.jpg',
      video: { provider: 'html5' },
      sources: [
        { src: 'video.webm', type: 'video/webm' },
        { src: 'video.mp4', type: 'video/mp4' },
      ],
    });
  });

  it('detects html5 video from data-shoji-video with a guessed mime type', () => {
    const el = container(`<div data-shoji-video="clip.webm" data-shoji-poster="poster.jpg"></div>`);

    const scanned = scanContainer(el);

    expect(scanned[0]?.item).toMatchObject({
      src: 'clip.webm',
      poster: 'poster.jpg',
      video: { provider: 'html5' },
      sources: [{ src: 'clip.webm', type: 'video/webm' }],
    });
  });

  it('falls back to video/mp4 for an unrecognized extension', () => {
    const el = container(`<div data-shoji-video="clip.mov"></div>`);

    const scanned = scanContainer(el);

    expect(scanned[0]?.item.sources).toEqual([{ src: 'clip.mov', type: 'video/mp4' }]);
  });

  it('skips elements with neither a source nor a video', () => {
    const el = container(`<a data-shoji-id="no-src"></a>`);

    expect(scanContainer(el)).toHaveLength(0);
  });

  it('captures unrecognized data-shoji-* attributes into item.data, keyed verbatim (not camelCased)', () => {
    const el = container(`
      <a href="full-1.jpg" data-shoji-id="1" data-shoji-caption="Sunset 1 img" data-shoji-metadata-id="123">
        <img src="thumb-1.jpg">
      </a>
    `);

    const scanned = scanContainer(el);

    expect(scanned[0]?.item).toMatchObject({
      id: '1',
      caption: 'Sunset 1 img',
      data: { 'metadata-id': '123' },
    });
  });

  it('collects multiple unrecognized data-shoji-* attributes into the same data object', () => {
    const el = container(
      `<a href="full.jpg" data-shoji-metadata-id="123" data-shoji-album="vacation"></a>`,
    );

    const scanned = scanContainer(el);

    expect(scanned[0]?.item.data).toEqual({ 'metadata-id': '123', album: 'vacation' });
  });

  it('never puts a known/reserved attribute (src, id, caption, width, height, ...) into item.data', () => {
    const el = container(
      `<a href="full.jpg" data-shoji-id="x" data-shoji-caption="c" data-shoji-width="800" data-shoji-height="600"></a>`,
    );

    const scanned = scanContainer(el);

    expect(scanned[0]?.item.data).toBeUndefined();
  });

  it('leaves item.data unset when there are no custom data-shoji-* attributes at all', () => {
    const el = container(`<a href="full.jpg"><img src="thumb.jpg"></a>`);

    const scanned = scanContainer(el);

    expect(scanned[0]?.item.data).toBeUndefined();
  });

  it('captures custom data-shoji-* attributes on video items too', () => {
    const el = container(`<div data-shoji-video="clip.mp4" data-shoji-metadata-id="v-9"></div>`);

    const scanned = scanContainer(el);

    expect(scanned[0]?.item.data).toEqual({ 'metadata-id': 'v-9' });
  });

  it("excludes data-shoji-no-drag (GestureController/GestureEngine's own marker) from item.data", () => {
    const el = container(`<a href="full.jpg" data-shoji-no-drag data-shoji-metadata-id="123"></a>`);

    const scanned = scanContainer(el);

    expect(scanned[0]?.item.data).toEqual({ 'metadata-id': '123' });
  });
});
