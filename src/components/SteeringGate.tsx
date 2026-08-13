import { useState, useEffect } from 'react';
import { api, type GateDecision } from '../api/client.js';
import type { CoverageReport } from '../api/types.js';
import { useGateStore } from '../store/gates.js';
import { useSteeringStore, type SteeringAction } from '../store/steering.js';

interface Props {
  runId: string;
  ord?: number;
  prompt?: string;
  /** When present, fetches coverage stats for inline display at the gate card. */
  repoRef?: string;
  onResolved?: () => void;
}

/** Strip the bracketed architectural footnote from a workflow gate prompt. */
function cleanPrompt(raw: string): { headline: string; footnote: string | null } {
  const bracketIdx = raw.indexOf('[');
  if (bracketIdx === -1) return { headline: raw.trim(), footnote: null };
  return {
    headline: raw.slice(0, bracketIdx).trim(),
    footnote: raw.slice(bracketIdx + 1, raw.lastIndexOf(']') !== -1 ? raw.lastIndexOf(']') : undefined).trim(),
  };
}

/** Format a coverage report into a compact summary for gate-card display. */
function coverageLabel(r: CoverageReport): string {
  const pct = r.behavior_bearing === 0 ? '—' : `${(r.coverage * 100).toFixed(1)}%`;
  const resolvedPct = r.behavior_bearing === 0 ? '' : ` · resolved ${(r.resolved_rate * 100).toFixed(0)}%`;
  return `Coverage: ${pct} · ${r.behavior_bearing.toLocaleString()} nodes · ${r.unaccounted} unaccounted${resolvedPct}`;
}

export function SteeringGate({ runId, ord, prompt, repoRef, onResolved }: Props): React.ReactElement {
  const clearGate = useGateStore((s) => s.clearGate);
  const recordSteering = useSteeringStore((s) => s.record);
  const [amend, setAmend] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [coverage, setCoverage] = useState<CoverageReport | null>(null);

  useEffect(() => {
    if (!repoRef) return;
    // Fetch coverage stats for this repo — the evaluator unit writes these to
    // the estate store, so they reflect the numbers the gate was checking.
    api.getCoverageReportForRepo(repoRef).then(({ report }) => {
      if (report) setCoverage(report);
    }).catch(() => { /* best-effort: no stats is fine */ });
  }, [repoRef]);

  async function run(
    action: () => Promise<unknown>,
    intervention: { kind: SteeringAction; amend?: string },
  ): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      await action();
      recordSteering({
        runId,
        action: intervention.kind,
        ...(typeof ord === 'number' ? { ord } : {}),
        ...(intervention.amend !== undefined ? { amend: intervention.amend } : {}),
      });
      clearGate(runId);
      onResolved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  const approve = (): Promise<void> =>
    run(() => api.confirmGate(runId, { approve: true }), { kind: 'approve' });

  const approveWithSteer = (): Promise<void> => {
    const text = amend.trim();
    if (!text) return Promise.resolve();
    const decision: GateDecision = { approve: true, amend: text };
    return run(() => api.confirmGate(runId, decision), { kind: 'approve-with-steer', amend: text });
  };

  const reject = (): Promise<void> =>
    run(() => api.confirmGate(runId, { approve: false }), { kind: 'reject' });

  const cancel = (): Promise<void> =>
    run(() => api.cancelRun(runId), { kind: 'cancel' });

  const { headline, footnote } = cleanPrompt(
    prompt ?? 'Prompt unavailable (daemon restarted) — you can still approve or reject.',
  );

  const isCoverageFail = headline.toLowerCase().includes('not pass') || headline.toLowerCase().includes('coverage');

  return (
    <div
      className="rounded-xl p-4"
      style={{
        background: '#161c26',
        border: '1px solid rgba(255,218,25,0.3)',
        boxShadow: '0 0 0 1px rgba(255,218,25,0.08)',
      }}
      data-testid="steering-gate"
      data-run-id={runId}
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: '#ffda19' }} />
        <p className="font-semibold text-sm font-mono" style={{ color: '#ffda19' }}>
          Awaiting human decision
        </p>
      </div>
      <p className="text-xs font-mono mb-3" style={{ color: 'rgba(230,237,243,0.4)' }}>
        run {runId.slice(0, 8)}
        {typeof ord === 'number' ? ` · before unit #${ord}` : ''}
      </p>

      {/* Headline prompt — the actionable part only */}
      <p
        className="text-xs mb-1 leading-relaxed font-mono"
        style={{ color: 'rgba(230,237,243,0.85)' }}
        data-testid="steering-prompt"
      >
        {headline}
      </p>

      {/* Coverage stats — shown when evaluator gate fails and we have repo coverage data */}
      {isCoverageFail && coverage && (
        <p className="text-xs mb-2 font-mono" style={{ color: 'rgba(96,165,250,0.85)' }}>
          {coverageLabel(coverage)}
        </p>
      )}

      {/* Footnote disclosure — architectural explanation, collapsed by default */}
      {footnote && (
        <details className="mb-3">
          <summary
            className="text-[10px] font-mono cursor-pointer select-none"
            style={{ color: 'rgba(230,237,243,0.3)' }}
          >
            why this gate fired
          </summary>
          <p className="text-[10px] font-mono mt-1 leading-relaxed" style={{ color: 'rgba(230,237,243,0.35)' }}>
            {footnote}
          </p>
        </details>
      )}

      {/* Steer textarea — guide the re-run */}
      <textarea
        data-testid="steering-amend"
        className="w-full rounded-lg p-2 text-xs mb-3 resize-none font-mono"
        style={{
          background: '#0f1419',
          border: '1px solid rgba(230,237,243,0.14)',
          color: '#e6edf3',
          outline: 'none',
        }}
        rows={2}
        placeholder={
          isCoverageFail && coverage && coverage.unaccounted > 0
            ? `${coverage.unaccounted} nodes unaccounted — add guidance for the evaluator, e.g. "focus on services/ directory"`
            : 'Optional steer — guide the next unit when approving with steer'
        }
        value={amend}
        onChange={(e) => setAmend(e.target.value)}
        disabled={loading}
      />

      {error && (
        <p className="text-xs mb-3 font-mono" style={{ color: '#f85149' }} data-testid="steering-error">
          {error}
        </p>
      )}

      {/* Four-button layout (2×2): Approve / Approve+steer / Reject / Cancel run */}
      <div className="grid grid-cols-2 gap-2">
        <button
          data-testid="steering-approve"
          onClick={() => void approve()}
          disabled={loading}
          className="rounded-lg px-3 py-2 text-xs font-semibold font-mono disabled:opacity-50 transition-opacity"
          style={{ background: '#3fb950', color: '#0d1117' }}
        >
          Approve
        </button>
        <button
          data-testid="steering-approve-steer"
          onClick={() => void approveWithSteer()}
          disabled={loading || !amend.trim()}
          className="rounded-lg px-3 py-2 text-xs font-semibold font-mono disabled:opacity-50 transition-opacity"
          style={{ background: '#ffda19', color: '#0d1117' }}
        >
          Approve + steer
        </button>
        <button
          data-testid="steering-reject"
          onClick={() => void reject()}
          disabled={loading}
          className="rounded-lg px-3 py-2 text-xs font-semibold font-mono disabled:opacity-50 transition-opacity"
          style={{ background: 'rgba(248,81,73,0.15)', border: '1px solid rgba(248,81,73,0.3)', color: '#f85149' }}
        >
          Reject
        </button>
        <button
          data-testid="steering-cancel"
          onClick={() => void cancel()}
          disabled={loading}
          className="rounded-lg px-3 py-2 text-xs font-semibold font-mono disabled:opacity-50 transition-opacity"
          style={{ background: 'rgba(139,148,158,0.12)', border: '1px solid rgba(139,148,158,0.25)', color: 'rgba(139,148,158,0.9)' }}
        >
          Cancel run
        </button>
      </div>

      {/* Mode-selector note: workflow gates are always HITL regardless of run-level human_confirm */}
      <p className="text-[10px] font-mono mt-2" style={{ color: 'rgba(230,237,243,0.25)' }}>
        Workflow-declared gate — run-level human_confirm setting does not apply here.
      </p>
    </div>
  );
}
