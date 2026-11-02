import { createHash } from 'node:crypto';
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

import { guardNestedHtml, NESTED_PRELUDE, withNestedPrelude } from '../src/plugins/_shared/nestedGuard.js';
import { sha256Base64 } from '../src/plugins/_shared/sha256.js';
import { appendInstrumentBridge } from '../src/interactive/instrumented.js';

/**
 * The first-party editors' nested frames (page editor: Document and Page; the deck's slide) show agent-authored HTML
 * with scripts. `guardNestedHtml` makes every script there start with the WebRTC prelude and lets nothing else run.
 * The browser-level proof (zero UDP from a hostile document) is the lane's probe; these pin the document it builds.
 */
const P = NESTED_PRELUDE;
const node = (t: string): string => createHash('sha256').update(t, 'utf8').digest('base64');
const parse = (html: string): Document => new DOMParser().parseFromString(html, 'text/html');
const policyOf = (doc: Document): string => doc.head.firstElementChild?.getAttribute('content') ?? '';
const hashesOf = (doc: Document): string[] => [...policyOf(doc).matchAll(/'sha256-([^']+)'/g)].map((m) => m[1]!);

describe('sha256Base64: the CSP hash form, synchronously', () => {
  it('matches Node for empty, short, block-boundary, multi-block and non-ASCII input', () => {
    for (const t of ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(63), 'a'.repeat(64), 'a'.repeat(65), 'é → 😀 «»', P, 'x'.repeat(10_000)]) {
      expect(sha256Base64(t), `${t.length} chars`).toBe(node(t));
    }
  });
});

describe('guardNestedHtml: the prelude first in every script, and a policy that runs only those', () => {
  const agent = '<!doctype html><html lang="en"><head><title>t</title><script>window.a=1</script></head>' +
    '<body><p data-wid="p1">hi</p><script type="module">window.b=2</script><script src="x.js"></script>' +
    '<script type="application/json" id="d">{"n":1}</script></body></html>';

  it('the policy is the first thing in <head>, then the prelude on its own, then the document as it was', () => {
    const doc = parse(guardNestedHtml(agent));
    const [policy, inlineOnly, prelude, title] = Array.from(doc.head.children);
    expect(policy!.getAttribute('http-equiv')).toBe('Content-Security-Policy');
    // A second policy, inline only and no URL: a hash would also admit an external script whose integrity names it.
    expect(inlineOnly!.getAttribute('content')).toBe("script-src 'unsafe-inline'");
    expect(prelude!.tagName).toBe('SCRIPT');
    expect(prelude!.textContent).toBe(P);
    expect(title!.tagName).toBe('TITLE');
    expect(doc.documentElement.getAttribute('lang')).toBe('en');
    expect(doc.querySelector('[data-wid="p1"]')!.textContent).toBe('hi');
  });

  it('every script that runs starts with the prelude, and the policy lists exactly their hashes and nothing else', () => {
    const doc = parse(guardNestedHtml(agent));
    const runs = Array.from(doc.querySelectorAll('script')).filter((s) => !s.hasAttribute('src') && s.getAttribute('type') !== 'application/json');
    expect(runs.map((s) => s.textContent)).toEqual([P, `${P}window.a=1`, `${P}window.b=2`]);
    expect(hashesOf(doc).sort()).toEqual(runs.map((s) => node(s.textContent!)).sort());
  });

  it('no unsafe-inline, child frames load no URL, no workers', () => {
    const policy = policyOf(parse(guardNestedHtml(agent)));
    expect(policy).toMatch(/^script-src 'sha256-[^;]+; frame-src 'none'; child-src 'none'; worker-src 'none'; object-src 'none'$/);
    expect(policy).not.toContain('unsafe');
  });

  it('an external script and a data block are left as they were (and get no hash)', () => {
    const doc = parse(guardNestedHtml(agent));
    expect(doc.querySelector('script[src]')!.textContent).toBe('');
    expect(doc.getElementById('d')!.textContent).toBe('{"n":1}');
    expect(hashesOf(doc)).toHaveLength(3);
  });

  it('the data-wid bridge the editors append is guarded like any other script', () => {
    const doc = parse(guardNestedHtml(appendInstrumentBridge('<p data-wid="a">x</p>')));
    const bridge = Array.from(doc.querySelectorAll('script')).find((s) => s.textContent!.includes('__wickedInstrumentBridge'))!;
    expect(bridge.textContent!.startsWith(P)).toBe(true);
    expect(hashesOf(doc)).toContain(node(bridge.textContent!));
  });

  it('the doctype is kept, and a document without one stays without one (its rendering mode does not change)', () => {
    expect(guardNestedHtml('<!DOCTYPE html><p>x</p>').startsWith('<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy"')).toBe(true);
    expect(guardNestedHtml('<p>x</p>').startsWith('<html><head><meta http-equiv="Content-Security-Policy"')).toBe(true);
  });

  it('a directive prologue and a hashbang stay first (strict mode is kept); after a lone hashbang the prelude starts a new line', () => {
    expect(withNestedPrelude('"use strict";x()')).toBe(`"use strict";${P}x()`);
    expect(withNestedPrelude('<!-- old\n"use strict";x()')).toBe(`<!-- old\n"use strict";${P}x()`);
    expect(withNestedPrelude('\n--> old\n"use strict";x()')).toBe(`\n--> old\n"use strict";${P}x()`);
    // After a directive, `<!--` is code in a module: never skipped there, so the prelude goes first (review r7).
    expect(withNestedPrelude('"a"\n<!--window[rtc()]\n;')).toBe(`"a";${P}\n<!--window[rtc()]\n;`);
    expect(withNestedPrelude('/*\n*/ --> c\n"use strict";y()')).toBe(`/*\n*/ --> c\n"use strict";${P}y()`);
    expect(withNestedPrelude('#!/x\ny()')).toBe(`#!/x\n${P}\ny()`);
    expect(withNestedPrelude('"use strict"\nb()')).toBe(`"use strict";${P}\nb()`);
    expect(withNestedPrelude('"use strict"\n(b)')).toBe(`${P}"use strict"\n(b)`);
    // A unary `!`/`~` or `++`/`--` on the next line starts a new statement; `!=`, `+`, `in`, `instanceof` continue it.
    for (const next of ['!x()', '~x()', '++x', '--x', '.5', '\\u0069n()', 'in\\u0078 = 1']) expect(withNestedPrelude(`"use strict"\n${next}`), next).toBe(`"use strict";${P}\n${next}`);
    for (const next of ['!= x', '+ x', '- x', 'in x', 'instanceof x', '.toString()', 'in' + String.fromCharCode(0xa0) + 'x']) expect(withNestedPrelude(`"use strict"\n${next}`), next).toBe(`${P}"use strict"\n${next}`);
    const doc = parse(guardNestedHtml('<script>"use strict";window.s=1</script>'));
    const script = Array.from(doc.querySelectorAll('script')).find((s) => s.textContent!.includes('window.s'))!;
    expect(script.textContent).toBe(`"use strict";${P}window.s=1`);
    expect(hashesOf(doc)).toContain(node(script.textContent!));
  });

  it("the document's own enforcing CSP keeps its non-script restrictions; its script directives give way to inline scripts", () => {
    const own = '<head><meta http-equiv="Content-Security-Policy" content="script-src \'sha256-AAAA\'; style-src \'none\'; img-src \'none\'; script-src-elem \'none\'"><meta http-equiv="content-security-policy-report-only" content="img-src none"></head><body><script>window.x=1</script></body>';
    const doc = parse(guardNestedHtml(own));
    const metas = Array.from(doc.querySelectorAll('meta[http-equiv]')).map((m) => [m.getAttribute('http-equiv')!.toLowerCase(), m.getAttribute('content')]);
    expect(policyOf(doc)).toMatch(/^script-src 'sha256-/);
    expect(metas.find(([, c]) => c!.startsWith("style-src 'none'"))).toEqual(['content-security-policy', "style-src 'none'; img-src 'none'; script-src 'unsafe-inline'"]);
    expect(metas.some(([k]) => k === 'content-security-policy-report-only')).toBe(true);
    expect(JSON.stringify(metas)).not.toContain('AAAA');
  });

  it('scripts inside <template> contents (a declarative shadow root, a template cloned later) are guarded and hashed too', () => {
    const doc = parse(guardNestedHtml('<div><template shadowrootmode="open"><p>in</p><script>window.a=1</script></template></div><template id="t"><template><script>window.b=2</script></template></template>'));
    const texts: string[] = [];
    const walk = (root: ParentNode): void => {
      for (const s of Array.from(root.querySelectorAll('script'))) texts.push(s.textContent ?? '');
      for (const t of Array.from(root.querySelectorAll('template'))) walk((t as HTMLTemplateElement).content);
    };
    walk(doc);
    expect(texts).toEqual(expect.arrayContaining([`${P}window.a=1`, `${P}window.b=2`]));
    for (const t of texts) expect(hashesOf(doc)).toContain(node(t));
  });

  it('a <template> inside <svg> or <math> (a foreign element, no contents) does not stop the guard; its script is guarded', () => {
    const out = guardNestedHtml('<svg><template><script>window.t=1</script></template></svg><math><template></template></math>');
    const doc = parse(out);
    const t = Array.from(doc.querySelectorAll('svg script'))[0]!;
    expect(t.textContent).toBe(`${P}window.t=1`);
  });

  it('an SVG script is external by href (src means nothing there), an HTML one by src', () => {
    const doc = parse(guardNestedHtml('<svg><script src="ignored">window.s=1</script><script href="x.js"></script><script xlink:href="z.js"></script></svg><script src="y.js"></script>'));
    const svgScripts = Array.from(doc.querySelectorAll('svg script'));
    expect(svgScripts[0]!.textContent).toBe(`${P}window.s=1`);
    expect(svgScripts[1]!.textContent).toBe('');
    expect(svgScripts[2]!.textContent).toBe('');
    expect(doc.querySelector('body > script[src]')!.textContent).toBe('');
    // `language` is HTML's fallback only: an SVG script with language="other" runs, so it is guarded.
    const lang = parse(guardNestedHtml('<svg><script language="other">window.l=1</script></svg>'));
    expect(lang.querySelector('svg script')!.textContent).toBe(`${P}window.l=1`);
  });

  it('an SVG script with a carriage return is hashed as the browser reads it back (LF)', () => {
    const doc = parse(guardNestedHtml('<svg><script>window.a=1;&#13;window.b=2</script></svg>'));
    const s = doc.querySelector('svg script')!;
    expect(s.textContent).toBe(`${P}window.a=1;\nwindow.b=2`);
    expect(hashesOf(doc)).toContain(node(s.textContent!));
  });

  it("a template's own enforcing CSP gives way the same way (cloned in later, it would refuse the template's rewritten script)", () => {
    const doc = parse(guardNestedHtml('<template id="t"><meta http-equiv="Content-Security-Policy" content="script-src \'sha256-AAAA\'; style-src \'none\'"><script>window.t=1</script></template>'));
    const content = (doc.getElementById('t') as HTMLTemplateElement).content;
    expect(content.querySelector('meta[http-equiv]')!.getAttribute('content')).toBe("style-src 'none'; script-src 'unsafe-inline'");
    expect(content.querySelector('script')!.textContent).toBe(`${P}window.t=1`);
  });

  it('inline event handlers stay in the markup but the policy refuses them (no unsafe-hashes)', () => {
    const out = guardNestedHtml('<img src="x" onerror="new RTCPeerConnection()">');
    expect(out).toContain('onerror=');
    expect(policyOf(parse(out))).not.toMatch(/unsafe-hashes|unsafe-inline/);
  });
});

describe('NESTED_PRELUDE: WebRTC gone from the window, for good, before the document\'s first statement', () => {
  const win = (): object => {
    const ctx = createContext({});
    runInContext('var window = this; this.RTCPeerConnection = function(){}; this.webkitRTCPeerConnection = this.RTCPeerConnection; this.RTCNew = function(){};', ctx);
    return ctx;
  };

  it('locks every RTC* global as undefined; it cannot be put back; it runs again without error', () => {
    const ctx = win();
    runInContext(P, ctx);
    for (const n of ['RTCPeerConnection', 'webkitRTCPeerConnection', 'RTCDataChannel', 'RTCNew']) {
      expect(runInContext(`Object.getOwnPropertyDescriptor(window, ${JSON.stringify(n)})`, ctx), n).toMatchObject({ value: undefined, writable: false, configurable: false });
    }
    expect(runInContext('delete window.RTCPeerConnection', ctx)).toBe(false);
    expect(() => runInContext(`${P}window.again = 1`, ctx)).not.toThrow();
  });

  it('is the same text crew puts in every editor bundle (crew src/editors/webrtc-guard.ts pins the same sha256)', () => {
    expect(node(P)).toBe('bshWuuB2sbcxfqYhEzM37dLx7kpAWeLCBXSHtjRL1zI=');
  });

  it('fails closed when `window` is not the window: a module-scope `function window(){}` (here a function scope) throws a string first, and calls no hoisted TypeError', () => {
    const ctx = win();
    let thrown: unknown;
    try { runInContext(`(function(){ ${P} window.ran = true; function window(){} function TypeError(){ globalThis.called = true } })()`, ctx); } catch (e) { thrown = e; }
    expect(thrown).toBe('WebRTC is not available in an editor frame');
    expect(runInContext('typeof globalThis.called + typeof globalThis.ran', ctx)).toBe('undefinedundefined');
  });

  it('takes Object from a literal: a script that hoists its own `function Object(){}` still gets WebRTC locked', () => {
    const ctx = win();
    runInContext(`${P}window.ran = true; function Object(){}`, ctx);
    expect(runInContext('window.ran', ctx)).toBe(true);
    expect(runInContext('typeof window.RTCPeerConnection', ctx)).toBe('undefined');
  });

  it('a comment cannot be read short or long to move the prelude: it still runs before the first statement', () => {
    for (const body of ['//"a";\nwindow.seen = typeof RTCPeerConnection;', '/* */ window.seen = typeof RTCPeerConnection; /* */ "a";']) {
      const ctx = win();
      runInContext(withNestedPrelude(body), ctx);
      expect(runInContext('window.seen', ctx), body).toBe('undefined');
    }
    expect(withNestedPrelude('//"a";\nx()')).toBe(`${P}//"a";\nx()`);
    expect(withNestedPrelude('/* */ x(); /* */ "a";')).toBe(`${P}/* */ x(); /* */ "a";`);
  });

  it('a script with a lone hashbang still runs the prelude first (it is not swallowed by the hashbang comment)', () => {
    const ctx = win();
    runInContext(withNestedPrelude('#!/x\nwindow.seen = typeof RTCPeerConnection;'), ctx);
    expect(runInContext('window.seen', ctx)).toBe('undefined');
  });

  it('holds no "<" (it cannot end or escape the script it sits in)', () => {
    expect(P).not.toContain('<');
  });
});
