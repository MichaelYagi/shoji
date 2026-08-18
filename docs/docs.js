// docs.css's own .docs-nav is a single horizontally-scrolling row (not
// wrap-to-multiple-rows) — with 12 pages listed, the current page's own
// pill can start scrolled off-screen to the right, since the row always
// renders scrolled to position 0 first. Center it into view once, so
// landing on (say) the Architecture page — last in the row — doesn't
// leave you wondering where "you are here" went. `instant`, not `smooth`
// — this runs before the user's ever seen the row settle in one place, so
// there's nothing for an animated scroll to usefully show.
document.querySelectorAll('.docs-nav [aria-current="page"]').forEach((el) => {
  el.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'instant' });
});

// "On this page" — built from the page's own real h2/h3 elements at load
// time, not hand-maintained per page: a per-page static list would drift
// the moment a heading changed and nobody remembered to update it here
// too. Skips h1 by construction (only h2/h3 are ever scanned), so the
// page's own title is never in it. Inserted right before the first
// section heading — after whatever intro paragraph(s) precede it, before
// real content starts — on any page with more than one heading; a page
// with zero or one doesn't have anything worth jumping around to.
(function buildToc() {
  const headings = document.querySelectorAll('h2, h3');
  if (headings.length < 2) return;

  const usedIds = new Set(Array.from(document.querySelectorAll('[id]'), (el) => el.id));
  const slugify = (text) =>
    text
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

  const list = document.createElement('ul');
  let lastTopLi = null;

  headings.forEach((h) => {
    if (!h.id) {
      const base = slugify(h.textContent || '') || 'section';
      let id = base;
      let n = 2;
      while (usedIds.has(id)) id = `${base}-${n++}`;
      h.id = id;
      usedIds.add(id);
    }

    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = `#${h.id}`;
    a.textContent = h.textContent;
    li.append(a);

    if (h.tagName === 'H2' || !lastTopLi) {
      list.append(li);
      lastTopLi = li;
    } else {
      let sub = lastTopLi.querySelector(':scope > ul');
      if (!sub) {
        sub = document.createElement('ul');
        lastTopLi.append(sub);
      }
      sub.append(li);
    }
  });

  const details = document.createElement('details');
  details.className = 'toc';
  details.open = true;
  const summary = document.createElement('summary');
  summary.textContent = 'On this page';
  details.append(summary, list);

  const nav = document.createElement('nav');
  nav.setAttribute('aria-label', 'On this page');
  nav.append(details);

  headings[0].before(nav);
})();
