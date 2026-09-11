import { CopyButton } from './CopyButton.js';
import {
  checkOutcome,
  checkTails,
  denialSourceLabel,
  formatDuration,
  shortId,
  splitBackticks,
  type GateVerdictView,
} from './gateVerdictModel.js';

/**
 * The evaluator's verdict ON the gate card (wicked-studio#250, F-3R2-006): what the operator is
 * really being asked to approve or reject. A pure view over {@link GateVerdictView} — the
 * selection and narrowing live in `gateVerdictModel.ts`; this file only says it.
 *
 * States, by `data-verdict`:
 *  - `pass`    — the floor (when one ran) and the judge passed; the criterion and the judge's
 *                reasoning are stated so "approve" is an informed act, not a reflex.
 *  - `fail`    — the winning denial: WHICH layer (`data-denial-source`), the engine's reason
 *                VERBATIM (it carries the remedy — a quoted command renders as copyable code),
 *                and for a worktree-guard denial the changed paths + seat + tree ids.
 *  - `ungated` — nothing gated the phase (no floor, no judge, no evaluator policy): labelled as a
 *                default-allow, never dressed as a pass (FINDING-025).
 *
 * The repo-checks floor (F-039) lists every check that ran — name, exit code, duration, the
 * manifest line it came from — and what was skipped, so "checks passed" is the exit codes the
 * engine observed, not the seat's account of them.
 *
 * wicked-core#431 (api-types 0.33.0) adds, each only when the frame carries it:
 *  - the judge SEAT (`judgeCli`) on the header line, and — when `judgeDistinct` is `false` — a
 *    warning that the judge was the same seat as the creator (evaluator ≠ creator is the doctrine;
 *    a same-seat judge's independence is prompt-only). A frame without the field claims no seat.
 *  - the restore state on a worktree-guard denial: `restored: true` says the evaluator's edit was
 *    discarded and the creator's verified tree restored, lists the discarded paths from the
 *    `worktreeRestored` record, and — when the edit was pinned — gives `git show <suggestionRef>`
 *    as copyable code; `restored: false` says the restore failed and the manual remedy stands.
 *
 * Own testids (`gate-verdict-*`): the run page's `verdict-detail` card keeps its selector.
 */
export function GateVerdict({ view, phase }: { view: GateVerdictView; phase: string }): React.ReactElement {
  const { outcome } = view;
  const tone = outcome === 'fail' ? 'var(--status-fail)' : outcome === 'pass' ? 'var(--status-done)' : 'var(--ink-muted)';
  const toneDim = outcome === 'fail' ? 'var(--status-fail-dim)' : outcome === 'pass' ? 'var(--status-done-dim)' : 'var(--surface-raised)';
  const word = outcome === 'fail' ? 'DENIED' : outcome === 'pass' ? 'PASS' : 'UNGATED';
  const vacuous = view.evaluatorPolicies.length === 0 && view.evaluatorPass === true;

  return (
    <div
      data-testid="gate-verdict"
      data-verdict={outcome}
      {...(view.ord !== null ? { 'data-phase-ord': view.ord } : {})}
      {...(view.attempt !== null ? { 'data-phase-attempt': view.attempt } : {})}
      {...(view.denial !== null && view.denial.source !== null ? { 'data-denial-source': view.denial.source } : {})}
      className="rounded-lg p-2.5 mb-3 flex flex-col gap-1 font-mono"
      style={{ background: toneDim, border: `1px solid ${toneDim}` }}
    >
      <p className="text-xs font-semibold" style={{ color: tone }}>
        Evaluator verdict — {phase} · {word}
        {view.judgeCli !== null && (
          <span
            data-testid="gate-verdict-judge-seat"
            data-judge-cli={view.judgeCli}
            data-judge-distinct={view.judgeDistinct === null ? 'unknown' : String(view.judgeDistinct)}
            style={{ color: 'var(--ink-muted)' }}
            title={
              view.judgeDistinct === true
                ? 'the judge ran on a seat identity-distinct from the creator (the rotation pick)'
                : view.judgeDistinct === false
                  ? 'the judge fell back to the single default runner — the same seat as the creator'
                  : 'which seat rendered the judge verdict'
            }
          >
            {' · '}judge: {view.judgeCli}
          </span>
        )}
      </p>

      {view.judgeCli !== null && view.judgeDistinct === false && (
        <p className="text-[11px]" data-testid="gate-verdict-judge-same-seat" style={{ color: 'var(--status-gate)' }}>
          same seat as the creator — evaluator ≠ creator is not held on this verdict: the judge fell back to the
          single default runner, so its independence is prompt-only
        </p>
      )}

      {view.criterion !== null && (
        <p className="text-[11px]" data-testid="gate-verdict-criterion" style={{ color: 'var(--ink-muted)' }}>
          criterion: {view.criterion}
        </p>
      )}

      {(view.agentVerdict !== null || view.agentReasoning !== null) && (
        <p className="text-[11px]" data-testid="gate-verdict-judge" style={{ color: 'var(--ink-body)' }}>
          {view.agentVerdict !== null && <span className="font-semibold">judge: {view.agentVerdict}</span>}
          {view.agentVerdict !== null && view.agentReasoning !== null && ' — '}
          {view.agentReasoning}
        </p>
      )}

      {view.denial !== null && (
        <p
          className="text-[11px]"
          data-testid="gate-verdict-denial"
          // The recorded remedy carries a 40-hex tree id inside one <code> span — an unbreakable
          // token that overflows a narrow dock unless it may wrap anywhere.
          style={{ color: 'var(--status-fail)', overflowWrap: 'anywhere' }}
        >
          <span className="font-semibold">denied by {denialSourceLabel(view.denial.source)}: </span>
          {splitBackticks(view.denial.reason).map((part, i) =>
            i % 2 === 1 ? (
              <code key={i} className="px-1 rounded" style={{ background: 'var(--surface-rail)', color: 'var(--ink-high)' }}>
                {part}
              </code>
            ) : (
              <span key={i}>{part}</span>
            ),
          )}
          {view.denial.ruleIds.length > 0 && <span> · rules: {view.denial.ruleIds.join(', ')}</span>}
          {view.denial.deniedTool !== null && <span> · tool: {view.denial.deniedTool}</span>}
        </p>
      )}

      {view.mutation !== null && (
        <p className="text-[11px]" data-testid="gate-verdict-mutation" style={{ color: 'var(--ink-body)' }}>
          worktree changed by <span className="font-semibold">{view.mutation.cli || 'the seat'}</span>
          {view.mutation.phase !== '' && <> during <span className="font-semibold">{view.mutation.phase}</span></>}
          {': '}
          {view.mutation.changed.length === 0
            ? 'no path listed'
            : view.mutation.changed.map((c) => `${c.status} ${c.path}`).join(', ')}
          {view.mutation.beforeTree !== '' && view.mutation.afterTree !== '' && (
            <span style={{ color: 'var(--ink-dim)' }}>
              {' '}(tree {view.mutation.beforeTree.slice(0, 10)} → {view.mutation.afterTree.slice(0, 10)})
            </span>
          )}
          {view.mutation.headMoved && ' · the run branch moved'}
        </p>
      )}

      {/* wicked-core#431 (F-3R2-010): the engine already ran the remedy. Say so, list exactly what was
          thrown away (the worktreeRestored record; the mutation's own list when that frame is absent),
          and hand over the pinned ref so the discarded edit can still be read. */}
      {view.mutation !== null && view.mutation.restored === true && (
        <p
          className="text-[11px]"
          data-testid="gate-verdict-restored"
          {...(view.restore !== null && view.restore.suggestionRef !== null ? { 'data-suggestion-ref': view.restore.suggestionRef } : {})}
          style={{ color: 'var(--ink-body)', overflowWrap: 'anywhere' }}
        >
          <span className="font-semibold" style={{ color: 'var(--status-done)' }}>
            the evaluator&apos;s edit was discarded and the creator&apos;s verified tree restored
          </span>
          {' — discarded: '}
          {(() => {
            const paths = view.restore !== null ? view.restore.discarded : view.mutation.changed;
            return paths.length === 0 ? 'no path listed' : paths.map((c) => `${c.status} ${c.path}`).join(', ');
          })()}
          {view.restore !== null && view.restore.tree !== '' && (
            <span style={{ color: 'var(--ink-dim)' }}> (tree {shortId(view.restore.tree)})</span>
          )}
          {view.restore !== null && view.restore.head !== null && ` · HEAD reset to ${shortId(view.restore.head, 7)}`}
          {view.restore !== null && view.restore.suggestionRef !== null && (
            <>
              {' · the edit is kept at '}
              <code className="px-1 rounded" style={{ background: 'var(--surface-rail)', color: 'var(--ink-high)' }}>
                {view.restore.suggestionRef}
              </code>
              {' — read it back with '}
              <code
                data-testid="gate-verdict-suggestion-hint"
                className="px-1 rounded"
                title="click to select, then copy"
                style={{ background: 'var(--surface-rail)', color: 'var(--ink-high)', userSelect: 'all' }}
              >
                git show {view.restore.suggestionRef}
              </code>{' '}
              <CopyButton command={`git show ${view.restore.suggestionRef}`} />
            </>
          )}
          {view.restore !== null && view.restore.suggestionRef === null && ' · the discarded edit was not pinned (no suggestion ref) — only the paths above record it'}
          {view.restore === null && ' (paths from the mutation record — no restore record in the log)'}
        </p>
      )}

      {view.mutation !== null && view.mutation.restored === false && (
        <p className="text-[11px]" data-testid="gate-verdict-restore-failed" style={{ color: 'var(--status-fail)', overflowWrap: 'anywhere' }}>
          the creator&apos;s tree was NOT restored
          {view.mutation.restoreError !== null && `: ${view.mutation.restoreError}`}
          {' — the manual remedy in the denial stands; approving retries against the tree as it is'}
        </p>
      )}

      {view.floor !== null && (
        <div
          data-testid="gate-verdict-floor"
          data-floor={view.floor.passed ? 'pass' : 'fail'}
          className="text-[11px] flex flex-col gap-0.5"
          style={{ color: 'var(--ink-body)' }}
        >
          <p>
            <span className="font-semibold" style={{ color: view.floor.passed ? 'var(--status-done)' : 'var(--status-fail)' }}>
              repository checks — {view.floor.passed ? 'pass' : 'fail'}
            </span>
            {view.floor.criterion !== '' && <span style={{ color: 'var(--ink-muted)' }}> · {view.floor.criterion}</span>}
          </p>
          {view.floor.checks.length === 0 ? (
            <p style={{ color: 'var(--ink-muted)' }}>
              {view.floor.passed
                ? 'no detectable check in this repository — a disclosed vacuous pass, not a green suite'
                : 'the floor failed before any check ran (no write boundary could be armed, or the manifest could not be trusted)'}
            </p>
          ) : (
            <ul className="pl-3 list-disc">
              {view.floor.checks.map((c) => {
                const o = checkOutcome(c);
                return (
                  <li
                    key={c.name}
                    data-testid="gate-verdict-check"
                    data-check={c.name}
                    data-ok={o.ok ? 'true' : 'false'}
                  >
                    <span className="font-semibold">{c.name}</span>
                    {' · '}
                    <span style={{ color: o.ok ? 'var(--status-done)' : 'var(--status-fail)' }}>{o.word}</span>
                    {' · '}
                    {formatDuration(c.durationMs)}
                    {c.source !== '' && <span style={{ color: 'var(--ink-dim)' }}> · {c.source}</span>}
                  
                    {/* The evidence behind a red row (F-255-03): the stream tails the engine recorded, collapsed. */}
                    {checkTails(c).map((t) => (
                      <details key={t.stream} data-testid="gate-verdict-check-tail" data-stream={t.stream} className="mt-0.5">
                        <summary className="cursor-pointer" style={{ color: 'var(--ink-muted)' }}>
                          {t.stream} tail — the check&apos;s own output, verbatim
                        </summary>
                        <pre
                          className="mt-1 p-1.5 rounded overflow-auto text-[10px] leading-snug"
                          style={{ maxHeight: '12rem', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', background: 'var(--surface-rail)', color: 'var(--ink-high)' }}
                        >
                          {t.text}
                        </pre>
                      </details>
                    ))}
                  </li>
                );
              })}
            </ul>
          )}
          {view.floor.skipped.length > 0 && (
            <p data-testid="gate-verdict-skipped" style={{ color: 'var(--ink-muted)' }}>
              skipped (an earlier check failed): {view.floor.skipped.join(', ')}
            </p>
          )}
        </div>
      )}

      {/* Which governance layers actually ran — the same never-overclaim line as VerdictDetail. */}
      <p className="text-[10px]" data-testid="gate-verdict-layers" style={{ color: 'var(--ink-muted)' }}>
        {view.hasDeterministicFloor
          ? `deterministic floor: ${view.deterministicPass ? 'pass' : 'fail'}`
          : 'no deterministic floor'}
        {' · '}
        {view.evaluatorPass === null
          ? 'evaluator layer did not run'
          : vacuous
            ? 'evaluator: default-allow (no policy applied)'
            : `evaluator: ${view.evaluatorPass ? 'pass' : 'fail'} (${view.evaluatorPolicies.length} ${
                view.evaluatorPolicies.length === 1 ? 'policy' : 'policies'
              })`}
      </p>

      {outcome === 'ungated' && (
        <p className="text-[11px]" data-testid="gate-verdict-ungated" style={{ color: 'var(--ink-muted)' }}>
          nothing gated this phase — it was approved by default, not verified
        </p>
      )}
    </div>
  );
}
