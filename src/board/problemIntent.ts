/**
 * The person's words of a run's problem: everything before the first daemon block (studio#1148).
 *
 * crew decorates a launched run's `problem` with its own blocks AFTER the person's words — linked issues,
 * learnings, the steering-rules brief — each opened by a `<!-- wicked-crew:<name> -->` marker. On every workflow
 * launch it cuts a problem at the first linked-issues open marker (`stripLinkedIssues`, crew
 * `src/core/linked-issues.ts`): "nothing from the first open marker on is theirs". A pre-fill built from the
 * DECORATED problem therefore ends inside daemon text, and whatever the person types after it is cut away. A
 * pre-fill starts from this instead, so their additions come before any block.
 */
export const DAEMON_BLOCK_MARKER = '<!-- wicked-crew:';

export function intentOf(problem: string): string {
  const at = problem.indexOf(DAEMON_BLOCK_MARKER);
  return at === -1 ? problem : problem.slice(0, at).trimEnd();
}
