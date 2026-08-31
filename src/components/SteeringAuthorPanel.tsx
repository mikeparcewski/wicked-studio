import { useRef, useState } from 'react';
import {
  authorSteeringRules,
  isSteeringUnsupported,
  STEERING_TYPE_LABELS,
  STEERING_UNSUPPORTED_COPY,
  type SteeringType,
} from '../api/steering.js';
import { useGateStore } from '../store/gates.js';
import { readFileText } from './fileText.js';
import { SteeringGate } from './SteeringGate.js';

/**
 * "Add with chat" — the governed authoring flow, opened on demand from the Add menu (and, on
 * the Testing surface's Harness page, REUSED VERBATIM with type `"testing"` — one governed-run
 * authoring UX, not a fork). `POST /governance/steering/author` launches the run; its PROPOSE
 * gate arrives as a normal awaitingHuman frame and renders through the EXISTING SteeringGate
 * component — no second gate UI, no polling.
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
  const fileInput = useRef<HTMLInputElement>(null);
  // The propose gate arrives as a normal awaitingHuman frame on the launched run — the app's
  // one /ws subscription already folds it into the gate store; this panel just watches for it
  // and renders the EXISTING gate card. No second gate UI, no polling.
  const gate = useGateStore((s) => (runId !== null ? s.gates[runId] : undefined));

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
          <p className="text-[10px]" style={{ color: 'var(--ink-dim)' }}>
            Launches a governed authoring run: it reads what you attach, drafts{' '}
            <span className="font-mono">{type}</span> steering rules, and STOPS at a propose gate —
            nothing is written until you approve it here.
          </p>
          <textarea
            data-testid="steering-author-instructions"
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="What should these rules steer? Paste context or attach the docs below."
            className="min-h-[4rem] resize-y rounded px-2 py-1 text-[11px] focus:outline-none"
            style={{ background: 'var(--surface-base)', border: '1px solid var(--surface-raised)', color: 'var(--ink-high)' }}
          />
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInput}
              data-testid="steering-author-files"
              type="file"
              multiple
              aria-label="Attach files for the authoring run"
              onChange={(e) => {
                // Read the FileList EAGERLY: the value reset below clears `files`, and a lazy
                // read inside the state updater would see the already-emptied list.
                const picked = Array.from(e.target.files ?? []);
                setFiles((cur) => [...cur, ...picked]);
                e.target.value = '';
              }}
              className="text-[10px]"
              style={{ color: 'var(--ink-muted)' }}
            />
            {files.map((f, i) => (
              <span key={`${f.name}-${i}`} data-testid="steering-author-file-chip" className="inline-flex items-center gap-1 rounded px-1.5 text-[10px] font-mono" style={{ background: 'var(--surface-raised)', color: 'var(--ink-muted)' }}>
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
            <p data-testid="steering-author-unsupported" className="rounded px-2 py-1 text-[10px]" style={{ background: 'var(--surface-raised)', color: 'var(--ink-muted)' }}>
              {STEERING_UNSUPPORTED_COPY}
            </p>
          )}
          {error !== null && (
            <p data-testid="steering-author-error" className="rounded px-2 py-1 text-[10px]" style={{ background: 'var(--status-fail-dim)', color: 'var(--status-fail)' }}>
              {error}
            </p>
          )}
          <div>
            <button
              data-testid="steering-author-launch"
              type="button"
              disabled={busy || instructions.trim() === ''}
              onClick={() => void launch()}
              className="rounded px-3 py-1 text-[11px] font-semibold disabled:opacity-40"
              style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
            >
              {busy ? 'Launching…' : 'Launch authoring run'}
            </button>
          </div>
        </>
      ) : gate === undefined ? (
        <p data-testid="steering-author-waiting" className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          Authoring run <span className="font-mono">{runId.slice(0, 8)}</span> launched — its propose
          gate will appear here the moment the run asks. It also shows up everywhere gates do.
        </p>
      ) : (
        // The propose gate — the EXISTING gate card, reused verbatim. Approving (optionally with
        // steer text) is what writes the proposed rules; rejecting writes nothing.
        <SteeringGate
          runId={runId}
          ord={gate.ord}
          prompt={gate.prompt}
          onResolved={onAuthored}
        />
      )}
    </div>
  );
}
