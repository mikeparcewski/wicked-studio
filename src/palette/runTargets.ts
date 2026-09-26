import type { SessionView } from '../api/types.js';
import { runEventsPath, runFilesPath } from '../hooks/useRoute.js';

/**
 * Raw in one step (studio wave 1): the raw surfaces every run has, addressable from
 * the palette for ANY run — by id, id prefix, or words from its intent — not only
 * the selected one. Each target is a ROUTE, so opening it is one history entry and
 * browser Back returns to where the operator was.
 *
 *   >events r1     the run's raw event JSON  (GET /runs/:id/events)
 *   >files r1      its worktree files / whole-run diff (the existing viewer)
 *
 * Pure: the palette renders what this returns.
 */

export interface RunTarget {
  key: 'events' | 'files';
  /** The verb's display name. */
  name: string;
  /** Words a verb query may start with (any prefix of one selects the target). */
  words: readonly string[];
  path: (runId: string) => string;
}

export const RUN_TARGETS: readonly RunTarget[] = [
  { key: 'events', name: 'Raw events', words: ['events', 'raw'], path: runEventsPath },
  { key: 'files', name: 'Open worktree / files', words: ['files', 'worktree', 'diff'], path: runFilesPath },
];

/** How many runs one target lists before the operator narrows the query. */
export const RUN_TARGET_LIMIT = 8;

export interface RunTargetHit {
  target: RunTarget;
  run: SessionView;
  /** Target path for this run. */
  href: string;
}

/** How well `arg` names the run: exact id 3, id prefix 2, intent words 1, else 0. */
function runMatch(arg: string, v: SessionView): number {
  if (arg === '') return 1;
  const a = arg.toLowerCase();
  const id = v.session.id.toLowerCase();
  if (id === a) return 3;
  if (id.startsWith(a)) return 2;
  return v.session.problem.toLowerCase().includes(a) ? 1 : 0;
}

/**
 * The hits for a verb query (the text after `>`): its first word picks the target(s),
 * the rest names the run. A query whose first word selects no target yields none — the
 * palette's ordinary verbs answer it instead.
 */
export function runTargetHits(query: string, runs: readonly SessionView[]): RunTargetHit[] {
  const [head = '', ...rest] = query.trim().split(/\s+/);
  if (head.length < 2) return [];
  const verb = head.toLowerCase();
  const targets = RUN_TARGETS.filter((t) => t.words.some((w) => w.startsWith(verb)));
  if (targets.length === 0) return [];
  const arg = rest.join(' ');
  const ranked = runs
    .map((run, i) => ({ run, i, score: runMatch(arg, run) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, RUN_TARGET_LIMIT);
  return targets.flatMap((target) =>
    ranked.map(({ run }) => ({ target, run, href: target.path(run.session.id) })),
  );
}
