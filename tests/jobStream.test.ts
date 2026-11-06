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
    expect(l!.marks[0]).toMatchObject({ turnId: 't3', kind: 'unchanged', text: 'parity stays' });
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
    plan: { ord: 1, planRev: 2, steps: ['Plan', 'Port', 'Deliver'].map((label) => ({ id: label, label, detail: null, asks: null, floor: false, added: false })), fresh: true }, ...over,
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

describe('review round 1 folds', () => {
  const lineage = (records: unknown[]) => foldJobLineages(records)[0]!;
  it('a same-pid re-resolution is another press target (a press or binding on it never answers it)', () => {
    const a = jobView(lineage([rec(2, 'proposal', { proposal: jobProposal() })]), NO_RUN, NAME);
    const b = jobView(lineage([rec(2, 'proposal', { proposal: jobProposal() }), rec(3, 'proposal', { proposal: jobProposal({ blocked: null, suggestions: [] }) })]), NO_RUN, NAME);
    expect(a.replies[0]!.target).not.toBe(b.replies[0]!.target);
    expect(a.replies[0]!.target.startsWith(`${CHAT}:t1#`)).toBe(true);
  });
  it('a child with `revises` and no `lineage` joins its parent’s lineage; a new version launched nothing yet', () => {
    const ls = foldJobLineages([
      rec(2, 'proposal', { proposal: jobProposal() }),
      rec(3, 'proposal_decided', { pid: `${CHAT}:t1`, decision: 'go', result: { runId: 'run-1', artifactRef: null, adopted: false, stub: false } }),
      rec(4, 'proposal', { proposal: { ...v2(), lineage: undefined } }, 't2'),
    ]);
    expect(ls).toHaveLength(1);
    expect(ls[0]!.runId).toBeNull();
  });
  it('a malformed job record never supersedes the job drawn', () => {
    const [l] = foldJobLineages([rec(2, 'proposal', { proposal: jobProposal() }), rec(3, 'proposal', { proposal: { ...jobProposal({ pid: `${CHAT}:t9` }), what: null } }, 't9')]);
    expect(l!.state).toBe('open');
  });
  const started = lineage([
    rec(2, 'proposal', { proposal: jobProposal() }),
    rec(4, 'proposal_decided', { pid: `${CHAT}:t1`, decision: 'go', result: { runId: 'run-1', artifactRef: null, adopted: false, stub: false } }),
  ]);
  const run = (status: string) => makeView({ id: 'run-1', status: status as never, unit_ix: 1 }, [makeUnit({ ord: 0, status: 'done' }), makeUnit({ ord: 1, status: 'pending' })]);
  it('after a send-back (recorded as an amended decision) the executing run is re-planning, not running', () => {
    const v = jobView(started, { ...NO_RUN, view: run('executing'), planDecided: true, sentBack: 2 }, NAME);
    expect(v.phase).toBe('replanning');
    expect(v.replies.every((r) => !r.enabled)).toBe(true);
  });
  it('a waiting run whose gate kind is not known yet fails closed as a plan being read (never a gate without planRev)', () => {
    const v = jobView(started, { ...NO_RUN, view: run('awaiting_human'), gate: { ord: 1, receivedAt: 1, prompt: '' }, planUnknown: true }, NAME);
    expect(v.phase).toBe('planHeld');
    expect(v.replies[0]).toMatchObject({ id: 'approve', enabled: false, held: 'reading the plan…' });
  });
  it('an answer being sent holds the plan and every offer', () => {
    const offer = { id: 'o2', kind: 'reshape', runId: 'run-1', pid: `${CHAT}:t1`, ord: 1, planRev: 2, text: 'Start again as a move?', choices: [{ label: 'Start again', action: 'reshape' }] };
    const l = lineage([rec(2, 'proposal', { proposal: jobProposal() }), rec(3, 'plan_offer', { offer }),
      rec(4, 'proposal_decided', { pid: `${CHAT}:t1`, decision: 'go', result: { runId: 'run-1', artifactRef: null, adopted: false, stub: false } })]);
    const inputs = { ...NO_RUN, view: run('awaiting_human'), gate: { ord: 1, receivedAt: 1, gateKind: 'plan_approval', prompt: '' }, plan: { ord: 1, planRev: 2, steps: [], fresh: true } };
    expect(jobView(l, inputs, NAME).offerHeld).toBeNull();
    expect(jobView(l, { ...inputs, answering: true }, NAME).offerHeld).toBe('your answer is being sent');
    expect(jobView(l, { ...inputs, pending: { id: 1, queuedAt: 0, dueAt: 1, verb: 'approve' } }, NAME).offerHeld).toBe('your answer is queued');
    expect(jobView(l, { ...inputs, reshapeOn: false }, NAME).reshapeHeld).not.toBeNull();
  });
  it('a launch crew recorded is drawn even while the proposal still reads accepting', () => {
    const accepting = lineage([rec(2, 'proposal', { proposal: jobProposal() }), rec(3, 'proposal_accepting', { pid: `${CHAT}:t1`, resolution: jobProposal(), identity: { runId: 'run-1', artifactRef: null } })]);
    expect(jobView(accepting, { ...NO_RUN, view: run('executing') }, { ...NAME, now: 10 }).phase).toBe('planning');
  });
});

describe('review round 3 folds', () => {
  const lineage = (records: unknown[]) => foldJobLineages(records)[0]!;
  it('a run launched from the version drawn is the job’s state, even while an older read says the proposal is open', () => {
    const open = lineage([rec(2, 'proposal', { proposal: jobProposal() })]);
    const run = makeView({ id: 'run-1', status: 'executing', unit_ix: 0 }, [makeUnit({ ord: 0, status: 'distributed' })]);
    const v = jobView(open, { ...NO_RUN, view: run }, NAME);
    expect(v.phase).toBe('planning');
    expect(v.replies.some((r) => r.id === 'start')).toBe(false);
  });
  it('a refused step a gate waits at is still counted as failed', () => {
    const view = makeView({ id: 'run-1', status: 'awaiting_human', unit_ix: 1 }, [makeUnit({ ord: 0, status: 'done', phase_ref: 'plan' }), makeUnit({ ord: 1, status: 'rejected', phase_ref: 'build' })]);
    const p = progressOf(view, unitStepName, 1);
    expect(p.current?.ord).toBe(1);
    expect([p.done, p.failed]).toEqual([1, 1]);
  });
  it('a replacement offer on the same plan is announced once', async () => {
    const { announceOf } = await import('../src/board/jobStream.js');
    const mk = (id: string) => ({ id, kind: 'send_back', runId: 'run-1', pid: `${CHAT}:t1`, ord: 1, planRev: 2, text: `offer ${id}`, note: 'n', choices: [{ label: 'Send it back', action: 'send_back' }] });
    const base = (o: unknown) => foldJobLineages([rec(2, 'proposal', { proposal: jobProposal() }), rec(3, 'plan_offer', { offer: o }),
      rec(4, 'proposal_decided', { pid: `${CHAT}:t1`, decision: 'go', result: { runId: 'run-1', artifactRef: null, adopted: false, stub: false } })])[0]!;
    const inputs = { ...NO_RUN, view: makeView({ id: 'run-1', status: 'awaiting_human', unit_ix: 1 }, [makeUnit({ ord: 0, status: 'done' }), makeUnit({ ord: 1, status: 'pending' })]),
      gate: { ord: 1, receivedAt: 1, gateKind: 'plan_approval', prompt: '' }, plan: { ord: 1, planRev: 2, steps: [], fresh: true } };
    const a = jobView(base(mk('o1')), inputs, NAME);
    const b = jobView(base(mk('o2')), inputs, NAME);
    expect(announceOf(a, b)).toBe('wicked offers: offer o2');
  });
});

describe('follow-up: plan outline, re-plan on record, ticks', () => {
  it('enriches the held plan from the record: detail, asks you, the floor, and what is new against the revision before', async () => {
    const { enrichPlan } = await import('../src/board/jobStream.js');
    const rows = [
      { event_id: 1, event_type: 'wicked.team.plan.proposed', payload: { asks: [], steps: [{ id: 'port', catalog: 'build', instructions: 'reporting-api to .NET 8\nmore' }, { id: 'cutover', catalog: 'cutover', gate: { human_confirm: { unconditional: true } } }] } },
      { event_id: 5, event_type: 'wicked.team.plan.proposed', payload: { asks: [], steps: [{ id: 'port', catalog: 'build', instructions: 'reporting-api to .NET 8\nmore', gate: 'auto' }, { id: 'cutover', catalog: 'cutover', gate: { human_confirm: { unconditional: true } } }, { id: 'rollback', catalog: 'build', gate: { human_confirm_if: 'verdict_not_pass' } }, { id: 'deliver', catalog: 'deliver', gate: 'consent_before' }, { id: 'review-floor', catalog: 'review', added_by: 'floor' }] } },
      { event_id: 7, event_type: 'wicked.team.gate.opened', payload: { kind: 'plan_approval', gate_id: 'g2', ord: 1, plan_rev: 2 } },
      // A later proposal (a re-plan in flight, or one crew refused) never describes the plan held now.
      { event_id: 9, event_type: 'wicked.team.plan.proposed', payload: { asks: [], steps: [{ id: 'port', catalog: 'build', instructions: 'Delete everything' }] } },
    ];
    const steps = [['port', 'build', 'Port'], ['cutover', 'cutover', 'Cut over'], ['rollback', 'build', 'Roll back if parity fails'], ['deliver', 'deliver', 'Deliver'], ['review-floor', 'review', 'Review']]
      .map(([id, catalog, label]) => ({ id: id!, catalog: catalog!, label: label! }));
    const p = enrichPlan(steps, rows, 2);
    expect(p.steps.map((s) => [s.label, s.detail, s.asks, s.floor, s.added])).toEqual([
      ['Port', 'reporting-api to .NET 8', null, false, false],
      ['Cut over', null, 'always', false, false],
      ['Roll back if parity fails', null, 'if-fails', false, true],
      ['Deliver', null, 'always', false, true],
      ['Review', null, null, true, true],
    ]);
    expect(p.changed).toBe('Plan v2: added Roll back if parity fails, Deliver, Review');
    expect(enrichPlan(steps.slice(0, 2), rows.slice(0, 1), 1).changed).toBeNull();
    // A proposal crew refused never describes the plan either.
    const refusedRows = [...rows.slice(0, 2),
      { event_id: 6, event_type: 'wicked.team.plan.proposed', payload: { proposal_id: 'p3', asks: [], steps: [{ id: 'port', catalog: 'build', instructions: 'Delete everything' }] } },
      { event_id: 6.5, event_type: 'wicked.team.plan.refused', payload: { proposal_id: 'p3' } }, rows[2]!];
    expect(enrichPlan(steps, refusedRows, 2).steps[0]!.detail).toBe('reporting-api to .NET 8');
  });

  it('reads a re-plan from the record (a send-back in any tab) until crew accepts or holds a plan, or the work starts', async () => {
    const { replanningOnRecord } = await import('../src/board/jobStream.js');
    const opened = { event_id: 2, event_type: 'wicked.team.gate.opened', payload: { kind: 'plan_approval', gate_id: 'g1', ord: 1, plan_rev: 1 } };
    const amended = { event_id: 3, event_type: 'wicked.team.gate.decided', payload: { kind: 'plan_approval', gate_id: 'g1', decision: 'human_amended' } };
    const units = [{ ord: 0, status: 'distributed' }, { ord: 1, status: 'pending' }];
    expect(replanningOnRecord([opened, amended], units)).toBe(1);
    expect(replanningOnRecord([opened, amended, { event_id: 4, event_type: 'wicked.team.plan.accepted', payload: {} }], units)).toBeNull();
    expect(replanningOnRecord([opened, amended], [{ ord: 0, status: 'done' }, { ord: 1, status: 'distributed' }])).toBeNull();
    expect(replanningOnRecord([opened, { ...amended, payload: { ...amended.payload, decision: 'human_approved' } }], units)).toBeNull();
  });

  it('ticks come from the records, each at its recorded time', async () => {
    const { jobTicks } = await import('../src/board/jobStream.js');
    const l = foldJobLineages([rec(2, 'proposal', { proposal: jobProposal() }),
      rec(10, 'proposal_decided', { pid: `${CHAT}:t1`, decision: 'go', result: { runId: 'run-1', artifactRef: null, adopted: false, stub: false } })])[0]!;
    const rows = [
      { event_id: 2, emitted_at: 20, event_type: 'wicked.team.gate.opened', payload: { kind: 'plan_approval', gate_id: 'g1', ord: 1, plan_rev: 1 } },
      { event_id: 3, emitted_at: 30, event_type: 'wicked.team.gate.decided', payload: { kind: 'plan_approval', gate_id: 'g1', decision: 'human_amended' } },
      { event_id: 4, emitted_at: 40, event_type: 'wicked.team.gate.opened', payload: { kind: 'plan_approval', gate_id: 'g2', ord: 1, plan_rev: 2 } },
      { event_id: 5, emitted_at: 50, event_type: 'wicked.team.gate.decided', payload: { kind: 'plan_approval', gate_id: 'g2', decision: 'human_approved' } },
      { event_id: 6, event_type: 'wicked.team.gate.opened', payload: { kind: 'plan_approval', gate_id: 'g3', ord: 1, plan_rev: 3 } },
    ];
    expect(jobTicks(l, rows, 'Codex').map((t) => [t.at, t.text])).toEqual([
      [10, 'You started the job, v1'],
      [20, 'Codex’s plan, v1, is ready'],
      [30, 'You sent plan v1 back'],
      [40, 'Codex’s plan, v2, is ready'],
      [50, 'You approved plan v2'],
    ]);
  });
});

describe('follow-up review folds (records)', () => {
  it('an amended decision keeps its own outcome: a later plan never rewrites "approved with your changes"', async () => {
    const { jobTicks } = await import('../src/board/jobStream.js');
    const l = foldJobLineages([rec(2, 'proposal', { proposal: jobProposal() }),
      rec(10, 'proposal_decided', { pid: `${CHAT}:t1`, decision: 'go', result: { runId: 'run-1', artifactRef: null, adopted: false, stub: false } })])[0]!;
    const rows = [
      { event_id: 2, emitted_at: 20, event_type: 'wicked.team.gate.opened', payload: { kind: 'plan_approval', gate_id: 'g1', ord: 1, plan_rev: 1 } },
      { event_id: 3, emitted_at: 30, event_type: 'wicked.team.gate.decided', payload: { kind: 'plan_approval', gate_id: 'g1', decision: 'human_amended' } },
      { event_id: 4, emitted_at: 35, event_type: 'wicked.team.plan.accepted', payload: {} },
      { event_id: 8, emitted_at: 80, event_type: 'wicked.team.gate.opened', payload: { kind: 'plan_approval', gate_id: 'g2', ord: 3, plan_rev: 2 } },
    ];
    expect(jobTicks(l, rows, 'Codex').map((t) => t.text)).toContain('You approved plan v1 with your changes');
  });
  it('a recorded Start the test configuration took is no "started" tick', async () => {
    const { jobTicks } = await import('../src/board/jobStream.js');
    const l = foldJobLineages([rec(2, 'proposal', { proposal: jobProposal() }),
      rec(10, 'proposal_decided', { pid: `${CHAT}:t1`, decision: 'go', result: { runId: 'run-1', artifactRef: null, adopted: false, stub: true } })])[0]!;
    expect(jobTicks(l, [], 'Codex')).toEqual([]);
  });
  it('a reshape keeps the ticks of the job it replaced (each decision by its own pid, each run its own record)', async () => {
    const { jobTicks } = await import('../src/board/jobStream.js');
    const l = foldJobLineages([
      rec(2, 'proposal', { proposal: jobProposal() }),
      rec(10, 'proposal_decided', { pid: `${CHAT}:t1`, decision: 'go', result: { runId: 'run-1', artifactRef: null, adopted: false, stub: false } }),
      rec(40, 'proposal', { proposal: v2({ reshapes: 'run-1' } as never) }, 't2'),
    ])[0]!;
    const rows = [{ event_id: 2, emitted_at: 20, event_type: 'wicked.team.gate.opened', payload: { kind: 'plan_approval', gate_id: 'g1', ord: 1, plan_rev: 1 } }];
    expect(jobTicks(l, [{ runId: 'run-1', rows }], 'Codex').map((t) => t.text)).toEqual(['You started the job, v1', 'Codex’s plan, v1, is ready']);
  });
});


describe('follow-up round 2 folds (records)', () => {
  it('a plan gate names its work by reviewing_ord; work on record and started is no re-plan', async () => {
    const { replanningOnRecord } = await import('../src/board/jobStream.js');
    const opened = { event_id: 2, event_type: 'wicked.team.gate.opened', payload: { kind: 'plan_approval', gate_id: 'g1', ord: null, reviewing_ord: 2, plan_rev: 1 } };
    const amended = { event_id: 3, event_type: 'wicked.team.gate.decided', payload: { kind: 'plan_approval', gate_id: 'g1', decision: 'human_amended' } };
    expect(replanningOnRecord([opened, amended], [{ ord: 1, status: 'done' }, { ord: 2, status: 'distributed' }])).toBeNull();
    expect(replanningOnRecord([opened, amended], [{ ord: 1, status: 'distributed' }, { ord: 2, status: 'pending' }])).toBe(1);
    expect(replanningOnRecord([opened, amended], [{ ord: 1, status: 'distributed' }])).toBeNull();
  });
  it('a conditional human_confirm may ask; an unconditional one asks', async () => {
    const { enrichPlan } = await import('../src/board/jobStream.js');
    const rows = [
      { event_id: 1, event_type: 'wicked.team.plan.proposed', payload: { steps: [{ id: 'a', catalog: 'build', gate: { human_confirm: { unconditional: false } } }, { id: 'b', catalog: 'build', gate: { human_confirm: { unconditional: true } } }] } },
      { event_id: 2, event_type: 'wicked.team.gate.opened', payload: { kind: 'plan_approval', gate_id: 'g1', ord: 1, plan_rev: 1 } },
    ];
    expect(enrichPlan([{ id: 'a', catalog: 'build', label: 'A' }, { id: 'b', catalog: 'build', label: 'B' }], rows, 1).steps.map((x) => x.asks)).toEqual(['maybe', 'always']);
  });
  it('each run’s plan ticks name the lead of the version that launched it', async () => {
    const { jobTicks } = await import('../src/board/jobStream.js');
    const l = foldJobLineages([rec(2, 'proposal', { proposal: jobProposal() }),
      rec(10, 'proposal_decided', { pid: `${CHAT}:t1`, decision: 'go', result: { runId: 'run-1', artifactRef: null, adopted: false, stub: false } })])[0]!;
    const rows = [{ event_id: 2, emitted_at: 20, event_type: 'wicked.team.gate.opened', payload: { kind: 'plan_approval', gate_id: 'g1', ord: 1, plan_rev: 1 } }];
    expect(jobTicks(l, [{ runId: 'run-1', rows, lead: 'Codex' }], 'Claude').map((t) => t.text)).toContain('Codex’s plan, v1, is ready');
  });
});
