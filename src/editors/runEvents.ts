/**
 * Run events for plugins that OBSERVE (program DES-PLUGIN-EVENTS §3.2, spike step 1). Pure and framework-free, so the
 * host, the run-thread slot and the unit tests drive the same code.
 *
 *  - {@link toRow} maps one engine CoreEvent to one topic row in the designed `wicked.run.<noun>.<verb>` namespace the
 *    bus mirror will carry (DES §3.1). A row holds a CLOSED projection of the frame: numbers, enum words and step and
 *    seat ids only. No prompt, path, log tail, environment or free text ever reaches a plugin.
 *  - {@link topicMatches} reads a manifest's topic pattern (`*` = one segment, a trailing `**` = any rest).
 *  - {@link RunEventFeed} delivers a run's rows to one plugin: a replay of the run's durable log first, then live
 *    frames, each at most once (a live frame that the replay already holds is dropped by content), and only rows on a
 *    topic the plugin was granted. A row on any other topic is never built into a batch at all.
 */

import type { CoreEvent } from '../api/types.js';

/** One row, as a plugin receives it in `events.batch`. */
export interface TopicRow {
  /** Unique within the run: `s<seq>` for a recorded frame, `l<n>` for a live one. */
  id: string;
  topic: string;
  runId: string;
  /** The engine's run-wide sequence number; null for a live frame (the live copy carries none). */
  seq: number | null;
  /** Epoch ms: the engine's stamp, or when the host received a live frame. */
  at: number;
  /** The unit the row is about, when it is about one. */
  ord: number | null;
  data: Record<string, string | number | boolean | null | readonly unknown[] | Record<string, unknown>>;
}

export interface EventsBatch {
  runId: string;
  /** True for the replay of the run's durable log (sent once, first). */
  replay: boolean;
  rows: TopicRow[];
  /** Set when the replay could not be read: live rows follow, the history before them is missing. */
  gap?: 'history-unavailable';
}

/** Every topic the host can deliver today, and the CoreEvent types each is made from. */
export const RUN_TOPICS: Readonly<Record<string, readonly string[]>> = {
  'wicked.run.session.started': ['sessionStarted'],
  'wicked.run.session.resumed': ['resumed'],
  'wicked.run.session.finished': ['sessionCompleted', 'sessionFailed', 'runCancelled'],
  'wicked.run.unit.planned': ['unitPlanned'],
  'wicked.run.unit.assigned': ['unitDistributed'],
  'wicked.run.unit.started': ['unitExecuting'],
  'wicked.run.unit.finished': ['unitDone', 'unitDenied', 'stepFailed'],
  'wicked.run.human.awaited': ['awaitingHuman'],
  'wicked.run.checks.evaluated': ['repoChecksEvaluated'],
  'wicked.run.qe.decided': ['qeAcceptanceDecided'],
  'wicked.run.usage.reported': ['cliUsage'],
  // Power mode (DES-POWER-MODE; api-types 0.149.0's `RunBusType`): the intake plan, every rigor re-score, the checkpoints,
  // the orchestrator's turns, the hand-off steps and the switch.
  'wicked.run.intake.planned': ['powerIntakePlanned'],
  'wicked.run.rigor.rescored': ['rigorRescored'],
  'wicked.run.checkpoint.reached': ['powerCheckpointReached'],
  'wicked.run.turn.started': ['powerTurnStarted'],
  'wicked.run.turn.completed': ['powerTurnCompleted'],
  'wicked.run.handoff.stepped': ['powerHandoffStepped'],
  'wicked.run.power.toggled': ['powerToggled'],
};

const SEGMENT = /^[a-z][a-z0-9_-]{0,40}$/u;

/** A topic pattern a manifest may declare: `wicked.` then dot-separated words, `*`, or a final `**`. */
export function validPattern(p: unknown): p is string {
  if (typeof p !== 'string' || p.length > 120) return false;
  const parts = p.split('.');
  if (parts[0] !== 'wicked' || parts.length < 2) return false;
  return parts.slice(1).every((s, i, all) => SEGMENT.test(s) || s === '*' || (s === '**' && i === all.length - 1));
}

/** Does `pattern` cover `topic`? An invalid pattern covers nothing. */
export function topicMatches(pattern: string, topic: string): boolean {
  if (!validPattern(pattern)) return false;
  const p = pattern.split('.');
  const t = topic.split('.');
  for (let i = 0; i < p.length; i += 1) {
    if (p[i] === '**') return t.length > i;
    if (i >= t.length) return false;
    if (p[i] !== '*' && p[i] !== t[i]) return false;
  }
  return p.length === t.length;
}

export function granted(patterns: readonly string[], topic: string): boolean {
  return patterns.some((p) => topicMatches(p, topic));
}

/** The topics of the catalog a set of patterns grants, in catalog order. */
export function grantedTopics(patterns: readonly string[]): string[] {
  return Object.keys(RUN_TOPICS).filter((t) => granted(patterns, t));
}

/** The CoreEvent types the replay must read for these patterns (the `?type=` filter): nothing else is fetched. */
export function sourceTypes(patterns: readonly string[]): string[] {
  return [...new Set(grantedTopics(patterns).flatMap((t) => RUN_TOPICS[t] ?? []))];
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const word = (v: unknown, max = 40): string | null => (typeof v === 'string' && /^[A-Za-z0-9_.:-]{1,80}$/u.test(v) ? v.slice(0, max) : null);

/** `fix — Fix wicked-crew issue …` → `fix`: only the step id at the head, never the intent text after it. */
export function stepIdOf(description: unknown): string | null {
  if (typeof description !== 'string') return null;
  const head = description.split(/\s+[—-]\s+/u)[0]?.trim() ?? '';
  return /^[a-z][a-z0-9_-]{0,40}$/u.test(head) ? head : null;
}

const RIGOR_WORDS = new Set(['light', 'standard', 'high', 'highest']);
const rigorOf = (v: unknown): string | null => (typeof v === 'string' && RIGOR_WORDS.has(v) ? v : null);
const objOf = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : {});

function checksOf(v: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 40).flatMap((c) => {
    if (typeof c !== 'object' || c === null) return [];
    const r = c as Record<string, unknown>;
    const name = word(r['name']);
    if (name === null) return [];
    return [{ name, exitCode: num(r['exitCode']), timedOut: r['timedOut'] === true, durationMs: num(r['durationMs']) }];
  });
}

function reusedOf(v: unknown): Record<string, unknown> | null {
  if (typeof v !== 'object' || v === null) return null;
  const r = v as Record<string, unknown>;
  const names = (x: unknown): string[] => (Array.isArray(x) ? x.map((n) => word(n)).filter((n): n is string => n !== null).slice(0, 20) : []);
  return { phase: word(r['phase']), ord: num(r['ord']), attempt: num(r['attempt']), reused: names(r['reused']), fresh: names(r['fresh']) };
}

/** One CoreEvent as a row, or null when no topic carries it. `names` turns a seat key into its display name. */
export function toRow(e: CoreEvent, runId: string, at: number, id: string, names?: (cli: string) => string | null): TopicRow | null {
  const ev = e as unknown as Record<string, unknown>;
  const ord = num(ev['ord']);
  const seq = num(ev['seq']);
  const base = { id, runId, seq, at: num(ev['ts']) ?? at, ord };
  switch (e.type) {
    case 'sessionStarted': return { ...base, topic: 'wicked.run.session.started', data: {} };
    case 'resumed': return { ...base, topic: 'wicked.run.session.resumed', data: {} };
    case 'sessionCompleted': return { ...base, topic: 'wicked.run.session.finished', data: { outcome: 'completed' } };
    case 'sessionFailed': return { ...base, topic: 'wicked.run.session.finished', data: { outcome: 'failed' } };
    case 'runCancelled': return { ...base, topic: 'wicked.run.session.finished', data: { outcome: 'cancelled' } };
    case 'unitPlanned':
      return { ...base, topic: 'wicked.run.unit.planned', data: { step: stepIdOf(ev['description']), role: word(ev['role']), stage: word(ev['stage']), gate: word(ev['gate']), executor: word(ev['executorType']) } };
    case 'unitDistributed': {
      const seat = word(ev['cli']);
      return { ...base, topic: 'wicked.run.unit.assigned', data: { seat, seatName: seat !== null ? (names?.(seat) ?? null) : null } };
    }
    case 'unitExecuting': return { ...base, topic: 'wicked.run.unit.started', data: {} };
    case 'unitDone': return { ...base, topic: 'wicked.run.unit.finished', data: { outcome: 'done' } };
    case 'unitDenied': return { ...base, topic: 'wicked.run.unit.finished', data: { outcome: 'denied' } };
    case 'stepFailed': return { ...base, topic: 'wicked.run.unit.finished', data: { outcome: 'failed' } };
    case 'awaitingHuman': return { ...base, topic: 'wicked.run.human.awaited', data: { kind: word(ev['gateKind']) ?? 'question' } };
    case 'repoChecksEvaluated':
      return {
        ...base,
        topic: 'wicked.run.checks.evaluated',
        data: {
          attempt: num(ev['attempt']), floor: word(ev['floor']), outcome: word(ev['outcome']), passed: ev['passed'] === true,
          checks: checksOf(ev['checks']), reusedFrom: reusedOf(ev['reusedFrom']),
          changedFiles: Array.isArray(ev['changed']) ? ev['changed'].length : null,
        },
      };
    case 'qeAcceptanceDecided': {
      const qe = (typeof ev['qe'] === 'object' && ev['qe'] !== null ? ev['qe'] : {}) as Record<string, unknown>;
      return { ...base, topic: 'wicked.run.qe.decided', data: { status: word(qe['status']), score: num(qe['score']) } };
    }
    // Power mode: rigor words, numbers and seat ids only — never the reasons, summaries or plan text (free text).
    case 'powerIntakePlanned': {
      const p = objOf(ev['plan']);
      return { ...base, topic: 'wicked.run.intake.planned', at: num(p['at']) ?? base.at, data: { rigor: rigorOf(p['rigor']), score: num(p['score']), band: word(p['band']), highRisk: p['highRisk'] === true, estimateMinutes: num(p['estimateMinutes']), mandatoryPhases: Array.isArray(p['mandatoryPhases']) ? p['mandatoryPhases'].length : 0 } };
    }
    case 'rigorRescored': {
      const c = objOf(ev['change']);
      const by = typeof c['by'] === 'string' ? c['by'] : '';
      return {
        ...base, topic: 'wicked.run.rigor.rescored', at: num(c['at']) ?? base.at,
        data: {
          seq: num(c['seq']), trigger: word(c['trigger']), from: rigorOf(c['from']), to: rigorOf(c['to']), direction: word(c['direction']),
          planned: num(c['planned']), actual: num(c['actual']), checkpoint: num(c['checkpoint']), turn: num(c['turn']), paused: c['paused'] === true,
          byKind: by === 'engine' ? 'engine' : by.startsWith('plugin:') ? 'plugin' : by === '' ? null : 'person',
        },
      };
    }
    case 'powerCheckpointReached':
      return { ...base, topic: 'wicked.run.checkpoint.reached', data: { checkpoint: num(ev['checkpoint']), turn: num(ev['turn']), trigger: word(ev['trigger']), rigor: rigorOf(ev['rigor']), picked: num(ev['picked']), paused: ev['paused'] === true } };
    case 'powerTurnStarted':
    case 'powerTurnCompleted': {
      const seat = word(ev['cli']);
      return { ...base, topic: e.type === 'powerTurnStarted' ? 'wicked.run.turn.started' : 'wicked.run.turn.completed', data: { turn: num(ev['turn']), attempt: num(ev['attempt']), seat, seatName: seat !== null ? (names?.(seat) ?? null) : null, outcome: word(ev['outcome']) } };
    }
    case 'powerHandoffStepped': {
      const st = objOf(ev['step']);
      const seat = word(st['seat']);
      return { ...base, topic: 'wicked.run.handoff.stepped', at: num(st['at']) ?? base.at, ord: num(st['ord']), data: { round: num(ev['round']), step: word(st['step']), status: word(st['status']), seat, seatName: seat !== null ? (names?.(seat) ?? null) : null } };
    }
    case 'powerToggled': {
      const t = objOf(ev['toggle']);
      return { ...base, topic: 'wicked.run.power.toggled', at: num(t['at']) ?? base.at, data: { on: t['on'] === true } };
    }
    case 'cliUsage':
      return { ...base, topic: 'wicked.run.usage.reported', data: { attempt: num(ev['attempt']), costUsd: num(ev['costUsd']), inputTokens: num(ev['inputTokens']), outputTokens: num(ev['outputTokens']) } };
    default: return null;
  }
}

/** The identity of one emission: the live copy and the recorded copy (which adds `ts`/`seq`) print the same
 *  (as `store/events.ts` dedupes them). */
export function fingerprint(e: CoreEvent): string {
  const bag: Record<string, unknown> = {};
  for (const key of Object.keys(e).sort()) {
    if (key === 'ts' || key === 'seq' || key === 'daemon') continue;
    bag[key] = (e as unknown as Record<string, unknown>)[key];
  }
  return JSON.stringify(bag);
}

/** The most rows one `events.batch` carries; a longer replay is sent as several. */
export const BATCH_ROWS = 200;
/** The window in which a recorded frame and a live one can be the same emission: only a frame the log stamped this
 *  recently (it may still be in flight on the socket) is checked against live frames, and only for this long after
 *  the replay. An older recorded frame can never arrive live again, so a live frame with the same content — a step
 *  re-run emits `unitExecuting` for the same unit again — is a new emission and is always heard. */
export const REPLAY_OVERLAP_MS = 15_000;

export interface FeedOptions {
  runId: string;
  /** The topic patterns the plugin was GRANTED (not merely asked for). */
  granted: readonly string[];
  /** The run's durable log, read with the `?type=` filter (`GET /runs/:id/events`). */
  history(types: readonly string[]): Promise<readonly CoreEvent[]>;
  /** Subscribe to live CoreEvents; returns the unsubscribe. */
  live(on: (e: CoreEvent) => void): () => void;
  deliver(batch: EventsBatch): void;
  names?: (cli: string) => string | null;
  now?: () => number;
}

/** One plugin's feed for one run: replay, then live, each emission at most once, granted topics only. */
export class RunEventFeed {
  private state: 'idle' | 'replaying' | 'live' | 'stopped' = 'idle';
  private buffer: CoreEvent[] = [];
  private recorded = new Map<string, number>();
  private unsubscribe: (() => void) | null = null;
  private liveSeq = 0;
  private liveSince = 0;
  private readonly types: ReadonlySet<string>;
  private readonly now: () => number;

  constructor(private readonly o: FeedOptions) {
    this.types = new Set(sourceTypes(o.granted));
    this.now = o.now ?? Date.now;
  }

  start(): void {
    if (this.state !== 'idle') return;
    this.state = 'replaying';
    this.unsubscribe = this.o.live((e) => {
      if (this.state === 'replaying') this.buffer.push(e);
      else if (this.state === 'live') this.onLive(e);
    });
    if (this.types.size === 0) { this.goLive([], undefined); return; }
    this.o.history([...this.types]).then(
      (events) => this.goLive(events, undefined),
      () => this.goLive([], 'history-unavailable'),
    );
  }

  stop(): void {
    this.state = 'stopped';
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.buffer = [];
  }

  private rowOf(e: CoreEvent, id: string): TopicRow | null {
    if (e.session !== this.o.runId || !this.types.has(e.type)) return null;
    const row = toRow(e, this.o.runId, this.now(), id, this.o.names);
    // Belt and braces: a row is built only from a granted type, and is checked against the grant again.
    return row !== null && granted(this.o.granted, row.topic) ? row : null;
  }

  private goLive(events: readonly CoreEvent[], gap: EventsBatch['gap']): void {
    if (this.state !== 'replaying') return;
    const mine = events
      .filter((e) => e.session === this.o.runId)
      .slice()
      .sort((a, b) => (num(a.seq) ?? 0) - (num(b.seq) ?? 0));
    const rows: TopicRow[] = [];
    const at = this.now();
    for (const e of mine) {
      const ts = num(e.ts);
      if (ts === null || at - ts <= REPLAY_OVERLAP_MS) {
        const f = fingerprint(e);
        this.recorded.set(f, (this.recorded.get(f) ?? 0) + 1);
      }
      const s = num(e.seq);
      const row = this.rowOf(e, s !== null ? `s${s}` : `r${rows.length}`);
      if (row !== null) rows.push(row);
    }
    if (rows.length === 0) this.o.deliver({ runId: this.o.runId, replay: true, rows: [], ...(gap !== undefined ? { gap } : {}) });
    for (let i = 0; i < rows.length; i += BATCH_ROWS) {
      this.o.deliver({ runId: this.o.runId, replay: true, rows: rows.slice(i, i + BATCH_ROWS), ...(gap !== undefined && i === 0 ? { gap } : {}) });
    }
    this.state = 'live';
    this.liveSince = this.now();
    const held = this.buffer;
    this.buffer = [];
    for (const e of held) this.onLive(e);
  }

  private onLive(e: CoreEvent): void {
    if (e.session !== this.o.runId || !this.types.has(e.type)) return;
    if (this.recorded.size > 0 && this.now() - this.liveSince > REPLAY_OVERLAP_MS) this.recorded.clear();
    const f = fingerprint(e);
    const n = this.recorded.get(f) ?? 0;
    if (n > 0) { this.recorded.set(f, n - 1); return; } // the replay already delivered this emission
    this.liveSeq += 1;
    const row = this.rowOf(e, `l${this.liveSeq}`);
    if (row !== null) this.o.deliver({ runId: this.o.runId, replay: false, rows: [row] });
  }
}
