import type { CoreEvent } from '../api/types.js';
import {
  POWER_EVENT_TYPES, RIGORS, isRigor, rigorRank,
  type HandoffStep, type PowerActivityEvent, type PowerCheckpointEvent, type PowerState, type PowerToggle, type PowerTurnEvent,
  type Rigor, type RigorChange, type RigorPlan,
} from '../api/power.js';

/**
 * POWER MODE in the run's thread and header (program DES-POWER-MODE; mockup design/mockups/power-mode.html). Pure:
 * the words and the timeline the components draw, from the run's power state (`AgentSession.power`) and its power
 * frames (live `/ws` and the recorded trail alike).
 */

// ── rigor words ─────────────────────────────────────────────────────────────────────────────────────────

/** What hand-off applies at each rigor (DES-POWER-MODE §3.2), in the intake card's words. */
const HANDOFF_WORDS: Record<Rigor, string> = {
  light: 'targeted tests, and a different reviewer if policy asks for one',
  standard: 'targeted tests, a different reviewer, QE acceptance at hand-off',
  high: 'the full suite, a different reviewer, QE acceptance and a design check',
  highest: 'the full suite, a different reviewer, a security review and QE acceptance',
};

/** One line per rigor for the Raise menu. */
export const RAISE_WORDS: Record<Rigor, string> = {
  light: 'Targeted tests only',
  standard: 'Targeted tests, a different reviewer, QE acceptance',
  high: 'Full suite at hand-off, a design check at the first checkpoint',
  highest: 'High, plus a security review on its own seat',
};

export function rigorWord(r: Rigor): string {
  return r;
}

export function handoffWords(r: Rigor, plan: RigorPlan | null = null): string {
  // The plan's own requirements win when they are richer than the band's default (a plugin's check, a policy review).
  if (plan !== null && plan.rigor === r) {
    const parts: string[] = [plan.handoff.tests === 'full' ? 'the full suite' : 'targeted tests'];
    for (const rv of plan.handoff.reviews) parts.push(rv.kind === 'security' ? 'a security review' : rv.kind === 'design' ? 'a design check' : 'a different reviewer');
    if (plan.handoff.qeAcceptance.required) parts.push('QE acceptance at hand-off');
    if (parts.length > 1) return listWords(parts);
  }
  return HANDOFF_WORDS[r];
}

/** What a raise changes at hand-off: "hand-off now runs the full suite". */
export function raiseConsequence(from: Rigor | null, to: Rigor | null): string | null {
  if (from === null || to === null || rigorRank(to) <= rigorRank(from)) return null;
  if (to === 'highest') return 'hand-off adds a security review on its own seat';
  if (to === 'high') return 'hand-off now runs the full suite';
  if (to === 'standard') return 'hand-off adds a different reviewer and QE acceptance';
  return null;
}

export function listWords(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]!}`;
}

// ── the header's chip and switch ──────────────────────────────────────────────────────────────────────────

export interface RigorChip {
  rigor: Rigor;
  /** Rigor went up after intake (the chip shows ↑). */
  raised: boolean;
  /** "Rigor high since 14:19: the sign-in module touched. Hand-off runs the full suite." */
  title: string;
  /** The change that set it, when the history has one. */
  since: RigorChange | null;
}

export function rigorChip(p: PowerState, clock: (ms: number) => string): RigorChip | null {
  const rigor = p.rigor ?? p.plan?.rigor ?? null;
  if (rigor === null) return null;
  const changes = p.history.filter((c) => c.direction !== 'same');
  const since = [...changes].reverse().find((c) => c.to === rigor) ?? null;
  const planned = p.plan?.rigor ?? (p.history[0]?.from ?? null);
  const raised = planned !== null ? rigorRank(rigor) > rigorRank(planned) : changes.some((c) => c.direction === 'up');
  const at = since?.at ?? p.plan?.at ?? null;
  const why = since !== null && changeReason(since) !== null ? `: ${changedBy(since) === 'you' ? 'you raised it' : changeReason(since)!}` : p.plan !== null && since === null ? ` (intake, change score ${p.plan.score})` : '';
  const title = `Rigor ${rigor}${at !== null ? ` since ${clock(at)}` : ''}${why}. Hand-off: ${handoffWords(rigor, p.plan)}.`;
  return { rigor, raised, title, since };
}

export interface PowerSwitch {
  checked: boolean;
  /** Why the switch can't be flipped now (its tooltip); null = it can. */
  disabled: string | null;
  /** The tooltip of a live switch: what flipping it does. */
  title: string;
}

const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

/**
 * The run header's switch (DES-POWER-MODE §2): On -> Off is always allowed (it adds rigor; the rest goes phased). Off
 * -> On only for the phases the plan doesn't mandate, and never when phased is required (Off and disabled, the reason
 * in its tooltip).
 */
export function powerSwitch(p: PowerState, status: string): PowerSwitch {
  if (!p.available) {
    const why = p.refusedReason ?? p.plan?.phasedRequired ?? 'policy requires it for this job';
    return { checked: false, disabled: `Phased is required: ${stripPeriod(why)}`, title: '' };
  }
  if (TERMINAL.has(status)) return { checked: p.on, disabled: `This job has ended, so there is nothing left to switch (power mode was ${p.on ? 'on' : 'off'})`, title: '' };
  if (p.on) {
    return {
      checked: true, disabled: null,
      title: 'Power mode is on: one orchestrator works with you in this conversation, checks at every commit and raises rigor as the work grows. One human gate, at hand-off. Turn it off and the rest of the work goes phased, with a gate after each phase.',
    };
  }
  const stay = (p.plan?.mandatoryPhases ?? []).map((m) => m.phase);
  return {
    checked: false, disabled: null,
    title: stay.length > 0
      ? `Power mode for the rest. ${listWords(stay.map(capital))} ${stay.length === 1 ? 'stays' : 'stay'} phased (required by the plan).`
      : 'Power mode for the rest: one orchestrator finishes the work, and rigor applies once at hand-off.',
  };
}

function stripPeriod(s: string): string {
  return s.trim().replace(/\.$/, '');
}

function capital(s: string): string {
  const w = s.replace(/[_-]+/g, ' ').trim();
  return w === '' ? w : w[0]!.toUpperCase() + w.slice(1);
}

// ── the thread's timeline ──────────────────────────────────────────────────────────────────────────────

export interface ActivityRow {
  kind: PowerActivityEvent['kind'];
  at: number | null;
  /** "Edited", "Tests passed", "Commit 2". */
  lead: string;
  code: string | null;
  added: number | null;
  removed: number | null;
  /** The rest of the line, after the code: "19 passed", "Serve /v2/invoice.pdf and keep /v1 as an alias". */
  tail: string | null;
  sha: string | null;
  tone: 'plain' | 'pass' | 'fail' | 'commit';
}

export type PowerItem =
  | { kind: 'intake'; key: string; at: number | null; plan: RigorPlan }
  | { kind: 'turn'; key: string; at: number | null; turn: number; cli: string; summary: string; outcome: PowerTurnEvent['outcome'] | null }
  | { kind: 'acts'; key: string; at: number | null; rows: ActivityRow[] }
  | { kind: 'checkpoint'; key: string; at: number | null; checkpoint: number; words: string; picked: number; paused: boolean }
  | { kind: 'rigor'; key: string; at: number | null; change: RigorChange; words: string }
  | { kind: 'toggle'; key: string; at: number | null; toggle: PowerToggle; words: string }
  | { kind: 'handoff'; key: string; at: number | null; round: number; steps: HandoffStep[] };

type Ev = CoreEvent & Record<string, unknown>;

const tsOf = (e: Ev): number | null => (typeof e.ts === 'number' && e.ts > 0 ? e.ts : null);

export function isPowerEvent(e: { type?: unknown }): boolean {
  return typeof e.type === 'string' && POWER_EVENT_TYPES.has(e.type);
}

function activityRow(e: PowerActivityEvent, commitN: number): ActivityRow {
  const at = typeof e.at === 'number' && e.at > 0 ? e.at : (e.ts ?? null);
  const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  if (e.kind === 'commit') {
    return { kind: 'commit', at, lead: `Commit ${commitN}`, code: null, added: null, removed: null, tail: e.subject ?? null, sha: typeof e.sha === 'string' ? e.sha.slice(0, 7) : null, tone: 'commit' };
  }
  if (e.kind === 'test') {
    const failed = n(e.failed) ?? 0;
    const passed = n(e.passed);
    const tail = failed > 0 ? `${failed} failed${passed !== null ? `, ${passed} passed` : ''}` : passed !== null ? `${passed} passed` : null;
    return { kind: 'test', at, lead: failed > 0 ? 'Tests failed' : 'Tests passed', code: e.command ?? null, added: null, removed: null, tail, sha: null, tone: failed > 0 ? 'fail' : 'pass' };
  }
  if (e.kind === 'read') {
    const paths = e.paths ?? (typeof e.path === 'string' ? [e.path] : []);
    const shown = paths.slice(0, 2).map((p) => p.split('/').pop() ?? p);
    const more = paths.length - shown.length;
    return { kind: 'read', at, lead: 'Read', code: shown.join(', ') || null, added: null, removed: null, tail: more > 0 ? `and ${more} more` : null, sha: null, tone: 'plain' };
  }
  return { kind: 'edit', at, lead: 'Edited', code: e.path ?? (e.paths?.[0] ?? null), added: n(e.added), removed: n(e.removed), tail: null, sha: null, tone: 'plain' };
}

/** "Checkpoint 2 · commit 2 · picked up your note", "Checkpoint 1 · commit 1 · rigor stays standard (score 34 → 36)". */
export function checkpointWords(cp: PowerCheckpointEvent, change: RigorChange | null, commits: number): string {
  const parts = [`Checkpoint ${cp.checkpoint}`];
  parts.push(cp.trigger === 'commit' ? (commits > 0 ? `commit ${commits}` : cp.head !== null ? `commit ${cp.head.slice(0, 7)}` : 'commit')
    : cp.trigger === 'turn' ? `end of turn ${cp.turn}` : cp.trigger === 'timer' ? 'on the timer' : 'before hand-off');
  if (cp.picked > 0) parts.push(cp.picked === 1 ? 'picked up your note' : `picked up ${cp.picked} notes`);
  else if (change === null || change.direction === 'same') {
    parts.push(change !== null ? `rigor stays ${cp.rigor} (score ${change.planned} → ${change.actual})` : `rigor stays ${cp.rigor}`);
  }
  if (cp.paused) parts.push('paused: this grew');
  return parts.join(' · ');
}

/** Who changed rigor, in the operator's words: the engine, a plugin, or you (any person: crew's `local` actor too). */
export function changedBy(c: Pick<RigorChange, 'by' | 'trigger'>): 'engine' | 'plugin' | 'you' {
  if (c.by.startsWith('plugin:') || c.trigger === 'plugin') return 'plugin';
  if (c.by === 'engine' || c.by === '') return c.trigger === 'operator' ? 'you' : 'engine';
  return 'you';
}

/** A change's reason without the engine's own framing ("raised by local: …"): the words a person reads. */
export function changeReason(c: Pick<RigorChange, 'reasons'>): string | null {
  const r = c.reasons[0];
  if (r === undefined) return null;
  const clean = r.replace(/^\s*(raised|lowered) by [^:]+:\s*/i, '').trim();
  return clean === '' ? null : clean;
}

/** What surrounds a rigor change in the run: the checkpoint that paused before it, and whether hand-off ran after. */
export interface RigorMarkContext {
  pausedCheckpoint: number | null;
  handoffRan: boolean;
}

/** What a raise does at hand-off, said in the past once hand-off ran. */
export function raiseConsequenceWhen(from: Rigor | null, to: Rigor | null, ran: boolean): string | null {
  const now = raiseConsequence(from, to);
  if (now === null || !ran) return now;
  return now.replace('hand-off now runs', 'hand-off ran').replace('hand-off adds', 'hand-off added');
}

/**
 * "Rigor ↑ standard → high · you chose ‘continue at high rigor’ at checkpoint 2 — hand-off ran the full suite".
 * Never an actor id ("local"): a person is "you".
 */
export function rigorMarkWords(c: RigorChange, ctx: RigorMarkContext = { pausedCheckpoint: null, handoffRan: false }): { head: string; tail: string } {
  const arrow = c.direction === 'up' ? '↑' : c.direction === 'down' ? '↓' : '·';
  const head = `Rigor ${arrow} ${c.from ?? 'unset'} → ${c.to ?? 'unset'}`;
  const reason = changeReason(c);
  const who = changedBy(c);
  const at = ctx.pausedCheckpoint !== null ? `at checkpoint ${ctx.pausedCheckpoint}` : 'at a checkpoint pause';
  const lead = who === 'you'
    ? (reason !== null && /continue at high rigor/i.test(reason) ? `you chose ‘continue at high rigor’ ${at}` : reason !== null ? `you raised it: ${reason}` : 'you raised it')
    : who === 'plugin' ? `raised by ${c.by.replace(/^plugin:/, '').replace(/@.*$/, '')}${reason !== null ? `: ${reason}` : ''}`
      : c.trigger === 'doc_edit' ? `raised by a working-document edit${reason !== null ? `: ${reason}` : ''}`
        : reason;
  const consequence = raiseConsequenceWhen(c.from, c.to, ctx.handoffRan);
  const tail = c.direction === 'down'
    ? `lowered from evidence${reason !== null ? `: ${reason}` : ''}`
    : [lead, consequence].filter((x): x is string => x !== null && x !== '').join(' — ');
  return { head, tail };
}

/** The rigor in effect at `t`: the newest change at or before it, else the plan's. */
export function rigorAt(p: Pick<PowerState, 'history' | 'plan' | 'rigor'> | null, t: number | null): Rigor | null {
  if (p === null) return null;
  if (t === null) return p.rigor ?? p.plan?.rigor ?? null;
  let r: Rigor | null = p.plan?.rigor ?? null;
  for (const c of [...p.history].sort((a, b) => a.at - b.at)) {
    if (c.at <= t && c.to !== null) r = c.to;
  }
  return r ?? p.rigor ?? null;
}

/**
 * The hand-off steps as they ended: one row per step (the newest record of it), and, once a step's unit finished
 * or the run ended, never "running" or "waiting": the unit's own result says passed or failed, and a step that never
 * got to run on an ended run is skipped.
 */
export function settleHandoff(steps: readonly HandoffStep[], unitStatus: (ord: number) => string | undefined, terminal: boolean): HandoffStep[] {
  const latest = new Map<string, HandoffStep>();
  for (const st of steps) {
    const cur = latest.get(st.step);
    if (cur === undefined || st.at >= cur.at) latest.set(st.step, st);
  }
  return orderSteps([...latest.values()].map((st) => {
    if (st.status !== 'running' && st.status !== 'pending') return st;
    const u = st.ord !== null ? unitStatus(st.ord) : undefined;
    if (u === 'done') return { ...st, status: 'passed' as const };
    if (u === 'rejected' || u === 'failed') return { ...st, status: 'failed' as const };
    return terminal ? { ...st, status: 'skipped' as const } : st;
  }));
}

/**
 * The power items of a run's thread, in time order: the intake card, each orchestrator turn's words, its activity
 * rows, the checkpoint and rigor markers, switch flips, and one hand-off card per round.
 */
export function powerTimeline(events: readonly CoreEvent[] | null | undefined, p: PowerState | null): PowerItem[] {
  const out: PowerItem[] = [];
  const list = (events ?? []) as readonly Ev[];
  const changeByCheckpoint = new Map<number, RigorChange>();
  const seenChanges = new Set<number>();
  // What surrounds each rigor change: the checkpoints that paused, and when hand-off's checks ran.
  const pausedAt: Array<{ at: number; checkpoint: number }> = [];
  const checksAt: number[] = [];
  for (const e of list) {
    if (e.type === 'powerCheckpointReached' && e.paused === true && typeof e.checkpoint === 'number') pausedAt.push({ at: tsOf(e) ?? (typeof e.at === 'number' ? e.at : 0), checkpoint: e.checkpoint });
    if (e.type === 'powerHandoffStepped' && e.step !== null && typeof e.step === 'object') {
      const st = e.step as HandoffStep;
      if (st.step === 'checks' && (st.status === 'passed' || st.status === 'failed')) checksAt.push(st.at ?? tsOf(e) ?? 0);
    }
  }
  for (const st of p?.handoff?.steps ?? []) if (st.step === 'checks' && (st.status === 'passed' || st.status === 'failed')) checksAt.push(st.at);
  const markContext = (c: RigorChange): RigorMarkContext => ({
    pausedCheckpoint: [...pausedAt].reverse().find((x) => x.at <= c.at)?.checkpoint ?? null,
    handoffRan: checksAt.some((t) => t >= c.at),
  });
  for (const e of list) {
    if (e.type === 'rigorRescored' && e.change !== null && typeof e.change === 'object') {
      const c = e.change as RigorChange;
      if (c.checkpoint !== null && c.checkpoint !== undefined) changeByCheckpoint.set(c.checkpoint, c);
    }
  }
  let intake = false;
  let commits = 0;
  let acts: ActivityRow[] = [];
  let actsAt: number | null = null;
  const flush = (): void => {
    if (acts.length > 0) out.push({ kind: 'acts', key: `acts:${out.length}`, at: actsAt, rows: acts });
    acts = [];
    actsAt = null;
  };
  const rounds = new Map<number, { at: number | null; steps: Map<string, HandoffStep>; index: number }>();
  for (const e of list) {
    if (!isPowerEvent(e)) continue;
    const at = tsOf(e);
    switch (e.type) {
      case 'powerIntakePlanned': {
        flush();
        const plan = e.plan as RigorPlan;
        if (!intake && plan !== null && typeof plan === 'object') { intake = true; out.push({ kind: 'intake', key: 'intake', at: plan.at ?? at, plan }); }
        break;
      }
      case 'powerActivity': {
        const a = e as unknown as PowerActivityEvent;
        if (a.kind === 'commit') commits += 1;
        const row = activityRow(a, commits);
        if (acts.length === 0) actsAt = row.at;
        acts.push(row);
        break;
      }
      case 'powerTurnCompleted': {
        flush();
        const t = e as unknown as PowerTurnEvent;
        const summary = typeof t.summary === 'string' ? t.summary.trim() : '';
        if (summary !== '') out.push({ kind: 'turn', key: `turn:${t.ord}:${t.attempt}:${t.turn}`, at, turn: t.turn, cli: t.cli, summary, outcome: t.outcome ?? null });
        break;
      }
      case 'powerCheckpointReached': {
        flush();
        const cp = e as unknown as PowerCheckpointEvent;
        const change = changeByCheckpoint.get(cp.checkpoint) ?? null;
        out.push({ kind: 'checkpoint', key: `cp:${cp.checkpoint}`, at, checkpoint: cp.checkpoint, words: checkpointWords(cp, change, commits), picked: cp.picked, paused: cp.paused });
        break;
      }
      case 'rigorRescored': {
        const c = e.change as RigorChange | null;
        if (c === null || typeof c !== 'object' || c.direction === 'same' || c.trigger === 'intake' || c.from === null || c.to === null || seenChanges.has(c.seq)) break;
        seenChanges.add(c.seq);
        flush();
        const w = rigorMarkWords(c, markContext(c));
        out.push({ kind: 'rigor', key: `rigor:${c.seq}`, at: c.at ?? at, change: c, words: w.tail === '' ? w.head : `${w.head} · ${w.tail}` });
        break;
      }
      case 'powerToggled': {
        flush();
        const t = e.toggle as PowerToggle;
        if (t === null || typeof t !== 'object') break;
        const words = t.on
          ? `Power mode on for the rest${t.stayPhased.length > 0 ? ` · ${listWords(t.stayPhased.map(capital))} ${t.stayPhased.length === 1 ? 'stays' : 'stay'} phased` : ''}`
          : 'Power mode off · the rest of the work goes phased';
        out.push({ kind: 'toggle', key: `toggle:${t.at}`, at: t.at ?? at, toggle: t, words });
        break;
      }
      case 'powerHandoffStepped': {
        const round = typeof e.round === 'number' ? e.round : 1;
        const step = e.step as HandoffStep;
        if (step === null || typeof step !== 'object') break;
        let r = rounds.get(round);
        if (r === undefined) {
          flush();
          r = { at: step.at ?? at, steps: new Map(), index: out.length };
          rounds.set(round, r);
          out.push({ kind: 'handoff', key: `handoff:${round}`, at: r.at, round, steps: [] });
        }
        const prev = r.steps.get(step.step);
        if (prev === undefined || (step.at ?? 0) >= (prev.at ?? 0)) r.steps.set(step.step, step);
        break;
      }
      default:
        break;
    }
  }
  flush();
  // Each hand-off card holds its round's steps as they stand now: the newest record of each step, from the frames and
  // the session's state together (either can be the newer one), in hand-off order.
  for (const [round, r] of rounds) {
    const item = out[r.index];
    const fromState = (p?.handoff?.steps ?? []).filter((st) => (st.round ?? p!.handoff!.round) === round);
    if (item?.kind === 'handoff' && item.round === round) item.steps = settleHandoff([...r.steps.values(), ...fromState], () => undefined, false);
  }
  // The orchestrator's words from the session's turn log when the trail holds no turn frames (a capped log): each at
  // its end, in time order with the rest.
  if (!out.some((i) => i.kind === 'turn') && (p?.turnLog ?? []).some((t) => typeof t.summary === 'string' && t.summary.trim() !== '')) {
    for (const t of p!.turnLog!) {
      if (typeof t.summary !== 'string' || t.summary.trim() === '') continue;
      out.push({ kind: 'turn', key: `turn:log:${t.attempt}:${t.turn}`, at: t.endedAt ?? t.startedAt, turn: t.turn, cli: t.cli, summary: t.summary.trim(), outcome: t.outcome });
    }
    const timed = out.map((it, i) => ({ it, i }));
    timed.sort((a, b) => ((a.it.at ?? -Infinity) - (b.it.at ?? -Infinity)) || a.i - b.i);
    out.splice(0, out.length, ...timed.map((x) => x.it));
  }
  // The session's state is the record when the trail holds no intake frame (an older trail, a capped log).
  if (!intake && p?.plan != null) out.unshift({ kind: 'intake', key: 'intake', at: p.plan.at, plan: p.plan });
  // A round the frames never showed (the state has it): drawn from the state.
  if (p?.handoff != null && !rounds.has(p.handoff.round) && p.handoff.steps.length > 0) {
    out.push({ kind: 'handoff', key: `handoff:${p.handoff.round}`, at: p.handoff.steps[0]!.at, round: p.handoff.round, steps: settleHandoff(p.handoff.steps, () => undefined, false) });
  }
  return out;
}

const STEP_ORDER: Record<string, number> = { rescore: 0, checks: 1, review: 2, security: 3, qe: 4, compliance: 5 };

function orderSteps(steps: HandoffStep[]): HandoffStep[] {
  return [...steps].sort((a, b) => (STEP_ORDER[a.step] ?? 9) - (STEP_ORDER[b.step] ?? 9));
}

// ── the hand-off card ──────────────────────────────────────────────────────────────────────────────────

export interface HandoffRowWords {
  step: HandoffStep['step'];
  /** "Checks", "Codex", "Pi CLI". */
  who: string;
  /** "full suite, rigor high", "reviewing on its own seat", "QE acceptance and compliance". */
  role: string;
  /** "✓ Passed", "✓ Approved", "Running", "✗ Failed". */
  result: string;
  tone: 'pass' | 'fail' | 'run' | 'wait' | 'skip';
  what: string | null;
  /** The mark in the row's dot: a seat's initial, or null for an icon. */
  initial: string | null;
}

export function handoffRow(s: HandoffStep, rigor: Rigor | null, seatName: (cli: string) => string): HandoffRowWords {
  const seat = s.seat !== null && s.seat !== '' ? seatName(s.seat) : null;
  const role = s.step === 'checks' ? `${rigor === 'high' || rigor === 'highest' ? 'full suite' : 'targeted tests'}${rigor !== null ? `, rigor ${rigor}` : ''}`
    : s.step === 'review' ? 'reviewing on its own seat'
      : s.step === 'security' ? 'security review on its own seat'
        : s.step === 'qe' ? 'QE acceptance'
          : s.step === 'compliance' ? 'steering rules on the change'
            : 'the final diff, re-scored';
  const who = s.step === 'checks' ? 'Checks' : s.step === 'compliance' && seat === null ? 'Compliance' : s.step === 'rescore' ? 'Re-score' : seat ?? capital(s.step);
  const pass = s.step === 'review' || s.step === 'security' ? '✓ Approved' : '✓ Passed';
  const fail = s.step === 'review' || s.step === 'security' ? 'Changes asked' : '✗ Failed';
  const [result, tone]: [string, HandoffRowWords['tone']] = s.status === 'passed' ? [pass, 'pass']
    : s.status === 'failed' ? [fail, 'fail']
      : s.status === 'running' ? ['Running', 'run']
        : s.status === 'skipped' ? ['Skipped', 'skip']
          : ['Waiting', 'wait'];
  // The re-score's engine summary ("rigor standard at hand-off") can predate a raise; the card says the rigor that applied.
  const what = s.step === 'rescore' && rigor !== null && (s.summary === null || /^rigor \w+ at hand-off$/i.test(s.summary)) ? `rigor ${rigor} at hand-off` : s.summary;
  const who2 = s.step === 'checks' ? 'Checks' : who;
  return { step: s.step, who: who2, role, result, tone, what, initial: seat !== null && s.step !== 'checks' ? seat.slice(0, 1).toUpperCase() : null };
}

// ── the pause dock ("this grew") ─────────────────────────────────────────────────────────────────────────

export type PauseChoice = 'split' | 'switch_phased' | 'continue_high' | 'stop';

export const PAUSE_CHOICES: Record<PauseChoice, { label: string; sub: string }> = {
  split: { label: 'Split into lanes', sub: 'Finish the original change here; the rest opens as a new job (nothing starts until you send it)' },
  switch_phased: { label: 'Switch to phased', sub: 'The rest of the work goes step by step, with a gate after each phase' },
  continue_high: { label: 'Continue at high rigor', sub: 'The orchestrator carries on; hand-off runs at high rigor or above' },
  stop: { label: 'Stop', sub: 'The job stops here; what it did so far is kept, nothing is pushed' },
};

export function pauseOrder(recommended: PauseChoice): PauseChoice[] {
  const all: PauseChoice[] = ['split', 'switch_phased', 'continue_high', 'stop'];
  return [recommended, ...all.filter((c) => c !== recommended)];
}

/** The rigors above `r` (the Raise menu): a raise never lowers. */
export function higherRigors(r: Rigor): Rigor[] {
  return RIGORS.filter((x) => rigorRank(x) > rigorRank(r));
}

export { isRigor };

// ── the state as it stands now ─────────────────────────────────────────────────────────────────────────

/**
 * The run's power state, brought up to date by the frames that arrived after the session was read (`rigorRescored`,
 * `powerToggled`, `powerHandoffStepped`, `powerCheckpointReached`) and by the answer to this page's own flip or raise
 * (`local`, the route's PowerView), whichever is newest. Rigor only ever moves the way the engine said it did.
 */
export function mergePower(p: PowerState | null, events: readonly CoreEvent[] | null | undefined, local: PowerState | null = null): PowerState | null {
  let base = p;
  // This page's own answer (a flip, a raise, a pause answered) is the newest word on what it changed.
  const usedLocal = local !== null && (base === null || historyTip(local) >= historyTip(base));
  if (usedLocal) base = { ...local! };
  if (base === null) return null;
  const history = new Map<number, RigorChange>(base.history.map((c) => [c.seq, c]));
  let toggles = base.toggles;
  let checkpoints = base.checkpoints;
  let handoff = base.handoff;
  let plan = base.plan;
  // A pause the frames show (a checkpoint that opened one), cleared by the next turn starting; else the state's.
  let framePause: PowerState['pause'] | undefined;
  for (const raw of events ?? []) {
    const e = raw as Ev;
    if (e.type === 'rigorRescored' && e.change !== null && typeof e.change === 'object') {
      const c = e.change as RigorChange;
      if (typeof c.seq === 'number' && !history.has(c.seq)) history.set(c.seq, c);
    } else if (e.type === 'powerToggled' && e.toggle !== null && typeof e.toggle === 'object') {
      const t = e.toggle as PowerToggle;
      if (!toggles.some((x) => x.at === t.at && x.on === t.on)) toggles = [...toggles, t];
    } else if (e.type === 'powerCheckpointReached' && typeof e.checkpoint === 'number') {
      checkpoints = Math.max(checkpoints, e.checkpoint);
      if (e.pause !== null && typeof e.pause === 'object') framePause = e.pause as NonNullable<PowerState['pause']>;
    } else if (e.type === 'powerTurnStarted' && framePause != null) {
      framePause = null;
    } else if (e.type === 'powerIntakePlanned' && plan === null && e.plan !== null && typeof e.plan === 'object') {
      plan = e.plan as RigorPlan;
    } else if (e.type === 'powerHandoffStepped' && e.step !== null && typeof e.step === 'object') {
      const round = typeof e.round === 'number' ? e.round : 1;
      const step = e.step as HandoffStep;
      if (handoff === null || round > handoff.round) handoff = { round, maxRounds: handoff?.maxRounds ?? 3, steps: [step] };
      else if (round === handoff.round) handoff = { ...handoff, steps: [...handoff.steps.filter((s) => s.step !== step.step), step] };
    }
  }
  const ordered = [...history.values()].sort((a, b) => a.seq - b.seq);
  const tip = ordered.at(-1);
  // A flip the state has not caught up with yet (a frame newer than every toggle it lists) sets the switch.
  const newest = [...toggles].sort((x, y) => x.at - y.at).at(-1);
  const baseNewest = base.toggles.reduce((m, t) => Math.max(m, t.at), -1);
  const on = newest !== undefined && newest.at > baseNewest ? newest.on : base.on;
  const rigor = tip !== undefined && isRigor(tip.to) ? tip.to : base.rigor ?? plan?.rigor ?? null;
  return { ...base, on, rigor, plan, history: ordered, toggles, checkpoints, handoff, pause: usedLocal || framePause === undefined ? base.pause : framePause };
}

function historyTip(p: PowerState): number {
  return p.history.reduce((m, c) => Math.max(m, c.seq), 0) * 1000 + p.toggles.length;
}
