import {
  liftIsFailure,
  liftOutcomeLabel,
  reverifyChangedTree,
  type DeliverLiftView,
} from './deliverLiftModel.js';
import { checkOutcome, formatDuration, shortId, splitBackticks } from './gateVerdictModel.js';

/**
 * The deliver lift ON the card (wicked-core#431 / F-3R2-013, api-types 0.33.0): what the engine
 * did to the run's work before letting the deliver phase push, and — when it refused — why, in the
 * engine's own words. A pure view over {@link DeliverLiftView}; the selection lives in
 * `deliverLiftModel.ts`. Rendered by the rail's Delivery body, the deliver gate's card and the
 * timeline's detail panel, so all three say the same thing.
 *
 * States, by `data-outcome`:
 *  - `unchanged` — the base was already the remote tip; the verified tree ships as-is.
 *  - `lifted`    — re-applied onto the tip (base and tree before → after); the repository's checks
 *                  re-ran on the lifted tree — every row of that re-verify is listed.
 *  - `conflict`  — the files the lift would conflict in, the fact that nothing was rebased or
 *                  pushed, and the LIFT-CONFLICT remedy.
 *  - `skipped` / `failed` — the engine's note, verbatim.
 *  - `refused`   — no lift frame at all (a `HEAD` off the run branch, a tree that could not be
 *                  snapshotted): only the engine-authored `deliver:` failure text exists, rendered
 *                  on its own (wicked-core#433 final review — never assume the lift event exists).
 *
 * Copy rule, load-bearing: nothing here says "pushed" or "PR" — the lift precedes the push, and a
 * `lifted`/`unchanged` outcome licenses only "the tree that would ship was verified". The push and
 * the PR claim stay with the Delivery card's own url-gated arms.
 */
export function DeliverLift({ view, omitFailure = false }: { view: DeliverLiftView; omitFailure?: boolean }): React.ReactElement {
  const failing = liftIsFailure(view);
  const tone = failing ? 'var(--status-fail)' : view.outcome === 'skipped' ? 'var(--ink-muted)' : 'var(--status-done)';
  const toneDim = failing ? 'var(--status-fail-dim)' : view.outcome === 'skipped' ? 'var(--surface-raised)' : 'var(--status-done-dim)';
  const short7 = (id: string | null): string => (id === null ? '?' : shortId(id, 7));
  const base = view.baseRef ?? 'the remote default branch';
  const floor = view.reverify;
  const changedTree = floor !== null && reverifyChangedTree(floor);

  return (
    <div
      data-testid="deliver-lift"
      data-outcome={view.outcome ?? 'refused'}
      {...(view.attempt !== null ? { 'data-attempt': view.attempt } : {})}
      className="rounded-lg p-2.5 flex flex-col gap-1 font-mono text-[11px]"
      style={{ background: toneDim, border: `1px solid ${toneDim}`, color: 'var(--ink-body)', overflowWrap: 'anywhere' }}
    >
      <p className="text-xs font-semibold" style={{ color: tone }}>
        Deliver lift — {liftOutcomeLabel(view.outcome)}
      </p>

      {view.outcome === 'unchanged' && (
        <p data-testid="deliver-lift-summary">
          {base} is still at {short7(view.baseBefore)} — the tree the checks verified is the tree that would ship
          {view.treeBefore !== null && <span style={{ color: 'var(--ink-dim)' }}> (tree {shortId(view.treeBefore)})</span>}
        </p>
      )}

      {view.outcome === 'lifted' && (
        <p data-testid="deliver-lift-summary">
          re-based onto {base} @ {short7(view.baseAfter)} (was {short7(view.baseBefore)})
          {view.treeBefore !== null && view.treeAfter !== null && (
            <span style={{ color: 'var(--ink-dim)' }}> · tree {shortId(view.treeBefore)} → {shortId(view.treeAfter)}</span>
          )}
          {floor === null && " · the repository's checks re-run on the lifted tree before any push"}
        </p>
      )}

      {view.outcome === 'conflict' && (
        <>
          <p data-testid="deliver-lift-summary" style={{ color: 'var(--status-fail)' }}>
            lifting the run's work onto {base} @ {short7(view.baseAfter)} would conflict in:{' '}
            <span className="font-semibold" data-testid="deliver-lift-conflicts">
              {view.conflicts.length === 0 ? '(no path listed)' : view.conflicts.join(', ')}
            </span>
            {' — the worktree was left exactly as verified'}
            {view.baseBefore !== null && ` (base ${short7(view.baseBefore)})`}; nothing was rebased and nothing was pushed
          </p>
          <p data-testid="deliver-lift-remedy" style={{ color: 'var(--ink-body)' }}>
            <span className="font-semibold">remedy:</span> on the run branch, rebase onto {base}, resolve{' '}
            {view.conflicts.length === 0 ? 'the conflict' : view.conflicts.join(', ')}, regenerate any generated files and
            re-run the repository's checks — then approve to retry the deliver phase, or reject to leave the work in
            its worktree (the run reads as stranded until a PR is on record).
          </p>
        </>
      )}

      {view.outcome === 'skipped' && (
        <p data-testid="deliver-lift-summary">
          the lift could not be decided — {view.note ?? 'no reason recorded'}; the worktree was not touched and the
          deliver script's own rebase stands
        </p>
      )}

      {view.outcome === 'failed' && (
        <p data-testid="deliver-lift-summary" style={{ color: 'var(--status-fail)' }}>
          the lift was decided but could not be applied — {view.note ?? 'no reason recorded'}; the worktree may hold a
          partial state and nothing was pushed
        </p>
      )}

      {view.outcome !== null &&
        !['unchanged', 'lifted', 'conflict', 'skipped', 'failed'].includes(view.outcome) && (
          <p data-testid="deliver-lift-summary">
            outcome &quot;{view.outcome}&quot; (a newer engine than this studio knows)
            {view.note !== null && ` — ${view.note}`}
          </p>
        )}

      {/* A disclosed degradation on an otherwise decided lift (a failed fetch, say) — the engine's words. */}
      {view.note !== null && (view.outcome === 'unchanged' || view.outcome === 'lifted' || view.outcome === 'conflict') && (
        <p data-testid="deliver-lift-note" style={{ color: 'var(--ink-muted)' }}>{view.note}</p>
      )}

      {floor !== null && (
        <div data-testid="deliver-lift-floor" data-floor={floor.passed ? 'pass' : 'fail'} className="flex flex-col gap-0.5">
          <p>
            <span className="font-semibold" style={{ color: floor.passed ? 'var(--status-done)' : 'var(--status-fail)' }}>
              repository checks re-run on the tree that would ship — {floor.passed ? 'pass' : 'fail'}
            </span>
            {floor.criterion !== '' && <span style={{ color: 'var(--ink-muted)' }}> · {floor.criterion}</span>}
          </p>
          {changedTree && (
            <p data-testid="deliver-lift-changed-tree" style={{ color: 'var(--status-fail)' }}>
              every check exited 0, yet the checks CHANGED the worktree while running — a tree nobody verified, so the
              deliver failed closed (the refusal below names what moved)
            </p>
          )}
          {floor.checks.length === 0 ? (
            <p style={{ color: 'var(--ink-muted)' }}>
              {floor.passed
                ? 'no detectable check in this repository — a disclosed vacuous pass, not a green suite'
                : 'the re-verify failed before any check ran'}
            </p>
          ) : (
            <ul className="pl-3 list-disc">
              {floor.checks.map((c) => {
                const o = checkOutcome(c);
                return (
                  <li key={c.name} data-testid="deliver-lift-check" data-check={c.name} data-ok={o.ok ? 'true' : 'false'}>
                    <span className="font-semibold">{c.name}</span>
                    {' · '}
                    <span style={{ color: o.ok ? 'var(--status-done)' : 'var(--status-fail)' }}>{o.word}</span>
                    {' · '}
                    {formatDuration(c.durationMs)}
                    {c.source !== '' && <span style={{ color: 'var(--ink-dim)' }}> · {c.source}</span>}
                  </li>
                );
              })}
            </ul>
          )}
          {floor.skipped.length > 0 && (
            <p data-testid="deliver-lift-skipped" style={{ color: 'var(--ink-muted)' }}>
              skipped (an earlier check failed): {floor.skipped.join(', ')}
            </p>
          )}
        </div>
      )}

      {/* The engine's refusal, VERBATIM — it carries the remedy; quoted refs render as copyable code. */}
      {view.failure !== null && !omitFailure && (
        <p data-testid="deliver-lift-failure" style={{ color: 'var(--status-fail)' }}>
          {splitBackticks(view.failure).map((part, i) =>
            i % 2 === 1 ? (
              <code key={i} className="px-1 rounded" style={{ background: 'var(--surface-rail)', color: 'var(--ink-high)' }}>
                {part}
              </code>
            ) : (
              <span key={i}>{part}</span>
            ),
          )}
        </p>
      )}
    </div>
  );
}
