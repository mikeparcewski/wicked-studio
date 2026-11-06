import { describe, expect, it } from 'vitest';
import { foldJobLineages, foldLine, jobView, NO_RUN, progressOf, sentenceParts, settledLine, type JobProposal, type JobRunInputs } from '../src/board/jobStream.js';
import { unitStepName } from '../src/board/chainModel.js';
import { makeUnit, makeView } from './factories.js';
import { CHAT, jobProposal } from './jobFixtures.js';

/**
 * DES-CATALOG-002 rev 7 §2.8.3: the job stream — the lineage fold (crew's rules) and the one state every place draws
 * (§2.7.2), with its replies computed once (held, enabled, naming their version).
 */

const v2 = (over: Partial<JobProposal> = {}): JobProposal => jobProposal({
  pid: `${CHAT}:t2`, turnId: 't2', revises: `${CHAT}:t1`, answers: 't2',
  sentence: { ...jobProposal().sentence!, tokens: jobProposal().sentence!.tokens.map((t) => (t.id === 'option' ? { ...t, label: 'a move' } : t)) },
  ...over,
});
const rec = (at: number, kind: string, body: Record<string, unknown>, turnId = 't1'): Record<string, unknown> => ({ at, turnId, kind, ...body });
const NAME = { stepName: unitStepName };

describe('foldJobLineages', () => {
  it('folds a lineage across a typed correction: revising holds it, the revision supersedes, the mark names the change', () => {
    const ls = foldJobLineages([
      rec(1, 'user', { text: 'migrate it' }),
      rec(2, 'proposal', { proposal: jobProposal() }),
      rec(3, 'proposal_revising', { pid: `${CHAT}:t1` }, 't2'),
    ]);
    expect(ls).toHaveLength(1);
    expect(ls[0]!.state).toBe('revising');
    const after = foldJobLineages([
      rec(2, 'proposal', { proposal: jobProposal() }),
      rec(3, 'proposal_revising', { pid: `${CHAT}:t1` }, 't2'),
      rec(4, 'proposal', { proposal: v2() }, 't2'),
      rec(5, 'proposal_released', { pid: `${CHAT}:t1`, note: null }, 't2'),
    ]);
    expect(after).toHaveLength(1);
    const l = after[0]!;
    expect(l.versions.map((v) => v.pid)).toEqual([`${CHAT}:t1`, `${CHAT}:t2`]);
    expect(l.state).toBe('open');
    expect(l.marks).toEqual([expect.objectContaining({ turnId: 't2', kind: 'changed', version: 2, text: 'Changed the job to v2: a move' })]);
  });

  it('a hold released without a revision keeps the version and says crew’s note', () => {
    const [l] = foldJobLineages([
      rec(2, 'proposal', { proposal: jobProposal() }),
      rec(3, 'proposal_revising', { pid: `${CHAT}:t1` }, 't3'),
      rec(4, 'proposal_released', { pid: `${CHAT}:t1`, note: 'parity stays' }, 't3'),
    ]);
    expect(l!.state).toBe('open');
    expect(l!.versions).toHaveLength(1);
    expect(l!.note).toBe('parity stays');
    expect(l!.marks[0]).toMatchObject({ turnId: 't3', kind: 'unchanged', text: 'Nothing changed: parity stays' });
  });

  it('another proposal of the chat supersedes an open job (crew’s one open slot); a decided one stays decided', () => {
    const doc = { pid: `${CHAT}:t9`, kind: 'create', chatId: CHAT, seat: 'claude' };
    const [l] = foldJobLineages([rec(2, 'proposal', { proposal: jobProposal() }), rec(3, 'proposal', { proposal: doc }, 't9')]);
    expect(l!.state).toBe('superseded');
    const [d] = foldJobLineages([
      rec(2, 'proposal', { proposal: jobProposal() }),
      rec(3, 'proposal_accepting', { pid: `${CHAT}:t1`, resolution: jobProposal(), identity: { runId: 'run-1', artifactRef: null } }),
      rec(4, 'proposal_decided', { pid: `${CHAT}:t1`, decision: 'go', result: { runId: 'run-1', artifactRef: null, adopted: false, stub: false } }),
      rec(5, 'proposal', { proposal: doc }, 't9'),
    ]);
    expect(d!.state).toBe('decided');
    expect(d!.runId).toBe('run-1');
  });

  it('skips a malformed record and a proposal without wicked’s sentence', () => {
    expect(foldJobLineages([rec(1, 'proposal', { proposal: { ...jobProposal(), sentence: { text: 1 } } }), rec(2, 'proposal', { proposal: null })])).toEqual([]);
  });

  it('keeps the newest plan offer per run', () => {
    const offer = (id: string, planRev: number) => ({ id, kind: 'send_back', runId: 'run-1', pid: `${CHAT}:t1`, ord: 1, planRev, text: 'Send it back?', note: 'add rollback', choices: [{ label: 'Send it back', action: 'send_back' }, { label: 'No', action: 'dismiss' }] });
    const [l] = foldJobLineages([rec(2, 'proposal', { proposal: jobProposal() }), rec(3, 'plan_offer', { offer: offer('o1', 1) }), rec(4, 'plan_offer', { offer: offer('o2', 2) })]);
    expect(l!.offers.map((o) => o.id)).toEqual(['o2']);
  });
});

describe('jobView', () => {
  const lineage = (records: unknown[]) => foldJobLineages(records)[0]!;
  const open = lineage([rec(2, 'proposal', { proposal: jobProposal() })]);

  it('Proposed: Start names the version, Not now, up to two suggestions; tokens are live', () => {
    const v = jobView(open, NO_RUN, NAME);
    expect(v.phase).toBe('proposed');
    expect(v.label).toBe('what Start runs');
    expect(v.versionLabel).toBe('v1');
    expect(v.replies.map((r) => [r.id, r.label, r.enabled])).toEqual([['start', 'Start v1', true], ['not_now', 'Not now', true], ['suggestion:0', 'Make it a move', true]]);
    expect(v.tokensLive).toBe(true);
    expect(v.sketch).toEqual(['Plan', 'Port', 'Deliver']);
  });

  it('revising and a swap in flight hold Start (no optimistic text: the proposal drawn is crew’s last record)', () => {
    const revising = lineage([rec(2, 'proposal', { proposal: jobProposal() }), rec(3, 'proposal_revising', { pid: `${CHAT}:t1` }, 't2')]);
    const v = jobView(revising, NO_RUN, NAME);
    expect(v.phase).toBe('revising');
    expect(v.replies[0]).toMatchObject({ id: 'start', label: 'Updating…', enabled: false, held: 'waiting for your change to settle' });
    const s = jobView(open, NO_RUN, { ...NAME, swapPending: `${CHAT}:t1` });
    expect(s.phase).toBe('swapPending');
    expect(s.replies.find((r) => r.id === 'start')?.enabled).toBe(false);
    expect(s.proposal.sentence?.tokens.find((t) => t.id === 'option')?.label).toBe('an in-place upgrade');
    // A swap answered by crew (a newer head) no longer holds anything.
    const answered = lineage([rec(2, 'proposal', { proposal: jobProposal() }), rec(4, 'proposal', { proposal: v2() }, 't2')]);
    expect(jobView(answered, NO_RUN, { ...NAME, swapPending: `${CHAT}:t1` }).phase).toBe('proposed');
  });

  it('a blocked proposal holds Start with crew’s reason', () => {
    const v = jobView(lineage([rec(2, 'proposal', { proposal: jobProposal({ blocked: 'Needs a second helper' }) })]), NO_RUN, NAME);
    expect(v.replies[0]).toMatchObject({ enabled: false, held: 'Needs a second helper' });
  });

  it('Asking: the question’s choices replace Start; a choice that takes words binds the composer', () => {
    const q = { kind: 'lost_check' as const, text: 'Skip QE acceptance? Say why.', choices: [{ label: 'Skip it', edit: { skipQe: { reason: '' }, confirmLoss: true as const } }, { label: 'Keep QE', edit: { restoreQe: true as const } }], lost: ['qe-acceptance' as const], input: { kind: 'text' as const, label: 'Why skip it', edit: 'skipQe.reason' as const } };
    const v = jobView(lineage([rec(2, 'proposal', { proposal: jobProposal({ question: q }) })]), NO_RUN, NAME);
    expect(v.phase).toBe('asking');
    expect(v.replies.some((r) => r.id === 'start')).toBe(false);
    expect(v.replies.map((r) => [r.label, r.binds === true])).toEqual([['Skip it', true], ['Keep QE', false], ['Not now', false]]);
  });

  const started = lineage([
    rec(2, 'proposal', { proposal: jobProposal() }),
    rec(4, 'proposal_decided', { pid: `${CHAT}:t1`, decision: 'go', result: { runId: 'run-1', artifactRef: null, adopted: false, stub: false } }),
  ]);
  const runView = (status: string, units = [makeUnit({ ord: 0, status: 'done', phase_ref: 'plan' }), makeUnit({ ord: 1, status: 'pending', phase_ref: 'build' })], ix = 1) =>
    makeView({ id: 'run-1', status: status as never, unit_ix: ix }, units);
  const held = (over: Partial<JobRunInputs> = {}): JobRunInputs => ({
    ...NO_RUN, view: runView('awaiting_human'), gate: { ord: 1, receivedAt: 5, gateKind: 'plan_approval', prompt: '' },
    plan: { ord: 1, planRev: 2, steps: ['Plan', 'Port', 'Deliver'], fresh: true }, ...over,
  });

  it('Plan held: Approve names the plan version and is bound to run, ord and planRev; the margin says "plan v2"', () => {
    const v = jobView(started, held(), NAME);
    expect(v.phase).toBe('planHeld');
    expect(v.label).toBe('the job');
    expect(v.versionLabel).toBe('plan v2');
    expect(v.replies[0]).toMatchObject({ id: 'approve', label: 'Approve plan v2', target: 'plan:run-1:1:2', enabled: true });
    expect(v.tokensLive).toBe(false);
  });

  it('a plan read not made for this gate, a queued answer, and re-planning all hold Approve', () => {
    expect(jobView(started, held({ plan: { ord: 1, planRev: 2, steps: [], fresh: false } }), NAME).replies[0]).toMatchObject({ enabled: false, held: 'reading the plan…' });
    expect(jobView(started, held({ pending: { id: 1, queuedAt: 0, dueAt: 10_000, verb: 'approve' } }), NAME).replies[0]).toMatchObject({ enabled: false, held: 'your answer is queued' });
    const re = jobView(started, held({ sentBack: 2 }), NAME);
    expect(re.phase).toBe('replanning');
    expect(re.replies.every((r) => !r.enabled)).toBe(true);
    // The newer revision lands: it is approvable again.
    expect(jobView(started, held({ sentBack: 2, plan: { ord: 1, planRev: 3, steps: [], fresh: true } }), NAME).phase).toBe('planHeld');
  });

  it('Planning before the plan gate, Running after the plan was decided; terminal states from the run', () => {
    expect(jobView(started, { ...NO_RUN, view: runView('executing') }, NAME).phase).toBe('planning');
    const running = jobView(started, { ...NO_RUN, view: runView('executing'), planDecided: true }, NAME);
    expect(running.phase).toBe('running');
    expect(running.replies.map((r) => r.id)).toEqual(['stop']);
    expect(jobView(started, { ...NO_RUN, view: runView('completed') }, NAME).phase).toBe('delivered');
    expect(jobView(started, { ...NO_RUN, view: runView('cancelled') }, NAME).phase).toBe('stopped');
    expect(jobView(started, { ...NO_RUN, view: runView('failed') }, NAME).phase).toBe('failed');
    expect(jobView(started, { ...NO_RUN, view: runView('awaiting_human'), gate: { ord: 2, receivedAt: 1, gateKind: 'run_level', prompt: '' } }, NAME).phase).toBe('gate');
  });

  it('only offers made on the plan held now are pressable', () => {
    const offer = (planRev: number) => ({ id: `o${planRev}`, kind: 'send_back', runId: 'run-1', pid: `${CHAT}:t1`, ord: 1, planRev, text: 't', note: 'n', choices: [{ label: 'Send it back', action: 'send_back' }] });
    const l = lineage([rec(2, 'proposal', { proposal: jobProposal() }), rec(3, 'plan_offer', { offer: offer(1) }),
      rec(4, 'proposal_decided', { pid: `${CHAT}:t1`, decision: 'go', result: { runId: 'run-1', artifactRef: null, adopted: false, stub: false } })]);
    expect(jobView(l, held(), NAME).offers).toEqual([]);
    expect(jobView(l, held({ plan: { ord: 1, planRev: 1, steps: [], fresh: true } }), NAME).offers).toHaveLength(1);
  });
});

describe('the fold budget', () => {
  it('counts from recorded outcomes, never from position', () => {
    const view = makeView({ id: 'run-1', status: 'executing', unit_ix: 3 }, [
      makeUnit({ ord: 0, status: 'done', phase_ref: 'plan' }),
      makeUnit({ ord: 1, status: 'pending', phase_ref: 'test', phase_status: 'skipped' }),
      makeUnit({ ord: 2, status: 'done', phase_ref: 'build' }),
      makeUnit({ ord: 3, status: 'distributed', phase_ref: 'review', assigned_cli: 'claude' }),
      makeUnit({ ord: 4, status: 'pending', phase_ref: 'deliver' }),
      makeUnit({ ord: 5, status: 'pending', phase_ref: 'docs' }),
    ]);
    const p = progressOf(view, unitStepName, null);
    expect([p.done, p.notNeeded, p.failed, p.total]).toEqual([2, 1, 0, 6]);
    expect(p.current?.ord).toBe(3);
    expect(p.next?.ord).toBe(4);
    expect(p.more).toBe(1);
    expect(foldLine(p)).toMatch(/^2 of 6 done · 1 not needed · last: /);
  });
});

describe('words', () => {
  it('splits the sentence at its tokens and keeps an unknown placeholder as crew’s text', () => {
    const t = jobProposal().sentence!.tokens;
    const parts = sentenceParts('Port {repo} {nope} now', t);
    expect(parts.map((x) => ('token' in x ? `[${x.token.id}]` : x.text)).join('')).toBe('Port [repo] {nope} now');
  });
  it('the settled line never claims more than the record', () => {
    const l = foldJobLineages([rec(2, 'proposal', { proposal: jobProposal() }), rec(3, 'proposal_decided', { pid: `${CHAT}:t1`, decision: 'not_now', result: null })])[0]!;
    expect(settledLine(jobView(l, NO_RUN, NAME), null)).toBe('Not started: Migrate · Upgrade');
  });
});
