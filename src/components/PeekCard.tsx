import type { PeekView } from '../hooks/usePeekJump.js';
import { GateVerdict } from './GateVerdict.js';
import { ago } from './ProjectCard.js';

/**
 * The peek card (studio wave 2a, behaviour 3) — a skin over `usePeekJump`: the top item that
 * needs you, shown in place over whatever you are doing (the URL does not change). It renders
 * the view it is handed and wires two buttons to the hook's own actions; nothing is decided here.
 */

const KBD: React.CSSProperties = {
  fontFamily: 'var(--font-mono)', fontSize: 'var(--text-2xs)', color: 'var(--ink-dim)',
  border: '1px solid var(--surface-raised)', borderRadius: 'var(--radius-sm)', padding: '0 4px',
};

export function PeekCard({ view }: { view: PeekView }): React.ReactElement | null {
  if (!view.open) return null;
  const { target, evidence } = view;
  return (
    <aside
      role="dialog"
      aria-modal="false"
      aria-label="Peek: the top item that needs you"
      data-testid="peek-card"
      data-run-id={target?.runId ?? ''}
      className="fixed flex flex-col gap-2 overflow-y-auto z-50"
      style={{
        top: 56, right: 16, width: 420, maxHeight: '70vh',
        background: 'var(--surface-overlay)', boxShadow: 'var(--shadow-overlay)',
        borderRadius: 'var(--radius-xl)', padding: '14px 16px',
      }}
    >
      <div className="flex items-center gap-2">
        <span style={{ fontSize: 'var(--text-2xs)', fontFamily: 'var(--font-mono)', color: 'var(--status-gate)', fontWeight: 'var(--weight-bold)' }}>
          PEEK · NEEDS YOU
        </span>
        <div className="flex-1" />
        <button
          type="button"
          data-testid="peek-close"
          onClick={view.close}
          aria-label="Close the peek card"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-dim)', fontSize: 'var(--text-xs)' }}
        >
          <span style={KBD}>Esc</span>
        </button>
      </div>

      {target === null ? (
        <p data-testid="peek-empty" style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--ink-body)' }}>
          Nothing needs you right now.
        </p>
      ) : (
        <>
          <p style={{ margin: 0, fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', color: 'var(--ink-dim)' }}>
            {view.projectName ?? 'unfiled'} · {target.runId}
            {target.receivedAt !== null && <> · waiting {ago(target.receivedAt)}</>}
          </p>
          <p data-testid="peek-subject" style={{ margin: 0, fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semi)', color: 'var(--ink-high)' }}>
            {target.subject}
          </p>
          <p
            data-testid="peek-prompt"
            style={{
              margin: 0, fontSize: 'var(--text-sm)', color: 'var(--ink-body)',
              background: 'var(--status-gate-dim)', borderRadius: 'var(--radius-md)', padding: '8px 10px',
            }}
          >
            {target.prompt ?? 'The gate’s question was not cached (the daemon restarted). Open it to read the thread.'}
          </p>
          <div data-testid="peek-evidence">
            {evidence.loading ? (
              <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--ink-dim)' }}>Reading the run&rsquo;s evidence…</p>
            ) : evidence.verdict !== null ? (
              <GateVerdict view={evidence.verdict} phase={evidence.phase ?? 'this phase'} />
            ) : (
              <p data-testid="peek-no-verdict" style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--ink-dim)' }}>
                No evaluator verdict on record for this gate yet.
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="peek-jump"
              onClick={view.jump}
              style={{
                border: 'none', cursor: 'pointer', borderRadius: 'var(--radius-md)',
                background: 'var(--status-gate-dim)', color: 'var(--status-gate)',
                fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semi)', padding: '4px 10px',
              }}
            >
              Go to the gate <span style={KBD}>G</span>
            </button>
            <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--ink-dim)' }}>
              then <span style={KBD}>B</span> brings you back here
            </span>
          </div>
        </>
      )}
    </aside>
  );
}
