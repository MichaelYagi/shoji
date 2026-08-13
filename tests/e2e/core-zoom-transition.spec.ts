import { test, expect } from '@playwright/test';
import path from 'node:path';

/**
 * DESIGN.md §2.3b — a real bug found via reopening the lightbox:
 * `zoomOut()`'s cleanup compared the raw JS-computed transform string
 * (containing an arbitrary float, e.g. `scale(0.10416666666666667)`)
 * against what `target.style.transform` read back after the browser's own
 * CSSOM serializer reformatted it (e.g. `scale(0.104167)`) — those never
 * match for a scale factor without a short, clean decimal, so the
 * "only clear if nothing else touched it" safety check always failed,
 * permanently leaving the shrink transform applied to `.shoji-slide-media`
 * after close(). A jsdom unit test can't reproduce this — it needs a real
 * browser's own CSSOM string formatting.
 */
const corePath = () => '/@fs' + path.join(process.cwd(), 'src/core/index.ts').replace(/\\/g, '/');

test("close() actually clears the zoom-out transform — doesn't leave it stuck on .shoji-slide-media for the next open() to measure", async ({
  page,
}) => {
  await page.goto('/pages/e2e-plugins.html');

  const result = await page.evaluate(
    async ({ corePath }) => {
      const { Gallery } = await import(/* @vite-ignore */ corePath);

      const marker = document.createElement('div');
      marker.setAttribute('data-shoji-id', 'p');
      Object.assign(marker.style, {
        position: 'fixed',
        top: '10px',
        left: '10px',
        width: '100px',
        height: '100px',
      });
      document.body.appendChild(marker);

      const mount = document.createElement('div');
      document.body.appendChild(mount);
      const gallery = new Gallery(mount, {
        items: [{ id: 'p', src: 'a.jpg', width: 800, height: 600 }],
        preload: 0,
      });

      // .shoji-outer is appended to document.body regardless of host
      // container — the fixture page's own (never-opened) gallery is
      // already in the DOM first, so this freshly-constructed one is last.
      const outers = document.querySelectorAll('.shoji-outer');
      const myOuter = outers[outers.length - 1] as HTMLElement;
      const media = myOuter.querySelector('.shoji-slide-media') as HTMLElement;
      const settle = () =>
        new Promise<void>((resolve) => {
          media.addEventListener('transitionend', () => resolve(), { once: true });
          setTimeout(resolve, 500);
        });

      gallery.open(0);
      await settle();

      gallery.close();
      await settle();
      const transformAfterClose = media.style.transform;

      gallery.destroy();
      marker.remove();

      return { transformAfterClose };
    },
    { corePath: corePath() },
  );

  expect(result.transformAfterClose).toBe('');
});

/**
 * DESIGN.md §2.3b — reported from real usage: opening a genuinely small
 * photo visibly grew it to fill the dialog before snapping back down to its
 * true (small) size the instant the real image finished loading — even with
 * `item.width`/`item.height` correctly known ahead of time. `computeTransform`
 * knew the right *shape* (aspect ratio) but always sized the target box to
 * fill the container, with no concept of the photo's own true pixel size to
 * cap growth at. Reads the FLIP animation's own initial (pre-transition,
 * synchronously applied) transform right after `open()` — this is the exact
 * scale `computeTransform` computed, before any transition has had a chance
 * to run, so it doesn't require sampling a mid-flight animation frame.
 */
test("open() computes the zoom-in transform against the real photo's own small native size, not the full dialog — a small photo does not visibly overshoot before settling", async ({
  page,
}) => {
  await page.goto('/pages/e2e-plugins.html');

  const result = await page.evaluate(
    async ({ corePath }) => {
      const { Gallery } = await import(/* @vite-ignore */ corePath);

      const marker = document.createElement('div');
      marker.setAttribute('data-shoji-id', 'p');
      Object.assign(marker.style, {
        position: 'fixed',
        top: '10px',
        left: '10px',
        width: '50px',
        height: '40px',
      });
      document.body.appendChild(marker);

      const mount = document.createElement('div');
      document.body.appendChild(mount);
      // A genuinely small real photo (100x80) — much smaller than the
      // dialog it opens into, same as any real small image would be.
      const gallery = new Gallery(mount, {
        items: [{ id: 'p', src: 'a.jpg', width: 100, height: 80 }],
        preload: 0,
      });

      const outers = document.querySelectorAll('.shoji-outer');
      const myOuter = outers[outers.length - 1] as HTMLElement;
      const media = myOuter.querySelector('.shoji-slide-media') as HTMLElement;

      // zoomIn() sets the instant jump transform, forces a reflow, then
      // immediately overwrites it to 'none' to start the transition away —
      // all synchronously, before open() ever returns. By the time any code
      // outside zoomIn() can read media.style.transform back, it already
      // reads 'none' — so the only way to observe computeTransform's actual
      // output is to intercept the setter and capture the first (non-'none')
      // value written, same technique tests/unit/zoomTransition.test.ts uses.
      // Defined on the instance (not the prototype, whose own accessor isn't
      // reliably reachable via getOwnPropertyDescriptor across real browser
      // CSSOM implementations) via the spec-guaranteed setProperty/
      // getPropertyValue methods instead, which this override doesn't touch.
      let initialTransform = '';
      Object.defineProperty(media.style, 'transform', {
        configurable: true,
        get() {
          return media.style.getPropertyValue('transform');
        },
        set(v: string) {
          if (!initialTransform && v && v !== 'none') initialTransform = v;
          media.style.setProperty('transform', v);
        },
      });

      gallery.open(0);

      gallery.destroy();
      marker.remove();

      return { initialTransform };
    },
    { corePath: corePath() },
  );

  const match = result.initialTransform.match(/scale3d\(([-\d.]+),/);
  expect(match).not.toBeNull();
  const scale = Number(match![1]);

  // Capped at the photo's own 100x80: scale = min(50/100, 40/80) = 0.5.
  // Uncapped (the bug), contained within the dialog's own much larger box
  // instead, would compute a scale roughly an order of magnitude smaller.
  expect(scale).toBeCloseTo(0.5, 1);
});
