/* The hero demo: three jobs, model-driven. Every render reads the model; timers only append.
   Scripted, not live: it never calls a daemon. Under prefers-reduced-motion there are no timers and
   no typing: every step lands its outcome at once.

   Motion: while the demo is on screen, a background job (Move CI to Node 22) runs to done on its
   own, and the status dots and the card waiting on you pulse. The Pause button in the title bar
   (and leaving the screen) stills all of it: the background job stops between steps and the
   pulses stop (studio.css .ide.is-still). Your own decisions always play out.

   Keyboard: the thread is re-rendered with innerHTML, so a decision would drop focus to <body>.
   Every render that removes the focused control hands focus to the newest decision card's first
   action, or to the thread itself (tabindex=-1). The rail and the side-panel tabs are tablists with
   roving tabindex and arrow keys. */
(function () {
  var root = document.querySelector('[data-ide]');
  if (!root) return;
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var $ = function (s) { return root.querySelector(s); };
  var threadEl = $('[data-thread]'), stepsEl = $('[data-steps]'), titleEl = $('[data-title]');
  var sessionsEl = $('[data-sessions]'), paneEl = $('[data-pane]'), needsEl = $('[data-needs]');
  var filesEl = $('[data-files]'), form = $('[data-composer]'), input = $('[data-input]'), mainEl = $('#ide-main');
  var STEPS = ['Plan', 'Build', 'Review', 'Test', 'Deliver'];
  var PROMPT = input.value;

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  // ── the model ───────────────────────────────────────────────────────
  var FILES_V1 = [
    { path: 'src/http/rateLimit.ts', add: 41, del: 0, diff: [
      ['+', 'export function rateLimit(opts: { perMinute: number }) {'],
      ['+', '  const buckets = new Map<string, Bucket>();'],
      ['+', '  return (req, res, next) => {'],
      ['+', '    const key = req.ip;'],
      ['+', '    if (!take(buckets, key, opts.perMinute)) return res.status(429).end();'] ] },
    { path: 'src/http/router.ts', add: 3, del: 1, diff: [
      [' ', "import { publicRoutes } from './public';"],
      ['-', "app.use('/v1', publicRoutes);"],
      ['+', "app.use('/v1', rateLimit({ perMinute: 100 }), publicRoutes);"] ] },
    { path: 'test/rateLimit.test.ts', add: 28, del: 0, diff: [
      ['+', "it('returns 429 after 100 requests in a minute', async () => {"],
      ['+', '  await hit(100);'],
      ['+', '  expect((await hit(1)).status).toBe(429);'] ] }
  ];
  var FILES_V2 = FILES_V1.map(function (f) { return f; });
  FILES_V2[0] = { path: 'src/http/rateLimit.ts', add: 44, del: 0, diff: [
    ['+', 'export function rateLimit(opts: { perMinute: number }) {'],
    ['+', '  const buckets = new Map<string, Bucket>();'],
    ['+', '  return (req, res, next) => {'],
    ['+', "    const key = req.header('x-api-key') ?? req.ip;"],
    ['+', '    if (!take(buckets, key, opts.perMinute)) return res.status(429).end();'] ] };
  FILES_V2[2] = { path: 'test/rateLimit.test.ts', add: 39, del: 0, diff: [
    ['+', "it('limits each API key on its own', async () => {"],
    ['+', "  await hit(100, { key: 'a' });"],
    ['+', "  expect((await hit(1, { key: 'b' })).status).toBe(200);"] ] };

  function fresh() {
    return {
      rate: { title: 'Rate limits for the public API', short: 'Rate limits', who: 'Claude Code', state: 'draft', steps: 0, msgs: [], files: [], openFile: 0, receipt: null },
      flaky: { title: 'Fix the flaky checkout test', short: 'Flaky test', who: 'Codex', state: 'ask', steps: 1, msgs: [
        { k: 'user', t: 'The checkout test fails about once a week. Find out why and fix it.' },
        { k: 'agent', who: 'Codex', t: 'Found it: the test reads the real clock, so it fails whenever a run crosses midnight UTC.' },
        { k: 'ask', who: 'Codex', q: 'Freeze the clock in the test, or pass a clock into the checkout service?', opts: ['Freeze it in the test', 'Pass a clock in'], ans: null }
      ], files: [], openFile: 0, receipt: null },
      node: { title: 'Move CI to Node 22', short: 'Node 22', who: 'GitHub Copilot', state: 'done', steps: 5, msgs: [
        { k: 'user', t: 'Move CI and the engines field to Node 22.' },
        { k: 'agent', who: 'GitHub Copilot', t: 'Updated the CI matrix and the engines field. Nothing else needed changing.' },
        { k: 'agent', who: 'GitHub Copilot', done: true, t: 'Done. Tests pass (212), and claude reviewed and approved it. Pull request #9 is open.', chips: ['Pull request #9', 'Changes', 'Evidence'] }
      ], files: [
        { path: '.github/workflows/ci.yml', add: 1, del: 1, diff: [['-', '        node: [20]'], ['+', '        node: [22]']] },
        { path: 'package.json', add: 1, del: 1, diff: [['-', '    "node": ">=20"'], ['+', '    "node": ">=22"']] }
      ], openFile: 0, receipt: { built: 'GitHub Copilot', reviewed: 'Claude Code', tests: '212 pass', decision: 'approved by the reviewer' } }
    };
  }
  var S = fresh();
  // The background job: under motion it starts at its Test step and finishes by itself. The final
  // message is kept aside and posted at the end; under reduced motion it is done from the start.
  var NODE_DONE = S.node.msgs[2], NODE_RECEIPT = S.node.receipt;
  if (!reduced) {
    S.node.state = 'run'; S.node.steps = 3;
    S.node.msgs = S.node.msgs.slice(0, 2).concat([{ k: 'working', t: 'Working on Test…' }]);
    S.node.receipt = { built: 'GitHub Copilot', reviewed: 'Claude Code' };
  }
  var BG = [
    { ms: 4000, go: function () { var n = S.node; n.receipt.tests = '212 pass'; push('node', { k: 'event', t: 'Tests pass (212).' }); n.steps = 4; work('node', 'Working on Deliver…'); } },
    { ms: 4000, go: function () { var n = S.node; n.state = 'done'; n.steps = 5; n.receipt = NODE_RECEIPT; push('node', NODE_DONE); } }
  ];
  var bgAt = 0, bgTimer = null, paused = false, onScreen = false;
  var ORDER = ['rate', 'flaky', 'node'];
  var cur = 'rate';
  var pane = 'changes';
  var timers = [];
  var userTouched = false;
  var typing = null, typingPost = null, typingGen = 0;
  var lastNeeds = -1;

  function later(ms, fn) { if (reduced) { fn(); return; } timers.push(setTimeout(fn, ms)); }
  // still = paused or off screen: the background job waits between steps, and the pulses stop
  function bgSync() {
    var still = paused || !onScreen;
    root.classList.toggle('is-still', still);
    if (still) { clearTimeout(bgTimer); bgTimer = null; return; }
    if (bgTimer || bgAt >= BG.length || reduced) return;
    bgTimer = setTimeout(function () { bgTimer = null; BG[bgAt++].go(); bgSync(); }, BG[bgAt].ms);
  }
  var pauseBtn = root.querySelector('[data-demo-pause]');
  if (pauseBtn) {
    var pauseName = pauseBtn.getAttribute('aria-label') || '';
    if (reduced) pauseBtn.hidden = true;
    pauseBtn.addEventListener('click', function () {
      paused = !paused;
      pauseBtn.setAttribute('aria-pressed', paused ? 'true' : 'false');
      pauseBtn.classList.toggle('is-paused', paused);
      pauseBtn.setAttribute('aria-label', paused ? pauseName.replace(/^Pause/, 'Play') : pauseName);
      bgSync();
    });
  }
  function clearTimers() { timers.forEach(clearTimeout); timers = []; stopTyping(); }
  function focusQuiet(el) { if (!el) return; try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); } }

  // ── rendering ───────────────────────────────────────────────────────
  function statusOf(s) {
    if (s.state === 'draft') return { cls: 'idle', t: 'Not started' };
    if (s.state === 'plan' || s.state === 'gate' || s.state === 'ask') return { cls: 'you', t: 'Waiting on you' };
    if (s.state === 'done') return { cls: 'done', t: 'Done' };
    return { cls: 'run', t: s.who + ' working' };
  }
  function renderRail() {
    var needs = 0;
    var focusedId = sessionsEl.contains(document.activeElement) ? document.activeElement.getAttribute('data-id') : null;
    sessionsEl.innerHTML = ORDER.map(function (id) {
      var s = S[id], st = statusOf(s), on = id === cur;
      if (st.cls === 'you') needs++;
      return '<button type="button" role="tab" id="ide-tab-' + id + '" class="ide-sess' + (on ? ' is-on' : '') + '" aria-selected="' + on +
        '" aria-controls="ide-main" aria-label="' + esc(s.title + ', ' + st.t) + '" tabindex="' + (on ? '0' : '-1') + '" data-act="open" data-id="' + id + '">' +
        '<span class="dot dot--' + st.cls + '" aria-hidden="true"></span>' +
        '<span class="ide-sess-t"><span class="ide-sess-full">' + esc(s.title) + '</span><span class="ide-sess-short" aria-hidden="true">' + esc(s.short) + '</span></span>' +
        '<span class="ide-sess-s">' + esc(st.t) + '</span></button>';
    }).join('');
    if (focusedId) focusQuiet(sessionsEl.querySelector('[data-id="' + focusedId + '"]'));
    mainEl.setAttribute('aria-labelledby', 'ide-tab-' + cur);
    needsEl.textContent = String(needs);
    if (lastNeeds !== -1 && needs !== lastNeeds && !reduced) {
      needsEl.classList.remove('is-tick'); void needsEl.offsetWidth; needsEl.classList.add('is-tick');
    }
    lastNeeds = needs;
  }
  function renderSteps() {
    var s = S[cur], st = statusOf(s);
    stepsEl.innerHTML = STEPS.map(function (name, i) {
      var cls = i < s.steps ? 'done' : (i === s.steps && s.state !== 'draft' && s.state !== 'done' ? 'now now--' + st.cls : '');
      return '<li class="' + cls + '">' + name + '</li>';
    }).join('');
    titleEl.textContent = s.title;
  }
  function bubble(m, live) {
    var liveCls = live ? ' is-live' : '';
    if (m.k === 'user') return '<div class="msg msg--user"><p>' + esc(m.t) + '</p></div>';
    if (m.k === 'event') return '<p class="msg-event">' + m.t + '</p>';
    if (m.k === 'working') return '<p class="msg-working" data-working><span class="pulse" aria-hidden="true"></span>' + esc(m.t) + '</p>';
    var head = '<span class="msg-who">' + esc(m.who) + '</span>';
    if (m.k === 'agent') {
      var chips = m.chips ? '<div class="msg-chips">' + m.chips.map(function (c) {
        var act = c === 'Changes' ? 'changes' : (c === 'Evidence' ? 'receipt' : '');
        return act ? '<button type="button" class="chip" data-act="pane" data-pane="' + act + '">' + c + '</button>' : '<span class="chip chip--pr">' + c + '</span>';
      }).join('') + '</div>' : '';
      return '<div class="msg msg--agent' + (m.done ? ' msg--done' : '') + '">' + head + '<p>' + m.t + '</p>' + chips + '</div>';
    }
    if (m.k === 'plan') {
      var items = '<ol class="plan">' + m.items.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ol>';
      var acts = m.state === 'open'
        ? '<div class="acts"><button type="button" class="btn-yes" data-act="plan-ok">Approve plan</button><button type="button" class="btn-q" data-act="plan-later">Not now</button></div>'
        : '<p class="decided">' + (m.state === 'ok' ? 'You approved the plan.' : 'Parked. Nothing has started.') + '</p>' +
          (m.state === 'later' ? '<div class="acts"><button type="button" class="btn-yes" data-act="plan-ok">Approve plan</button></div>' : '');
      return '<div class="msg msg--agent msg--card' + liveCls + '">' + head + '<p>Here is my plan. Nothing starts until you approve it.</p>' + items + acts + '</div>';
    }
    if (m.k === 'gate') {
      var body;
      if (m.state === 'open') {
        body = '<div class="acts"><button type="button" class="btn-yes" data-act="gate-ok">Approve</button>' +
          '<button type="button" class="btn-q" data-act="gate-note">Approve with a note for the next step</button>' +
          '<button type="button" class="btn-q" data-act="gate-back">Send back</button></div>';
      } else if (m.state === 'noting') {
        body = '<div class="note-row"><input type="text" data-note aria-label="Your note for the next step" value="Track per-key limits in a follow-up issue." />' +
          '<button type="button" class="btn-yes" data-act="gate-note-send">Approve with note</button></div>';
      } else {
        body = '<p class="decided">' + esc(m.decided) + '</p>';
      }
      return '<div class="msg msg--agent msg--card msg--gate' + liveCls + '">' + head + '<p>' + m.t + '</p><p class="held">This step is held for you.</p>' + body + '</div>';
    }
    if (m.k === 'ask') {
      var ans = m.ans === null
        ? '<div class="acts">' + m.opts.map(function (o, i) { return '<button type="button" class="' + (i === 0 ? 'btn-yes' : 'btn-q') + '" data-act="answer" data-i="' + i + '">' + esc(o) + '</button>'; }).join('') + '</div>'
        : '<p class="decided">You answered: ' + esc(m.opts[m.ans]) + '</p>';
      return '<div class="msg msg--agent msg--card msg--ask' + liveCls + '"><span class="msg-who">' + esc(m.who) + ' · is asking</span><p>' + esc(m.q) + '</p>' + ans + '</div>';
    }
    return '';
  }
  function isOpenCard(m) {
    return (m.k === 'plan' && (m.state === 'open' || m.state === 'later')) ||
      (m.k === 'gate' && (m.state === 'open' || m.state === 'noting')) ||
      (m.k === 'ask' && m.ans === null);
  }
  function renderThread(keepScroll) {
    var s = S[cur];
    var ae = document.activeElement;
    var hadFocus = ae && (ae === threadEl || threadEl.contains(ae));
    if (!s.msgs.length) {
      threadEl.innerHTML = '<div class="empty"><p><b>New job.</b> Say what you want in plain words. You get a plan to approve before anything starts.</p></div>';
    } else {
      var lastOpen = -1;
      s.msgs.forEach(function (m, i) { if (isOpenCard(m)) lastOpen = i; });
      threadEl.innerHTML = s.msgs.map(function (m, i) { return bubble(m, i === lastOpen); }).join('');
    }
    if (!keepScroll) threadEl.scrollTop = threadEl.scrollHeight;
    // Hand focus on: the control that had it is gone. The note field keeps its own focus logic.
    if (hadFocus && !threadEl.querySelector('[data-note]')) {
      var live = threadEl.querySelector('.is-live .acts button');
      focusQuiet(live || threadEl);
    }
  }
  function renderPane() {
    var s = S[cur];
    var ae = document.activeElement, inPane = paneEl.contains(ae);
    var focusedFile = inPane ? ae.getAttribute('data-i') : null;
    var focusedDiff = inPane && ae.classList && ae.classList.contains('diff');
    root.querySelectorAll('[data-pane-tab]').forEach(function (b) {
      var on = b.getAttribute('data-pane-tab') === pane;
      b.classList.toggle('is-on', on); b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.setAttribute('tabindex', on ? '0' : '-1');
      if (on) paneEl.setAttribute('aria-labelledby', b.id);
    });
    filesEl.textContent = String(s.files.length);
    if (pane === 'changes') {
      if (!s.files.length) {
        paneEl.innerHTML = '<p class="pane-empty">Nothing changed yet. Files show up here as the agents write them.</p>';
        if (inPane) focusQuiet(root.querySelector('[data-pane-tab="' + pane + '"]'));
        return;
      }
      var f = s.files[Math.min(s.openFile, s.files.length - 1)];
      paneEl.innerHTML = '<ul class="files">' + s.files.map(function (x, i) {
        return '<li><button type="button" class="file' + (x === f ? ' is-on' : '') + '" data-act="file" data-i="' + i + '"><span>' + esc(x.path) + '</span>' +
          '<span class="n"><i class="a">+' + x.add + '</i> <i class="d">−' + x.del + '</i></span></button></li>';
      }).join('') + '</ul><pre class="diff" tabindex="0" aria-label="Diff of ' + esc(f.path) + '">' + f.diff.map(function (l) {
        return '<span class="dl dl--' + (l[0] === '+' ? 'a' : l[0] === '-' ? 'd' : 'c') + '">' + esc(l[0] + ' ' + l[1]) + '</span>';
      }).join('') + '</pre>';
      if (focusedFile !== null) focusQuiet(paneEl.querySelector('[data-i="' + focusedFile + '"]'));
      else if (focusedDiff) focusQuiet(paneEl.querySelector('.diff'));
    } else {
      var r = s.receipt;
      if (!r) { paneEl.innerHTML = '<p class="pane-empty">The receipt fills in as the job runs: what was required, what ran, and who checked it.</p>'; if (inPane) focusQuiet(root.querySelector('[data-pane-tab="' + pane + '"]')); return; }
      paneEl.innerHTML = '<table class="rc"><tbody>' +
        '<tr><th>Required</th><td>tests pass, a different agent reviews</td></tr>' +
        '<tr><th>Built by</th><td>' + esc(r.built) + '</td></tr>' +
        '<tr><th>Reviewed by</th><td>' + esc(r.reviewed || 'pending') + (r.reviewed ? ' <span class="ok">separate agent</span>' : '') + '</td></tr>' +
        '<tr><th>Tests</th><td>' + esc(r.tests || 'pending') + '</td></tr>' +
        '<tr><th>Decision</th><td>' + esc(r.decision || 'pending') + '</td></tr>' +
        '<tr><th>Skipped</th><td>nothing</td></tr></tbody></table>';
    }
    if (inPane && !paneEl.contains(document.activeElement)) focusQuiet(root.querySelector('[data-pane-tab="' + pane + '"]'));
  }
  function renderAll(keepScroll) { renderRail(); renderSteps(); renderThread(keepScroll); renderPane(); }
  function refresh(id) { if (id === cur) renderAll(); else renderRail(); }

  // ── the scripted run (job "rate") ───────────────────────────────────
  function push(id, m) { var s = S[id]; s.msgs = s.msgs.filter(function (x) { return x.k !== 'working'; }); if (m) s.msgs.push(m); refresh(id); }
  function work(id, text) { push(id, { k: 'working', t: text }); }

  function start(text) {
    var s = S.rate;
    s.state = 'plan-wait';
    push('rate', { k: 'user', t: text });
    if (text !== PROMPT) push('rate', { k: 'event', t: 'This demo replays one recorded job: rate limits for the public API.' });
    work('rate', 'Claude Code is planning…');
    later(1100, function () {
      s.state = 'plan';
      push('rate', { k: 'plan', who: 'Claude Code', state: 'open', items: [
        'Build: add a rate-limit middleware to the public routes',
        'Review: <b>Codex</b> checks it, not me',
        'Test: run the suite',
        'Deliver: open a pull request'] });
    });
  }
  function planDecision(ok) {
    var s = S.rate, plan = s.msgs.filter(function (m) { return m.k === 'plan'; })[0];
    if (!plan) return;
    plan.state = ok ? 'ok' : 'later';
    if (!ok) { refresh('rate'); return; }
    s.state = 'run'; s.steps = 1; s.receipt = { built: 'Claude Code' };
    work('rate', 'Working on Build…');
    later(1500, function () {
      s.files = FILES_V1; s.openFile = 0;
      push('rate', { k: 'agent', who: 'Claude Code', t: 'Build done. Added a rate-limit middleware and put it in front of the public routes, with a test. 3 files changed.', chips: ['Changes'] });
      s.steps = 2;
      work('rate', 'Codex is reviewing…');
      later(1400, function () {
        s.state = 'gate';
        push('rate', { k: 'gate', who: 'Codex', state: 'open', t: 'One finding: the limit is keyed on the client IP, but you asked for a limit <b>per API key</b>. Clients behind one proxy would share a limit.' });
      });
    });
  }
  function finish(decision, finalText) {
    var s = S.rate;
    s.state = 'run'; s.steps = 3;
    work('rate', 'Working on Test…');
    later(1200, function () {
      s.receipt.tests = '38 pass';
      push('rate', { k: 'event', t: 'Tests pass (38).' });
      s.steps = 4;
      work('rate', 'Working on Deliver…');
      later(900, function () {
        s.state = 'done'; s.steps = 5; s.receipt.decision = decision;
        push('rate', { k: 'agent', who: 'Claude Code', done: true, t: finalText, chips: ['Pull request #12', 'Changes', 'Evidence'] });
      });
    });
  }
  function gateDecision(kind, note) {
    var s = S.rate, gate = s.msgs.filter(function (m) { return m.k === 'gate'; }).pop();
    if (!gate || (gate.state !== 'open' && gate.state !== 'noting')) return;
    if (kind === 'note-open') { gate.state = 'noting'; refresh('rate'); var n = threadEl.querySelector('[data-note]'); if (n) { focusQuiet(n); n.select(); } return; }
    s.receipt.reviewed = 'Codex';
    if (kind === 'ok') {
      gate.state = 'done'; gate.decided = 'You approved over the finding. That is on the record as your call.';
      finish('approved by you over a review finding', 'Done. Tests pass (38). You approved over Codex’s finding, and the receipt says so. Pull request #12 is open.');
    } else if (kind === 'note') {
      gate.state = 'done'; gate.decided = 'You approved. Your note goes to the next step: “' + note + '”';
      finish('approved by you, with a note', 'Done. Tests pass (38). You approved with a note, and it rides with the delivery. Pull request #12 is open.');
    } else if (kind === 'back') {
      gate.state = 'done'; gate.decided = 'You sent it back to Claude Code with the finding.';
      s.state = 'run'; s.steps = 1;
      work('rate', 'Working on Build…');
      later(1400, function () {
        s.files = FILES_V2;
        push('rate', { k: 'agent', who: 'Claude Code', t: 'Fixed. The limit is now per API key, with the client IP only for requests that carry no key.', chips: ['Changes'] });
        s.steps = 2;
        work('rate', 'Codex is reviewing…');
        later(1200, function () {
          push('rate', { k: 'agent', who: 'Codex', t: 'Approved. Keyed on the API key now, and the new test covers two keys.' });
          finish('approved by Codex after one send-back', 'Done. Tests pass (38), and codex reviewed and approved it. Pull request #12 is open.');
        });
      });
    }
  }
  function answer(i) {
    var s = S.flaky, ask = s.msgs.filter(function (m) { return m.k === 'ask'; })[0];
    if (!ask || ask.ans !== null) return;
    ask.ans = i; s.state = 'run'; s.receipt = { built: 'Codex' };
    work('flaky', 'Working on Build…');
    later(1400, function () {
      s.files = [{ path: 'test/checkout.test.ts', add: 4, del: 1, diff: i === 0
        ? [['-', '  const now = new Date();'], ['+', "  vi.setSystemTime(new Date('2026-01-01T23:59:30Z'));"], ['+', '  const now = new Date();']]
        : [['-', '  const now = new Date();'], ['+', '  const now = clock.now();']] }];
      s.steps = 2;
      push('flaky', { k: 'agent', who: 'Codex', t: 'Build done. Claude Code reviews it next.', chips: ['Changes'] });
      s.who = 'Claude Code';
      work('flaky', 'Claude Code is reviewing…');
    });
  }

  // ── the prompt types itself in (about 1.2 s), then posts ─────────────
  // A typing run belongs to one generation: switching jobs, focusing the composer, New job or a
  // replay starts a new generation, which cancels both the typing and its pending post.
  function stopTyping() {
    typingGen++;
    if (typing) { clearInterval(typing); typing = null; }
    if (typingPost) { clearTimeout(typingPost); typingPost = null; }
    root.classList.remove('is-typing');
  }
  function typeThenStart() {
    if (reduced) { input.value = ''; start(PROMPT); return; }
    stopTyping();
    var gen = typingGen, i = 0, step = Math.max(1, Math.round(PROMPT.length / 60));
    input.value = '';
    root.classList.add('is-typing');
    typing = setInterval(function () {
      if (gen !== typingGen || cur !== 'rate') { stopTyping(); return; }
      i = Math.min(PROMPT.length, i + step);
      input.value = PROMPT.slice(0, i);
      if (i >= PROMPT.length) {
        clearInterval(typing); typing = null; root.classList.remove('is-typing');
        typingPost = setTimeout(function () {
          typingPost = null;
          if (gen === typingGen && S.rate.state === 'draft' && cur === 'rate' && input.value === PROMPT) { input.value = ''; start(PROMPT); }
        }, 260);
      }
    }, 20);
  }
  // Switching jobs stops the typing; the composer holds the prompt only for the unsent draft.
  function openJob(id) {
    var wasTyping = !!(typing || typingPost);
    stopTyping();
    cur = id;
    if (id === 'rate' && S.rate.state === 'draft') { if (!input.value || wasTyping) input.value = PROMPT; }
    else if (wasTyping || input.value === PROMPT) input.value = '';
    renderAll();
  }
  function restart() {
    clearTimers(); S.rate = fresh().rate; cur = 'rate'; pane = 'changes'; input.value = PROMPT; renderAll();
  }

  // ── input ───────────────────────────────────────────────────────────
  root.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('[data-act], [data-pane-tab]') : null;
    if (!b || b.disabled) return;
    userTouched = true;
    if (b.hasAttribute('data-pane-tab')) { pane = b.getAttribute('data-pane-tab'); renderPane(); return; }
    var a = b.getAttribute('data-act');
    if (a === 'open') { openJob(b.getAttribute('data-id')); }
    else if (a === 'restart') { restart(); focusQuiet(input); }
    else if (a === 'plan-ok') planDecision(true);
    else if (a === 'plan-later') planDecision(false);
    else if (a === 'gate-ok') gateDecision('ok');
    else if (a === 'gate-back') gateDecision('back');
    else if (a === 'gate-note') gateDecision('note-open');
    else if (a === 'gate-note-send') { var n = threadEl.querySelector('[data-note]'); gateDecision('note', (n && n.value.trim()) || 'no note'); }
    else if (a === 'answer') answer(parseInt(b.getAttribute('data-i'), 10));
    else if (a === 'pane') { pane = b.getAttribute('data-pane'); renderPane(); }
    else if (a === 'file') { S[cur].openFile = parseInt(b.getAttribute('data-i'), 10); renderPane(); }
  });
  threadEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target.matches && e.target.matches('[data-note]')) { e.preventDefault(); gateDecision('note', e.target.value.trim() || 'no note'); }
  });
  // Tablists: arrows move and select, Home/End jump. The rail scrolls the focused job into view.
  function roving(list, sel, vertical, activate) {
    list.addEventListener('keydown', function (e) {
      var tabs = Array.prototype.slice.call(list.querySelectorAll(sel));
      var i = tabs.indexOf(document.activeElement);
      if (i < 0) return;
      var next = -1;
      if (e.key === 'ArrowRight' || (vertical && e.key === 'ArrowDown')) next = (i + 1) % tabs.length;
      else if (e.key === 'ArrowLeft' || (vertical && e.key === 'ArrowUp')) next = (i - 1 + tabs.length) % tabs.length;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = tabs.length - 1;
      if (next < 0) return;
      e.preventDefault();
      userTouched = true;
      activate(tabs[next]);
    });
  }
  roving(sessionsEl, '[role="tab"]', true, function (t) { openJob(t.getAttribute('data-id')); focusQuiet(sessionsEl.querySelector('[data-id="' + cur + '"]')); });
  var paneTabs = root.querySelector('.ide-pane-tabs');
  roving(paneTabs, '[role="tab"]', false, function (t) { pane = t.getAttribute('data-pane-tab'); renderPane(); focusQuiet(t); });
  sessionsEl.addEventListener('focusin', function (e) {
    var t = e.target.closest && e.target.closest('.ide-sess');
    if (t && t.scrollIntoView) t.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });
  input.addEventListener('focus', function () { if (typing || typingPost) { stopTyping(); input.value = PROMPT; } userTouched = true; });
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    userTouched = true;
    stopTyping();
    var text = input.value.trim();
    if (!text) return;
    var s = S[cur];
    if (cur === 'rate' && s.state === 'draft') { input.value = ''; start(text); return; }
    input.value = '';
    push(cur, { k: 'user', t: text });
    push(cur, { k: 'event', t: 'Note added. It goes to the agent with the next step.' });
  });
  // "Watch a job" (hero CTA) replays the job from the top: the prompt types in and it stops at the plan.
  root.addEventListener('demo:replay', function () { userTouched = true; restart(); typeThenStart(); });

  renderAll();
  // Start the job on its own once the demo is on screen, unless the visitor got there first.
  // It always stops at the plan: nothing runs without a person approving it.
  function autoStart() { if (!userTouched && S.rate.state === 'draft') typeThenStart(); }
  if (reduced) { autoStart(); return; }
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (es) {
      if (es.some(function (x) { return x.isIntersecting; })) { io.disconnect(); setTimeout(autoStart, 700); }
    }, { threshold: 0.25 });
    io.observe(root);
    new IntersectionObserver(function (es) {
      es.forEach(function (x) { onScreen = x.isIntersecting; });
      bgSync();
    }, { threshold: 0.1 }).observe(root);
  } else { onScreen = true; autoStart(); bgSync(); }
})();
