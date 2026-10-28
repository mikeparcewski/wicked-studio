// J4 on crew 0.16.6 (runs 115fabdb and c5320434, rig :7721, GET only): the decision dock's face, primary, estimate and
// thread words, replayed on the runs' own event logs (tests/fixtures/j4-0166-gates.json, trimmed; paths scrubbed).
import { describe, expect, it } from 'vitest';
import fixture from './fixtures/j4-0166-gates.json';
import type { CoreEvent, RosterSeat, SessionView, WorkUnit } from '../src/api/types.js';
import { SEND_BACK_NAMED_LABEL, sessionGateChoices } from '../src/board/gateRowModel.js';
import { FLOOR_OVERRIDE_KEY } from '../src/board/floorOverride.js';
import { SKIP_QE_KEY } from '../src/board/qeSkip.js';
import { decisionMessages } from '../src/board/runConversation.js';
import { rerunOffer } from '../src/components/rerunModel.js';
import { gateCause } from '../src/board/gateHeadline.js';
import type { OpenGate } from '../src/store/gates.js';

type Run = { session: Record<string, unknown>; units: WorkUnit[]; events: CoreEvent[] };
const RUNS = fixture as unknown as Record<'115fabdb' | 'c5320434', Run>;
const ROSTER = ['claude', 'codex', 'pi', 'copilot'].map((key) => ({ key, display_name: key === 'pi' ? 'Pi CLI' : key[0]!.toUpperCase() + key.slice(1), signed_in: true })) as unknown as RosterSeat[];

/** The run as it stood when the gate at log position `seq` opened: its events up to it, and that gate. */
function at(id: '115fabdb' | 'c5320434', seq: number): { view: SessionView; gate: OpenGate; events: CoreEvent[] } {
  const r = RUNS[id];
  const events = r.events.filter((e) => (e as unknown as { seq: number }).seq <= seq);
  const asked = events[events.length - 1] as unknown as { type: string; ord: number; prompt: string; gateKind: string };
  expect(asked.type).toBe('awaitingHuman');
  const runId = r.session['id'] as string;
  const gate: OpenGate = { runId, ord: asked.ord, prompt: asked.prompt, gateKind: asked.gateKind, lifecycle: 'open', receivedAt: 0 } as OpenGate;
  return { view: { session: { ...r.session, status: 'awaiting_human' }, units: r.units } as unknown as SessionView, gate, events };
}
const model = (id: '115fabdb' | 'c5320434', seq: number) => {
  const { view, gate, events } = at(id, seq);
  const pool = (view.session as unknown as { clis: string[] }).clis;
  const m = sessionGateChoices({ runId: view.session.id, gate, units: view.units, events, pool, roster: ROSTER, rerun: null, fullVerdict: null, rejudge: null })!;
  return { m, view, gate, events, pool };
};
const primary = (m: ReturnType<typeof sessionGateChoices>) => (m!.recommended === null ? null : m!.choices[m!.recommended]!);

describe('J4 crew 115fabdb G2: the no-change answer at the fix floor', () => {
  it('the face names the 2 failures only this change has, the 4 base ones counted and folded; the primary sends them back named', () => {
    const { m } = model('115fabdb', 3604);
    expect(m.failingTests?.split?.fresh).toEqual([
      'tests/mcp-policies.test.ts > the policy preview matrix (S6 proving test) > equals the engine evaluation over the same fixture rules, cell by cell',
      'tests/seat-work-default.test.ts > seat.work_default on the wire > no overlay: no finding, and roleFindings is an empty list',
    ]);
    expect(m.failingTests?.split?.onBase).toHaveLength(4);
    const p = primary(m)!;
    expect(p.key).toBe('send-back');
    expect(p.label).toBe(SEND_BACK_NAMED_LABEL);
    expect(p.key).not.toBe(FLOOR_OVERRIDE_KEY);
    expect(m.noteDefault).toMatch(/^Fix only the tests this change broke \(the others fail on the base too\): tests\/mcp-policies/);
    // Own judgment stays one of the other options.
    expect([...m.choices, ...m.overflow].some((c) => c.key === FLOOR_OVERRIDE_KEY)).toBe(true);
  });

  it('the headline is the failures this change broke, before the missing judge', () => {
    const { m, view, gate, events, pool } = model('115fabdb', 3604);
    expect(gateCause({ view, gate, events, model: m, roster: ROSTER, pool }).headline).toBe('2 tests this change broke need fixing before the job can go on');
  });

  it('"Redo from the fix step" is timed from the fix step\'s longest attempt, its 40-min check run included', () => {
    const { view, gate, events } = at('115fabdb', 3604);
    const offer = rerunOffer({ runId: view.session.id, status: 'awaiting_human', units: view.units, gateOrd: gate.ord, prompt: gate.prompt, gateKind: gate.gateKind ?? null, events })!;
    expect(offer.phase).toBe('fix');
    expect(offer.minutes).toBeGreaterThanOrEqual(45);
  });
});

describe('J4 crew 115fabdb G3: no judge, four helpers signed in', () => {
  it('the headline names a signed-in helper, never "sign in a second helper"', () => {
    const { m, view, gate, events, pool } = model('115fabdb', 3628);
    const cause = gateCause({ view, gate, events, model: m, roster: ROSTER, pool });
    expect(cause.judgeWait).toBe(true);
    expect(cause.headline).toBe('Codex is signed in but wasn’t used to check this step');
  });
});

describe('J4 core c5320434: the face and the override paths', () => {
  it('G2 (fix floor, every failure on the base): no change-only failure, said in words; the override leads', () => {
    const { m } = model('c5320434', 134);
    expect(m.failingTests?.split?.fresh).toEqual([]);
    expect(m.failingTests?.split?.onBase).toHaveLength(5);
    expect(primary(m)?.key).toBe(FLOOR_OVERRIDE_KEY);
  });

  it('G3 (verify floor): the one test only this change fails leads (it was only in the retry); own judgment\'s absence is said; QE is skippable here', () => {
    const { m } = model('c5320434', 3351);
    expect(m.failingTests?.split?.fresh).toEqual(['actor::live_output_stream_tests::cli_output_chunks_surface_as_throttled_unit_output_deltas']);
    expect(m.failingTests?.split?.onBase).toHaveLength(4);
    expect(primary(m)?.label).toBe(SEND_BACK_NAMED_LABEL);
    expect(m.whyNot?.[0]).toMatch(/^Your own judgment isn’t offered while QE has no verdict on this tree\. Skip QE with a reason/);
    expect([...m.choices, ...m.overflow].some((c) => c.key === SKIP_QE_KEY)).toBe(true);
  });

  it('G4 (the floor fix changed nothing; all 4 on the base): the fix\'s line is not "from the 1 failing check"', () => {
    const { m } = model('c5320434', 3382);
    expect(m.failingTests?.split?.fresh).toEqual([]);
    expect(m.consequence ?? '').not.toMatch(/1 failing check/);
    expect(m.whyNot?.[0]).toMatch(/^Your own judgment isn’t offered while QE has no verdict/);
  });
});

describe('J4: the thread says who acted', () => {
  it('115fabdb: the engine\'s floor round is the job\'s; the only "Sent it back" is the operator\'s Run QE again', () => {
    const d = decisionMessages(RUNS['115fabdb'].events);
    expect(d.filter((x) => x.text === 'Sent it back').map((x) => [x.by, x.ord])).toEqual([['you', 6]]);
    expect(d.find((x) => x.ord === 2)?.text).toBe('Approved the plan');
    expect(d.some((x) => x.by === 'job' && x.text === 'The job retried automatically' && x.ord === 6)).toBe(true);
    expect(d.filter((x) => x.by === 'you').map((x) => x.ord)).toEqual([2, 6, 7, 9, 6]);
  });
});
