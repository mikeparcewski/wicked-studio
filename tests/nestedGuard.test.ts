import { createHash } from 'node:crypto';
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

import { guardNestedHtml, NESTED_PRELUDE } from '../src/plugins/_shared/nestedGuard.js';
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
    const [policy, prelude, title] = Array.from(doc.head.children);
    expect(policy!.getAttribute('http-equiv')).toBe('Content-Security-Policy');
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
    expect(policy).toMatch(/^script-src 'sha256-[^;]+; frame-src 'none'; child-src 'none'; worker-src 'none'$/);
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

  it('fails closed: a script that breaks it by a hoisted declaration throws before its own first statement', () => {
    const ctx = win();
    expect(() => runInContext(`${P}window.ran = true; function Object(){}`, ctx)).toThrow();
    expect(runInContext('window.ran', ctx)).toBeUndefined();
  });

  it('holds no "<" (it cannot end or escape the script it sits in)', () => {
    expect(P).not.toContain('<');
  });
});
