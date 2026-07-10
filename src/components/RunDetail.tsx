import { useState } from 'react';
import { api } from '../api/client.js';
import type { HumanConfirm, SessionView } from '../api/types.js';
import { useGateStore } from '../store/gates.js';
import { useRuntimeStore } from '../store/runtime.js';
import { useRunModel } from '../hooks/useRunModel.js';
import { STATUS_STYLE } from './RunCard.js';
import { SteeringGate } from './SteeringGate.js';
import { UnitList } from './UnitList.js';
import { LiveOutput } from './LiveOutput.js';
import { FailureBanner } from './FailureBanner.js';
import { PhaseLadder } from './PhaseLadder.js';
import { InsightRail } from './InsightRail.js';
import { Terminal } from './Terminal.js';

interface Props {
  view: SessionView;
  /** Re-fetch the run list (after a gate/cancel/resume changes lifecycle state). */
  onRefresh: () => void;
}

const TERMINAL: ReadonlySet<string> = new Set(['completed', 'cancelled', 'failed']);

function confirmLabel(hc: HumanConfirm): string {
  if (hc === 'none') return 'none';
  if (hc === 'all') return 'every unit';
  return `before #${hc.before}`;
}

/**
 * The operator cockpit (DES-STUDIO-COCKPIT-001 §2): a three-pane run view. The left pane
 * (RunList + LaunchForm) lives in `App`; this renders the **center** (phase ladder + live
 * output + the steering gate surfaced as a card on AwaitingHuman) and the **right insight
 * rail** (tabbed panels), with the governed Terminal as a drawer.
 *
 * All panels are pure views over the merged {@link useRunModel} model — snapshot
 * (authoritative) + appended live events. Reused components (LiveOutput, SteeringGate,
 * Terminal, UnitList) keep their existing stores.
 */
export function RunDetail({ view, onRefresh }: Props): React.ReactElement {
  const { session } = view;
  const model = useRunModel(session.id, view);
  const gate = useGateStore((s) => s.gates[session.id]);
  const log = useRuntimeStore((s) => s.logs[session.id]) ?? [];
  const [resuming, setResuming] = useState(false);
  const [termOpen, setTermOpen] = useState(false);
  // Loud, explicit, off-by-default opt-in for the ungoverned operator shell (§7).
  const [ungoverned, setUngoverned] = useState(false);

  const style = STATUS_STYLE[session.status] ?? { label: session.status, className: 'text-gray-500' };
  const isTerminal = TERMINAL.has(session.status);
  const canResume = !isTerminal && session.status !== 'awaiting_human';

  async function resume(): Promise<void> {
    setResuming(true);
    try {
      await api.resumeRun(session.id);
      onRefresh();
    } finally {
      setResuming(false);
    }
  }

  return (
    <div className="flex flex-col gap-4" data-testid="run-detail" data-run-id={session.id}>
      <header>
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-base font-semibold">{session.problem}</h2>
          <span className={`text-sm font-medium shrink-0 ${style.className}`}>{style.label}</span>
        </div>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-gray-400">
          <span className="font-mono">{session.id}</span>
          <span>gate: {confirmLabel(session.human_confirm)}</span>
          <span>entity: {session.entity_mode}</span>
          {session.repo_ref && <span>repo: {session.repo_ref}</span>}
          <span>cursor: unit #{session.unit_ix}</span>
        </div>
      </header>

      <FailureBanner view={view} log={log} />

      {/* Cockpit: center (mechanics) + right insight rail. */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        {/* ── CENTER — mechanics ── */}
        <div className="flex min-w-0 flex-col gap-4" data-testid="cockpit-center">
          {model ? <PhaseLadder model={model} /> : <p className="text-xs text-gray-400">Loading run…</p>}

          {session.status === 'awaiting_human' && (
            <SteeringGate
              runId={session.id}
              {...(gate ? { ord: gate.ord, prompt: gate.prompt } : {})}
              onResolved={onRefresh}
            />
          )}

          {canResume && (
            <button
              type="button"
              data-testid="run-resume"
              onClick={() => void resume()}
              disabled={resuming}
              className="self-start rounded border border-gray-300 px-3 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            >
              {resuming ? 'Resuming…' : 'Resume from cursor'}
            </button>
          )}

          <section>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">
              Work units
            </p>
            <UnitList
              runId={session.id}
              units={view.units}
              onResolved={onRefresh}
              {...(gate ? { gateOrd: gate.ord } : {})}
            />
          </section>

          <LiveOutput runId={session.id} />

          {/* Terminal drawer. */}
          <section data-testid="terminal-section">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">
              Terminal
            </p>
            {termOpen ? (
              <div className="flex flex-col gap-2">
                <Terminal
                  // Remount (fresh PTY) if the governance mode toggles.
                  key={`${session.id}:${ungoverned ? 'ungoverned' : 'governed'}`}
                  cwd={session.workdir ?? '.'}
                  governed={!ungoverned}
                />
                <button
                  type="button"
                  data-testid="terminal-close"
                  onClick={() => setTermOpen(false)}
                  className="self-start rounded border border-gray-300 px-3 py-1 text-xs text-gray-600 hover:bg-gray-50"
                >
                  Close terminal
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  data-testid="terminal-open"
                  onClick={() => setTermOpen(true)}
                  className="rounded border border-gray-300 px-3 py-1 text-xs text-gray-600 hover:bg-gray-50"
                >
                  Open terminal
                </button>
                <label className="flex items-center gap-1.5 text-[11px] text-gray-500">
                  <input
                    type="checkbox"
                    data-testid="terminal-ungoverned"
                    checked={ungoverned}
                    onChange={(e) => setUngoverned(e.target.checked)}
                  />
                  <span className={ungoverned ? 'font-semibold text-amber-600' : ''}>
                    ungoverned operator shell (bypasses the gate-hook)
                  </span>
                </label>
              </div>
            )}
          </section>
        </div>

        {/* ── RIGHT — insight rail ── */}
        <aside className="min-w-0" data-testid="cockpit-rail">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-2">
            Insight
          </p>
          {model ? (
            <InsightRail model={model} />
          ) : (
            <p className="text-xs text-gray-400">Loading insight…</p>
          )}
        </aside>
      </div>
    </div>
  );
}
