import { useState } from 'react';
import { api } from '../api/client.js';
import { modePath, type Navigate } from '../hooks/useRoute.js';
import { isSimpleGate, useGateStore, type OpenGate } from '../store/gates.js';

/**
 * A waiting gate on a board card, rendered as an ANSWERABLE chip rather than a
 * badge (DES-MERGE-001 §1.4: "answering a simple gate must not require entering
 * the project").
 *
 * Which of the two shapes it takes is §7.11's heuristic, `isSimpleGate`:
 *
 * - **simple** (≤2 choices, no free text) — approve/reject right here, through the
 *   same `POST /runs/:id/gate` the thread's `SteeringGate` uses. Answering NEVER
 *   navigates: the card reflects the run advancing in place, because the daemon's
 *   `resumed` / `runCancelled` frame lands on the shared socket the board already
 *   subscribes to (slice 6) and takes the run off `awaiting_human`;
 * - **complex** — a deep link into the thread with `#gate`, where the full card
 *   (steer text, coverage stats, the footnote) is. Nothing on a fixed-height board
 *   card can answer a question that needs prose.
 *
 * Both states obey §3.3: in flight, the chip says what it is doing; on failure it
 * NAMES the error with the controls still adjacent — clicking again is the retry.
 */

/** One-shot focus intent for the thread's gate card, read by `SteeringGate`. */
export const GATE_HASH = '#gate';

const S = {
  accent: '#ffda19',
  green:  '#3fb950',
  red:    '#f85149',
  muted:  'rgba(230,237,243,0.55)',
};

const BTN: React.CSSProperties = {
  fontSize: '10px', fontFamily: 'monospace', borderRadius: '4px', padding: '2px 6px',
  border: '1px solid transparent', cursor: 'pointer', flexShrink: 0,
};

const CSS = {
  wrap: { display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0, flexWrap: 'nowrap' },
  label: { fontSize: '10px', fontFamily: 'monospace', color: S.accent, fontWeight: 700 },
  approve: { ...BTN, background: 'rgba(63,185,80,0.15)', borderColor: 'rgba(63,185,80,0.35)', color: S.green },
  reject:  { ...BTN, background: 'rgba(248,81,73,0.12)', borderColor: 'rgba(248,81,73,0.3)', color: S.red },
  open: {
    ...BTN, textDecoration: 'none', background: 'rgba(255,218,25,0.12)',
    borderColor: 'rgba(255,218,25,0.35)', color: S.accent,
  },
  error: {
    fontSize: '10px', fontFamily: 'monospace', color: S.red, maxWidth: '92px', flexShrink: 1,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
} as const satisfies Record<string, React.CSSProperties>;

interface Props {
  runId: string;
  projectId: string;
  /** The cached gate, or `undefined` when the daemon restarted (§3.3 known limit). */
  gate: OpenGate | undefined;
  navigate: Navigate;
}

export function GateChip({ runId, projectId, gate, navigate }: Props): React.ReactElement {
  const clearGate = useGateStore((s) => s.clearGate);
  const [busy, setBusy] = useState(false);
  const [answered, setAnswered] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!isSimpleGate(gate)) {
    // The gate MESSAGE is the destination, not just the run — the hash is what tells
    // the thread's gate card to scroll itself in and take focus.
    const path = `${modePath(projectId, 'build', runId)}${GATE_HASH}`;
    return (
      <span style={CSS.wrap}>
        <span style={CSS.label}>gate</span>
        <a
          href={path}
          onClick={(e) => { e.preventDefault(); navigate(path); }}
          data-testid={`gate-open-${runId}`}
          title={gate?.prompt ?? 'Open this gate in the thread'}
          style={CSS.open}
        >
          Answer ›
        </a>
      </span>
    );
  }

  async function answer(approve: boolean): Promise<void> {
    // The one double-submit guard: a second click while the first POST is open, or
    // after it landed, is dropped rather than sent (a re-sent gate decision is a 409
    // at best and a second, unintended decision at worst).
    if (busy || answered !== null) return;
    setBusy(true);
    setError(null);
    try {
      await api.confirmGate(runId, { approve });
      setAnswered(approve ? 'approved' : 'rejected');
      // Prune the local gate immediately; the run's own status follows from the
      // daemon's frame, which is what actually moves the card (§1.4 live).
      clearGate(runId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (answered !== null) {
    return (
      <span style={CSS.wrap} data-testid={`gate-answered-${runId}`}>
        <span style={{ ...CSS.label, color: S.muted, fontWeight: 400 }}>{answered} · advancing…</span>
      </span>
    );
  }

  return (
    <span style={CSS.wrap} data-testid={`gate-chip-${runId}`}>
      <span style={CSS.label}>{busy ? 'answering…' : 'gate'}</span>
      {error !== null && (
        <span data-testid={`gate-error-${runId}`} title={`Could not answer the gate: ${error} — try again`} style={CSS.error}>
          {error}
        </span>
      )}
      <button
        type="button"
        data-testid={`gate-approve-${runId}`}
        onClick={() => void answer(true)}
        disabled={busy}
        title={error !== null ? 'Retry approve' : gate?.prompt ?? 'Approve this gate'}
        style={{ ...CSS.approve, opacity: busy ? 0.5 : 1 }}
      >
        Approve
      </button>
      <button
        type="button"
        data-testid={`gate-reject-${runId}`}
        onClick={() => void answer(false)}
        disabled={busy}
        title={error !== null ? 'Retry reject' : 'Reject this gate'}
        style={{ ...CSS.reject, opacity: busy ? 0.5 : 1 }}
      >
        Reject
      </button>
    </span>
  );
}
