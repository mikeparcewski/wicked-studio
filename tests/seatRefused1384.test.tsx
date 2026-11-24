// studio#1384: core#1850 (core#1674) denies a code-writing step under the source `seat_refused` when its own seat (its
// CLI sandbox, a read-only mount, file permissions) refused writes inside the project that the step never made
// afterwards. Studio had no words for it: the gate said "denied by seat_refused: …" and the step card said only
// "<step> failed." with the generic advice. The denial below is the engine's own: `seat_refused_reason`
// (wicked-core src/pipeline.rs, core#1850) over `tool_activity::SeatRefusal { path, why }` rows, and actor.rs
// `denial_class` books the source under its `_` arm, `verdict_not_pass`.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '../src/api/client.js';
import type { CoreEvent } from '../src/api/types.js';
import { RunStory } from '../src/components/session/RunRecord.js';
import { useProvenanceStore } from '../src/store/provenance.js';
import { makeUnit, makeView } from './factories.js';
import { escalationCopy, parseDenial, stepDenialAdvice, stepDenialHeadline, denialHeadline, denialAdvice } from '../src/components/denialCopy.js';
import { denialSourceLabel, gateVerdict } from '../src/components/gateVerdictModel.js';
import { GateVerdict } from '../src/components/GateVerdict.js';
import { gateCause } from '../src/board/gateHeadline.js';

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(client.api, 'getAudit').mockResolvedValue({ entries: [] } as never);
  useProvenanceStore.setState({ byRun: {}, rejectNotes: {}, cancelStories: {} } as never);
});
afterEach(cleanup);

/** core `seat_refused_reason` with one refused write (`format!("`{}` ({})", r.path, r.why)`). */
const ONE = "the agent's own sandbox refused 1 write(s) inside the project that this step never made afterwards: `src/notes.ts` (Operation not permitted). The step's work is not complete as built. Send it back to try again, or reassign the step to another agent";
/** The same with more than SHOWN (5) refusals: five named, then "and N more". */
const SEVEN = "the agent's own sandbox refused 7 write(s) inside the project that this step never made afterwards: `a.ts` (read-only file system), `b.ts` (read-only file system), `c.ts` (read-only file system), `d.ts` (read-only file system), `e.ts` (read-only file system), and 2 more. The step's work is not complete as built. Send it back to try again, or reassign the step to another agent";

describe('studio#1384: a seat-refused denial is said in plain words', () => {
  it('the gate names the layer in words, never the raw token', () => {
    expect(denialSourceLabel('seat_refused')).toBe('the agent’s own sandbox');
    expect(denialSourceLabel('seat_refused')).not.toContain('seat_refused');
  });

  it('the step card names the blocked writes and offers send back or reassign', () => {
    const one = parseDenial(ONE, { source: 'seat_refused' });
    expect(one.kind).toBe('seat-refused');
    expect(stepDenialHeadline(one, 'Build')).toBe('Build’s own sandbox blocked a write inside the project (src/notes.ts), so its work isn’t complete.');
    expect(stepDenialAdvice(one)).toBe('Send the step back to try again, or reassign it to another helper.');
    const seven = parseDenial(SEVEN, { source: 'seat_refused' });
    expect(stepDenialHeadline(seven, 'Build')).toBe('Build’s own sandbox blocked 7 writes inside the project (a.ts, b.ts, c.ts and 4 more), so its work isn’t complete.');
    // Without the engine's count or paths (a later engine's other words), the sentence still holds.
    expect(stepDenialHeadline(parseDenial('blocked', { source: 'seat_refused' }), 'Build')).toBe('Build’s own sandbox blocked its writes inside the project, so its work isn’t complete.');
    // The unit-numbered twins say the same.
    expect(denialHeadline(one, 3)).toBe('Unit #3’s own sandbox blocked a write inside the project (src/notes.ts), so its work isn’t complete.');
    expect(denialAdvice(one)).toBe('Send it back to try again, or reassign it to a different CLI.');
  });

  it('the escalation row knows the pair (verdict_not_pass × seat_refused), and boundary_deny × seat_refused', () => {
    const c = escalationCopy('verdict_not_pass', 'seat_refused', { ord: 2, verdictSummary: ONE });
    expect(c.known).toBe(true);
    expect(c.headline).toBe('Unit #2: its own sandbox blocked a write inside the project (src/notes.ts), so its work isn’t complete');
    // A hook that also denied a call books the class boundary_deny (actor.rs `_ if hook_denied`); the source still wins.
    const both = escalationCopy('boundary_deny', 'seat_refused', { ord: 2, verdictSummary: ONE, deniedCommand: 'rm -rf /' });
    expect(both.known).toBe(true);
    expect(both.headline).toBe(c.headline);
    // The governance row keeps its words.
    expect(escalationCopy('boundary_deny', 'input_governance', { ord: 2, deniedCommand: 'ls' }).headline).toBe('Unit #2: a command was refused by governance: `ls`');
  });

  it('a path that holds a backtick is named whole, and a list that names more than it counts names none', () => {
    const tick = "the agent's own sandbox refused 2 write(s) inside the project that this step never made afterwards: `src/a`b.ts` (Permission denied), `c (copy).ts` (Permission denied). The step's work is not complete as built. Send it back to try again, or reassign the step to another agent";
    expect(stepDenialHeadline(parseDenial(tick, { source: 'seat_refused' }), 'Build')).toBe('Build’s own sandbox blocked 2 writes inside the project (src/a`b.ts and c (copy).ts), so its work isn’t complete.');
    const over = "the agent's own sandbox refused 1 write(s) inside the project that this step never made afterwards: `a.ts` (x), `b.ts` (y). The step's work is not complete as built.";
    expect(stepDenialHeadline(parseDenial(over, { source: 'seat_refused' }), 'Build')).toBe('Build’s own sandbox blocked a write inside the project, so its work isn’t complete.');
  });

  it('the gate card reads "denied by the agent’s own sandbox", with the engine’s words after it', () => {
    const events = [
      { type: 'gateEvaluated', session: 'r', ord: 2, passed: false, denial: { source: 'seat_refused', reason: ONE }, denialReason: ONE, ts: 1, seq: 1 },
    ] as unknown as CoreEvent[];
    const view = gateVerdict(events, 2)!;
    render(<GateVerdict view={view} phase="build" />);
    const line = screen.getByTestId('gate-verdict-denial').textContent ?? '';
    expect(line.startsWith('denied by the agent’s own sandbox: ')).toBe(true);
    expect(line).not.toContain('seat_refused');
    expect(screen.getByTestId('gate-verdict').querySelector('.wk-verdict-head')!.textContent).toBe('Build’s own sandbox blocked its writes');
  });

  it('the run’s story says it on the refused step, the engine’s words behind Technical details', () => {
    // The unit record as core serializes it (domain.rs WorkUnit: `denial_reason` + the structured `denial`).
    const view = makeView({ id: 'r-sr', status: 'failed' }, [
      makeUnit({ id: 'r-sr:build', session_id: 'r-sr', ord: 1, status: 'rejected', phase_ref: 'build', denial_reason: ONE,
        denial: { source: 'seat_refused', reason: ONE } } as never),
    ]);
    render(<RunStory view={view} />);
    const plain = screen.getByTestId('failure-plain');
    expect(plain.querySelector('.wk-session-run-story-line')!.textContent).toMatch(/own sandbox blocked a write inside the project \(src\/notes\.ts\), so its work isn’t complete\.$/);
    expect(plain.textContent).toContain('Send the step back to try again, or reassign it to another helper.');
    expect(screen.getByTestId('failure-engine-detail').textContent).toContain('Operation not permitted');
  });

  it('the gate’s question names the blocked writes, never "did not pass review" (nothing reviewed the work)', () => {
    const PROMPT = 'Unit 2 verdict is NOT PASS — confirm to retry the phase, request changes to send the review back to the creator phase, or reject to cancel the run';
    const view = makeView({ id: 'r-g', status: 'awaiting_human', clis: ['codex', 'claude'] } as never, [
      makeUnit({ id: 'r-g:build', session_id: 'r-g', ord: 2, status: 'rejected', role: 'creator', assigned_cli: 'codex' }),
    ]);
    const events = [
      { type: 'gateEvaluated', session: 'r-g', ord: 2, passed: false, denial: { source: 'seat_refused', reason: ONE }, denialReason: ONE, ts: 1, seq: 1 },
      { type: 'gateEscalated', session: 'r-g', ord: 2, condition: 'verdict_not_pass', denialSource: 'seat_refused', verdictSummary: ONE, attempt: 0, ts: 2, seq: 2 },
      { type: 'awaitingHuman', session: 'r-g', ord: 2, prompt: PROMPT, gateKind: 'escalation', ts: 3, seq: 3 },
    ] as unknown as CoreEvent[];
    const gate = { runId: 'r-g', ord: 2, prompt: PROMPT, lifecycle: 'open', receivedAt: 3, gateKind: 'escalation' } as never;
    const roster = [{ key: 'codex', display_name: 'Codex', binary: 'codex', enabled_for_council: true }] as never;
    const c = gateCause({ view, gate, events, model: { choices: [], overflow: [], recommended: null } as never, roster });
    expect(c.headline).toBe('Codex’s own sandbox blocked its writes inside the project, so the step isn’t complete');
    // A roster that names the seat in lower case still opens the sentence with a capital.
    expect(gateCause({ view, gate, events, model: { choices: [], overflow: [], recommended: null } as never, roster: [{ key: 'codex', display_name: 'codex', binary: 'codex', enabled_for_council: true }] as never }).headline)
      .toBe('Codex’s own sandbox blocked its writes inside the project, so the step isn’t complete');
    // A retry dispatched after the refusal is a new attempt: its gate does not inherit the old cause (codex r1).
    const retried = [...events, { type: 'unitDispatched', session: 'r-g', ord: 2, attempt: 1, ts: 4, seq: 4 },
      { type: 'awaitingHuman', session: 'r-g', ord: 2, prompt: 'Unit 2 failed and triage escalated: boom', gateKind: 'escalation', ts: 5, seq: 5 }] as unknown as CoreEvent[];
    expect(gateCause({ view, gate, events: retried, model: { choices: [], overflow: [], recommended: null } as never, roster }).headline ?? '').not.toMatch(/sandbox/);
    // Another denial on the same gate keeps its own words.
    const other = events.map((e) => (e.type === 'gateEscalated' ? { ...e, denialSource: 'agent_validator' } : e)) as CoreEvent[];
    expect(gateCause({ view, gate, events: other, model: { choices: [], overflow: [], recommended: null } as never, roster }).headline).toBeNull();
  });
});
