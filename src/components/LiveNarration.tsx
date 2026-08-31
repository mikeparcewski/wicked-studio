import { useEffect, useRef, useState } from 'react';
import { useRuntimeStore, outputKey } from '../store/runtime.js';

/** Trailing window of live narration rendered per unit (~4KB). */
const NARRATION_TAIL = 4096;

/**
 * Live narration for the ACTIVE unit — the streamed `unitOutputDelta` /
 * `cliOutputDelta` text from the `/ws` CoreEvent stream (accumulated by the
 * runtime store into `outputs`), rendered inside the unit's block in place of
 * the old empty "Working…" wait. Collapsible, autoscrolled to the newest text,
 * and windowed to the trailing ~{@link NARRATION_TAIL} bytes so a chatty
 * worker never grows the thread's DOM unbounded (the store keeps its own
 * larger cap for the full-output consumers).
 *
 * Shared with the Term tab (DES-UX-001 §7.6, slice Z): during a live run the
 * terminal modal shows this SAME region — one live-output component, two
 * mounts, never a fork. The streamed region carries `data-testid="live-output"`
 * (EC41: between start and verdict, something true streams on the run's own
 * page) and the honest label for what the deltas are — relayed live output,
 * not the durable transcript (§13: richer streaming is a crew concern).
 *
 * Moved out of ChatPanel.tsx by DES-RUN-NARRATOR §9 (the feed decomposition);
 * behavior and testids are verbatim.
 */
export function LiveNarration({ runId, ord, phase }: { runId: string; ord: number; phase: string }): React.ReactElement {
  const live = useRuntimeStore((s) => s.outputs[outputKey(runId, ord)]);
  const [visible, setVisible] = useState(true);
  const scrollRef = useRef<HTMLPreElement>(null);

  // Pin the narration viewport to the newest text as chunks stream in.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [live, visible]);

  const hasText = typeof live === 'string' && live.length > 0;
  const tail =
    hasText && live.length > NARRATION_TAIL ? '…' + live.slice(live.length - NARRATION_TAIL) : live;

  return (
    <div data-testid={`live-narration-${ord}`}>
      <div className="flex items-center gap-2 text-sm font-mono" style={{ color: 'var(--ink-muted)' }}>
        <span className="inline-block w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: 'var(--status-run)' }} />
        {/* Phase label leads the entry (operator UX directive) — mirrors the done-unit header. */}
        <span className="font-medium" style={{ color: 'var(--status-run)' }}>{phase}</span>
        <span>{hasText ? 'Working — live output' : 'Working…'}</span>
        {hasText && (
          <button
            type="button"
            data-testid={`live-narration-toggle-${ord}`}
            onClick={() => setVisible((v) => !v)}
            className="ml-auto text-xs font-medium font-mono hover:underline"
            style={{ color: 'var(--accent)' }}
          >
            {visible ? '▾ Hide live output' : '▸ Show live output'}
          </button>
        )}
      </div>
      {hasText && (
        <div data-testid="live-output" className="mt-2">
          {/* The honest label (§7.6): what streams is the relayed delta feed,
              not the durable record — say exactly that, house grammar. */}
          <p
            data-testid="live-output-label"
            className="mb-1 text-[10px] font-mono"
            style={{ color: 'var(--ink-dim)' }}
          >
            Live output — the full transcript lands when the unit completes.
          </p>
          {visible && (
            <pre
              ref={scrollRef}
              data-testid={`live-narration-text-${ord}`}
              className="max-h-64 overflow-auto rounded-lg p-2.5 text-[11px] leading-snug whitespace-pre-wrap break-words font-mono"
              style={{ background: 'var(--surface-base)', color: 'var(--ink-body)', border: '1px solid var(--surface-raised)' }}
            >
              {tail}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
