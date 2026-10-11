// studio#724 (0.7.10) + coordinator QE item: plain words on the session sheet's Activity and Helpers
// tabs, and a deliver card that does not offer a delivery crew will refuse.
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeUnit, makeView } from './factories.js';
import type { CoreEvent, RunAcceptanceSummary, SessionView } from '../src/api/types.js';
import type { ChainModel } from '../src/board/chainModel.js';

vi.mock('../src/hooks/useRunModel.js', () => ({ useRunModel: () => ({ session: { id: 'r1' } }) }));

const { ObjectSheet } = await import('../src/components/sheets/ObjectSheet.js');
const { ProposalCard } = await import('../src/components/session/ProposalCard.js');
const { openSheet, useSheets } = await import('../src/store/sheets.js');
const { useGateStore } = await import('../src/store/gates.js');
const { useRunEventStore } = await import('../src/store/events.js');
const { useGateActionStore } = await import('../src/board/gateActions.js');
const { clearCachedRoster } = await import('../src/store/rosterCache.js');

const NOW = Date.now();
const RUN = makeView({ id: 'r1', status: 'executing', problem: 'fix the double charge', unit_ix: 3 }, [
  makeUnit({ id: 'r1:build', session_id: 'r1', ord: 3, stage: 'build', role: 'creator', status: 'done', assigned_cli: 'claude' }),
  makeUnit({ id: 'r1:review', session_id: 'r1', ord: 4, stage: 'review', role: 'evaluator', status: 'pending', assigned_cli: 'pi' }),
]);
const ROSTER = [
  { key: 'claude', display_name: 'Claude Code', binary: 'claude', enabled_for_council: true },
  { key: 'pi', display_name: 'Pi CLI', binary: 'pi', enabled_for_council: true },
];
let events: unknown[] = [];
beforeEach(() => {
  events = [];
  clearCachedRoster();
  useSheets.setState({ open: null, pointed: null, stopping: {} } as never);
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    const path = new URL(url, 'http://x').pathname.replace(/^\/api\/v1/, '');
    const body = path.endsWith('/events') ? { events } : path === '/roster' ? { roster: ROSTER } : {};
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

/** What a person reads by default: everything outside closed Technical details. */
function defaultLayer(el: HTMLElement): string {
  const c = el.cloneNode(true) as HTMLElement;
  c.querySelectorAll('details').forEach((d) => d.remove());
  return c.textContent ?? '';
}
const JARGON = /discipline|\bseats?\b|council|\bjudge\b|\bunit \d|wicked-garden-governed-worker|failing over/i;

describe('Activity says what happened in plain words; engine wording is Technical details', () => {
  it('no discipline line, no "Unit 4 verdict is NOT PASS", no seat failover prose in the default layer', async () => {
    events = [
      { type: 'unitDispatched', session: 'r1', ord: 3, attempt: 0, baseSkill: { name: 'wicked-garden-governed-worker', role: 'evaluator', handed: true }, ts: NOW - 90_000 },
      { type: 'stepFailed', session: 'r1', ord: 3, detail: "seat 'claude' failed (worker error); failing over to 'pi' (seats worker-failed on this unit: 1/5)", ts: NOW - 60_000 },
      { type: 'awaitingHuman', session: 'r1', ord: 4, prompt: 'Unit 4 verdict is NOT PASS — confirm to retry the phase, or request changes', ts: NOW - 30_000 },
    ];
    render(<ObjectSheet runs={[RUN]} navigate={() => {}} needCount={0} />);
    act(() => openSheet({ kind: 'session', sessionId: 'run:r1' }, 'activity'));
    const list = await screen.findByTestId('sheet-activity');
    await screen.findAllByTestId('sheet-activity-line');
    expect(screen.getAllByTestId('sheet-activity-line')).toHaveLength(3);
    expect(defaultLayer(list)).not.toMatch(JARGON);
    expect(defaultLayer(list)).not.toMatch(/NOT PASS/); // the engine's capitals, not the plain "did not pass"
    // The engine's own words are still there for whoever opens the details.
    expect(list.textContent).toContain('failing over');
  });
});

describe('Helpers tab names each helper once, the way the card does', () => {
  it('"Claude Code", "Pi CLI" — never the raw keys "claude", "pi"', async () => {
    render(<ObjectSheet runs={[RUN]} navigate={() => {}} needCount={0} />);
    act(() => openSheet({ kind: 'session', sessionId: 'run:r1' }, 'helpers'));
    const list = await screen.findByTestId('sheet-helpers');
    await within(list).findByText('Claude Code');
    const names = within(list).getAllByTestId('sheet-helper-open').map((b) => b.textContent);
    expect(names).toEqual(['Claude Code', 'Pi CLI']);
  });
});

describe('the deliver card does not offer a delivery crew will refuse (QE acceptance required, not passed)', () => {
  const R = 'r-qe';
  const CHAIN: ChainModel = { source: 'units', steps: [], proposed: false, transportLine: null, done: 0, total: 0, checked: null };
  const gate = { runId: R, ord: 2, prompt: 'deliver: push the run branch and open a PR on origin — confirm to deliver, reject to keep it local', lifecycle: 'open' as const, receivedAt: NOW, gateKind: 'deliver' };
  const QE = { type: 'qeAcceptanceDecided', session: R, qe: { status: 'required', basis: 'diff', score: 55, threshold: 20, reason: 'the diff scored 55', reasons: [] } };
  const view = (): SessionView => makeView({ id: R, status: 'awaiting_human' }, [
    makeUnit({ id: `${R}:build`, session_id: R, ord: 1, stage: 'build', role: 'creator', status: 'done', assigned_cli: 'claude' }),
    makeUnit({ id: `${R}:deliver`, session_id: R, ord: 2, stage: 'build', phase_ref: 'deliver', role: 'neutral', status: 'pending' }),
  ]);
  beforeEach(() => { useGateActionStore.setState({ byGate: {} }); useGateStore.setState({ gates: { [R]: gate } }); });
  it('a recorded QE FAIL: says so plainly and Deliver is not offered as if it will work', () => {
    events = [QE];
    useRunEventStore.setState({ byRun: { [R]: [QE] as unknown as CoreEvent[] } });
    const summary: RunAcceptanceSummary = { required: true, satisfied: false, walkthrough: { checked: 0, failed: 1, ownedByYou: 0, steps: 1, sealed: true, tree: 'abc' }, line: 'Not accepted yet: the walkthrough failed in chapter 4.' } as never;
    render(<ProposalCard view={view()} chain={CHAIN} acceptance={summary} />);
    expect(screen.getByTestId('session-proposal-acceptance').textContent).toMatch(/^QE acceptance failed — fix and re-run, or skip with a reason/);
    expect((screen.getByTestId('session-proposal-go') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('session-proposal-go-why')).toHaveTextContent('Delivery is refused until QE acceptance passes.');
  });
  it('no QE verdict yet on a QE-required run: never claims Deliver "doesn’t consult" QE, and Deliver waits', () => {
    events = [QE];
    useRunEventStore.setState({ byRun: { [R]: [QE] as unknown as CoreEvent[] } });
    const summary: RunAcceptanceSummary = { required: true, satisfied: false, walkthrough: null, line: 'Not accepted yet: no QE ledger at .wicked-qe — no QE run has recorded a verdict for this repository (missing ⇒ deny)' } as never;
    render(<ProposalCard view={view()} chain={CHAIN} acceptance={summary} />);
    const line = screen.getByTestId('session-proposal-acceptance').textContent ?? '';
    expect(line).not.toMatch(/doesn.t consult/);
    expect(line).toMatch(/QE acceptance hasn.t passed/);
    expect((screen.getByTestId('session-proposal-go') as HTMLButtonElement).disabled).toBe(true);
  });
  it('a run whose QE acceptance was waived or skipped still delivers', () => {
    const skipped = [{ ...QE, qe: { ...QE.qe, status: 'skipped', reason: 'QE acceptance skipped by operator: docs only' } }];
    events = skipped;
    useRunEventStore.setState({ byRun: { [R]: skipped as unknown as CoreEvent[] } });
    const summary: RunAcceptanceSummary = { required: true, satisfied: false, walkthrough: null, line: 'Not accepted yet: no QE ledger (missing ⇒ deny)' } as never;
    render(<ProposalCard view={view()} chain={CHAIN} acceptance={summary} />);
    expect((screen.getByTestId('session-proposal-go') as HTMLButtonElement).disabled).toBe(false);
  });
});
