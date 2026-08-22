import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SessionView } from '../api/types.js';
import { windowRows } from '../board/boardWindow.js';
import { useBoardModel, type BoardProject } from '../hooks/useBoardModel.js';
import type { Navigate } from '../hooks/useRoute.js';
import { modePath, projectPath } from '../hooks/useRoute.js';
import { useTriageCursor, type TriageCursor, type TriageItem } from '../hooks/useTriageCursor.js';
import { useGateStore } from '../store/gates.js';
import { GateLatencyChart } from './GateLatencyChart.js';
import { LiveFeed } from './LiveFeed.js';
import { ACTIVE_CARD_H, ago, ProjectCard, QUIET_CARD_H } from './ProjectCard.js';
import { ProjectSparkline } from './ProjectSparkline.js';
import { RunOutcomeBar } from './RunOutcomeBar.js';
import { TokenBurnSparkline } from './TokenBurnSparkline.js';

/**
 * The orchestrator home board (DES-MERGE-001 §1.2/§1.4; bands per DES-UXFIX-001
 * §2.1.4, slice 1) — the route `/`.
 *
 * A wall of what is happening across many unrelated projects at once, in TWO
 * bands read off each project's decayed attention score (§2.1.3):
 *
 *   NEEDS YOU — score at or above the triage threshold, score-ordered. Full
 *   cards. This is what a returning operator scans first.
 *   QUIET (N) — the calm majority, collapsed to a header + a preview strip of
 *   one-line chips; expandable into a second windowed grid of full cards.
 *
 * "Many projects at once is the default case" (§1.4), so both grids are
 * WINDOWED against the ONE shared scroller (`boardWindow.ts`): cards are a
 * fixed height, only the rows the viewport can show (plus overscan) are
 * mounted, and the container never grows past the viewport.
 *
 * Vision slice 2 (DES-VISION-001 §1.3/§5.1): the route is now the status wall
 * (left, ~68%) beside the LIVE FEED (right, ~32%) — the one place cross-project
 * narration aggregates — and every color on the surface resolves from a semantic
 * token (§2.11, lint-enforced at ERROR for this file).
 *
 * Feedback slice E (DES-FEEDBACK-001 §2): a 64px METRICS BAR sits between the
 * chrome and the wall — three SVG-first tiles, each answering a §2.1 named
 * operator question (EC19), all derived from stores the page already holds
 * (zero new requests). The bar AUGMENTS the wall and the live feed; neither
 * changes beneath it. The gate-latency tile hides under 900px (§2.2 — the
 * least critical at a glance; `.wk-metrics-mid` in global.css).
 */

/** Card gap — §1.3's composition (blocks and cards sit 8px apart, `--space-2`). */
const GAP = 8;
/** Below this the grid drops a column rather than squeezing a card unreadable —
 *  §1.3's `minmax(280px, 1fr)`: 3 ACTIVE cards up on the ~980px wall at 1440. */
const MIN_COL = 280;
/** Used when the container has not been measured yet (first paint, jsdom). */
const FALLBACK_W = 1200;
const FALLBACK_H = 900;
/** Nominal height of a band's header row — only windowing precision, not layout:
 *  an error here is absorbed by the grids' overscan row. */
const BAND_H = 34;
/** Collapsed QUIET shows at most this many one-line chips (D5). */
const QUIET_PREVIEW = 6;

// DES-VISION-001 §5.1's token map for this surface: page = `--surface-base`,
// cards = `--surface-card` (in ProjectCard), feed = `--surface-rail`, all text
// off the ink ramp, status colors only where they mean status.
const CSS = {
  bandLabel: {
    fontSize: 'var(--text-2xs)', fontWeight: 'var(--weight-bold)',
    letterSpacing: '0.08em', textTransform: 'uppercase',
    margin: '0 0 10px',
  },
  toggle: {
    background: 'none', border: 'none', cursor: 'pointer', padding: 0,
    fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', color: 'var(--ink-muted)',
  },
  chip: {
    display: 'inline-flex', alignItems: 'center', gap: '6px', textDecoration: 'none',
    fontSize: 'var(--text-xs)', color: 'var(--ink-muted)',
    border: '1px solid var(--surface-raised)', borderRadius: 'var(--radius-md)',
    padding: '4px 10px', whiteSpace: 'nowrap',
  },
} as const satisfies Record<string, React.CSSProperties>;

interface Props {
  runs: SessionView[];
  navigate: Navigate;
}

/** One band's windowed grid — same math as the pre-band board, used twice (D6).
 *  The NEEDS-YOU instance also carries the slice-H triage cursor (§2.2): the
 *  selected card's ring, its open reject note. QUIET passes nothing — the
 *  cursor never enters the quiet band. */
function BandGrid({ items, columns, rowH, firstRow, lastRow, navigate, cursor }: {
  items: BoardProject[];
  columns: number;
  rowH: number;
  firstRow: number;
  lastRow: number;
  navigate: Navigate;
  cursor?: TriageCursor;
}): React.ReactElement {
  const rows = Math.ceil(items.length / columns);
  const visible = lastRow < firstRow ? [] : items.slice(firstRow * columns, (lastRow + 1) * columns);
  return (
    <div style={{ position: 'relative', height: `${rows * rowH}px` }}>
      <div
        style={{
          position: 'absolute', top: `${firstRow * rowH}px`, left: 0, right: 0,
          display: 'grid', gap: `${GAP}px`,
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        }}
      >
        {visible.map((item) => (
          <ProjectCard
            key={item.project.id}
            item={item}
            navigate={navigate}
            kbdSelected={cursor?.selectedKey === item.project.id}
            rejectNoteFor={cursor?.noteFor ?? null}
            onRejectNoteClose={cursor?.closeNote}
          />
        ))}
      </div>
    </div>
  );
}

export function HomeBoard({ runs, navigate }: Props): React.ReactElement {
  const { items, unfiled, loading, error } = useBoardModel(runs);
  const scroller = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [scrollTop, setScrollTop] = useState(0);
  const [quietOpen, setQuietOpen] = useState(false);
  const [shelfOpen, setShelfOpen] = useState(false);

  useEffect(() => {
    const el = scroller.current;
    if (el === null) return;
    const measure = (): void => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    // The wall's width changes WITHOUT a window resize — the live feed mounts
    // beside it when the first run starts (§1.3) — so observe the element
    // itself; the window listener is the jsdom fallback.
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      return () => ro.disconnect();
    }
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  const needsYou = items.filter((i) => i.band === 'needs-you');
  const quiet = items.filter((i) => i.band === 'quiet');

  // ── Slice H (DES-FEEDBACK-002 §2): the keyboard triage cursor ──────────────
  // The cursor walks the NEEDS-YOU cards in the order the band already renders
  // (attention order — reused, never re-derived). Each card's actionable gate
  // is its LEADING waiting run — the same run whose chip leads the card.
  const gates = useGateStore((s) => s.gates);
  const triageItems = useMemo<TriageItem[]>(
    () =>
      needsYou.map((i) => {
        const waiting = i.runs.find((v) => v.session.status === 'awaiting_human');
        return {
          key: i.project.id,
          runId: waiting?.session.id ?? null,
          gate: waiting === undefined ? undefined : gates[waiting.session.id],
          // Enter opens what clicking the card's name opens: the dashboard.
          openPath: projectPath(i.project.id),
          projectId: i.project.id,
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- needsYou derives from items
    [items, gates],
  );
  const cursor = useTriageCursor(triageItems, navigate);

  const columns = Math.max(1, Math.floor((box.w || FALLBACK_W) / (MIN_COL + GAP)));
  // Each band windows over its OWN variant's fixed height (DES-UXFIX-001 §2.1.1,
  // slice 2): NEEDS YOU mounts rich ACTIVE cards, QUIET mounts one-line cards.
  const activeRowH = ACTIVE_CARD_H + GAP;
  const quietRowH = QUIET_CARD_H + GAP;
  const viewH = box.h || FALLBACK_H;

  // Each band's own top inside the shared scroller (D6). Coarse is fine: any
  // header-height error is smaller than the overscan row that absorbs it.
  const needsTop = BAND_H;
  const needsH = needsYou.length === 0 ? BAND_H : Math.ceil(needsYou.length / columns) * activeRowH;
  const quietGridTop = needsTop + needsH + BAND_H;

  const needsWin = windowRows(needsYou.length, columns, activeRowH, scrollTop, viewH, needsTop);
  const quietWin = quietOpen
    ? windowRows(quiet.length, columns, quietRowH, scrollTop, viewH, quietGridTop)
    : null;

  const mounted =
    (needsWin.lastRow < needsWin.firstRow
      ? 0
      : Math.min(needsYou.length, (needsWin.lastRow + 1) * columns) - needsWin.firstRow * columns) +
    (quietWin === null || quietWin.lastRow < quietWin.firstRow
      ? 0
      : Math.min(quiet.length, (quietWin.lastRow + 1) * columns) - quietWin.firstRow * columns);

  /** Every affordance is a real link — deep-linkable, middle-clickable. */
  const link = (path: string): { href: string; onClick: (e: React.MouseEvent) => void } => ({
    href: path,
    onClick: (e) => { e.preventDefault(); navigate(path); },
  });

  // The run-outcome tile buckets on the one honest per-run clock the board
  // already fetched — the membership attach times, merged across projects.
  const attachedAt = useMemo(() => {
    const merged: Record<string, number> = {};
    for (const item of items) Object.assign(merged, item.attachedAt);
    return merged;
  }, [items]);

  return (
    // §1.3's composition — with slice E's metrics bar (§2.2) banded above it.
    <div className="flex flex-1 flex-col overflow-hidden" style={{ background: 'var(--surface-base)' }}>
      <div
        data-testid="metrics-bar"
        style={{
          height: '64px', flexShrink: 0, display: 'flex', alignItems: 'stretch',
          background: 'var(--surface-rail)', padding: '0 var(--space-3)',
        }}
      >
        <RunOutcomeBar runs={runs} attachedAt={attachedAt} />
        {/* Hidden under 900px (§2.2) — the media query lives in global.css. */}
        <div className="wk-metrics-mid" style={{ display: 'flex', flex: 1, minWidth: 0 }}>
          <GateLatencyChart />
        </div>
        <TokenBurnSparkline />
      </div>

      <div className="flex min-w-0 flex-1 overflow-hidden">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <header
        style={{
          display: 'flex', alignItems: 'baseline', gap: '12px', flexShrink: 0,
          padding: 'var(--space-5) var(--space-6) var(--space-3)',
        }}
      >
        <h1
          style={{
            fontSize: 'var(--text-md)', fontWeight: 'var(--weight-bold)',
            color: 'var(--ink-high)', margin: 0,
          }}
        >
          Projects
        </h1>
        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-muted)', margin: 0 }}>
          Sorted by what needs you first.
        </p>
        {/* The flat run list this board replaced stays reachable (§1.5 escape hatch). */}
        <a
          href="/runs"
          onClick={(e) => { e.preventDefault(); navigate('/runs'); }}
          data-testid="all-runs-link"
          style={{ marginLeft: 'auto', fontSize: 'var(--text-xs)', color: 'var(--ink-muted)' }}
        >
          All runs ›
        </a>
      </header>

      <div
        ref={scroller}
        onScroll={onScroll}
        data-testid="project-board"
        data-total={items.length}
        data-needs-you={needsYou.length}
        data-quiet={quiet.length}
        data-rendered={mounted}
        style={{ flex: 1, overflowY: 'auto', padding: '0 var(--space-6) var(--space-6)' }}
      >
        {loading && (
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-dim)', fontFamily: 'var(--font-mono)' }}>Loading projects…</p>
        )}
        {!loading && error !== null && (
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--status-fail)' }}>Could not load projects: {error}</p>
        )}
        {!loading && error === null && items.length === 0 && (
          <div style={{ padding: 'var(--space-10) 0' }}>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-muted)', margin: '0 0 4px' }}>No projects yet</p>
            <a
              href="/projects"
              onClick={(e) => { e.preventDefault(); navigate('/projects'); }}
              data-testid="create-first-project"
              style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-high)' }}
            >
              Create your first project ›
            </a>
          </div>
        )}

        {items.length > 0 && (
          <section data-testid="band-needs-you" data-count={needsYou.length}>
            {/* Amber names the band because amber MEANS "you are the blocker"
                (§2.6) — a status color, not the accent (§1.5 rule 2). */}
            <p style={{ ...CSS.bandLabel, color: 'var(--status-gate)' }}>Needs you</p>
            {needsYou.length === 0 ? (
              // The all-quiet state (§3.1): calm is one line, not a wall of absence.
              <p data-testid="board-all-quiet" style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-muted)', margin: '0 0 6px' }}>
                Nothing needs you right now.
              </p>
            ) : (
              <BandGrid
                items={needsYou}
                columns={columns}
                rowH={activeRowH}
                firstRow={needsWin.firstRow}
                lastRow={needsWin.lastRow}
                navigate={navigate}
                cursor={cursor}
              />
            )}
            {/* Slice H (§2.5): the key hint, visible only while a cursor is
                active — the band teaches the keys exactly when they matter. */}
            {cursor.selectedKey !== null && (
              <p
                data-testid="triage-hint"
                style={{
                  fontSize: 'var(--text-2xs)', color: 'var(--ink-dim)',
                  fontFamily: 'var(--font-mono)', margin: '8px 0 0',
                }}
              >
                j/k select · a approve · r reject · ↵ open
              </p>
            )}
          </section>
        )}

        {quiet.length > 0 && (
          <section
            data-testid="band-quiet"
            data-count={quiet.length}
            data-expanded={quietOpen}
            style={{ marginTop: '18px' }}
          >
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px' }}>
              <p style={{ ...CSS.bandLabel, color: 'var(--ink-dim)', margin: 0 }}>Quiet ({quiet.length})</p>
              <button
                type="button"
                data-testid="band-quiet-toggle"
                onClick={() => setQuietOpen((v) => !v)}
                style={CSS.toggle}
              >
                {quietOpen ? '[ collapse ▴ ]' : '[ expand ▾ ]'}
              </button>
            </div>
            {quietOpen && quietWin !== null ? (
              <div style={{ marginTop: '10px' }}>
                <BandGrid
                  items={quiet}
                  columns={columns}
                  rowH={quietRowH}
                  firstRow={quietWin.firstRow}
                  lastRow={quietWin.lastRow}
                  navigate={navigate}
                />
              </div>
            ) : (
              // The §2.1.4 wireframe's own representation of the calm majority:
              // one demoted line per project, capped — never a grid of absence.
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '10px' }}>
                {quiet.slice(0, QUIET_PREVIEW).map((i) => (
                  <a
                    key={i.project.id}
                    {...link(modePath(i.project.id, 'build'))}
                    data-testid="quiet-chip"
                    data-project-id={i.project.id}
                    data-score={i.score.toFixed(2)}
                    style={CSS.chip}
                  >
                    <span aria-hidden style={{ color: 'var(--ink-dim)' }}>○</span>
                    {i.project.name}
                    {/* Slice E (§2.1): which quiet project is quietly doing work —
                        7-day activity inline, off the honest attach clock. */}
                    <ProjectSparkline runs={i.runs} attachedAt={i.attachedAt} />
                    <span style={{ color: 'var(--ink-dim)' }}>
                      · {ago(i.signal?.at ?? i.project.updated_at)}
                    </span>
                  </a>
                ))}
              </div>
            )}
          </section>
        )}

        {/* The ex-"Unfiled" shelf (F5, V18): LAST, collapsed, and absent entirely
            when nothing is unfiled — it can never lead, or even appear above, a
            real project. The word "Unfiled" appears nowhere. */}
        {unfiled.length > 0 && (
          <section
            data-testid="band-not-in-project"
            data-count={unfiled.length}
            data-expanded={shelfOpen}
            style={{ marginTop: '18px' }}
          >
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px' }}>
              <p style={{ ...CSS.bandLabel, color: 'var(--ink-dim)', margin: 0 }}>
                Not in a project ({unfiled.length})
              </p>
              <button
                type="button"
                data-testid="band-not-in-project-toggle"
                onClick={() => setShelfOpen((v) => !v)}
                style={CSS.toggle}
              >
                {shelfOpen ? '[ collapse ▴ ]' : '[ expand ▾ ]'}
              </button>
            </div>
            {shelfOpen && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '10px' }}>
                {unfiled.map((v) => (
                  <a
                    key={v.session.id}
                    {...link(`/runs/${v.session.id}`)}
                    data-testid="unfiled-run"
                    data-run-id={v.session.id}
                    style={{ ...CSS.chip, alignSelf: 'flex-start', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis' }}
                  >
                    {v.session.problem}
                    <span style={{ color: 'var(--ink-dim)' }}>· {v.session.status}</span>
                  </a>
                ))}
              </div>
            )}
          </section>
        )}
      </div>
      </div>

      {/* The live feed (§1.3 right column): all projects with moving runs,
          narrating off the SAME runtime store the cards read — zero new sockets. */}
      <LiveFeed items={items} navigate={navigate} />
      </div>
    </div>
  );
}
