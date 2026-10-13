import type { DiagnosticsSeatGovernance, GovernanceScopeKind, RosterSeat, SeatGovernanceMode, SeatRecordResponse } from '../api/types.js';
import { homeDirsIn } from './homePath.js';
import { relTime } from './relTime.js';
import { displaySeats, isReviewerOnly, seatLabel } from './seatNames.js';

/**
 * THE AGENTS PAGE MODEL (DES-seats-page §3–§4): one row per AI agent, in plain words, and the coded
 * issues its modal explains. Pure: the page, the rail's Agents dot and the issue modal all read it,
 * so a row, the count and the modal can never disagree.
 *
 * Inputs are today's wire (crew 0.10): `GET /roster`, `GET /diagnostics` (host boundary, transport,
 * ACP fallbacks) and `GET /roster/record?days=7` (the week's benches). Crew's coming fields are read
 * tolerantly when present — `qe_reviewer` (A4), `work_admission` (A5), `version` (A1) — and never
 * guessed when absent: quality checks then read "Not reported".
 *
 * Studio owns every word. Crew free text (`disclosure`, `council_ineligible_reason`) only ever
 * reaches Technical details; `auth_evidence` and `login_note` are never read here (§4.3, until A8).
 */

export type Tone = 'ok' | 'gate' | 'fail' | 'quiet';
export type IssueSeverity = 'problem' | 'warning' | 'note';

/** The issue codes studio has copy for (§4.1). */
export type IssueCode =
  | 'signed_out'
  | 'auth_unknown'
  | 'qe_blocked'
  | 'not_admitted'
  | 'codex_worktree'
  | 'repo_refused'
  | 'no_host_boundary'
  | 'boundary_unknown'
  | 'fence_scoped'
  | 'version_unproven'
  | 'quota'
  | 'opt_in'
  | 'no_qe'
  | 'unverified'
  | 'fallbacks';

export interface AgentIssue {
  code: IssueCode;
  severity: IssueSeverity;
  /** Safety before availability within a severity (codex HIER r7). */
  safety: boolean;
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
  version: Cell;
  /** `null` when diagnostics could not be read (the column is hidden behind a partial banner). */
  transport: Cell | null;
  reviews: boolean;
  /** `null` = crew does not report quality-check eligibility yet ("Not reported"). */
  qe: boolean | null;
  issues: AgentIssue[];
  /** The exact `login_invocation` / `logout_invocation` (copied verbatim), when crew sent one. */
  login: string | null;
  logout: string | null;
  /** Week numbers the copy quotes. */
  week: { units: number; quotaRuns: number } | null;
  acp: { fallbacks: number; sessions: number; kinds: Record<string, number> } | null;
  /** Crew-authored sentences shown ONLY inside Technical details. */
  tech: { disclosure: string | null; ineligible: string | null };
}

export interface AgentsInputs {
  roster: readonly RosterSeat[];
  /** `undefined` = not answered (failed or absent): every repository-boundary claim then reads "Not checked". */
  governance?: DiagnosticsSeatGovernance | undefined;
  /** `undefined` = not answered: the ACP fold is unknown. */
  acpByCli?: Record<string, { sessionsStarted: number; fallbacks: number; fallbackKinds: Record<string, number> }> | undefined;
  /** `undefined` = not answered: no week numbers, no quota inference. */
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

/** `qe_reviewer` (crew ask A4), when crew sends it. */
export function qeReviewerOf(seat: RosterSeat): { ok: boolean; reason_code: string | null } | null {
  const v = bag(seat)['qe_reviewer'];
  if (v === null || typeof v !== 'object') return null;
  const ok = (v as Record<string, unknown>)['ok'];
  if (typeof ok !== 'boolean') return null;
  return { ok, reason_code: str((v as Record<string, unknown>)['reason_code']) };
}

/** `work_admission[scope]` (crew ask A5), when crew sends it. */
export function workAdmissionOf(seat: RosterSeat, scope: GovernanceScopeKind): { ok: boolean; reason_code: string | null; source: string | null } | null {
  const w = bag(seat)['work_admission'];
  if (w === null || typeof w !== 'object') return null;
  const e = (w as Record<string, unknown>)[scope];
  if (e === null || typeof e !== 'object') return null;
  const ok = (e as Record<string, unknown>)['ok'];
  if (typeof ok !== 'boolean') return null;
  return { ok, reason_code: str((e as Record<string, unknown>)['reason_code']), source: str((e as Record<string, unknown>)['source']) };
}

/**
 * STUDIO CONSTANT — DELETE IN S4 (when crew's `work_admission`, ask A5, is on the pinned wire).
 * The engine benches Codex on every run bound to one repository (wicked-core `distribute.rs`
 * CODEX_WORKTREE_BENCH; core#912 closed "keep the bench"), while the roster's `chat_admission`
 * says it is admitted. Read only when the seat carries no `work_admission`.
 */
const WORKTREE_BENCHED_KEYS: readonly string[] = ['codex'];

/** Whether the engine keeps this agent off repository-bound jobs. */
export function worktreeBenched(seat: RosterSeat): boolean {
  // The constant applies only when the seat carries no work_admission at all (codex PR r2 P2).
  if (bag(seat)['work_admission'] !== undefined) {
    const wa = workAdmissionOf(seat, 'scoped_bound');
    // Crew's code for the engine's codex bench is `worktree_bench`; other launcher refusals stay repo_refused (codex PR r3).
    return wa !== null && !wa.ok && /worktree/i.test(wa.reason_code ?? '');
  }
  return WORKTREE_BENCHED_KEYS.includes(seat.key);
}

/** Crew refuses repository work for another reason than sign-in or the worktree bench (codex PR r1 P1). */
export function repoRefused(seat: RosterSeat): boolean {
  const wa = workAdmissionOf(seat, 'scoped_bound');
  return wa !== null && !wa.ok && wa.source !== 'auth' && !worktreeBenched(seat);
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
export function agentTiles(rows: readonly AgentRow[]): { ready: number; limited: number; notRecommended: number; unknown: number; total: number; signedOut: number; everyAction: number; floorOnly: number; boundaryOnly: number; fixes: number; notes: number } {
  const count = (f: (r: AgentRow) => boolean): number => rows.filter(f).length;
  return {
    // codex P1: "ready" counts only agents whose row says Ready (or Ready if you pick it); the rest that can work are "with limits".
    ready: count((r) => r.usable && (r.ready.tone === 'ok' || r.ready.word === 'Ready if you pick it')),
    limited: count((r) => r.usable && !(r.ready.tone === 'ok' || r.ready.word === 'Ready if you pick it') && r.ready.word !== 'Not recommended'),
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
  return /\d+(?:\.\d+)+(?:[-+][\w.]+)?/.exec(v)?.[0] ?? v.trim();
}

interface VersionReading { installed: string | null; proven: string | null; status: 'proven' | 'unproven' | 'no_pin' | null; disclosure: string | null }

/** `version` (crew ask A1) when present, else the pinned seat's `version_pin`. */
export function versionOf(seat: RosterSeat): VersionReading | null {
  const v = bag(seat)['version'];
  if (v !== null && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const status = o['status'] === 'proven' || o['status'] === 'unproven' || o['status'] === 'no_pin' ? o['status'] : null;
    return { installed: str(o['installed']), proven: str(o['proven']), status, disclosure: seat.version_pin?.disclosure ?? null };
  }
  const p = seat.version_pin;
  if (p === undefined || p === null) return null;
  return { installed: p.observed, proven: p.pinned, status: p.matched ? 'proven' : 'unproven', disclosure: p.disclosure };
}

/**
 * THE ONE BOUNDARY PREDICATE (§3.1): does the seat's safety claim for `scope` actually hold on this
 * computer? A `repo_boundary` claim needs the host's OS launcher (`diagnostics.seatGovernance
 * .hostBoundary`); with none, or with diagnostics unread, it holds nothing. `self` (codex's own
 * `--sandbox`) and `seat_record` are the agent's or its record's claims and keep their words.
 */
export function boundaryHolds(seat: RosterSeat, scope: GovernanceScopeKind, governance: DiagnosticsSeatGovernance | undefined): boolean {
  const m = seat.governance_mode?.[scope];
  if (m === undefined) return false;
  if (m.mode === 'admitted') return true;
  if (m.mode !== 'os_sandbox') return false;
  if (m.source === 'repo_boundary') return governance !== undefined && governance.hostBoundary !== null && governance.hostBoundary !== '';
  return true;
}

function strength(seat: RosterSeat, scope: GovernanceScopeKind, gov: DiagnosticsSeatGovernance | undefined): 0 | 2 | 3 {
  const m: SeatGovernanceMode | undefined = seat.governance_mode?.[scope];
  if (m === undefined || !boundaryHolds(seat, scope, gov)) return 0;
  return m.mode === 'admitted' ? 3 : 2;
}

/** The fold of quota benches in the week (`benchReasons` keys naming a quota). */
function quotaRuns(record: SeatRecordResponse | undefined, key: string): number {
  const r = record?.seats.find((s) => s.cli === key);
  if (r === undefined) return 0;
  return Object.entries(r.benchReasons).filter(([k]) => /quota/i.test(k)).reduce((n, [, v]) => n + v, 0);
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

function rowOf(seat: RosterSeat, alsoReviews: boolean, keys: string[], inp: AgentsInputs, folded: readonly RosterSeat[] = []): Omit<AgentRow, 'issues'> & { issues: AgentIssue[] } {
  const { governance: gov, record, now } = inp;
  const b = bag(seat);
  const name = seatLabel(seat);
  const auth = authOf(seat);
  const signedOut = auth === 'signed_out';
  const optIn = seat.optIn === true;
  const check = b['login_check'];
  const issues: AgentIssue[] = [];

  // Sign-in
  let sign: Cell;
  if (auth === 'not_required') sign = { word: 'No sign-in needed', tone: 'ok', sub: 'free models' };
  else if (signedOut) sign = { word: 'Signed out', tone: 'fail', sub: ago(seat.probed_at as string | undefined, now) !== null ? `checked ${ago(seat.probed_at as string, now)}` : null };
  else if (auth === 'signed_in') {
    sign = check === 'live'
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
    const u = strength(seat, 'unscoped', gov);
    const bs = strength(seat, 'scoped_bound', gov);
    if (u === 3 && bs === 3) safe = { word: 'Every action checked', tone: 'ok', sub: 'each step asks first' };
    else if (u >= 2 && bs >= 2) safe = { word: 'Writes kept in its sandbox', tone: 'ok', sub: 'in chats and jobs' };
    else if (bs >= 2) safe = { word: 'Writes kept in the repository', tone: 'gate', sub: 'only when the work is in one repository' };
    // codex r4 P1: an unread host boundary is unknown, never a confirmed absence.
    else if (bound?.mode === 'os_sandbox' && bound.source === 'repo_boundary') safe = gov === undefined ? { word: 'Not checked', tone: 'fail', sub: 'couldn’t read this computer’s sandbox' } : { word: 'Not checked', tone: 'fail', sub: 'no sandbox on this computer' };
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
  else if (ver.status === 'unproven') version = { word: bareVersion(ver.installed), tone: 'gate', sub: `not approved yet${ver.proven !== null ? ` (approved: ${bareVersion(ver.proven)})` : ''}` };
  else version = { word: bareVersion(ver.installed), tone: 'quiet', sub: ver.status === 'proven' ? 'approved build' : null };

  // Can do
  // A folded reviewer shares this row's sign-in, so its review seat counts for the row (codex PR r4).
  const reviews = !signedOut && !optIn && (seat.council_eligible !== false || folded.some((f) => f.council_eligible !== false));
  const qeR = qeReviewerOf(seat);
  // A folded reviewer-only seat that can run quality checks counts for its row (codex PR r1 P2).
  const foldedQe = folded.some((f) => qeReviewerOf(f)?.ok === true) && !signedOut;
  const qe = qeR === null && !folded.some((f) => qeReviewerOf(f) !== null) ? null : (qeR?.ok === true && !signedOut) || foldedQe;

  // Week
  const rec = record?.seats.find((s) => s.cli === seat.key);
  const quota = quotaRuns(record, seat.key);
  const week = record === undefined ? null : { units: rec?.units ?? 0, quotaRuns: quota };
  const benched = worktreeBenched(seat);
  const refused = repoRefused(seat);

  // Ready for work
  let ready: Cell;
  if (signedOut) ready = { word: 'Not ready', tone: 'fail', sub: 'sign in first' };
  else if (auth === 'unknown') ready = { word: 'Can’t tell', tone: 'quiet', sub: 'its sign-in couldn’t be read' };
  else if (optIn && unproven) ready = { word: 'Not recommended', tone: 'gate', sub: ver?.installed == null ? 'studio couldn’t read its version' : 'this version isn’t approved yet' };
  else if (seat.council_eligible === false && !optIn) ready = { word: 'Not available', tone: 'gate', sub: 'see what’s happening' };
  // Limits come before the opt-in word (codex PR r2 P1): an opt-in agent with a known limit says the limit.
  else if (benched || refused) ready = { word: 'Ready, except repository jobs', tone: 'gate', sub: 'chats and reviews only' };
  else if (quota > 0) ready = { word: 'Quota unknown', tone: 'gate', sub: `ran out in ${quota} ${quota === 1 ? 'job' : 'jobs'} this week; studio can’t check it now` };
  else if (optIn) ready = { word: 'Ready if you pick it', tone: 'quiet', sub: null };
  else ready = { word: 'Ready', tone: 'ok', sub: week !== null && week.units > 0 ? `worked ${week.units} ${week.units === 1 ? 'step' : 'steps'} this week` : null };

  // Issues
  if (signedOut) issues.push({ code: 'signed_out', severity: 'problem', safety: false });
  // codex real-data P1: an unread sign-in is never "Nothing to fix".
  if (auth === 'unknown') issues.push({ code: 'auth_unknown', severity: 'warning', safety: false });
  if (!signedOut && auth !== 'unknown' && seat.council_eligible === false && !optIn) issues.push({ code: 'not_admitted', severity: 'warning', safety: false });
  if (!signedOut && benched) issues.push({ code: 'codex_worktree', severity: 'warning', safety: false });
  if (!signedOut && refused) issues.push({ code: 'repo_refused', severity: 'warning', safety: false });
  if (safe.word === 'Not checked' && safe.sub === 'no sandbox on this computer') issues.push({ code: 'no_host_boundary', severity: 'warning', safety: true });
  if (safe.word === 'Not checked' && safe.sub === 'couldn’t read this computer’s sandbox') issues.push({ code: 'boundary_unknown', severity: 'warning', safety: true });
  if (safe.word === 'Writes kept in the repository') issues.push({ code: 'fence_scoped', severity: 'warning', safety: true });
  if (unproven) issues.push({ code: 'version_unproven', severity: 'warning', safety: true });
  if (!signedOut && quota > 0) issues.push({ code: 'quota', severity: 'warning', safety: false });
  if (optIn) issues.push({ code: 'opt_in', severity: 'note', safety: false });
  if (qe === false && !signedOut && !optIn) issues.push({ code: 'no_qe', severity: 'note', safety: false });
  if (auth === 'signed_in' && check === 'unverified') issues.push({ code: 'unverified', severity: 'note', safety: false });
  const acpRaw = inp.acpByCli?.[seat.key];
  const acp = acpRaw === undefined ? null : { fallbacks: acpRaw.fallbacks, sessions: acpRaw.sessionsStarted, kinds: acpRaw.fallbackKinds };
  const frequent = acp !== null && acp.fallbacks >= 3 && acp.fallbacks > acp.sessions / 2;
  if (frequent) issues.push({ code: 'fallbacks', severity: 'note', safety: false });

  // How it runs
  const entry = gov?.seats.find((s) => s.cli === seat.key);
  const transport: Cell | null = gov === undefined ? null
    : entry === undefined ? { word: 'Not reported', tone: 'quiet', sub: null }
      : entry.transport === 'acp'
        ? { word: 'Keeps a live session', tone: 'quiet', sub: frequent ? 'if it can’t start one, studio starts a new one' : null }
        : { word: 'Starts fresh for each step', tone: 'quiet', sub: null };

  const account = accountOf(seat);
  const usable = !signedOut && (auth === 'signed_in' || auth === 'not_required') && seat.council_eligible !== false;
  const stored = inp.defaults;
  const picked = stored !== null ? stored.includes(seat.key) : seat.enabled_for_council && !optIn;

  return {
    key: seat.key, keys, name, binary: seat.binary, seat, optIn, picked, alsoReviews,
    ready, sign, safe, governed, account, usable, version, transport, reviews, qe, issues,
    login: str(seat.login_invocation), logout: str(seat.logout_invocation),
    week, acp,
    tech: { disclosure: ver?.disclosure ?? null, ineligible: str(seat.council_ineligible_reason) },
  };
}

/**
 * Every agent's row, in roster order. When crew reports quality-check eligibility and no agent can
 * run them, each signed-out agent whose sign-in would restore them carries `qe_blocked`.
 */
export function agentRows(inp: AgentsInputs): AgentRow[] {
  const rows = foldReviewers(displaySeats([...inp.roster])).map(({ seat, alsoReviews, keys }) =>
    rowOf(seat, alsoReviews, keys, inp, inp.roster.filter((s) => s.key !== seat.key && keys.includes(s.key))));
  // From the rows' aggregate qe (folded reviewers included, codex PR r2 P2).
  if (qeAvailable(rows) === false) {
    for (const r of rows) {
      // Any seat the row stands for (a folded reviewer too) whose sign-in would restore quality checks.
      const restores = inp.roster.filter((s) => r.keys.includes(s.key)).some((s) => {
        const q = qeReviewerOf(s);
        return q !== null && authOf(s) === 'signed_out' && (q.ok || q.reason_code === 'signed_out');
      });
      if (restores) {
        r.issues.push({ code: 'qe_blocked', severity: 'problem', safety: false });
      }
    }
  }
  return rows.map((r) => ({ ...r, issues: sortIssues(r.issues) }));
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
