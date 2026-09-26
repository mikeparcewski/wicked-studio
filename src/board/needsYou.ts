import type { Campaign } from '../api/campaigns.js';
import { memoryPayload, policyPayload, policySteeringType, proposalKind, type Proposal } from '../api/proposals.js';
import type { RepoEntry, SessionView } from '../api/types.js';
import { deliveryOf } from '../components/delivery.js';
import { narrate, narrateStranded, type NarrationTone } from '../components/narrator.js';
import type { RetryPrefill } from '../store/retryPrefill.js';
import { campaignCounts, campaignMemberRunIds } from './campaignStats.js';
import { STALLED_IDLE_SECS, stalledLiveChats, type LiveChatSnapshot } from './chatStats.js';
import { gateOpenPath } from './gateActions.js';
import { outcomeOf, runStats } from './metrics.js';
import { repoOnboard } from './repoStats.js';

/**
 * THE needs-you queue fold (DES-HOME-COMMAND-CENTER §3) — the home page's spine.
 * ONE aggregated, deduped list of everything across every section that is waiting
 * on a person, severity-ordered, each row carrying an act-in-place affordance.
 *
 * Pure in every input INCLUDING `now` (the boardAttention discipline), so order,
 * dedupe and the calm state are pinnable in unit tests. THE CONTRADICTION GUARD
 * IS STRUCTURAL: the component renders calm copy iff THIS fold returns zero rows
 * — there is no second derivation that could disagree with the queue.
 *
 * Sources and their honest clocks:
 *  - gates        — every `awaiting_human` run (never windowed: a gate is a person
 *                   blocked); clock = the gate store's receivedAt, else attach.
 *  - failed runs  — `status === 'failed'`, unarchived, inside the newest-N
 *                   positional window (the "last 30" idiom every section KPI band
 *                   rides — the run wire carries no timestamps, so recency is
 *                   positional and the label says so); clock = the durable-log
 *                   tail (`failedAt`), else attach, else unknown.
 *  - stranded runs — completed runs the 0.18.0 wire marks `delivery: 'stranded'`
 *                   (crew#393): reviewable work sitting uncommitted in a live
 *                   worktree. Unwindowed like gates — the wire clears the state
 *                   itself once delivered or reaped; clock = attach, else unknown.
 *  - campaigns    — subtraction-dedupe (§3): a campaign row fires only for the
 *                   waiting/failed members the live run list CANNOT already show
 *                   as rows (server counts cover archived/rolled-off members).
 *  - repo graphs  — newest onboard failed, or no onboard on record: the fleet is
 *                   blind on that repo. A failed onboard RUN is suppressed from
 *                   the failed-run rows in favor of its repo row (the re-index
 *                   act is strictly more useful than a bare retry).
 *  - stalled chats — warm `GET /chats` sessions idle past the shared threshold
 *                   (`stalledLiveChats`, reused verbatim).
 *  - elicitations  — an MCP server inside a live run asked the operator a question
 *                   (`useElicitationStore`); clock = the frame's arrival.
 *  - steer requests — an agent asked for direction (`agentMessage`, the bell's
 *                   unread `steer_requested` rows) on a run that is still live.
 *  - stall escalations — the watchdog's `workerStallEscalated` frame with
 *                   `needsYou: true`: automatic recovery is spent or refused.
 *                   It supersedes the board's own stalled-run row for that run.
 *  - proposals     — pending steering/memory proposals (`GET /proposals`).
 *
 * Ranking is ONE function, {@link compareNeeds} (studio wave 2b, "ranked by
 * consequence"): severity kind › waiting-age band › stakes › exact age › key.
 * Grouping alike simple items into one row lives in `needsQueue.ts`.
 */

export type NeedKind =
  | 'gate' | 'elicitation' | 'stall-escalated' | 'steer-request' | 'failed-run' | 'stalled-run'
  | 'stranded-run' | 'campaign' | 'repo-graph' | 'proposal' | 'stalled-chat';

/** Alike SIMPLE items the queue folds into one expandable row ("2 approvals"). */
export type NeedGroupKey = 'approval' | 'proposal';

/** The act-in-place affordance a row carries — the component wires the verbs. */
export type NeedAction =
  /** `ack`: notification ids the open acknowledges (a steer request is read once opened). */
  | { kind: 'open'; path: string; label: string; ack?: string[] }
  | { kind: 'retry-prefill'; prefill: RetryPrefill; label: string }
  | { kind: 'reindex-prefill'; prefill: RetryPrefill; repoId: string; label: string };

export interface NeedRow {
  /** Dedupe identity — one row per subject, ever. */
  key: string;
  kind: NeedKind;
  /** The consequence class — the ranking's first key (see {@link SEVERITY}). */
  severity: number;
  /** What rides on it, where the wire says: items affected, +1 when the run writes
   *  to a repo. The ranking's tie-break after the waiting-age band. */
  stakes: number;
  /** Set on alike SIMPLE items the queue may fold into one row (`needsQueue.ts`). */
  groupKey?: NeedGroupKey;
  /** A folded group's members, ranked — present only on a group row. */
  members?: NeedRow[];
  /** The row's subject (run title, repo name, campaign, chat id). */
  subject: string;
  /** The narrated one-liner (narrator vocabulary — gate rows via `narrate()`). */
  text: string;
  tone: NarrationTone;
  /** The honest clock, or null when no wire carries one ("age unknown"). */
  at: number | null;
  /** Where the row's body links (the subject's own surface). */
  subjectPath: string;
  action: NeedAction;
}

/** The failed-run recency window — the sections' "last 30" positional idiom. */
export const FAILED_WINDOW = 30;

/** The failed-run row's dedupe key — shared with {@link newestFailedRun} so the
 *  row→run mapping can never drift from the fold's own spelling. */
const FAILED_KEY = (id: string): string => `fail:${id}`;

/**
 * The consequence class of each kind — the ranking's FIRST key. Blocked-on-you
 * (work has stopped until a person acts) › broke › at risk › ambient.
 */
export const SEVERITY: Record<NeedKind, number> = {
  gate: 100,
  // An MCP server mid-run asked a question: the run is blocked on the answer.
  elicitation: 96,
  // The watchdog spent (or refused) its automatic recoveries: only a human can move it.
  'stall-escalated': 94,
  // The agent asked for direction; it may keep going without it, so below a hard block.
  'steer-request': 92,
  'failed-run': 70,
  // Below a failure (nothing broke) but above the ambient rows: finished,
  // reviewable work sitting invisible in a worktree IS a person's job (crew#393).
  'stranded-run': 65,
  // A live run gone silent past the stall threshold (wave 1 round 2) — the board's
  // `isStalled` verdict; the operator checks on it (open the run, its Term, inject).
  'stalled-run': 62,
  campaign: 60,
  'repo-graph': 50, // 'never' drops to 30 below
  // Governed knowledge waiting on review — nothing is blocked, but nothing lands without you.
  proposal: 40,
  'stalled-chat': 25,
};

/** Waiting-age bands, oldest first: a day, 4 h, 1 h, 15 min. Coarse on purpose, so
 *  stakes can order items that have waited about as long. */
const AGE_BANDS_MS = [24 * 3_600_000, 4 * 3_600_000, 3_600_000, 15 * 60_000] as const;

function ageBand(at: number | null, now: number): number {
  if (at === null) return -1;
  const waited = now - at;
  const i = AGE_BANDS_MS.findIndex((t) => waited >= t);
  return i < 0 ? 0 : AGE_BANDS_MS.length - i;
}

/**
 * THE ranking (studio wave 2b — "one queue ranked by consequence"). One function,
 * total and deterministic:
 *
 *  1. severity — the consequence class of the kind ({@link SEVERITY});
 *  2. waiting age, in coarse bands — the longer something has waited on a person,
 *     the more it costs (no deadline field exists on any wire yet; when one does,
 *     it slots in here). A clockless row sorts after every clocked row of its class;
 *  3. stakes — what rides on it, where the data exists (items affected, repo writes);
 *  4. exact age, oldest first; 5. key.
 */
export function compareNeeds(a: NeedRow, b: NeedRow, now: number): number {
  return (
    b.severity - a.severity
    || Number(a.at === null) - Number(b.at === null)
    || ageBand(b.at, now) - ageBand(a.at, now)
    || b.stakes - a.stakes
    || (a.at ?? 0) - (b.at ?? 0)
    || a.key.localeCompare(b.key)
  );
}

/** Rank rows in place of any other order — the one sort every queue surface uses. */
export function rankNeeds<T extends NeedRow>(rows: T[], now: number): T[] {
  return rows.sort((a, b) => compareNeeds(a, b, now));
}

/** +1 stakes when the run writes to a repo (a repo-scoped run's work lands in code). */
const repoStake = (v: SessionView): number => (v.session.repo_ref != null ? 1 : 0);

/** The slice of the gate store a row needs (full `OpenGate` satisfies it). */
export interface GateLite {
  prompt: string;
  receivedAt: number;
  ord: number;
  /** The gate store's answer shape — `null` = free text (complex); see `isSimpleGate`. */
  choices?: string[] | null;
}

/** A gate is SIMPLE iff it offers ≤2 answers and needs no free text — the gate
 *  store's `isSimpleGate` rule, restated over the lite shape (no cached gate = simple). */
function simpleGate(gate: GateLite | undefined): boolean {
  if (gate === undefined) return true;
  if (gate.choices === null) return false;
  return (gate.choices ?? ['approve', 'reject']).length <= 2;
}

/** An open MCP elicitation (the elicitation store's slice). */
export interface ElicitationLite {
  message: string;
  /** ISO arrival stamp (the store's spelling) or epoch ms. */
  receivedAt: string | number;
}

/** An unread steer request (the notification store's `steer_requested` row). */
export interface SteerRequestLite {
  id: string;
  runId: string;
  message: string;
  ts: number;
}

/** The watchdog's `workerStallEscalated` frame, kept while it says a human is needed. */
export interface StallEscalationLite {
  at: number;
  quietForMs: number | null;
  action: string | null;
  outcome: string | null;
  cli: string | null;
  previousCli: string | null;
}

export interface NeedsYouInputs {
  /** The one salience-ordered run list (daemon order — newest/actionable first). */
  runs: SessionView[];
  gates: Record<string, GateLite>;
  /** Durable-log failure tails (useBoardModel's backfill). */
  failedAt: Record<string, number>;
  /** Membership attach clocks, merged across projects. */
  attachedAt: Record<string, number>;
  /** run id → project id (the membership mirror) — gate deep-links ride it. */
  projectIds: Record<string, string>;
  /** `GET /chats` snapshot; empty when the wire is absent — absence adds no rows. */
  chats: readonly LiveChatSnapshot[];
  repos: readonly RepoEntry[];
  /** `GET /campaigns` snapshot; empty when unsupported. */
  campaigns: readonly Campaign[];
  /** Live runs gone silent past the stall threshold (run id → last evidence) — the
   *  board model's `stalledAt`; absent = no stall evidence held. */
  stalledAt?: Record<string, number>;
  /** Open MCP elicitations keyed by run id (absent = none held). */
  elicitations?: Record<string, ElicitationLite>;
  /** Unread steer requests (absent = none). */
  steerRequests?: readonly SteerRequestLite[];
  /** Watchdog escalations that need a human, keyed by run id. */
  stallEscalations?: Record<string, StallEscalationLite>;
  /** Pending governed-knowledge proposals (`GET /proposals?state=pending`); empty when unsupported. */
  proposals?: readonly Proposal[];
  now: number;
}

/** The narrator's ctx for frames the queue synthesizes (no unit vocabulary here). */
const QUEUE_CTX = { phaseOf: () => 'this phase', intent: null };

/** Retry-as-prefill payload for a failed run — the standing §4.3 idiom, verbatim. */
export function retryPrefillOf(v: SessionView): RetryPrefill {
  const s = v.session;
  return {
    retryOf: s.id,
    problem: s.problem,
    clis: s.clis,
    workflowId: s.workflow_id || null,
    repoRef: s.repo_ref,
    entityMode: s.entity_mode,
    humanConfirm: s.human_confirm,
    projectId: typeof s.project_id === 'string' ? s.project_id : null,
  };
}

/** "2h" / "45m" — how long a stalled run has been silent. */
function silentWord(ms: number): string {
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min}m`;
  return min % 60 === 0 ? `${min / 60}h` : `${Math.floor(min / 60)}h ${min % 60}m`;
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** A run's own surface: its project's Build view when filed, else the flat run route. */
function runOpenPath(runId: string, projectId: string | undefined): string {
  return projectId !== undefined
    ? `/p/${encodeURIComponent(projectId)}/build/${encodeURIComponent(runId)}`
    : `/runs/${encodeURIComponent(runId)}`;
}

/** The daemon's own terminal clock (`ended_at`, unix SECONDS) in ms, when the wire carries it. */
export function endedAtMs(v: SessionView): number | null {
  const t = v.session.ended_at;
  return typeof t === 'number' ? t * 1000 : null;
}

const TERMINAL_STATUSES: ReadonlySet<string> = new Set(['completed', 'failed', 'cancelled']);

/** One-line clip for a queue line. */
const clipLine = (t: string, n = 120): string => {
  const one = t.replace(/\s+/g, ' ').trim();
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
};

export function needsYouRows(inputs: NeedsYouInputs): NeedRow[] {
  const { runs, gates, failedAt, attachedAt, projectIds, chats, repos, campaigns, now } = inputs;
  const stalledAt = inputs.stalledAt ?? {};
  const escalations = inputs.stallEscalations ?? {};
  const rows: NeedRow[] = [];
  const live = runs.filter((v) => v.session.archived_at == null);

  // ── Repo graph rows FIRST: their onboard-run ids suppress failed-run twins ──
  const suppressed = new Set<string>();
  for (const repo of repos) {
    const mine = live.filter((v) => v.session.repo_ref === repo.id);
    const onboard = repoOnboard(mine, repo.id);
    if (onboard.state === 'failed' && onboard.run !== null) {
      const runId = onboard.run.session.id;
      suppressed.add(runId);
      rows.push({
        key: `repo:${repo.id}`,
        kind: 'repo-graph',
        severity: SEVERITY['repo-graph'],
        stakes: 1 + mine.length,
        subject: repo.name,
        text: 'Graph build failed — the fleet is blind on this repo',
        tone: 'fail',
        at: failedAt[runId] ?? attachedAt[runId] ?? null,
        subjectPath: `/repo-detail/${encodeURIComponent(repo.id)}`,
        action: {
          kind: 'reindex-prefill',
          prefill: { ...retryPrefillOf(onboard.run), repoRef: repo.id },
          repoId: repo.id,
          label: 'Re-index ›',
        },
      });
    } else if (onboard.state === 'never') {
      rows.push({
        key: `repo:${repo.id}`,
        kind: 'repo-graph',
        severity: 30,
        stakes: 1,
        subject: repo.name,
        text: 'Never indexed — no onboarding run on record',
        tone: 'gate',
        at: repo.registered_at ?? null,
        subjectPath: `/repo-detail/${encodeURIComponent(repo.id)}`,
        action: {
          kind: 'open',
          path: `/repo-detail/${encodeURIComponent(repo.id)}`,
          label: 'Open repo ›',
        },
      });
    }
  }

  // ── Gate + failed-run rows off the one run list ─────────────────────────────
  const shownRunIds = new Set<string>();
  const windowIds = new Set(live.slice(0, FAILED_WINDOW).map((v) => v.session.id));
  for (const v of live) {
    const s = v.session;
    if (s.status === 'awaiting_human') {
      const gate = gates[s.id];
      // The gate's own one-liner IS the narrator's awaitingHuman template —
      // one template layer, zero forks (a synthesized frame of the wire shape).
      const line = narrate(
        { type: 'awaitingHuman', session: s.id, ...(gate !== undefined ? { prompt: gate.prompt } : {}) },
        QUEUE_CTX,
      );
      const projectId = typeof s.project_id === 'string' ? s.project_id : projectIds[s.id];
      shownRunIds.add(s.id);
      rows.push({
        key: `gate:${s.id}`,
        kind: 'gate',
        severity: SEVERITY.gate,
        stakes: 1 + repoStake(v),
        ...(simpleGate(gate) ? { groupKey: 'approval' as const } : {}),
        subject: s.problem,
        text: line?.text ?? 'Gate: waiting on you',
        tone: 'gate',
        at: gate?.receivedAt ?? attachedAt[s.id] ?? null,
        subjectPath: `/runs/${encodeURIComponent(s.id)}`,
        action: {
          kind: 'open',
          path: projectId !== undefined ? gateOpenPath(projectId, s.id) : `/runs/${encodeURIComponent(s.id)}`,
          label: 'Open gate ›',
        },
      });
    } else if (s.status === 'failed' && windowIds.has(s.id) && !suppressed.has(s.id)) {
      shownRunIds.add(s.id);
      rows.push({
        key: FAILED_KEY(s.id),
        kind: 'failed-run',
        severity: SEVERITY['failed-run'],
        stakes: 1 + repoStake(v),
        subject: s.problem,
        text: 'Run failed',
        tone: 'fail',
        // The daemon's own terminal clock first (api-types 0.38 `ended_at`), then the
        // durable-log tail, then the attach clock.
        at: endedAtMs(v) ?? failedAt[s.id] ?? attachedAt[s.id] ?? null,
        subjectPath: `/runs/${encodeURIComponent(s.id)}`,
        action: { kind: 'retry-prefill', prefill: retryPrefillOf(v), label: 'Retry ›' },
      });
    } else if (escalations[s.id] !== undefined && !TERMINAL_STATUSES.has(s.status)) {
      // The watchdog's escalation supersedes the board's own stall verdict for the
      // run: it carries what was tried, and it says a human is needed.
      const esc = escalations[s.id]!;
      const line = narrate(
        {
          type: 'workerStallEscalated', session: s.id, needsYou: true,
          ...(esc.quietForMs !== null ? { quietForMs: esc.quietForMs } : {}),
          ...(esc.action !== null ? { action: esc.action } : {}),
          ...(esc.outcome !== null ? { outcome: esc.outcome } : {}),
          ...(esc.cli !== null ? { cli: esc.cli } : {}),
          ...(esc.previousCli !== null ? { previousCli: esc.previousCli } : {}),
        },
        QUEUE_CTX,
      );
      const projectId = typeof s.project_id === 'string' ? s.project_id : projectIds[s.id];
      shownRunIds.add(s.id);
      rows.push({
        key: `stall-esc:${s.id}`,
        kind: 'stall-escalated',
        severity: SEVERITY['stall-escalated'],
        stakes: 1 + repoStake(v),
        subject: s.problem,
        text: line?.text ?? 'Needs you — the watchdog could not recover this run',
        tone: 'gate',
        at: esc.at,
        subjectPath: runOpenPath(s.id, projectId),
        action: { kind: 'open', path: runOpenPath(s.id, projectId), label: 'Check run ›' },
      });
    } else if (stalledAt[s.id] !== undefined) {
      shownRunIds.add(s.id);
      const silent = Math.max(0, now - stalledAt[s.id]!);
      rows.push({
        key: `stalled:${s.id}`,
        kind: 'stalled-run',
        severity: SEVERITY['stalled-run'],
        stakes: 1 + repoStake(v),
        subject: s.problem,
        text: `No activity for ${silentWord(silent)} — the run may be wedged`,
        tone: 'gate',
        at: stalledAt[s.id]!,
        subjectPath: `/runs/${encodeURIComponent(s.id)}`,
        action: { kind: 'open', path: `/runs/${encodeURIComponent(s.id)}`, label: 'Check run ›' },
      });
    } else if (s.status === 'completed' && deliveryOf(v).state === 'stranded') {
      // Stranded completed runs (crew#393): the daemon's OWN wire verdict — a
      // completed repo-scoped run with no recorded PR whose worktree still
      // exists. Reviewable work nobody lifted is a person's job, so it queues.
      // Deliberately UNWINDOWED, like gates and unlike failures: the state
      // clears itself the moment the run is delivered (or its worktree is
      // reaped, when the wire flips to 'none') — the row lives exactly as long
      // as the work sits there. Text via the narrator's one template source.
      const line = narrateStranded();
      shownRunIds.add(s.id);
      rows.push({
        key: `stranded:${s.id}`,
        kind: 'stranded-run',
        severity: SEVERITY['stranded-run'],
        stakes: 1 + repoStake(v),
        subject: s.problem,
        text: line.text,
        tone: line.tone,
        at: attachedAt[s.id] ?? null,
        subjectPath: `/runs/${encodeURIComponent(s.id)}`,
        // Open-in-place, never a POST from the queue (the fold's standing rule):
        // the run's Delivery card carries the one-click Deliver.
        action: { kind: 'open', path: `/runs/${encodeURIComponent(s.id)}`, label: 'Open run ›' },
      });
    }
  }

  // ── Campaign rows — subtraction-dedupe against the member rows above ───────
  const liveById = new Map(live.map((v) => [v.session.id, v]));
  for (const c of campaigns) {
    // Engine-persisted per-node statuses (campaignStats' fold — the same one the
    // Campaigns landing folds with, so the two surfaces cannot disagree).
    const n = campaignCounts(c);
    const troubled = n.awaitingHuman + n.failed;
    if (troubled === 0) continue;
    // Members the queue ALREADY shows (as gate or failed rows) subtract out.
    let covered = 0;
    for (const id of campaignMemberRunIds(c)) {
      if (!shownRunIds.has(id)) continue;
      const st = liveById.get(id)?.session.status;
      if (st === 'awaiting_human' || st === 'failed') covered += 1;
    }
    const surplus = troubled - covered;
    if (surplus <= 0) continue;
    const bits: string[] = [];
    if (n.awaitingHuman > 0) bits.push(`${n.awaitingHuman} waiting`);
    if (n.failed > 0) bits.push(`${plural(n.failed, 'run')} failed`);
    rows.push({
      key: `campaign:${c.id}`,
      kind: 'campaign',
      severity: SEVERITY.campaign,
      stakes: surplus,
      subject: c.def.name !== '' ? c.def.name : c.id,
      text: `Test gaps — ${bits.join(' · ')} (${surplus} beyond the list below)`,
      tone: n.awaitingHuman > 0 ? 'gate' : 'fail',
      // The engine campaign carries no clocks — age unknown, said honestly.
      at: null,
      subjectPath: `/testing/campaigns/${encodeURIComponent(c.id)}`,
      action: {
        kind: 'open',
        path: `/testing/campaigns/${encodeURIComponent(c.id)}`,
        label: 'Open test ›',
      },
    });
  }

  // ── Stalled live chats — the shared threshold, reused verbatim ──────────────
  for (const chat of stalledLiveChats(chats)) {
    const idle = chat.idleSecs ?? STALLED_IDLE_SECS;
    rows.push({
      key: `chat:${chat.chatId}`,
      kind: 'stalled-chat',
      severity: SEVERITY['stalled-chat'],
      stakes: chat.seats.length,
      subject: `Chat ${chat.chatId.slice(0, 8)}`,
      text: `Idle ${Math.round(idle / 60)}m — ${plural(chat.seats.length, 'warm seat')} waiting on a message`,
      tone: 'gate',
      at: now - idle * 1000,
      subjectPath: `/chat/${encodeURIComponent(chat.chatId)}`,
      action: { kind: 'open', path: `/chat/${encodeURIComponent(chat.chatId)}`, label: 'Open chat ›' },
    });
  }

  // ── Elicitations + steer requests — asks raised inside runs that are still live ──
  const liveRuns = new Map(
    live.filter((v) => !TERMINAL_STATUSES.has(v.session.status)).map((v) => [v.session.id, v]),
  );
  for (const [runId, e] of Object.entries(inputs.elicitations ?? {})) {
    const v = liveRuns.get(runId);
    if (v === undefined) continue; // a chat-keyed or finished run's prompt belongs elsewhere
    const projectId = typeof v.session.project_id === 'string' ? v.session.project_id : projectIds[runId];
    const at = typeof e.receivedAt === 'number' ? e.receivedAt : Date.parse(e.receivedAt);
    rows.push({
      key: `elicit:${runId}`,
      kind: 'elicitation',
      severity: SEVERITY.elicitation,
      stakes: 1 + repoStake(v),
      subject: v.session.problem,
      text: `Question: ${clipLine(e.message)}`,
      tone: 'gate',
      at: Number.isFinite(at) ? at : null,
      subjectPath: runOpenPath(runId, projectId),
      action: { kind: 'open', path: runOpenPath(runId, projectId), label: 'Answer ›' },
    });
  }
  // One row per run: the newest unread ask carries the line; opening acks them all.
  const steerByRun = new Map<string, SteerRequestLite[]>();
  for (const r of inputs.steerRequests ?? []) {
    if (!liveRuns.has(r.runId)) continue;
    steerByRun.set(r.runId, [...(steerByRun.get(r.runId) ?? []), r]);
  }
  for (const [runId, asks] of steerByRun) {
    const v = liveRuns.get(runId)!;
    const newest = asks.reduce((a, b) => (b.ts > a.ts ? b : a));
    const oldest = asks.reduce((a, b) => (b.ts < a.ts ? b : a));
    const projectId = typeof v.session.project_id === 'string' ? v.session.project_id : projectIds[runId];
    rows.push({
      key: `steer:${runId}`,
      kind: 'steer-request',
      severity: SEVERITY['steer-request'],
      stakes: asks.length + repoStake(v),
      subject: v.session.problem,
      text: `Agent asks for direction — ${clipLine(newest.message)}`,
      tone: 'gate',
      at: oldest.ts,
      subjectPath: runOpenPath(runId, projectId),
      action: { kind: 'open', path: runOpenPath(runId, projectId), label: 'Steer ›', ack: asks.map((a) => a.id) },
    });
  }

  // ── Pending proposals — each its own row, grouped by the queue when alike ────
  for (const p of inputs.proposals ?? []) {
    if (p.state !== 'pending') continue;
    const kind = proposalKind(p);
    const body = kind === 'memory' ? memoryPayload(p).content : kind === 'policy' ? policyPayload(p).rule : null;
    const typeWord = kind === 'policy' ? `Policy proposal${policySteeringType(p) !== null ? ` (${policySteeringType(p)})` : ''}` : kind === 'memory' ? 'Memory proposal' : 'Proposal';
    rows.push({
      key: `proposal:${p.id}`,
      kind: 'proposal',
      severity: SEVERITY.proposal,
      stakes: 1,
      groupKey: 'proposal',
      subject: body !== null && body !== '' ? clipLine(body, 80) : p.id,
      text: `${typeWord} — review to land it`,
      tone: 'gate',
      at: typeof p.created_at === 'number' ? p.created_at * 1000 : null,
      subjectPath: '/steering/dashboard',
      action: { kind: 'open', path: '/steering/dashboard', label: 'Review ›' },
    });
  }

  return rankNeeds(rows, now);
}

/**
 * The calm line — rendered ONLY when {@link needsYouRows} returned zero rows
 * (the structural guard: same fold, one branch). The count is live.
 */
export function calmCopy(runs: SessionView[]): string {
  const { working } = runStats(runs);
  return working > 0
    ? `Nothing needs you — ${plural(working, 'run')} working.`
    : 'Nothing needs you — nothing running right now.';
}

/** True when the portfolio has never seen work — the fresh-install welcome
 *  (verbs + Ask prominent, no fabricated zeros anywhere). */
export function isFreshInstall(projects: number, runs: SessionView[], repos: readonly RepoEntry[]): boolean {
  return projects === 0 && runs.length === 0 && repos.length === 0;
}

/**
 * The queue's NEWEST failed run — the failed-run row of {@link needsYouRows}
 * with the newest clock (the ranking itself puts the longest-waiting first),
 * mapped back to its SessionView. THE derivation the Ask quick-prompt seeds from (E1: the
 * campaign caught the chip seeding a 17-day-old failure): the home queue's own
 * ordering — durable failure tail, else attach clock — with its window and its
 * repo-onboard suppression included, never a second recency derivation.
 */
export function newestFailedRun(
  rows: readonly NeedRow[],
  runs: readonly SessionView[],
): SessionView | undefined {
  // The ranking puts the LONGEST-waiting failure first; the newest is the max clock
  // (a clockless row only when no failure carries one — absence stays last).
  let row: NeedRow | undefined;
  for (const r of rows) {
    if (r.kind !== 'failed-run') continue;
    if (row === undefined || (r.at !== null && (row.at === null || r.at > row.at))) row = r;
  }
  if (row === undefined) return undefined;
  return runs.find((v) => FAILED_KEY(v.session.id) === row.key);
}

/** The queue's oldest waiting clock — the KPI tile's context line. */
export function oldestNeedAt(rows: readonly NeedRow[]): number | null {
  let oldest: number | null = null;
  for (const r of rows) {
    if (r.at !== null && (oldest === null || r.at < oldest)) oldest = r.at;
  }
  return oldest;
}

/** Re-exported so the component and tests share the outcome partition. */
export { outcomeOf };
