import type { GovernanceScopeKind, RosterSeat, SeatIssue, SeatRecentBench, SeatRecordResponse } from '../api/types.js';
import { homeDirsIn } from './homePath.js';
import { relTime } from './relTime.js';
import { displaySeats, isReviewerOnly, seatLabel } from './seatNames.js';

/**
 * THE AGENTS PAGE MODEL (DES-seats-page §3–§4): one row per AI agent, in plain words, and the coded
 * issues its modal explains. Pure: the page, the rail's Agents dot and the issue modal all read it,
 * so a row, the count and the modal can never disagree.
 *
 * Inputs are crew's wire (api-types 0.115.0): `GET /roster` carries each seat's facts and its coded
 * `issues[]` (A6, crew decides the codes, studio owns every word), `version` (A1), `account` (A2),
 * `recent_bench` (A3). `work_admission` (A5) and `qe_reviewer` (A4) are FEATURE-DETECTED: crew sends
 * them only on an engine that answers both predicates, and quality checks read "Not reported" until
 * then. `GET /diagnostics` adds only the live-session fallbacks crew does not code; `GET /roster/record`
 * adds the week's step count.
 *
 * Studio adds an issue only where crew says it sends none (each marked GAP with its deletion trigger).
 * Crew free text (`message` of an unknown code, `disclosure`, `council_ineligible_reason`,
 * `recent_bench.reason`, `auth_evidence`, `login_note`) only ever reaches Technical details (§4.3).
 */

export type Tone = 'ok' | 'gate' | 'fail' | 'quiet';
export type IssueSeverity = 'problem' | 'warning' | 'note';

/** The issue codes studio has copy for (§4.1). Crew's `unchecked` splits by `params.why`. */
export type IssueCode =
  | 'signed_out'
  | 'auth_unknown'
  | 'qe_blocked'
  | 'not_admitted'
  | 'codex_worktree'
  | 'repo_refused'
  | 'no_host_boundary'
  | 'ungoverned'
  | 'fence_scoped'
  | 'version_unproven'
  | 'quota'
  | 'usage_limit'
  | 'benched'
  | 'live_check_failed'
  | 'opt_in'
  | 'no_qe'
  | 'unverified'
  | 'fallbacks'
  | 'unknown';

export interface AgentIssue {
  code: IssueCode;
  severity: IssueSeverity;
  /** Safety before availability within a severity (codex HIER r7). */
  safety: boolean;
  /** Crew's facts for the code (names, versions, counts, ISO times), when crew sent the issue. */
  params?: Record<string, string | number>;
  /** Crew's one line: shown (in Technical details) only for a code studio has no words for. */
  message?: string;
  /** Crew's code as sent (an `unknown` issue keeps it for Technical details). */
  wire?: string;
  /** The active bench of the seat that sent this issue (a folded reviewer's own, never the row's). */
  bench?: SeatRecentBench | null;
}

export interface Cell { word: string; tone: Tone; sub: string | null }

export interface AgentRow {
  key: string;
  name: string;
  binary: string;
  seat: RosterSeat;
  optIn: boolean;
  /** Picked for new work by default (the composer's own default rule). */
  picked: boolean;
  /** A reviewer-only seat named like this agent folded into its row (#735). */
  alsoReviews: boolean;
  /** Every roster key this row stands for (its own, plus a folded reviewer-only seat's). */
  keys: string[];
  ready: Cell;
  sign: Cell;
  safe: Cell;
  /** "How it's governed" in the tab's words (operator-approved concept, 2026-10-13). */
  governed: Cell;
  /** The account kind line under the name (crew A2 `account`), or null when crew sends none. */
  account: string | null;
  /** Signed in or needing no sign-in, and not refused by studio's service: counts as ready for work. */
  usable: boolean;
  /** Given repository work: no codex worktree bench and no repository refusal (first use reads this, not the words). */
  repoWork: boolean;
  version: Cell;
  reviews: boolean;
  /** `null` = crew does not report quality-check eligibility yet ("Not reported"). */
  qe: boolean | null;
  /** The bench crew keeps the agent on now (A3), or null. */
  bench: SeatRecentBench | null;
  issues: AgentIssue[];
  /** The exact `login_invocation` / `logout_invocation` (copied verbatim), when crew sent one. */
  login: string | null;
  logout: string | null;
  /** Week numbers the copy quotes. */
  week: { units: number } | null;
  acp: { fallbacks: number; sessions: number; kinds: Record<string, number> } | null;
  /** Crew-authored sentences shown ONLY inside Technical details. */
  tech: { disclosure: string | null; ineligible: string | null; evidence: string | null };
}

export interface AgentsInputs {
  roster: readonly RosterSeat[];
  /** `undefined` = diagnostics not answered: the live-session fold is unknown. */
  acpByCli?: Record<string, { sessionsStarted: number; fallbacks: number; fallbackKinds: Record<string, number> }> | undefined;
  /** `undefined` = not answered: no week numbers. */
  record?: SeatRecordResponse | undefined;
  /** Stored default keys (`wicked_default_clis`), or `null` for the composer's default rule. */
  defaults: readonly string[] | null;
  now: number;
}

// ── wire readings (tolerant) ───────────────────────────────────────────────────────────────

function bag(seat: RosterSeat): Record<string, unknown> {
  return seat as Record<string, unknown>;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

/** The seat's auth reading: crew's `auth`, else the older `signed_in` heuristic. */
export function authOf(seat: RosterSeat): 'signed_in' | 'signed_out' | 'not_required' | 'unknown' {
  const a = bag(seat)['auth'];
  if (a === 'signed_in' || a === 'signed_out' || a === 'not_required' || a === 'unknown') return a;
  if (seat.signed_in === true) return 'signed_in';
  if (seat.signed_in === false) return 'signed_out';
  return 'unknown';
}

/** `qe_reviewer` (crew ask A4), when crew sends it (feature-detected). */
export function qeReviewerOf(seat: RosterSeat): { ok: boolean; reason_code: string | null } | null {
  const v = bag(seat)['qe_reviewer'];
  if (v === null || typeof v !== 'object') return null;
  const ok = (v as Record<string, unknown>)['ok'];
  if (typeof ok !== 'boolean') return null;
  return { ok, reason_code: str((v as Record<string, unknown>)['reason_code']) };
}

/** `work_admission[scope]` (crew ask A5), when crew sends it (feature-detected). */
export function workAdmissionOf(seat: RosterSeat, scope: GovernanceScopeKind): { ok: boolean; reason_code: string | null; source: string | null; reason: string | null } | null {
  const w = bag(seat)['work_admission'];
  if (w === null || typeof w !== 'object') return null;
  const e = (w as Record<string, unknown>)[scope];
  if (e === null || typeof e !== 'object') return null;
  const o = e as Record<string, unknown>;
  if (typeof o['ok'] !== 'boolean') return null;
  return { ok: o['ok'], reason_code: str(o['reason_code']), source: str(o['source']), reason: str(o['reason']) };
}

/** `recent_bench` (A3): the bench crew keeps the agent on NOW. `lifts_at` is crew's own window, never a provider reset. */
export function benchOf(seat: RosterSeat): SeatRecentBench | null {
  const b = bag(seat)['recent_bench'];
  if (b === null || typeof b !== 'object') return null;
  const o = b as Record<string, unknown>;
  return typeof o['kind'] === 'string' && typeof o['lifts_at'] === 'string' ? (b as SeatRecentBench) : null;
}

/** Crew's coded issues (A6), tolerant of a malformed entry. */
export function wireIssuesOf(seat: RosterSeat): SeatIssue[] {
  const v = bag(seat)['issues'];
  if (!Array.isArray(v)) return [];
  return v.filter((i): i is SeatIssue => i !== null && typeof i === 'object' && typeof (i as SeatIssue).code === 'string'
    && ((i as SeatIssue).severity === 'problem' || (i as SeatIssue).severity === 'warning' || (i as SeatIssue).severity === 'note'));
}

const KNOWN: ReadonlySet<string> = new Set(['signed_out', 'qe_blocked', 'quota', 'usage_limit', 'benched', 'codex_worktree', 'version_unproven', 'fence_scoped', 'live_check_failed', 'opt_in', 'no_qe', 'unverified']);
const SAFETY: ReadonlySet<IssueCode> = new Set(['no_host_boundary', 'ungoverned', 'version_unproven', 'fence_scoped']);

/** One crew issue in studio's codes: `unchecked` splits by `params.why`; an unknown code keeps crew's line. */
function fromWire(i: SeatIssue): AgentIssue {
  let code: IssueCode;
  if (i.code === 'unchecked') code = i.params?.['why'] === 'no_host_boundary' ? 'no_host_boundary' : 'ungoverned';
  else code = KNOWN.has(i.code) ? (i.code as IssueCode) : 'unknown';
  return { code, severity: i.severity, safety: SAFETY.has(code), params: i.params ?? {}, ...(code === 'unknown' ? { message: i.message, wire: i.code } : {}) };
}

/** Whether crew says this computer has no sandbox tool for the agent's repository boundary. */
function noHostBoundary(seat: RosterSeat): boolean {
  return wireIssuesOf(seat).some((i) => i.code === 'unchecked' && i.params?.['why'] === 'no_host_boundary');
}

/**
 * STUDIO CONSTANT, GAP — DELETE when `work_admission` (A5) is on the wire everywhere (a core-ts with
 * core#920 + core#923 pinned in crew). The engine benches Codex on every run bound to one repository
 * (wicked-core `distribute.rs` CODEX_WORKTREE_BENCH), and crew sends no `codex_worktree` issue until
 * it can ask the engine. Read ONLY when the seat carries no `work_admission` at all.
 */
const WORKTREE_BENCHED_KEYS: readonly string[] = ['codex'];

/** Whether the engine keeps this agent off repository-bound jobs. */
export function worktreeBenched(seat: RosterSeat): boolean {
  if (bag(seat)['work_admission'] !== undefined) {
    const wa = workAdmissionOf(seat, 'scoped_bound');
    return wa !== null && !wa.ok && wa.reason_code === 'worktree_bench';
  }
  return WORKTREE_BENCHED_KEYS.includes(seat.key);
}

/** Crew refuses repository work for a reason no other issue names (not sign-in, a bench, the worktree bench or a reviewer-only seat). */
export function repoRefused(seat: RosterSeat): boolean {
  const wa = workAdmissionOf(seat, 'scoped_bound');
  return wa !== null && !wa.ok && wa.source !== 'auth' && !['worktree_bench', 'recent_bench', 'reviewer_only', 'signed_out'].includes(wa.reason_code ?? '');
}

/** The account line (crew ask A2): its kind in plain words, plus a provider-public plan when sent. */
export function accountOf(seat: RosterSeat): string | null {
  const a = bag(seat)['account'];
  if (a === null || typeof a !== 'object') return null;
  const o = a as Record<string, unknown>;
  const kind = o['kind'] === 'subscription' ? 'subscription' : o['kind'] === 'api_key' ? 'API key' : o['kind'] === 'free' ? 'free models' : o['kind'] === 'unknown' ? 'account unknown' : null;
  if (kind === null) return null;
  const plan = str(o['plan']);
  return plan !== null && kind !== 'account unknown' ? `${kind} · ${plan}` : kind;
}

/** The tab's four tiles (concept 2026-10-13), counted from the rows. */
export function agentTiles(rows: readonly AgentRow[]): { ready: number; limited: number; held: number; notRecommended: number; unknown: number; total: number; signedOut: number; everyAction: number; floorOnly: number; boundaryOnly: number; fixes: number; notes: number } {
  const count = (f: (r: AgentRow) => boolean): number => rows.filter(f).length;
  return {
    // codex P1: "ready" counts only agents whose row says Ready (or Ready if you pick it); the rest that can work are "with limits".
    ready: count((r) => r.usable && (r.ready.tone === 'ok' || r.ready.word === 'Ready if you pick it')),
    limited: count((r) => r.usable && !(r.ready.tone === 'ok' || r.ready.word === 'Ready if you pick it') && r.ready.word !== 'Not recommended'),
    held: count((r) => r.bench !== null && r.sign.word !== 'Signed out' && r.ready.word !== 'Not recommended'),
    notRecommended: count((r) => r.ready.word === 'Not recommended'),
    unknown: count((r) => r.ready.word === 'Can’t tell'),
    total: rows.length, signedOut: count((r) => r.sign.word === 'Signed out'),
    everyAction: count((r) => r.governed.word === 'Every action checked'),
    floorOnly: count((r) => r.governed.word === 'Sandbox floor only'),
    boundaryOnly: count((r) => r.governed.word === 'Repository boundary only'),
    fixes: rows.reduce((n, r) => n + r.issues.filter((i) => i.severity !== 'note').length, 0),
    notes: rows.reduce((n, r) => n + r.issues.filter((i) => i.severity === 'note').length, 0),
  };
}

/** The installed version in plain form ("opencode v2.0.25" → "2.0.25"). */
function bareVersion(v: string): string {
  // The first version-shaped token ("opencode v2.0.25" → "2.0.25", "2.1.287 (Claude Code)" → "2.1.287").
  // Pre-release and build metadata both count: "1.2.3-rc+a" and "1.2.3-rc+b" differ (codex #759 r1).
  return /\d+(?:\.\d+)+(?:-[\w.-]+)?(?:\+[\w.-]+)?/.exec(v)?.[0] ?? v.trim();
}

interface VersionReading {
  installed: string | null; proven: string | null; status: 'proven' | 'unproven' | 'no_pin' | null; disclosure: string | null;
  /** Unproven only because the safety check of its version got no answer (the build itself may be the approved one). */
  silent: boolean;
}

/** `version` (A1) when present, else the pinned seat's `version_pin`. */
export function versionOf(seat: RosterSeat): VersionReading | null {
  const v = bag(seat)['version'];
  const pin = seat.version_pin ?? null;
  let r: Omit<VersionReading, 'silent'>;
  if (v !== null && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const status = o['status'] === 'proven' || o['status'] === 'unproven' || o['status'] === 'no_pin' ? o['status'] : null;
    // Real data (crew 0.10.2): A1 can send `installed: null` while the pin's own probe read the build; show that reading.
    r = { installed: str(o['installed']) ?? pin?.observed ?? null, proven: str(o['proven']), status, disclosure: pin?.disclosure ?? null };
  } else if (pin !== null) {
    r = { installed: pin.observed, proven: pin.pinned, status: pin.matched ? 'proven' : 'unproven', disclosure: pin.disclosure };
  } else return null;
  // Real data (crew 0.10.1, opencode): the version reading says the approved build while the pin's
  // own probe got no answer (`version_pin.observed: null`), so the status is unproven. Say that, not "a different build".
  // A1's own reading wins: a known installed build that differs from the proven one is a real mismatch (codex S4 r1).
  const fromA1 = v !== null && typeof v === 'object';
  // "Didn't answer" needs evidence of an unanswered probe: no installed reading, or the pin's own probe silent
  // while A1 reads the very build that was proven (the whole version, suffixes included), codex S4 r5.
  const silent = r.status === 'unproven' && (r.installed === null
    || (pin !== null && pin.observed === null && (!fromA1 || (r.proven !== null && bareVersion(r.installed) === bareVersion(r.proven)))));
  return { ...r, silent };
}

/**
 * THE ONE BOUNDARY PREDICATE (§3.1): does the seat's safety claim for `scope` actually hold on this
 * computer? A `repo_boundary` claim needs the host's sandbox tool; crew says when there is none
 * (issue `unchecked`, `why: no_host_boundary`). `self` (codex's own `--sandbox`) and `seat_record`
 * are the agent's or its record's claims and keep their words.
 */
export function boundaryHolds(seat: RosterSeat, scope: GovernanceScopeKind): boolean {
  const m = seat.governance_mode?.[scope];
  if (m === undefined) return false;
  if (m.mode === 'admitted') return true;
  if (m.mode !== 'os_sandbox') return false;
  return m.source === 'repo_boundary' ? !noHostBoundary(seat) : true;
}

function strength(seat: RosterSeat, scope: GovernanceScopeKind): 0 | 2 | 3 {
  if (!boundaryHolds(seat, scope)) return 0;
  return seat.governance_mode?.[scope]?.mode === 'admitted' ? 3 : 2;
}

/** A time of day ("21:30"), for crew's own retry window. */
function clock(iso: string): string | null {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;
}

/** The Ready-for-work word for an active bench (A3). */
export function benchWord(b: SeatRecentBench): string {
  return b.kind === 'quota_exhausted' ? 'Out of quota' : b.kind === 'usage_limit' ? 'Out of usage' : 'Held back for now';
}

/** "studio tries it again by 21:30": crew's window, said as studio's retry, never as a provider reset. */
export function benchRetry(b: Pick<SeatRecentBench, 'lifts_at'>): string | null {
  const c = clock(b.lifts_at);
  return c === null ? null : `studio tries it again by ${c}`;
}

/**
 * The second guard on crew's sign-in evidence (§4.3): crew scrubs account identifiers before the
 * wire (A8); studio still hides anything email-, id- or key-shaped that slipped through.
 */
/** A label that names an identifier or a credential: its value is hidden with it. */
const SECRET_LABEL = String.raw`(?:acct|org|user|account|email|token|secret|password|passwd|api[_-]?key|access[_-]?key|session[_-]?key)(?:[ _-]?id)?`;
/** `label: value`, `label=value`, `"label": "value"` (quoted values whole, escapes included), codex S4 r5–r7. */
const LABELLED = new RegExp(String.raw`["']?\b${SECRET_LABEL}\b["']?\s*[:=]\s*(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\s,;}]+)`, 'gi');

export function maskIds(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[email hidden]')
    .replace(LABELLED, '[hidden]')
    .replace(/\bbearer\s+\S+/gi, '[hidden]')
    // A prefixed identifier (`acct_…`, `user_jane_doe`).
    .replace(/\b(?:acct|org|user|account)[_-][A-Za-z0-9_-]+/gi, '[id hidden]')
    // Known credential prefixes, whatever follows (codex S4 r2 P1).
    .replace(/\b(?:sk|pk|rk|ghp|gho|ghu|ghs|github_pat|glpat|xox[abprs]|AKIA|AIza)[-_A-Za-z0-9]{8,}/g, '[key hidden]')
    // Key-shaped: any run of 24+ token characters, base64 and URL-safe alike, is hidden. This is the
    // second guard over text crew already scrubbed (A8), so it keeps no exemptions: a long path or
    // name in Technical details reads hidden too (codex S4 r1; #759 r1–r3 found a hole in each
    // exemption).
    .replace(/[A-Za-z0-9+/_=-]{24,}/g, '[key hidden]');
}

/** A command as shown: the home directory reads `$HOME` (it expands inside double quotes; `~` does not). */
export function commandDisplay(line: string): string {
  let out = line;
  for (const dir of homeDirsIn(line)) out = out.split(dir).join('$HOME');
  return out;
}

/**
 * One row per agent name: a reviewer-only seat named like an agent rides that agent's row (#735),
 * but only when both carry the same sign-in reading (one login, so the row's sign-in, its fixes and
 * its commands speak for both). A reviewer whose sign-in differs is its own row (codex PR r3/r4).
 */
export function foldReviewers(seats: readonly RosterSeat[]): { seat: RosterSeat; alsoReviews: boolean; keys: string[] }[] {
  const out: { seat: RosterSeat; alsoReviews: boolean; keys: string[] }[] = [];
  const reviewers = seats.filter(isReviewerOnly);
  const folded = new Set<string>();
  for (const seat of seats) {
    if (isReviewerOnly(seat)) continue;
    const mine = reviewers.filter((r) => !folded.has(r.key) && seatLabel(r) === seatLabel(seat) && authOf(r) === authOf(seat)).map((r) => r.key);
    mine.forEach((k) => folded.add(k));
    out.push({ seat, alsoReviews: mine.length > 0, keys: [seat.key, ...mine] });
  }
  for (const r of reviewers) if (!folded.has(r.key)) out.push({ seat: r, alsoReviews: false, keys: [r.key] });
  return out;
}

/** The row a roster key opens (a folded reviewer-only key opens its agent's row). */
export function rowForKey<T extends { keys: string[] }>(rows: readonly T[], key: string): T | undefined {
  return rows.find((r) => r.keys.includes(key));
}

// ── the row ────────────────────────────────────────────────────────────────────────────────

const RANK: Record<IssueSeverity, number> = { problem: 0, warning: 1, note: 2 };

export function sortIssues(issues: AgentIssue[]): AgentIssue[] {
  return [...issues].sort((a, z) => RANK[a.severity] - RANK[z.severity] || Number(z.safety) - Number(a.safety));
}

function ago(iso: string | null | undefined, now: number): string | null {
  if (typeof iso !== 'string') return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? relTime(t, now) : null;
}

function rowOf(seat: RosterSeat, alsoReviews: boolean, keys: string[], inp: AgentsInputs, folded: readonly RosterSeat[] = []): AgentRow {
  const { record, now } = inp;
  const name = seatLabel(seat);
  const auth = authOf(seat);
  const signedOut = auth === 'signed_out';
  const optIn = seat.optIn === true;
  const check = bag(seat)['login_check'];
  // crew#1006: a container seat's sign-in is crew's credential broker's reading, not the CLI's own check.
  const container = seat.sign_in === 'container';
  // The row's readiness is its own seat's bench; a folded reviewer's bench only takes away reviews (below), and
  // its issue carries its own facts in `params` (codex S4 r4 adjudicated over r3).
  const bench = benchOf(seat);

  // Sign-in
  let sign: Cell;
  if (auth === 'not_required') sign = { word: 'No sign-in needed', tone: 'ok', sub: 'free models' };
  else if (signedOut) sign = { word: 'Signed out', tone: 'fail', sub: ago(seat.probed_at as string | undefined, now) !== null ? `checked ${ago(seat.probed_at as string, now)}` : null };
  else if (auth === 'signed_in') {
    sign = container ? { word: 'Signed in', tone: 'ok', sub: 'kept by studio’s service' } : check === 'live'
      ? { word: 'Signed in', tone: 'ok', sub: ago(seat.probed_at as string | undefined, now) !== null ? `confirmed ${ago(seat.probed_at as string, now)}` : null }
      : { word: 'Looks signed in', tone: 'quiet', sub: check === 'status' ? 'its own check says so' : 'it has no way to confirm' };
  } else sign = { word: 'Unknown', tone: 'quiet', sub: 'studio couldn’t read its sign-in' };

  // Safety checks (per where the work runs)
  const ver = versionOf(seat);
  const unproven = ver?.status === 'unproven';
  let safe: Cell;
  const bound = seat.governance_mode?.scoped_bound;
  if (seat.governance_mode === undefined) safe = { word: 'Not reported', tone: 'quiet', sub: null };
  else {
    const u = strength(seat, 'unscoped');
    const bs = strength(seat, 'scoped_bound');
    if (u === 3 && bs === 3) safe = { word: 'Every action checked', tone: 'ok', sub: 'each step asks first' };
    else if (u >= 2 && bs >= 2) safe = { word: 'Writes kept in its sandbox', tone: 'ok', sub: 'in chats and jobs' };
    else if (bs >= 2) safe = { word: 'Writes kept in the repository', tone: 'gate', sub: 'only when the work is in one repository' };
    else if (bound?.mode === 'os_sandbox' && bound.source === 'repo_boundary') safe = { word: 'Not checked', tone: 'fail', sub: 'no sandbox on this computer' };
    else safe = { word: 'Not checked', tone: 'fail', sub: unproven ? 'on this version' : null };
  }

  // How it's governed (the tab's words for the same reading)
  const governed: Cell = safe.word === 'Every action checked' ? { word: 'Every action checked', tone: 'ok', sub: null }
    : safe.word === 'Writes kept in its sandbox' ? { word: 'Sandbox floor only', tone: 'quiet', sub: 'writes stay in its sandbox; steps aren’t checked' }
      : safe.word === 'Writes kept in the repository' ? { word: 'Repository boundary only', tone: 'gate', sub: 'writes stay in the repository, only in one-repository work' }
        : safe.word === 'Not checked' ? { word: 'Not checked', tone: 'fail', sub: safe.sub }
          : { word: safe.word, tone: 'quiet', sub: null };

  // Version
  let version: Cell;
  if (ver === null || ver.installed === null) version = ver !== null && ver.status === 'unproven' ? { word: 'Not found', tone: 'gate', sub: 'it didn’t answer when asked' } : { word: 'Not reported', tone: 'quiet', sub: null };
  else if (ver.status === 'unproven') version = { word: bareVersion(ver.installed), tone: 'gate', sub: ver.silent ? 'its version check didn’t answer' : `not approved yet${ver.proven !== null ? ` (approved: ${bareVersion(ver.proven)})` : ''}` };
  else version = { word: bareVersion(ver.installed), tone: 'quiet', sub: ver.status === 'proven' ? 'approved build' : null };

  // Can do (a folded reviewer shares this row's sign-in, so its seats count for the row)
  // An active bench (its own, or a folded reviewer's) takes the seat out of reviews and quality checks too (codex S4 r2).
  const free = (x: RosterSeat): boolean => x.council_eligible !== false && benchOf(x) === null;
  const reviews = !signedOut && !optIn && (free(seat) || folded.some(free));
  const qes = [seat, ...folded].map((x) => ({ q: qeReviewerOf(x), benched: benchOf(x) !== null })).filter((x) => x.q !== null);
  const qe = qes.length === 0 ? null : !signedOut && qes.some((x) => x.q!.ok && !x.benched);

  // Week
  const rec = record?.seats.find((s) => s.cli === seat.key);
  const week = record === undefined ? null : { units: rec?.units ?? 0 };
  const benched = worktreeBenched(seat);
  const refused = repoRefused(seat);

  // Ready for work
  let ready: Cell;
  if (signedOut) ready = { word: 'Not ready', tone: 'fail', sub: 'sign in first' };
  else if (auth === 'unknown') ready = { word: 'Can’t tell', tone: 'quiet', sub: 'its sign-in couldn’t be read' };
  else if (optIn && unproven) ready = { word: 'Not recommended', tone: 'gate', sub: ver?.installed == null ? 'studio couldn’t read its version' : ver.silent ? 'its safety checks are off for now' : 'this version isn’t approved yet' };
  else if (bench !== null) ready = { word: benchWord(bench), tone: 'gate', sub: benchRetry(bench) };
  else if (seat.council_eligible === false && !optIn) ready = { word: 'Not available', tone: 'gate', sub: 'see what’s happening' };
  // Limits come before the opt-in word (codex PR r2 P1): an opt-in agent with a known limit says the limit.
  else if (benched || refused) ready = { word: 'Ready, except repository jobs', tone: 'gate', sub: 'chats and reviews only' };
  else if (optIn) ready = { word: 'Ready if you pick it', tone: 'quiet', sub: null };
  else ready = { word: 'Ready', tone: 'ok', sub: week !== null && week.units > 0 ? `worked ${week.units} ${week.units === 1 ? 'step' : 'steps'} this week` : null };

  // Issues: crew's codes (its own and a folded reviewer's, once per code), then studio's GAPS.
  const issues: AgentIssue[] = [];
  // NOT A GAP, A MISREAD (crew#1006): crew codes live_check_failed for every signed-in seat whose check is
  // `status`, and a container seat's check is always the broker's `status`, so no request ever failed. Read
  // per seat (codex r3: a folded host reviewer keeps its own real one). Delete once crew stops coding it.
  const misread = (x: RosterSeat, code: string): boolean => code === 'live_check_failed' && x.sign_in === 'container';
  for (const i of [seat, ...folded].flatMap((x) => wireIssuesOf(x).filter((w) => !misread(x, w.code)).map((w) => ({ ...fromWire(w), bench: benchOf(x) })))) {
    const at = issues.findIndex((x) => x.code === i.code && x.wire === i.wire);
    if (at < 0) issues.push(i);
    // The same code from a folded seat keeps the more severe reading (codex S4 r1).
    else if (RANK[i.severity] < RANK[issues[at]!.severity]) issues[at] = i;
  }
  const has = (...codes: IssueCode[]): boolean => issues.some((i) => codes.includes(i.code));
  // GAP: crew codes no issue for an unread sign-in (codex real-data P1: never "Nothing to fix").
  if (auth === 'unknown' && !has('signed_out')) issues.push({ code: 'auth_unknown', severity: 'warning', safety: false });
  // GAP (constant above): until work_admission is on the wire, crew sends no codex_worktree.
  if (!signedOut && benched && !has('codex_worktree')) issues.push({ code: 'codex_worktree', severity: 'warning', safety: false });
  if (!signedOut && refused) issues.push({ code: 'repo_refused', severity: 'warning', safety: false });
  // GAP: crew codes no issue when it predicts no work for another reason (council_ineligible_reason says why).
  if (!signedOut && auth !== 'unknown' && seat.council_eligible === false && !optIn && bench === null && !has('quota', 'usage_limit', 'benched')) {
    issues.push({ code: 'not_admitted', severity: 'warning', safety: false });
  }
  // GAP: crew does not code live-session fallbacks; they come from diagnostics.
  const acpRaw = inp.acpByCli?.[seat.key];
  const acp = acpRaw === undefined ? null : { fallbacks: acpRaw.fallbacks, sessions: acpRaw.sessionsStarted, kinds: acpRaw.fallbackKinds };
  if (acp !== null && acp.fallbacks >= 3 && acp.fallbacks > acp.sessions / 2) issues.push({ code: 'fallbacks', severity: 'note', safety: false });

  const account = accountOf(seat);
  const usable = !signedOut && (auth === 'signed_in' || auth === 'not_required') && seat.council_eligible !== false && bench === null;
  const stored = inp.defaults;
  const picked = stored !== null ? stored.includes(seat.key) : seat.enabled_for_council && !optIn;
  const evidence = [str(seat.auth_evidence), str(seat.login_note)].filter((x): x is string => x !== null).map(maskIds).join('\n') || null;

  return {
    key: seat.key, keys, name, binary: seat.binary, seat, optIn, picked, alsoReviews,
    ready, sign, safe, governed, account, usable, repoWork: !benched && !refused, version, reviews, qe, bench, issues: sortIssues(issues),
    login: str(seat.login_invocation), logout: str(seat.logout_invocation),
    week, acp,
    tech: { disclosure: ver?.disclosure ?? null, ineligible: str(seat.council_ineligible_reason), evidence },
  };
}

/** Every agent's row, in roster order (a reviewer-only seat with the same sign-in folds into its agent's row). */
export function agentRows(inp: AgentsInputs): AgentRow[] {
  return foldReviewers(displaySeats([...inp.roster])).map(({ seat, alsoReviews, keys }) =>
    rowOf(seat, alsoReviews, keys, inp, inp.roster.filter((s) => s.key !== seat.key && keys.includes(s.key))));
}

export function countOf(row: AgentRow, severity: IssueSeverity): number {
  return row.issues.filter((i) => i.severity === severity).length;
}

/** The row's one fix button: "Fix 2 problems" / "See 1 warning" / "See 3 notes", or null when nothing. */
export function fixLabel(row: AgentRow): { label: string; tone: 'fail' | 'gate' | 'quiet' } | null {
  const p = countOf(row, 'problem'), w = countOf(row, 'warning'), n = countOf(row, 'note');
  const plural = (c: number, word: string): string => `${c} ${word}${c === 1 ? '' : 's'}`;
  if (p > 0) return { label: `Fix ${plural(p, 'problem')}`, tone: 'fail' };
  if (w > 0) return { label: `See ${plural(w, 'warning')}`, tone: 'gate' };
  if (n > 0) return { label: `See ${plural(n, 'note')}`, tone: 'quiet' };
  return null;
}

/** "2 problems · 1 note, most important first" (the modal's line under the title). */
export function countWords(row: AgentRow): string {
  const parts = (['problem', 'warning', 'note'] as const)
    .map((s) => [countOf(row, s), s] as const)
    .filter(([c]) => c > 0)
    .map(([c, s]) => `${c} ${s}${c === 1 ? '' : 's'}`);
  return parts.length === 0 ? 'Nothing to fix.' : `${parts.join(' · ')}${row.issues.length > 1 ? ', most important first' : ''}`;
}

/** Agents with a problem or a warning (Q6: notes stay in the row). The rail's Agents dot. */
export function attention(rows: readonly AgentRow[]): { count: number; tone: 'fail' | 'gate' | null } {
  const needs = rows.filter((r) => r.issues.some((i) => i.severity !== 'note'));
  const fail = needs.some((r) => r.issues.some((i) => i.severity === 'problem'));
  return { count: needs.length, tone: needs.length === 0 ? null : fail ? 'fail' : 'gate' };
}

/** The agents signed in (or needing no sign-in) that new work can use now — named in "use another agent". */
export function otherReady(rows: readonly AgentRow[], except: string): AgentRow[] {
  return rows.filter((r) => r.key !== except && !r.optIn && r.ready.tone === 'ok');
}

/** Whether any agent can run quality checks now; `null` when crew does not report it. */
export function qeAvailable(rows: readonly AgentRow[]): boolean | null {
  const reporting = rows.filter((r) => r.qe !== null);
  if (reporting.length === 0) return null;
  return reporting.some((r) => r.qe === true);
}
