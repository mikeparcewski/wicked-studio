import { describe, expect, it } from 'vitest';
import type { CoreEvent, WorkUnit } from '../src/api/types.js';
import type { OpenGate } from '../src/store/gates.js';
import { disputeFindingIds, sessionGateChoices, shownPrompt } from '../src/board/gateRowModel.js';
import { sendBackAccepted } from '../src/components/gateVerdictModel.js';
import { makeUnit } from './factories.js';

const RUN = 'r-w4st1';
const NOW = 1_700_000_000_000;

/** A feature run: clarify (1) and design (2) are evaluators/neutral, build (3) the creator. */
const UNITS: WorkUnit[] = [
  makeUnit({ id: `${RUN}:u1`, session_id: RUN, ord: 1, stage: 'recon', description: 'clarify — Add a cover card ||| PHASE SCOPE: this is the clarify phase.', role: 'neutral', status: 'done' }),
  makeUnit({ id: `${RUN}:u2`, session_id: RUN, ord: 2, stage: 'recon', description: 'design — Add a cover card ||| PHASE SCOPE: this is the design phase.', role: 'neutral', status: 'pending' }),
  makeUnit({ id: `${RUN}:u3`, session_id: RUN, ord: 3, stage: 'build', description: 'build — Add a cover card', role: 'creator', status: 'pending' }),
  makeUnit({ id: `${RUN}:u4`, session_id: RUN, ord: 4, stage: 'review', description: 'review — Add a cover card', role: 'evaluator', status: 'pending' }),
];

const DEF_PROMPT = 'Approve the output of unit 1 (clarify — Add a cover card ||| PHASE SCOPE: this is the clarify phase. Do NOT write production code) before unit 2 runs: design — Add a cover card ||| PHASE SCOPE: this is the design phase. [workflow-declared gate: clarify]';

function gate(over: Partial<OpenGate>): OpenGate {
  return { runId: RUN, ord: 2, prompt: DEF_PROMPT, lifecycle: 'open', receivedAt: NOW, gateKind: 'def', ...over };
}

function model(g: OpenGate, events: readonly CoreEvent[] = []) {
  return sessionGateChoices({ runId: RUN, gate: g, units: UNITS, events, pool: [], roster: null });
}

describe('studio#627 — Send back only where the engine accepts it', () => {
  it('the rule: a creator at the cursor or before it; unknown units keep the arm', () => {
    expect(sendBackAccepted(UNITS, 2)).toBe(false);
    expect(sendBackAccepted(UNITS, 3)).toBe(true);
    expect(sendBackAccepted(UNITS, 4)).toBe(true);
    expect(sendBackAccepted([], 2)).toBe(true);
    expect(sendBackAccepted(UNITS, 9)).toBe(true);
    expect(sendBackAccepted(undefined, 2)).toBe(true);
  });

  it('an early unit\'s output gate offers Approve / Approve and steer / Stop, no Send back', () => {
    const m = model(gate({ ord: 2 }));
    expect(m?.reason).toBe('def');
    expect(m?.choices.map((c) => c.key)).toEqual(['approve', 'steer', 'stop']);
  });

  it('a gate after the creator keeps Send back', () => {
    const m = model(gate({ ord: 4, prompt: 'Approve the output of unit 3 (build — Add a cover card) before unit 4 runs: review' }));
    expect(m?.choices.map((c) => c.key)).toEqual(['approve', 'steer', 'send-back', 'stop']);
  });

  it('an engine choice list drops request_changes there and re-points `recommended`', () => {
    const m = model(gate({ ord: 2, gateKind: 'team_dispute', choices: ['approve', 'request_changes', 'reject'], recommended: 1, prompt: 'Team dispute on unit 2 (design): unresolved HIGH finding(s) without a council YES: f-1. Approve to continue, request changes to rework, or reject to cancel.' }));
    expect(m?.choices.map((c) => c.label)).toEqual(['Approve', 'Reject']);
    expect(m?.recommended).toBeNull();
    const kept = model(gate({ ord: 2, gateKind: 'team_dispute', choices: ['request_changes', 'approve', 'reject'], recommended: 2, prompt: 'Team dispute on unit 2' }));
    expect(kept?.choices.map((c) => c.label)).toEqual(['Approve', 'Reject']);
    expect(kept?.recommended).toBe(1);
  });
});

describe('studio#571 — the Details never print the engine\'s ` ||| ` marker', () => {
  it('splits the prompt on INSTRUCTION_SEP and joins it on an em dash', () => {
    expect(shownPrompt('a ||| b ||| c')).toBe('a — b — c');
    const m = model(gate({ ord: 4, prompt: DEF_PROMPT }));
    expect(m?.detailItems.length).toBeGreaterThan(0);
    for (const item of m!.detailItems) expect(item).not.toContain('|||');
    expect(m?.detailItems[0]).toContain('clarify — Add a cover card — PHASE SCOPE');
  });

  it('every row kind applies it', () => {
    for (const over of [
      { gateKind: 'consent' },
      { gateKind: 'team_dispute', choices: ['approve', 'reject'] },
      { gateKind: 'def', choices: null },
      { gateKind: 'mystery' },
    ] as Partial<OpenGate>[]) {
      const m = model(gate({ ord: 4, ...over }));
      expect(m, JSON.stringify(over)).not.toBeNull();
      for (const item of m!.detailItems) expect(item).not.toContain('|||');
    }
  });
});

describe('studio#547 — a team dispute sends back WITH the finding', () => {
  const PROMPT = 'Team dispute on unit 3 (build — Add a cover card): unresolved HIGH finding(s) without a council YES: f-aaaa, f-bbbb. The gate approved the work, but the run does not continue unattended. Approve to continue, request changes to rework, or reject to cancel.';
  const g = gate({ ord: 3, gateKind: 'team_dispute', choices: ['approve', 'request_changes', 'reject'], recommended: 1, prompt: PROMPT });

  it('Send back opens a note pre-filled from the findings, and is the suggestion', () => {
    const m = model(g)!;
    expect(m.reason).toBe('team');
    expect(m.choices.map((c) => c.label)).toEqual(['Approve', 'Send back', 'Reject']);
    const back = m.choices[1]!;
    expect(back.needsNote).toBe(true);
    expect(back.decision).toEqual({ approve: false, action: 'request_changes' });
    expect(back.title).toMatch(/runs again with your note/);
    expect(m.recommended).toBe(1);
    expect(m.noteDefault).toContain('f-aaaa, f-bbbb');
    expect(m.choices[0]!.title).toMatch(/counts/);
  });

  it('the Details name the findings — off the frame first, else off the prompt', () => {
    expect(model(g)!.detailItems).toContain('Unresolved HIGH findings without a council YES: f-aaaa, f-bbbb');
    const frame = { type: 'awaitingHuman', session: RUN, ord: 3, prompt: PROMPT, gateKind: 'team_dispute', findingIds: ['f-cccc'] } as unknown as CoreEvent;
    expect(disputeFindingIds([frame], 3, PROMPT)).toEqual(['f-cccc']);
    expect(model(g, [frame])!.detailItems).toContain('Unresolved HIGH finding without a council YES: f-cccc');
    expect(disputeFindingIds([], 3, 'Team dispute on unit 3: the team\'s record of this step is incomplete')).toEqual([]);
  });

  it('a plain choices gate keeps its engine words and no note', () => {
    const m = model(gate({ ord: 4, gateKind: 'def', choices: ['approve', 'request_changes', 'reject'] }))!;
    expect(m.reason).toBe('choices');
    expect(m.choices.map((c) => c.label)).toEqual(['Approve', 'Request changes', 'Reject']);
    expect(m.choices[1]!.needsNote).toBe(false);
    expect(m.noteDefault).toBe('');
  });
});

describe('studio#627 (codex r1) — the all-unknown escape hatch', () => {
  it('drops "Send a note instead" where a send back would be refused', () => {
    const early = model(gate({ ord: 2, gateKind: 'def', choices: ['mystery_arm'] }))!;
    expect([...early.choices, ...early.overflow].map((c) => c.key)).toEqual(['choice-0', 'stop']);
    const late = model(gate({ ord: 4, gateKind: 'def', choices: ['mystery_arm'] }))!;
    expect([...late.choices, ...late.overflow].map((c) => c.key)).toEqual(['choice-0', 'stop', 'send-note-instead']);
  });
});
