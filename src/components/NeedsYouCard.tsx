import { useMemo, useState } from 'react';
import { api } from '../api/client.js';
import type { SessionView } from '../api/types.js';
import { useRunEventStore } from '../store/events.js';
import { needsYouOf, type NeedsYouState } from '../store/stallEscalations.js';
import { phaseLabel } from './gateVerdictModel.js';

/**
 * The run page's needs-you card (studio#284): the stall watchdog spent its automatic recoveries
 * and handed the run to a human. Before this card the page showed an executing run with no gate,
 * no reason and only Cancel — and after a reload, not even the feed line.
 *
 * It reads the run's structured log (`useRunEventStore`), which both the live socket and the
 * reload's `GET /runs/:id/events` feed — crew persists the watchdog's frames there
 * (`api/stall-frame-index.ts`) — through the same fold as the needs-you queue ({@link needsYouOf}).
 * The arms are the ones the daemon offers an executing run: reassign the cursor unit (the engine's
 * `reassignUnit`, the path the watchdog itself takes) and, for an agent unit, a nudge message.
 */

/** The run's standing needs-you state, or null when nothing needs the human (or the run has moved
 *  on: a gate, a terminal status). */
export function useNeedsYouState(view: SessionView | undefined): NeedsYouState | null {
  const id = view?.session.id;
  const events = useRunEventStore((s) => (id === undefined ? undefined : s.byRun[id]));
  return useMemo(() => {
    if (view === undefined || events === undefined) return null;
    if (view.session.status !== 'executing') return null;
    return needsYouOf(events);
  }, [view, events]);
}

/** "silent 30 min" — the watchdog's own clock, rounded to whole minutes (≥1). */
function silentFor(quietForMs: number | null): string {
  return quietForMs === null ? 'silent' : `silent ${Math.max(1, Math.round(quietForMs / 60_000))} min`;
}

/** The seat chain the recoveries walked: `bash → claude → codex`. */
function seatChain(state: NeedsYouState): string | null {
  const chain: string[] = [];
  for (const r of state.recoveries) {
    if (chain.length === 0 && r.previousCli !== null) chain.push(r.previousCli);
    if (r.cli !== null && chain[chain.length - 1] !== r.cli) chain.push(r.cli);
  }
  return chain.length > 1 ? chain.join(' → ') : null;
}

/** The card's headline: "Needs you: unit 5 (deliver) silent 30 min; 2 automatic recoveries spent (bash → claude → codex)". */
export function needsYouHeadline(state: NeedsYouState, phase: string | null): string {
  const unit = state.ord === null ? 'the run' : `unit ${state.ord}${phase !== null ? ` (${phase})` : ''}`;
  const n = state.recoveries.length;
  const chain = seatChain(state);
  const recoveries =
    n === 0
      ? 'no automatic recovery was made'
      : `${n} automatic recover${n === 1 ? 'y' : 'ies'} spent${chain !== null ? ` (${chain})` : ''}`;
  return `Needs you: ${unit} ${silentFor(state.quietForMs)}; ${recoveries}`;
}

const NUDGE =
  'The operator is checking in: you have been silent for a long time. Continue the task, or say what is blocking you.';

type Busy = null | 'reassign' | 'nudge';

export function NeedsYouCard({ view, state }: { view: SessionView; state: NeedsYouState }): React.ReactElement {
  const runId = view.session.id;
  const [busy, setBusy] = useState<Busy>(null);
  const [note, setNote] = useState<{ tone: 'ok' | 'fail'; text: string } | null>(null);
  const unit = state.ord === null ? undefined : view.units.find((u) => u.ord === state.ord);
  const phase = state.ord === null ? null : phaseLabel(runId, view.units, state.ord);
  const toolCmd = Array.isArray(unit?.tool_cmd) && unit.tool_cmd.length > 0 ? unit.tool_cmd.join(' ') : null;

  const act = async (kind: Exclude<Busy, null>): Promise<void> => {
    setBusy(kind);
    setNote(null);
    try {
      if (kind === 'reassign') {
        const r = await api.reassignRun(runId);
        setNote({ tone: 'ok', text: `Unit ${r.ord} re-dispatched${r.cli !== undefined ? ` to ${r.cli}` : ''}.` });
      } else {
        await api.injectMessage(runId, NUDGE, 'all');
        setNote({ tone: 'ok', text: 'Message sent to the worker.' });
      }
    } catch (e) {
      setNote({ tone: 'fail', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  const button: React.CSSProperties = {
    fontSize: 'var(--text-xs)', padding: '4px 10px', borderRadius: 'var(--radius-md)',
    border: '1px solid var(--status-gate)', background: 'var(--surface-raised)', color: 'var(--ink-high)',
    cursor: busy === null ? 'pointer' : 'default',
  };

  return (
    <section
      data-testid="needs-you-card"
      aria-label="This run needs you"
      className="flex flex-col gap-2"
      style={{
        background: 'var(--status-gate-dim)', border: '1px solid var(--status-gate)',
        borderRadius: 'var(--radius-lg)', padding: '10px 12px',
      }}
    >
      <p data-testid="needs-you-headline" style={{ margin: 0, fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semi)', color: 'var(--ink-high)' }}>
        {needsYouHeadline(state, phase)}
      </p>
      <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--ink-body)' }}>
        {state.outcome === 'exhausted'
          ? 'The stall watchdog spent its automatic recoveries; nothing more happens until you act.'
          : 'The stall watchdog could not recover this run on its own.'}
      </p>
      {toolCmd !== null && (
        <p data-testid="needs-you-command" style={{ margin: 0, fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', color: 'var(--ink-muted)' }}>
          running: {toolCmd}
        </p>
      )}
      <div className="flex items-center gap-2">
        <button type="button" data-testid="needs-you-reassign" disabled={busy !== null} style={button} onClick={() => void act('reassign')}>
          {busy === 'reassign' ? 'Reassigning…' : 'Reassign the unit'}
        </button>
        {toolCmd === null && (
          <button type="button" data-testid="needs-you-nudge" disabled={busy !== null} style={button} onClick={() => void act('nudge')}>
            {busy === 'nudge' ? 'Sending…' : 'Nudge the worker'}
          </button>
        )}
      </div>
      {note !== null && (
        <p
          data-testid="needs-you-note"
          role={note.tone === 'fail' ? 'alert' : 'status'}
          style={{ margin: 0, fontSize: 'var(--text-xs)', color: note.tone === 'fail' ? 'var(--status-fail)' : 'var(--ink-muted)' }}
        >
          {note.text}
        </p>
      )}
    </section>
  );
}
