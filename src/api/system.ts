/**
 * The system snapshot — `GET /api/v1/system` (crew `feat/system-snapshot`, api-types 0.136.0,
 * DES-SYSTEM-VIEW): one derived, read-only read of everything that can stop work. A crew that serves
 * it says `capabilities.system: true` on `GET /health`; an older crew has no route at all, and Nerve
 * Center shows today's Health cards plus the feed instead.
 *
 * ── INTEGRATION POINT ──────────────────────────────────────────────────────────────────────────
 * `Wire*` below mirrors the SETTLED contract (`SystemSnapshot` and friends in
 * `wicked-crew-api-types` 0.136.0). Studio's installed api-types predates it, so the mirror stands in;
 * replace the `Wire*` block with imports from `./types.js` when studio bumps to 0.136.0. Every field
 * is read through {@link normalizeSnapshot}, so a missing field becomes an absent value (never a
 * fabricated 0 or "ok"), and an unknown state word becomes `unknown`.
 */

import { apiFetch } from './client.js';
import { isRouteUnsupported } from './errors.js';

// ── The wire (mirror of api-types 0.136.0) ──────────────────────────────────────────────────────

export type WireSystemState = 'ok' | 'degraded' | 'down' | 'unknown' | 'off';
export type WireSystemActionKind = 'sign_in' | 'recheck' | 'open_gate' | 'open_run';
export type WireSystemTarget =
  | { kind: 'infra'; key: string }
  | { kind: 'cli'; cli: string }
  | { kind: 'run'; runId: string; gateOrd?: number; interactionId?: string }
  | { kind: 'governance'; key: string };

export interface WireSystemSnapshot {
  checkedAt: string;
  budgetMs: number;
  tookMs: number;
  level: 'green' | 'yellow' | 'red';
  attention: {
    id: string; severity: 'red' | 'yellow'; source: 'infra' | 'cli' | 'run' | 'governance';
    title: string; reason: string; remedy: string; blocks: number; target: WireSystemTarget;
    action: { kind: WireSystemActionKind; label: string } | null;
    /** api-types 0.140.0 (`capabilities.attentionRanked`): one root cause per item, ranked by impact. */
    kind?: 'prevents' | 'slows'; blockedRunIds?: string[]; waitedSince?: string | null; unitsLeft?: number;
  }[];
  /** api-types 0.140.0: work nobody resolved, with what it cost. */
  unresolved?: {
    id: string; runId: string; title: string; repo?: string | null; workflow?: string | null; status: string; why: 'failed' | 'superseded' | 'parked'; reason: string;
    supersededBy?: string; since: string | null;
    cost: { costUsd: number | null; tokens: { input: number; output: number } | null; wallMs: number | null };
    actions: ('retry' | 'archive' | 'close_superseded')[];
  }[];
  unresolvedSpend?: { costUsd: number | null; tokens: { input: number; output: number } | null; costKnown: number };
  toReview?: number | null;
  clis: {
    cli: string; label: string; state: 'signed_in' | 'signed_out' | 'benched' | 'unknown'; stateReason: string | null;
    benchedUntil?: string; canSignIn: boolean; councilEligible: boolean; workEligible: boolean; version: string | null;
    versionPin: { pinned: string; observed: string | null; matched: boolean } | null; governanceClass: string | null;
    governanceMode: Record<string, string> | null; transport: string | null; sandbox: string;
    lastError: { at: string; message: string } | null;
    stats: {
      days: number; since: number; asOf: number; units: number; gated: number; firstPass: number; passPct: number | null;
      medianUnitMs: number | null; rateLimited: number; benches: number; fallbacks: number; perDay: number[];
      tokens?: { input: number; output: number }; costUsd?: number; runsRead: number; truncated: boolean;
    } | null;
    statsNote?: string;
    details: Record<string, unknown>;
  }[];
  runs: {
    runId: string; title: string; status: string; liveness: 'waiting_on_you' | 'held' | 'stalled' | 'quiet' | 'working';
    reason: string; phase: string | null; unitOrd: number | null; seat: string | null; lastEventAt: string | null;
    evidence: 'event_log' | 'relay' | 'process' | null; quietForMs: number | null; quietAfterMs: number; stallAfterMs: number;
    gate?: { interactionId: string | null; ord: number | null; kind: string | null; prompt: string | null };
    createdAt: string | null;
  }[];
  infra: {
    key: string; label: string; state: WireSystemState; reason: string; remedy: string | null; checkedAt: string;
    durationMs: number; timeoutMs?: number; details: Record<string, unknown>;
  }[];
  governance: {
    key: string; label: string; state: WireSystemState; value: number | null; breakdown?: Record<string, number>;
    reason: string; remedy: string | null; since?: number; details?: Record<string, unknown>;
  }[];
}

// ── What the page renders ───────────────────────────────────────────────────────────────────────

export type SystemState = WireSystemState;

/** How much work an attention item blocks: red = work is blocked, yellow = it needs a look. */
export type AttentionLevel = 'red' | 'yellow';

/** The one existing action an item offers (rule 4): Sign in, Re-check, or open the run / its gate. */
export interface SystemAction {
  kind: 'sign-in' | 'recheck' | 'open-gate' | 'open-run';
  /** The CLI key (sign-in), the infra key (recheck) or the run id (open-gate / open-run). */
  target: string;
  /** The gate's unit ordinal, when the action opens a gate. */
  ord?: number | null;
  /** The daemon's words for the button; studio's own when absent. */
  label?: string | null;
}

export interface SystemAttention {
  id: string;
  level: AttentionLevel;
  panel: 'clis' | 'runs' | 'infra' | 'governance';
  /** The worst-item words, short enough for the rail tile ("gateway down"). */
  text: string;
  reason: string | null;
  remedy: string | null;
  action: SystemAction | null;
  /** (ranked crew) `prevents`: work can't move until someone acts; `slows`: the system slows it. */
  kind?: 'prevents' | 'slows' | null;
  /** (ranked crew) The runs this one cause holds. */
  blockedRunIds?: string[];
  /** (ranked crew) When the oldest held gate arrived (unix millis), or null. */
  waitedSince?: number | null;
  /** (ranked crew) The run the item points at, when it points at one. */
  runId?: string | null;
}

/** (crew api-types 0.140.0) One run nobody has resolved, with what it cost. */
export interface SystemUnresolved {
  runId: string;
  title: string;
  /** The run's repo and workflow (look-alike items are grouped by them); `null` when crew did not say. */
  repo: string | null;
  workflow: string | null;
  status: string;
  why: 'failed' | 'superseded' | 'parked';
  reason: string;
  supersededBy: string | null;
  since: number | null;
  costUsd: number | null;
  tokens: number | null;
  wallMs: number | null;
  actions: ('retry' | 'archive' | 'close_superseded')[];
}

export type CliState = 'signed_in' | 'signed_out' | 'benched' | 'unknown';

export interface SystemCli {
  key: string;
  name: string;
  state: CliState;
  /** Why it is not signed in, in words. */
  reason: string | null;
  benchedUntil: number | null;
  canSignIn: boolean;
  version: string | null;
  /** 7-day window, folded from the run store. `null` = not counted, never 0. */
  units: number | null;
  /** 0..100. */
  passPct: number | null;
  medianMs: number | null;
  rateLimited: number | null;
  fallbacks: number | null;
  /** Only where the CLI reports it; otherwise absent (`null`), never 0. */
  tokens: number | null;
  /** Units per day, oldest first. */
  perDay: number[];
  /** The window the stats cover, in days (crew counts 7), or null with no stats. */
  statsDays: number | null;
  /** Why there are no stats (no event-log binding, the fold ran out of time). */
  statsNote: string | null;
  versionPin: { pinned: string | null; observed: string | null; matched: boolean | null } | null;
  governanceMode: string | null;
  sandbox: string | null;
  lastError: { at: number | null; message: string } | null;
}

export type RunLiveness = WireSystemSnapshot['runs'][number]['liveness'];

export interface SystemRun {
  runId: string;
  title: string;
  liveness: RunLiveness;
  phase: string | null;
  seat: string | null;
  lastEventAt: number | null;
  reason: string | null;
  /** The gate it waits at, when it waits at one: the link goes straight there. */
  gateOrd: number | null;
  /** It waits at an open gate or question (the link opens the gate). */
  atGate: boolean;
}

export interface SystemInfra {
  key: string;
  name: string;
  state: SystemState;
  reason: string | null;
  remedy: string | null;
  /** The raw probe (Technical details). */
  detail: string | null;
  checkedAt: number | null;
  timeoutMs: number | null;
  /**
   * The free-disk reading, when the row carries one (the `disk` row). Crew's `freeDisk` block (core#1138:
   * the volume's free bytes and the floor below which jobs stop) wins where crew provides it; else the
   * row's own `freeBytes` / `totalBytes`. `null` when the row says neither.
   */
  /** `availableBytes`: what the volume can still take for important use (macOS counts purgeable space macOS clears on
   *  demand: Finder's "available"); null where crew does not report it (off macOS, an older crew). */
  disk: { freeBytes: number; totalBytes: number | null; floorBytes: number | null; availableBytes: number | null } | null;
  /** The host load, when the row carries one (the `load` row). */
  load: { load1: number; cores: number | null } | null;
}

export interface SystemGovernanceCard {
  key: string;
  name: string;
  /** The headline value in words ("2", "not counted"). */
  value: string;
  state: SystemState;
  detail: string | null;
  remedy: string | null;
  /** The counts behind it, in words ("pass 18 · fail 3"). */
  breakdown: string | null;
  /** The same counts as numbers (the Report draws them), or null when the wire carries none. */
  counts: Record<string, number> | null;
  /** The start of the window crew counted over (unix millis), when it says. */
  since: number | null;
}

export interface SystemSnapshot {
  checkedAt: number;
  /**
   * The crew follows the one needs-you rule (`capabilities.attentionRanked`, api-types 0.140.0):
   * `attention` IS the needs-you list, in crew's order, and its length is the number. False against
   * an older crew, whose attention is a union and whose number is studio's own fold.
   */
  ranked?: boolean;
  /** Crew's own light (with a ranked crew: green only when attention and unresolved are both empty). */
  level?: 'green' | 'yellow' | 'red' | null;
  attention: SystemAttention[];
  /** (ranked crew) Work nobody resolved; `[]` from an older crew. */
  unresolved?: SystemUnresolved[];
  /** (ranked crew) `unresolved`'s summed cost, `null` when none is known. */
  unresolvedSpendUsd?: number | null;
  /** (ranked crew) Pending proposals ("N to review"); `null` unknown or an older crew. */
  toReview?: number | null;
  clis: SystemCli[];
  runs: SystemRun[];
  infra: SystemInfra[];
  governance: SystemGovernanceCard[];
}

type Bag = Record<string, unknown>;
const bag = (v: unknown): Bag => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Bag) : {});
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
/** A timestamp as unix millis: an ISO string, or a number. */
const when = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') { const t = Date.parse(v); return Number.isNaN(t) ? null : t; }
  return null;
};
const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  (typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback);
/** A raw block for Technical details: pretty JSON, or nothing when empty. */
const raw = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object' && Object.keys(v as object).length === 0) return null;
  try { return JSON.stringify(v, null, 2); } catch { return null; }
};

const STATES = ['ok', 'degraded', 'down', 'unknown', 'off'] as const;
const LIVENESS = ['waiting_on_you', 'held', 'stalled', 'quiet', 'working'] as const;
const CLI_STATES = ['signed_in', 'signed_out', 'benched', 'unknown'] as const;
const PANEL_OF: Record<string, SystemAttention['panel']> = { infra: 'infra', cli: 'clis', run: 'runs', governance: 'governance' };
const ACTION_OF: Record<string, SystemAction['kind']> = { sign_in: 'sign-in', recheck: 'recheck', open_gate: 'open-gate', open_run: 'open-run' };

function action(a: Bag, target: Bag): SystemAction | null {
  const kind = ACTION_OF[String(a['kind'])];
  if (kind === undefined) return null;
  const t = str(target['cli']) ?? str(target['runId']) ?? str(target['key']) ?? '';
  if (t === '' && kind !== 'recheck') return null;
  return { kind, target: t, ord: num(target['gateOrd']), label: str(a['label']) };
}

/**
 * A row's free-disk reading. `details.freeDisk` (core#1138's block: `freeBytes`, `volumeBytes`,
 * `floorBytes`; or plain bytes) is read first, where crew provides it; then the row's `freeBytes` and
 * `totalBytes`. Nothing measured stays `null`, never 0.
 */
export function diskReading(details: unknown): SystemInfra['disk'] {
  const d = bag(details);
  const fd = d['freeDisk'];
  const available = num(d['availableBytes']);
  if (typeof fd === 'number' && Number.isFinite(fd)) return { freeBytes: fd, totalBytes: num(d['totalBytes']), floorBytes: null, availableBytes: available };
  const f = bag(fd);
  const free = num(f['freeBytes']);
  if (free !== null) return { freeBytes: free, totalBytes: num(f['volumeBytes']) ?? num(d['totalBytes']), floorBytes: num(f['floorBytes']), availableBytes: available };
  const own = num(d['freeBytes']);
  return own === null ? null : { freeBytes: own, totalBytes: num(d['totalBytes']), floorBytes: null, availableBytes: available };
}

/** The governance mode per scope, in words ("admitted", or "unscoped: admitted · repo: enforced"). */
function modeWords(v: unknown): string | null {
  const m = bag(v);
  const entries = Object.entries(m).map(([k, x]) => [k, typeof x === 'string' ? x : str(bag(x)['mode'])] as const).filter((e): e is readonly [string, string] => e[1] !== null);
  if (entries.length === 0) return null;
  const modes = new Set(entries.map(([, x]) => x));
  return modes.size === 1 ? [...modes][0]! : entries.map(([k, x]) => `${k}: ${x}`).join(' · ');
}

/**
 * The snapshot, read defensively: anything the wire does not say is absent (`null`, `[]`). An
 * attention item without a severity is `yellow` (it needs a look) — never dropped, never red by guess.
 */
export function normalizeSnapshot(input: unknown): SystemSnapshot {
  const b = bag(input);
  const spend = bag(b['unresolvedSpend']);
  const level = b['level'];
  return {
    checkedAt: when(b['checkedAt']) ?? Date.now(),
    // The ranked contract's own field; `readTick` also requires the capability.
    ranked: Array.isArray(b['unresolved']),
    level: level === 'green' || level === 'yellow' || level === 'red' ? level : null,
    attention: list(b['attention']).map((x, i) => {
      const a = bag(x);
      const target = bag(a['target']);
      const kind = a['kind'] === 'prevents' || a['kind'] === 'slows' ? a['kind'] : null;
      return {
        id: str(a['id']) ?? `attention-${i}`,
        level: a['severity'] === 'red' ? 'red' : 'yellow',
        panel: PANEL_OF[String(a['source'])] ?? 'infra',
        text: str(a['title']) ?? 'something needs a look',
        reason: str(a['reason']),
        remedy: str(a['remedy']),
        action: a['action'] === null || a['action'] === undefined ? null : action(bag(a['action']), target),
        kind,
        blockedRunIds: list(a['blockedRunIds']).map(str).filter((id): id is string => id !== null),
        waitedSince: when(a['waitedSince']),
        runId: target['kind'] === 'run' ? str(target['runId']) : null,
      };
    }),
    unresolved: list(b['unresolved']).map((x) => {
      const u = bag(x);
      const cost = bag(u['cost']);
      const tok = bag(cost['tokens']);
      const why = pick(u['why'], ['failed', 'superseded', 'parked'] as const, 'failed');
      return {
        runId: str(u['runId']) ?? '',
        title: str(u['title']) ?? 'A job',
        repo: str(u['repo']),
        workflow: str(u['workflow']),
        status: str(u['status']) ?? 'unknown',
        why,
        reason: str(u['reason']) ?? '',
        supersededBy: str(u['supersededBy']),
        since: when(u['since']),
        costUsd: num(cost['costUsd']),
        tokens: num(tok['input']) === null && num(tok['output']) === null ? null : (num(tok['input']) ?? 0) + (num(tok['output']) ?? 0),
        wallMs: num(cost['wallMs']),
        actions: list(u['actions']).filter((k): k is 'retry' | 'archive' | 'close_superseded' => k === 'retry' || k === 'archive' || k === 'close_superseded'),
      };
    }).filter((u) => u.runId !== ''),
    unresolvedSpendUsd: num(spend['costUsd']),
    toReview: num(b['toReview']),
    clis: list(b['clis']).map((x) => {
      const c = bag(x);
      const s = c['stats'] === null || c['stats'] === undefined ? null : bag(c['stats']);
      const pin = c['versionPin'] === null || c['versionPin'] === undefined ? null : bag(c['versionPin']);
      const err = c['lastError'] === null || c['lastError'] === undefined ? null : bag(c['lastError']);
      const tok = s === null ? null : bag(s['tokens']);
      const key = str(c['cli']) ?? 'cli';
      return {
        key,
        name: str(c['label']) ?? key,
        state: pick(c['state'], CLI_STATES, 'unknown'),
        reason: str(c['stateReason']),
        benchedUntil: when(c['benchedUntil']),
        canSignIn: c['canSignIn'] === true,
        version: str(c['version']),
        units: s === null ? null : num(s['units']),
        passPct: s === null ? null : num(s['passPct']),
        medianMs: s === null ? null : num(s['medianUnitMs']),
        rateLimited: s === null ? null : num(s['rateLimited']),
        fallbacks: s === null ? null : num(s['fallbacks']),
        tokens: tok === null || (num(tok['input']) === null && num(tok['output']) === null) ? null : (num(tok['input']) ?? 0) + (num(tok['output']) ?? 0),
        perDay: s === null ? [] : list(s['perDay']).map((n) => num(n) ?? 0),
        statsDays: s === null ? null : num(s['days']),
        statsNote: str(c['statsNote']),
        versionPin: pin === null ? null : {
          pinned: str(pin['pinned']),
          observed: str(pin['observed']),
          matched: typeof pin['matched'] === 'boolean' ? pin['matched'] : null,
        },
        governanceMode: modeWords(c['governanceMode']),
        sandbox: str(c['sandbox']),
        lastError: err === null || str(err['message']) === null ? null : { at: when(err['at']), message: str(err['message'])! },
      };
    }),
    runs: list(b['runs']).map((x) => {
      const r = bag(x);
      const gate = r['gate'] === undefined || r['gate'] === null ? null : bag(r['gate']);
      // An unknown liveness word is never read as "working".
      const liveness = pick(r['liveness'], LIVENESS, 'quiet');
      return {
        runId: str(r['runId']) ?? '',
        title: str(r['title']) ?? 'A run',
        liveness,
        phase: str(r['phase']),
        seat: str(r['seat']),
        lastEventAt: when(r['lastEventAt']),
        reason: str(r['reason']),
        gateOrd: gate === null ? null : num(gate['ord']),
        atGate: gate !== null || liveness === 'waiting_on_you',
      };
    }).filter((r) => r.runId !== ''),
    infra: list(b['infra']).map((x) => {
      const r = bag(x);
      const key = str(r['key']) ?? 'component';
      return {
        key,
        name: str(r['label']) ?? key,
        state: pick(r['state'], STATES, 'unknown'),
        reason: str(r['reason']),
        remedy: str(r['remedy']),
        detail: raw(r['details']),
        checkedAt: when(r['checkedAt']),
        timeoutMs: num(r['timeoutMs']),
        disk: diskReading(r['details']),
        load: num(bag(r['details'])['load1']) === null ? null : { load1: num(bag(r['details'])['load1'])!, cores: num(bag(r['details'])['cores']) },
      };
    }),
    governance: list(b['governance']).map((x) => {
      const g = bag(x);
      const key = str(g['key']) ?? 'card';
      const value = num(g['value']);
      const br = Object.entries(bag(g['breakdown'])).filter(([, n]) => typeof n === 'number');
      return {
        key,
        name: str(g['label']) ?? key,
        value: value === null ? 'not counted' : value.toLocaleString(),
        state: pick(g['state'], STATES, 'unknown'),
        detail: str(g['reason']),
        remedy: str(g['remedy']),
        breakdown: br.length === 0 ? null : br.map(([k, n]) => `${k.replace(/_/g, ' ')} ${String(n)}`).join(' · '),
        counts: br.length === 0 ? null : Object.fromEntries(br) as Record<string, number>,
        since: when(g['since']),
      };
    }),
  };
}

/** `GET /api/v1/system`, normalized. Only called when `/health` says `capabilities.system`. */
export async function getSystem(): Promise<SystemSnapshot> {
  return normalizeSnapshot(await apiFetch<WireSystemSnapshot>('/system'));
}

/** The route is absent (a crew that claims the capability but predates the route). */
export function isSystemUnsupported(e: unknown): boolean {
  return isRouteUnsupported(e);
}
