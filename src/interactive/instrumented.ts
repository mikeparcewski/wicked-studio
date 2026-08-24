// The CLIENT-INJECTED instrument bridge (the docfb2 restore).
//
// DIAGNOSIS this module answers: studio's half of the point-and-comment loop
// (FeedbackOverlay + instrument-protocol) was built and proven against a HAND-WRITTEN
// fixture bridge (`e2e/fixtures/doc-fixture.html`), whose header promised that "in
// production core/instrument.js (wicked-interactive, the sibling slice) injects the
// data-wid anchors AND the bridge script". The sibling slice half-shipped: interactive's
// `instrument.js` injects the `data-wid` ANCHORS into every landed version, but no
// bridge script exists anywhere in wicked-interactive — its own retired SPA never
// needed one, because it framed documents SAME-ORIGIN and read `contentDocument`
// directly (App.jsx `onIframeLoad`). Studio's frame is `sandbox="allow-scripts"` with
// an opaque origin BY DESIGN (§5.5), so against every real document the overlay's four
// asks went unanswered, the 3s give-up fired, and "Comment" rendered permanently
// disabled — the operator's "can't click and edit like the original".
//
// THE RESTORE: studio fetches the version HTML it was going to frame anyway (same
// origin, same bytes, through crew's proxy), appends this bridge script, and renders
// the result via `srcdoc` — still `sandbox="allow-scripts"`, still an opaque origin,
// still nothing readable back. A document that already carries a bridge (the fixture
// contract, or a future server-side injector) is framed by `src` untouched: the
// served bridge stays authoritative.
//
// The script mirrors doc-fixture.html's bridge and RESTORES the original interaction
// grammar on top of it (wicked-interactive App.jsx + selection.js):
//   · hover walks up to the nearest [data-wid] and reports it (`wid-hover`);
//   · click on an instrumented block is PREEMPTED (preventDefault, exactly the
//     original's move) and reported (`wid-click`) — click-to-edit, no mode toggle;
//   · the inventory carries per-block `text` (the Change-text seed / `before`
//     snapshot) and `composite` (nested anchors — text replace hidden, as the
//     original InlineComment hides it).

/** Marker every bridge answers to — presence in served HTML means "already bridged". */
const BRIDGE_MARK = 'request-inventory';

/**
 * True when the served HTML already speaks the instrument protocol — the fixture
 * contract, or a future interactive-side injector. String detection is deliberate:
 * the alternative (inject always, guard at runtime) would race two bridges' answers.
 */
export function hasInstrumentBridge(html: string): boolean {
  return html.includes(BRIDGE_MARK);
}

// The bridge, as an inline classic script (no modules inside srcdoc). Kept ES5-flat so
// it runs in anything an agent-authored document runs in. NOTE: must never contain the
// literal close-script sequence.
const BRIDGE_SOURCE = `
(function () {
  if (window.__wickedInstrumentBridge) return;
  window.__wickedInstrumentBridge = 1;
  function nearest(node) {
    var el = node;
    while (el) {
      if (el.getAttribute && el.getAttribute('data-wid')) return el;
      el = el.parentElement;
    }
    return null;
  }
  function inventory() {
    var widMap = {};
    var blocks = {};
    var nodes = document.querySelectorAll('[data-wid]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var wid = el.getAttribute('data-wid');
      var r = el.getBoundingClientRect();
      widMap[wid] = { x: r.x, y: r.y, width: r.width, height: r.height,
                      top: r.top, left: r.left, right: r.right, bottom: r.bottom };
      var text = (el.textContent || '').replace(/\\s+/g, ' ').trim();
      blocks[wid] = { text: text.length > 400 ? text.slice(0, 400) : text,
                      composite: el.querySelector('[data-wid]') !== null };
    }
    return { v: 1, type: 'wid-inventory', widMap: widMap, blocks: blocks,
             scrollX: window.scrollX, scrollY: window.scrollY };
  }
  function post(msg) { parent.postMessage(msg, '*'); }
  window.addEventListener('message', function (e) {
    var m = e.data;
    if (!m || m.v !== 1) return;
    if (m.type === 'request-inventory') {
      post(inventory());
    } else if (m.type === 'scroll-to-wid' && typeof m.wid === 'string') {
      var el = document.querySelector('[data-wid="' + m.wid.replace(/["\\\\]/g, '') + '"]');
      if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center' });
      post({ v: 1, type: 'scroll-ack', wid: m.wid });
    }
  });
  document.addEventListener('scroll', function (e) {
    if (e.target === document || e.target === document.documentElement || e.target === document.body) {
      post({ v: 1, type: 'scroll-state', scrollX: window.scrollX, scrollY: window.scrollY });
    } else {
      post(inventory());
    }
  }, { passive: true, capture: true });
  window.addEventListener('resize', function () { post(inventory()); });
  document.addEventListener('click', function (e) {
    var el = nearest(e.target);
    if (!el) return;
    e.preventDefault();
    post({ v: 1, type: 'wid-click', wid: el.getAttribute('data-wid') });
  });
  var lastHover = null;
  document.addEventListener('mousemove', function (e) {
    var el = nearest(e.target);
    var wid = el ? el.getAttribute('data-wid') : null;
    if (wid !== lastHover) {
      lastHover = wid;
      post({ v: 1, type: 'wid-hover', wid: wid });
    }
  });
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { post(inventory()); });
  } else {
    post(inventory());
  }
})();
`;

/**
 * Instrument one served document for the sandboxed frame:
 *   · a `<base href>` pinning relative URLs to the document's own proxy address —
 *     srcdoc documents inherit the PARENT page's base, which would re-root every
 *     relative asset onto the SPA route; skipped when the document brought its own;
 *   · the bridge script, appended at the end of `<body>` so the inventory it
 *     volunteers measures the parsed document.
 */
export function instrumentDocHtml(html: string, baseHref: string): string {
  let out = html;
  if (!/<base[\s>]/i.test(out)) {
    const baseTag = `<base href="${baseHref.replace(/"/g, '&quot;')}">`;
    out = /<head[^>]*>/i.test(out)
      ? out.replace(/<head[^>]*>/i, (m) => `${m}${baseTag}`)
      : `${baseTag}${out}`;
  }
  const scriptTag = `<script>${BRIDGE_SOURCE}<\/script>`;
  return /<\/body>/i.test(out)
    ? out.replace(/<\/body>/i, () => `${scriptTag}</body>`)
    : `${out}${scriptTag}`;
}
