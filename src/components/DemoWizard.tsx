import { useState } from 'react';
import { createDemoFromDraft, draftReady, stepReady, stepTitle, type DemoDraft } from '../interactive/demoWire.js';
import { S } from './SurfaceState.js';

// The ordered demo wizard (DES-MERGE-001 §4.5, §4.1, §6.4 slice 14).
//
// §4.1 retired `CreationWizard.jsx` as REPLACED-BY-BETTER for every document kind but
// one: the demo path has genuinely ordered steps, and an ordered thing authored through
// a single free-text composer loses the ordering that makes it work. So the wizard
// survives HERE, and only here — reached from the composer (§2.2 case 1), never as a
// second front door: the message the user typed seeds the name, and completion opens the
// demo's conversation with the authored spec as its first line.
//
// Two stages, because there are exactly two questions: WHERE the demo runs, and WHAT
// happens in it, in order. Each step is a subject plus an action — a step that names one
// without the other is not authored, for the same reason a status line is never bare.

const FIELD: React.CSSProperties = {
  background: 'rgba(13,17,23,0.6)', border: `1px solid ${S.border}`, borderRadius: '6px',
  color: S.ink, fontFamily: 'inherit', fontSize: '12px', padding: '6px 8px', width: '100%',
};

const BTN: React.CSSProperties = {
  border: 'none', borderRadius: '7px', cursor: 'pointer',
  fontSize: '11px', fontWeight: 600, padding: '5px 11px',
};

export interface DemoWizardProps {
  projectId: string;
  /** The composer message that opened it. §4.1: the name is DERIVED from the ask — the
   *  wizard asks only what the ask could not have said, which is the ordering. */
  seed: string;
  /** The thread message id this authoring is anchored to (§7.6). */
  msgId: string;
  onCancel: () => void;
  /** The demo exists and its conversation has opened; the surface offers to record it. */
  onCreated: (demoId: string) => void;
}

export function DemoWizard({ projectId, seed, msgId, onCancel, onCreated }: DemoWizardProps): React.ReactElement {
  const [draft, setDraft] = useState<DemoDraft>({ name: seed, targetUrl: '', steps: [] });
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
    <div
      data-testid="demo-wizard"
      data-stage={staged ? 'steps' : 'target'}
      data-steps={String(draft.steps.length)}
      className="absolute inset-0 z-10 flex flex-col gap-2.5 overflow-y-auto p-3.5"
      style={{ background: S.card }}
    >
      <p className="text-xs font-semibold" style={{ color: S.ink, margin: 0 }}>
        Author the demo — the service records exactly these steps, in this order.
      </p>

      {/* Stage 1 — where it runs. Nothing can be authored against an unknown target. */}
      <label className="text-[10px] font-mono uppercase tracking-wide" style={{ color: S.label }}>
        Target URL
        <input data-testid="wizard-target" style={FIELD} placeholder="https://shop.example/"
               value={draft.targetUrl}
               onChange={(e) => setDraft((d) => ({ ...d, targetUrl: e.target.value }))} />
      </label>

      {/* Stage 2 — what happens, in order. */}
      {staged && (
        <>
          <ol data-testid="wizard-steps" className="flex flex-col gap-1 pl-0" style={{ listStyle: 'none', margin: 0 }}>
            {draft.steps.map((s, i) => (
              <li key={`${s.subject}-${i}`} data-testid="wizard-step" data-index={String(i)}
                  className="flex items-center gap-2 rounded-md px-2 py-1 text-[11px]"
                  style={{ background: 'rgba(13,17,23,0.6)', border: `1px solid ${S.border}`, color: S.ink }}>
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
                style={{ ...BTN, background: S.accent, color: '#0d1117' }}>
          {busy ? 'Authoring…' : `Create demo (${draft.steps.length} steps)`}
        </button>
        <button type="button" data-testid="wizard-cancel" onClick={onCancel}
                style={{ ...BTN, background: 'transparent', border: `1px solid ${S.border}`, color: S.muted }}>
          Cancel
        </button>
      </div>
      {error !== null && (
        <p data-testid="wizard-error" className="text-[11px] font-mono" style={{ color: '#f85149', margin: 0 }}>
          {error} — nothing was created; fix it and submit again.
        </p>
      )}
    </div>
  );
}
