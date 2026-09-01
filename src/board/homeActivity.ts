import type { CoreEvent, SessionView } from '../api/types.js';
import { lastNarration, type NarrationLine, type NarratorContext } from '../components/narrator.js';
import { phaseName } from '../components/NarratorFeed.js';

/**
 * The RECENT ACTIVITY fold (DES-HOME-COMMAND-CENTER §5) — the home page's pulse.
 *
 * One narrated line per run this client has OBSERVED structured frames for
 * (the run event store), clocked by the runtime log's arrival tail (the one
 * client-side clock live `/ws` frames get), newest first, capped. Runs with no
 * observed frames simply do not appear — the pulse is what the session has
 * seen, never an invented history (absence stays absent).
 *
 * Narration is `lastNarration` over the run's own frames with the run's own
 * unit vocabulary (`phaseName` — the ChatPanel/AssistDock idiom) — the ONE
 * narrator template layer, zero forks.
 */

export interface ActivityRow {
  runId: string;
  /** The run's intent — the row's subject (renderers pass it to humanTitle). */
  problem: string;
  line: NarrationLine;
  /** Arrival clock of the run's newest logged frame (ms epoch). */
  at: number;
}

export const ACTIVITY_CAP = 8;

/** The narrator ctx for one run — unit-id suffix vocabulary, stage fallback. */
export function narratorCtxOf(view: SessionView): NarratorContext {
  const byOrd = new Map(view.units.map((u) => [u.ord, u]));
  return {
    phaseOf: (ord) => {
      if (typeof ord !== 'number') return 'this phase';
      const unit = byOrd.get(ord);
      return unit === undefined ? `unit ${ord}` : phaseName(view.session.id, unit);
    },
    intent: view.session.problem ?? null,
  };
}

export function recentActivity(
  runs: readonly SessionView[],
  byRun: Record<string, CoreEvent[]>,
  /** run id → arrival ts of its newest logged frame (the runtime store's logs). */
  tailAt: (runId: string) => number | undefined,
  cap: number = ACTIVITY_CAP,
): ActivityRow[] {
  const rows: ActivityRow[] = [];
  for (const v of runs) {
    if (v.session.archived_at != null) continue;
    const id = v.session.id;
    const events = byRun[id];
    if (events === undefined || events.length === 0) continue;
    const at = tailAt(id);
    if (at === undefined) continue; // no arrival clock — cannot order honestly
    const line = lastNarration(events, narratorCtxOf(v));
    if (line === null) continue; // nothing the narrator speaks
    rows.push({ runId: id, problem: v.session.problem, line, at });
  }
  return rows.sort((a, b) => b.at - a.at).slice(0, cap);
}
