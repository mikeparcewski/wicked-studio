// crew#1974: when every judge seat failed (out of quota, signed out), the gate names that cause.
//
// Train-17 cert, J4a run 01321337 (crew 0.20.0): the review's judge could not run on any eligible seat (copilot 429,
// agy signed out), so the engine held the step at a `stand_in_needed` escalation. The card said only "The step was
// escalated — how should it go on?" over a rules line that read like a pass, and nothing said that Retry meets the same
// two seats. Replayed here on the run's own records (tests/fixtures/j4-t17-judges-down-1974.json).
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import fixture from './fixtures/j4-t17-judges-down-1974.json';
import type { CoreEvent, RosterSeat, SessionView, WorkUnit } from '../src/api/types.js';
import { sessionGateChoices } from '../src/board/gateRowModel.js';
import { gateCause } from '../src/board/gateHeadline.js';
import { plainGateQuestion } from '../src/board/deskWords.js';
import { JudgesDownLine } from '../src/components/session/GateRow.js';
import type { OpenGate } from '../src/store/gates.js';

const RUN = fixture as unknown as { session: Record<string, unknown>; units: WorkUnit[]; events: CoreEvent[] };
// The cert host's roster names, as the card's own options spelled them ("Reassign to GitHub Copilot CLI (benched)").
const NAMES: Record<string, string> = { claude: 'Claude Code', codex: 'Codex', pi: 'Pi CLI', copilot: 'GitHub Copilot CLI', agy: 'Antigravity' };
const ROSTER = Object.entries(NAMES).map(([key, display_name]) => ({ key, display_name, signed_in: key !== 'agy' })) as unknown as RosterSeat[];

function atGate() {
  const asked = RUN.events[RUN.events.length - 1] as unknown as { type: string; ord: number; prompt: string; gateKind: string };
  expect(asked.type).toBe('awaitingHuman');
  const view = { session: RUN.session, units: RUN.units } as unknown as SessionView;
  const gate = { runId: view.session.id, ord: asked.ord, prompt: asked.prompt, gateKind: asked.gateKind, lifecycle: 'open', receivedAt: 0 } as OpenGate;
  const pool = RUN.session['clis'] as string[];
  const model = sessionGateChoices({ runId: view.session.id, gate, units: view.units, events: RUN.events, pool, roster: ROSTER, rerun: null, fullVerdict: null, rejudge: null });
  return { view, gate, pool, model };
}

describe('crew#1974: every judge seat failed', () => {
  it('the gate headline names the cause and each seat’s reason', () => {
    const { view, gate, pool, model } = atGate();
    const cause = gateCause({ view, gate, events: RUN.events, model, roster: ROSTER, pool });
    expect(cause.headline).toBe('The check couldn’t run: no judge could check this step (GitHub Copilot CLI is out of quota, Antigravity is signed out)');
    expect(cause.judgesDown).toEqual([
      { cli: 'copilot', name: 'GitHub Copilot CLI', words: 'out of quota' },
      { cli: 'agy', name: 'Antigravity', words: 'signed out' },
    ]);
  });

  it('with no roster read yet, each seat is named by its CLI, never its raw key', () => {
    const { view, gate, pool, model } = atGate();
    const cause = gateCause({ view, gate, events: RUN.events, model, roster: null, pool });
    expect(cause.headline).toBe('The check couldn’t run: no judge could check this step (GitHub Copilot is out of quota, Antigravity is signed out)');
  });

  it('every surface that reads only the prompt says the check could not run, not "the step was escalated"', () => {
    const { gate } = atGate();
    expect(plainGateQuestion(gate.prompt, gate.gateKind)).toBe('The check couldn’t run: no judge could check this step — how should it go on?');
  });

  it('the card says which answers help and that Retry meets the same seats', () => {
    const { view, gate, pool, model } = atGate();
    const { judgesDown } = gateCause({ view, gate, events: RUN.events, model, roster: ROSTER, pool });
    render(<JudgesDownLine seats={judgesDown!} />);
    const line = screen.getByTestId('session-gate-judges-down');
    expect(line.textContent).toContain('GitHub Copilot CLI is out of quota and Antigravity is signed out.');
    expect(line.textContent).toContain('Sign Antigravity back in, reassign the step to another helper, or use a stand-in.');
    expect(line.textContent).toContain('Retry this step meets the same judges, so it fails the same way until one of them is back.');
  });

  it('a gate whose judge ran keeps its own headline (no judges-down line)', () => {
    const { view, gate, pool, model } = atGate();
    const events = RUN.events.map((e) => (e.type === 'gateEscalated' ? ({ ...e, verdictSummary: 'Unit 5 verdict is NOT PASS' } as unknown as CoreEvent) : e));
    const cause = gateCause({ view, gate: { ...gate, prompt: 'Unit 5 verdict is NOT PASS' }, events, model, roster: ROSTER, pool });
    expect(cause.judgesDown).toBeNull();
  });
});
