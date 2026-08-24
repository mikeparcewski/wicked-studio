// The storyboard's render-time instrumentation (VIDEO-FB finding 1) — URL
// re-homing, junk-label repair, and the brief parser the subjects come from.
import { describe, expect, it } from 'vitest';
import {
  instrumentDemoHtml, isBareLabel, repairChapterLabels, rewriteBridgeRootUrls,
  subjectsFromBrief,
} from '../src/interactive/demoHtml.js';

const MOUNT = '/api/v1/projects/p1/interactive';

// The REAL bridge shape (demo.js storyboard()): root-absolute recording URLs.
const STORYBOARD = '<section class="wi-demo">'
  + '<video id="wi-demo-video" controls src="/d/checkout-demo/api/demo/recording/_v1.webm"></video>'
  + '<img src="/d/checkout-demo/api/demo/recording/_v1.step01.png" alt="0">'
  + '<a href="/d/checkout-demo/api/demo/recording/_v1.gif">gif</a>'
  + '</section>';

describe('rewriteBridgeRootUrls', () => {
  it('re-homes every root-absolute /d/ src, href and poster onto the mount', () => {
    const out = rewriteBridgeRootUrls(STORYBOARD, MOUNT);
    expect(out).toContain(`src="${MOUNT}/d/checkout-demo/api/demo/recording/_v1.webm"`);
    expect(out).toContain(`src="${MOUNT}/d/checkout-demo/api/demo/recording/_v1.step01.png"`);
    expect(out).toContain(`href="${MOUNT}/d/checkout-demo/api/demo/recording/_v1.gif"`);
    // Nothing else changed — the storyboard's own markup is the bridge's.
    expect(out).toContain('id="wi-demo-video"');
  });

  it('leaves relative and external URLs alone — base href owns relatives', () => {
    const html = '<img src="thumb.png"><a href="https://shop.example/">x</a>';
    expect(rewriteBridgeRootUrls(html, MOUNT)).toBe(html);
  });
});

describe('repairChapterLabels', () => {
  const chapters = '<span class="wi-demo__name">0</span>'
    + '<span class="wi-demo__name">1</span>'
    + '<span class="wi-demo__name">Confirm the order</span>';

  it('replaces BARE labels with the authored subjects, by chapter order', () => {
    const out = repairChapterLabels(chapters, ['Open the storefront', 'Add a hoodie']);
    expect(out).toContain('>Open the storefront<');
    expect(out).toContain('>Add a hoodie<');
    // A REAL label is the spec's authority — never touched.
    expect(out).toContain('>Confirm the order<');
  });

  it('falls back to the honest ordinal where no subject is known', () => {
    const out = repairChapterLabels(chapters, []);
    expect(out).toContain('>Step 1<');
    expect(out).toContain('>Step 2<');
    expect(out).toContain('>Confirm the order<');
  });

  it('escapes a subject that carries markup', () => {
    const out = repairChapterLabels('<span class="wi-demo__name"></span>', ['<b>x</b>']);
    expect(out).toContain('&lt;b&gt;x&lt;/b&gt;');
  });

  it('isBareLabel: empty and pure-integer labels are junk; words are not', () => {
    expect(isBareLabel('')).toBe(true);
    expect(isBareLabel(' 3 ')).toBe(true);
    expect(isBareLabel('Step into the cart')).toBe(false);
  });
});

describe('subjectsFromBrief', () => {
  const BRIEF = 'Record a demo of https://shop.example/:\n'
    + '1. Open the storefront — land on the home page\n'
    + '2. Add a hoodie to the cart — put one in the basket';

  it('parses subjects at their AUTHORED index from a wizard brief', () => {
    expect(subjectsFromBrief(BRIEF)).toEqual([
      'Open the storefront', 'Add a hoodie to the cart',
    ]);
  });

  it('an ordinary chat line is never mistaken for a spec', () => {
    expect(subjectsFromBrief('make the intro shorter')).toEqual([]);
    expect(subjectsFromBrief('1. do the thing — now')).toEqual([]);
  });
});

describe('instrumentDemoHtml', () => {
  it('adds base href, re-homes URLs and repairs labels in one pass', () => {
    const html = '<html><head></head><body>'
      + '<video src="/d/x/api/demo/recording/_v2.webm"></video>'
      + '<span class="wi-demo__name">0</span></body></html>';
    const out = instrumentDemoHtml(html, 'http://app/api/v1/projects/p1/interactive/d/x/doc/2', MOUNT, ['The board']);
    expect(out).toContain('<base href="http://app/api/v1/projects/p1/interactive/d/x/doc/2">');
    expect(out).toContain(`src="${MOUNT}/d/x/api/demo/recording/_v2.webm"`);
    expect(out).toContain('>The board<');
  });

  it('never doubles a base the document brought', () => {
    const html = '<head><base href="/own/"></head>';
    expect(instrumentDemoHtml(html, 'http://app/other', MOUNT).match(/<base/g)).toHaveLength(1);
  });

  it('carries NO instrument bridge — chapter clicks must keep seeking', () => {
    const out = instrumentDemoHtml(STORYBOARD, 'http://app/doc/1', MOUNT);
    expect(out).not.toContain('request-inventory');
    expect(out).not.toContain('wid-click');
  });
});
