import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '../src/api/client.js';
import { teamPlanApi, type TeamRow } from '../src/api/teamPlan.js';
import type { CoreEvent } from '../src/api/types.js';
import { useGateActionStore } from '../src/board/gateActions.js';
import { setUndoWindowForTest, useUndoQueue } from '../src/board/undoQueue.js';
import { GateRow } from '../src/components/session/GateRow.js';
import { useRunEventStore } from '../src/store/events.js';
import { useGateStore, type OpenGate } from '../src/store/gates.js';
import { useTeamPlanStore } from '../src/store/teamPlan.js';
import { makeUnit, makeView } from './factories.js';
import { chooseGate } from './askGateHelpers.js';

// Real gate events, trimmed to the verdict ITEM lines; no evidence files are read at test time.
const fixtures = [
  {
    "runId": "bfae11d9-ef6e-5099-8635-8031cb46e03a",
    "events": [
      {"combined": false, "deterministicPass": true, "evaluatorPass": true, "evaluatorVerdict": "FAIL", "hasDeterministicFloor": false, "ord": 5, "seq": 7540, "session": "bfae11d9-ef6e-5099-8635-8031cb46e03a", "ts": 1795215118327, "type": "gateEvaluated",
        "denial": {"claimId": null, "deniedTool": null, "phase": "unit-5", "reason": "the evaluator's verdict is FAIL\nITEM 4: PASS — Reset is pressed after the hold; the end sheet shows the resulting state.\nITEM 5: FAIL — Under 30 seconds required; measured duration is 30.566992 seconds (`review/ffprobe.json:5`).\nITEM 6: FAIL — Captions are present, but “count reads 3” persists after Reset (`plan/storyline.json:12–16`, `review/end.png`).\nITEM 7: PASS — Synthetic data is labelled in the script, opening caption and held closing card.", "ruleIds": [], "source": "evaluator_verdict"},
        "denialReason": "the evaluator's verdict is FAIL\nITEM 4: PASS — Reset is pressed after the hold; the end sheet shows the resulting state.\nITEM 5: FAIL — Under 30 seconds required; measured duration is 30.566992 seconds (`review/ffprobe.json:5`).\nITEM 6: FAIL — Captions are present, but “count reads 3” persists after Reset (`plan/storyline.json:12–16`, `review/end.png`).\nITEM 7: PASS — Synthetic data is labelled in the script, opening caption and held closing card."},
      {"attempt": 0, "condition": "verdict_not_pass", "defGate": false, "denialSource": "evaluator_verdict", "ord": 5, "seq": 7543, "session": "bfae11d9-ef6e-5099-8635-8031cb46e03a", "ts": 1795215118336, "type": "gateEscalated", "verdictSummaryTrimmed": true,
        "verdictSummary": "the evaluator's verdict is FAIL\nITEM 4: PASS — Reset is pressed after the hold; the end sheet shows the resulting state.\nITEM 5: FAIL — Under 30 seconds required; measured duration is 30.566992 seconds (`review/ffprobe.json:5`).\nITEM 6: FAIL — Captions are present, but “count reads 3” persists after Reset (`plan/storyline.json:12–16`, `review/end.png`).\nITEM 7: PASS — Synthetic data is labelled in the script, opening caption and held closing card."},
      {"gateKind": "escalation", "ord": 5, "reviewingOrd": 5, "seq": 7544, "session": "bfae11d9-ef6e-5099-8635-8031cb46e03a", "ts": 1795215118338, "type": "awaitingHuman",
        "prompt": "Unit 5 verdict is NOT PASS (the evaluator's verdict is FAIL) — confirm to retry the phase, request changes to send the review back to the creator phase, or reject to cancel the run [engine gate: a denied unit pauses for a decision instead of failing the run (core#464); run-level human_confirm=none silences only run-level pauses, never a denial gate]"}
    ],
    "units": [{"ord": 3, "stage": "build", "role": "creator", "status": "done"}, {"ord": 5, "stage": "review", "role": "evaluator", "status": "done"}]
  },
  {
    "runId": "d05750d2-c449-5299-9cee-cfd5a875a9ff",
    "events": [
      {"combined": false, "deterministicPass": true, "evaluatorPass": true, "evaluatorVerdict": "FAIL", "hasDeterministicFloor": true, "ord": 4, "seq": 7385, "session": "d05750d2-c449-5299-9cee-cfd5a875a9ff", "ts": 1795214893181, "type": "gateEvaluated",
        "denial": {"claimId": null, "deniedTool": null, "phase": "unit-4", "reason": "the evaluator's verdict is FAIL\nITEM 1: PASS — Array and object-wrapped checklists display the supplied titles and done flags; QE step 1.\nITEM 2: PASS — Toggle updates the saved flag. Checkbox Space is no longer canceled or forwarded; QE steps 1 and 4.\nITEM 3: PASS — Add creates an unchecked item; empty and whitespace titles are rejected; QE steps 1–2.\nITEM 4: PASS — Drop removes the selected item from the save payload; QE step 1.\nITEM 5: FAIL — Malformed-input protection remains incomplete. HTML containing `<div data-wid=\"todo-json\">not JSON</div>` suppresses the parse error, shows “Version 1,” and Save emits `[]`. The exception is at `editors-pack/editors/acme-todo-editor/index.html:178`, enabled at line 187; line 243 sends the write. QE step 3 reproduces this with an explicitly labeled DOMParser fixture double. This is the previously failed malformed-input item; the latest rework introduced this remaining bypass.\nITEM 6: PASS — Engine conformance unit 3 passed every required case 0–16 and 18 on tree `e7eb00652fefdb209de797c5d77ced6ff57ca147`. Computed entry and manifest SHA-256 match: `3154c7459cc592df56287ce4a907fa824bc4e232293e21c65ffe73186836f38e`.", "ruleIds": [], "source": "evaluator_verdict"},
        "denialReason": "the evaluator's verdict is FAIL\nITEM 1: PASS — Array and object-wrapped checklists display the supplied titles and done flags; QE step 1.\nITEM 2: PASS — Toggle updates the saved flag. Checkbox Space is no longer canceled or forwarded; QE steps 1 and 4.\nITEM 3: PASS — Add creates an unchecked item; empty and whitespace titles are rejected; QE steps 1–2.\nITEM 4: PASS — Drop removes the selected item from the save payload; QE step 1.\nITEM 5: FAIL — Malformed-input protection remains incomplete. HTML containing `<div data-wid=\"todo-json\">not JSON</div>` suppresses the parse error, shows “Version 1,” and Save emits `[]`. The exception is at `editors-pack/editors/acme-todo-editor/index.html:178`, enabled at line 187; line 243 sends the write. QE step 3 reproduces this with an explicitly labeled DOMParser fixture double. This is the previously failed malformed-input item; the latest rework introduced this remaining bypass.\nITEM 6: PASS — Engine conformance unit 3 passed every required case 0–16 and 18 on tree `e7eb00652fefdb209de797c5d77ced6ff57ca147`. Computed entry and manifest SHA-256 match: `3154c7459cc592df56287ce4a907fa824bc4e232293e21c65ffe73186836f38e`."},
      {"attempt": 2, "condition": "verdict_not_pass", "defGate": true, "denialSource": "evaluator_verdict", "ord": 4, "seq": 7388, "session": "d05750d2-c449-5299-9cee-cfd5a875a9ff", "ts": 1795214893205, "type": "gateEscalated", "verdictSummaryTrimmed": false,
        "verdictSummary": "the evaluator's verdict is FAIL\nITEM 1: PASS — Array and object-wrapped checklists display the supplied titles and done flags; QE step 1.\nITEM 2: PASS — Toggle updates the saved flag. Checkbox Space is no longer canceled or forwarded; QE steps 1 and 4.\nITEM 3: PASS — Add creates an unchecked item; empty and whitespace titles are rejected; QE steps 1–2.\nITEM 4: PASS — Drop removes the selected item from the save payload; QE step 1.\nITEM 5: FAIL — Malformed-input protection remains incomplete. HTML containing `<div data-wid=\"todo-json\">not JSON</div>` suppresses the parse error, shows “Version 1,” and Save emits `[]`. The exception is at `editors-pack/editors/acme-todo-editor/index.html:178`, enabled at line 187; line 243 sends the write. QE step 3 reproduces this with an explicitly labeled DOMParser fixture double. This is the previously failed malformed-input item; the latest rework introduced this remaining bypass.\nITEM 6: PASS — Engine conformance unit 3 passed every required case 0–16 and 18 on tree `e7eb00652fefdb209de797c5d77ced6ff57ca147`. Computed entry and manifest SHA-256 match: `3154c7459cc592df56287ce4a907fa824bc4e232293e21c65ffe73186836f38e`."},
      {"gateKind": "review_adjudication", "ord": 4, "reviewingOrd": 4, "seq": 7390, "session": "d05750d2-c449-5299-9cee-cfd5a875a9ff", "ts": 1795214893207, "type": "awaitingHuman",
        "prompt": "Unit 4 verdict is NOT PASS again — round 3, after 2 send-backs to unit 2 (the rework cap is 2), so this gate adjudicates instead of sending it back. Items — re-raised (1): ITEM 5: FAIL — Malformed-input protection remains incomplete. HTML containing `<div data-wid=\"todo-json\">not JSON</div>` suppresses the parse error, shows “Vers…. Approve = LAND WITH CARRIED ITEMS: the creator's tree is accepted as it stands, the FAIL items are recorded as carried on unit 4 and the run moves on. Request changes = ONE MORE ROUND: the review goes back to unit 2 once more (the next NOT PASS returns here). Reject = STOP the run [workflow-declared gate: this pause is authored by the workflow definition itself; run-level human_confirm=none silences only run-level pauses, never a workflow-authored gate]"}
    ],
    "units": [{"ord": 2, "stage": "build", "role": "creator", "status": "done"}, {"ord": 4, "stage": "test", "role": "neutral", "status": "done"}]
  },
  {
    "runId": "abea6262-1fc8-584b-84bf-673c98800e9e",
    "events": [
      {"combined": true, "deterministicPass": true, "evaluatorPass": true, "evaluatorVerdict": null, "hasDeterministicFloor": false, "ord": 4, "seq": 2965, "session": "abea6262-1fc8-584b-84bf-673c98800e9e", "ts": 1795209846964, "type": "gateEvaluated",
        "denial": null,
        "denialReason": null},
      {"choices": ["approve", "request_changes", "reject"], "findingIds": ["f-3fc9896ded8b83c4", "f-8abb47ca3c3d6243"], "gateKind": "team_dispute", "ord": 4, "recommended": 1, "reviewingOrd": null, "seq": 2966, "session": "abea6262-1fc8-584b-84bf-673c98800e9e", "ts": 1795209846965, "type": "awaitingHuman",
        "prompt": "Team dispute on unit 4 (extract — In carddemo-t10, extract the business rules and requirements of the CardDemo credit card batch processing stream: daily transaction validation and posting (CBTRN02C), interest and fee calculation (CBACT04C), and the transaction detail report (CBTRN03C), including the account, card cross-reference, transaction category balance and disclosure group data they read and write. Tie each rule to the program, paragraph and copybook field it comes from."}
    ],
    "units": [{"ord": 4, "stage": "build", "role": "creator", "status": "done"}]
  }
];
const teamRows: TeamRow[] = [
  {
    "event_id": 8766,
    "event_type": "wicked.team.finding.raised",
    "payload": {
      "attempt": 2,
      "by": "pi",
      "claim": "CBACT04C is declared in-scope for interest-and-fees, but this change deleted every CBACT04C business rule (interest = TRAN-CAT-BAL*DIS-INT-RATE/1200, disclosure-group rate lookup, fee stub, last-account settlement bug). The extract criterion requires interest and fee calculation rules; none remain, so the required extraction is now missing.",
      "finding_id": "f-3fc9896ded8b83c4",
      "line": 20,
      "ord": 4,
      "path": ".wicked/domain/rules.json",
      "raise_seq": 1,
      "severity": "high"
    }
  },
  {
    "event_id": 8767,
    "event_type": "wicked.team.finding.raised",
    "payload": {
      "attempt": 2,
      "by": "pi",
      "claim": "CBTRN03C is declared in-scope for transaction-reporting, but this change deleted the CBTRN03C transaction-detail-report rule (date-range filtering, xref/type/category lookups, page/grand totals). The criterion requires the transaction detail report rules; none remain after this change.",
      "finding_id": "f-8abb47ca3c3d6243",
      "line": 41,
      "ord": 4,
      "path": ".wicked/domain/rules.json",
      "raise_seq": 2,
      "severity": "high"
    }
  },
  {
    "event_id": 8797,
    "event_type": "wicked.team.council.called",
    "payload": {
      "attempt": 2,
      "by": "engine",
      "finding_id": "f-3fc9896ded8b83c4",
      "ord": 4,
      "positions": [
        {
          "by": "worker claude",
          "position": "YES — the work as submitted stands",
          "reason": "not delivered — no delivery on record"
        },
        {
          "by": "monitor pi",
          "position": "NO — the finding stands",
          "reason": "Confirmed: rules.json has zero CBACT04C rules. CBACT04C.cbl lines 462–466 compute monthly interest as `(TRAN-CAT-BAL * DIS-INT-RATE) / 1200` in 1300-COMPUTE-INTEREST, with the disclosure-group rate lookup at 1200-GET-INTEREST-RATE / 1200-A-GET-DEFAULT-INT-RATE and the fee stub at 1400-COMPUTE-FEES. The program is assigned to interest-and-fees (rules.json:20) and the extract criterion names \"interest and fee calculation (CBACT04C)\" — none of these rules are extracted, so the required extraction is missing."
        }
      ],
      "subject": "finding:1"
    }
  },
  {
    "event_id": 8799,
    "event_type": "wicked.team.council.ruled",
    "payload": {
      "agreement_pct": 100,
      "attempt": 2,
      "by": "council:01795209800517-0000000000000000",
      "ord": 4,
      "reason": null,
      "returned": 1,
      "seated": 1,
      "seats": [
        "codex"
      ],
      "subject": "finding:1",
      "verdict": "no"
    }
  },
  {
    "event_id": 8800,
    "event_type": "wicked.team.council.called",
    "payload": {
      "attempt": 2,
      "by": "engine",
      "finding_id": "f-8abb47ca3c3d6243",
      "ord": 4,
      "positions": [
        {
          "by": "worker claude",
          "position": "YES — the work as submitted stands",
          "reason": "not delivered — no delivery on record"
        },
        {
          "by": "monitor pi",
          "position": "NO — the finding stands",
          "reason": "Confirmed: rules.json has zero CBTRN03C rules. CBTRN03C.cbl lines 173–174 filter on `TRAN-PROC-TS (1:10)` between WS-START-DATE/WS-END-DATE, with page/grand totals (WS-PAGE-TOTAL/WS-GRAND-TOTAL) and the report writer 1100-WRITE-TRANSACTION-REPORT. The program is assigned to transaction-reporting (rules.json:41) and the criterion names \"the transaction detail report (CBTRN03C)\" — none of these rules are extracted."
        }
      ],
      "subject": "finding:2"
    }
  },
  {
    "event_id": 8802,
    "event_type": "wicked.team.council.ruled",
    "payload": {
      "agreement_pct": 100,
      "attempt": 2,
      "by": "council:01795209826278-0000000000000001",
      "ord": 4,
      "reason": null,
      "returned": 1,
      "seated": 1,
      "seats": [
        "codex"
      ],
      "subject": "finding:2",
      "verdict": "no"
    }
  },
  {
    "event_id": 8808,
    "event_type": "wicked.team.gate.opened",
    "payload": {
      "attempt": 2,
      "by": "engine",
      "finding_ids": [
        "f-3fc9896ded8b83c4",
        "f-8abb47ca3c3d6243"
      ],
      "kind": "team_dispute",
      "ord": 4
    }
  }
];

beforeEach(() => {
  vi.restoreAllMocks();
  setUndoWindowForTest(0);
  useGateActionStore.setState({ byGate: {} });
  useTeamPlanStore.setState({ byRun: {}, refs: {} });
  useUndoQueue.setState({ pending: [], results: [], restoredNotes: {} });
  vi.spyOn(teamPlanApi, 'team').mockResolvedValue({ rows: [], units: [] });
  vi.spyOn(api, 'confirmGate').mockResolvedValue({ status: 'ok' });
});
afterEach(() => { cleanup(); useUndoQueue.setState({ pending: [], results: [], restoredNotes: {} }); useGateStore.setState({ gates: {} }); });

function draw(index: number, over: Partial<OpenGate> = {}, events?: CoreEvent[]): void {
  const f = fixtures[index]!;
  const log = events ?? f.events as unknown as CoreEvent[];
  useRunEventStore.setState({ byRun: { [f.runId]: log } });
  vi.spyOn(api, 'getRunEvents').mockResolvedValue({ events: log } as never);
  const opened = f.events.find((e) => e.type === 'awaitingHuman')!;
  const gate: OpenGate = { runId: f.runId, ord: opened.ord, prompt: opened.prompt!, gateKind: opened.gateKind!, receivedAt: opened.ts, lifecycle: 'open', ...over };
  const units = f.units.map((u) => makeUnit({ ...u, session_id: f.runId } as never));
  // The store holds the gate the card shows: a decision on a gate the store doesn't hold is refused (#1241).
  useGateStore.getState().setGate(gate);
  render(<GateRow view={makeView({ id: f.runId, status: 'awaiting_human' } as never, units)} gate={gate} />);
}
function face(testid: string): HTMLElement {
  const el = screen.getByTestId(testid);
  expect(el.closest('details')).toBeNull();
  return el;
}
it('shows bfae11d9 ord 5 Item 5 and Item 6 on the face', () => {
  draw(0);
  const block = face('session-gate-findings');
  expect(block.textContent).toContain('What the review found (2):');
  const items = within(block).getAllByTestId('session-gate-finding');
  expect(items[0]!.textContent).toContain('Item 5: Under 30 seconds required');
  expect(items[0]!.textContent).toContain('review/ffprobe.json:5');
  expect(items[1]!.textContent).toContain('Item 6: Captions are present');
  expect(teamPlanApi.team).not.toHaveBeenCalled();
});
it('shows the round-3 d05750d2 ord 4 adjudication Item 5 on the face', () => {
  draw(1);
  const block = face('session-gate-findings');
  expect(within(block).getAllByTestId('session-gate-finding')).toHaveLength(1);
  expect(block.textContent).toContain('Item 5: Malformed-input protection remains incomplete');
  expect(block.textContent).toContain('index.html:178');
});
it('shows abea6262 ord 4 dispute words, author, positions and the single voter', async () => {
  const runId = fixtures[2]!.runId;
  useTeamPlanStore.getState().track(runId);
  useTeamPlanStore.getState().hydrate(runId, { rows: teamRows, units: [] });
  draw(2);
  const blocks = await screen.findAllByTestId('session-gate-dispute-finding');
  const block = blocks.find((b) => b.dataset['findingId'] === 'f-3fc9896ded8b83c4')!;
  expect(block.closest('details')).toBeNull();
  expect(block.textContent).toContain('High finding at .wicked/domain/rules.json:20, raised by pi');
  expect(block.textContent).toContain('deleted every CBACT04C business rule');
  expect(block.textContent).toContain('1 seat voted (codex)');
  expect(block.textContent).toContain('claude (builder): YES — the work as submitted stands (not delivered — no delivery on record)');
});
it('honestly names a dispute whose words are absent', async () => {
  draw(2);
  const blocks = await screen.findAllByTestId('session-gate-dispute-finding');
  expect(blocks[0]!.textContent).toBe("This finding's words are not on this job's team record (f-3fc9896ded8b83c4).");
});
it('says nothing about the record while the team rows are still loading', () => {
  vi.spyOn(teamPlanApi, 'team').mockReturnValue(new Promise(() => {}));
  draw(2);
  expect(face('session-gate-dispute-loading').textContent).toBe('Reading what the team found…');
  expect(screen.queryByTestId('session-gate-dispute-finding')).toBeNull();
});
it('capped-review Land asks for a fresh reason and sends approve with amend', async () => {
  draw(1, { actions: [{ action: 'approve', intent: 'land_with_carried_items', note: 'required', noteIntent: 'skip_rules', rules: ['R1'] }] });
  const choice = screen.getAllByTestId('session-gate-choice').find((c) => c.dataset['choiceKey'] === 'steer')!;
  expect(choice.textContent).toContain('Land, skipping R1');
  fireEvent.click(choice);
  const box = screen.getByTestId('session-gate-note') as HTMLTextAreaElement;
  expect(box.value).toBe('');
  expect(box.placeholder).toBe('Why the work can land without these rules…');
  expect(screen.getByText('Your reason (required, recorded as the reason each rule was skipped)')).toBeDefined();
  expect((screen.getByTestId('session-gate-send') as HTMLButtonElement).disabled).toBe(true);
  chooseGate(choice, 'Accepted with the known limitation');
  await waitFor(() => expect(api.confirmGate).toHaveBeenCalledWith(fixtures[1]!.runId, expect.objectContaining({ approve: true, amend: 'Accepted with the known limitation' })));
  const body = vi.mocked(api.confirmGate).mock.calls[0]![1];
  expect(body).not.toHaveProperty('skipRules');
  expect(body).not.toHaveProperty('action');
});

it('shows five review items first and toggles all seven', () => {
  const log = JSON.parse(JSON.stringify(fixtures[0]!.events)) as Array<Record<string, unknown>>;
  const summary = Array.from({ length: 7 }, (_, i) => `ITEM ${i + 1}: FAIL — Finding ${i + 1} at review/file.ts:${i + 1}.`).join('\n');
  for (const e of log) {
    if (e['type'] === 'gateEvaluated') { e['denialReason'] = summary; (e['denial'] as Record<string, unknown>)['reason'] = summary; }
    if (e['type'] === 'gateEscalated') e['verdictSummary'] = summary;
  }
  draw(0, {}, log as unknown as CoreEvent[]);
  const block = face('session-gate-findings');
  expect(within(block).getAllByTestId('session-gate-finding')).toHaveLength(5);
  fireEvent.click(within(block).getByRole('button', { name: 'Show all 7' }));
  expect(within(block).getAllByTestId('session-gate-finding')).toHaveLength(7);
  fireEvent.click(within(block).getByRole('button', { name: 'Show fewer' }));
  expect(within(block).getAllByTestId('session-gate-finding')).toHaveLength(5);
});
