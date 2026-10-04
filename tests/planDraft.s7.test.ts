// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  draftLine, draftTarget, dropToken, gateDraftPlan, menuToken, midRunPlan, slashItems, type DraftRunState,
} from '../src/board/planDraft.js';
import { addChip, backspaceChips, chipText, messageWithAbout, quoteLabel, type AboutChip } from '../src/board/aboutChips.js';
import { composerSendRefusal, detectWorkflow, launchSubmit } from '../src/board/launchModel.js';
import type { RosterSeat } from '../src/api/types.js';

/** S7 (DES-STUDIO-REBUILD-001 §5.7): plan drafts, about-chips and the extracted launch rules — pure. */

const run = (over: Partial<DraftRunState>): DraftRunState => ({
  runId: 'r1', status: 'executing', planned: true, planGate: null, gatePending: false, ...over,
});

describe('where a / command lands', () => {
  it('with a plan gate open it is a gate-amend draft over the held plan', () => {
    expect(draftTarget([run({ status: 'awaiting_human', planGate: { seed: ['understand', 'build'] } })]))
      .toStrictEqual({ kind: 'gate-amend', runId: 'r1', seed: ['understand', 'build'] });
  });
  it('mid-run it is a mid-run edit of the newest live run', () => {
    expect(draftTarget([run({ runId: 'old', status: 'completed' }), run({ runId: 'r2' })])).toStrictEqual({ kind: 'mid-run', runId: 'r2' });
  });
  it('refuses, with the reason, everything else (no run, finished, fixed workflow, another gate, unknown gate)', () => {
    expect(draftTarget([]).kind).toBe('none');
    expect(draftTarget([run({ status: 'completed' })])).toMatchObject({ kind: 'none', reason: expect.stringMatching(/finished/) });
    expect(draftTarget([run({ planned: false })])).toMatchObject({ kind: 'none', reason: expect.stringMatching(/fixed workflow/) });
    expect(draftTarget([run({ status: 'awaiting_human' })])).toMatchObject({ kind: 'none', reason: expect.stringMatching(/answer it first/) });
    expect(draftTarget([run({ status: 'awaiting_human', gatePending: true })]).kind).toBe('none');
  });
});

describe('the / menu', () => {
  it('filters by command or word, and refuses what the engine cannot take before anything is queued', () => {
    const t = draftTarget([run({})]);
    expect(slashItems('te', t, null).map((i) => i.command.cmd)).toStrictEqual(['test']);
    const plan = slashItems('plan', t, null)[0]!;
    expect(plan.refused).toMatch(/only grows/);
    expect(slashItems('deliver', t, null)[0]!.refused).toMatch(/asks you at the end/);
    expect(slashItems('walk', t, ['test', 'review'])[0]!.refused).toBe('This engine has no Walkthrough step.');
    expect(slashItems('test', t, ['test'])[0]!.refused).toBeNull();
    expect(slashItems('test', draftTarget([]), null)[0]!.refused).toMatch(/Nothing has started/);
  });
  it('reads a trailing token at the caret only (a question is never a command)', () => {
    expect(menuToken('/te', 3)).toStrictEqual({ trigger: '/', query: 'te', start: 0 });
    expect(menuToken('ask @Kes', 8)).toStrictEqual({ trigger: '@', query: 'Kes', start: 4 });
    expect(menuToken('should we just plan it?', 23)).toBeNull();
    expect(menuToken('a/b', 3)).toBeNull();
    expect(dropToken('fix it /te', 7, 10)).toBe('fix it');
  });
});

describe('the plans a draft sends', () => {
  it('a gate amend sends the held plan plus the added steps; mid-run sends the added step only', () => {
    expect(gateDraftPlan({ seed: ['understand', 'build'], added: ['test'], order: null })).toStrictEqual({ steps: [{ catalog: 'understand' }, { catalog: 'build' }, { catalog: 'test' }] });
    expect(gateDraftPlan({ seed: ['test'], added: ['test'], order: null }).steps[1]).toStrictEqual({ catalog: 'test', id: 'test-2' });
    expect(midRunPlan('test')).toStrictEqual({ steps: [{ catalog: 'test' }] });
    expect(draftLine({ seed: ['build'], added: ['test', 'review'], order: null })).toBe('The steps change: + Test, + Review.');
  });
});

describe('about-chips', () => {
  const pay: AboutChip = { kind: 'about', key: 'q:pay', label: '“the Pay button”' };
  it('a selection becomes a quote; too short is nothing; long is cut', () => {
    expect(quoteLabel('  the   Pay button ')).toBe('“the Pay button”');
    expect(quoteLabel('ab')).toBeNull();
    expect(quoteLabel('x'.repeat(60))!.length).toBe(42);
  });
  it('Backspace in an empty box removes the last chip; with text it edits the text', () => {
    expect(backspaceChips([pay], '')).toStrictEqual([]);
    expect(backspaceChips([pay], 'x')).toBeNull();
    expect(backspaceChips([], '')).toBeNull();
  });
  it('a project replaces a project; a subject is not added twice; chips lead the message', () => {
    const a = addChip(addChip([], { kind: 'project', key: 'p:a', label: 'A', projectId: 'a' }), { kind: 'project', key: 'p:b', label: 'B', projectId: 'b' });
    expect(a.map((c) => c.key)).toStrictEqual(['p:b']);
    expect(addChip([pay], pay)).toHaveLength(1);
    expect(chipText(pay)).toBe('about: “the Pay button”');
    expect(chipText(a[0]!)).toBe('in: B');
    expect(messageWithAbout(' make it bigger ', [pay, ...a])).toBe('About “the Pay button”: make it bigger');
    expect(messageWithAbout('hi', a)).toBe('hi');
  });
});

describe('the launch rules, extracted (launchModel)', () => {
  const benched = { key: 'codex', display_name: 'Codex', binary: 'codex', enabled_for_council: true, health: { status: 'inactive', message: 'rate limited' } } as unknown as RosterSeat;
  it('studio#315: no seat that can carry the work refuses the send and says why', () => {
    expect(launchSubmit({ problem: 'x', selectedClis: new Set(['codex']), submitting: false, targetRequired: false, roster: [benched] }))
      .toMatchObject({ canSubmit: false, noSeatReason: expect.stringMatching(/codex: benched/) });
    expect(composerSendRefusal([benched], false)).toMatch(/^No helper can take this right now — codex: benched/);
    expect(composerSendRefusal(null, false)).toBeNull();
    expect(composerSendRefusal([], false)).toMatch(/No helper is set up/);
  });
  it('reads the workflow off the words as ChatInput did', () => {
    expect(detectWorkflow('fix the crash')).toBe('bug');
    expect(detectWorkflow('add a button')).toBe('feature');
    expect(detectWorkflow('migrate the tables')).toBe('migration');
    expect(detectWorkflow('hello')).toBeNull();
  });
});
