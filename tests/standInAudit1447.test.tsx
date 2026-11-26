/**
 * studio#1447: the DES-STANDIN-001 §9 studio tests the audit found missing or partial on main.
 *  - T-S1: a delivery that mixes a real judge gate with a stand-in gate is never "Independently accepted".
 *  - T-S3: a team council that never convened (wicked-core#1822 `not_convened`, with its `detail`) says it never
 *    started, and why, never "could not rule (not convened)".
 *  - T-S4: a stand-in judge's verdict line says nothing of "distinct" or "identity-distinct", aria and titles included.
 *  - T-S5: a reduced-assurance gate says "Reduced assurance" and offers no stand-in.
 * T-S2 (the six launch callers) closed with #1444.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fixture from './fixtures/run-b0ade71f-standin.json';
import type { CoreEvent, SessionView } from '../src/api/types.js';
import type { TeamRow } from '../src/api/teamPlan.js';
import { deliveryReceiptOf, receiptWords } from '../src/board/assuranceModel.js';
import { councilLine, disputeFindingsOf } from '../src/board/gateFindings.js';
import { GateVerdict } from '../src/components/GateVerdict.js';
import { gateVerdict } from '../src/components/gateVerdictModel.js';
import { GateRow } from '../src/components/session/GateRow.js';
import { useRunEventStore } from '../src/store/events.js';
import type { OpenGate } from '../src/store/gates.js';
import { makeUnit, makeView } from './factories.js';

vi.mock('../src/api/client.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/api/client.js')>();
  return { ...original, api: { ...original.api, getRunEvents: vi.fn().mockResolvedValue({ events: [] }) } };
});

afterEach(() => { cleanup(); useRunEventStore.setState({ byRun: {} }); });

const FIXTURE = fixture as unknown as { run: SessionView; events: CoreEvent[] };
const JUDGE = "Claude Code stood in for the judge, using Claude Code's default model: only Claude Code was signed in";

describe('studio#1447 T-S1: a mixed delivery is not "Independently accepted"', () => {
  it('one gate judged on another helper, one judged by a stand-in', () => {
    const real = { ord: 1, assurance: { mode: 'full', required: ['judge'], ran: ['pinned_validator', 'judge'], skipped: [], creator: 'claude', evaluator: null, judge: 'codex', tree: null, attempt: 0 } };
    const standIn = { ord: 2, assurance: { mode: 'full', required: ['judge'], ran: ['pinned_validator'], skipped: [{ instrument: 'judge', reason: 'stand_in', detail: JUDGE }], creator: 'claude', evaluator: null, judge: null, tree: null, attempt: 0, roles: [{ role: 'judge', seat: 'claude~2', filled: 'stand_in', state: 'answered', standIn: { cli: 'claude~2', label: JUDGE } }] } };
    for (const units of [[real, standIn], [{ ...standIn, ord: 1 }, { ...real, ord: 2 }]]) {
      const view = { session: { id: 'r', status: 'completed' }, units } as unknown as SessionView;
      const r = deliveryReceiptOf(view, [], null)!;
      const words = receiptWords(r, true);
      expect(words.label).not.toMatch(/independent/iu);
      expect(words.who ?? '').toContain('Claude Code (stand-in)');
    }
  });
});

describe('studio#1447 T-S3: a council that never convened says so', () => {
  // wicked-core src/team/events_tests.rs core_1822_a_not_convened_ruling_carries_its_detail_and_old_rows_are_unchanged:
  // the engine's own no-verdict row (supervisor::convene_one's `no`).
  const ruled = (detail: string): TeamRow => ({
    event_id: 30, event_type: 'wicked.team.council.ruled',
    payload: { attempt: 2, ord: 4, subject: 'finding:1', by: 'engine', verdict: 'no_verdict', reason: 'not_convened', task_id: null, consensus: false, agreement_pct: 0, dissent: [], returned: 0, seated: 0, detail },
  });
  const rows = (detail: string): TeamRow[] => [
    { event_id: 10, event_type: 'wicked.team.finding.raised', payload: { attempt: 2, ord: 4, by: 'pi', finding_id: 'f-1', raise_seq: 1, severity: 'high', path: 'src/a.ts', line: 3, claim: 'It breaks.' } },
    { event_id: 20, event_type: 'wicked.team.gate.opened', payload: { attempt: 2, ord: 4, kind: 'team_dispute', finding_ids: ['f-1'] } },
    ruled(detail),
  ];

  it('the step ended before its turn', () => {
    const [f] = disputeFindingsOf(rows('the step ended before its turn'), 4, []);
    expect(councilLine(f!.council!)).toBe('The council never started: the step ended before its turn');
  });

  it('another council held the host slot, and with no detail it still never says "could not rule"', () => {
    const [f] = disputeFindingsOf(rows('another council held the host slot'), 4, []);
    expect(councilLine(f!.council!)).toBe('The council never started: another council held the host slot');
    expect(councilLine({ ...f!.council!, detail: null })).toBe('The council never started');
    // A council that sat and did not rule keeps its words.
    expect(councilLine({ ...f!.council!, reason: 'no_quorum', detail: null })).toBe('The council could not rule (no quorum)');
  });
});

describe('studio#1447 T-S4: a stand-in judge is never called distinct', () => {
  it('no "distinct" in the words, the titles or any aria text', () => {
    const view = gateVerdict(FIXTURE.events, 3)!;
    expect(view.judgeStandIn).toBe(JUDGE);
    const { container } = render(<GateVerdict view={view} phase="review" />);
    expect(container.textContent ?? '').not.toMatch(/distinct/iu);
    const said = [...container.querySelectorAll('*')].flatMap((el) => [...el.attributes]
      .filter((a) => a.name === 'title' || a.name.startsWith('aria-'))
      .map((a) => a.value));
    expect(said.join('\n')).not.toMatch(/distinct/iu);
    expect(said.join('\n')).not.toMatch(/same seat|single default runner/iu);
  });
});

describe('studio#1447 T-S5: a reduced-assurance gate draws no stand-in offer', () => {
  it('says "Reduced assurance" and offers no stand-in', () => {
    const RUN = 'r-reduced';
    useRunEventStore.setState({ byRun: { [RUN]: [{ type: 'sessionStarted', session: RUN, assurance: { mode: 'reduced', required: ['distinct_evaluator', 'judge'] } }] as unknown as CoreEvent[] } });
    const units = [makeUnit({ id: `${RUN}:build`, session_id: RUN, ord: 1, role: 'creator', stage: 'build', assigned_cli: 'claude' })];
    const view = makeView({ id: RUN, status: 'awaiting_human' } as never, units);
    const g: OpenGate = { runId: RUN, ord: 1, prompt: 'Approve unit 1 before it runs: build', lifecycle: 'open', receivedAt: 1, gateKind: 'def' };
    render(<GateRow view={view} gate={g} />);
    expect(screen.getByTestId('session-gate-reduced').textContent).toBe('Reduced assurance');
    expect(document.querySelector('[data-choice-key^="use_stand_ins"]')).toBeNull();
    expect(document.body.textContent ?? '').not.toMatch(/stand-in/iu);
  });
});
