import { useAgentRows } from './useAgentRows.js';

/**
 * The Agents dot and count (DES-seats-page §2.1, Q6) for wherever the Agents page is reached (the
 * Desk's Agents tab, operator 2026-10-13): agents with a problem or a warning — `fail` tone if any
 * has a problem, `gate` otherwise. Nothing while the reads are loading, have failed, or when nothing
 * needs a look (UI-CONTRACT §1.6: a count waits for its read).
 */
export function AgentsCount(): React.ReactElement | null {
  const { attention } = useAgentRows();
  if (attention === null || attention.count === 0 || attention.tone === null) return null;
  const n = attention.count;
  return (
    <span data-testid="agents-count" data-tone={attention.tone} className="wk-agents-rail-n" title={`${n} ${n === 1 ? 'agent needs' : 'agents need'} a look`}>
      <span aria-hidden className={`wk-agents-rail-dot wk-agents-rail-dot--${attention.tone}`} />
      <span className="sr-only">{` (${n} ${n === 1 ? 'needs' : 'need'} a look)`}</span>
      <span aria-hidden>{n}</span>
    </span>
  );
}
