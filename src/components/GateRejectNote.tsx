import { useEffect, useRef, useState } from 'react';
import { decideGate } from '../board/gateActions.js';

/**
 * The inline reject note (DES-FEEDBACK-002 §2.3, slice H): what `r` opens on a
 * selected simple-gate card, REPLACING the chip row while it is open —
 * `[ reason (optional) — ↵ reject · esc cancel ]`, focused immediately. Enter
 * sends `{approve:false}` through the shared `decideGate`, with the typed note
 * as `amend` when non-empty (the daemon's gate audit durably records it on the
 * decision — a real, recorded rejection reason). Escape closes the input and
 * restores the chip row, firing nothing.
 *
 * While this input is focused it IS a typing context: the §1.2 registry guard
 * makes j/k/a inert with no second mechanism (§2.3) — its own keydown handler
 * below is the input-local kind the EC21 grep exempts by construction (it is
 * not a window-level listener).
 *
 * Tokens (§2.5): `--surface-raised` ground, `--radius-md`, the input in
 * `--text-xs --font-sans --ink-high` (placeholder `--ink-dim`, via
 * `.wk-reject-note` in global.css), the confirm hint in
 * `--text-2xs --ink-dim --font-mono`.
 */

const CSS = {
  wrap: {
    display: 'flex', alignItems: 'center', gap: '6px', flex: 1,
    background: 'var(--surface-raised)', borderRadius: 'var(--radius-md)',
    padding: '3px 8px', minWidth: 0,
  },
  input: {
    flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none',
    fontSize: 'var(--text-xs)', fontFamily: 'var(--font-sans)', color: 'var(--ink-high)',
    padding: 0,
  },
  hint: {
    flexShrink: 0, fontSize: 'var(--text-2xs)', color: 'var(--ink-dim)',
    fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap',
  },
} as const satisfies Record<string, React.CSSProperties>;

interface Props {
  runId: string;
  onClose: () => void;
}

export function GateRejectNote({ runId, onClose }: Props): React.ReactElement {
  const [note, setNote] = useState('');
  const ref = useRef<HTMLInputElement>(null);

  // Focused immediately (§2.3) — which is also what flips the typing guard on.
  useEffect(() => {
    ref.current?.focus();
  }, []);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const amend = note.trim();
      void decideGate(runId, amend === '' ? { approve: false } : { approve: false, amend });
      onClose();
    } else if (e.key === 'Escape') {
      // Cancel fires nothing; stop the key here so no modal above hears it.
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };

  return (
    <div style={CSS.wrap} data-testid={`gate-reject-note-row-${runId}`}>
      <input
        ref={ref}
        type="text"
        className="wk-reject-note"
        data-testid="gate-reject-note"
        placeholder="reason (optional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={onKeyDown}
        style={CSS.input}
      />
      <span style={CSS.hint} aria-hidden>↵ reject · esc cancel</span>
    </div>
  );
}
