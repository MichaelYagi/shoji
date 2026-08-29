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
      const settle = (fallbackMs = 500) =>
        new Promise<void>((resolve) => {
          media.addEventListener('transitionend', () => resolve(), { once: true });
          setTimeout(resolve, fallbackMs);
        });

      gallery.open(0);
      await settle();

      gallery.close();
      // close() now fades controls out first (DESIGN.md §2.6a), then runs
      // the zoom-out — two sequential ~--shoji-duration (300ms) animations,
      // not one, each with its own waitForTransitionEnd fallback padding
      // (duration + 100ms) — up to ~800ms theoretical worst case, so this
      // needs comfortably more than double the single-animation margin used
      // above, not just double.
      await settle(1500);
      // This test's own settle() listener is registered on `media` well
      // before zoomOut()'s *own* internal transitionend listener (the one
      // that actually runs clearInlineTransform) ever gets added — that
      // only happens once zoomOut() itself starts, after the controls-fade
      // delay. Confirmed directly: two listeners on the same native
      // transitionend, registered at different times, don't reliably run
      // as one tight synchronous batch — this test's own `await settle()`
      // continuation can resume *before* zoomOut's later-registered
      // listener gets its turn, even for that same event. A microtask-scale
      // buffer is enough to let it run.
      await new Promise((r) => setTimeout(r, 0));
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

/**
 * DESIGN.md §2.3 — a second, separate real bug found investigating the same
 * report: even with the zoom-in transform itself fixed (previous test), a
 * small photo still visibly ballooned to fill the dialog while its
 * `item.thumb`-sourced open placeholder was showing — a *different* code
 * path (SlideManager's `revealOpenPlaceholder`/`createOpenPlaceholder`),
 * whose CSS unconditionally forces it to `width/height: 100%` of the slide
 * frame, deliberately, as a stand-in for the common "this is probably a big
 * photo" case. It has nothing to do with the FLIP transform, which had
 * already settled to its natural (still full-size) resting state by the
 * time this placeholder is even visible — fixed separately, by sizing the
 * placeholder explicitly from `item.width`/`height` when known, instead of
 * always force-filling. `page.route` holds the real image's own request
 * open indefinitely so the placeholder stays up long enough to measure —
 * both `thumb`/`src` point at fake paths; the real image "loading forever"
 * is what keeps the placeholder the thing on screen to check.
 */
test("the open placeholder is capped at the real photo's own small native size too, not just the FLIP transform — stays capped after the transform settles, for as long as the real image is still loading", async ({
  page,
}) => {
  await page.route('**/full-photo.jpg', () => {}); // never resolves — holds the real image loading forever
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
      const gallery = new Gallery(mount, {
        items: [{ id: 'p', src: 'full-photo.jpg', thumb: 'thumb.jpg', width: 100, height: 80 }],
        preload: 0,
      });

      gallery.open(0);

      const outers = document.querySelectorAll('.shoji-outer');
      const myOuter = outers[outers.length - 1] as HTMLElement;
      const media = myOuter.querySelector('.shoji-slide-media') as HTMLElement;

      // Wait for the FLIP transform to actually finish (transitionend),
      // not a fixed sleep racing it — the same settle() pattern this file
      // already uses elsewhere. A real bug this was hiding under CI load:
      // getBoundingClientRect() on anything inside `media` reports the
      // *visually transformed* box, not its own CSS width/height, for as
      // long as media's own scale() hasn't settled back to 'none' yet.
      // Under CI's documented CPU contention (playwright.config.ts), a
      // dropped-frame-heavy run can take meaningfully longer wall-clock
      // than the nominal ~300ms duration, so a flat 300ms sleep
      // intermittently measured mid-transform instead of settled — a width
      // between the origin marker's 50px and the real photo's 100px,
      // exactly what CI observed. The placeholder's own decode (fast, and
      // unrelated to the held-open real image) reliably finishes well
      // within this same window regardless.
      await new Promise<void>((resolve) => {
        media.addEventListener('transitionend', () => resolve(), { once: true });
        setTimeout(resolve, 1500);
      });

      const placeholder = myOuter.querySelector(
        '.shoji-slide-open-placeholder',
      ) as HTMLElement | null;
      const rect = placeholder?.getBoundingClientRect();

      gallery.destroy();
      marker.remove();

      return { found: !!placeholder, width: rect?.width, height: rect?.height };
    },
    { corePath: corePath() },
  );

  expect(result.found).toBe(true);
  // Capped at the real 100x80 — not the dialog's own much larger size
  // (hundreds of px on any real viewport this runs at), and *not* the 50x40
  // origin marker either (a real bug: measuring the container mid-zoom-in-
  // animation, before it settles, computed against that tiny starting
  // point instead — a lower bound catches that a plain upper-bound check
  // alone would miss, since 50x40 also satisfies "not too big").
  expect(result.width).toBeGreaterThan(90);
  expect(result.width).toBeLessThanOrEqual(101);
  expect(result.height).toBeGreaterThan(70);
  expect(result.height).toBeLessThanOrEqual(81);
});

/**
 * DESIGN.md §2.3 — a real bug in the previous test's own fix: it measured
 * `.shoji-slide-media`'s `getBoundingClientRect()` as "the container" —
 * but that's the exact element the zoom-in transition (§2.3b) animates a
 * `scale()` transform on, growing it from the origin thumbnail's tiny
 * on-screen size up to full over `--shoji-duration` (~300ms default).
 * `getBoundingClientRect()` reflects whatever transform is *currently*
 * applied — if the placeholder's own decode resolves before that animation
 * settles (it usually does; a genuinely broken/missing image's decode()
 * rejects almost immediately, far faster than 300ms), this measured a
 * still-small, mid-animation rect instead of the real dialog size,
 * computing a contained box roughly thumbnail-sized instead of properly
 * scaled up — reads as "only the thumbnail shows, not scaled to the real
 * photo's size at all." The previous test didn't catch this: waiting a
 * fixed 300ms before measuring happened to also outlast the animation,
 * masking the bug even when it was present (confirmed directly — reverting
 * the fix still passed that test). This one measures as soon as the
 * placeholder appears instead, deliberately racing the still-in-flight
 * animation the same way the real bug report did.
 */
test('the open placeholder is sized correctly immediately, not just after the zoom-in animation has had time to settle — the two are unrelated timelines', async ({
  page,
}) => {
  await page.route('**/full-photo.jpg', () => {});
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
      const gallery = new Gallery(mount, {
        items: [{ id: 'p', src: 'full-photo.jpg', thumb: 'thumb.jpg', width: 100, height: 80 }],
        preload: 0,
      });

      const outers = document.querySelectorAll('.shoji-outer');
      const myOuter = outers[outers.length - 1] as HTMLElement;

      gallery.open(0);
      // Poll for the placeholder itself rather than waiting a fixed delay —
      // measures the instant it's actually there, whatever that takes, so
      // this can't accidentally race past it the way a fixed wait could.
      let placeholder: HTMLElement | null = null;
      const deadline = Date.now() + 2000;
      while (!placeholder && Date.now() < deadline) {
        placeholder = myOuter.querySelector('.shoji-slide-open-placeholder');
        if (!placeholder) await new Promise((resolve) => setTimeout(resolve, 1));
      }
      const rect = placeholder?.getBoundingClientRect();

      gallery.destroy();
      marker.remove();

      return { found: !!placeholder, width: rect?.width, height: rect?.height };
    },
    { corePath: corePath() },
  );

  expect(result.found).toBe(true);
  expect(result.width).toBeLessThanOrEqual(101);
  expect(result.height).toBeLessThanOrEqual(81);
});
