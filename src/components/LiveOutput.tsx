import { useEffect, useMemo, useRef } from 'react';
import { useRuntimeStore } from '../store/runtime.js';

interface Props {
  runId: string;
}

/**
 * The "watch it work" surface (DES-STUDIO-001 §11.4): a live output pane that
 * accumulates `cliOutputDelta` per run — keyed by unit `ord`, stick-to-bottom,
 * capped in the store — plus a per-run filtered, ordered event log.
 */
export function LiveOutput({ runId }: Props): React.ReactElement {
  const outputs = useRuntimeStore((s) => s.outputs);
  const logs = useRuntimeStore((s) => s.logs);
  const outputRef = useRef<HTMLDivElement>(null);

  const prefix = `${runId}:u`;
  const unitOutputs = useMemo(
    () =>
      Object.entries(outputs)
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, text]) => ({ ord: Number(key.slice(prefix.length)), text }))
        .sort((a, b) => a.ord - b.ord),
    [outputs, prefix],
  );

  const log = logs[runId] ?? [];

  // Stick-to-bottom: scroll the output pane down whenever new output lands.
  useEffect(() => {
    const el = outputRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [unitOutputs]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3" data-testid="live-output">
      <section>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">
          Live output
        </p>
        <div
          ref={outputRef}
          data-testid="live-output-pane"
          className="max-h-64 overflow-auto rounded bg-gray-900 p-2 text-[10px] leading-tight text-gray-100"
        >
          {unitOutputs.length === 0 ? (
            <span className="text-gray-500">
              No streaming output — the engine emits output via transcript after each unit completes.
              View transcripts below.
            </span>
          ) : (
            unitOutputs.map(({ ord, text }) => (
              <div key={ord} className="mb-2">
                <p className="text-gray-500">— unit #{ord} —</p>
                <pre className="whitespace-pre-wrap">{text}</pre>
              </div>
            ))
          )}
        </div>
      </section>

      <section>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">
          Event log
        </p>
        <ol
          data-testid="event-log"
          className="max-h-64 overflow-auto rounded border border-gray-200 bg-white p-2 text-[11px]"
        >
          {log.length === 0 ? (
            <li className="text-gray-400">No events yet.</li>
          ) : (
            log.map((e) => (
              <li key={e.seq} className="flex gap-2 border-b border-gray-50 py-0.5 last:border-0">
                <span className="font-mono text-gray-400 shrink-0">
                  {typeof e.ord === 'number' ? `#${e.ord}` : '·'}
                </span>
                <span className="font-medium text-gray-600 shrink-0">{e.type}</span>
                <span className="truncate text-gray-500">{e.detail}</span>
              </li>
            ))
          )}
        </ol>
      </section>
    </div>
  );
}
