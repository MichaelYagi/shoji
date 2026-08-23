import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import path from 'node:path';

/**
 * Two compounding real bugs, both reported from real usage: a really long
 * caption on a video slide left no way to reach the native scrub bar /
 * volume / fullscreen controls underneath it.
 *
 * 1. `.shoji-caption`'s height was unbounded (`width: fit-content`, no
 *    `max-height`) — a long enough caption word-wraps until it fills its
 *    own `max-width`, then keeps growing taller with every extra line.
 *    Fixed with a height cap (`--shoji-caption-max-height`) plus
 *    `overflow-y: auto` so the full text stays reachable via scroll.
 * 2. Capping the height wasn't enough on its own: a video that fills most
 *    of the dialog leaves little to no letterboxing gap, so even a *short*,
 *    never-wrapped caption's opaque background can still land directly on
 *    the control bar underneath it (same bottom-left corner, same z-index
 *    stack) — confirmed directly, reproduced with a short caption over a
 *    full-bleed video. Fixed by letting clicks pass straight through the
 *    caption whenever the active slide is a video (`item.video` — HTML5 or
 *    a provider like YouTube alike, Gallery.ts's `updateCaptionVisibility`),
 *    re-enabled on any real child element so a rich HTML caption's own
 *    links stay clickable. Photo-slide captions are untouched by this —
 *    there's nothing below them that needs protecting.
 *
 * See DESIGN.md §2.3a.
 */

const corePath = () => '/@fs' + path.join(process.cwd(), 'src/core/index.ts').replace(/\\/g, '/');

async function openVideoGallery(page: Page, caption: string): Promise<void> {
  await page.evaluate(
    async ({ corePath, caption }: { corePath: string; caption: string }) => {
      const { Gallery } = await import(/* @vite-ignore */ corePath);
      const el = document.createElement('div');
      document.body.appendChild(el);
      const gallery = new Gallery(el, {
        // A real video file isn't needed — SlideManager inserts <video>
        // immediately regardless of whether the src ever loads (unlike
        // images, gated on decode()); these tests only measure DOM
        // geometry/hit-testing. Not under demo/assets/ on purpose — that
        // folder is gitignored, user-local sample media, absent in CI/a
        // fresh clone.
        items: [{ id: 'v', src: 'nonexistent.mp4', video: { provider: 'html5' }, caption }],
        // A video slide's caption now defaults to hidden (§2.3a's separate
        // toggle-button fix, tests/e2e/core-caption-toggle.spec.ts) — these
        // tests are specifically about the visible-caption geometry/
        // click-through case, so force it on rather than clicking the
        // toggle in every single test.
        showVideoCaption: true,
      });
      gallery.open(0);
    },
    { corePath: corePath(), caption },
  );
}

test('a very long caption stays height-capped and scrollable, instead of growing over the video controls beneath it', async ({
  page,
}) => {
  await page.goto('/pages/e2e-plugins.html');
  // repeat(30) was plenty against the old fixed min(8rem, 30%) cap, but
  // isn't a safe margin against the new, much larger toolbar-derived one
  // (DESIGN.md §2.3a) on every viewport — CI's mobile-chrome project, wide
  // relative to its own height with no width cap of its own (mobile is
  // deliberately excluded from the desktop-only width cap), wraps this
  // into few enough lines to fit the taller cap without ever needing to
  // scroll. A much larger repeat count keeps this test about "does
  // scrolling engage for a genuinely too-long caption," not about tuned
  // geometry that has to keep pace with the cap's own default.
  const longCaption = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(200);
  await openVideoGallery(page, longCaption);

  // .last() — the fixture page's own gallery (closed, but already
  // constructed) has its own empty `.shoji-caption` in the DOM too; this
  // test's freshly-constructed gallery is the one opened just above.
  const caption = page.locator('.shoji-caption').last();
  await expect(caption).toBeVisible();

  const box = (await caption.boundingBox())!;
  const toolbarBox = (await page.locator('.shoji-toolbar').last().boundingBox())!;

  // The exact cap is a theme-able custom property (--shoji-caption-max-height,
  // shoji.css), not a magic number worth hardcoding here — the regression
  // this guards is "unbounded," specifically growing up over the toolbar
  // (DESIGN.md §2.3a's own real bug, caught the same way: a caption long
  // enough to visibly cover the toolbar's controls). The caption's own
  // ceiling now derives from the toolbar's real measured height, not a
  // fixed fraction of the dialog, so "never overlaps the toolbar" is the
  // meaningful, implementation-detail-free check — not a percentage of
  // dialog height, which the cap can legitimately exceed on a short
  // toolbar/tall dialog. Playwright's boundingBox() is {x, y, width,
  // height}, not a DOMRect — bottom computed manually.
  expect(box.y).toBeGreaterThanOrEqual(toolbarBox.y + toolbarBox.height);

  // Confirms the cap actually engaged (this caption genuinely doesn't fit),
  // not that it's scrollable in place — DESIGN.md §2.3a's later truncated-
  // caption-modal work replaced in-place scrolling with truncate + a
  // separate modal to read the rest; that modal's own reachability (click/
  // tap/Enter, focus, content) is covered by tests/unit/gallery-lightbox.test.ts
  // and tests/e2e/core-caption-modal.spec.ts instead, not here.
  const stillOverflows = await caption.evaluate((el) => el.scrollHeight > el.clientHeight);
  expect(stillOverflows).toBe(true);
  // A real bug, caught by a flaky CI failure on WebKit: missing `await`
  // here meant this auto-retrying assertion was never actually retried —
  // just a single, unawaited check racing whatever `updateCaptionTruncation()`
  // (still mid-flight, see its own `requestAnimationFrame`-deferred re-check,
  // DESIGN.md §2.3a) had landed at that exact instant, not a real wait for
  // the settled state the test is actually about.
  await expect(caption).toHaveClass(/shoji-caption--truncated/);
});

test('regression: even a short caption on a full-bleed video click-throughs to the video, not just the space around it', async ({
  page,
}) => {
  await page.goto('/pages/e2e-plugins.html');
  await openVideoGallery(page, 'A short caption'); // deliberately never wraps
  await page.addStyleTag({
    // Forces the exact geometry that made this fail in practice: the video
    // filling the whole dialog, no letterboxing gap above the caption.
    content: 'video.shoji-slide-video { width: 100% !important; height: 100% !important; }',
  });

  const caption = page.locator('.shoji-caption').last();
  await expect(caption).toBeVisible();

  // A click dead-center of the caption's *own visual box* — not merely
  // near it — must still land on the <video> underneath.
  const hitsVideo = await caption.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return hit?.tagName === 'VIDEO';
  });
  expect(hitsVideo).toBe(true);
});

test('regression: clicking a caption on a letterboxed video (nothing directly underneath it) does not close the gallery', async ({
  page,
}) => {
  // A real bug, reported from real usage: the click-through above only
  // stays safe when the video genuinely fills the space the caption sits
  // over — this fixture's <video> never resolves real metadata
  // (nonexistent.mp4), so it renders at the browser's own small intrinsic
  // default (letterboxed within the dialog) without the full-bleed
  // override the test above applies. The caption's own bottom-left
  // position then sits over plain .shoji-slide-media background, not the
  // video — clicking through used to fall all the way to a genuine
  // backdrop click and close the gallery on what was meant as an
  // interaction with the caption, not "click outside to close."
  await page.goto('/pages/e2e-plugins.html');
  await openVideoGallery(page, 'A short caption');

  const caption = page.locator('.shoji-caption').last();
  await expect(caption).toBeVisible();

  const hitsSlideMedia = await caption.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return hit?.classList.contains('shoji-slide-media');
  });
  expect(hitsSlideMedia).toBe(true); // confirms this really is the letterboxed-gap case, not accidentally full-bleed

  await caption.click({ force: true }); // force: true — pointer-events:none makes Playwright's own actionability check see nothing clickable there otherwise
  await expect(page.locator('.shoji-outer.shoji-open').last()).toHaveCount(1); // must still be open
});

test('a rich HTML caption on a video slide keeps its own links clickable, even though the caption background click-throughs', async ({
  page,
}) => {
  await page.goto('/pages/e2e-plugins.html');

  await page.evaluate(async (corePath: string) => {
    const { Gallery } = await import(/* @vite-ignore */ corePath);
    const el = document.createElement('div');
    document.body.appendChild(el);
    const captionEl = document.createElement('span');
    captionEl.innerHTML = 'See <a id="e2e-caption-link" href="#test">this link</a>';
    const gallery = new Gallery(el, {
      items: [
        {
          id: 'v',
          src: 'nonexistent.mp4',
          video: { provider: 'html5' },
          caption: captionEl,
        },
      ],
      showVideoCaption: true, // this test is about the visible-caption case
    });
    gallery.open(0);
  }, corePath());

  const link = page.locator('#e2e-caption-link');
  await expect(link).toBeVisible();

  const hitsLink = await link.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return hit === el;
  });
  expect(hitsLink).toBe(true);
});

test('a photo slide caption is unaffected — still normally interactive/scrollable, nothing below it needs protecting', async ({
  page,
}) => {
  await page.goto('/pages/e2e-plugins.html');
  const longCaption = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(30);

  await page.evaluate(
    async ({ corePath, longCaption }: { corePath: string; longCaption: string }) => {
      const { Gallery } = await import(/* @vite-ignore */ corePath);
      const el = document.createElement('div');
      document.body.appendChild(el);
      const gallery = new Gallery(el, {
        items: [
          {
            id: 'p',
            src: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',
            caption: longCaption,
          },
        ],
      });
      gallery.open(0);
    },
    { corePath: corePath(), longCaption },
  );

  const caption = page.locator('.shoji-caption').last();
  await expect(caption).toBeVisible();
  await expect(caption).not.toHaveClass(/shoji-caption--video/);

  // A click dead-center of the caption still hits the caption itself (not
  // click-through) — the video-only click-through fix must not leak into
  // the ordinary photo-slide case.
  const hitsCaption = await caption.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return el.contains(hit);
  });
  expect(hitsCaption).toBe(true);
});
