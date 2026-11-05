import type { OnboardState, RepoFleetModel } from './repoStats.js';
import { indexedAt } from './repoRows.js';
import { ago } from '../components/AgeStamp.js';
import { isHeldRun } from './heldRuns.js';

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
  // (crew#1042) A held onboarding (an orphan, a stall) is not mapping anything: it waits on you.
  if (state === 'onboarding') return run !== null && isHeldRun(run.session) ? 'Onboarding waits on you — see Needs you' : 'Onboarding now — mapping the code…';
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
  if (state === 'capturing') return run !== null && isHeldRun(run.session) ? 'Capturing learnings waits on you — see Needs you' : 'Capturing learnings now…';
  if (state === 'failed') return `Capturing learnings failed${when}`;
  return 'No learnings captured yet';
}

/** (crew#1042) The graph line's tone: a held onboarding waits on you (the gate tint), whatever the run says. */
export function graphTone(m: Pick<RepoFleetModel, 'onboard' | 'graphGap'>): string {
  const state = graphState(m);
  if (state === 'onboarding' && m.onboard.run !== null && isHeldRun(m.onboard.run.session)) return 'gate';
  return GRAPH_TONE[state] ?? 'quiet';
}

/** (crew#1042) The learnings line's tone: a held capture waits on you. */
export function captureTone(m: Pick<RepoFleetModel, 'capture'>): string {
  if (m.capture.state === 'capturing' && m.capture.run !== null && isHeldRun(m.capture.run.session)) return 'gate';
  return CAPTURE_TONE[m.capture.state] ?? 'quiet';
}

export const CAPTURE_TONE: Record<string, 'quiet' | 'run' | 'fail'> = {
  captured: 'quiet',
  capturing: 'run',
  failed: 'fail',
  never: 'quiet',
};
