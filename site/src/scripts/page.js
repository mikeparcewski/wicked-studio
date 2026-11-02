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

const reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
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
  window.addEventListener('scroll', () => {
    const y = window.scrollY;
    if (y !== lastY) dir = y > lastY ? 1 : -1;
    lastY = y;
    if (!('onscrollend' in window)) { clearTimeout(timer); timer = setTimeout(settle, 180); }
  }, { passive: true });
  if ('onscrollend' in window) window.addEventListener('scrollend', settle);
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
  const label = btn.querySelector('[data-play-label]');
  const base = btn.getAttribute('aria-label') || '';
  g.set = (p) => {
    g.paused = p;
    btn.setAttribute('aria-pressed', p ? 'true' : 'false');
    btn.classList.toggle('is-paused', p);
    label.textContent = p ? 'Play' : 'Pause';
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
      const go = seen && !held && !g.paused;
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
    sync() { clearTimeout(t); t = null; const go = !reduced && seen && !held && !g.paused; if (go) run(); else barReset(false); },
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

/* ── The review relay: Builder → Reviewer → back → Reviewer → You, the receipt in step ─────── */
(() => {
  const sec = document.querySelector('[data-relay]');
  if (!sec) return;
  const relay = sec.querySelector('.relay');
  const receipt = sec.querySelector('.receipt');
  const sw = sec.querySelector('[data-relay-switch]');
  const replay = sec.querySelector('[data-relay-replay]');
  const rows = { b: relay.querySelector('.fl-b'), r: relay.querySelector('.fl-r'), y: relay.querySelector('.fl-y') };
  const trs = $$('tbody tr', receipt);
  // rows grow with their text (minimum font sizes): the track, the arc and the token follow the measured centres
  const measure = () => {
    const base = relay.getBoundingClientRect().top;
    ['b', 'r', 'y'].forEach((k) => { const r = rows[k].getBoundingClientRect(); relay.style.setProperty('--y' + k, Math.round(r.top - base + r.height / 2) + 'px'); });
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
  const ONE = [
    { lit: '', tok: '', s: {}, fill: 0 },
    { lit: 'b', tok: 'b', s: { b: 's1' }, fill: 1 },
    { lit: 'r', tok: 'r', s: { b: 's1', r: 's3' }, fill: 5, stop: true },
  ];
  const DELAY = [400, 900, 1000, 900, 900];
  let mode = 'two', t = null, played = false;
  const apply = (st) => {
    Object.keys(rows).forEach((k) => {
      rows[k].classList.toggle('is-lit', st.lit === k);
      rows[k].setAttribute('data-s', st.s[k] || '');
    });
    relay.setAttribute('data-tok', st.tok);
    relay.classList.toggle('has-arc', !!st.arc);
    relay.classList.toggle('is-stopped', !!st.stop);
    receipt.classList.toggle('is-stopped', !!st.stop);
    trs.forEach((tr) => tr.classList.toggle('is-filled', +tr.getAttribute('data-row') <= st.fill));
  };
  const play = () => {
    clearTimeout(t);
    const seq = mode === 'two' ? TWO : ONE;
    relay.setAttribute('data-mode', mode);
    receipt.setAttribute('data-mode', mode);
    if (reduced) { apply(seq[seq.length - 1]); return; }
    let k = 0;
    const next = () => { apply(seq[k]); if (k < seq.length - 1) { t = setTimeout(() => { k++; next(); }, DELAY[k]); } };
    next();
  };
  sw.addEventListener('click', () => {
    mode = mode === 'two' ? 'one' : 'two';
    sw.setAttribute('aria-checked', mode === 'two' ? 'true' : 'false');
    play();
  });
  replay.addEventListener('click', play);
  // The final frame is the no-JS / reduced-motion state; motion starts from the empty one.
  if (reduced) { play(); return; }
  apply(TWO[0]);
  inView(relay, 0.6, () => { if (!played) { played = true; play(); } });
})();

/* ── Rules / memory / knowledge drawers: each acts on its own sample, locally ───────────────── */
$$('[data-drawer]').forEach((card) => {
  const kind = card.getAttribute('data-drawer');
  const set = (s) => card.setAttribute('data-state', s);
  if (kind === 'rule') {
    if (!reduced) { card.classList.add('is-pre'); inView(card, 0.6, () => card.classList.remove('is-pre')); }
    card.addEventListener('click', (e) => {
      const b = e.target.closest('[data-dr]');
      if (!b) return;
      const a = b.getAttribute('data-dr');
      const next = a === 'approve' ? 'ok' : a === 'later' ? 'later' : 'in';
      set(next);
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
  const pick = (k) => {
    chips.forEach((c, j) => {
      const on = j === k;
      c.classList.toggle('is-on', on);
      c.setAttribute('aria-checked', on ? 'true' : 'false');
      c.tabIndex = on ? 0 : -1;
    });
    name.textContent = chips[k].getAttribute('data-agent');
    if (!reduced && box) { box.classList.remove('is-swap', 'is-live'); void box.offsetWidth; box.classList.add('is-swap', 'is-live'); }
  };
  chips.forEach((c, k) => c.addEventListener('click', () => pick(k)));
  roving(list, chips, { vertical: true, onMove: pick });
  if (box && !reduced) inView(box, 0.5, () => box.classList.add('is-live'), () => box.classList.remove('is-live'));
})();

/* ── Projects: the example search types its query, then the counts climb ───────────────────── */
(() => {
  const card = document.querySelector('[data-search]');
  if (!card || reduced) return;
  const q = card.querySelector('[data-q]');
  const cells = $$('[data-n]', card);
  const word = q.textContent;
  let timer = null, frame = 0, run = 0; // run: a play's generation; a stale climb never touches the card
  const reset = () => {
    run++;
    clearInterval(timer);
    cancelAnimationFrame(frame);
    q.textContent = '';
    cells.forEach((c) => { c.textContent = '0'; });
    card.classList.remove('is-done', 'is-counted');
    card.classList.add('is-pre');
  };
  const play = () => {
    reset();
    const mine = run;
    let i = 0;
    timer = setInterval(() => {
      i++;
      q.textContent = word.slice(0, i);
      if (i < word.length) return;
      clearInterval(timer);
      card.classList.remove('is-pre');
      card.classList.add('is-done');
      const t0 = performance.now();
      const climb = (now) => {
        if (mine !== run) return;
        const p = Math.min(1, (now - t0) / 700);
        cells.forEach((c) => { c.textContent = String(Math.round(p * +c.getAttribute('data-n'))); });
        if (p < 1) frame = requestAnimationFrame(climb);
        else card.classList.add('is-counted'); // the total shows only once the rows add up to it
      };
      frame = requestAnimationFrame(climb);
    }, 70);
  };
  reset();
  inView(card, 0.6, play, reset);
})();

/* ── Get it: the recommended command types itself in once ───────────────────────────────── */
(() => {
  const code = document.querySelector('[data-typed]');
  if (!code || reduced) return;
  const full = code.getAttribute('data-typed');
  let done = false;
  inView(code, 0.9, () => {
    if (done) return;
    done = true;
    let i = 0;
    code.textContent = '';
    code.classList.add('is-typing');
    const t = setInterval(() => {
      i++;
      code.textContent = full.slice(0, i);
      if (i >= full.length) { clearInterval(t); code.classList.remove('is-typing'); }
    }, 45);
  });
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
