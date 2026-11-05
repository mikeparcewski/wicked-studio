import type { OnboardState, RepoFleetModel } from './repoStats.js';
import { indexedAt } from './repoRows.js';
import { ago } from '../components/AgeStamp.js';

/**
 * A repository's code-map and learnings states in one plain sentence each (moved from the Repositories list's row
 * details to the repository's own page, Settings tab, 2026-11-05). Pure but for the shared `ago` formatter.
 */

/** The graph state: the engine's checkout findings OUTRANK the run verdict (F-2R2-003). */
export function graphState(m: Pick<RepoFleetModel, 'onboard' | 'graphGap'>): OnboardState | 'missing' {
  // An onboard in flight is building the graph the finding says is missing: say so.
  if (m.graphGap !== null && m.onboard.state !== 'onboarding') return 'missing';
  return m.onboard.state;
}

/** The graph-state line: one plain sentence per state (no internals). */
export function graphStateWord(m: Pick<RepoFleetModel, 'onboard' | 'graphGap'>, attachedAt: Record<string, number>, now: number): string {
  const { run } = m.onboard;
  const state = graphState(m);
  // The attach clock when the membership mirror has it, else the onboard run's own end.
  const clock = run === null ? undefined : attachedAt[run.session.id] ?? indexedAt(m) ?? undefined;
  const when = clock === undefined ? '' : ` ${ago(clock, now)} ago`;
  if (state === 'missing') {
    return m.graphGap?.kind === 'no-graph-root'
      ? 'No code map: Studio’s service has nowhere to keep one'
      : 'No code map yet';
  }
  if (state === 'ready') return `Code map ready${when === '' ? '' : ` · onboarded${when}`}`;
  if (state === 'onboarding') return 'Onboarding now — mapping the code…';
  if (state === 'failed') return `Onboarding failed${when}`;
  return 'Not onboarded yet';
}

export const GRAPH_TONE: Record<string, 'quiet' | 'run' | 'fail' | 'gate'> = {
  ready: 'quiet',
  onboarding: 'run',
  failed: 'fail',
  never: 'gate',
  missing: 'fail',
};

/**
 * The captured-learnings line (studio#294 b): one honest sentence per state, derived from the repo's newest
 * capture-learnings run exactly as the graph line is from its newest onboard.
 */
export function captureStateWord(m: Pick<RepoFleetModel, 'capture'>, attachedAt: Record<string, number>, now: number): string {
  const { state, run } = m.capture;
  const clock = run === null ? undefined : attachedAt[run.session.id];
  const when = clock === undefined ? '' : ` ${ago(clock, now)} ago`;
  if (state === 'captured') return `Learnings captured${when}`;
  if (state === 'capturing') return 'Capturing learnings now…';
  if (state === 'failed') return `Capturing learnings failed${when}`;
  return 'No learnings captured yet';
}

export const CAPTURE_TONE: Record<string, 'quiet' | 'run' | 'fail'> = {
  captured: 'quiet',
  capturing: 'run',
  failed: 'fail',
  never: 'quiet',
};
