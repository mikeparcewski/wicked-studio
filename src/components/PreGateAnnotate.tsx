import { useEffect, useRef, useState } from 'react';
import { DRAFT_SCOPE_LABEL, useAnnotationStore } from '../store/annotations.js';
import { durableGuidance, useGuidanceStore } from '../store/guidance.js';
import { useSteerPrefixes } from '../hooks/useSteerPrefixes.js';

/**
 * The pre-gate annotation widget (DES-UX-002 §4.3 slice BD; §8.1 slice BE):
 * compose gate guidance from the home board, BEFORE any gate exists.
 *
 * Slice BE adopted the durable endpoint (CREW-UX-7, crew#312 — the doc's
 * "CREW-UX-4"; api/guidance.ts): the widget now reads the run DTO's
 * `guidance` field and pre-populates from it, the session draft layered ON
 * TOP (the newer local edit wins); a gesture-gated "save guidance" PUTs the
 * note so it survives tab close and reaches other sessions — multi-session
 * survival is the point. Feedback is point-of-action (EC37): saving/saved/a
 * named error beside the button. The old whole-widget session-scope label
 * retired with the gap; what remains session-scoped is exactly the unsaved
 * edit, and the EC52 label now names only that, only while one exists.
 *
 * COPY SHAPED TO THE MEASURED TRUTH (see annotations.ts): escalation-to-gate
 * windows on the live daemon are milliseconds, so this widget never pretends
 * there is an "approach" to annotate during — it offers a note for the run's
 * NEXT gate, available on any live run at any time. The gate-approaching chip
 * (slice BA) is an entry point that opens it, not its lifetime.
 *
 * Tokens (§4.4): `--surface-raised` ground, `--ink-muted` placeholder,
 * `--ink-dim --text-2xs` scope label (EC52's honest-split copy).
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
  footer: {
    display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px',
  },
  label: {
    margin: 0, fontSize: 'var(--text-2xs)', fontFamily: 'var(--font-mono)',
    color: 'var(--ink-dim)',
  },
  save: {
    background: 'transparent', border: '1px solid var(--surface-raised)',
    borderRadius: 'var(--radius-sm)', color: 'var(--ink-muted)', cursor: 'pointer',
    fontSize: 'var(--text-2xs)', fontFamily: 'var(--font-mono)', padding: '1px 8px',
  },
} as const satisfies Record<string, React.CSSProperties>;

interface Props {
  runId: string;
  /** The run DTO's durable note (CREW-UX-7 echo) — ABSENT when never set. */
  guidance?: string | undefined;
  /** Bumped by an entry point (the gate-approaching chip, the board's `n`) to open + focus. */
  openSignal?: number;
}

export function PreGateAnnotate({ runId, guidance, openSignal = 0 }: Props): React.ReactElement {
  const draft = useAnnotationStore((s) => s.drafts[runId]);
  const setDraft = useAnnotationStore((s) => s.setDraft);
  const mirror = useGuidanceStore((s) => s.saved);
  const saveState = useGuidanceStore((s) => s.saveState[runId]);
  const save = useGuidanceStore((s) => s.save);

  // Pre-population order (slice BE): the DURABLE note first, the session
  // draft ON TOP — the draft is the newer local edit when both exist.
  const durable = durableGuidance(runId, guidance, mirror) ?? '';
  // Local text is the render truth while mounted: the draft store cannot
  // spell "emptied on top of a durable note" (empty deletes the draft), so
  // the textarea owns its emptiness and a save of '' is the honest clear.
  const [text, setText] = useState(() => draft ?? durable);
  // An unsaved edit is what is still session-scoped — the EC52 label's whole
  // subject after BE, and the save button's arming condition.
  const dirty = text !== durable;
  // A widget holding a live note mounts open — state, not a secret.
  const [open, setOpen] = useState(text !== '');
  const ref = useRef<HTMLTextAreaElement>(null);
  // Focus intent, resolved AFTER the textarea commits (a rAF here would race
  // the mount — and the board's triage cursor refocuses the card on the very
  // click that opened us, so the focus must land after that, not before).
  const wantFocus = useRef(false);
  // Whether the operator has edited THIS mount (a standing draft counts): an
  // untouched widget adopts a durable note that arrives after mount (the DTO
  // echo rides the next /runs poll), while a touched one is never stomped —
  // including the deliberate emptied state on its way to a saved clear.
  const touched = useRef(draft !== undefined);

  useEffect(() => {
    if (!touched.current && text !== durable) {
      setText(durable);
      if (durable !== '') setOpen(true);
    }
    // `text` is deliberately not a dep: this reacts to the DURABLE note moving.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [durable]);

  useEffect(() => {
    if (openSignal > 0) {
      wantFocus.current = true;
      setOpen(true);
    }
  }, [openSignal]);

  useEffect(() => {
    if (open && wantFocus.current) {
      wantFocus.current = false;
      ref.current?.focus();
    }
  }, [open]);

  useSteerPrefixes(`annotate-${runId}`, ref);

  const apply = (next: string): void => {
    touched.current = true;
    setText(next);
    // The draft store keeps the newest edit across remounts (the board
    // windows cards); an emptied widget withdraws the draft, as before.
    setDraft(runId, next);
  };

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
          wantFocus.current = true;
          setOpen(true);
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
        rows={Math.min(4, Math.max(3, text.split('\n').length))}
        placeholder="Guidance for this run's next gate — pre-fills the steer box when a gate arrives"
        className="wk-annotate"
        style={CSS.textarea}
        value={text}
        onChange={(e) => apply(e.target.value)}
      />
      <div style={CSS.footer}>
        {/* Slice BE: the gesture-gated durable write (CREW-UX-7) — armed only
            by an unsaved edit; '' rides too (the honest clear). */}
        <button
          type="button"
          data-testid="save-guidance"
          disabled={!dirty || saveState?.phase === 'saving'}
          title="Save this note on the run — it survives this browser session and reaches other sessions"
          style={{ ...CSS.save, opacity: dirty ? 1 : 0.5 }}
          onClick={() => {
            void save(runId, text).then(() => {
              // On success the note is durable — the session draft has
              // nothing left to hold (clearing it also retires the label).
              if (useGuidanceStore.getState().saveState[runId]?.phase === 'saved') {
                useAnnotationStore.getState().clearDraft(runId);
              }
            });
          }}
        >
          save guidance
        </button>
        {/* EC37: point-of-action feedback, beside the gesture that fired. A
            stale "saved" says nothing under a NEWER unsaved edit — the scope
            label owns that state. */}
        {saveState !== undefined && !(saveState.phase === 'saved' && dirty) && (
          <span
            data-testid="guidance-save-state"
            data-phase={saveState.phase}
            style={{
              ...CSS.label,
              color: saveState.phase === 'error' ? 'var(--status-fail)' : 'var(--ink-dim)',
            }}
          >
            {saveState.phase === 'saving' && 'saving…'}
            {saveState.phase === 'saved' && !dirty && 'saved — survives this session'}
            {saveState.phase === 'error' && `save failed: ${saveState.detail}`}
          </span>
        )}
        {/* EC52 after BE: the label names ONLY what is still session-scoped —
            the unsaved edit — and retires where durability holds. */}
        {dirty && (
          <p data-testid="annotation-scope-label" style={CSS.label}>
            {DRAFT_SCOPE_LABEL}
          </p>
        )}
      </div>
    </div>
  );
}
