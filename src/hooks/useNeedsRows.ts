import { useEffect, useMemo, useState } from 'react';
import { create } from 'zustand';
import type { SessionView } from '../api/types.js';
import { needsYouRows, type NeedRow } from '../board/needsYou.js';
import { activityEvidence, stalledRuns } from '../board/stalls.js';
import { useActivityClocks } from '../store/activityClocks.js';
import { useCampaignsStore } from '../store/campaigns.js';
import { useDeliveredNow, usePostHocDeliverStore } from '../store/postHocDeliver.js';
import { useElicitationStore } from '../store/elicitations.js';
import { useFailureClocks } from '../store/failureClocks.js';
import { useGateStore } from '../store/gates.js';
import { useAskThreadStore } from '../store/askThread.js';
import { useMembershipStore } from '../store/membership.js';
import { useDecisionsStore } from '../store/decisions.js';
import { useNeedsSources, type NeedsSource } from '../store/needsSources.js';
import { attentionBadge } from '../board/attention.js';
import { useRankedNeeds } from './useRankedNeeds.js';
import { useSystemStore } from '../store/systemSnapshot.js';
import { useNotificationStore } from '../store/notifications.js';
import { useStallEscalationStore } from '../store/stallEscalations.js';
import { orphanedRuns, useWatchStore } from '../store/watch.js';

/**
 * THE needs-you fold (`needsYouRows` → `compareNeeds`), app-wide (DES-HOME-COMMAND-CENTER §3,
 * lifted out of Home). Every consumer — Home's command center, the skin's right rail on every
 * route, peek (P/G) — reads its rows from here, over the SAME inputs:
 *
 *  - the one run list (`useRuns`, passed in);
 *  - the app-wide `/ws`-fed stores: gates, MCP elicitations, the bell's unread steer requests,
 *    the watchdog's stall escalations;
 *  - the shell board model's mirrors: failure tails, activity tails (the stall verdict, via the
 *    board's own `stalledRuns`), membership attach clocks and project ids;
 *  - the app-level REST source (`store/needsSources.ts`): live chats, pending proposals, the
 *    repo register, and the campaigns store.
 *
 * The hook reads; it fetches nothing itself beyond asking the source to load wires it has never
 * read (a no-op once the shell has loaded them). Pure given its inputs, `now` included.
 */
const NO_DECISIONS: Readonly<Record<string, never>> = Object.freeze({});

export function useNeedsRows(runs: SessionView[], now: number, runsKnown = true): NeedRow[] {
  const gates = useGateStore((s) => s.gates);
  // ASK-S1 (DES-ASK-TEAM-CHAT-001 §4.8): an ask path waiting at its TURN gate is answered by the next
  // message in its session, never a gate row on the Desk (the session itself reads "waiting", §8 F12).
  // Only a turn gate the gate store positively recorded counts; an unknown gate stays a gate.
  const turnGates = useAskThreadStore((s) => s.turnGates);
  const askTurnRuns = useMemo(() => new Set(Object.keys(turnGates)), [turnGates]);
  const failedAt = useFailureClocks((s) => s.failedAtByRun);
  const lastEventAt = useActivityClocks((s) => s.lastEventAtByRun);
  const attachedAt = useMembershipStore((s) => s.attachedAtByRun);
  const projectIds = useMembershipStore((s) => s.projectIdByRun);
  const elicitations = useElicitationStore((s) => s.elicitations);
  const notifications = useNotificationStore((s) => s.notifications);
  const stallEscalations = useStallEscalationStore((s) => s.escalations);
  const chats = useNeedsSources((s) => s.chats);
  const proposals = useNeedsSources((s) => s.proposals);
  // studio#466: "this repo was never indexed" is a claim about the runs list — every repo looks
  // never indexed over a list that has not arrived or could not be read. Until the first runs
  // answer is in, no repo row is derived (and so no "Index all N repos" batch launch is offered).
  const allRepos = useNeedsSources((s) => s.repos);
  const repos = useMemo(() => (runsKnown ? allRepos : []), [runsKnown, allRepos]);
  // The needs-you rows read the ENGINE campaigns (a label group has no gate of its own).
  const campaigns = useCampaignsStore((s) => s.campaigns);
  // studio#424: a post-hoc delivery tried this session (in flight or failed) keeps its run a need.
  const postHoc = usePostHocDeliverStore((s) => s.byRun);
  const deliveryAttempted = useMemo(
    () => new Set(Object.entries(postHoc).filter(([, d]) => d.phase !== 'delivered').map(([id]) => id)),
    [postHoc],
  );
  // Landed this session: the stale DTO's stranded row goes, as the rail's line says delivered (#438).
  const deliveredNow = useDeliveredNow();
  // DC-S6 (B12): a decision's review proposal reads "From your words" only when crew's ledger holds
  // that decision and names this proposal (a forged payload has no view), with the ledger's own
  // statement — and only under `on` (`ledger` offers nothing, so no such proposal exists).
  const decisionMode = useDecisionsStore((s) => s.mode);
  const decisionViews = useDecisionsStore((s) => s.byId);
  const decisions = useMemo(() => (decisionMode === 'on' ? decisionViews : NO_DECISIONS), [decisionMode, decisionViews]);

  useEffect(() => {
    void useNeedsSources.getState().load();
  }, []);

  // The bell's unread steer requests — the queue's `steer-request` rows.
  const steerRequests = useMemo(
    () =>
      notifications
        .filter((n) => n.kind === 'steer_requested' && !n.read)
        .map((n) => ({ id: n.id, runId: n.runId, message: n.message, ts: n.ts })),
    [notifications],
  );

  // Live runs gone silent — the board model's own verdict over the same clocks.
  const stalledAt = useMemo(
    () => stalledRuns(runs, activityEvidence(lastEventAt), now),
    [runs, lastEventAt, now],
  );

  // studio#545: runs the daemon restart orphaned — the engine's report in the trail, folded by store/watch.
  const watchFold = useWatchStore((s) => s.fold);
  const orphanedAt = useMemo(() => orphanedRuns(watchFold), [watchFold]);

  return useMemo(
    () =>
      needsYouRows({
      askTurnRuns,
        runs,
        gates,
        failedAt,
        attachedAt,
        projectIds,
        chats: chats ?? [],
        repos: repos ?? [],
        campaigns,
        stalledAt,
        orphanedAt,
        elicitations,
        steerRequests,
        stallEscalations,
        proposals: proposals ?? [],
        decisions,
        deliveryAttempted,
        deliveredNow,
        now,
      }),
    [runs, gates, failedAt, attachedAt, projectIds, chats, repos, campaigns, stalledAt, orphanedAt, elicitations, steerRequests, stallEscalations, proposals, decisions, deliveryAttempted, deliveredNow, now, askTurnRuns],
  );
}

/** The queue's coarse re-age tick (the board-model idiom): rows re-age without data changing. */
export const NEEDS_TICK_MS = 60_000;

/** ONE shared clock, so every surface folding the queue ages its rows against the same `now`. */
const useClock = create<{ now: number }>(() => ({ now: Date.now() }));
let subscribers = 0;
let timer: ReturnType<typeof setInterval> | null = null;

/** The shared `now` the fold ages rows against — ticks every {@link NEEDS_TICK_MS} while any
 *  surface reads it; the first reader after an idle spell starts from the real time. */
export function useNeedsClock(): number {
  // No live reader means no listener either: re-seeding here notifies nobody.
  if (timer === null) useClock.setState({ now: Date.now() });
  useEffect(() => {
    subscribers += 1;
    if (timer === null) {
      timer = setInterval(() => useClock.setState({ now: Date.now() }), NEEDS_TICK_MS);
    }
    return () => {
      subscribers -= 1;
      if (subscribers === 0 && timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
  }, []);
  return useClock((s) => s.now);
}

/** How long the Desk waits for a slow needs source before it counts without it (UI-CONTRACT §5). */
export const NEEDS_SETTLE_MS = 15_000;
const NEEDS_SOURCE_NAMES: Readonly<Record<NeedsSource, string>> = {
  chats: 'conversations', proposals: 'proposals', repos: 'repositories', campaigns: 'test campaigns',
};
/**
 * Per counted scope (studio#833): the last complete count, kept across refreshes so a re-read never
 * flickers to a smaller number, and the count the sources settled on with since when it has held
 * still (studio#723). One record per scope, never one for the page: the rail counts every run and a
 * project's Desk counts that project's, so a shared record had them reset each other's quiet clock on
 * every render — an empty project's Needs you never left its skeleton — and either could show the
 * other's number.
 */
interface SettledScope {
  lastComplete: number | null;
  candidate: { count: number; since: number } | null;
}
const settledScopes = new Map<string, SettledScope>();
function settledScope(scope: string): SettledScope {
  let rec = settledScopes.get(scope);
  if (rec === undefined) {
    rec = { lastComplete: null, candidate: null };
    settledScopes.set(scope, rec);
  }
  return rec;
}
/** The scope of a count over every run (the rail, the phone badge, the home Desk). */
export const ALL_NEEDS_SCOPE = 'all';
/** How long a settled count must hold still before it is said (studio#723: a reload read 26, then 43,
 *  as gates, memberships and the slower sources landed one after another). */
export const NEEDS_QUIET_MS = 1500;
/** Test seam. */
export function resetSettledNeedsForTest(): void { settledScopes.clear(); }

/**
 * HONEST COUNTS (design/UI-CONTRACT.md §5; studio#681 row 4): the needs count is shown only once
 * every source has settled — answered, failed, or {@link NEEDS_SETTLE_MS} passed — AND the count has
 * held still for {@link NEEDS_QUIET_MS}, so the Desk never says "26 things need you" before it says 43.
 *  - `loading`: runs not known yet, a source still out inside the window, or the count still moving — `count` null.
 *  - `complete`: every source answered and the count held still — the number.
 *  - `partial`: a source failed or timed out — the number of what was read, with `missing` named
 *    (the Desk says "At least N"; the rail badge "N+").
 * After the first `complete`, a refresh keeps that number until the next `complete`, and a FAILED
 * runs read (`runsFailed`, studio#684) keeps it too: a read that failed never changes a count.
 * `scope` names WHAT is counted (studio#833): every caller counting the same rows passes the same
 * scope; a project's Desk passes its project id.
 */
export function useSettledNeeds(needRows: readonly NeedRow[], runsKnown: boolean, runsFailed = false, scope: string = ALL_NEEDS_SCOPE): { phase: 'loading' | 'complete' | 'partial'; count: number | null; missing: string[] } {
  const s = useNeedsSources();
  const ranked = useRankedNeeds();
  // Crew has not answered its first read yet: a ranked crew's number may be on its way, so the
  // app-wide number is held (never the fold's count flashing before crew's, coordinator 2026-10-27).
  const crewPending = useSystemStore((st) => st.mode === 'unknown' && st.healthError === null);
  const rec = settledScope(scope);
  const [since] = useState(() => Date.now());
  const [, tick] = useState(0);
  // Operator ruling 2026-10-12: the number counts decisions + failures; reviews are counted on their own.
  const count = attentionBadge(needRows as NeedRow[]);
  const now = Date.now();
  const held = (): { phase: 'loading' | 'complete'; count: number | null; missing: string[] } =>
    rec.lastComplete === null ? { phase: 'loading', count: null, missing: [] } : { phase: 'complete', count: rec.lastComplete, missing: [] };
  // Decide first (no early return before the effects): what to say, and when to look again.
  let out: { phase: 'loading' | 'complete' | 'partial'; count: number | null; missing: string[] };
  let wakeAt: number | null = null;
  const sources = Object.keys(NEEDS_SOURCE_NAMES) as NeedsSource[];
  const expired = now - since >= NEEDS_SETTLE_MS;
  const pending = sources.filter((k) => s.readAt[k] === undefined);
  if (runsFailed) {
    out = held();
  } else if (!runsKnown) {
    out = { phase: 'loading', count: null, missing: [] };
  } else if (pending.length > 0 && !expired) {
    out = held();
    wakeAt = since + NEEDS_SETTLE_MS;
  } else {
    const valueOf = (k: NeedsSource): unknown => (k === 'campaigns' ? true : s[k]);
    const missing = sources.filter((k) => s.readAt[k] === undefined || valueOf(k) === null).map((k) => NEEDS_SOURCE_NAMES[k]);
    // Complete or partial alike, a number is said only once it has held still (codex r1 on studio#723).
    if (rec.candidate === null || rec.candidate.count !== count) rec.candidate = { count, since: now };
    if (now - rec.candidate.since < NEEDS_QUIET_MS) {
      out = held();
      wakeAt = rec.candidate.since + NEEDS_QUIET_MS;
    } else if (missing.length === 0) {
      rec.lastComplete = count;
      out = { phase: 'complete', count, missing };
    } else {
      out = { phase: 'partial', count, missing };
    }
  }
  useEffect(() => {
    if (wakeAt === null) return;
    const t = setTimeout(() => tick((n) => n + 1), Math.max(0, wakeAt - Date.now()) + 20);
    return () => clearTimeout(t);
  }, [wakeAt]);
  // A ranked crew's list is ONE settled read: its length is the number for every run (a project's
  // Desk still counts its own rows).
  if (ranked !== null && scope === ALL_NEEDS_SCOPE && !runsFailed) return { phase: 'complete', count: ranked.attention.length, missing: [] };
  if (crewPending && scope === ALL_NEEDS_SCOPE && !runsFailed) return { phase: 'loading', count: null, missing: [] };
  return out;
}
