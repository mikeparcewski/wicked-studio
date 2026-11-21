import { describe, expect, it } from 'vitest';
import type { CoreEvent } from '../src/api/types.js';
import { failingItems, findingsNote } from '../src/components/gateMoveModel.js';
import { gateVerdictFor } from '../src/components/gateVerdictModel.js';

function verdict(reason: string) {
  return gateVerdictFor([{ type: 'gateEvaluated', ord: 2, combined: false,
    denial: { source: 'evaluator_verdict', reason } }] as unknown as CoreEvent[], 2, undefined);
}

const report = [
  'ITEM 1: PASS — existing coverage holds',
  'ITEM 2: FAIL — the regression test is missing',
  'ITEM 3: NOT PASS — src/app.ts still reads `buggy`',
  ...Array.from({ length: 6 }, (_, i) => `RULE rule-${i}: ${i % 2 === 0 ? 'N/A' : 'KEPT'} — respected`),
  'RULE no-network: BROKEN — fetched a dependency',
  'ITEM 2: FAIL — the regression test is missing',
  'RULE no-network: BROKEN — fetched a dependency',
];
const expected = ['Item 2: the regression test is missing', 'Item 3: src/app.ts still reads `buggy`', 'Rule no-network broken: fetched a dependency'];

describe('studio#1081 item-verdict findings', () => {
  it.each(['plain', 'bullet', 'bold', 'bullet and bold'])('reads failing ITEMs and BROKEN RULEs in order, deduplicated (%s)', (dress) => {
    const text = report.map((line) => `${dress.includes('bullet') ? '- ' : ''}${dress.includes('bold') ? `**${line}**` : line}`).join('\n');
    const items = failingItems(verdict(text), text);
    expect(items).toEqual(expected);
    expect(findingsNote(items, 'reviewer')).toBe(`Fix the reviewer's failing items:\n${expected.map((item) => `- ${item}`).join('\n')}`);
  });

  it('a 4 KB RULE-only tail has no findings in reason or summary', () => {
    const tail = Array.from({ length: 200 }, (_, i) => `RULE rule-${i}: ${i % 2 === 0 ? 'N/A' : 'KEPT'} — respected`).join('\n').slice(-4096);
    // studio#1081: keep the tail on a verdict-line boundary.
    const text = tail.slice(tail.indexOf('\n') + 1);
    expect(failingItems(verdict(text), text)).toEqual([]);
  });

  it('an ITEM PASS line is never a prose finding', () => {
    expect(failingItems(verdict('ITEM 1: PASS — covered'), 'ITEM 1: PASS — covered')).toEqual([]);
  });

  it('a bare failing item or broken rule is named without a dangling colon', () => {
    const text = 'VERDICT: FAIL\nITEM 4: FAIL\nRULE no-network: BROKEN';
    expect(failingItems(verdict(text), text)).toEqual(['Item 4', 'Rule no-network broken']);
  });

  it('a prose finding that starts "Rule 3:" is not a rule verdict and is still carried', () => {
    const text = 'Rule 3: the cache is never invalidated after a write';
    expect(failingItems(verdict(text), text)).toEqual([text]);
  });

  it('the d13ea2f6 shape: nine ITEM lines on top, then ~70 RULE N/A / KEPT lines: only the 8 failing items', () => {
    const text = [
      'VERDICT: FAIL',
      'ITEM 1: PASS — the page states its units',
      ...Array.from({ length: 8 }, (_, i) => `ITEM ${i + 2}: FAIL — unit ${i + 10} names no behaviour`),
      ...Array.from({ length: 70 }, (_, i) => `RULE POL-${i}: ${i % 3 === 0 ? 'KEPT' : 'N/A'} — not touched by this page`),
    ].join('\n');
    const items = failingItems(verdict(text), text.slice(-4096));
    expect(items).toEqual(Array.from({ length: 8 }, (_, i) => `Item ${i + 2}: unit ${i + 10} names no behaviour`));
  });
});
