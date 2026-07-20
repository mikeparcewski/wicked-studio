import { useEffect, useMemo, useRef } from 'react';
import { useRuntimeStore } from '../store/runtime.js';

interface Props {
  runId: string;
}

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

  useEffect(() => {
    const el = outputRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [unitOutputs]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3" data-testid="live-output">
      <section>
        <p className="text-[11px] font-semibold uppercase tracking-wider mb-1 font-mono"
          style={{ color: 'rgba(230,237,243,0.4)' }}>
          Live output
        </p>
        <div
          ref={outputRef}
          data-testid="live-output-pane"
          className="max-h-64 overflow-auto rounded p-2 text-[10px] leading-tight font-mono"
          style={{ background: '#0d1117', color: '#e6edf3' }}
        >
          {unitOutputs.length === 0 ? (
            <span style={{ color: 'rgba(230,237,243,0.3)' }}>
              No streaming output — the engine emits output via transcript after each unit completes.
            </span>
          ) : (
            unitOutputs.map(({ ord, text }) => (
              <div key={ord} className="mb-2">
                <p style={{ color: 'rgba(230,237,243,0.3)' }}>— unit #{ord} —</p>
                <pre className="whitespace-pre-wrap">{text}</pre>
              </div>
            ))
          )}
        </div>
      </section>

      <section>
        <p className="text-[11px] font-semibold uppercase tracking-wider mb-1 font-mono"
          style={{ color: 'rgba(230,237,243,0.4)' }}>
          Event log
        </p>
        <ol
          data-testid="event-log"
          className="max-h-64 overflow-auto rounded p-2 text-[11px] font-mono"
          style={{ background: '#0f1419', border: '1px solid rgba(230,237,243,0.07)' }}
        >
          {log.length === 0 ? (
            <li style={{ color: 'rgba(230,237,243,0.3)' }}>No events yet.</li>
          ) : (
            log.map((e) => (
              <li
                key={e.seq}
                className="flex gap-2 py-0.5 last:border-0"
                style={{ borderBottom: '1px solid rgba(230,237,243,0.04)' }}
              >
                <span className="shrink-0" style={{ color: 'rgba(230,237,243,0.3)' }}>
                  {typeof e.ord === 'number' ? `#${e.ord}` : '·'}
                </span>
                <span className="font-medium shrink-0" style={{ color: '#79c0ff' }}>{e.type}</span>
                <span className="truncate" style={{ color: 'rgba(230,237,243,0.5)' }}>{e.detail}</span>
              </li>
            ))
          )}
        </ol>
      </section>
    </div>
  );
}
