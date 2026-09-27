import { useCallback, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { replayGovernanceDeadletters, type GovernanceReplayOutcome } from '../api/governanceReplay.js';
import type { RosterSeat, SessionView } from '../api/types.js';
import { getCachedRoster, setCachedRoster } from '../store/rosterCache.js';
import { retryLaunchOf } from '../board/repairMoves.js';

/**
 * The repair moves' BEHAVIOUR (studio Wave A, ideas 3 and 5). Every move is two-step where the
 * consequence needs the daemon to state it (the dead-letter dry run), and one-step where the
 * consequence is already on screen (the batch onboard's row line, the retry preview). Skins render
 * the states; they never post.
 */

const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** One batch launch's outcome: how many went, and which did not (with the daemon's words). */
export interface BatchResult {
  launched: number;
  failures: Array<{ id: string; error: string }>;
}

export type BatchState = { phase: 'idle' } | { phase: 'running'; done: number; total: number } | ({ phase: 'done' } & BatchResult);

/** Launch one onboarding run per repo through the EXISTING route (`POST /repos/:id/onboard`),
 *  one after another so a refusal names its repo. */
export async function launchOnboards(
  repoIds: readonly string[],
  onProgress?: (done: number) => void,
): Promise<BatchResult> {
  const failures: BatchResult['failures'] = [];
  let launched = 0;
  for (const [i, id] of repoIds.entries()) {
    try {
      await api.rerunOnboarding(id);
      launched += 1;
    } catch (err) {
      failures.push({ id, error: errText(err) });
    }
    onProgress?.(i + 1);
  }
  return { launched, failures };
}

/** The "Index all N repos" batch (idea 3). */
export function useBatchOnboard(): { state: BatchState; run: (repoIds: readonly string[]) => Promise<void> } {
  const [state, setState] = useState<BatchState>({ phase: 'idle' });
  const busy = useRef(false);
  const run = useCallback(async (repoIds: readonly string[]) => {
    if (busy.current || repoIds.length === 0) return;
    busy.current = true;
    setState({ phase: 'running', done: 0, total: repoIds.length });
    try {
      const result = await launchOnboards(repoIds, (done) => setState({ phase: 'running', done, total: repoIds.length }));
      setState({ phase: 'done', ...result });
    } finally {
      busy.current = false;
    }
  }, []);
  return { state, run };
}

export type ReplayState =
  | { phase: 'idle' }
  | { phase: 'previewing' }
  | { phase: 'preview'; outcome: GovernanceReplayOutcome }
  | { phase: 'replaying'; preview: GovernanceReplayOutcome }
  | { phase: 'done'; outcome: GovernanceReplayOutcome }
  | { phase: 'error'; message: string };

/** The Governed tile's "Replay" (idea 5): a dry run FIRST, the real replay only on confirm, then
 *  `onChanged` so the page re-reads the count. */
export function useDeadletterReplay(onChanged?: () => void): {
  state: ReplayState;
  preview: () => Promise<void>;
  confirm: () => Promise<void>;
  dismiss: () => void;
} {
  const [state, setState] = useState<ReplayState>({ phase: 'idle' });
  const stateRef = useRef(state);
  stateRef.current = state;
  const preview = useCallback(async () => {
    setState({ phase: 'previewing' });
    try {
      setState({ phase: 'preview', outcome: await replayGovernanceDeadletters(true) });
    } catch (err) {
      setState({ phase: 'error', message: errText(err) });
    }
  }, []);
  const confirm = useCallback(async () => {
    const s = stateRef.current;
    if (s.phase !== 'preview' || s.outcome.blocker !== null || s.outcome.read === 0) return;
    setState({ phase: 'replaying', preview: s.outcome });
    try {
      setState({ phase: 'done', outcome: await replayGovernanceDeadletters(false) });
    } catch (err) {
      setState({ phase: 'error', message: errText(err) });
    }
    onChanged?.();
  }, [onChanged]);
  const dismiss = useCallback(() => setState({ phase: 'idle' }), []);
  return { state, preview, confirm, dismiss };
}

export type RetryState =
  | { phase: 'idle' }
  /** The list is SNAPSHOT at open: what the preview names is exactly what confirm relaunches. */
  | { phase: 'preview'; runs: readonly SessionView[] }
  | { phase: 'running'; done: number; total: number }
  | ({ phase: 'done' } & BatchResult);

/** The Failed tile's "Retry failed" (idea 5): the preview lists what would relaunch; confirm
 *  relaunches each (onboarding runs through their repo's onboard route, the rest through
 *  `POST /runs` with `retryOf`). */
export function useRetryFailed(runs: readonly SessionView[]): {
  state: RetryState;
  open: () => void;
  confirm: () => Promise<void>;
  dismiss: () => void;
} {
  const [state, setState] = useState<RetryState>({ phase: 'idle' });
  const runsRef = useRef(runs);
  runsRef.current = runs;
  const busy = useRef(false);
  const open = useCallback(() => setState({ phase: 'preview', runs: [...runsRef.current] }), []);
  const stateRef = useRef(state);
  stateRef.current = state;
  const dismiss = useCallback(() => {
    if (!busy.current) setState({ phase: 'idle' });
  }, []);
  const confirm = useCallback(async () => {
    const s = stateRef.current;
    if (busy.current || s.phase !== 'preview' || s.runs.length === 0) return;
    const list = s.runs;
    busy.current = true;
    const failures: BatchResult['failures'] = [];
    let launched = 0;
    setState({ phase: 'running', done: 0, total: list.length });
    // The seats ride as roster seat objects: the cached roster, else one read of it.
    let roster: RosterSeat[] | null = getCachedRoster();
    if (roster === null) {
      try {
        roster = (await api.getRoster()).roster;
        setCachedRoster(roster);
      } catch {
        roster = null; // the daemon's roster default applies
      }
    }
    for (const [i, v] of list.entries()) {
      const plan = retryLaunchOf(v, roster);
      try {
        if (plan.via === 'onboard') await api.rerunOnboarding(plan.repoId);
        else await api.launchRun(plan.body);
        launched += 1;
      } catch (err) {
        failures.push({ id: v.session.id, error: errText(err) });
      }
      setState({ phase: 'running', done: i + 1, total: list.length });
    }
    busy.current = false;
    setState({ phase: 'done', launched, failures });
  }, []);
  return { state, open, confirm, dismiss };
}
