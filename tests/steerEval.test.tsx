import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../src/api/errors.js';
import type { SteeringRule } from '../src/api/steering.js';
import type { EvalResult } from '../src/api/testing.js';
import { coverageByType, draftRequest, evalCaveats, gapsByType, historyStores, ruleEvalStatus, storeMatch } from '../src/board/evalModel.js';
import { steerTotals } from '../src/board/steerModel.js';
import { EvaluateSurface } from '../src/components/steer/EvaluateSurface.js';
import { ruleFacets, SteerSurface } from '../src/components/steer/SteerSurface.js';
import { groupEvalRuns } from '../src/components/EvalHistory.js';
import { tableAddress } from '../src/components/steer/tableAddress.js';
import { deskTabPath } from '../src/components/desk/DeskV2.js';
import { useEvalReportStore } from '../src/store/evalReport.js';
import { useSteerDraft } from '../src/store/steerDraft.js';
import { importRuleFile } from '../src/board/steerImport.js';

/**
 * DES-steer-eval §3.2–3.3: the Evaluate numbers carry their context, and Draft rules hands the gaps
 * to Steer's assistant without sending anything. The fixtures are the SHAPE of the live :7701 data
 * this lane read (lanes/studio-steer-eval/raw): every "caught" a good sample left alone, rules in
 * force that mostly carry no effect, and a persisted run judged against a temp rule store.
 */

const listConformanceRules = vi.fn();
const upsertConformanceRule = vi.fn();
const retireConformanceRule = vi.fn();
const apiFetch = vi.fn();

vi.mock('../src/api/client.js', () => ({
  api: {
    listConformanceRules: (...a: unknown[]) => listConformanceRules(...a),
    retireConformanceRule: (...a: unknown[]) => retireConformanceRule(...a),
    upsertConformanceRule: (...a: unknown[]) => upsertConformanceRule(...a),
    listClaims: () => Promise.reject(new Error('not in this fixture')),
  },
  apiFetch: (...a: unknown[]) => apiFetch(...a),
}));

const DAEMON = '/srv/crew/.wicked-crew/core.db';
const TEMP = '/var/folders/x/T/testing-real-ABC/core.db';

function res(id: string, kind: 'good' | 'bad', type: string, verdict: EvalResult['verdict'], fired: string[] = [], nearest?: { rule_id: string; similarity: number }[]): EvalResult {
  return {
    sample: { id, description: `behaviour ${id}`, kind, steering_type: type },
    expected: kind === 'bad' ? 'deny' : 'allow',
    fired,
    verdict,
    ...(nearest !== undefined ? { nearest_rules: nearest } : {}),
  } as EvalResult;
}

/** Live shape: two good samples left alone ("caught"), three bad ones uncovered. */
const RESULTS: EvalResult[] = [
  res('g1', 'good', 'security', 'caught'),
  res('g2', 'good', 'development', 'caught'),
  res('b1', 'bad', 'security', 'gap', [], [{ rule_id: 'SEC-1', similarity: 0.7 }]),
  res('b2', 'bad', 'security', 'gap'),
  res('b3', 'bad', 'development', 'gap'),
];
const SUMMARY = { total: 5, caught: 2, gaps: 3, false_positives: 0 };

function rule(id: string, effect?: SteeringRule['effect']): SteeringRule {
  return { id, rule_type: 'policy', statement: `rule ${id}`, severity: 'warn', confidence: 0.8, targets: {}, provenance: { source: 'ui', source_kinds: ['doc'] }, steering_type: 'security', ...(effect !== undefined ? { effect } : {}) } as SteeringRule;
}
/** 10 rules in force: one allows, one adds conditions, none blocks, eight guidance. */
const RULES = [rule('A-1', 'allow'), rule('A-2', 'allow_with_conditions'), ...Array.from({ length: 8 }, (_, i) => rule(`G-${i}`))];

function summaryRow(id: string, at: number, store: string): Record<string, unknown> {
  return { id, created_at: at, actor: 'local', corpus: null, type_filter: null, rule_store: store, summary: SUMMARY, per_type: {}, degraded: 'facet-only' };
}

function wire(opts: { top?: string; daemon?: string | null } = {}): void {
  const top = opts.top ?? TEMP;
  apiFetch.mockImplementation((path: unknown) => {
    const p = String(path);
    if (p === '/testing/evals') return Promise.resolve({ runs: [summaryRow('r3', 300, top), summaryRow('r2', 200, TEMP), summaryRow('r1', 100, DAEMON)] });
    if (p === '/testing/evals/r3') return Promise.resolve({ ...summaryRow('r3', 300, top), results: RESULTS });
    if (p === '/diagnostics') {
      return opts.daemon === null ? Promise.reject(new ApiError(404, 'Not Found'))
        : Promise.resolve({ stores: [{ name: 'core.db', path: opts.daemon ?? DAEMON, bytes: 1 }, { name: 'core.db.bus', path: `${DAEMON}.bus`, bytes: 1 }] });
    }
    return Promise.reject(new ApiError(404, 'Not Found'));
  });
}

beforeEach(() => {
  apiFetch.mockReset();
  listConformanceRules.mockReset();
  listConformanceRules.mockResolvedValue({ rules: RULES });
  useEvalReportStore.setState({ latest: null });
  useSteerDraft.setState({ seed: null });
});
afterEach(() => cleanup());

describe('the folds', () => {
  it('storeMatch: the daemon’s own store, another store, or unknown when either side is missing', () => {
    expect(storeMatch(DAEMON, DAEMON)).toBe('daemon');
    expect(storeMatch(TEMP, DAEMON)).toBe('other');
    expect(storeMatch(null, DAEMON)).toBe('unknown');
    expect(storeMatch(TEMP, null)).toBe('unknown');
    expect(storeMatch('', DAEMON)).toBe('unknown');
    expect(historyStores([{ rule_store: TEMP }, { rule_store: DAEMON }, { rule_store: TEMP }, {}], DAEMON)).toEqual({ daemon: 1, other: 2, unknown: 1 });
  });

  it('steerTotals counts what carries an effect and what blocks', () => {
    expect(steerTotals([...RULES, rule('D-1', 'deny'), { ...rule('R-1', 'deny'), retired: true }])).toEqual({ live: 11, retired: 1, gating: 3, blocks: 1, guidance: 8 });
  });

  it('evalCaveats says the live findings in plain words, in reading order', () => {
    const c = evalCaveats({ summary: SUMMARY, results: RESULTS, totals: steerTotals(RULES), store: 'other', history: { daemon: 1, other: 2, unknown: 0 } });
    expect(c.map((x) => x.key)).toEqual(['no-bad-blocked', 'few-effects', 'other-store', 'history-stores']);
    expect(c[0]?.text).toBe('All 2 “caught” are good behaviours left alone. None of the 3 bad behaviours was blocked.');
    expect(c[1]?.text).toContain('Only 2 of 10 rules in force carry an effect, and none of them blocks');
    expect(c[2]?.text).toContain('judged against a different rule store, not this daemon’s');
    expect(c[3]?.text).toBe('2 of 3 saved runs were judged against another rule store; 1 against this daemon’s.');
  });

  it('evalCaveats stays quiet where the numbers need no caveat', () => {
    const blocked = [res('b1', 'bad', 'security', 'caught', ['D-1'])];
    expect(evalCaveats({ summary: { total: 1, caught: 1 }, results: blocked, totals: { live: 1, gating: 1, blocks: 1 }, store: 'daemon', history: { daemon: 1, other: 0, unknown: 0 } })).toEqual([]);
    // A mix: blocked bad samples AND good ones left alone — says the split.
    const mixed = [...blocked, res('g1', 'good', 'security', 'caught')];
    expect(evalCaveats({ summary: { total: 2, caught: 2 }, results: mixed, totals: null, store: 'unknown', history: null })[0]?.text)
      .toBe('1 of 1 bad behaviours were blocked; the other 1 “caught” are good behaviours left alone.');
  });

  it('coverage, gaps, the draft request and each rule’s eval status come off the engine’s rows', () => {
    expect(coverageByType(RESULTS)).toEqual([
      { type: 'security', total: 3, caught: 1, blocked: 0, passed: 1, bad: 2, gaps: 2, falsePositives: 0 },
      { type: 'development', total: 2, caught: 1, blocked: 0, passed: 1, bad: 1, gaps: 1, falsePositives: 0 },
    ]);
    const groups = gapsByType(RESULTS);
    expect(groups.map((g) => [g.type, g.gaps.length])).toEqual([['security', 2], ['development', 1]]);
    expect(draftRequest('security', groups[0]!.gaps)).toBe('Draft Security rules that would block these behaviours (each is a gap in the last eval):\n- behaviour b1\n- behaviour b2');
    expect([...ruleEvalStatus(RESULTS)]).toEqual([['SEC-1', 'near-gap']]);
  });
});

describe('the Evaluate surface on the live shape', () => {
  it('leads the Caught tile with bad-blocked and shows every caveat beside the numbers', async () => {
    wire();
    render(<EvaluateSurface navigate={vi.fn()} />);
    const caught = await screen.findByTestId('evaluate-stat-caught');
    await waitFor(() => expect(caught).toHaveTextContent('2of 5'));
    expect(caught).toHaveTextContent('0 of 3 bad blocked · 2 good left alone');
    const card = await screen.findByTestId('evaluate-measures');
    await waitFor(() => expect(card.getAttribute('data-store')).toBe('other'));
    const keys = within(card).getAllByTestId('evaluate-caveat').map((li) => li.getAttribute('data-caveat'));
    expect(keys).toEqual(['no-bad-blocked', 'few-effects', 'other-store', 'history-stores']);
    // Nothing on this surface wrote anything.
    expect(apiFetch.mock.calls.every(([, init]) => (init as { method?: string } | undefined)?.method === undefined)).toBe(true);
  });

  it('a run against the daemon’s own store carries no store caveat', async () => {
    wire({ top: DAEMON });
    render(<EvaluateSurface navigate={vi.fn()} />);
    const card = await screen.findByTestId('evaluate-measures');
    await waitFor(() => expect(card.getAttribute('data-store')).toBe('daemon'));
    expect(within(card).queryByText(/different rule store/)).toBeNull();
  });

  it('a daemon without diagnostics: no guess about stores either way', async () => {
    wire({ daemon: null });
    render(<EvaluateSurface navigate={vi.fn()} />);
    const card = await screen.findByTestId('evaluate-measures');
    await waitFor(() => expect(within(card).getAllByTestId('evaluate-caveat').length).toBe(2));
    expect(card.getAttribute('data-store')).toBe('unknown');
  });
});

describe('Draft rules: Evaluate → Steer’s assistant, typed in, never sent', () => {
  it('seeds the request for the gap’s type and Steer opens the assistant with it in the composer', async () => {
    const user = userEvent.setup();
    wire();
    const navigate = vi.fn();
    render(<EvaluateSurface navigate={navigate} />);
    const drafts = await screen.findAllByTestId('evaluate-draft');
    await user.click(drafts[0]!);
    expect(navigate).toHaveBeenCalledWith('/steering/policies?type=security');
    expect(useSteerDraft.getState().seed?.text).toBe(draftRequest('security', gapsByType(RESULTS)[0]!.gaps));
    cleanup();

    render(<SteerSurface pathname="/steering/policies" search="?type=security" runs={[]} navigate={vi.fn()} />);
    const dock = await screen.findByTestId('steer-dock');
    const input = within(dock).getByTestId('assist-input');
    expect((input as HTMLTextAreaElement).value).toContain('- behaviour b1\n- behaviour b2');
    // Taken once: a remount does not reopen it, and nothing was POSTed (the operator sends).
    expect(useSteerDraft.getState().seed).toBeNull();
    expect(apiFetch.mock.calls.some(([, init]) => (init as { method?: string } | undefined)?.method === 'POST')).toBe(false);
  });
});

describe('codex r1 fixes', () => {
  it('#1 Add a rule waits for the rules: a failed read cannot suggest an id that overwrites one', async () => {
    listConformanceRules.mockReset();
    listConformanceRules.mockRejectedValue(new Error('transient'));
    wire();
    render(<SteerSurface pathname="/rules" search="" runs={[]} navigate={vi.fn()} />);
    await screen.findByTestId('rules-error');
    expect(screen.getByTestId('steer-add-rule')).toBeDisabled();
  });

  it('#2 a run from another rule store puts no eval badge on this daemon’s rules; the daemon’s own run does', async () => {
    listConformanceRules.mockResolvedValue({ rules: [rule('SEC-1')] });
    wire({ top: TEMP });
    const { unmount } = render(<SteerSurface pathname="/rules" search="" runs={[]} navigate={vi.fn()} />);
    const row = await screen.findByTestId('rules-row');
    await screen.findByText(/another rule store/);
    expect(row).not.toHaveTextContent('nearest rule to a gap');
    unmount();
    wire({ top: DAEMON });
    render(<SteerSurface pathname="/rules" search="" runs={[]} navigate={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('rules-row')).toHaveTextContent('nearest rule to a gap'));
  });

  it('#3 the history says which run tested another store, and splits its caught', async () => {
    const user = userEvent.setup();
    wire();
    render(<EvaluateSurface navigate={vi.fn()} />);
    const tags = await screen.findAllByTestId('eval-history-other-store');
    expect(tags.length).toBeGreaterThan(0);
    const row = screen.getAllByTestId('eval-history-row').find((r) => r.getAttribute('data-run-id') === 'r3')!;
    await user.click(within(row).getAllByRole('button')[0]!);
    expect(await within(row).findByTestId('eval-history-detail-other-store')).toBeInTheDocument();
    expect(within(row).getByTestId('eval-history-detail-summary')).toHaveTextContent('0 of 3 bad blocked · 2 good left alone');
  });

  it('#4 no eval, no claim; a corpus with no bad behaviours never says "every bad behaviour was blocked"', async () => {
    apiFetch.mockImplementation((path: unknown) => (String(path) === '/testing/evals' ? Promise.resolve({ runs: [] }) : Promise.reject(new ApiError(404, 'Not Found'))));
    const { unmount } = render(<EvaluateSurface navigate={vi.fn()} />);
    const fp = await screen.findByTestId('evaluate-stat-fp');
    await waitFor(() => expect(fp).toHaveTextContent('No eval yet'));
    expect(fp.getAttribute('data-tone')).toBe('accent');
    unmount();
    const goodOnly = [res('g1', 'good', 'security', 'caught')];
    apiFetch.mockImplementation((path: unknown) => {
      const p = String(path);
      if (p === '/testing/evals') return Promise.resolve({ runs: [summaryRow('g', 1, DAEMON)] });
      if (p === '/testing/evals/g') return Promise.resolve({ ...summaryRow('g', 1, DAEMON), summary: { total: 1, caught: 1, gaps: 0, false_positives: 0 }, results: goodOnly });
      return Promise.reject(new ApiError(404, 'Not Found'));
    });
    render(<EvaluateSurface navigate={vi.fn()} />);
    expect(await screen.findByTestId('evaluate-gaps-none')).toHaveTextContent('this corpus has no bad behaviours, so nothing could be blocked');
  });

  it('#5 closing the assistant keeps its draft; reopening shows it again', async () => {
    const user = userEvent.setup();
    wire();
    render(<SteerSurface pathname="/rules" search="" runs={[]} navigate={vi.fn()} />);
    await user.click(await screen.findByTestId('steer-chat'));
    const input = await screen.findByTestId('assist-input');
    expect(input).toHaveFocus();
    await user.type(input, 'keep this draft');
    await user.click(screen.getByTestId('assist-dock-toggle'));
    expect(screen.getByTestId('steer-dock')).not.toBeVisible();
    expect(screen.getByTestId('steer-chat')).toHaveFocus();
    await user.click(screen.getByTestId('steer-chat'));
    expect(screen.getByTestId('steer-dock')).toBeVisible();
    expect(screen.getByTestId('assist-input')).toHaveValue('keep this draft');
  });

  it('#6 a warn effect carries an effect but does not block', () => {
    expect(steerTotals([rule('W-1', 'warn'), rule('G-1')])).toEqual({ live: 2, retired: 0, gating: 1, blocks: 0, guidance: 1 });
  });

  it('#7 the table editor’s own filter moves keep the table, on the Steer tab’s address', () => {
    expect(tableAddress('/steering/policies?type=security')).toBe(deskTabPath('steer', '/steering/policies?type=security&view=table'));
    expect(tableAddress('/steering/policies')).toBe(deskTabPath('steer', '/steering/policies?view=table'));
    expect(tableAddress('/steering/proposals')).toBe(deskTabPath('steer', '/steering/proposals'));
    expect(tableAddress('/s/run-1')).toBe('/s/run-1');
  });

});

describe('codex r1 #9 / r2 #4, #6 / r3 #1: a run made here, ordered without clocks', () => {
  it('shows until a history read STARTED after it answers; a failed refresh keeps it and says so', async () => {
    const user = userEvent.setup();
    let historyUp = true;
    apiFetch.mockImplementation((path: unknown, init?: { method?: string }) => {
      const p = String(path);
      if (p === '/testing/evals/run' && init?.method === 'POST') return Promise.resolve({ results: RESULTS, summary: SUMMARY, degraded: null });
      if (p === '/testing/evals') return historyUp ? Promise.resolve({ runs: [summaryRow('r3', 300, DAEMON)] }) : Promise.reject(new ApiError(503, 'down'));
      if (p === '/testing/evals/r3') return Promise.resolve({ ...summaryRow('r3', 300, DAEMON), results: RESULTS });
      if (p === '/diagnostics') return Promise.resolve({ stores: [{ name: 'core.db', path: DAEMON, bytes: 1 }] });
      return Promise.reject(new ApiError(404, 'Not Found'));
    });
    render(<EvaluateSurface navigate={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('testing-evals-provenance')).toHaveTextContent('built-in sample set'));
    historyUp = false;
    await user.click(screen.getByTestId('evaluate-options-toggle'));
    await user.type(screen.getByTestId('testing-evals-corpus'), 'evals:mine');
    await user.click(screen.getByTestId('testing-evals-run'));
    // The refresh after the run failed: the run made here is the answer, and the failure is said.
    await waitFor(() => expect(screen.getByTestId('testing-evals-provenance')).toHaveTextContent('Corpus: evals:mine'));
    expect(await screen.findByTestId('evaluate-refresh-failed')).toBeInTheDocument();
    expect(useEvalReportStore.getState().latest).not.toBeNull();
  });

  it('a deposit older than a read that answered is retired for good, whatever the clocks say', async () => {
    useEvalReportStore.setState({ latest: { report: { results: RESULTS, summary: SUMMARY, degraded: null }, corpus: 'mine', at: Date.now() + 3_600_000, seq: 0 } });
    wire();
    render(<EvaluateSurface navigate={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('testing-evals-provenance')).toHaveTextContent('Corpus: built-in sample set'));
    await waitFor(() => expect(useEvalReportStore.getState().latest).toBeNull());
  });
});

describe('codex r2 fixes', () => {
  it('#1 a failed refresh keeps the rules (and the create form’s collision list) and says so', async () => {
    listConformanceRules.mockReset();
    listConformanceRules.mockResolvedValueOnce({ rules: [rule('PAT-100')] }).mockRejectedValue(new Error('transient'));
    wire();
    const user = userEvent.setup();
    render(<SteerSurface pathname="/rules" search="" runs={[]} navigate={vi.fn()} />);
    await screen.findByTestId('rules-row');
    await user.click(screen.getByTestId('steer-refresh'));
    expect(await screen.findByTestId('steer-refresh-failed')).toBeInTheDocument();
    expect(screen.getAllByTestId('rules-row')).toHaveLength(1);
    // The create form still knows PAT-100 is taken.
    await user.click(screen.getByTestId('steer-add-rule'));
    const id = await screen.findByTestId('steering-form-id');
    await user.clear(id);
    await user.type(id, 'PAT-100');
    expect(screen.getByTestId('steering-form-save')).toBeDisabled();
  });

  it('#2 a late create save closes only its own opening', async () => {
    let resolveSave: (v: unknown) => void = () => {};
    upsertConformanceRule.mockImplementation(() => new Promise((r) => { resolveSave = r; }));
    wire();
    const user = userEvent.setup();
    render(<SteerSurface pathname="/rules" search="" runs={[]} navigate={vi.fn()} />);
    await screen.findAllByTestId('rules-row');
    await user.click(screen.getByTestId('steer-add-rule'));
    await user.type(await screen.findByTestId('steering-form-statement'), 'First rule statement');
    await user.click(screen.getByTestId('steering-form-save'));
    await user.click(screen.getByTestId('steering-form-cancel'));
    await user.click(screen.getByTestId('steer-add-rule'));
    await user.type(await screen.findByTestId('steering-form-statement'), 'Second draft');
    resolveSave({ rule: rule('PAT-001') });
    await waitFor(() => expect(listConformanceRules.mock.calls.length).toBeGreaterThan(1));
    expect(screen.getByTestId('steering-form-statement')).toHaveValue('Second draft');
  });

  it('#3 a kept assistant authors for the page’s current type', async () => {
    const user = userEvent.setup();
    wire();
    const { rerender } = render(<SteerSurface pathname="/steering/policies" search="?type=architecture" runs={[]} navigate={vi.fn()} />);
    await user.click(await screen.findByTestId('steer-chat'));
    expect(screen.getByTestId('steer-dock')).toHaveTextContent('Steering · Architecture');
    await user.click(screen.getByTestId('assist-dock-toggle'));
    rerender(<SteerSurface pathname="/steering/policies" search="?type=security" runs={[]} navigate={vi.fn()} />);
    await user.click(screen.getByTestId('steer-chat'));
    expect(screen.getByTestId('steer-dock')).toHaveTextContent('Steering · Security');
  });



  it('#7 runs from different rule stores never fold into one history group', () => {
    const a = summaryRow('a', 2, DAEMON) as never;
    const b = summaryRow('b', 1, TEMP) as never;
    expect(groupEvalRuns([a, b])).toHaveLength(2);
  });

  it('#8 Import is a modal: focus moves in, and back to Import on close', async () => {
    const user = userEvent.setup();
    wire();
    render(<SteerSurface pathname="/rules" search="" runs={[]} navigate={vi.fn()} />);
    await screen.findAllByTestId('rules-row');
    await user.click(screen.getByTestId('steer-import'));
    expect(screen.getByTestId('steer-import-type')).toHaveFocus();
    expect(document.querySelector('.wk-se-scroll')?.hasAttribute('inert')).toBe(true);
    await user.click(screen.getByTestId('steer-import-cancel'));
    expect(screen.getByTestId('steer-import')).toHaveFocus();
    expect(document.querySelector('.wk-se-scroll')?.hasAttribute('inert')).toBe(false);
  });

  it('#9 a type card keeps the MCP filter', async () => {
    wire();
    render(<SteerSurface pathname="/steering/policies" search="?mcp=1" runs={[]} navigate={vi.fn()} />);
    const sec = (await screen.findAllByTestId('steer-type')).find((a) => a.getAttribute('data-steering-type') === 'security')!;
    expect(sec.getAttribute('href')).toContain('mcp=1');
  });

  it('#5 the tag filter (targets, applies_to) is back', async () => {
    const user = userEvent.setup();
    listConformanceRules.mockResolvedValue({ rules: [{ ...rule('A-1'), applies_to: ['build'] }, rule('B-1')] });
    wire();
    render(<SteerSurface pathname="/rules" search="" runs={[]} navigate={vi.fn()} />);
    await screen.findAllByTestId('rules-row');
    expect(ruleFacets({ ...rule('A-1'), applies_to: ['build'], targets: { project: 'payments' } } as SteeringRule)).toContain('project=payments');
    await user.type(screen.getByTestId('steer-facet-input'), 'applies_to=build');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.getAllByTestId('rules-row').map((r) => r.getAttribute('data-rule-id'))).toEqual(['A-1']));
  });
});

describe('codex r3 fixes', () => {
  it('#3 a failed rules read claims no counts', async () => {
    listConformanceRules.mockReset();
    listConformanceRules.mockRejectedValue(new Error('503'));
    wire();
    render(<SteerSurface pathname="/rules" search="" runs={[]} navigate={vi.fn()} />);
    await screen.findByTestId('rules-error');
    const tile = screen.getByTestId('steer-stat-rules');
    expect(tile).toHaveTextContent('Couldn’t read the rules');
    expect(tile).not.toHaveTextContent('none block');
    expect(screen.getAllByTestId('steer-type').every((c) => c.textContent?.includes('—'))).toBe(true);
  });

  it('#4 "Edit as a table" opens on the same type, MCP and unused filters', async () => {
    wire();
    render(<SteerSurface pathname="/steering/policies" search="?type=security&mcp=1&usage=unused" runs={[]} navigate={vi.fn()} />);
    const link = await screen.findByTestId('steer-table');
    const q = new URL(link.getAttribute('href')!, 'http://x').searchParams;
    expect([q.get('type'), q.get('mcp'), q.get('usage'), q.get('view')]).toEqual(['security', '1', 'unused', 'table']);
  });
});

describe('codex r4 fixes', () => {
  it('#1 a nearest rule from another store is named, not linked into this daemon’s rules', async () => {
    const user = userEvent.setup();
    wire({ top: TEMP });
    const { unmount } = render(<EvaluateSurface navigate={vi.fn()} />);
    await screen.findByTestId('evaluate-measures');
    await waitFor(() => expect(screen.getByTestId('evaluate-measures').getAttribute('data-store')).toBe('other'));
    await user.click(screen.getAllByTestId('testing-evals-gap-toggle')[0]!);
    expect(screen.getByTestId('testing-evals-nearest-foreign')).toHaveTextContent('SEC-1');
    expect(screen.queryByTestId('testing-evals-nearest-link')).toBeNull();
    unmount();
    wire({ top: DAEMON });
    render(<EvaluateSurface navigate={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('evaluate-measures').getAttribute('data-store')).toBe('daemon'));
    await user.click(screen.getAllByTestId('testing-evals-gap-toggle')[0]!);
    expect(screen.getByTestId('testing-evals-nearest-link')).toHaveAttribute('data-rule-id', 'SEC-1');
  });

  it('#2 a late retirement closes only its own dialog', async () => {
    let finish: (v: unknown) => void = () => {};
    retireConformanceRule.mockImplementation(() => new Promise((r) => { finish = r; }));
    listConformanceRules.mockResolvedValue({ rules: [rule('A-1'), rule('B-1')] });
    wire();
    const user = userEvent.setup();
    render(<SteerSurface pathname="/rules" search="" runs={[]} navigate={vi.fn()} />);
    const rows = await screen.findAllByTestId('rules-row');
    const retireOf = (id: string): HTMLElement => within(rows.find((r) => r.getAttribute('data-rule-id') === id)!).getByTestId('steer-retire');
    await user.click(retireOf('A-1'));
    const dialog = (): HTMLElement => screen.getByRole('dialog', { name: /Retire/ });
    const fields = (): HTMLElement[] => within(dialog()).getAllByRole('textbox');
    await user.type(fields()[0]!, 'A-1');
    await user.type(fields()[1]!, 'reason A');
    await user.click(within(dialog()).getByRole('button', { name: /Retire rule/ }));
    await user.click(within(dialog()).getByRole('button', { name: /Cancel/ }));
    await user.click(retireOf('B-1'));
    await user.type(fields()[1]!, 'reason B draft');
    finish({ ok: true });
    await waitFor(() => expect(screen.getByTestId('steering-saved-note')).toHaveTextContent('Retired A-1'));
    expect(fields()[1]).toHaveValue('reason B draft');
  });
});

describe('agy r1 fixes', () => {
  it('valid JSON that is not a list says so, and sends nothing', async () => {
    wire();
    expect(await importRuleFile({ name: 'one.json', content: '{"id":"R-1"}' }, 'security')).toEqual([{ tone: 'fail', text: 'one.json is not a list of rules.' }]);
    expect(await importRuleFile({ name: 'null.json', content: 'null' }, 'security')).toEqual([{ tone: 'fail', text: 'null.json is not a list of rules.' }]);
    expect((await importRuleFile({ name: 'bad.json', content: '{' }, 'security'))[0]?.text).toContain('is not valid JSON');
    expect(apiFetch.mock.calls.some(([, init]) => (init as { method?: string } | undefined)?.method === 'POST')).toBe(false);
  });

  it('a refused doctrine doc is named as the doc, not "Rule 1"', async () => {
    apiFetch.mockResolvedValue({ results: [{ status: 'rejected', name: 'soc2.md', reason: 'duplicate' }] });
    const notes = await importRuleFile({ name: 'soc2.md', content: '## Rules\n- x' }, 'security');
    expect(notes[1]?.text).toMatch(/^soc2\.md skipped: /);
  });

  it('turning one filter off keeps the others, and an empty filtered list says it is the filter', async () => {
    wire();
    render(<SteerSurface pathname="/steering/policies" search="?type=security&mcp=1&usage=unused" runs={[]} navigate={vi.fn()} />);
    const q = (el: HTMLElement): URLSearchParams => new URL(el.getAttribute('href')!, 'http://x').searchParams;
    const usageClear = await screen.findByTestId('steering-usage-filter-clear');
    expect([q(usageClear).get('type'), q(usageClear).get('mcp'), q(usageClear).get('usage')]).toEqual(['security', '1', null]);
    const mcpClear = screen.getByTestId('steer-mcp-clear');
    expect([q(mcpClear).get('type'), q(mcpClear).get('mcp'), q(mcpClear).get('usage')]).toEqual(['security', null, 'unused']);
    // No rule here governs MCP calls, so the list is empty because of the filter, not the store.
    expect(await screen.findByTestId('steer-rules-empty')).toHaveTextContent('No rule matches these filters.');
  });

  it('a finished import can not be sent twice', async () => {
    const user = userEvent.setup();
    wire();
    render(<SteerSurface pathname="/rules" search="" runs={[]} navigate={vi.fn()} />);
    await screen.findAllByTestId('rules-row');
    apiFetch.mockImplementation((path: unknown) => String(path) === '/governance/steering/import'
      ? Promise.resolve({ results: [{ status: 'imported', ids: ['N-1'] }] })
      : Promise.reject(new ApiError(404, 'Not Found')));
    await user.click(screen.getByTestId('steer-import'));
    const input = screen.getByTestId('steer-import-file').querySelector('input[type=file]') as HTMLInputElement;
    await user.upload(input, new File(['[{"id":"N-1","statement":"s"}]'], 'batch.json', { type: 'application/json' }));
    await user.click(screen.getByTestId('steer-import-go'));
    await screen.findByTestId('steer-import-notes');
    expect(screen.getByTestId('steer-import-go')).toBeDisabled();
    expect(apiFetch.mock.calls.filter(([p]) => p === '/governance/steering/import')).toHaveLength(1);
  });

  it('a failed eval read never says "no eval yet" or "never run"', async () => {
    apiFetch.mockImplementation(() => Promise.reject(new Error('socket hang up')));
    render(<EvaluateSurface navigate={vi.fn()} />);
    await screen.findByTestId('evaluate-read-error');
    expect(screen.getByTestId('evaluate-last-run')).toHaveTextContent('Couldn’t read the last run');
    expect(screen.getByTestId('evaluate-stat-caught')).toHaveTextContent('Couldn’t read the last eval');
    expect(screen.getByTestId('evaluate-tiles')).not.toHaveTextContent('No eval yet');
    cleanup();
    render(<SteerSurface pathname="/rules" search="" runs={[]} navigate={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('steer-stat-eval')).toHaveTextContent('Couldn’t read the last eval'));
    expect(screen.getByTestId('steer-stat-eval')).not.toHaveTextContent('None yet');
  });
});
