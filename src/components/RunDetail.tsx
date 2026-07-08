import { useState } from 'react';
import { api } from '../api/client.js';
import type { HumanConfirm, SessionView } from '../api/types.js';
import { useGateStore } from '../store/gates.js';
import { useRuntimeStore } from '../store/runtime.js';
import { STATUS_STYLE } from './RunCard.js';
import { SteeringGate } from './SteeringGate.js';
import { UnitList } from './UnitList.js';
import { LiveOutput } from './LiveOutput.js';
import { FailureBanner } from './FailureBanner.js';
import { CampaignDagStub } from './CampaignDagStub.js';
import { TerminalStub } from './TerminalStub.js';

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

export function RunDetail({ view, onRefresh }: Props): React.ReactElement {
  const { session } = view;
  const gate = useGateStore((s) => s.gates[session.id]);
  const log = useRuntimeStore((s) => s.logs[session.id]) ?? [];
  const [resuming, setResuming] = useState(false);

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

      <details className="text-xs">
        <summary className="cursor-pointer text-gray-400">Deferred surfaces</summary>
        <div className="mt-2 flex flex-col gap-2">
          <CampaignDagStub />
          <TerminalStub />
        </div>
      </details>
    </div>
  );
}
