import { useMemo } from 'react';
import type { SessionView as RunView } from '../../api/types.js';
import { decideGate, IDLE_GATE_ACTION, useGateActionStore } from '../../board/gateActions.js';
import type { ArtifactBinding, RunHostContext } from '../../editors/hostApi.js';
import { useHostChrome } from '../../editors/hostApi.js';
import { useGateStore } from '../../store/gates.js';
import { recordingGateActions } from '../editorPorts/RecordingGateActions.js';

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

/** The run an artifact belongs to: its binding's run, else the run its key leads with (`artifactKey`
 *  writes `<runId>:…`). `undefined` = the artifact names no run; `null` = it names one this page does not
 *  hold — then it gets NO gate controls, never another run's (codex h3-r1 #1). */
function runOfBinding(binding: ArtifactBinding, runs: readonly RunView[]): RunView | null | undefined {
  const id = binding.runId ?? (binding.artifactKey.includes(':') ? binding.artifactKey.split(':')[0] : undefined);
  if (id === undefined || id === '') return undefined;
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
  // Fail closed (codex final review P1): the bare Approve is offered only for a gate KNOWN to be the plain
  // pre-run review (`def`) with the two plain answers. A gate whose kind is not known (a late join: GET
  // /runs/:id/gate carries none), a deliver or plan gate, an escalation, a consent, a free-text or
  // multi-choice gate is answered on its card in the thread, where its disclosures are.
  // `choices` absent is the plain gate's two answers; any named choices (even two) are the card's (codex fu r1 P1).
  const plainApprove = gate.gateKind === 'def' && gate.choices === undefined;
  const toThread = (): void => {
    useHostChrome.getState().exitFull();
    // The gate card leads its run's block in the thread (run clarity): bring it into view and focus it.
    const block = [...document.querySelectorAll<HTMLElement>('[data-testid="session-run"]')].find((b) => b.dataset['runId'] === runId);
    block?.scrollIntoView({ block: 'start' });
    block?.querySelector<HTMLElement>('button, textarea')?.focus();
  };
  return (
    <span data-testid="run-gate-actions" data-run-id={runId} className="wk-run-gate-actions">
      {plainApprove && (
        <button type="button" data-testid="run-gate-approve" disabled={busy} onClick={() => { void decideGate(runId, { approve: true }); }} className="wk-btn wk-btn--primary wk-btn--sm">
          {action.queued ? 'Approving…' : 'Approve'}
        </button>
      )}
      <button type="button" data-testid="run-gate-open" onClick={toThread} className="wk-btn wk-btn--secondary wk-btn--sm">
        {plainApprove ? 'Send back or more' : 'Answer in the thread'}
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
      const own = runOfBinding(binding, runs);
      const run = own === undefined ? primary : own;
      if (run === null) return null;
      // A recording (walkthrough, demo video) brings its own gate verbs — Ask helpers to fix, Edit the
      // check, Re-record this chapter — drawn from the run's state by the host (H6, RecordingGateActions);
      // they read the binding's run, which is the run resolved here (never another run's).
      const recording = recordingGateActions({ ...binding, runId: run.session.id }, run.units, undefined, true);
      return <>{recording}<GateButtons runId={run.session.id} /></>;
    },
    liveFrameCap: 6,
  }), [primary, phase, renderChat, runs]);
}
