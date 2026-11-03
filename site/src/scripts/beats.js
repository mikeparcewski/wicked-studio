/* The beat track and the thread, ported from wicked-crew (site/src/scripts/settle.js, beats()), so
 * every product site carries the same header thread and right-side track. Only the plane hue and the
 * beat list differ per site (the page's markup and its --beat-c); the rest is crew's.
 *
 * The track sits in the right gutter at 1400px and up and the thread under the topbar at 1024px and
 * up (the site CSS hides each below that, so neither can sit over content). The track marks the beat
 * in view (aria-current); each thread segment fills as its beat comes into view. Both fade out once
 * the page is past the last beat.
 *
 * Two additions to crew's version: a beat can span several sections in a row (every element with
 * data-beat="<id>", else the element with that id), and the track also stays hidden while the gutter
 * beside the content is too narrow to hold it (a wider content column, e.g. a zoomed frame), so it
 * never sits over content. Decoration only: nothing here scrolls, focuses or moves the page. */
const topbarH = () => { const b = document.querySelector('.topbar'); return b ? b.getBoundingClientRect().height : 64; };

(function beats() {
  const nav = document.querySelector('[data-beats]');
  const thread = document.querySelector('[data-beat-thread]');
  if (!nav && !thread) return;
  const links = nav ? Array.prototype.slice.call(nav.querySelectorAll('[data-beat-link]')) : [];
  const segEls = thread ? Array.prototype.slice.call(thread.querySelectorAll('[data-beat-thread-seg]')) : [];
  const ids = links.length ? links.map((a) => a.dataset.beatLink) : segEls.map((s) => s.dataset.beatThreadSeg);
  const secs = ids.map((id) => {
    const tagged = Array.prototype.slice.call(document.querySelectorAll('[data-beat="' + id + '"]'));
    if (tagged.length) return tagged;
    const el = document.getElementById(id);
    return el ? [el] : [];
  });
  const segs = segEls.map((s) => s.querySelector('b'));
  // the beat's box: from its first section's top to its last section's bottom
  function box(els) {
    if (!els.length) return null;
    const a = els[0].getBoundingClientRect(), z = els[els.length - 1].getBoundingClientRect();
    return { top: a.top, bottom: z.bottom, height: z.bottom - a.top };
  }
  // The track fits when all of it (its widest name, the dots, a focus ring) sits clear of the content:
  // the right edge of the topbar's row and of the site's content column (the nav's
  // data-beats-content selector), whichever reaches further, inner edge (padding excluded).
  let fits = true;
  function measure() {
    if (!nav) return;
    const w = nav.getBoundingClientRect().width;
    if (!w) { fits = true; return; }
    let edge = 0;
    const sel = '.topbar__inner' + (nav.dataset.beatsContent ? ', ' + nav.dataset.beatsContent : '');
    document.querySelectorAll(sel).forEach((el) => {
      const r = el.getBoundingClientRect();
      if (!r.width) return;
      const k = el.offsetWidth ? r.width / el.offsetWidth : 1; // a zoomed column reports zoomed boxes
      edge = Math.max(edge, r.right - (parseFloat(getComputedStyle(el).paddingRight) || 0) * k);
    });
    fits = window.innerWidth - 14 - w >= edge + 12;
  }
  let raf = 0;
  function paint() {
    raf = 0;
    const tb = topbarH(), vb = window.innerHeight;
    const mid = tb + (vb - tb) / 2;
    let cur = -1;
    secs.forEach((els, i) => {
      const r = box(els);
      if (!r) return;
      if (r.top <= mid && r.bottom > mid) cur = i;
      if (segs[i]) segs[i].style.setProperty('--f', Math.max(0, Math.min(1, (vb - r.top) / Math.max(1, r.height))).toFixed(3));
    });
    links.forEach((a, i) => { if (i === cur) a.setAttribute('aria-current', 'step'); else a.removeAttribute('aria-current'); });
    if (nav) nav.classList.toggle('is-on', cur >= 0 && fits);
    if (thread) thread.classList.toggle('is-on', cur >= 0);
  }
  const ask = () => { if (!raf) raf = requestAnimationFrame(paint); };
  window.addEventListener('scroll', ask, { passive: true });
  window.addEventListener('resize', () => { measure(); ask(); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { measure(); ask(); });
  measure();
  paint();
})();
