import { describe, expect, it, vi } from 'vitest';
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

  describe('YouTube detection in data-shoji-video', () => {
    it.each([
      ['https://youtu.be/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
      ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
      ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30s', 'dQw4w9WgXcQ'],
      ['https://youtube.com/embed/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
      ['https://m.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
      ['https://youtube.com/shorts/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
      ['https://youtube.com/live/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
      ['https://youtube.com/v/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
      ['https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
      ['https://youtube-nocookie.com/embed/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
      ['https://music.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
      ['https://youtu.be/dQw4w9WgXcQ/', 'dQw4w9WgXcQ'],
      ['https://youtu.be/dQw4w9WgXcQ?si=abc123', 'dQw4w9WgXcQ'],
    ])('recognizes %s -> id %s', (url, id) => {
      const el = container(`<div data-shoji-video="${url}"></div>`);

      const scanned = scanContainer(el);

      expect(scanned[0]?.item).toMatchObject({
        src: url,
        video: { provider: 'youtube', id, url },
      });
      // A YouTube-provider item has no `sources` — the html5 fallback path is
      // the only one that sets it, and this shouldn't have taken it.
      expect(scanned[0]?.item.sources).toBeUndefined();
    });

    it('does not treat an unrelated host containing "youtube" as a match', () => {
      const el = container(
        `<div data-shoji-video="https://notyoutube.com/watch?v=dQw4w9WgXcQ"></div>`,
      );

      const scanned = scanContainer(el);

      expect(scanned[0]?.item.video).toEqual({ provider: 'html5' });
    });

    it('falls back to html5 for a youtube.com URL with no recognizable id', () => {
      const el = container(`<div data-shoji-video="https://youtube.com/about"></div>`);

      const scanned = scanContainer(el);

      expect(scanned[0]?.item.video).toEqual({ provider: 'html5' });
    });

    it('still picks up data-shoji-poster/caption/id on a YouTube item', () => {
      const el = container(
        `<div data-shoji-video="https://youtu.be/dQw4w9WgXcQ" data-shoji-poster="poster.jpg" data-shoji-caption="A song" data-shoji-id="yt-1"></div>`,
      );

      const scanned = scanContainer(el);

      expect(scanned[0]?.item).toMatchObject({
        id: 'yt-1',
        poster: 'poster.jpg',
        caption: 'A song',
        video: { provider: 'youtube', id: 'dQw4w9WgXcQ' },
      });
    });
  });

  describe('data-shoji-video-id', () => {
    it('overrides the id that would otherwise be parsed from the URL', () => {
      const el = container(
        `<div data-shoji-video="https://youtu.be/wrong-id" data-shoji-video-id="right-id"></div>`,
      );

      const scanned = scanContainer(el);

      expect(scanned[0]?.item.video).toEqual({
        provider: 'youtube',
        id: 'right-id',
        url: 'https://youtu.be/wrong-id',
      });
      expect(scanned[0]?.item.src).toBe('https://youtu.be/wrong-id'); // the link itself is untouched
    });

    it('rescues a YouTube URL shape detectYouTubeId cannot parse, as long as the host matches', () => {
      const el = container(
        `<div data-shoji-video="https://youtube.com/attribution_link?u=weird" data-shoji-video-id="rescued-id"></div>`,
      );

      const scanned = scanContainer(el);

      expect(scanned[0]?.item.video).toMatchObject({ provider: 'youtube', id: 'rescued-id' });
      expect(scanned[0]?.item.sources).toBeUndefined();
    });

    it('warns and falls back to html5 when set on a URL that is not a recognized YouTube host', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const el = container(
        `<div data-shoji-video="clip.mp4" data-shoji-video-id="bogus-id"></div>`,
      );

      const scanned = scanContainer(el);

      expect(scanned[0]?.item.video).toEqual({ provider: 'html5' });
      expect(scanned[0]?.item.sources).toEqual([{ src: 'clip.mp4', type: 'video/mp4' }]);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toMatch(/bogus-id.*isn't a recognized YouTube URL/);
      warn.mockRestore();
    });

    it('warns and is ignored when set without a nested <video> or data-shoji-video at all', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const el = container(`<div data-shoji-video-id="orphaned-id"></div>`);

      const scanned = scanContainer(el, ':scope > [data-shoji-video-id]');

      expect(scanned).toHaveLength(0); // no source at all — not a valid item either way
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toMatch(/requires a data-shoji-video URL/);
      warn.mockRestore();
    });

    it('warns and is ignored on a real <video> element (always html5, regardless)', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const el = container(
        `<div data-shoji-video-id="ignored-id"><video src="clip.mp4"></video></div>`,
      );

      const scanned = scanContainer(el, ':scope > [data-shoji-video-id]');

      expect(scanned[0]?.item.video).toEqual({ provider: 'html5' });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toMatch(/no effect on a nested <video>/);
      warn.mockRestore();
    });
  });

  describe('data-shoji-video-provider', () => {
    it('lets data-shoji-video-id be trusted on a URL whose host is not a recognized YouTube one', () => {
      const el = container(
        `<div data-shoji-video="https://proxy.example.com/v/xyz" data-shoji-video-provider="youtube" data-shoji-video-id="dQw4w9WgXcQ"></div>`,
      );

      const scanned = scanContainer(el);

      expect(scanned[0]?.item.video).toEqual({
        provider: 'youtube',
        id: 'dQw4w9WgXcQ',
        url: 'https://proxy.example.com/v/xyz',
      });
      expect(scanned[0]?.item.sources).toBeUndefined();
    });

    it('warns but still builds an id-less youtube item when explicit and no id can be found', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const el = container(
        `<div data-shoji-video="https://proxy.example.com/v/xyz" data-shoji-video-provider="youtube"></div>`,
      );

      const scanned = scanContainer(el);

      expect(scanned[0]?.item.video).toEqual({
        provider: 'youtube',
        id: undefined,
        url: 'https://proxy.example.com/v/xyz',
      });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toMatch(/no id could be parsed/);
      warn.mockRestore();
    });

    it('builds a vimeo/wistia item from an explicit id — neither has URL-based detection', () => {
      const el = container(
        `<div data-shoji-video="https://vimeo.com/76979871" data-shoji-video-provider="vimeo" data-shoji-video-id="76979871"></div>`,
      );

      const scanned = scanContainer(el);

      expect(scanned[0]?.item.video).toEqual({
        provider: 'vimeo',
        id: '76979871',
        url: 'https://vimeo.com/76979871',
      });
    });

    it('warns and falls back to html5 for vimeo/wistia with no id given at all', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const el = container(
        `<div data-shoji-video="https://vimeo.com/76979871" data-shoji-video-provider="vimeo"></div>`,
      );

      const scanned = scanContainer(el);

      expect(scanned[0]?.item.video).toEqual({ provider: 'html5' });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toMatch(/needs a data-shoji-video-id/);
      warn.mockRestore();
    });

    it('forces html5 even on a URL that looks like YouTube, and warns if an id was also set', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const el = container(
        `<div data-shoji-video="https://youtu.be/dQw4w9WgXcQ" data-shoji-video-provider="html5" data-shoji-video-id="ignored"></div>`,
      );

      const scanned = scanContainer(el);

      expect(scanned[0]?.item.video).toEqual({ provider: 'html5' });
      expect(scanned[0]?.item.sources).toEqual([
        { src: 'https://youtu.be/dQw4w9WgXcQ', type: 'video/mp4' },
      ]);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toMatch(/has no id/);
      warn.mockRestore();
    });

    it('warns and ignores an unrecognized provider value, falling back to normal auto-detection', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const el = container(
        `<div data-shoji-video="https://youtu.be/dQw4w9WgXcQ" data-shoji-video-provider="dailymotion"></div>`,
      );

      const scanned = scanContainer(el);

      expect(scanned[0]?.item.video).toEqual({
        provider: 'youtube',
        id: 'dQw4w9WgXcQ',
        url: 'https://youtu.be/dQw4w9WgXcQ',
      });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toMatch(
        /data-shoji-video-provider="dailymotion".*isn't recognized/,
      );
      warn.mockRestore();
    });

    it('a youtube.com URL with no explicit provider and no parseable id still falls back to html5 quietly (unchanged legacy behavior)', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const el = container(`<div data-shoji-video="https://youtube.com/about"></div>`);

      const scanned = scanContainer(el);

      expect(scanned[0]?.item.video).toEqual({ provider: 'html5' });
      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
    });
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

  it('excludes data-shoji-video-id/data-shoji-video-provider from item.data — they fold into the nested item.video field, not a top-level one, so `key in item` alone cannot see they are already handled', () => {
    const el = container(
      `<div
        data-shoji-video="https://youtu.be/dQw4w9WgXcQ"
        data-shoji-video-provider="youtube"
        data-shoji-video-id="dQw4w9WgXcQ"
        data-shoji-metadata-id="v-1"
      ></div>`,
    );

    const scanned = scanContainer(el);

    expect(scanned[0]?.item.data).toEqual({ 'metadata-id': 'v-1' });
  });
});
