import type { NeedRow } from '../../board/needsYou.js';
import { useSettledNeeds } from '../../hooks/useNeedsRows.js';

/** The phone top bar's Desk badge: an honest count (UI-CONTRACT §5) — nothing until settled, "N+" when partial. */
export function PhoneNeedsBadge({ needRows, runsKnown, runsFailed = false }: { needRows: readonly NeedRow[]; runsKnown: boolean; runsFailed?: boolean }): React.ReactElement | null {
  const n = useSettledNeeds(needRows, runsKnown, runsFailed);
  if (n.phase === 'loading') return <span data-testid="phone-needs-badge" data-phase="loading" role="status" className="wk-topbar-checking">Checking…</span>;
  if (n.count === null || n.count === 0) return null;
  const text = n.phase === 'partial' ? `${n.count}+` : String(n.count);
  return <span data-testid="phone-needs-badge" data-phase={n.phase} aria-label={`${text} things need you`} className="wk-rail-badge wk-num">{text}</span>;
}
