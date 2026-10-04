import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDocChecks, type DocCheck } from '../src/api/docChecks.js';
import { checkRows, checksSummary } from '../src/board/checksPanel.js';

/** EP-P3: the checks panel the host draws beside a page — crew's checks read, four reviewers. */

const check = (over: Partial<DocCheck> = {}): DocCheck => ({
  id: 'v1', source: 'review:intent', reviewer: 'match', version: 3, state: 'pass', sentence: 'It says what the brief asked.',
  findings: [], by: { seat: 'codex', evaluator: true, excluded_seats: ['claude'], author_known: true }, skill: null, run_id: 'r9', at: '2026-10-04T07:00:00Z', ...over,
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('the rows', () => {
  it('name the reviewer and the state, and say who reviewed — independent only when on record', () => {
    const rows = checkRows([
      check(),
      check({ id: 'v2', reviewer: 'a11y', source: 'review:a11y', state: 'fail', by: { seat: 'claude', evaluator: false, excluded_seats: ['claude'], author_known: true } }),
      check({ id: 'v3', reviewer: 'copy', source: 'review:copy', state: 'inconclusive', by: { seat: 'pi', evaluator: false, excluded_seats: [], author_known: false } }),
    ], 3);
    expect(rows.map((r) => [r.name, r.stateWord, r.independent])).toStrictEqual([['Intent', 'Passes', true], ['Accessibility', 'Changes asked for', false], ['Copy', 'Could not run', false]]);
    expect(rows[0]!.by).toBe('Reviewed by codex, which did not write it.');
    expect(rows[1]!.by).toBe('Reviewed by claude, which also wrote it — not an independent review.');
    expect(rows[2]!.by).toMatch(/not on record/);
  });
  it('a verdict on an older version says so; findings are named as the editor names elements', () => {
    const [row] = checkRows([check({ version: 2, findings: [{ wid: 'slide-0-heading-1', severity: 'high', sentence: 'Too long.' }, { wid: null, severity: 'low', sentence: 'Tone.' }] })], 4);
    expect(row!.onVersion).toBe('on version 2');
    expect(row!.findings.map((f) => f.where)).toStrictEqual(['heading 1', 'the page as a whole']);
    expect(checkRows([check({ version: 4 })], 4)[0]!.onVersion).toBeNull();
  });
  it('the summary counts each reviewer once', () => {
    expect(checksSummary([])).toBe('Not reviewed yet.');
    expect(checksSummary(checkRows([check(), check({ state: 'fail' }), check({ state: 'fail' }), check({ state: 'inconclusive' })], 3))).toBe('1 pass · 2 ask for changes · 1 could not run');
  });
});

describe('the read', () => {
  it('asks for the version on screen; an absent route is no panel; a failed read says why', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string) => { urls.push(u); return new Response(JSON.stringify({ document_id: 'p', version: 3, checks: [check()] }), { status: 200 }); }));
    expect(await getDocChecks('notes', 'launch-page', 3)).toMatchObject({ state: 'ok', checks: [{ id: 'v1' }] });
    expect(urls[0]).toMatch(/\/projects\/notes\/interactive\/docs\/launch-page\/checks\?version=3$/);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Not Found', { status: 404 })));
    expect(await getDocChecks('notes', 'launch-page', 3)).toStrictEqual({ state: 'absent' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'The recorded reviews of this document could not be read' }), { status: 500 })));
    expect(await getDocChecks('notes', 'launch-page', 3)).toMatchObject({ state: 'failed' });
  });
});
