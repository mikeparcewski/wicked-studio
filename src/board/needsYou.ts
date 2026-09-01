import type { CampaignSummary } from '../api/campaigns.js';
import type { RepoEntry, SessionView } from '../api/types.js';
import { deliveryOf } from '../components/delivery.js';
import { narrate, narrateStranded, type NarrationTone } from '../components/narrator.js';
import type { RetryPrefill } from '../store/retryPrefill.js';
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
 */

export type NeedKind =
  | 'gate' | 'failed-run' | 'stranded-run' | 'campaign' | 'repo-graph' | 'stalled-chat';

/** The act-in-place affordance a row carries — the component wires the verbs. */
export type NeedAction =
  | { kind: 'open'; path: string; label: string }
  | { kind: 'retry-prefill'; prefill: RetryPrefill; label: string }
  | { kind: 'reindex-prefill'; prefill: RetryPrefill; repoId: string; label: string };

export interface NeedRow {
  /** Dedupe identity — one row per subject, ever. */
  key: string;
  kind: NeedKind;
  /** Sort weight (gate 100 › failed 70 › campaign 60 › repo 50/30 › chat 25). */
  severity: number;
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

const SEVERITY: Record<NeedKind, number> = {
  gate: 100,
  'failed-run': 70,
  // Below a failure (nothing broke) but above the ambient rows: finished,
  // reviewable work sitting invisible in a worktree IS a person's job (crew#393).
  'stranded-run': 65,
  campaign: 60,
  'repo-graph': 50, // 'never' drops to 30 below
  'stalled-chat': 25,
};

/** The slice of the gate store a row needs (full `OpenGate` satisfies it). */
export interface GateLite {
  prompt: string;
  receivedAt: number;
  ord: number;
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
  campaigns: readonly CampaignSummary[];
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

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

export function needsYouRows(inputs: NeedsYouInputs): NeedRow[] {
  const { runs, gates, failedAt, attachedAt, projectIds, chats, repos, campaigns, now } = inputs;
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
        subject: s.problem,
        text: 'Run failed',
        tone: 'fail',
        at: failedAt[s.id] ?? attachedAt[s.id] ?? null,
        subjectPath: `/runs/${encodeURIComponent(s.id)}`,
        action: { kind: 'retry-prefill', prefill: retryPrefillOf(v), label: 'Retry ›' },
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
    const troubled = c.counts.awaitingHuman + c.counts.failed;
    if (troubled === 0) continue;
    // Members the queue ALREADY shows (as gate or failed rows) subtract out.
    let covered = 0;
    for (const id of c.runIds) {
      if (!shownRunIds.has(id)) continue;
      const st = liveById.get(id)?.session.status;
      if (st === 'awaiting_human' || st === 'failed') covered += 1;
    }
    const surplus = troubled - covered;
    if (surplus <= 0) continue;
    const bits: string[] = [];
    if (c.counts.awaitingHuman > 0) bits.push(`${c.counts.awaitingHuman} waiting`);
    if (c.counts.failed > 0) bits.push(`${plural(c.counts.failed, 'run')} failed`);
    rows.push({
      key: `campaign:${c.campaign.id}`,
      kind: 'campaign',
      severity: SEVERITY.campaign,
      subject: c.campaign.title ?? c.campaign.id,
      text: `Campaign gaps — ${bits.join(' · ')} (${surplus} beyond the list below)`,
      tone: c.counts.awaitingHuman > 0 ? 'gate' : 'fail',
      at: c.campaign.updated_at,
      subjectPath: `/testing/campaigns/${encodeURIComponent(c.campaign.id)}`,
      action: {
        kind: 'open',
        path: `/testing/campaigns/${encodeURIComponent(c.campaign.id)}`,
        label: 'Open campaign ›',
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
      subject: `Chat ${chat.chatId.slice(0, 8)}`,
      text: `Idle ${Math.round(idle / 60)}m — ${plural(chat.seats.length, 'warm seat')} waiting on a message`,
      tone: 'gate',
      at: now - idle * 1000,
      subjectPath: `/chat/${encodeURIComponent(chat.chatId)}`,
      action: { kind: 'open', path: `/chat/${encodeURIComponent(chat.chatId)}`, label: 'Open chat ›' },
    });
  }

  // Severity desc → newest first (clockless last in group — absence stays
  // absent) → key asc, so the order is total and deterministic.
  return rows.sort(
    (a, b) =>
      b.severity - a.severity
      || (b.at ?? -Infinity) - (a.at ?? -Infinity)
      || a.key.localeCompare(b.key),
  );
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
 * The queue's NEWEST failed run — the FIRST failed-run row of
 * {@link needsYouRows} (severity-ordered, newest-clock first), mapped back to
 * its SessionView. THE derivation the Ask quick-prompt seeds from (E1: the
 * campaign caught the chip seeding a 17-day-old failure): the home queue's own
 * ordering — durable failure tail, else attach clock — with its window and its
 * repo-onboard suppression included, never a second recency derivation.
 */
export function newestFailedRun(
  rows: readonly NeedRow[],
  runs: readonly SessionView[],
): SessionView | undefined {
  const row = rows.find((r) => r.kind === 'failed-run');
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
