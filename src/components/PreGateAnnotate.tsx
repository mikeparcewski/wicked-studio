import { useCallback, useEffect, useRef, useState } from 'react';
import { SCOPE_LABEL, useAnnotationStore } from '../store/annotations.js';
import { useSteerPrefixes } from '../hooks/useSteerPrefixes.js';

/**
 * The pre-gate annotation widget (DES-UX-002 §4.3, slice BD): compose gate
 * guidance from the home board, BEFORE any gate exists. The draft lives in the
 * session-scoped client store (`annotations.ts` — wire verdict CLIENT, §4.2)
 * and pre-populates the gate card's steer textarea when a gate arrives (EC51).
 *
 * COPY SHAPED TO THE MEASURED TRUTH (see annotations.ts): escalation-to-gate
 * windows on the live daemon are milliseconds, so this widget never pretends
 * there is an "approach" to annotate during — it offers a note for the run's
 * NEXT gate, available on any live run at any time. The gate-approaching chip
 * (slice BA) is an entry point that opens it, not its lifetime.
 *
 * Tokens (§4.4): `--surface-raised` ground, `--ink-muted` placeholder,
 * `--ink-dim --text-2xs` session-scope label (EC52's honest copy, verbatim).
 */

const CSS = {
  affordance: {
    display: 'inline-flex', alignItems: 'center', gap: '4px', cursor: 'pointer',
    background: 'transparent', border: 'none', padding: '2px 0',
    fontSize: 'var(--text-2xs)', fontFamily: 'var(--font-mono)', color: 'var(--ink-muted)',
  },
  wrap: {
    background: 'var(--surface-raised)', borderRadius: 'var(--radius-md)',
    padding: '6px 8px',
  },
  textarea: {
    width: '100%', resize: 'none', background: 'transparent', border: 'none',
    outline: 'none', padding: 0, fontSize: 'var(--text-xs)',
    fontFamily: 'var(--font-mono)', color: 'var(--ink-high)',
  },
  label: {
    margin: '4px 0 0', fontSize: 'var(--text-2xs)', fontFamily: 'var(--font-mono)',
    color: 'var(--ink-dim)',
  },
} as const satisfies Record<string, React.CSSProperties>;

interface Props {
  runId: string;
  /** Bumped by an entry point (the gate-approaching chip) to open + focus. */
  openSignal?: number;
}

export function PreGateAnnotate({ runId, openSignal = 0 }: Props): React.ReactElement {
  const draft = useAnnotationStore((s) => s.drafts[runId]) ?? '';
  const setDraft = useAnnotationStore((s) => s.setDraft);
  // A card with a standing draft mounts open — the note is live state, not a
  // secret behind a click.
  const [open, setOpen] = useState(draft !== '');
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (openSignal > 0) {
      setOpen(true);
      // Focus after the textarea mounts.
      requestAnimationFrame(() => ref.current?.focus());
    }
  }, [openSignal]);

  const apply = useCallback(
    (text: string) => setDraft(runId, text),
    [setDraft, runId],
  );
  useSteerPrefixes(`annotate-${runId}`, ref, apply);

  if (!open) {
    return (
      <button
        type="button"
        data-testid="pre-gate-annotate"
        data-run-id={runId}
        data-open="false"
        title="Compose steer guidance now — it pre-fills the gate's steer box when a gate arrives"
        style={CSS.affordance}
        onClick={() => {
          setOpen(true);
          requestAnimationFrame(() => ref.current?.focus());
        }}
      >
        <span aria-hidden>+</span> steer note for the next gate
      </button>
    );
  }

  return (
    <div data-testid="pre-gate-annotate" data-run-id={runId} data-open="true" style={CSS.wrap}>
      <textarea
        ref={ref}
        data-testid="pre-gate-annotate-input"
        rows={Math.min(4, Math.max(3, draft.split('\n').length))}
        placeholder="Guidance for this run's next gate — pre-fills the steer box when a gate arrives"
        className="wk-annotate"
        style={CSS.textarea}
        value={draft}
        onChange={(e) => setDraft(runId, e.target.value)}
      />
      {/* EC52: the honest scope label — retired when CREW-UX-4 lands (slice BE). */}
      <p data-testid="annotation-scope-label" style={CSS.label}>
        {SCOPE_LABEL}
      </p>
    </div>
  );
}
