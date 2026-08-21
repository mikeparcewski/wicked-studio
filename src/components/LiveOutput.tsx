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
          style={{ color: 'var(--ink-dim)' }}>
          Live output
        </p>
        <div
          ref={outputRef}
          data-testid="live-output-pane"
          className="max-h-64 overflow-auto rounded p-2 text-[10px] leading-tight font-mono"
          style={{ background: 'var(--surface-base)', color: 'var(--ink-high)' }}
        >
          {unitOutputs.length === 0 ? (
            <span style={{ color: 'var(--ink-dim)' }}>
              No streaming output — the engine emits output via transcript after each unit completes.
            </span>
          ) : (
            unitOutputs.map(({ ord, text }) => (
              <div key={ord} className="mb-2">
                <p style={{ color: 'var(--ink-dim)' }}>— unit #{ord} —</p>
                <pre className="whitespace-pre-wrap">{text}</pre>
              </div>
            ))
          )}
        </div>
      </section>

      <section>
        <p className="text-[11px] font-semibold uppercase tracking-wider mb-1 font-mono"
          style={{ color: 'var(--ink-dim)' }}>
          Event log
        </p>
        <ol
          data-testid="event-log"
          className="max-h-64 overflow-auto rounded p-2 text-[11px] font-mono"
          style={{ background: 'var(--surface-rail)', border: '1px solid var(--surface-raised)' }}
        >
          {log.length === 0 ? (
            <li style={{ color: 'var(--ink-dim)' }}>No events yet.</li>
          ) : (
            log.map((e) => (
              <li
                key={e.seq}
                className="flex gap-2 py-0.5 last:border-0"
                style={{ borderBottom: '1px solid var(--surface-raised)' }}
              >
                <span className="shrink-0" style={{ color: 'var(--ink-dim)' }}>
                  {typeof e.ord === 'number' ? `#${e.ord}` : '·'}
                </span>
                <span className="font-medium shrink-0" style={{ color: 'var(--accent)' }}>{e.type}</span>
                <span className="truncate" style={{ color: 'var(--ink-muted)' }}>{e.detail}</span>
              </li>
            ))
          )}
        </ol>
      </section>
    </div>
  );
}
