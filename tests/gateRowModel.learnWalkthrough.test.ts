import { describe, expect, it } from 'vitest';
import type { WorkUnit } from '../src/api/types.js';
import type { OpenGate } from '../src/store/gates.js';
import { sessionGateChoices } from '../src/board/gateRowModel.js';
import { conversationStep } from '../src/components/gateVerdictModel.js';
import { makeUnit } from './factories.js';

/**
 * F-LEARN-2 (DES-learn-workflow §3.1): the gate after learn's walkthrough is a conversation.
 * The engine (core `conversation_turn`) re-runs the walkthrough on a send-back, so the card offers
 * "Ask a follow-up" (the same request_changes wire) beside Approve, Approve and steer and Stop.
 */
const RUN = 'run-learn';
const NOW = 1_700_000_000_000;

function learnUnits(): WorkUnit[] {
  const u = (ord: number, id: string, role: NonNullable<WorkUnit['role']>, status: WorkUnit['status']): WorkUnit =>
    makeUnit({ ord, status, id: `${RUN}:${id}`, session_id: RUN, role, tool_cmd: null });
  return [
    u(1, 'scope', 'neutral', 'done'),
    u(2, 'research', 'neutral', 'done'),
    u(3, 'synthesize', 'neutral', 'done'),
    u(4, 'walkthrough', 'neutral', 'done'),
    u(5, 'author', 'creator', 'distributed'),
    u(6, 'review', 'evaluator', 'pending'),
  ];
}

const gate = (ord: number): OpenGate => ({
  runId: RUN,
  ord,
  prompt: `Approve the output of unit ${ord - 1} (walkthrough) before unit ${ord} runs`,
  gateKind: 'def',
  lifecycle: 'open',
  receivedAt: NOW,
}) as OpenGate;

describe('learn walkthrough gate — a multi-turn loop', () => {
  it('offers "Ask a follow-up" (request_changes) with Approve and Stop still there', () => {
    const units = learnUnits();
    const model = sessionGateChoices({ runId: RUN, gate: gate(5), units, events: [], pool: ['claude'], roster: null })!;
    const byKey = Object.fromEntries([...model.choices, ...model.overflow].map((c) => [c.key, c]));
    expect(byKey['send-back']).toMatchObject({ label: 'Ask a follow-up', decision: { approve: false, action: 'request_changes' }, needsNote: true });
    expect(byKey['approve']).toBeDefined();
    expect(byKey['stop']).toBeDefined();
    expect(conversationStep(units, 5)?.id).toBe(`${RUN}:walkthrough`);
  });

  it('is not a conversation once a creator precedes the cursor (a normal send-back to the creator)', () => {
    const units = learnUnits().map((x) => (x.ord === 5 ? { ...x, status: 'done' as const } : x));
    expect(conversationStep(units, 6)).toBeNull();
    const model = sessionGateChoices({ runId: RUN, gate: gate(6), units, events: [], pool: ['claude'], roster: null })!;
    const sendBack = [...model.choices, ...model.overflow].find((c) => c.key === 'send-back');
    expect(sendBack?.label).toBe('Send back');
  });
});
