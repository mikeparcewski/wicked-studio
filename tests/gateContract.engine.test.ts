import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { choiceTokens, contractChoices, type GateAction } from '../src/board/gateContract.js';
import { sessionGateChoices } from '../src/board/gateRowModel.js';
import type { OpenGate } from '../src/store/gates.js';

/**
 * (studio#1170) THE CROSS-REPO CONTRACT, studio's half: every gate shape the engine pins (wicked-core
 * `tests/fixtures/gate-actions.json`, one entry per shape, each list proven there equal to what the engine accepts)
 * rendered by studio's resolver, which must draw exactly the listed answers — one control per answer, a reassign one
 * per listed seat — and nothing else. crew's CI runs this file against the wicked-core ref it builds
 * (`GATE_ACTIONS_FIXTURE=<core>/tests/fixtures/gate-actions.json`), so an engine change that studio does not draw, or
 * a studio answer the engine does not list, fails there before either merges. Default: the copy vendored here.
 */
interface Shape { ord: number; gateKind: string; planRev?: number; actions: GateAction[] }

const path = process.env['GATE_ACTIONS_FIXTURE'] ?? resolve(process.cwd(), 'tests/fixtures/gate-actions.engine.json');
const shapes = Object.entries(JSON.parse(readFileSync(path, 'utf8')) as Record<string, Shape>);
const seat = (cli: string): string => cli;
const listedTokens = (s: Shape): string[] => [...new Set(s.actions.filter((a) => a.action !== 'reassign' || (a.seats ?? []).length > 0).map((a) => a.action))].sort();
const seatsOf = (s: Shape): string[] => s.actions.find((a) => a.action === 'reassign')?.seats ?? [];

describe('every engine gate shape renders exactly its listed answers (studio#1170)', () => {
  it('has the shapes the contract covers', () => {
    const names = shapes.map(([n]) => n);
    for (const want of ['def', 'floor', 'qe-inconclusive', 'qe-fail', 'rules', 'distinct', 'no-judge', 'adj', 'adj-qe', 'adj-rules', 'plan', 'deliver', 'deliver-qe']) {
      expect(names, want).toContain(want);
    }
  });

  for (const [name, shape] of shapes) {
    it(`${name} (${shape.gateKind}): the controls are the list`, () => {
      const { choices, overflow } = contractChoices(shape.actions, seat);
      const all = [...choices, ...overflow];
      expect(choiceTokens(all).sort()).toEqual(listedTokens(shape));
      expect(all.filter((c) => c.reassignCli !== undefined).map((c) => c.reassignCli)).toEqual(seatsOf(shape));
      // A note box where (and only where) the engine takes one.
      for (const a of shape.actions) {
        const drawn = all.filter((c) => (c.decision as { action?: string } | null)?.action === a.action
          || (a.action === 'approve' && (c.key === 'approve' || c.key === 'steer')) || (a.action === 'reject' && c.key === 'stop'));
        if (a.note === 'none') expect(drawn.every((c) => !c.needsNote), `${name}/${a.action}`).toBe(true);
        if (a.note === 'required') expect(drawn.every((c) => c.needsNote), `${name}/${a.action}`).toBe(true);
      }
    });

    // Plan and deliver gates are drawn by the proposal card (`ProposalCard`), every other one by the session gate row.
    if (shape.gateKind !== 'plan_approval' && shape.gateKind !== 'deliver') {
      it(`${name}: the session gate row draws the same list`, () => {
        const gate: OpenGate = { runId: 'r', ord: shape.ord, prompt: 'Unit gate.', lifecycle: 'open', receivedAt: 1, gateKind: shape.gateKind };
        const model = sessionGateChoices({ runId: 'r', gate, units: [], events: [], pool: ['claude', 'codex', 'pi'], roster: null, actions: shape.actions });
        expect(model).not.toBeNull();
        const all = [...model!.choices, ...model!.overflow];
        expect(choiceTokens(all).sort()).toEqual(listedTokens(shape));
      });
    }
  }

  it('the capped review lands, and never offers a retry (studio#1155, #1167)', () => {
    const adj = shapes.find(([n]) => n === 'adj-qe')![1];
    const all = Object.values(contractChoices(adj.actions, seat)).flat();
    expect(all.map((c) => c.label)).toContain('Land with carried items and a note');
    expect(all.some((c) => /retry|redo/i.test(c.label))).toBe(false);
  });

  it('the distinct-evaluator retry card offers Reassign on the distinct seat', () => {
    const distinct = shapes.find(([n]) => n === 'distinct')![1];
    const all = Object.values(contractChoices(distinct.actions, (c) => (c === 'codex' ? 'Codex' : c))).flat();
    expect(all.map((c) => c.label)).toContain('Reassign to Codex');
  });

  it('a team pause\'s approve says what it does: accept the disputed work, or continue the team (wicked-core#1512)', () => {
    const words = (intent: string, noteIntent?: string) => Object.values(contractChoices([{ action: 'approve', intent, note: 'optional', ...(noteIntent !== undefined ? { noteIntent } : {}) }], seat)).flat().map((c) => c.label);
    expect(words('accept_work', 'send_back')).toEqual(['Accept the work as it stands', 'Send back with a note']);
    expect(words('continue_team')).toEqual(['Continue', 'Continue with a note']);
  });
});
