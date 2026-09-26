import type { LaunchPreviewModel } from '../hooks/useLaunchPlan.js';
import type { PreviewStepView } from '../board/planModel.js';

/**
 * The launch preview (DES-TEAMING-002 §8.12): before Send, what the engine would decide for this
 * launch — score, band, the steps the floor added, and whether it pauses and why. A skin over
 * `useLaunchPreview().view`. A plan the PA will scope has no final score yet: it says so and draws
 * no floor markers (its floor is only the baseline's).
 */
export function LaunchPreview({ model }: { model: LaunchPreviewModel }): React.ReactElement | null {
  const { preview, view, previewOf } = model;
  if (preview === null) return null;
  const state = preview.status === 'ready' ? (view?.kind ?? 'ready') : preview.status;
  return (
    <section
      data-testid="launch-preview"
      data-state={state}
      data-of={previewOf ?? ''}
      aria-label="Launch preview"
      className="flex flex-col gap-1.5 rounded-xl px-3 py-2 text-[11px]"
      style={{ background: 'var(--surface-rail)', border: '1px solid var(--surface-raised)', color: 'var(--ink-muted)' }}
    >
      <span className="font-mono uppercase tracking-widest" style={{ color: 'var(--ink-dim)' }}>
        Launch preview{previewOf === 'preset' ? ' · preset' : ''}
      </span>
      {preview.status === 'loading' && <span>Asking the engine what this launch would do…</span>}
      {preview.status === 'unsupported' && (
        <span data-testid="launch-preview-unsupported">This daemon cannot preview a plan.</span>
      )}
      {preview.status === 'error' && (
        <span data-testid="launch-preview-error" style={{ color: 'var(--status-fail)' }}>{preview.error}</span>
      )}
      {view?.kind === 'pending-scope' && (
        <>
          <span data-testid="preview-pending-scope" style={{ color: 'var(--ink-high)' }}>
            The PA will scope this first: it reads the repo, says what the work touches, and the score,
            band and floor come from its answer.
          </span>
          <Steps steps={view.steps} />
          <Pause pauses={view.pauses} text={view.pauseText} />
        </>
      )}
      {view?.kind === 'scored' && (
        <>
          <span className="flex items-center gap-3 flex-wrap" style={{ color: 'var(--ink-high)' }}>
            <span data-testid="preview-score">score {view.score}</span>
            <span data-testid="preview-band">band {view.band}</span>
            {view.highRisk && (
              <span data-testid="preview-high-risk" style={{ color: 'var(--status-gate)' }}>high risk</span>
            )}
          </span>
          <Steps steps={view.steps} />
          {view.floorAdded.length > 0 && (
            <span data-testid="preview-floor-note">
              The floor added {view.floorAdded.map((s) => s.id).join(', ')} for band {view.band}.
            </span>
          )}
          <Pause pauses={view.pauses} text={view.pauseText} />
        </>
      )}
    </section>
  );
}

function Steps({ steps }: { steps: PreviewStepView[] }): React.ReactElement {
  return (
    <ol data-testid="preview-steps" className="flex items-center gap-1.5 flex-wrap font-mono">
      {steps.map((s, i) => (
        <li
          key={s.id}
          data-testid="preview-step"
          data-step-id={s.id}
          data-by-floor={s.byFloor ? 'true' : 'false'}
          title={s.byFloor ? `added by floor${s.floorReason ? `: ${s.floorReason}` : ''}` : undefined}
          className="rounded-lg px-2 py-0.5"
          style={
            s.byFloor
              ? { border: '1px dashed var(--status-gate)', color: 'var(--ink-high)' }
              : { background: 'var(--surface-card)', color: 'var(--ink-high)' }
          }
        >
          <span style={{ color: 'var(--ink-dim)' }}>{i + 1}.</span> {s.id}
          {s.byFloor && (
            <span data-testid="floor-marker" style={{ color: 'var(--status-gate)' }}> · added by floor</span>
          )}
        </li>
      ))}
    </ol>
  );
}

function Pause({ pauses, text }: { pauses: boolean; text: string }): React.ReactElement {
  return (
    <span data-testid="launch-preview-pause" data-pauses={pauses ? 'true' : 'false'} style={{ color: pauses ? 'var(--status-gate)' : 'var(--ink-muted)' }}>
      {text}
    </span>
  );
}
