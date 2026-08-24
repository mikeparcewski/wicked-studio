// The client-injected instrument bridge (the docfb2 restore) — the injector's
// contract. The bridge SCRIPT itself is proven in a real browser by
// e2e/ux2_docfb2_test.py (jsdom lays nothing out, so rect and click assertions
// would be vacuous here); what a unit can pin is the string surgery: where the
// script lands, when it is withheld, and what the <base> repair does.
import { describe, expect, it } from 'vitest';
import { hasInstrumentBridge, instrumentDocHtml } from '../src/interactive/instrumented.js';

const BASE = 'http://127.0.0.1:7788/api/v1/projects/p1/interactive/d/q3/doc/2';

const PLAIN = '<!doctype html><html><head><title>t</title></head>'
  + '<body><h1 data-wid="headline">Q3</h1></body></html>';

describe('hasInstrumentBridge', () => {
  it('detects a document that already answers the protocol (the fixture contract)', () => {
    expect(hasInstrumentBridge('<script>on("request-inventory")</script>')).toBe(true);
  });

  it('a real interactive-served document (data-wid anchors, NO bridge) needs injection', () => {
    // The half-shipped sibling slice: instrument.js injects anchors, never a bridge.
    expect(hasInstrumentBridge(PLAIN)).toBe(false);
  });
});

describe('instrumentDocHtml', () => {
  it('appends the bridge inside <body> and the result self-reports as bridged', () => {
    const out = instrumentDocHtml(PLAIN, BASE);
    expect(hasInstrumentBridge(out)).toBe(true);
    // Inside the body, so the volunteered first inventory measures parsed content.
    expect(out).toMatch(/wid-inventory[\s\S]*<\/body>/);
    // The document's own content is untouched.
    expect(out).toContain('<h1 data-wid="headline">Q3</h1>');
  });

  it('pins relative URLs with a <base href> at the document\'s own proxy address', () => {
    const out = instrumentDocHtml(PLAIN, BASE);
    expect(out).toContain(`<head><base href="${BASE}">`);
  });

  it('respects a document that brought its own <base>', () => {
    const based = PLAIN.replace('<head>', '<head><base href="https://example.test/x/">');
    const out = instrumentDocHtml(based, BASE);
    expect(out).toContain('<base href="https://example.test/x/">');
    expect(out).not.toContain(BASE);
  });

  it('survives fragment documents with no <head> or <body> at all', () => {
    const out = instrumentDocHtml('<h1 data-wid="h">x</h1>', BASE);
    expect(out.startsWith(`<base href="${BASE}">`)).toBe(true);
    expect(hasInstrumentBridge(out)).toBe(true);
  });

  it('restores the ORIGINAL grammar: the script preempts block clicks and reports them', () => {
    const out = instrumentDocHtml(PLAIN, BASE);
    // The grammar's wire words, present in the injected script: click-to-edit
    // (wid-click), hover highlight (wid-hover), and the Change-text seed (blocks).
    expect(out).toContain('wid-click');
    expect(out).toContain('wid-hover');
    expect(out).toContain('preventDefault');
    expect(out).toContain('composite');
  });
});
