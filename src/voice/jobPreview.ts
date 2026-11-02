import type { CoreEvent, SessionView } from '../api/types.js';
import { powerOf, type Rigor } from '../api/power.js';
import { checkOutcome, floorOf } from '../components/gateVerdictModel.js';

/**
 * THE JOB PREVIEW'S FACTS (lane voice-jobs): what the large live tile on the voice dashboard says about one job, from
 * the reads the run page already makes — the run's detail (`GET /runs/:id`: its steps, power state), the system read
 * (phase, liveness, the step it is on), and the run's event log (checks). Pure, so the tile and its tests agree.
 */

export interface PreviewFacts {
  /** "build", "review" … or null when nothing names it. */
  phase: string | null;
  /** Power mode's rigor; `phased` when the run runs phase by phase (it has no rigor to raise). */
  rigor: Rigor | 'phased' | null;
  /** "3 of 4 passed · test failed", "passed (2)", or "none run yet". */
  checks: string;
  checksTone: 'ok' | 'fail' | 'idle';
  /** The step whose live activity is shown (power: the orchestrator's). */
  ord: number | null;
  /** The run's own status word ("executing", "completed" …). */
  status: string | null;
}

/** The newest repository-checks record in the log, in words. */
export function checksLine(events: readonly CoreEvent[] | null | undefined): { line: string; tone: 'ok' | 'fail' | 'idle' } {
  const last = [...(events ?? [])].reverse().find((e) => e.type === 'repoChecksEvaluated');
  if (last === undefined) return { line: 'none run yet', tone: 'idle' };
  const floor = floorOf(last);
  const total = floor.checks.length;
  if (total === 0) return { line: floor.passed ? 'passed' : 'failed', tone: floor.passed ? 'ok' : 'fail' };
  const failed = floor.checks.filter((c) => !checkOutcome(c).ok);
  if (failed.length === 0) return { line: `all ${total} passed`, tone: 'ok' };
  return { line: `${total - failed.length} of ${total} passed · ${failed.map((c) => c.name).slice(0, 2).join(', ')} failed`, tone: 'fail' };
}

/** The step a job is on: power's orchestrator, the system read's, a step running now, else the cursor. */
export function currentOrdOf(view: SessionView | null, systemOrd: number | null): number | null {
  const power = view !== null ? powerOf(view.session) : null;
  if (power?.on === true && power.orchestrator.ord !== null) return power.orchestrator.ord;
  if (systemOrd !== null) return systemOrd;
  if (view === null) return null;
  const live = view.units.find((u) => u.status === 'distributed');
  return live?.ord ?? view.units[view.session.unit_ix]?.ord ?? null;
}

export function previewFacts(view: SessionView | null, sys: { phase: string | null; unitOrd: number | null } | null, events: readonly CoreEvent[] | null | undefined): PreviewFacts {
  const power = view !== null ? powerOf(view.session) : null;
  const ord = currentOrdOf(view, sys?.unitOrd ?? null);
  const unit = view?.units.find((u) => u.ord === ord);
  const phase = sys?.phase ?? (unit !== undefined ? (unit.phase_ref ?? unit.stage ?? null) : null);
  const { line, tone } = checksLine(events);
  return {
    phase: phase !== null && phase !== '' ? phase : null,
    rigor: power === null ? (view !== null ? 'phased' : null) : power.on ? power.rigor : 'phased',
    checks: line,
    checksTone: tone,
    ord,
    status: view !== null ? String(view.session.status) : null,
  };
}
