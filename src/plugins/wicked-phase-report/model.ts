/**
 * The phase report v0 (program DES-POWER-MODE §8, spike 1): a fold of the run-event rows the host delivers
 * (`events.batch`, protocol 3) into what the block shows: one summary line folded, a compact dashboard expanded.
 * Pure: the plugin and the unit tests drive it. Idempotent on a row's id, so a row heard twice changes nothing.
 */

import { stepLabelOf } from '../../board/chainModel.js';

export interface Row { id: string; topic: string; seq: number | null; at: number; ord: number | null; data: Record<string, unknown> }

export type UnitState = 'planned' | 'running' | 'done' | 'denied' | 'failed';
export interface UnitInfo { ord: number; step: string | null; seat: string | null; seatName: string | null; state: UnitState; startedAt: number | null; finishedAt: number | null }
export interface GateInfo { ord: number; kind: string; openedAt: number; answeredAt: number | null }
export interface CheckInfo { name: string; exitCode: number | null; timedOut: boolean; durationMs: number | null }
export interface ChecksRun { ord: number | null; attempt: number | null; floor: string | null; outcome: string | null; passed: boolean; checks: CheckInfo[]; reusedFrom: { phase: string | null; ord: number | null; reused: string[]; fresh: string[] } | null; at: number }

/** Power mode (DES-POWER-MODE §8.2): the rigor history, the checkpoints, the orchestrator's turn and the hand-off. */
export interface RigorRow { seq: number; at: number; trigger: string; from: string | null; to: string; direction: string; planned: number | null; actual: number | null; checkpoint: number | null; byKind: string | null }
export interface PowerInfo {
  intake: { rigor: string; score: number | null; at: number } | null;
  rigor: string | null;
  history: RigorRow[];
  checkpoints: Array<{ n: number; at: number; trigger: string | null; rigor: string | null; picked: number; paused: boolean }>;
  turn: { n: number; seatName: string | null; running: boolean; outcome: string | null; at: number } | null;
  handoff: { round: number; steps: Map<string, { status: string; seatName: string | null; at: number }> } | null;
  on: boolean | null;
  /** Each checkpoint pause and how it was answered (closed words only: the reasons' kinds, the choice, a person or not). */
  pauses: PauseInfo[];
}

export type PauseChoice = 'continue_high' | 'continue' | 'switch_phased' | 'stop';
export interface PauseInfo { n: number; at: number; kinds: string[]; choice: PauseChoice | null; byPerson: boolean; answeredAt: number | null }

export interface Report {
  /** The replay has arrived: until then the report says it is reading, never "no events". */
  loaded: boolean;
  seen: Set<string>;
  startedAt: number | null;
  lastAt: number | null;
  finished: { outcome: string; at: number } | null;
  units: Map<number, UnitInfo>;
  gates: GateInfo[];
  checks: ChecksRun[];
  costUsd: number;
  tokens: number;
  usageReports: number;
  /** Null until a power-mode row arrives (a phased run never has one). */
  power: PowerInfo | null;
  /** The marks that cut a power build's one unit into its phases (turns, the floor's results, the hand-off's checks). */
  marks: Mark[];
}

/** One mark on a power build's timeline. `ord`: the unit it is about (null on a hand-off row without one). */
export interface Mark { at: number; ord: number | null; kind: 'turn.started' | 'turn.completed' | 'checks' | 'handoff.checks'; outcome: string | null }

export function emptyReport(): Report {
  return { loaded: false, seen: new Set(), startedAt: null, lastAt: null, finished: null, units: new Map(), gates: [], checks: [], costUsd: 0, tokens: 0, usageReports: 0, power: null, marks: [] };
}

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** The pause reasons' kinds a row may carry (closed: `runEvents.ts` maps the engine's reasons to these). */
export const PAUSE_KINDS: ReadonlySet<string> = new Set(['longer_than_estimated', 'tests_failing', 'changes_undone', 'rigor_jumped', 'spread', 'other']);

/** The newest pause takes this answer. A plain "it went on" (the next turn, the hand-off) is refined by a specific
 *  answer that follows it (a person's raise, the switch to phased steps, a stop); a specific answer is never replaced. */
function answerPause(p: PowerInfo, choice: PauseChoice, byPerson: boolean, at: number): void {
  const open = p.pauses.at(-1);
  if (open === undefined || at < open.at) return;
  const refine = open.choice === 'continue' && !open.byPerson && choice !== 'continue' && (p.checkpoints.at(-1)?.n ?? open.n) === open.n;
  if (open.choice !== null && !refine) return;
  open.choice = choice;
  open.byPerson = byPerson;
  open.answeredAt = at;
}

function power(r: Report): PowerInfo {
  r.power ??= { intake: null, rigor: null, history: [], checkpoints: [], turn: null, handoff: null, on: null, pauses: [] };
  return r.power;
}

function unit(r: Report, ord: number): UnitInfo {
  let u = r.units.get(ord);
  if (u === undefined) {
    u = { ord, step: null, seat: null, seatName: null, state: 'planned', startedAt: null, finishedAt: null };
    r.units.set(ord, u);
  }
  return u;
}

/** Fold rows in place (sorted by `seq`, live rows after). Returns whether anything changed. */
export function foldRows(r: Report, rows: readonly Row[]): boolean {
  let changed = false;
  for (const row of rows) {
    if (r.seen.has(row.id)) continue;
    r.seen.add(row.id);
    changed = true;
    r.lastAt = Math.max(r.lastAt ?? 0, row.at);
    if (r.startedAt === null || row.at < r.startedAt) r.startedAt = row.at;
    const d = row.data;
    const ord = row.ord;
    switch (row.topic) {
      case 'wicked.run.session.started': r.startedAt = row.at; break;
      case 'wicked.run.session.finished':
        r.finished = { outcome: str(d['outcome']) ?? 'completed', at: row.at };
        if (r.power != null) answerPause(r.power, d['outcome'] === 'cancelled' ? 'stop' : 'continue', false, row.at);
        break;
      case 'wicked.run.session.resumed':
        // A resumed run is running again (studio resumes a failed run under the same id).
        if (r.finished !== null && row.at >= r.finished.at) r.finished = null;
        // A resume at a unit answers the decision that unit was waiting on.
        for (const g of r.gates) if (g.ord === ord && g.answeredAt === null) g.answeredAt = row.at;
        break;
      case 'wicked.run.unit.planned':
        if (ord !== null) { const u = unit(r, ord); u.step = str(d['step']) ?? u.step; }
        break;
      case 'wicked.run.unit.assigned':
        if (ord !== null) { const u = unit(r, ord); u.seat = str(d['seat']); u.seatName = str(d['seatName']); }
        break;
      case 'wicked.run.unit.started':
        if (ord !== null) {
          if (r.finished !== null && row.at >= r.finished.at) r.finished = null;
          const u = unit(r, ord);
          u.state = 'running';
          u.startedAt ??= row.at;
          u.finishedAt = null;
          // A unit starting means every decision before it was answered.
          for (const g of r.gates) if (g.ord <= ord && g.answeredAt === null && g.openedAt <= row.at) g.answeredAt = row.at;
        }
        break;
      case 'wicked.run.unit.finished':
        if (ord !== null) {
          const u = unit(r, ord);
          const o = str(d['outcome']);
          u.state = o === 'denied' ? 'denied' : o === 'failed' ? 'failed' : 'done';
          u.finishedAt = row.at;
        }
        break;
      case 'wicked.run.human.awaited':
        if (ord !== null) r.gates.push({ ord, kind: str(d['kind']) ?? 'question', openedAt: row.at, answeredAt: null });
        break;
      case 'wicked.run.checks.evaluated': {
        r.marks.push({ at: row.at, ord, kind: 'checks', outcome: d['passed'] === true ? 'passed' : 'failed' });
        const checks = Array.isArray(d['checks']) ? (d['checks'] as Array<Record<string, unknown>>).map((c) => ({
          name: str(c['name']) ?? 'check', exitCode: num(c['exitCode']), timedOut: c['timedOut'] === true, durationMs: num(c['durationMs']),
        })) : [];
        const ru = d['reusedFrom'] as Record<string, unknown> | null | undefined;
        const names = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
        r.checks.push({
          ord, attempt: num(d['attempt']), floor: str(d['floor']), outcome: str(d['outcome']), passed: d['passed'] === true, checks, at: row.at,
          reusedFrom: ru != null && typeof ru === 'object' ? { phase: str(ru['phase']), ord: num(ru['ord']), reused: names(ru['reused']), fresh: names(ru['fresh']) } : null,
        });
        break;
      }
      case 'wicked.run.intake.planned': {
        const p = power(r);
        const rigor = str(d['rigor']);
        if (rigor !== null) { p.intake = { rigor, score: num(d['score']), at: row.at }; p.rigor ??= rigor; }
        p.on ??= true;
        break;
      }
      case 'wicked.run.rigor.rescored': {
        const p = power(r);
        const seq = num(d['seq']);
        const to = str(d['to']);
        if (seq === null || to === null || p.history.some((h) => h.seq === seq)) break;
        p.history.push({ seq, at: row.at, trigger: str(d['trigger']) ?? 'checkpoint', from: str(d['from']), to, direction: str(d['direction']) ?? 'same', planned: num(d['planned']), actual: num(d['actual']), checkpoint: num(d['checkpoint']), byKind: str(d['byKind']) });
        p.history.sort((a, b) => a.seq - b.seq);
        p.rigor = p.history.at(-1)!.to;
        // A person raising rigor while a pause waits is the pause's answer: continue at high rigor.
        if (str(d['byKind']) === 'person' && str(d['direction']) === 'up') answerPause(p, 'continue_high', true, row.at);
        break;
      }
      case 'wicked.run.checkpoint.reached': {
        const p = power(r);
        const n = num(d['checkpoint']);
        if (n === null || p.checkpoints.some((c) => c.n === n)) break;
        p.checkpoints.push({ n, at: row.at, trigger: str(d['trigger']), rigor: str(d['rigor']), picked: num(d['picked']) ?? 0, paused: d['paused'] === true });
        p.checkpoints.sort((a, b) => a.n - b.n);
        if (d['paused'] === true) {
          const kinds = Array.isArray(d['pauseKinds']) ? (d['pauseKinds'] as unknown[]).filter((k): k is string => typeof k === 'string' && PAUSE_KINDS.has(k)) : [];
          p.pauses.push({ n, at: row.at, kinds, choice: null, byPerson: false, answeredAt: null });
        }
        break;
      }
      case 'wicked.run.turn.started':
      case 'wicked.run.turn.completed': {
        r.marks.push({ at: row.at, ord, kind: row.topic === 'wicked.run.turn.started' ? 'turn.started' : 'turn.completed', outcome: str(d['outcome']) });
        const p = power(r);
        const n = num(d['turn']);
        if (n === null || (p.turn !== null && n < p.turn.n)) break;
        // The orchestrator's next turn after a pause: the pause was answered "continue" (unless it was already).
        if (row.topic === 'wicked.run.turn.started') answerPause(p, 'continue', false, row.at);
        p.turn = { n, seatName: str(d['seatName']) ?? str(d['seat']), running: row.topic === 'wicked.run.turn.started', outcome: str(d['outcome']), at: row.at };
        break;
      }
      case 'wicked.run.handoff.stepped': {
        const p = power(r);
        const round = num(d['round']) ?? 1;
        const step = str(d['step']);
        if (step === null) break;
        answerPause(p, 'continue', false, row.at);
        if (step === 'checks') r.marks.push({ at: row.at, ord, kind: 'handoff.checks', outcome: str(d['status']) });
        if (p.handoff === null || round > p.handoff.round) p.handoff = { round, steps: new Map() };
        if (round === p.handoff.round) p.handoff.steps.set(step, { status: str(d['status']) ?? 'pending', seatName: str(d['seatName']) ?? str(d['seat']), at: row.at });
        break;
      }
      case 'wicked.run.power.toggled':
        power(r).on = d['on'] === true;
        if (d['on'] !== true) answerPause(power(r), 'switch_phased', str(d['byKind']) === 'person', row.at);
        break;
      case 'wicked.run.usage.reported':
        r.costUsd += num(d['costUsd']) ?? 0;
        r.tokens += (num(d['inputTokens']) ?? 0) + (num(d['outputTokens']) ?? 0);
        r.usageReports += 1;
        break;
      default: break;
    }
  }
  return changed;
}

// ── words ───────────────────────────────────────────────────────────────────────────────────

export function stepWord(u: Pick<UnitInfo, 'step' | 'ord'> | undefined): string {
  if (u === undefined) return 'Step';
  return u.step !== null ? stepLabelOf(u.step) : `Step ${u.ord}`;
}

const GATE_WORDS: Record<string, string> = {
  plan_approval: 'Approve the plan', escalation: 'A failed check or review', deliver: 'Deliver', consent: 'Install consent',
  phase_review: 'Review a step', question: 'A question',
};
const STANDALONE_GATES = new Set(['plan_approval', 'deliver', 'consent']);
export function gateWord(kind: string): string {
  return GATE_WORDS[kind] ?? kind.replace(/[_-]+/g, ' ').replace(/^./u, (c) => c.toUpperCase());
}

export function openGates(r: Report): GateInfo[] {
  return r.finished !== null ? [] : r.gates.filter((g) => g.answeredAt === null);
}

/** The ords the plan holds, in order (a unit seen only by its start counts too). */
function planned(r: Report): number[] {
  return [...r.units.keys()].sort((a, b) => a - b);
}

/** The unit the run is on now: the newest running one, else the one an open decision is about, else null. */
export function currentUnit(r: Report): UnitInfo | null {
  const running = [...r.units.values()].filter((u) => u.state === 'running').sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
  if (running[0] !== undefined) return running[0];
  const g = openGates(r).at(-1);
  return g !== undefined ? r.units.get(g.ord) ?? null : null;
}

export function checksWords(c: ChecksRun | undefined, r: Report): string | null {
  if (c === undefined) return null;
  const total = c.checks.length;
  const ok = c.checks.filter((x) => x.exitCode === 0 && !x.timedOut).length;
  const head = total === 0 ? 'no checks found' : ok === total ? `${total} passed` : `${ok} of ${total} passed`;
  const from = c.reusedFrom?.phase != null ? ` (reused from ${stepLabelOf(c.reusedFrom.phase)})` : c.reusedFrom?.ord != null ? ` (reused from ${stepWord(r.units.get(c.reusedFrom.ord))})` : '';
  return `checks: ${head}${from}`;
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** A power-mode run's stage: Intake, Building (the orchestrator's turns) or Hand-off. */
export function powerStage(p: PowerInfo): string {
  if (p.handoff !== null) return 'Hand-off';
  if (p.turn !== null || p.checkpoints.length > 0) return 'Building';
  return 'Intake';
}

/** One rigor-history line: "14:02 intake, score 34", "14:19 checkpoint 2, score 34 → 58", "14:25 raised by you". */
export function rigorRowWords(h: RigorRow): string {
  const what = h.trigger === 'intake' ? 'intake'
    : h.trigger === 'operator' || h.byKind === 'person' ? 'raised by you'
      : h.trigger === 'plugin' ? 'raised by a plugin'
        : h.trigger === 'doc_edit' ? 'a working-document edit'
          : h.trigger === 'toggle' ? 'power switch'
            : h.checkpoint !== null ? `checkpoint ${h.checkpoint}` : h.trigger === 'pre_handoff' ? 'before hand-off' : h.trigger.replace(/_/g, ' ');
  const score = h.trigger === 'intake' ? (h.actual !== null ? `, score ${h.actual}` : '')
    : h.planned !== null && h.actual !== null && h.planned !== h.actual ? `, score ${h.planned} → ${h.actual}` : '';
  return `${clock(h.at)} ${what}${score}`;
}

const HANDOFF_WORDS: Record<string, string> = { rescore: 'Re-score', checks: 'Checks', review: 'Review', security: 'Security', qe: 'QE', compliance: 'Compliance' };
const HANDOFF_ORDER = ['rescore', 'checks', 'review', 'security', 'qe', 'compliance'];

/** The folded line: "Fix · step 6 of 10 · checks: 3 of 4 passed (reused from Fix) · 1 decision open". */
export function summaryLine(r: Report): string {
  if (!r.loaded) return 'Reading the job’s events…';
  // Power mode: "Building · rigor high · checkpoint 2 · checks: 3 passed · 1 decision open".
  // Only a power BUILD reads this way (an orchestrator turn, a checkpoint or the hand-off): a phased run that had an
  // intake plan keeps its steps' line.
  if (r.power !== null && r.finished === null && (r.power.turn !== null || r.power.checkpoints.length > 0 || r.power.handoff !== null)) {
    const p = r.power;
    const parts = [powerStage(p)];
    if (p.rigor !== null) parts.push(`rigor ${p.rigor}${p.intake !== null && p.rigor !== p.intake.rigor ? ' ↑' : ''}`);
    if (p.checkpoints.length > 0) parts.push(`checkpoint ${p.checkpoints.at(-1)!.n}`);
    const checks = checksWords(r.checks.at(-1), r);
    if (checks !== null) parts.push(checks);
    const open = openGates(r).length;
    if (open > 0) parts.push(`${plural(open, 'decision')} open`);
    return parts.join(' · ');
  }
  const ords = planned(r);
  const parts: string[] = [];
  if (r.finished !== null) {
    const done = [...r.units.values()].filter((u) => u.state === 'done').length;
    parts.push(r.finished.outcome === 'completed' ? 'Finished' : r.finished.outcome === 'cancelled' ? 'Stopped' : 'Failed');
    if (ords.length > 0) parts.push(`${done} of ${plural(ords.length, 'step')} done`);
  } else {
    const now = currentUnit(r);
    if (now !== null) {
      parts.push(stepWord(now));
      const at = ords.indexOf(now.ord);
      if (at >= 0) parts.push(`step ${at + 1} of ${ords.length}`);
    } else if (r.startedAt !== null) parts.push(ords.length > 0 ? `Planned · ${plural(ords.length, 'step')}` : 'Starting');
    else parts.push('No events yet');
  }
  const checks = checksWords(r.checks.at(-1), r);
  if (checks !== null) parts.push(checks);
  const open = openGates(r).length;
  if (open > 0) parts.push(`${plural(open, 'decision')} open`);
  return parts.join(' · ');
}

export function clock(ms: number | null): string {
  if (ms === null) return '—';
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function duration(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return `${h} h ${String(min % 60).padStart(2, '0')} min`;
}

export interface Dashboard {
  now: { value: string; sub: string };
  checks: Array<{ title: string; chips: Array<{ name: string; ok: boolean; reused: boolean; note: string | null }>; reused: string | null }>;
  decisions: { open: number; answered: number; items: Array<{ text: string; when: string; open: boolean }> };
  helpers: Array<{ name: string; steps: string }>;
  time: { value: string; sub: string };
  /** Power mode only: the rigor history (intake, then each change) and the hand-off's steps. */
  rigor: Array<{ to: string; arrow: string; words: string }> | null;
  handoff: Array<{ name: string; status: string }> | null;
}

export function dashboard(r: Report, nowMs: number): Dashboard {
  const ords = planned(r);
  const cur = currentUnit(r);
  const open = openGates(r);
  let now: Dashboard['now'];
  if (r.finished !== null) {
    now = { value: summaryLine(r).split(' · ')[0] ?? 'Finished', sub: `${plural(ords.length, 'step')} · ${plural(r.gates.length, 'decision')} · ${clock(r.startedAt)}–${clock(r.finished.at)}` };
  } else if (open.length > 0) {
    const g = open[open.length - 1]!;
    now = { value: `Waiting on you · ${gateWord(g.kind)}`, sub: `${stepWord(r.units.get(g.ord))} · since ${clock(g.openedAt)}` };
  } else if (cur !== null) {
    const at = ords.indexOf(cur.ord);
    now = { value: `${stepWord(cur)}${at >= 0 ? ` · step ${at + 1} of ${ords.length}` : ''}`, sub: `${cur.seatName ?? cur.seat ?? 'A helper'} · started ${clock(cur.startedAt)}` };
  } else {
    now = { value: r.startedAt === null ? 'No events yet' : 'Starting', sub: r.startedAt === null ? 'The report fills in as the job runs' : `Started ${clock(r.startedAt)}` };
  }
  const checks = r.checks.slice(-3).reverse().map((c) => {
    const reusedSet = new Set(c.reusedFrom?.reused ?? []);
    const word = c.outcome === 'passed' || c.passed ? 'passed' : c.outcome === 'timed_out' ? 'timed out' : c.outcome === 'not_run' ? 'did not run' : 'failed';
    return {
      title: `${c.ord !== null ? stepWord(r.units.get(c.ord) ?? { step: null, ord: c.ord }) : 'Checks'} · ${word} · ${clock(c.at)}`,
      chips: c.checks.map((x) => ({
        name: x.name.replace(/_/g, ' '), ok: x.exitCode === 0 && !x.timedOut, reused: reusedSet.has(x.name),
        note: x.durationMs !== null && x.durationMs >= 60_000 ? duration(x.durationMs) : x.durationMs !== null ? `${Math.max(1, Math.round(x.durationMs / 1000))} s` : null,
      })),
      reused: c.reusedFrom !== null
        ? `Reused from ${c.reusedFrom.phase !== null ? stepLabelOf(c.reusedFrom.phase) : stepWord(r.units.get(c.reusedFrom.ord ?? -1))}: ${c.reusedFrom.reused.join(', ') || 'none'}${c.reusedFrom.fresh.length > 0 ? ` · ran again: ${c.reusedFrom.fresh.join(', ')}` : ''}`
        : null,
    };
  });
  const decided = r.gates.filter((g) => g.answeredAt !== null);
  const decisions = {
    open: open.length,
    answered: decided.length,
    items: r.gates.slice(-5).map((g) => ({
      // A gate that is its own step's name (the plan, delivery) is not said twice.
      text: STANDALONE_GATES.has(g.kind) ? gateWord(g.kind) : `${gateWord(g.kind)} · ${stepWord(r.units.get(g.ord))}`,
      when: g.answeredAt !== null ? `answered ${clock(g.answeredAt)}` : open.includes(g) ? `open since ${clock(g.openedAt)}` : clock(g.openedAt),
      open: open.includes(g),
    })),
  };
  const bySeat = new Map<string, string[]>();
  for (const u of [...r.units.values()].sort((a, b) => a.ord - b.ord)) {
    const who = u.seatName ?? u.seat;
    if (who === null || u.seat === 'bash') continue;
    const list = bySeat.get(who) ?? [];
    const w = stepWord(u);
    if (!list.includes(w)) list.push(w);
    bySeat.set(who, list);
  }
  const helpers = [...bySeat.entries()].map(([name, steps]) => ({ name, steps: steps.join(', ') }));
  const end = r.finished?.at ?? nowMs;
  const time = {
    value: r.startedAt === null ? '—' : duration(end - r.startedAt),
    sub: r.usageReports === 0 ? 'No usage reported yet' : `≈ $${r.costUsd.toFixed(2)} · ${Math.round(r.tokens / 1000).toLocaleString('en-US')}k tokens`,
  };
  const p = r.power;
  let rigor: Dashboard['rigor'] = null;
  let handoff: Dashboard['handoff'] = null;
  if (p !== null) {
    const rows = p.history.filter((h) => h.direction !== 'same' || h.trigger === 'intake');
    rigor = [
      ...(p.intake !== null && !rows.some((h) => h.trigger === 'intake') ? [{ to: p.intake.rigor, arrow: '', words: `${clock(p.intake.at)} intake${p.intake.score !== null ? `, score ${p.intake.score}` : ''}` }] : []),
      ...rows.map((h) => ({ to: h.to, arrow: h.trigger === 'intake' ? '' : h.direction === 'up' ? '↑' : h.direction === 'down' ? '↓' : '', words: rigorRowWords(h) })),
    ];
    if (p.handoff !== null) {
      handoff = [...p.handoff.steps.entries()].sort((a, b) => HANDOFF_ORDER.indexOf(a[0]) - HANDOFF_ORDER.indexOf(b[0]))
        .map(([step, s]) => ({ name: `${HANDOFF_WORDS[step] ?? step}${s.seatName !== null && step !== 'checks' ? ` · ${s.seatName}` : ''}`, status: s.status }));
    }
    // "Now", in a power build: the stage, the checkpoint and the orchestrator's turn.
    if (r.finished === null && open.length === 0 && (p.turn !== null || p.checkpoints.length > 0 || p.handoff !== null)) {
      const stage = powerStage(p);
      const cp = p.checkpoints.at(-1);
      now = {
        value: [stage, cp !== undefined ? `checkpoint ${cp.n}` : null, p.turn !== null ? `turn ${p.turn.n}` : null].filter((x): x is string => x !== null).join(' · '),
        sub: p.turn !== null ? `${p.turn.seatName ?? 'The orchestrator'} · orchestrator · ${p.turn.running ? `turn ${p.turn.n} started ${clock(p.turn.at)}` : `turn ${p.turn.n} ended ${clock(p.turn.at)}`}`
          : p.intake !== null ? `QE plan set rigor ${p.intake.rigor} at ${clock(p.intake.at)}` : 'Starting',
      };
    }
  }
  return { now, checks, decisions, helpers, time, rigor, handoff };
}

// ── one report per phase (operator 2026-10-30) ─────────────────────────────────────────────────────────

/**
 * The phase one instance reports on, as the host hands it over (`host.hello` → `observe.scope`): a power run has one
 * block per phase — Intake, Build (the orchestrator), each hand-off step (Checks, Review, Security, QE) and Deliver —
 * at the end of that phase's messages. Absent = the whole run (a phased run's one block).
 */
export interface PhaseScope {
  phase: 'intake' | 'build' | 'checks' | 'review' | 'security' | 'qe' | 'deliver';
  label: string;
  /** The units the phase is made of. */
  ords: number[];
}

const PHASES = new Set(['intake', 'build', 'checks', 'review', 'security', 'qe', 'deliver']);

export function scopeOf(v: unknown): PhaseScope | null {
  if (v === null || typeof v !== 'object') return null;
  const s = v as Record<string, unknown>;
  if (typeof s['phase'] !== 'string' || !PHASES.has(s['phase']) || typeof s['label'] !== 'string' || !Array.isArray(s['ords'])) return null;
  const ords = (s['ords'] as unknown[]).filter((o): o is number => typeof o === 'number' && Number.isFinite(o));
  return { phase: s['phase'] as PhaseScope['phase'], label: s['label'].slice(0, 40), ords };
}

/** The one instance that writes the working document's lines (so N blocks never write N copies): the run-level block
 *  of a phased run, the Build block of a power run. */
export function writesDoc(scope: PhaseScope | null): boolean {
  return scope === null || scope.phase === 'build';
}

function inScope(scope: PhaseScope, ord: number | null): boolean {
  return ord !== null && scope.ords.includes(ord);
}

function unitSpan(r: Report, scope: PhaseScope): { start: number | null; end: number | null; running: boolean; failed: boolean } {
  const us = scope.ords.map((o) => r.units.get(o)).filter((u): u is UnitInfo => u !== undefined);
  const start = us.reduce<number | null>((m, u) => (u.startedAt !== null && (m === null || u.startedAt < m) ? u.startedAt : m), null);
  const ends = us.map((u) => u.finishedAt);
  const end = ends.length > 0 && ends.every((e) => e !== null) ? Math.max(...(ends as number[])) : null;
  return { start, end, running: us.some((u) => u.state === 'running'), failed: us.some((u) => u.state === 'failed' || u.state === 'denied') };
}

/**
 * The Build and Checks phases of a power build share its one unit, so their times come from its events, not the unit
 * (coordinator 2026-10-30, bc2366e1: both read 13:27–14:56):
 *  - Build: each orchestrator turn, from its start to the hand-off; a pause belongs to the turn it paused, up to its
 *    answer;
 *  - Checks: each floor, from the hand-off (or a paused turn's answer) to its result, including the retry floor and a
 *    decision it waits on, up to the hand-off's checks record (or the next turn).
 * Returns each phase's spans in order; an open span (still running) ends null.
 */
export interface Span { start: number; end: number | null }
export function buildSpans(r: Report, buildOrd: number): { build: Span[]; checks: Span[] } {
  const out: { build: Span[]; checks: Span[] } = { build: [], checks: [] };
  const marks: Array<Mark | { at: number; ord: number; kind: 'pause.answered'; outcome: null }> = r.marks
    .filter((m) => m.ord === buildOrd || (m.kind === 'handoff.checks' && m.ord === null))
    .map((m) => m);
  for (const pz of r.power?.pauses ?? []) if (pz.answeredAt !== null) marks.push({ at: pz.answeredAt, ord: buildOrd, kind: 'pause.answered', outcome: null });
  marks.sort((a, b) => a.at - b.at);
  let cur: 'build' | 'checks' | 'afterPause' | null = null;
  let start = 0;
  let paused = false;
  const close = (at: number): void => {
    if (cur === 'build' || cur === 'checks') out[cur].push({ start, end: at });
    cur = null;
  };
  const open = (ph: 'build' | 'checks', at: number): void => { cur = ph; start = at; };
  for (const m of marks) {
    // After a paused turn's answer, the next mark says what ran: another turn (build) or a floor (checks).
    if (cur === 'afterPause') {
      const from = start;
      cur = null;
      if (m.kind === 'turn.started') open('build', from);
      else open('checks', from);
    }
    switch (m.kind) {
      case 'turn.started':
        if (cur !== 'build') { close(m.at); open('build', m.at); }
        paused = false;
        break;
      case 'turn.completed':
        if (m.outcome === 'handoff') { close(m.at); open('checks', m.at); }
        else if (m.outcome === 'paused') paused = true; // the pause is the build's, until it is answered
        else if (m.outcome === 'failed' || m.outcome === 'cap') close(m.at);
        break;
      case 'pause.answered':
        if (cur === 'build' && paused) { close(m.at); cur = 'afterPause'; start = m.at; paused = false; }
        break;
      case 'checks':
        if (cur === null) open('checks', m.at);
        if (cur === 'checks' && m.outcome === 'passed') close(m.at);
        break; // a failed floor waits on a decision, then the next turn or a retry: still the checks
      case 'handoff.checks':
        if (m.outcome === 'running' || m.outcome === 'pending') { if (cur !== 'checks') { close(m.at); open('checks', m.at); } }
        else if (cur === 'checks') close(m.at);
        else if (cur === 'build') close(m.at);
        break;
      default: break;
    }
  }
  const last = cur as 'build' | 'checks' | 'afterPause' | null; // set inside the loop's closures
  if (last === 'build' || last === 'checks') out[last].push({ start, end: r.finished !== null ? Math.max(start, r.finished.at) : null });
  return out;
}

/** "13:27–13:37 + 14:45–14:53": a phase's spans, at most three, then "+ N more". */
export function spansWords(spans: readonly Span[]): string | null {
  if (spans.length === 0) return null;
  const one = (x: Span): string => (x.end !== null ? `${clock(x.start)}–${clock(x.end)}` : `since ${clock(x.start)}`);
  const shown = spans.slice(0, 3).map(one).join(' + ');
  return spans.length > 3 ? `${shown} + ${spans.length - 3} more` : shown;
}

function spansTotal(spans: readonly Span[], nowMs: number): number {
  return spans.reduce((t, x) => t + ((x.end ?? nowMs) - x.start), 0);
}

const HANDOFF_STEP: Record<string, string> = { checks: 'checks', review: 'review', security: 'security', qe: 'qe' };

/** A phase's state in one word: what its hand-off record or its units say. */
function phaseState(r: Report, scope: PhaseScope): string {
  // The build is the orchestrator's turns: working in one, between two, or handed off.
  if (scope.phase === 'build' && r.power?.turn != null) {
    if (r.power.turn.running) return 'working';
    if (r.power.handoff !== null || r.finished !== null) return 'handed off';
    return 'between turns';
  }
  const step = HANDOFF_STEP[scope.phase];
  const rec = step !== undefined ? r.power?.handoff?.steps.get(step) : undefined;
  if (rec !== undefined) return rec.status === 'passed' ? (scope.phase === 'review' || scope.phase === 'security' ? 'approved' : 'passed') : rec.status === 'failed' ? (scope.phase === 'review' ? 'changes asked' : 'failed') : rec.status;
  const open = openGates(r).filter((g) => inScope(scope, g.ord));
  if (open.length > 0) return 'waiting on you';
  const span = unitSpan(r, scope);
  if (span.running) return 'running';
  if (span.failed) return 'did not pass';
  if (span.end !== null) return 'done';
  return span.start === null ? 'not started' : 'running';
}

/** A hand-off phase's own record (its status, its seat, when it last moved), or null. */
function stepRec(r: Report, scope: PhaseScope): { status: string; seatName: string | null; at: number } | null {
  const step = HANDOFF_STEP[scope.phase];
  return step !== undefined ? r.power?.handoff?.steps.get(step) ?? null : null;
}

/** Build's and Checks' own spans (they share the build's unit), or null for a phase that has units of its own. */
function ownSpans(r: Report, scope: PhaseScope): Span[] | null {
  if ((scope.phase !== 'build' && scope.phase !== 'checks') || scope.ords.length !== 1 || r.power === null) return null;
  return buildSpans(r, scope.ords[0]!)[scope.phase];
}

/** The folded line of one phase's block: "Build · 2 turns · checkpoint 2 · rigor high ↑". */
export function phaseSummary(r: Report, scope: PhaseScope): string {
  if (!r.loaded) return 'Reading the job’s events…';
  const p = r.power;
  const parts = [scope.label];
  if (scope.phase === 'intake') {
    if (p?.intake != null) parts.push(`rigor ${p.intake.rigor}${p.intake.score !== null ? ` (score ${p.intake.score})` : ''}`);
    else parts.push(phaseState(r, scope));
  } else if (scope.phase === 'build') {
    const turns = p?.turn?.n ?? 0;
    if (turns > 0) parts.push(`${turns} ${turns === 1 ? 'turn' : 'turns'}`);
    if ((p?.checkpoints.length ?? 0) > 0) parts.push(`checkpoint ${p!.checkpoints.at(-1)!.n}`);
    if (p?.rigor != null) parts.push(`rigor ${p.rigor}${p.intake !== null && p.rigor !== p.intake.rigor ? ' ↑' : ''}`);
    if (p?.turn?.running === true) parts.push('working');
  } else if (scope.phase === 'checks') {
    const c = r.checks.filter((x) => inScope(scope, x.ord)).at(-1);
    parts.push(checksWords(c, r) ?? phaseState(r, scope));
  } else {
    const who = scope.ords.map((o) => r.units.get(o)).find((u) => u?.seatName != null || u?.seat != null);
    const seat = who !== undefined ? who.seatName ?? who.seat : stepRec(r, scope)?.seatName ?? null;
    if (seat != null && scope.phase !== 'deliver') parts.push(seat);
    parts.push(phaseState(r, scope));
  }
  const own = ownSpans(r, scope);
  if (own !== null) { const w = spansWords(own); if (w !== null) parts.push(w); }
  else {
    const span = unitSpan(r, scope);
    if (span.start !== null) parts.push(span.end !== null ? `${clock(span.start)}–${clock(span.end)}` : `since ${clock(span.start)}`);
  }
  return parts.filter((x) => x !== '').join(' · ');
}

/** One phase's dashboard: only what that phase is about. `tiles` says which of the dashboard's tiles to draw. */
export function phaseDashboard(r: Report, scope: PhaseScope, nowMs: number): Dashboard & { tiles: string[] } {
  const all = dashboard(r, nowMs);
  const span = unitSpan(r, scope);
  const t = scope.phase === 'build' ? r.power?.turn ?? null : null;
  const rec = stepRec(r, scope);
  const own = ownSpans(r, scope);
  const sub = own !== null && own.length > 0 ? `${spansWords(own)!} · ${duration(spansTotal(own, nowMs))}`
    : span.start !== null && own === null ? (span.end !== null ? `${clock(span.start)}–${clock(span.end)} · ${duration(span.end - span.start)}` : `Since ${clock(span.start)} · ${duration(nowMs - span.start)}`)
    : t !== null ? `${t.seatName ?? 'The orchestrator'} · orchestrator · turn ${t.n} ${t.running ? `since ${clock(t.at)}` : `ended ${clock(t.at)}`}`
      : rec !== null ? `${rec.seatName !== null ? `${rec.seatName} · ` : ''}${rec.status === 'running' || rec.status === 'pending' ? 'since' : 'at'} ${clock(rec.at)}`
        : 'Not started yet';
  const now = { value: `${scope.label} · ${phaseState(r, scope)}`, sub };
  const decisions = r.gates.filter((g) => inScope(scope, g.ord));
  const open = openGates(r).filter((g) => inScope(scope, g.ord));
  const scopedDecisions = {
    open: open.length,
    answered: decisions.filter((g) => g.answeredAt !== null).length,
    items: decisions.slice(-5).map((g) => ({ text: gateWord(g.kind), when: g.answeredAt !== null ? `answered ${clock(g.answeredAt)}` : `open since ${clock(g.openedAt)}`, open: open.includes(g) })),
  };
  const checksAll = r.checks.filter((c) => inScope(scope, c.ord));
  const checks = all.checks.filter((_c, i) => {
    // `all.checks` is the newest three, newest first: keep the ones this phase ran.
    const src = r.checks.slice(-3).reverse()[i];
    return src !== undefined && checksAll.includes(src);
  });
  const seats = scope.ords.map((o) => r.units.get(o)).filter((u): u is UnitInfo => u !== undefined && (u.seatName ?? u.seat) !== null && u.seat !== 'bash').map((u) => u.seatName ?? u.seat!);
  if (seats.length === 0 && rec?.seatName != null) seats.push(rec.seatName);
  const helpers = [...new Set(seats)].map((name) => ({ name, steps: scope.label }));
  const tiles = scope.phase === 'intake' ? ['now', 'rigor']
    : scope.phase === 'build' ? ['now', 'rigor', 'decisions', 'time']
      : scope.phase === 'checks' ? ['now', 'checks']
        : scope.phase === 'deliver' ? ['now', 'decisions']
          : ['now', 'helpers', 'decisions'];
  const rigor = scope.phase === 'intake' && all.rigor !== null ? all.rigor.slice(0, 1) : all.rigor;
  return { ...all, now, checks, decisions: scopedDecisions, helpers, rigor, handoff: null, tiles };
}
