/* Page interactions for ws.wickedagile.com: everything except the hero demo (demo.js).

   Rules every component here follows (criterion 6: interactions never disturb the layout):
   - Every state a component can reach is in the markup up front and stacked in one grid cell or a
     fixed-height box, so a step, a selection or a reveal changes opacity, colour or a transform
     inside that box and nothing else moves.
   - Scenes and tours run only while they are on screen, stop on hover and focus, and reset when they
     leave. Sections that loop carry a visible Pause button.
   - prefers-reduced-motion: no timers and no typing. Scenes show their final frame, tours stay where
     you put them, counters show their values.
   - Keyboard: every tablist has roving tabindex with arrows, Home and End. */
import 'wicked-web/scripts/scroll-wheel.js';

const reduceMq = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
const reduced = !!(reduceMq && reduceMq.matches);
// The motion preference changed while the page is open (either way): load the page again, so every
// component starts in the right mode. One mechanism, instead of settling each loop, timer and CSS
// effect by hand in both directions; the page holds nothing a visitor would lose.
if (reduceMq && reduceMq.addEventListener) reduceMq.addEventListener('change', () => { location.reload(); });
const $$ = (s, r = document) => Array.prototype.slice.call(r.querySelectorAll(s));

/* ── Wheel: one notch, one frame (wicked-web scroll-wheel.js), only where every frame snaps ──────
   The shared stepper listens on window. This capture-phase guard runs first and keeps it out of the
   way where it would do harm: outside the media in which studio.css turns mandatory snapping on
   (the same thresholds at which the shared platform band is itself a snap target), on pinch-zoom, and
   over an inner scroller that can still move in the wheel's direction (the demo's chat and diff). */
const SNAP_MEDIA = '(pointer: fine) and (min-width: 1260px) and (min-height: 660px), (pointer: fine) and (min-width: 941px) and (min-height: 760px)';
const snapMq = window.matchMedia(SNAP_MEDIA);
const html = document.documentElement;
/* Mandatory snapping is only safe while every frame fits. Text zoom, a long translation or a user
   stylesheet can make one taller than the window: then html.frames-overflow turns snapping off
   (studio.css) and the stepper and settle step stand down, so every line stays reachable. */
const barH = () => (document.querySelector('.topbar') || { offsetHeight: 0 }).offsetHeight;
const fitCheck = () => {
  const avail = window.innerHeight - barH();
  // a frame is too big when its box outgrows the window, or (the fixed-height hero) its content outgrows its box
  html.classList.toggle('frames-overflow', $$('.frame, .same-garden').some((el) =>
    el.getBoundingClientRect().height > avail + 1 || el.scrollHeight > el.clientHeight + 1));
};
const snapping = () => snapMq.matches && !html.classList.contains('frames-overflow');
fitCheck();
window.addEventListener('resize', fitCheck, { passive: true });
if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitCheck);
// observe the frames and what is inside them, so growth confined to a descendant is seen too
if ('ResizeObserver' in window) { const ro = new ResizeObserver(fitCheck); $$('.frame, .same-garden, .frame > .wrap, .hero-copy, .hero h1').forEach((el) => ro.observe(el)); }
window.addEventListener(
  'wheel',
  (e) => {
    if (!snapping() || e.ctrlKey) { e.stopImmediatePropagation(); return; }
    // a frame taller than the window keeps the wheel until its end is in view
    const bar = (document.querySelector('.topbar') || { offsetHeight: 0 }).offsetHeight;
    const here = $$('.frame, .same-garden').find((el) => { const r = el.getBoundingClientRect(); return r.top <= bar + 1 && r.bottom > bar + 1; });
    if (here) {
      const r = here.getBoundingClientRect();
      if (r.height > window.innerHeight - bar + 1 && ((e.deltaY > 0 && r.bottom > window.innerHeight + 1) || (e.deltaY < 0 && r.top < bar - 1))) {
        e.stopImmediatePropagation();
        return;
      }
    }
    for (let el = e.target; el && el.nodeType === 1 && el !== document.body; el = el.parentElement) {
      const cs = getComputedStyle(el);
      if (/(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1) {
        const down = e.deltaY > 0;
        if ((down && el.scrollTop + el.clientHeight < el.scrollHeight - 1) || (!down && el.scrollTop > 0)) {
          e.stopImmediatePropagation();
          return;
        }
      }
    }
  },
  { capture: true, passive: true },
);

/* ── Settle: a scroll never comes to rest between two frames ─────────────────────────────────
   Mandatory snapping should guarantee it, but Chromium can end an interrupted keyboard scroll (two
   quick arrow presses) between snap points and leave it there. When a scroll ends off every frame
   top, finish it to the next frame in the direction of travel. Same media as the snapping (frames all
   fit there, so any frame top shows a whole frame); never under reduced motion. */
(() => {
  if (reduced) return;
  let lastY = window.scrollY, dir = 1, timer = null;
  const tops = () => {
    const t = $$('.frame, .same-garden').map((el) => Math.round(el.getBoundingClientRect().top + window.scrollY - (parseInt(getComputedStyle(el).scrollMarginTop, 10) || 0)));
    t.push(document.documentElement.scrollHeight - window.innerHeight);
    return t.sort((a, b) => a - b);
  };
  const settle = () => {
    if (!snapping() || getComputedStyle(document.documentElement).scrollSnapType.indexOf('mandatory') < 0) return;
    const y = Math.round(window.scrollY), all = tops();
    if (all.some((t) => Math.abs(t - y) <= 2)) return;
    // A frame taller than the window (it should never happen where this runs) is read in place.
    const bar = (document.querySelector('.topbar') || { offsetHeight: 0 }).offsetHeight;
    const here = $$('.frame, .same-garden').find((el) => { const r = el.getBoundingClientRect(); return r.top <= bar + 1 && r.bottom > bar + 1; });
    if (here && here.getBoundingClientRect().height > window.innerHeight - bar + 1) return;
    const target = dir > 0 ? all.find((t) => t > y) : all.slice().reverse().find((t) => t < y);
    if (target != null) window.scrollTo({ top: target, behavior: 'smooth' });
  };
  // A keyboard scroll can report its end a frame early and stop short of a target: look once more
  // after the page has been still for a moment (only if nothing scrolled since).
  let lastMove = 0, again = null;
  const recheck = () => { clearTimeout(again); again = setTimeout(() => { if (performance.now() - lastMove >= 280) settle(); }, 300); };
  window.addEventListener('scroll', () => {
    const y = window.scrollY;
    if (y !== lastY) dir = y > lastY ? 1 : -1;
    lastY = y;
    lastMove = performance.now();
    if (!('onscrollend' in window)) { clearTimeout(timer); timer = setTimeout(() => { settle(); recheck(); }, 180); }
  }, { passive: true });
  if ('onscrollend' in window) window.addEventListener('scrollend', () => { settle(); recheck(); });
})();

/* ── helpers ─────────────────────────────────────────────────────────────────────────────── */
// "In view" is `ratio` of the element, or half the window for an element too tall to ever show that
// much (minimum font sizes and short windows make cards taller than the screen).
function inView(el, ratio, enter, leave) {
  if (!('IntersectionObserver' in window)) { enter(); return; }
  let on = false;
  const io = new IntersectionObserver(
    (es) => {
      es.forEach((x) => {
        const seen = x.intersectionRatio >= ratio - 0.001 || x.intersectionRect.height >= window.innerHeight * 0.5;
        if (!on && seen) { on = true; enter(); }
        else if (on && x.intersectionRatio < 0.12 && x.intersectionRect.height < window.innerHeight * 0.1) { on = false; if (leave) leave(); }
      });
    },
    { threshold: [0, 0.05, 0.12, 0.25, 0.4, 0.5, ratio, 0.75, 1] },
  );
  io.observe(el);
}
function hold(el, fn) {
  let hover = false, focus = false;
  const emit = () => fn(hover || focus);
  el.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') { hover = true; emit(); } });
  el.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') { hover = false; emit(); } });
  el.addEventListener('focusin', () => { focus = true; emit(); });
  el.addEventListener('focusout', (e) => { if (!el.contains(e.relatedTarget)) { focus = false; emit(); } });
}
// one hold over several boxes: held while the pointer is over any of them or focus is inside one
function holdAll(els, fn) {
  const on = new Set();
  els.forEach((el, k) => hold(el, (h) => { if (h) on.add(k); else on.delete(k); fn(on.size > 0); }));
}
function roving(list, tabs, { vertical, onMove }) {
  list.addEventListener('keydown', (e) => {
    const i = tabs.indexOf(document.activeElement);
    if (i < 0) return;
    let k = -1;
    if (e.key === 'ArrowRight' || (vertical && e.key === 'ArrowDown')) k = (i + 1) % tabs.length;
    else if (e.key === 'ArrowLeft' || (vertical && e.key === 'ArrowUp')) k = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') k = 0;
    else if (e.key === 'End') k = tabs.length - 1;
    if (k < 0) return;
    e.preventDefault();
    onMove(k);
    tabs[k].focus({ preventScroll: true });
  });
}
// Scroll a horizontal strip so a child is in view, without ever moving the page.
function revealInStrip(strip, child) {
  if (!strip || strip.scrollWidth <= strip.clientWidth + 1) return;
  const l = child.offsetLeft - strip.offsetLeft, r = l + child.offsetWidth;
  if (l < strip.scrollLeft) strip.scrollTo({ left: l - 8, behavior: reduced ? 'auto' : 'smooth' });
  else if (r > strip.scrollLeft + strip.clientWidth) strip.scrollTo({ left: r - strip.clientWidth + 8, behavior: reduced ? 'auto' : 'smooth' });
}

/* ── Copy buttons (hero chip + the install cards): "Copied" for 1.4 s ─────────────────────── */
const copyStatus = document.querySelector('[data-copy-status]');
$$('[data-copy]').forEach((b) => {
  const label = b.querySelector('[data-copy-label]') || b;
  let t = null;
  b.addEventListener('click', () => {
    const text = b.getAttribute('data-copy');
    if (!navigator.clipboard) return;
    navigator.clipboard.writeText(text).then(() => {
      label.textContent = 'Copied';
      b.classList.add('is-copied');
      if (copyStatus) copyStatus.textContent = 'Copied: ' + text.split('\n')[0];
      clearTimeout(t);
      t = setTimeout(() => { label.textContent = 'Copy'; b.classList.remove('is-copied'); if (copyStatus) copyStatus.textContent = ''; }, 1400);
    });
  });
});

/* ── "Watch a job": bring the demo into view and replay the job from its prompt ─────────────── */
$$('[data-watch]').forEach((a) => {
  a.addEventListener('click', (e) => {
    const ide = document.querySelector('[data-ide]');
    if (!ide) return;
    e.preventDefault();
    const r = ide.getBoundingClientRect();
    if (r.top < 64 || r.bottom > innerHeight) ide.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' });
    ide.dispatchEvent(new CustomEvent('demo:replay'));
  });
});

/* ── Autoplay groups: one Pause/Play per section ────────────────────────────────────────── */
function group(section) {
  const btn = section.querySelector('[data-play-toggle]');
  const g = { paused: false, players: [] };
  if (!btn) return g;
  if (reduced) { btn.hidden = true; return g; }
  const base = btn.getAttribute('aria-label') || '';
  g.set = (p) => {
    g.paused = p;
    btn.setAttribute('aria-pressed', p ? 'true' : 'false');
    // both labels are stacked in one cell (studio.css .pt-l), so the button never changes width
    btn.classList.toggle('is-paused', p);
    btn.setAttribute('aria-label', p ? base.replace(/^Pause/, 'Play') : base);
    g.players.forEach((pl) => pl.sync());
  };
  btn.addEventListener('click', () => g.set(!g.paused));
  return g;
}
// Nothing loops under reduced motion, so there is nothing to pause.
if (reduced) $$('[data-play-toggle]').forEach((b) => { b.hidden = true; });
const groups = new Map();
const groupOf = (el) => {
  const s = el.closest('[data-autoplay]');
  if (!s) return { paused: false, players: [], set() {} };
  if (!groups.has(s)) groups.set(s, group(s));
  return groups.get(s);
};

/* ── Scenes (the three benefits): stepped frames, looped while on screen ──────────────────── */
const SCENE_STEPS = {
  a: [250, 1100, 1300, 1600, 2800], // empty → your ask → planning → the plan → approved
  b: [250, 1500, 1200, 1000, 10000], // empty → the gate card → recommended picked → Confirm → the 10 s undo ring
  c: [250, 1000, 900, 1300, 2800], // empty → your sources → flowing → suggestions → two accepted
};
$$('[data-scene]').forEach((el) => {
  const steps = SCENE_STEPS[el.getAttribute('data-scene')];
  if (!steps) return;
  const last = steps.length - 1;
  if (reduced) return; // the markup is the final frame
  const g = groupOf(el);
  let step = 0, t = null, seen = false, held = false;
  // data-step is the exact frame; st-1..st-N are cumulative, so a part that arrives at step 2 stays.
  const show = (s) => {
    step = s;
    el.setAttribute('data-step', String(s));
    for (let k = 1; k <= last; k++) el.classList.toggle('st-' + k, k <= s);
  };
  const run = () => { t = setTimeout(() => { show(step === last ? 0 : step + 1); run(); }, steps[step]); };
  const player = {
    sync() {
      clearTimeout(t); t = null;
      const go = !reduced && seen && !held && !g.paused;
      el.classList.toggle('is-frozen', !go);
      if (go) run();
    },
  };
  g.players.push(player);
  show(0);
  hold(el.closest('.trio-card') || el, (h) => { held = h; player.sync(); });
  inView(el, 0.6, () => { seen = true; player.sync(); }, () => { seen = false; show(0); player.sync(); });
});

/* ── Tours (the sidebar explorer, What's new): auto-advance, hover/focus/click pins ────────── */
$$('[data-tour]').forEach((el) => {
  const tabs = $$('[role="tab"]', el);
  const panels = tabs.map((t) => document.getElementById(t.getAttribute('aria-controls')));
  const list = tabs[0] && tabs[0].parentElement;
  const vertical = list && list.getAttribute('aria-orientation') === 'vertical';
  const ms = parseInt(el.getAttribute('data-tour-ms'), 10) || 4000;
  const bar = el.querySelector('[data-tour-bar]');
  const g = groupOf(el);
  let i = Math.max(0, tabs.findIndex((t) => t.getAttribute('aria-selected') === 'true'));
  let t = null, seen = false, held = false;
  const select = (k) => {
    i = k;
    tabs.forEach((tb, j) => {
      const on = j === k;
      tb.classList.toggle('is-on', on);
      tb.setAttribute('aria-selected', on ? 'true' : 'false');
      tb.tabIndex = on ? 0 : -1;
      panels[j].classList.toggle('is-on', on);
    });
    revealInStrip(list, tabs[k]);
  };
  const barReset = (animate) => {
    if (!bar) return;
    bar.style.transition = 'none';
    bar.style.transform = 'scaleX(0)';
    if (animate) { void bar.offsetWidth; bar.style.transition = `transform ${ms}ms linear`; bar.style.transform = 'scaleX(1)'; }
  };
  const run = () => { barReset(true); t = setTimeout(() => { select((i + 1) % tabs.length); run(); }, ms); };
  const player = {
    sync() { clearTimeout(t); t = null; const go = !reduced && seen && !held && !g.paused; el.classList.toggle('is-still', !go); if (go) run(); else barReset(false); },
  };
  g.players.push(player);
  const pin = () => { if (!reduced && g.set && !g.paused) g.set(true); };
  tabs.forEach((tb, k) => {
    tb.addEventListener('click', () => { select(k); pin(); });
    // hover previews a page only in the sidebar list; a scrolling tab strip (narrow windows) moves only on a click
    tb.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse' && list.scrollWidth <= list.clientWidth + 1) select(k); });
  });
  roving(list, tabs, { vertical, onMove: (k) => { select(k); pin(); } });
  hold(el, (h) => { held = h; player.sync(); });
  inView(el, 0.6, () => { seen = true; player.sync(); }, () => { seen = false; player.sync(); });
});

/* ── The review relay: Builder → Reviewer → back → Reviewer → You, the receipt in step ───────
   It plays from the top each time it comes on screen and replays after a pause of HOLD. An automatic
   run steps only while it is live (on screen, not held by the pointer or focus on the relay, the
   receipt or the switch, not under the frame's Pause): otherwise it stops on its current step and
   carries on from there. A run you start (the switch, Replay) plays through. */
(() => {
  const sec = document.querySelector('[data-relay]');
  if (!sec) return;
  const relay = sec.querySelector('.relay');
  const receipt = sec.querySelector('.receipt');
  const sw = sec.querySelector('[data-relay-switch]');
  const replay = sec.querySelector('[data-relay-replay]');
  const rows = { b: relay.querySelector('.fl-b'), r: relay.querySelector('.fl-r'), y: relay.querySelector('.fl-y') };
  const trs = $$('tbody tr', receipt);
  // rows grow with their text (minimum font sizes): the track, the arc and the token follow the measured
  // centres. offsetTop/offsetHeight are in the relay's own CSS pixels, so a zoomed frame (big windows)
  // is not scaled twice (getBoundingClientRect is already zoomed).
  const measure = () => {
    ['b', 'r', 'y'].forEach((k) => { const r = rows[k]; relay.style.setProperty('--y' + k, Math.round(r.offsetTop + r.offsetHeight / 2) + 'px'); });
  };
  measure();
  if ('ResizeObserver' in window) new ResizeObserver(measure).observe(relay.querySelector('.flow'));
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);
  // lit row, token row, status shown in each row, receipt rows filled, return arc, stopped
  const TWO = [
    { lit: '', tok: '', s: {}, fill: 0 },
    { lit: 'b', tok: 'b', s: { b: 's1' }, fill: 1 },
    { lit: 'r', tok: 'r', s: { b: 's1', r: 's1' }, fill: 1 },
    { lit: 'b', tok: 'b', s: { b: 's2', r: 's1' }, fill: 1, arc: true },
    { lit: 'r', tok: 'r', s: { b: 's2', r: 's2' }, fill: 4, arc: true },
    { lit: 'y', tok: 'y', s: { b: 's2', r: 's2', y: 's2' }, fill: 5, arc: true },
  ];
  // one agent: the build runs, then the job holds at review for a distinct agent (it is not skipped)
  const ONE = [
    { lit: '', tok: '', s: {}, fill: 0 },
    { lit: 'b', tok: 'b', s: { b: 's1' }, fill: 1 },
    { lit: 'r', tok: 'r', s: { b: 's3', r: 's3' }, fill: 5, stop: true },
  ];
  const DELAY = [400, 900, 1000, 900, 900];
  const HOLD = 5200;
  const g = groupOf(sec);
  // k: the step on screen; run: true while a run has steps left; driven: you started this run
  let mode = 'two', k = -1, t = null, loop = null, run = false, driven = false, seen = false, held = false;
  const seq = () => (mode === 'two' ? TWO : ONE);
  const live = () => !reduced && seen && !held && !g.paused;
  const apply = (st) => {
    Object.keys(rows).forEach((key) => {
      rows[key].classList.toggle('is-lit', st.lit === key);
      rows[key].setAttribute('data-s', st.s[key] || '');
    });
    relay.setAttribute('data-tok', st.tok);
    relay.classList.toggle('has-arc', !!st.arc);
    relay.classList.toggle('is-stopped', !!st.stop);
    receipt.classList.toggle('is-stopped', !!st.stop);
    trs.forEach((tr) => tr.classList.toggle('is-filled', +tr.getAttribute('data-row') <= st.fill));
  };
  // one place decides what happens next: the next step, the next replay, or nothing
  const tick = () => {
    clearTimeout(t); t = null; clearTimeout(loop); loop = null;
    if (run) {
      if (!driven && !live()) return; // stopped on step k; tick() carries on when it is live again
      t = setTimeout(() => {
        k++;
        apply(seq()[k]);
        if (k >= seq().length - 1) { run = false; driven = false; }
        tick();
      }, DELAY[k]);
    } else if (live()) {
      loop = setTimeout(() => start(false), HOLD);
    }
  };
  const setMode = () => { relay.setAttribute('data-mode', mode); receipt.setAttribute('data-mode', mode); };
  function start(byYou) {
    setMode();
    if (reduced) { k = seq().length - 1; apply(seq()[k]); run = false; return; }
    k = 0; run = true; driven = byYou;
    apply(seq()[0]);
    tick();
  }
  sw.addEventListener('click', () => {
    mode = mode === 'two' ? 'one' : 'two';
    sw.setAttribute('aria-checked', mode === 'two' ? 'true' : 'false');
    start(true);
  });
  replay.addEventListener('click', () => start(true));
  // The final frame is the no-JS / reduced-motion state; motion starts from the empty one.
  if (reduced) { start(false); return; }
  g.players.push({ sync: tick });
  // held over the relay, the receipt and the switch; not over Pause or Replay, so Play resumes at once
  holdAll([relay, receipt, sw], (h) => { held = h; tick(); });
  apply(TWO[0]);
  // On screen: play from the top, or, under Pause, show the whole receipt instead of an empty one.
  inView(relay, 0.6, () => {
    seen = true;
    if (g.paused) { if (k < 0) { k = seq().length - 1; apply(seq()[k]); } tick(); }
    else start(false);
  }, () => { seen = false; tick(); });
})();

/* ── Rules / memory / knowledge drawers: each acts on its own sample, locally ───────────────── */
$$('[data-drawer]').forEach((card) => {
  const kind = card.getAttribute('data-drawer');
  const set = (s) => card.setAttribute('data-state', s);
  if (kind === 'rule') {
    // While the card waits for you, a new suggestion rotates into the slot every ROT ms (all three
    // are stacked in one cell, so the card never changes size). A decision stops it; Reset resumes.
    const ROT = 6000;
    const rules = $$('[data-rot] > .dr-rule', card);
    const g = groupOf(card);
    let ri = 0, rt = null, seen = false, held = false;
    const rotate = () => {
      clearTimeout(rt); rt = null;
      const go = !reduced && seen && !held && !g.paused && card.getAttribute('data-state') === 'in' && rules.length > 1;
      card.classList.toggle('is-still', !go); // the waiting card's glow runs only while it rotates
      if (!go) return;
      rt = setTimeout(() => {
        rules[ri].classList.remove('is-on');
        ri = (ri + 1) % rules.length;
        rules[ri].classList.add('is-on');
        rotate();
      }, ROT);
    };
    g.players.push({ sync: rotate });
    if (!reduced) {
      card.classList.add('is-pre');
      hold(card, (h) => { held = h; rotate(); });
      inView(card, 0.6, () => { card.classList.remove('is-pre'); seen = true; rotate(); }, () => { seen = false; rotate(); });
    }
    card.addEventListener('click', (e) => {
      const b = e.target.closest('[data-dr]');
      if (!b) return;
      const a = b.getAttribute('data-dr');
      const next = a === 'approve' ? 'ok' : a === 'later' ? 'later' : 'in';
      set(next);
      rotate();
      const target = card.querySelector(next === 'in' ? '.dr-s-in button' : `.dr-s-${next} button`);
      if (target) target.focus({ preventScroll: true });
    });
  } else if (kind === 'memory') {
    const text = card.querySelector('[data-mem-text]');
    const input = card.querySelector('[data-mem-input]');
    card.addEventListener('click', (e) => {
      const b = e.target.closest('[data-dr]');
      if (!b) return;
      const a = b.getAttribute('data-dr');
      if (a === 'edit') { set('edit'); input.value = text.textContent; input.tabIndex = 0; input.focus({ preventScroll: true }); input.select(); return; }
      if (a === 'save') {
        const v = input.value.trim();
        if (v) text.textContent = v;
        const scrolls = text.scrollHeight > text.clientHeight + 1;
        if (scrolls) { text.tabIndex = 0; text.setAttribute('role', 'region'); text.setAttribute('aria-label', 'The saved memory'); }
        else { text.removeAttribute('tabindex'); text.removeAttribute('role'); text.removeAttribute('aria-label'); }
      }
      input.tabIndex = -1;
      if (a === 'save' || a === 'cancel' || a === 'undo') { set('in'); card.querySelector(a === 'undo' ? '[data-dr="erase"]' : '[data-dr="edit"]').focus({ preventScroll: true }); }
      else if (a === 'erase') { set('gone'); card.querySelector('[data-dr="undo"]').focus({ preventScroll: true }); }
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); card.querySelector('[data-dr="save"]').click(); }
      else if (e.key === 'Escape') { e.preventDefault(); card.querySelector('[data-dr="cancel"]').click(); }
    });
  } else if (kind === 'know') {
    const chip = card.querySelector('[data-src]');
    const area = card.querySelector('.dr-slot--know');
    let pinned = false;
    const show = (on) => { card.classList.toggle('is-src', on); chip.setAttribute('aria-expanded', on ? 'true' : 'false'); };
    // the chip opens it; it stays open anywhere over the cited line and the source (one hover area, gap
    // included, so pointer speed never matters) and closes when the pointer leaves that area
    chip.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') show(true); });
    area.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && !pinned && document.activeElement !== chip) show(false); });
    chip.addEventListener('focus', () => show(true));
    chip.addEventListener('blur', () => { if (!pinned) show(false); });
    chip.addEventListener('click', () => { pinned = !pinned; show(pinned || document.activeElement === chip); });
  }
});

/* ── Agents: pick one, see its sandbox ─────────────────────────────────────────────────── */
(() => {
  const list = document.querySelector('[data-agents]');
  if (!list) return;
  const chips = $$('[role="radio"]', list);
  const name = document.querySelector('[data-agent-name]');
  const box = document.querySelector('.sandbox');
  const g = groupOf(list);
  let seen = false, held = false;
  const pick = (k) => {
    chips.forEach((c, j) => {
      const on = j === k;
      c.classList.toggle('is-on', on);
      c.setAttribute('aria-checked', on ? 'true' : 'false');
      c.tabIndex = on ? 0 : -1;
    });
    const who = chips[k].getAttribute('data-agent');
    name.textContent = who;
    // a Claude subscription's sign-in token is the one key a sandbox receives (both lines share a cell)
    if (box) box.toggleAttribute('data-sub', who === 'Claude Code');
    // the name swaps in; the hand-off restarts from the agent, but only while the sandbox is on screen
    if (!reduced && box) { box.classList.remove('is-swap', 'is-live'); void box.offsetWidth; box.classList.add('is-swap'); box.classList.toggle('is-live', seen); }
  };
  chips.forEach((c, k) => c.addEventListener('click', () => pick(k)));
  roving(list, chips, { vertical: true, onMove: pick });
  if (box && !reduced) {
    // the hand-off loops while on screen (is-live); it stills under the frame's Pause and while the
    // pointer or focus is on the agents card (is-still)
    const sync = () => box.classList.toggle('is-still', g.paused || held);
    g.players.push({ sync });
    hold(list.closest('.reach-card') || list, (h) => { held = h; sync(); });
    inView(box, 0.5, () => { seen = true; box.classList.add('is-live'); }, () => { seen = false; box.classList.remove('is-live'); });
  }
})();

/* ── Projects: the example search types its query, then the counts climb ───────────────────
   While it is live (on screen, not held by the pointer or focus on the card, not under the frame's
   Pause) it alternates between the example queries, a pause of HOLD after each count. When it stops
   being live it stops where it is (mid-word, mid-count) and carries on from there; each time it comes
   back on screen it starts again from the first query, or, under Pause, shows that query's result. */
(() => {
  const card = document.querySelector('[data-search]');
  if (!card || reduced) return;
  const q = card.querySelector('[data-q]');
  const cells = $$('[data-n]', card);
  const bars = $$('.hits-bar i', card);
  const cap = card.querySelector('[data-q-cap]');
  const total = card.querySelector('[data-total]');
  let queries = [];
  try { queries = JSON.parse(card.querySelector('[data-queries]').getAttribute('data-queries')); } catch (e) { queries = []; }
  if (!queries.length) queries = [{ q: q.textContent, n: cells.map((c) => +c.getAttribute('data-n')) }];
  const HOLD = 4200, TYPE = 70, CLIMB = 700;
  const g = groupOf(card);
  // phase: 'type' (i letters shown) → 'climb' (p of the way) → 'shown' (then HOLD) → the next query
  let qi = 0, phase = 'shown', i = 0, p = 0, timer = null, frame = 0, run = 0, seen = false, held = false;
  const live = () => seen && !held && !g.paused;
  const stop = () => { clearTimeout(timer); timer = null; cancelAnimationFrame(frame); frame = 0; run++; };
  const paint = () => {
    q.textContent = queries[qi].q.slice(0, i);
    cells.forEach((c) => { c.textContent = String(Math.round(p * +c.getAttribute('data-n'))); });
    // the summary waits for the counts, so the example never reads "8 hits" over a row of zeros
    card.classList.toggle('is-pre', phase === 'type');
    card.classList.toggle('is-done', phase !== 'type');
    card.classList.toggle('is-counted', phase === 'shown');
  };
  // load query k into the card: its word, its counts and bars, and its summary (hidden until counted)
  const load = (k) => {
    qi = k;
    const Q = queries[k];
    const max = Math.max(1, ...Q.n);
    cells.forEach((c, j) => c.setAttribute('data-n', String(Q.n[j] || 0)));
    bars.forEach((b, j) => b.style.setProperty('--w', String((Q.n[j] || 0) / max)));
    if (cap) cap.textContent = Q.q;
    if (total) total.textContent = String(Q.n.reduce((a, b) => a + b, 0));
  };
  const begin = (k) => { load(k); phase = 'type'; i = 0; p = 0; paint(); };
  const finish = (k) => { load(k); phase = 'shown'; i = queries[k].q.length; p = 1; paint(); };
  // one place decides what happens next, and only while the search is live
  const step = () => {
    stop();
    card.classList.toggle('is-still', !live()); // the caret's blink stops with the search
    if (!live()) return;
    const mine = run;
    if (phase === 'type') {
      timer = setTimeout(() => {
        if (mine !== run) return;
        i++;
        if (i >= queries[qi].q.length) { i = queries[qi].q.length; phase = 'climb'; }
        paint(); step();
      }, TYPE);
    } else if (phase === 'climb') {
      const t0 = performance.now() - p * CLIMB;
      const climb = (now) => {
        if (mine !== run) return;
        p = Math.min(1, (now - t0) / CLIMB);
        if (p >= 1) { phase = 'shown'; paint(); step(); return; }
        paint();
        frame = requestAnimationFrame(climb);
      };
      frame = requestAnimationFrame(climb);
    } else {
      timer = setTimeout(() => { if (mine !== run) return; begin((qi + 1) % queries.length); step(); }, HOLD);
    }
  };
  g.players.push({ sync: step });
  hold(card, (h) => { held = h; step(); });
  begin(0);
  inView(card, 0.6, () => {
    seen = true;
    if (g.paused) finish(0); else begin(0);
    step();
  }, () => { seen = false; stop(); begin(0); });
})();

/* ── Get it: the recommended command types itself in each time it comes on screen ─────────── */
(() => {
  const code = document.querySelector('[data-typed]');
  if (!code || reduced) return;
  const full = code.getAttribute('data-typed');
  let t = null;
  inView(code, 0.9, () => {
    clearInterval(t);
    let i = 0;
    code.textContent = '';
    code.classList.add('is-typing');
    t = setInterval(() => {
      i++;
      code.textContent = full.slice(0, i);
      if (i >= full.length) { clearInterval(t); t = null; code.classList.remove('is-typing'); }
    }, 45);
  }, () => { clearInterval(t); t = null; code.textContent = full; code.classList.remove('is-typing'); });
})();

/* ── Phones: swipe rows get dots and become keyboard-scrollable ────────────────────────── */
$$('[data-swipe]').forEach((row) => {
  const dots = $$('i', row.parentElement.querySelector('[data-swipe-dots]') || document.createElement('div'));
  const kids = Array.prototype.slice.call(row.children);
  const sync = () => {
    const scrolls = row.scrollWidth > row.clientWidth + 1;
    if (scrolls) { row.tabIndex = 0; row.setAttribute('role', 'group'); row.setAttribute('aria-label', 'What studio does for you: swipe or use the arrow keys'); }
    else { row.removeAttribute('tabindex'); row.removeAttribute('role'); row.removeAttribute('aria-label'); }
  };
  sync();
  window.addEventListener('resize', sync, { passive: true });
  if (!dots.length || !('IntersectionObserver' in window)) return;
  const io = new IntersectionObserver(
    (es) => es.forEach((x) => { if (x.intersectionRatio >= 0.6) { const k = kids.indexOf(x.target); dots.forEach((d, j) => d.classList.toggle('is-on', j === k)); } }),
    { root: row, threshold: [0.6] },
  );
  kids.forEach((k) => io.observe(k));
});
