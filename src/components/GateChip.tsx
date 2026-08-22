import {
  decideGate,
  GATE_HASH,
  gateOpenPath,
  IDLE_GATE_ACTION,
  useGateActionStore,
} from '../board/gateActions.js';
import type { Navigate } from '../hooks/useRoute.js';
import { isSimpleGate, type OpenGate } from '../store/gates.js';

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

/** One-shot focus intent for the thread's gate card, read by `SteeringGate`.
 *  (Slice H moved the definition into `gateActions.ts` — the shared action
 *  module — and this re-export keeps the chip's old importers working.) */
export { GATE_HASH };

// DES-VISION-001 §5.1: the gate chip is STATUS furniture, not accent — amber
// `--status-gate` on `--status-gate-dim`, with the answer buttons in the run
// (emerald) and fail (red) status pairs. Every color is a semantic token (§2.11).
const BTN: React.CSSProperties = {
  fontSize: 'var(--text-2xs)', fontFamily: 'var(--font-mono)', borderRadius: 'var(--radius-sm)',
  padding: '2px 6px', border: '1px solid transparent', cursor: 'pointer', flexShrink: 0,
};

const CSS = {
  wrap: { display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0, flexWrap: 'nowrap' },
  label: {
    fontSize: 'var(--text-2xs)', fontFamily: 'var(--font-mono)',
    color: 'var(--status-gate)', fontWeight: 'var(--weight-bold)',
  },
  approve: {
    ...BTN, background: 'var(--status-run-dim)',
    borderColor: 'var(--status-run-dim)', color: 'var(--status-run)',
  },
  reject: {
    ...BTN, background: 'var(--status-fail-dim)',
    borderColor: 'var(--status-fail-dim)', color: 'var(--status-fail)',
  },
  open: {
    ...BTN, textDecoration: 'none', background: 'var(--status-gate-dim)',
    borderColor: 'var(--status-gate-dim)', color: 'var(--status-gate)',
  },
  error: {
    fontSize: 'var(--text-2xs)', fontFamily: 'var(--font-mono)', color: 'var(--status-fail)',
    maxWidth: '92px', flexShrink: 1,
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
  // The decision state is SHARED with the palette verbs and the triage keys
  // (slice H, §2.3): one `decideGate` per gate, whoever fires it — so a
  // keyboard approve shows its "answering…"/answered/error states right here
  // on the chip, and the double-submit guard holds across input methods.
  const { busy, answered, error } = useGateActionStore((s) => s.byGate[runId]) ?? IDLE_GATE_ACTION;

  if (!isSimpleGate(gate)) {
    // The gate MESSAGE is the destination, not just the run — the hash is what tells
    // the thread's gate card to scroll itself in and take focus.
    const path = gateOpenPath(projectId, runId);
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

  // The double-submit guard, the gate-store prune, and the §3.3 error naming
  // all live in `decideGate` now — one implementation for every input method.
  const answer = (approve: boolean): void => {
    void decideGate(runId, { approve });
  };

  if (answered !== null) {
    return (
      <span style={CSS.wrap} data-testid={`gate-answered-${runId}`}>
        <span style={{ ...CSS.label, color: 'var(--ink-muted)', fontWeight: 'var(--weight-normal)' }}>{answered} · advancing…</span>
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
        onClick={() => answer(true)}
        disabled={busy}
        title={error !== null ? 'Retry approve' : gate?.prompt ?? 'Approve this gate'}
        style={{ ...CSS.approve, opacity: busy ? 0.5 : 1 }}
      >
        Approve
      </button>
      <button
        type="button"
        data-testid={`gate-reject-${runId}`}
        onClick={() => answer(false)}
        disabled={busy}
        title={error !== null ? 'Retry reject' : 'Reject this gate'}
        style={{ ...CSS.reject, opacity: busy ? 0.5 : 1 }}
      >
        Reject
      </button>
    </span>
  );
}
