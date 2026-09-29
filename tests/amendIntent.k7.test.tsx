// W3-K7 (wicked-core#555) — the gate can amend the run's intent, and the run page says so.
//
// `request_changes` reaches the creator and an approve's `amend` reaches ONE unit; nothing amended
// the acceptance list the EVALUATOR is handed, so a mid-run descope could only end in a relaunch
// (and the evaluator kept failing a withdrawn item, inconsistently). The lever is "Amend intent":
// approve-shaped, the note required, no scope — and the undo toast says what it really does, not
// "the run resumes". The run head then carries the amendment beside the intent it changed, read
// off the RUN RECORD so it survives a reload.

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '../src/api/client.js';
import { teamPlanApi } from '../src/api/teamPlan.js';
import type { AgentSession, CoreEvent } from '../src/api/types.js';
import { intentAmendmentsOf } from '../src/api/wave6-wire.js';
import { describeDecision, setUndoWindowForTest, undoDecision, useUndoQueue } from '../src/board/undoQueue.js';
import { RunIntentAmendments } from '../src/components/RunIntentAmendments.js';
import { SteeringGate } from '../src/components/SteeringGate.js';
import { useAnnotationStore } from '../src/store/annotations.js';
import { useRunEventStore } from '../src/store/events.js';
import { useGateStore } from '../src/store/gates.js';
import { usePlanGateStore } from '../src/store/planGates.js';
import { clearCachedRoster } from '../src/store/rosterCache.js';
import { useSteeringStore } from '../src/store/steering.js';
import { makeUnit, makeView } from './factories.js';

const RUN = 'r-amend';
const UNITS = [
  makeUnit({ id: `${RUN}:u1`, session_id: RUN, ord: 1, stage: 'build', status: 'done', assigned_cli: 'claude' }),
  makeUnit({ id: `${RUN}:u2`, session_id: RUN, ord: 2, stage: 'test', status: 'pending', assigned_cli: 'codex' }),
];

function stubLocalStorage(): void {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  // Send on the spot: the undo window is the subject of its own suite.
  setUndoWindowForTest(0);
  stubLocalStorage();
  useGateStore.setState({ gates: {} });
  usePlanGateStore.setState({ byRun: {} });
  useAnnotationStore.setState({ drafts: {} });
  useSteeringStore.setState({ entries: [], seq: 0 });
  useRunEventStore.setState({ byRun: {} });
  clearCachedRoster();
  vi.spyOn(client.api, 'listRepos').mockResolvedValue({ repos: [] });
  vi.spyOn(client.api, 'listWorkflows').mockResolvedValue({ workflows: [] });
  vi.spyOn(teamPlanApi, 'team').mockResolvedValue({ rows: [], units: [] });
});
afterEach(() => {
  for (const p of useUndoQueue.getState().pending) undoDecision(p.id);
  cleanup();
  vi.unstubAllGlobals();
});

function mountGate(prompt: string, events: CoreEvent[] = []): void {
  useGateStore.setState({ gates: { [RUN]: { runId: RUN, ord: 2, prompt, lifecycle: 'open', receivedAt: 1 } } });
  useRunEventStore.setState({ byRun: { [RUN]: events } });
  render(<SteeringGate runId={RUN} ord={2} prompt={prompt} units={UNITS} clis={['claude', 'codex']} />);
}

describe('the Amend intent lever', () => {
  it('sends {approve:true, action:"amend_intent", amend} — and nothing without a note', async () => {
    const confirm = vi.spyOn(client.api, 'confirmGate').mockResolvedValue({ status: 'ok' });
    mountGate('Unit 2 is gated. Approve, approve with a steer, or reject.');

    // The note IS the amendment: the button is disabled until there is one.
    const button = screen.getByTestId('steering-amend-intent');
    expect(button).toBeDisabled();

    fireEvent.change(screen.getByTestId('steering-amend'), {
      target: { value: 'issue #621 is withdrawn from this run' },
    });
    // …and armed once the gate is known NOT to be a plan gate (the team read answers; the arm
    // fails closed until then, like Approve + steer).
    await vi.waitFor(() => expect(screen.getByTestId('steering-amend-intent')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('steering-amend-intent'));

    await vi.waitFor(() => expect(confirm).toHaveBeenCalled());
    // …with the gate's own ord, so a decision made on a replaced gate is a 409, not an answer.
    expect(confirm.mock.calls[0]?.[1]).toEqual({
      approve: true,
      action: 'amend_intent',
      amend: 'issue #621 is withdrawn from this run',
      ord: 2,
    });
  });

  it("the preview says the acceptance list changes — not 'the run resumes'", () => {
    const { verb, preview } = describeDecision({
      approve: true,
      action: 'amend_intent',
      amend: 'issue #621 is withdrawn',
    } as never);
    expect(verb).toBe('approve');
    expect(preview).toContain("acceptance list changes");
    expect(preview).toContain('the evaluator included');
    expect(preview).not.toContain('resumes past this gate');
  });
});

describe('the run head carries the amendment (the run record, not an event fold)', () => {
  const session = (rows: unknown): AgentSession =>
    ({ ...makeView(RUN, 'executing').session, intent_amendments: rows } as unknown as AgentSession);

  it('renders each amendment with its unit and time', () => {
    render(
      <RunIntentAmendments
        session={session([{ text: 'issue #621 is withdrawn', ord: 4, at: 1_700_000_000_000 }])}
      />,
    );
    const strip = screen.getByTestId('run-intent-amendments');
    expect(strip).toHaveAttribute('data-count', '1');
    expect(strip.textContent).toContain('Intent amended');
    expect(strip.textContent).toContain('unit #4');
    expect(strip.textContent).toContain('issue #621 is withdrawn');
  });

  it('renders NOTHING on an unamended run, and on a daemon before the field', () => {
    const { container } = render(<RunIntentAmendments session={session([])} />);
    expect(container.firstChild).toBeNull();
    cleanup();
    const older = render(<RunIntentAmendments session={makeView(RUN, 'executing').session} />);
    expect(older.container.firstChild).toBeNull();
  });

  it('drops a half-read row rather than rendering it', () => {
    expect(intentAmendmentsOf({ intent_amendments: [{ text: '  ' }, { ord: 2 }, 7] })).toEqual([]);
    // A row with only the text still renders — the ord and time are decoration, not the record.
    expect(intentAmendmentsOf({ intent_amendments: [{ text: 'withdrawn' }] })).toEqual([
      { text: 'withdrawn', ord: 0, at: 0 },
    ]);
    expect(intentAmendmentsOf(null)).toEqual([]);
    expect(intentAmendmentsOf({})).toEqual([]);
  });
});
