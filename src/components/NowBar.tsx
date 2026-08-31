import { useEffect, useRef, useState } from 'react';
import type { WorkUnit } from '../api/types.js';
import { TONE_COLOR, type NarrationLine, type RunArtifact } from './narrator.js';
import { ArtifactCard } from './ArtifactCard.js';

/**
 * The sticky now-bar (DES-RUN-NARRATOR §2, §11.4): a pinned strip that always
 * answers "what is happening RIGHT NOW" — run/chat state, the active phase
 * (unit K of N; the chat surface passes its own `contextLabel` instead), the
 * latest narration line, and the collected-artifacts chip — visible regardless
 * of where the feed is scrolled, because it lives OUTSIDE the scroll region.
 * "Latest ↓" scrolls the feed to its live tail.
 */

function statusPhrase(status: string): { text: string; color: string } {
  switch (status) {
    case 'completed':      return { text: 'completed', color: 'var(--status-done)' };
    case 'failed':         return { text: 'failed', color: 'var(--status-fail)' };
    case 'cancelled':      return { text: 'cancelled', color: 'var(--ink-dim)' };
    case 'awaiting_human': return { text: 'waiting on you', color: 'var(--status-gate)' };
    case 'planning':       return { text: 'planning', color: 'var(--status-run)' };
    case 'distributing':   return { text: 'routing', color: 'var(--status-run)' };
    // §11.4 chat vocabulary: seats warming, and the idle "it's your move".
    case 'connecting':     return { text: 'connecting', color: 'var(--status-run)' };
    case 'your_turn':      return { text: 'your turn', color: 'var(--status-gate)' };
    default:               return { text: 'working', color: 'var(--status-run)' };
  }
}

export function NowBar({
  status,
  orderedUnits = [],
  executingUnitOrd = null,
  phaseOf = () => '?',
  contextLabel,
  lastLine,
  artifacts,
  onJumpToLatest,
  onOpenFile,
}: {
  /** The run's `session.status`, or the chat surface's derived state (§11.4). */
  status: string;
  /** ord-sorted units (the caller's memo) — the run surface only. */
  orderedUnits?: WorkUnit[];
  executingUnitOrd?: number | null;
  phaseOf?: (ord: number | null | undefined) => string;
  /** A caller-owned phrase for the phase slot (the chat surface's seat census). */
  contextLabel?: string | null;
  /** The newest spoken narration line, or null when the trail is silent. */
  lastLine: NarrationLine | null;
  artifacts: RunArtifact[];
  onJumpToLatest: () => void;
  onOpenFile?: ((path: string) => void) | undefined;
}): React.ReactElement {
  const { text: statusText, color: statusColor } = statusPhrase(status);
  const live = !['completed', 'cancelled', 'failed'].includes(status);

  const cursorIx = executingUnitOrd === null ? -1 : orderedUnits.findIndex((u) => u.ord === executingUnitOrd);
  const activeUnit = cursorIx === -1 ? null : orderedUnits[cursorIx] ?? null;

  // The "now" phrase: the caller's own label when it has one, else the active
  // phase while one runs, otherwise the run state.
  const phaseLabel =
    contextLabel ??
    (activeUnit !== null
      ? `${phaseOf(activeUnit.ord)} — unit ${cursorIx + 1} of ${orderedUnits.length}`
      : status === 'awaiting_human'
        ? 'paused at a gate'
        : orderedUnits.length > 0
          ? `${orderedUnits.filter((u) => u.status === 'done').length} of ${orderedUnits.length} phases done`
          : null);

  // Fallback narration when the trail is silent (pruned log / no events yet).
  const nowText =
    lastLine?.text ??
    (activeUnit !== null
      ? `Working on ${phaseOf(activeUnit.ord)}${activeUnit.description ? ` — ${activeUnit.description}` : ''}`
      : status === 'awaiting_human'
        ? 'Waiting on your decision below'
        : `Run ${statusText}`);
  const nowColor = lastLine !== null ? TONE_COLOR[lastLine.tone] : 'var(--ink-muted)';

  const [artifactsOpen, setArtifactsOpen] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!artifactsOpen) return;
    function onOutside(e: MouseEvent): void {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setArtifactsOpen(false);
    }
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, [artifactsOpen]);

  return (
    <div
      data-testid="now-bar"
      className="flex items-center gap-2.5 px-6 py-2 shrink-0 font-mono text-[12px] relative"
      style={{ borderBottom: '1px solid var(--surface-raised)', background: 'var(--surface-card)' }}
    >
      <span
        className={`inline-block w-2 h-2 rounded-full shrink-0 ${live ? 'animate-pulse' : ''}`}
        style={{ background: statusColor }}
        aria-hidden="true"
      />
      <span data-testid="now-bar-status" className="shrink-0 font-semibold" style={{ color: statusColor }}>
        {statusText}
      </span>
      {phaseLabel !== null && (
        <span data-testid="now-bar-phase" className="shrink-0" style={{ color: 'var(--ink-body)' }}>
          {phaseLabel}
        </span>
      )}
      <span
        data-testid="now-bar-narration"
        className="flex-1 min-w-0 truncate"
        style={{ color: nowColor }}
        title={nowText}
      >
        {nowText}
      </span>
      {artifacts.length > 0 && (
        <div ref={popRef} className="relative shrink-0">
          <button
            type="button"
            data-testid="now-bar-artifacts"
            onClick={() => setArtifactsOpen((v) => !v)}
            aria-expanded={artifactsOpen}
            title={`${artifacts.length} artifact${artifacts.length === 1 ? '' : 's'} so far — files touched, deliverables`}
            className="rounded-full px-2.5 py-0.5 text-[11px]"
            style={{
              background: 'var(--surface-raised)',
              color: 'var(--ink-body)',
              border: '1px solid var(--surface-overlay)',
              cursor: 'pointer',
            }}
          >
            ▤ {artifacts.length}
          </button>
          {artifactsOpen && (
            <div
              data-testid="now-bar-artifacts-pop"
              className="absolute right-0 top-full mt-1 z-20 flex flex-col gap-1 rounded-lg p-2 max-h-64 overflow-y-auto"
              style={{
                background: 'var(--surface-card)',
                border: '1px solid var(--surface-overlay)',
                minWidth: '18rem',
                boxShadow: 'var(--shadow-overlay)',
              }}
            >
              {artifacts.map((a) => (
                <ArtifactCard key={a.ref} artifact={a} onOpenFile={onOpenFile} compact />
              ))}
            </div>
          )}
        </div>
      )}
      <button
        type="button"
        data-testid="now-bar-jump"
        onClick={onJumpToLatest}
        title="Scroll the feed to the latest activity"
        className="shrink-0 rounded-full px-2.5 py-0.5 text-[11px]"
        style={{
          background: 'var(--surface-raised)',
          color: 'var(--ink-muted)',
          border: '1px solid var(--surface-overlay)',
          cursor: 'pointer',
        }}
      >
        Latest ↓
      </button>
    </div>
  );
}
