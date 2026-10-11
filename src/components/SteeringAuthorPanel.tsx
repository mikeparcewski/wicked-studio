import { FilePick, StateBanner, TechDetails } from './ui/index.js';
import { useState } from 'react';
import {
  authorSteeringRules,
  isSteeringUnsupported,
  STEERING_TYPE_LABELS,
  STEERING_UNSUPPORTED_COPY,
  type SteeringType,
} from '../api/steering.js';
import { useGateStore } from '../store/gates.js';
import { readFileText } from './fileText.js';
import { AnswerInThread, useGateCleared } from './AnswerInThread.js';

/**
 * "Add with chat" — the governed authoring flow, opened on demand from the Add menu (and, on
 * the Testing surface's Harness page, REUSED VERBATIM with type `"testing"` — one governed-run
 * authoring UX, not a fork). `POST /governance/steering/author` launches the run; its PROPOSE
 * gate arrives as a normal awaitingHuman frame; S16a-4g: it is answered in the run's session thread —
 * the panel says so in one line ("Answer in its thread ›") and reloads when the gate store clears it.
 * No second gate UI, no polling.
 */
export function AuthorPanel({ type, onClose, onAuthored }: {
  type: SteeringType;
  onClose: () => void;
  /** Fires when the propose gate resolves — the page reloads rules for the server's state. */
  onAuthored: () => void;
}): React.ReactElement {
  const [instructions, setInstructions] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  // The propose gate arrives as a normal awaitingHuman frame on the launched run — the app's
  // one /ws subscription already folds it into the gate store; this panel watches for it, points
  // at the thread that answers it, and fires onAuthored when the store clears it.
  const gate = useGateStore((s) => (runId !== null ? s.gates[runId] : undefined));
  useGateCleared(runId, onAuthored);

  const launch = async (): Promise<void> => {
    if (busy || instructions.trim() === '') return;
    setBusy(true);
    setError(null);
    try {
      const documents = await Promise.all(
        files.map(async (f) => ({ name: f.name, content: await readFileText(f) })),
      );
      const { runId } = await authorSteeringRules({
        instructions: instructions.trim(),
        type,
        ...(documents.length > 0 ? { documents } : {}),
      });
      setRunId(runId);
    } catch (e) {
      if (isSteeringUnsupported(e)) setUnsupported(true);
      else setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      data-testid="steering-author-panel"
      className="flex flex-col gap-2 rounded p-3"
      style={{ border: '1px solid var(--surface-raised)', background: 'var(--surface-rail)' }}
    >
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-semibold" style={{ color: 'var(--ink-high)' }}>
          Add {STEERING_TYPE_LABELS[type]} rules with chat
        </span>
        <button
          data-testid="steering-author-close"
          type="button"
          onClick={onClose}
          className="ml-auto text-[10px] hover:underline"
          style={{ color: 'var(--ink-dim)' }}
        >
          Close
        </button>
      </div>

      {runId === null ? (
        <>
          <p className="wk-field-note">
            A helper reads what you attach and drafts {type} rules. Nothing is saved until you approve
            them in the run&rsquo;s thread.
          </p>
          <textarea
            data-testid="steering-author-instructions"
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="What should these rules steer? Paste context or attach the docs below."
            aria-label="What should these rules steer?"
            className="wk-field min-h-[4rem] resize-y"
          />
          <div className="flex flex-wrap items-center gap-2">
            <FilePick
              data-testid="steering-author-files"
              label="Attach a file…"
              file={null}
              onChange={(f) => { if (f !== null) setFiles((cur) => [...cur, f]); }}
            />
            {files.map((f, i) => (
              <span key={`${f.name}-${i}`} data-testid="steering-author-file-chip" className="wk-chip">
                {f.name}
                <button
                  type="button"
                  aria-label={`Remove ${f.name}`}
                  onClick={() => setFiles((cur) => cur.filter((_, j) => j !== i))}
                  style={{ color: 'var(--ink-dim)' }}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          {unsupported && (
            <p data-testid="steering-author-unsupported" className="wk-field-note">
              {STEERING_UNSUPPORTED_COPY}
            </p>
          )}
          {error !== null && (
            <div data-testid="steering-author-error">
              <StateBanner kind="error" what="the authoring run" error={error} />
            </div>
          )}
          <div>
            <button
              data-testid="steering-author-launch"
              type="button"
              disabled={busy || instructions.trim() === ''}
              onClick={() => void launch()}
              className="wk-btn wk-btn--primary wk-btn--sm"
            >
              {busy ? 'Launching…' : 'Launch authoring run'}
            </button>
          </div>
        </>
      ) : gate === undefined ? (
        <div data-testid="steering-author-waiting" className="wk-field-note">
          <p>The authoring run started. Its proposed rules appear here, and on the Desk, as soon as they are ready.</p>
          <TechDetails text={`run: ${runId}`} />
        </div>
      ) : (
        // S16a-4g: the propose gate is answered in the run's thread (approving — optionally with a
        // steer — writes the proposed rules; rejecting writes nothing). One line, no card here.
        <AnswerInThread subject={{ kind: 'run', runId }} />
      )}
    </div>
  );
}
