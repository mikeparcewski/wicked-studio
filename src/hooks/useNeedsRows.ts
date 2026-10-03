import { useEffect, useMemo } from 'react';
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
import { useMembershipStore } from '../store/membership.js';
import { useDecisionsStore } from '../store/decisions.js';
import { useNeedsSources } from '../store/needsSources.js';
import { useNotificationStore } from '../store/notifications.js';
import { useStallEscalationStore } from '../store/stallEscalations.js';

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

  return useMemo(
    () =>
      needsYouRows({
        runs,
        gates,
        failedAt,
        attachedAt,
        projectIds,
        chats: chats ?? [],
        repos: repos ?? [],
        campaigns,
        stalledAt,
        elicitations,
        steerRequests,
        stallEscalations,
        proposals: proposals ?? [],
        decisions,
        deliveryAttempted,
        deliveredNow,
        now,
      }),
    [runs, gates, failedAt, attachedAt, projectIds, chats, repos, campaigns, stalledAt, elicitations, steerRequests, stallEscalations, proposals, decisions, deliveryAttempted, deliveredNow, now],
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
