import { useState } from 'react';
import { createDemoFromDraft, draftReady, stepReady, stepTitle, type DemoDraft } from '../interactive/demoWire.js';
import { S } from './SurfaceState.js';

// The demo wizard (DES-MERGE-001 §4.5, §4.1, §6.4 slice 14; reshaped by VIDEO-FB).
//
// §4.1 retired `CreationWizard.jsx` as REPLACED-BY-BETTER for every document kind but
// one: the demo path has genuinely ordered steps. Reached from the composer (§2.2
// case 1), never as a second front door: the message the user typed seeds the name AND
// the description, and completion opens the demo's conversation with the authored
// brief as its first line.
//
// VIDEO-FB findings, both fixed HERE:
//   · the wizard was an `absolute inset-0` overlay that pointer-blocked the composer
//     beneath it — clicks died silently. It is a FLOW panel now: the composer stays
//     visible and (deliberately, visibly) disabled with a stated reason while the
//     wizard collects, never covered by an invisible hit target;
//   · the target stage hid the step form with no hint. The pipeline note and the
//     steps hint now SAY what comes next and why the form is not there yet.
//
// CREW-UX-9 re-grounds the promise: the DESCRIPTION is authored into the demo's spec
// by a governed run — describe-first is the primary path. Manual Subject / Action
// steps survive as the ADVANCED path that pins the spec by hand.

const FIELD: React.CSSProperties = {
  background: 'var(--surface-rail)', border: `1px solid ${S.border}`, borderRadius: '6px',
  color: S.ink, fontFamily: 'inherit', fontSize: '12px', padding: '6px 8px', width: '100%',
};

const BTN: React.CSSProperties = {
  border: 'none', borderRadius: '7px', cursor: 'pointer',
  fontSize: '11px', fontWeight: 600, padding: '5px 11px',
};

export interface DemoWizardProps {
  projectId: string;
  /** The composer message that opened it. §4.1: the name is DERIVED from the ask — the
   *  wizard asks only what the ask could not have said. The ask also seeds the
   *  DESCRIPTION the governed run authors the spec from (CREW-UX-9). */
  seed: string;
  /** The thread message id this authoring is anchored to (§7.6). */
  msgId: string;
  onCancel: () => void;
  /** The demo exists and its conversation has opened; the surface offers to record it. */
  onCreated: (demoId: string) => void;
}

export function DemoWizard({ projectId, seed, msgId, onCancel, onCreated }: DemoWizardProps): React.ReactElement {
  const [draft, setDraft] = useState<DemoDraft>({
    name: seed, targetUrl: '', description: seed, steps: [],
  });
  const [step, setStep] = useState({ subject: '', action: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const staged = draft.targetUrl.trim() !== '';

  function addStep(): void {
    if (!stepReady(step)) return;
    // Append: the order steps are authored in IS the spec's order (`demoDraftBody`
    // assigns `index` from position), so there is no separate ordering to get wrong.
    setDraft((d) => ({ ...d, steps: [...d.steps, { ...step }] }));
    setStep({ subject: '', action: '' });
  }

  async function create(): Promise<void> {
    if (!draftReady(draft) || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { name } = await createDemoFromDraft(projectId, draft, msgId);
      onCreated(name);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    // A FLOW panel, not an overlay (VIDEO-FB): it takes its own space at the top of
    // the thread pane and never claims pixels it does not draw on — the composer
    // below stays visible, disabled with its stated reason, never pointer-trapped.
    <div
      data-testid="demo-wizard"
      data-stage={staged ? 'steps' : 'target'}
      data-steps={String(draft.steps.length)}
      className="flex flex-col gap-2.5 overflow-y-auto p-3.5 shrink-0"
      style={{ background: S.card, borderBottom: `1px solid ${S.border}`, maxHeight: '70%' }}
    >
      <p className="text-xs font-semibold" style={{ color: S.ink, margin: 0 }}>
        Author the demo — the service records exactly the spec’s steps, in order.
      </p>
      {/* CREW-UX-9, said where the promise is made: describe-first is the pipeline. */}
      <p
        data-testid="wizard-pipeline-note"
        className="text-[11px] leading-relaxed"
        style={{ color: S.muted, margin: 0 }}
      >
        Your description is authored into the demo’s spec by a governed run, and
        recording replays exactly those steps in a real browser. Adding Subject /
        Action steps below pins the spec by hand instead — the advanced path.
      </p>

      {/* Stage 1 — where it runs. Nothing can be authored against an unknown target. */}
      <label className="text-[10px] font-mono uppercase tracking-wide" style={{ color: S.label }}>
        Target URL
        <input data-testid="wizard-target" style={FIELD} placeholder="https://shop.example/"
               value={draft.targetUrl}
               onChange={(e) => setDraft((d) => ({ ...d, targetUrl: e.target.value }))} />
      </label>

      <label className="text-[10px] font-mono uppercase tracking-wide" style={{ color: S.label }}>
        Describe it
        <textarea
          data-testid="wizard-description"
          style={{ ...FIELD, minHeight: '48px', resize: 'vertical' }}
          placeholder="What the demo walks through — the governed run authors the steps from this."
          value={draft.description}
          onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
        />
      </label>

      {/* The stage seam, SAID (VIDEO-FB): pre-target, the step form is not hidden
          mystery — the hint names what unlocks it and that it is optional. */}
      {!staged && (
        <p
          data-testid="wizard-steps-hint"
          className="text-[11px]"
          style={{ color: S.muted, margin: 0 }}
        >
          Add the target URL to unlock the manual step form — or skip it: with a
          description alone, the governed run authors the steps for you.
        </p>
      )}

      {/* Stage 2 — the ADVANCED path: exact steps, pinned by hand, in order. */}
      {staged && (
        <>
          <ol data-testid="wizard-steps" className="flex flex-col gap-1 pl-0" style={{ listStyle: 'none', margin: 0 }}>
            {draft.steps.map((s, i) => (
              <li key={`${s.subject}-${i}`} data-testid="wizard-step" data-index={String(i)}
                  className="flex items-center gap-2 rounded-md px-2 py-1 text-[11px]"
                  style={{ background: 'var(--surface-rail)', border: `1px solid ${S.border}`, color: S.ink }}>
                <span className="font-mono" style={{ color: S.accent }}>{i + 1}</span>
                <span className="flex-1">{stepTitle(s)}</span>
                <button type="button" data-testid="wizard-step-remove"
                        onClick={() => setDraft((d) => ({ ...d, steps: d.steps.filter((_, n) => n !== i) }))}
                        style={{ ...BTN, background: 'transparent', color: S.muted, padding: '2px 6px' }}>
                  Remove
                </button>
              </li>
            ))}
          </ol>

          <div className="flex flex-col gap-1.5">
            <p className="text-[10px] font-mono uppercase tracking-wide" style={{ color: S.label, margin: 0 }}>
              Pin steps by hand (advanced — optional)
            </p>
            <input data-testid="wizard-step-subject" style={FIELD} placeholder="Subject — “the cart”"
                   value={step.subject} onChange={(e) => setStep((s) => ({ ...s, subject: e.target.value }))} />
            <input data-testid="wizard-step-action" style={FIELD} placeholder="Action — “add a hoodie to it”"
                   value={step.action}
                   onChange={(e) => setStep((s) => ({ ...s, action: e.target.value }))}
                   onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addStep(); } }} />
            <button type="button" data-testid="wizard-step-add" disabled={!stepReady(step)} onClick={addStep}
                    className="self-start disabled:opacity-40"
                    style={{ ...BTN, background: 'transparent', border: `1px solid ${S.border}`, color: S.ink }}>
              Add step {draft.steps.length + 1}
            </button>
          </div>
        </>
      )}

      <div className="mt-auto flex items-center gap-2 pt-2">
        <button type="button" data-testid="wizard-create" disabled={!draftReady(draft) || busy}
                onClick={() => void create()} className="disabled:opacity-40"
                style={{ ...BTN, background: S.accent, color: 'var(--surface-base)' }}>
          {busy
            ? 'Authoring…'
            : draft.steps.length === 0
              ? 'Create demo — steps authored from your description'
              : `Create demo (${draft.steps.length} ${draft.steps.length === 1 ? 'step' : 'steps'} pinned)`}
        </button>
        <button type="button" data-testid="wizard-cancel" onClick={onCancel}
                style={{ ...BTN, background: 'transparent', border: `1px solid ${S.border}`, color: S.muted }}>
          Cancel
        </button>
      </div>
      {error !== null && (
        <p data-testid="wizard-error" className="text-[11px] font-mono" style={{ color: 'var(--status-fail)', margin: 0 }}>
          {error} — nothing was created; fix it and submit again.
        </p>
      )}
    </div>
  );
}
