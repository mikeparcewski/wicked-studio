import {
  checkOutcome,
  denialSourceLabel,
  formatDuration,
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
 * engine observed, not the seat's account of them. The judge SEAT is not on the wire (api-types
 * 0.31.0), so no line claims one.
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
      {...(view.denial !== null && view.denial.source !== null ? { 'data-denial-source': view.denial.source } : {})}
      className="rounded-lg p-2.5 mb-3 flex flex-col gap-1 font-mono"
      style={{ background: toneDim, border: `1px solid ${toneDim}` }}
    >
      <p className="text-xs font-semibold" style={{ color: tone }}>
        Evaluator verdict — {phase} · {word}
      </p>

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
        <p className="text-[11px]" data-testid="gate-verdict-denial" style={{ color: 'var(--status-fail)' }}>
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
