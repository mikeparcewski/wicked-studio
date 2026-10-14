import { useMemo } from 'react';
import type { SessionView as RunView } from '../../api/types.js';
import { decideGate, IDLE_GATE_ACTION, useGateActionStore } from '../../board/gateActions.js';
import type { ArtifactBinding, RunHostContext } from '../../editors/hostApi.js';
import { useHostChrome } from '../../editors/hostApi.js';
import { useGateStore } from '../../store/gates.js';

/**
 * H3 (HOST-API §6): what the run page supplies to the editor host — the run, its current phase (the
 * full-screen header), the open gate's host controls (the card footer and the full-screen header), and
 * the chat drawer's body. The run's details themselves are the panel's Run tab (`RunTab`).
 */

const TERMINAL = new Set(['completed', 'cancelled', 'failed']);

/** The run the page is about: the newest still going, else the newest. */
export function primaryRunOf(runs: readonly RunView[]): RunView | null {
  return [...runs].reverse().find((v) => !TERMINAL.has(v.session.status)) ?? runs[runs.length - 1] ?? null;
}

/** The run an artifact belongs to: its binding's run (artifact keys lead with it), else the page's. */
function runOfBinding(binding: ArtifactBinding, runs: readonly RunView[]): RunView | null {
  const id = binding.runId ?? binding.artifactKey.split(':')[0] ?? '';
  return runs.find((v) => v.session.id === id) ?? null;
}

/**
 * The open gate's host controls for an artifact. Approve goes through the same queued, undoable decision
 * every gate card uses (`decideGate`); everything else — Send back with a note, Reassign, Stop, a deliver
 * gate's push — is answered on the gate card in the thread, so this offers the way there, never a second
 * copy of that card. Nothing here is the plugin's: it is drawn from run state (DES §5.2).
 */
export function GateButtons({ runId }: { runId: string }): React.ReactElement | null {
  const gate = useGateStore((s) => s.gates[runId]);
  const action = useGateActionStore((s) => s.byGate[runId] ?? IDLE_GATE_ACTION);
  if (gate === undefined) return null;
  const busy = action.queued || action.busy || action.answered !== null;
  const toThread = (): void => {
    useHostChrome.getState().exitFull();
    // The gate card leads its run's block in the thread (run clarity): bring it into view and focus it.
    const block = [...document.querySelectorAll<HTMLElement>('[data-testid="session-run"]')].find((b) => b.dataset['runId'] === runId);
    block?.scrollIntoView({ block: 'start' });
    block?.querySelector<HTMLElement>('button, textarea')?.focus();
  };
  return (
    <span data-testid="run-gate-actions" data-run-id={runId} className="wk-run-gate-actions">
      {gate.gateKind !== 'deliver' && gate.gateKind !== 'plan_approval' && (
        <button type="button" data-testid="run-gate-approve" disabled={busy} onClick={() => { void decideGate(runId, { approve: true }); }} className="wk-btn wk-btn--primary wk-btn--sm">
          {action.queued ? 'Approving…' : 'Approve'}
        </button>
      )}
      <button type="button" data-testid="run-gate-open" onClick={toThread} className="wk-btn wk-btn--secondary wk-btn--sm">
        {gate.gateKind === 'deliver' || gate.gateKind === 'plan_approval' ? 'Answer in the thread' : 'Send back or more'}
      </button>
    </span>
  );
}

/** The phase a live run is in, for the full-screen header: its current step's phase, in plain words. */
export function phaseOf(view: RunView | null): string | null {
  if (view === null || TERMINAL.has(view.session.status)) return null;
  const unit = view.units.find((u) => u.ord === view.session.unit_ix);
  const raw = unit?.phase_ref ?? unit?.stage ?? null;
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const words = raw.replace(/[-_]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The run host context for the page's artifacts. `renderChat` is the session's compact thread. */
export function useRunHostValue(runs: readonly RunView[], renderChat: () => React.ReactNode): RunHostContext {
  const primary = primaryRunOf(runs);
  const phase = phaseOf(primary);
  return useMemo<RunHostContext>(() => ({
    runId: primary?.session.id ?? null,
    phase,
    renderChat,
    gateActions: (binding) => {
      const run = runOfBinding(binding, runs) ?? primary;
      return run === null ? null : <GateButtons runId={run.session.id} />;
    },
    liveFrameCap: 6,
  }), [primary, phase, renderChat, runs]);
}
