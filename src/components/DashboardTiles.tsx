import { useMemo } from 'react';
import type { OpenGate } from '../store/gates.js';
import { MetricTile } from './MetricTile.js';

/**
 * Shared dress for the path dashboards' reporting bands (DES-FEEDBACK-003 §4,
 * slice P): the same 64px `--surface-rail` band the Make dashboard wears
 * (MakeDashboard.tsx), so the five paths read as one system — "visual parity
 * is what makes the five paths read as one system" (§4.3). Every tile inside
 * answers a named operator question via `data-question` (EC19/EC28), SVG-first,
 * tokens only (EC15), and derives from data the page already holds — a band
 * never costs a request.
 */

export function TileBand({ testId, children }: {
  testId: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div
      data-testid={testId}
      className="flex items-stretch"
      style={{
        height: '64px',
        flexShrink: 0,
        background: 'var(--surface-rail)',
        borderRadius: 'var(--radius-md)',
        padding: '0 var(--space-3)',
      }}
    >
      {children}
    </div>
  );
}

/** Coarse age word for a waiting gate — "how long have I been the blocker". */
export function ageWord(ms: number): string {
  if (ms < 60_000) return `${Math.max(0, Math.floor(ms / 1_000))}s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h`;
  return `${Math.floor(ms / 86_400_000)}d`;
}

/**
 * Gates-waiting tile (§4.1 row 3 / §4.3 row 3): count + oldest age off the
 * gate store — the store the app's one `/ws` subscription and run reconcile
 * already fill, so the tile reads state, never the wire. The caller scopes
 * the gates (all runs on /projects; the chat partition on /chats) and names
 * its own §4-table question verbatim (EC19).
 */
export function GatesWaitingTile({ gates, question, title, testId, now }: {
  gates: OpenGate[];
  question: string;
  title: string;
  testId: string;
  now?: number;
}): React.ReactElement {
  const at = now ?? Date.now();
  const oldest = useMemo(
    () => gates.reduce<OpenGate | null>(
      (acc, g) => (acc === null || g.receivedAt < acc.receivedAt ? g : acc),
      null,
    ),
    [gates],
  );

  return (
    <MetricTile
      testId={testId}
      question={question}
      title={title}
      value={oldest === null
        ? 'none waiting'
        : `${gates.length} waiting · oldest ${ageWord(at - oldest.receivedAt)}`}
      data={{ 'data-count': gates.length }}
    >
      {oldest === null ? (
        <p style={{ margin: 0, fontSize: 'var(--text-2xs)', color: 'var(--ink-dim)', fontFamily: 'var(--font-mono)' }}>
          Nothing is waiting on you.
        </p>
      ) : (
        <p
          title={oldest.prompt}
          style={{
            margin: 0, fontSize: 'var(--text-2xs)', color: 'var(--status-gate)',
            fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {oldest.prompt}
        </p>
      )}
    </MetricTile>
  );
}
