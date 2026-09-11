import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';
import type { RosterSeat } from '../api/types.js';
import { getCachedRoster, setCachedRoster, subscribeRoster } from '../store/rosterCache.js';
import { useSteeringStore } from '../store/steering.js';
import { reassignCandidates } from './gateVerdictModel.js';

/**
 * "Reassign to <seat> + retry" on a FAILURE-ESCALATION gate (acceptance finding F-7R2-007).
 *
 * At every "Unit N failed and triage escalated" gate the card offered Approve (a retry on the
 * SAME dead seat — it looped), Approve + steer, Reject and Cancel; the operator recovered five
 * times by hand with `POST /api/v1/runs/:id/reassign {cli}` (crew#442), racing the ~20 s window
 * in which the re-dispatched dead seat fails again. This is that lever, on the card, in the
 * order the daemon requires:
 *
 *   1. approve the retry (`POST /runs/:id/gate {approve:true[, amend]}`) — the reassign route
 *      refuses a run that is not `executing` (409), and an awaiting-human run is not;
 *   2. wait for the run to resume (`GET /runs/:id` until `status === 'executing'`, bounded);
 *   3. reassign the cursor unit (`POST /runs/:id/reassign {cli}`) — the engine's `reassignUnit`,
 *      the same path the stall watchdog's automatic escalation takes.
 *
 * Every step is stated on the card as it happens; a reassign that the daemon refuses leaves the
 * approve standing (it already happened — said so), shows the daemon's sentence and offers the
 * reassign alone again. The seat list is the run's OWN pool minus the failed seat, each with the
 * roster's word (signed in first; signed-out seats say "will be benched" — the council rule).
 *
 * Wire gap, recorded: the reassign route only targets an `executing` run, so the approve must
 * precede it and the window between the two is the engine's re-dispatch — crew letting
 * `POST /runs/:id/reassign` target an `awaiting_human` run would make this one call.
 */

export interface ReassignControlProps {
  runId: string;
  ord: number | undefined;
  /** The run's seat pool (`SessionView.session.clis`). */
  pool: readonly string[];
  /** The seat that failed this unit (`units[ord].assigned_cli`) — excluded from the offer. */
  failedCli: string | null;
  /** The steer text to ride the approve, when the operator typed one. */
  amend?: string;
  /** The whole sequence succeeded: the gate is answered and the unit moved. The host clears the gate. */
  onDone: (cli: string) => void;
  /** Compact dress for the inbox card. */
  compact?: boolean;
}

type Phase = 'idle' | 'approving' | 'waiting' | 'reassigning' | 'done' | 'failed';

/** How many status reads the resume wait makes before giving up (× the poll interval). */
export const RESUME_POLLS = 24;

/** The resume wait's poll interval — one knob, so tests do not wait real seconds. */
export const reassignPolling = { intervalMs: 500 };

const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export function ReassignControl({
  runId, ord, pool, failedCli, amend, onDone, compact = false,
}: ReassignControlProps): React.ReactElement | null {
  const recordSteering = useSteeringStore((s) => s.record);
  const [roster, setRoster] = useState<RosterSeat[] | null>(getCachedRoster);
  // The roster's word on each seat: the shared cache when warm (the rail / the composer read it),
  // one read here when cold — the labels are what make the pick honest, so they are worth it.
  useEffect(() => {
    const unsubscribe = subscribeRoster(setRoster);
    if (getCachedRoster() !== null) return unsubscribe;
    let cancelled = false;
    Promise.resolve()
      .then(() => api.getRoster())
      .then(({ roster: seats }) => { if (!cancelled) { setCachedRoster(seats); setRoster(seats); } })
      .catch(() => { /* cold roster: the seats are offered by key, unlabelled — never invented */ });
    return () => { cancelled = true; unsubscribe(); };
  }, []);

  const candidates = useMemo(() => reassignCandidates(pool, failedCli, roster), [pool, failedCli, roster]);
  const [seat, setSeat] = useState<string>('');
  const chosen = candidates.find((c) => c.cli === seat) ?? candidates[0];
  const [phase, setPhase] = useState<Phase>('idle');
  const [approved, setApproved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = phase === 'approving' || phase === 'waiting' || phase === 'reassigning';

  if (candidates.length === 0) {
    return (
      <p data-testid="steering-reassign-none" className="text-[10px] font-mono mb-3" style={{ color: 'var(--ink-dim)', margin: '0 0 12px' }}>
        {pool.length === 0
          ? 'reassign: this run\'s seat pool is not on the wire, so no other seat can be offered'
          : `reassign: no other seat in this run's pool${failedCli !== null ? ` (only ${failedCli}, which failed)` : ''}`}
      </p>
    );
  }

  async function reassignOnly(cli: string): Promise<void> {
    setPhase('reassigning');
    setError(null);
    try {
      await api.reassignRun(runId, cli);
      recordSteering({ runId, action: 'reassign', cli, ...(typeof ord === 'number' ? { ord } : {}) });
      setPhase('done');
      onDone(cli);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase('failed');
    }
  }

  async function go(): Promise<void> {
    if (busy || chosen === undefined) return;
    const cli = chosen.cli;
    setError(null);
    try {
      if (!approved) {
        setPhase('approving');
        const text = amend?.trim() ?? '';
        await api.confirmGate(runId, { approve: true, ...(text !== '' ? { amend: text } : {}) });
        setApproved(true);
      }
      // The daemon reassigns only an EXECUTING run: wait for the approve to take.
      setPhase('waiting');
      let executing = false;
      for (let i = 0; i < RESUME_POLLS; i += 1) {
        const { run } = await api.getRun(runId);
        const status = run.session.status;
        if (status === 'executing') { executing = true; break; }
        if (TERMINAL.has(status)) throw new Error(`the run is ${status} — nothing left to reassign`);
        await sleep(reassignPolling.intervalMs);
      }
      if (!executing) throw new Error('the run did not resume in time — reassign again once it is executing');
      await reassignOnly(cli);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase('failed');
    }
  }

  const statusWord: Record<Phase, string | null> = {
    idle: null,
    approving: 'approving the retry…',
    waiting: 'approved — waiting for the run to resume…',
    reassigning: `reassigning to ${chosen?.label ?? seat}…`,
    done: `reassigned to ${chosen?.label ?? seat} — the retry runs there`,
    failed: approved ? 'the retry was approved; the reassign did not land' : 'nothing changed',
  };
  const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)', fontSize: compact ? 'var(--text-2xs)' : 'var(--text-xs)' };

  return (
    <div
      data-testid="steering-reassign-row"
      data-phase={phase}
      data-approved={approved}
      className="mb-3 flex flex-col gap-1.5"
      style={{ padding: compact ? '6px 8px' : '8px 10px', borderRadius: 'var(--radius-md)',
               background: 'var(--surface-raised)', border: '1px solid var(--status-gate-dim)' }}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span style={{ ...mono, color: 'var(--ink-muted)' }}>
          {failedCli !== null ? `${failedCli} failed this unit — ` : ''}retry on another seat:
        </span>
        <select
          data-testid="steering-reassign-seat"
          value={chosen?.cli ?? ''}
          disabled={busy || phase === 'done'}
          onChange={(e) => setSeat(e.target.value)}
          aria-label="Seat to reassign the unit to"
          style={{ ...mono, background: 'var(--surface-base)', color: 'var(--ink-high)',
                   border: '1px solid var(--surface-overlay)', borderRadius: 'var(--radius-sm)', padding: '2px 6px' }}
        >
          {candidates.map((c) => (
            <option key={c.cli} value={c.cli} data-state={c.state} data-testid="steering-reassign-option">
              {c.label}{c.note !== '' ? ` — ${c.note}` : ''}
            </option>
          ))}
        </select>
        <button
          type="button"
          data-testid="steering-reassign"
          data-seat={chosen?.cli}
          disabled={busy || phase === 'done'}
          onClick={() => void go()}
          title="Approve the retry, then move this unit to the chosen seat (POST /runs/:id/reassign) once the run resumes"
          className="rounded-lg px-3 py-1.5 font-semibold disabled:opacity-50 transition-opacity"
          style={{ ...mono, background: 'var(--status-gate)', color: 'var(--surface-base)', border: 'none', cursor: busy ? 'default' : 'pointer' }}
        >
          {busy ? 'Reassigning…' : `Reassign to ${chosen?.label ?? seat} + retry`}
        </button>
      </div>
      {chosen !== undefined && chosen.state === 'signed-out' && phase === 'idle' && (
        <p data-testid="steering-reassign-benched" style={{ ...mono, color: 'var(--status-gate)', margin: 0 }}>
          {chosen.label} is signed out — a council benches it; the retry may fall back or fail there.
        </p>
      )}
      {statusWord[phase] !== null && (
        <p data-testid="steering-reassign-status" style={{ ...mono, color: phase === 'failed' ? 'var(--status-fail)' : phase === 'done' ? 'var(--status-run)' : 'var(--ink-muted)', margin: 0 }}>
          {statusWord[phase]}
        </p>
      )}
      {error !== null && (
        <div className="flex items-center gap-2 flex-wrap">
          <span data-testid="steering-reassign-error" style={{ ...mono, color: 'var(--status-fail)' }}>{error}</span>
          {approved && chosen !== undefined && (
            <button
              type="button"
              data-testid="steering-reassign-retry"
              onClick={() => void reassignOnly(chosen.cli)}
              className="underline"
              style={{ ...mono, background: 'transparent', border: 'none', color: 'var(--status-fail)', cursor: 'pointer', padding: 0 }}
            >
              reassign again
            </button>
          )}
        </div>
      )}
    </div>
  );
}
