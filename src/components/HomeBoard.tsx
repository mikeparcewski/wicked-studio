import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { listCampaigns, type CampaignSummary } from '../api/campaigns.js';
import { getDiagnostics, type Diagnostics } from '../api/diagnostics.js';
import type { SteeringRule } from '../api/steering.js';
import type { GovernanceClaim, SessionView } from '../api/types.js';
import { getWikiScoreboard, type WikiRuleEvidenceRow } from '../api/wiki.js';
import { bandHint, bandLabel } from '../board/bandCopy.js';
import { windowRows } from '../board/boardWindow.js';
import type { LiveChatSnapshot } from '../board/chatStats.js';
import { isFreshInstall, needsYouRows } from '../board/needsYou.js';
import { leadMovingRun } from '../board/phaseProgress.js';
import { useBoardModel, type BoardProject } from '../hooks/useBoardModel.js';
import { modePath, projectPath, runTimelinePath, type Navigate } from '../hooks/useRoute.js';
import { useTriageCursor, type TriageCursor, type TriageItem } from '../hooks/useTriageCursor.js';
import { useGateStore } from '../store/gates.js';
import { useMembershipStore } from '../store/membership.js';
import { BatchGateBar } from './BatchGateBar.js';
import { EssenceStrip, essenceEntries, HomeKpiBand, HomeVerbs, RecentActivity } from './HomeCommand.js';
import { NeedsYouQueue } from './NeedsYouQueue.js';
import { ACTIVE_CARD_H, ago, ProjectCard, QUIET_CARD_H } from './ProjectCard.js';
import { humanTitle } from './runIdentity.js';
import { ProjectSparkline } from './ProjectSparkline.js';

/**
 * The HOME COMMAND CENTER (DES-HOME-COMMAND-CENTER) — the route `/`.
 *
 * The page answers three questions, in priority order, and nothing else:
 *
 *  1. WHAT NEEDS ME? — the NEEDS-YOU QUEUE (§3): one aggregated, deduped fold
 *     over every attention source (gates anywhere, recent failures, campaign
 *     gaps, blind repo graphs, stalled live chats), severity-ordered, each row
 *     narrated + aged + carrying an act-in-place verb. Calm copy exists ONLY
 *     as the same fold's zero-row branch — the contradiction guard is
 *     structural.
 *  2. IS THE PORTFOLIO HEALTHY? — the KPI band (§4: ≤6 dashboardKit tiles,
 *     honest deltas, thresholds only where they mean something, every tile a
 *     door), the RECENT ACTIVITY pulse (§5), and the PORTFOLIO wall below —
 *     the DES-VISION-001 many-projects-at-once card wall, kept: the queue is
 *     the item-level index, the cards are the project-level workbench (gate
 *     chips, batch bar, triage cursor), both reading the same stores.
 *  3. WHERE DO I GO / WHAT DO I START? — the creation verbs + the board-level
 *     Ask invite in the header, and the SECTION ESSENCE STRIP (one number +
 *     one door per section; absent wires are omitted, never zeros).
 *
 * Layout: full width; the command center (queue + right column) is capped so
 * the queue and the KPI band are BOTH visible without scrolling at 1440×700;
 * the wall keeps its own windowed scroller below (boardWindow.ts, unchanged).
 *
 * Wire honesty: the section wires (`/chats`, `/campaigns`, `/governance/*`,
 * wiki scoreboard, `/diagnostics`) are read once per mount, failure-tolerant:
 * a daemon that cannot answer degrades that feature to its absent state and
 * never the page (older tests' partial API mocks ride the same seam).
 */

/** Card gap — §1.3's composition (blocks and cards sit 8px apart, `--space-2`). */
const GAP = 8;
/** Below this the grid drops a column rather than squeezing a card unreadable. */
const MIN_COL = 280;
/** Used when the container has not been measured yet (first paint, jsdom). */
const FALLBACK_W = 1200;
const FALLBACK_H = 900;
/** Nominal height of a band's header row — only windowing precision, not layout. */
const BAND_H = 34;
/** Collapsed QUIET shows at most this many one-line chips (D5). */
const QUIET_PREVIEW = 6;
/** The coarse re-age tick for the queue/KPI clocks (the board-model idiom). */
const TICK_MS = 60_000;

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
  /** Opens the app-wide AskDock (App's own state) — the board-level Ask invite
   *  is the SAME dock the rail button opens, never a fork. */
  onOpenAsk: () => void;
}

/** One wall band's windowed grid — the pre-command-center math, unchanged (D6). */
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

/** The section wires the command center reads once per mount — null until (and
 *  unless) each answers; absence degrades the feature, never the page. */
interface HomeWires {
  chats: LiveChatSnapshot[] | null;
  campaigns: CampaignSummary[] | null;
  claims: GovernanceClaim[] | null;
  rules: SteeringRule[] | null;
  perRule: WikiRuleEvidenceRow[] | null;
  diag: Diagnostics | null;
}

const NO_WIRES: HomeWires = { chats: null, campaigns: null, claims: null, rules: null, perRule: null, diag: null };

export function HomeBoard({ runs, navigate, onOpenAsk }: Props): React.ReactElement {
  const { items, unfiled, failedAt, repos, loading, error } = useBoardModel(runs);
  const scroller = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [scrollTop, setScrollTop] = useState(0);
  const [quietOpen, setQuietOpen] = useState(false);
  const [shelfOpen, setShelfOpen] = useState(false);
  const [wires, setWires] = useState<HomeWires>(NO_WIRES);
  /** The coarse age tick — rows re-age without any data changing. */
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(t);
  }, []);

  // The section wires — one read each per mount, all failure-tolerant (§7):
  // a missing route / older daemon / partial test mock is an absent answer.
  useEffect(() => {
    let cancelled = false;
    const read = async <T,>(fn: () => Promise<T>): Promise<T | null> => {
      try {
        return await fn();
      } catch {
        return null;
      }
    };
    const deposit = (part: Partial<HomeWires>): void => {
      if (!cancelled) setWires((w) => ({ ...w, ...part }));
    };
    void read(() => api.listChats()).then((r) => r !== null && deposit({ chats: r.chats }));
    void read(() => listCampaigns()).then((r) => r !== null && deposit({ campaigns: r.campaigns }));
    void read(() => api.listClaims()).then((r) => r !== null && deposit({ claims: r.claims }));
    void read(() => api.listConformanceRules()).then(
      (r) => r !== null && deposit({ rules: r.rules as SteeringRule[] }),
    );
    void read(() => getWikiScoreboard()).then(
      (r) => r !== null && deposit({ perRule: r.scoreboard.evidence.per_rule }),
    );
    void read(() => getDiagnostics()).then((r) => r !== null && deposit({ diag: r }));
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const el = scroller.current;
    if (el === null) return;
    const measure = (): void => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
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
  const working = items.filter((i) => i.band === 'working');
  const quiet = items.filter((i) => i.band === 'quiet');

  const gates = useGateStore((s) => s.gates);
  const projectIdByRun = useMembershipStore((s) => s.projectIdByRun);

  // The board's charts + the queue's ages bucket on the one honest per-run
  // clock the board already fetched — membership attach, merged across projects.
  const attachedAt = useMemo(() => {
    const merged: Record<string, number> = {};
    for (const item of items) Object.assign(merged, item.attachedAt);
    return merged;
  }, [items]);

  // ── THE needs-you fold (§3) — the queue, the KPI tile and the calm state all
  // derive from THIS one call; no second derivation exists to disagree with it.
  const needRows = useMemo(
    () =>
      needsYouRows({
        runs,
        gates,
        failedAt,
        attachedAt,
        projectIds: projectIdByRun,
        chats: wires.chats ?? [],
        repos,
        campaigns: wires.campaigns ?? [],
        now,
      }),
    [runs, gates, failedAt, attachedAt, projectIdByRun, wires.chats, wires.campaigns, repos, now],
  );

  // Slice H's keyboard triage cursor — survives on the wall's gated cards.
  const triageItems = useMemo<TriageItem[]>(
    () =>
      needsYou.map((i) => {
        const waiting = i.runs.find((v) => v.session.status === 'awaiting_human');
        const moving = leadMovingRun(i.runs);
        return {
          key: i.project.id,
          runId: waiting?.session.id ?? null,
          gate: waiting === undefined ? undefined : gates[waiting.session.id],
          openPath: moving !== undefined
            ? runTimelinePath(moving.session.id)
            : projectPath(i.project.id),
          projectId: i.project.id,
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- needsYou derives from items
    [items, gates],
  );
  const cursor = useTriageCursor(triageItems, navigate);

  const columns = Math.max(1, Math.floor((box.w || FALLBACK_W) / (MIN_COL + GAP)));
  const activeRowH = ACTIVE_CARD_H + GAP;
  const quietRowH = QUIET_CARD_H + GAP;
  const viewH = box.h || FALLBACK_H;

  const needsTop = needsYou.length === 0 ? 0 : BAND_H;
  const needsH = needsYou.length === 0 ? 0 : Math.ceil(needsYou.length / columns) * activeRowH;
  const workingTop = needsTop + needsH + BAND_H;
  const workingH = working.length === 0 ? 0 : Math.ceil(working.length / columns) * activeRowH;
  const quietGridTop = workingTop + (working.length === 0 ? 0 : workingH + BAND_H);

  const needsWin = windowRows(needsYou.length, columns, activeRowH, scrollTop, viewH, needsTop);
  const workingWin = windowRows(working.length, columns, activeRowH, scrollTop, viewH, workingTop);
  const quietWin = quietOpen
    ? windowRows(quiet.length, columns, quietRowH, scrollTop, viewH, quietGridTop)
    : null;

  const mounted =
    (needsWin.lastRow < needsWin.firstRow
      ? 0
      : Math.min(needsYou.length, (needsWin.lastRow + 1) * columns) - needsWin.firstRow * columns) +
    (workingWin.lastRow < workingWin.firstRow
      ? 0
      : Math.min(working.length, (workingWin.lastRow + 1) * columns) - workingWin.firstRow * columns) +
    (quietWin === null || quietWin.lastRow < quietWin.firstRow
      ? 0
      : Math.min(quiet.length, (quietWin.lastRow + 1) * columns) - quietWin.firstRow * columns);

  /** Every affordance is a real link — deep-linkable, middle-clickable. */
  const link = (path: string): { href: string; onClick: (e: React.MouseEvent) => void } => ({
    href: path,
    onClick: (e) => { e.preventDefault(); navigate(path); },
  });

  const docsCount = useMemo(() => items.reduce((a, i) => a + i.docs.length, 0), [items]);
  const essences = useMemo(
    () =>
      essenceEntries({
        projects: items.length,
        docs: docsCount,
        chats: wires.chats === null ? null : wires.chats.length,
        repos,
        campaigns: wires.campaigns === null ? null : wires.campaigns.length,
        rules: wires.rules,
        perRule: wires.perRule,
        diag: wires.diag,
        now,
      }),
    [items.length, docsCount, wires, repos, now],
  );

  // The fresh-install welcome (§6): verbs + Ask, prominent — and NOTHING
  // measured, because nothing has ever run (no fabricated zeros).
  const fresh = !loading && error === null && isFreshInstall(items.length, runs, repos);

  return (
    <div className="flex flex-1 flex-col overflow-hidden" style={{ background: 'var(--surface-base)' }}>
      {/* ── Header: the page name, the creation verbs, Ask, the escape hatch ── */}
      <header
        style={{
          display: 'flex', alignItems: 'center', gap: '14px', flexShrink: 0, flexWrap: 'wrap',
          padding: 'var(--space-4) var(--space-6) var(--space-3)',
        }}
      >
        <div style={{ minWidth: 0 }}>
          <h1
            style={{
              fontSize: 'var(--text-md)', fontWeight: 'var(--weight-bold)',
              color: 'var(--ink-high)', margin: 0,
            }}
          >
            Home
          </h1>
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-muted)', margin: 0 }}>
            What needs you, across everything.
          </p>
        </div>
        {!fresh && <HomeVerbs navigate={navigate} onOpenAsk={onOpenAsk} />}
        {/* The flat run list stays reachable (§1.5 escape hatch) — at /work. */}
        <a
          href="/work"
          onClick={(e) => { e.preventDefault(); navigate('/work'); }}
          data-testid="all-runs-link"
          style={{ marginLeft: 'auto', fontSize: 'var(--text-xs)', color: 'var(--ink-muted)', flexShrink: 0 }}
        >
          All runs ›
        </a>
      </header>

      {loading && (
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-dim)', fontFamily: 'var(--font-mono)', padding: '0 var(--space-6)' }}>
          Loading projects…
        </p>
      )}
      {!loading && error !== null && (
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--status-fail)', padding: '0 var(--space-6)' }}>
          Could not load projects: {error}
        </p>
      )}

      {fresh && (
        <div data-testid="home-welcome" style={{ padding: 'var(--space-8) var(--space-6)', maxWidth: '760px' }}>
          <p style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-semi)', color: 'var(--ink-high)', margin: '0 0 6px' }}>
            Nothing here yet — point the crew at something.
          </p>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-muted)', margin: '0 0 18px' }}>
            Register a repo to index it, start a run or a chat, or just ask.
          </p>
          <HomeVerbs navigate={navigate} onOpenAsk={onOpenAsk} prominent />
        </div>
      )}

      {!fresh && !loading && error === null && (
        <>
          {/* ── The command center: queue (spine, left) + the analytics column.
                 Both the queue and the KPI band are fully visible at 1440×700. ── */}
          <div
            data-testid="command-center"
            style={{
              flexShrink: 0, display: 'flex', gap: 'var(--space-4)', alignItems: 'stretch',
              padding: '0 var(--space-6) var(--space-4)', maxHeight: '56vh', minHeight: 0,
            }}
          >
            <NeedsYouQueue rows={needRows} runs={runs} navigate={navigate} now={now} />
            <div
              style={{
                flex: '1 1 0', minWidth: '320px', display: 'flex', flexDirection: 'column',
                gap: 'var(--space-3)', overflowY: 'auto', minHeight: 0,
              }}
            >
              <HomeKpiBand
                runs={runs}
                attachedAt={attachedAt}
                needRows={needRows}
                claims={wires.claims}
                navigate={navigate}
                now={now}
              />
              <RecentActivity runs={runs} navigate={navigate} now={now} />
            </div>
          </div>

          {/* The essence strip rides full-width under the command center — a
              compact row of section doors that can never clip in a column. */}
          <div style={{ flexShrink: 0, padding: '0 var(--space-6) var(--space-3)' }}>
            <EssenceStrip entries={essences} navigate={navigate} />
          </div>

          {/* Slice L: the batch bar docks above the wall while ≥1 simple gate is selected. */}
          <BatchGateBar navigate={navigate} />

          {/* ── The PORTFOLIO wall — DES-VISION-001's many-projects-at-once cards,
                 windowed against its own scroller exactly as before. ── */}
          <div
            ref={scroller}
            onScroll={onScroll}
            data-testid="project-board"
            data-total={items.length}
            data-needs-you={needsYou.length}
            data-working={working.length}
            data-quiet={quiet.length}
            data-rendered={mounted}
            style={{ flex: 1, overflowY: 'auto', padding: '0 var(--space-6) var(--space-6)', minHeight: '120px' }}
          >
            {items.length === 0 && (
              <div style={{ padding: 'var(--space-6) 0' }}>
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

            {/* The wall's NEEDS-YOU band renders only when it HOLDS something:
                calm copy has exactly one owner now — the queue above (§3). */}
            {needsYou.length > 0 && (
              <section data-testid="band-needs-you" data-count={needsYou.length}>
                <p style={{ ...CSS.bandLabel, color: 'var(--status-gate)' }} title={bandHint('needs-you')}>{bandLabel('needs-you')}</p>
                <BandGrid
                  items={needsYou}
                  columns={columns}
                  rowH={activeRowH}
                  firstRow={needsWin.firstRow}
                  lastRow={needsWin.lastRow}
                  navigate={navigate}
                  cursor={cursor}
                />
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

            {working.length > 0 && (
              <section data-testid="band-working" data-count={working.length} style={{ marginTop: needsYou.length > 0 ? '18px' : 0 }}>
                <p style={{ ...CSS.bandLabel, color: 'var(--status-run)' }} title={bandHint('working')}>{bandLabel('working')}</p>
                <BandGrid
                  items={working}
                  columns={columns}
                  rowH={activeRowH}
                  firstRow={workingWin.firstRow}
                  lastRow={workingWin.lastRow}
                  navigate={navigate}
                />
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
                  <p style={{ ...CSS.bandLabel, color: 'var(--ink-dim)', margin: 0 }} title={bandHint('quiet')}>{bandLabel('quiet')} ({quiet.length})</p>
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
                        <ProjectSparkline runs={i.runs} attachedAt={i.attachedAt} />
                        <span style={{ color: 'var(--ink-dim)' }}>
                          · {ago(i.signal?.at ?? i.project.updated_at)}
                        </span>
                      </a>
                    ))}
                    {quiet.length > QUIET_PREVIEW && (
                      <span
                        data-testid="quiet-preview-cap"
                        style={{
                          fontSize: 'var(--text-2xs)', color: 'var(--ink-dim)',
                          fontFamily: 'var(--font-mono)', alignSelf: 'center',
                        }}
                      >
                        showing {QUIET_PREVIEW} of {quiet.length}
                      </span>
                    )}
                  </div>
                )}
              </section>
            )}

            {/* The ex-"Unfiled" shelf (F5, V18): LAST, collapsed, absent when empty. */}
            {unfiled.length > 0 && (
              <section
                data-testid="band-not-in-project"
                data-count={unfiled.length}
                data-expanded={shelfOpen}
                style={{ marginTop: '18px' }}
              >
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px' }}>
                  <p style={{ ...CSS.bandLabel, color: 'var(--ink-dim)', margin: 0 }}>
                    Unfiled runs ({unfiled.length})
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
                        title={v.session.problem}
                        style={{ ...CSS.chip, alignSelf: 'flex-start', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis' }}
                      >
                        {humanTitle(v.session.problem)}
                        <span style={{ color: 'var(--ink-dim)' }}>· {v.session.status}</span>
                      </a>
                    ))}
                  </div>
                )}
              </section>
            )}
          </div>
        </>
      )}
    </div>
  );
}
