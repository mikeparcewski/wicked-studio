import { useCallback, useEffect, useRef, useState } from 'react';
import type { SessionView } from '../api/types.js';
import { useBoardModel } from '../hooks/useBoardModel.js';
import type { Navigate } from '../hooks/useRoute.js';
import { CARD_H, ProjectCard } from './ProjectCard.js';

/**
 * The orchestrator home board (DES-MERGE-001 §1.2/§1.4, slice 5) — the route `/`.
 *
 * A wall of what is happening across many unrelated projects at once, sorted by
 * attention needed rather than recency. "Many projects at once is the default case"
 * (§1.4), so the grid is WINDOWED: cards are a fixed height, and only the rows the
 * viewport can show (plus one row of overscan) are mounted. Twenty projects mount a
 * dozen cards, not twenty, and the container never grows past the viewport.
 *
 * Static in this slice: the model reads REST on load. Live card updates are slice 6.
 */

const GAP = 14;
/** Below this the grid drops a column rather than squeezing a card unreadable. */
const MIN_COL = 320;
/** One row above and below the viewport, so a scroll never shows a gap. */
const OVERSCAN = 1;
/** Used when the container has not been measured yet (first paint, jsdom). */
const FALLBACK_W = 1200;
const FALLBACK_H = 900;

const S = {
  ink:    '#e6edf3',
  muted:  'rgba(230,237,243,0.55)',
  faint:  'rgba(230,237,243,0.3)',
  red:    '#f85149',
};

interface Props {
  runs: SessionView[];
  navigate: Navigate;
}

export function HomeBoard({ runs, navigate }: Props): React.ReactElement {
  const { items, loading, error } = useBoardModel(runs);
  const scroller = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [scrollTop, setScrollTop] = useState(0);

  useEffect(() => {
    const el = scroller.current;
    if (el === null) return;
    const measure = (): void => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  const columns = Math.max(1, Math.floor((box.w || FALLBACK_W) / (MIN_COL + GAP)));
  const rowH = CARD_H + GAP;
  const rows = Math.ceil(items.length / columns);
  const viewH = box.h || FALLBACK_H;
  const firstRow = Math.max(0, Math.floor(scrollTop / rowH) - OVERSCAN);
  const lastRow = Math.min(rows - 1, Math.ceil((scrollTop + viewH) / rowH) + OVERSCAN);
  const visible = items.slice(firstRow * columns, (lastRow + 1) * columns);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header
        style={{
          display: 'flex', alignItems: 'baseline', gap: '12px', flexShrink: 0,
          padding: '20px 24px 12px',
        }}
      >
        <h1 style={{ fontSize: '16px', fontWeight: 700, color: S.ink, margin: 0 }}>Projects</h1>
        <p style={{ fontSize: '12px', color: S.muted, margin: 0 }}>
          Sorted by what needs you first.
        </p>
        {/* The flat run list this board replaced stays reachable (§1.5 escape hatch). */}
        <a
          href="/runs"
          onClick={(e) => { e.preventDefault(); navigate('/runs'); }}
          data-testid="all-runs-link"
          style={{ marginLeft: 'auto', fontSize: '12px', color: S.muted }}
        >
          All runs ›
        </a>
      </header>

      <div
        ref={scroller}
        onScroll={onScroll}
        data-testid="project-board"
        data-total={items.length}
        data-rendered={visible.length}
        style={{ flex: 1, overflowY: 'auto', padding: '0 24px 24px' }}
      >
        {loading && (
          <p style={{ fontSize: '13px', color: S.faint, fontFamily: 'monospace' }}>Loading projects…</p>
        )}
        {!loading && error !== null && (
          <p style={{ fontSize: '13px', color: S.red }}>Could not load projects: {error}</p>
        )}
        {!loading && error === null && items.length === 0 && (
          <div style={{ padding: '40px 0' }}>
            <p style={{ fontSize: '14px', color: S.muted, margin: '0 0 4px' }}>No projects yet</p>
            <a
              href="/projects"
              onClick={(e) => { e.preventDefault(); navigate('/projects'); }}
              data-testid="create-first-project"
              style={{ fontSize: '12px', color: S.ink }}
            >
              Create your first project ›
            </a>
          </div>
        )}
        {items.length > 0 && (
          <div style={{ position: 'relative', height: `${rows * rowH}px` }}>
            <div
              style={{
                position: 'absolute', top: `${firstRow * rowH}px`, left: 0, right: 0,
                display: 'grid', gap: `${GAP}px`,
                gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
              }}
            >
              {visible.map((item) => (
                <ProjectCard key={item.project.id} item={item} navigate={navigate} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
