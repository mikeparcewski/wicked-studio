import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';
import { listDocs, type DocSummary } from '../api/interactive.js';
import { useDocsCache } from '../store/docsCache.js';
import type { SessionView } from '../api/types.js';
import { compareScored, scoreOf, type Signal, type SignalKind } from '../board/boardAttention.js';
import { WINDOW_LABEL_STYLE } from '../board/metrics.js';
import { sessionProjectId } from '../hooks/ambientProject.js';
import { interactiveRootOf } from '../hooks/useBoardModel.js';
import { modePath, type Mode, type Navigate } from '../hooks/useRoute.js';
import { useTriageCursor, type TriageItem } from '../hooks/useTriageCursor.js';
import { useGateStore } from '../store/gates.js';
import { useProjectsStore } from '../store/projects.js';
import { getCachedRepos } from '../store/repoCache.js';
import { BatchGateBar, BatchSelectBox } from './BatchGateBar.js';
import { GateChip } from './GateChip.js';
import { GateRejectNote } from './GateRejectNote.js';
import { MODE_LABEL } from './ProjectShell.js';
import { ago, ATTENTION_DOT } from './ProjectCard.js';
import { deliverySummary } from './delivery.js';
import { DeliveryChip } from './RunDelivery.js';
import { RunSparkline } from './RunSparkline.js';
import { STATUS_STYLE } from './RunCard.js';

/**
 * The project dashboard (DES-FEEDBACK-001 §4.1, slice D): what `/p/:projectId`
 * with NO mode segment renders — context before actions. It is NOT a fifth
 * mode (no Dashboard tab in the switcher); it is what you see before you
 * choose one, and where the context header's project name leads back to.
 *
 * Everything here derives from data the app already fetches: the shared `runs`
 * list (passed down from App's one `useRuns()`), one membership read (the same
 * call the board makes per project), one `listDocs(projectId)` (the same call
 * Document mode makes — only when the project has an interactive root), and
 * the gate store `useRuns` already reconciles. No polling loops.
 */

/** Statuses that mean the run is moving under its own power (board's set). */
const ACTIVE: ReadonlySet<string> = new Set(['planning', 'distributing', 'executing']);

/** Membership kinds that make a run/thread a member of a project. */
const RUN_KINDS: ReadonlySet<string> = new Set(['crew.run', 'crew.chat']);

const DAY = 24 * 3_600_000;
/** The activity tile's window (§4.1 tile 4): 7 daily run-count buckets. */
const SPARK_DAYS = 7;

/** Rows a tile shows before it reports a count instead of growing. */
const MAX_ROWS = 6;

const CSS = {
  page: { padding: 'var(--space-5) var(--space-6)', maxWidth: '1080px' },
  name: {
    fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-bold)',
    fontFamily: 'var(--font-sans)', color: 'var(--ink-high)', margin: 0,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  modeBtn: {
    display: 'inline-flex', alignItems: 'center', gap: '5px', textDecoration: 'none',
    background: 'var(--surface-raised)', border: '1px solid var(--surface-raised)',
    borderRadius: 'var(--radius-md)', color: 'var(--ink-high)', cursor: 'pointer',
    fontSize: 'var(--text-xs)', fontFamily: 'var(--font-sans)', padding: '5px 12px',
    whiteSpace: 'nowrap',
  },
  meta: {
    fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)',
    color: 'var(--ink-muted)', margin: '6px 0 0',
  },
  grid: {
    display: 'grid', gap: 'var(--space-3)', marginTop: 'var(--space-4)',
    // §4.1's 2x2: two columns at the page's 1080px max (auto-fit's only job is
    // the 1-column fallback below ~430px tiles — never a 3+1 row).
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))',
  },
  tile: {
    background: 'var(--surface-card)', boxShadow: 'var(--shadow-card)',
    borderRadius: 'var(--radius-lg)', padding: 'var(--space-4)', minWidth: 0,
  },
  tileHead: {
    fontSize: 'var(--text-2xs)', fontWeight: 'var(--weight-bold)',
    letterSpacing: '0.08em', textTransform: 'uppercase',
    color: 'var(--ink-muted)', margin: '0 0 10px',
  },
  row: {
    display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0,
    fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', color: 'var(--ink-body)',
    border: '1px solid var(--surface-raised)', borderRadius: 'var(--radius-md)',
    padding: '5px 8px', textDecoration: 'none',
  },
  rowText: {
    flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  empty: { fontSize: 'var(--text-xs)', color: 'var(--ink-dim)', margin: 0 },
  overflow: { fontSize: 'var(--text-xs)', color: 'var(--ink-muted)', margin: '6px 0 0' },
  // studio#122: the delivery census, directly under the RUNS head. Data, so mono
  // and dim — the tile's own count stays the headline.
  deliverySummary: {
    fontSize: 'var(--text-2xs)', fontFamily: 'var(--font-mono)',
    color: 'var(--ink-dim)', margin: '-6px 0 10px',
  },
} as const satisfies Record<string, React.CSSProperties>;

/** The per-run attention signal — the home board's model (§2.1.3) scoped to one run. */
function runSignal(v: SessionView, gateAt: number | undefined, fallback: number): Signal | null {
  const status = v.session.status;
  const kind: SignalKind | null =
    status === 'awaiting_human' ? 'gate'
    : status === 'failed' ? 'failing'
    : ACTIVE.has(status) ? 'running'
    : null;
  return kind === null ? null : { kind, at: gateAt ?? fallback, runId: v.session.id };
}

interface Props {
  projectId: string;
  /** The one cross-project run list App already holds (`useRuns()`). */
  runs: SessionView[];
  navigate: Navigate;
}

export function ProjectDashboard({ projectId, runs, navigate }: Props): React.ReactElement {
  const projects = useProjectsStore((s) => s.projects);
  const loadProjects = useProjectsStore((s) => s.load);
  const gates = useGateStore((s) => s.gates);

  useEffect(() => {
    if (projects.length === 0) void loadProjects();
  }, [projects.length, loadProjects]);

  const project = projects.find((p) => p.id === projectId) ?? null;
  const name = project?.name ?? projectId;

  // One membership read on mount — the same call the board makes per project.
  // ref → kind (a `crew.chat` member opens in Chat), ref → attached_at (the
  // honest per-run clock this wire carries; `AgentSession` has no timestamps).
  const [memberKinds, setMemberKinds] = useState<Record<string, string>>({});
  const [attachedAt, setAttachedAt] = useState<Record<string, number>>({});
  // Slice J (DES-FEEDBACK-002 §10.2): the same read already returns the
  // project's `crew.repo` members — the wire grammar names the kind — and the
  // RUN_KINDS filter used to drop them on the floor. Zero new requests.
  const [repoRefs, setRepoRefs] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    api.listProjectMembers(projectId)
      .then(({ members }) => {
        if (cancelled) return;
        const kinds: Record<string, string> = {};
        const at: Record<string, number> = {};
        const repos: string[] = [];
        for (const m of members) {
          if (m.member_kind === 'crew.repo') {
            repos.push(m.member_ref);
            continue;
          }
          if (!RUN_KINDS.has(m.member_kind)) continue;
          kinds[m.member_ref] = m.member_kind;
          at[m.member_ref] = m.attached_at;
        }
        setMemberKinds(kinds);
        setAttachedAt(at);
        setRepoRefs(repos);
      })
      .catch(() => { /* members unreadable — the tiles simply stay empty */ });
    return () => { cancelled = true; };
  }, [projectId]);

  // One listDocs on mount — the same call Document mode makes — and only when
  // the project HAS an interactive root (the board's §7.12 guard: no root, no
  // bridge to cold-start).
  const [docs, setDocs] = useState<DocSummary[]>([]);
  useEffect(() => {
    if (project === null || interactiveRootOf(project) === null) return;
    let cancelled = false;
    listDocs(projectId)
      .then((d) => {
        useDocsCache.getState().deposit(projectId, d); // slice O §4.2.2: the session doc cache
        if (!cancelled) setDocs(d);
      })
      .catch(() => { /* bridge cold/unreachable — no doc tiles, never an error wall */ });
    return () => { cancelled = true; };
  }, [projectId, project]);

  // ── The project's runs, attention-ordered (the board's model, §4.1 tile 1) ──
  const fallbackAt = project?.updated_at ?? 0;
  const myRuns = useMemo(() => {
    const now = Date.now();
    return runs
      // Slice S (DES-UX-001 §2.3 rule 3): the run DTO's own `project_id` claim
      // (CREW-UX-2) places a run here the instant `GET /runs` reconciles — no
      // waiting on the mount-time members snapshot. The membership join stays
      // as the pre-0.8.0 fallback (field absent) and as the kind/clock source.
      .filter((v) => {
        if (v.session.archived_at != null) return false;
        const claimed = sessionProjectId(v.session);
        return claimed !== undefined ? claimed === projectId : v.session.id in memberKinds;
      })
      .map((v) => {
        const signal = runSignal(v, gates[v.session.id]?.receivedAt, attachedAt[v.session.id] ?? fallbackAt);
        return {
          view: v,
          signal,
          score: signal === null ? 0 : scoreOf(signal, now),
          at: signal?.at ?? attachedAt[v.session.id] ?? fallbackAt,
        };
      })
      .sort((a, b) => compareScored(
        { score: a.score, at: a.at, name: a.view.session.problem },
        { score: b.score, at: b.at, name: b.view.session.problem },
      ));
  }, [runs, memberKinds, attachedAt, gates, fallbackAt, projectId]);

  const openRuns = myRuns.filter(({ view }) => !['completed', 'cancelled', 'failed'].includes(view.session.status));
  const waiting = myRuns.filter(({ view }) => view.session.status === 'awaiting_human');

  // ── The 7-day run-count sparkline (§4.1 tile 4): one bucket per day, oldest
  // first, counted off the membership attach clock — when each run entered the
  // project, the one per-run timestamp this wire carries. ──
  const now = Date.now();
  const sparkCounts = useMemo(() => {
    const counts = new Array<number>(SPARK_DAYS).fill(0);
    for (const id of Object.keys(attachedAt)) {
      const age = now - (attachedAt[id] ?? 0);
      if (age < 0 || age >= SPARK_DAYS * DAY) continue;
      const bucket = SPARK_DAYS - 1 - Math.floor(age / DAY);
      counts[bucket] = (counts[bucket] ?? 0) + 1;
    }
    return counts;
    // `now` deliberately not a dep: the tile re-derives when the data moves, not on a timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachedAt]);
  const sparkTotal = sparkCounts.reduce((a, c) => a + c, 0);

  // Meta line (§4.1): last activity + open runs. Cost is NOT here on purpose —
  // the `/runs` wire carries no cost field, and the dashboard never invents one.
  const lastActivity = Math.max(
    fallbackAt,
    ...Object.values(attachedAt),
    ...waiting.map(({ view }) => gates[view.session.id]?.receivedAt ?? 0),
  );

  /** Every affordance is a real link — deep-linkable, middle-clickable. */
  const link = (path: string): { href: string; onClick: (e: React.MouseEvent) => void } => ({
    href: path,
    onClick: (e) => { e.preventDefault(); navigate(path); },
  });

  /** Where a run row opens: its OWN mode view — Chat for a chat thread, Build otherwise. */
  const runModeOf = (id: string): Mode => (memberKinds[id] === 'crew.chat' ? 'chat' : 'build');

  // ── Slice H (DES-FEEDBACK-002 §2.2): the triage cursor walks the gate-inbox
  // rows — the tile the surface already renders, in its order. `resetKey`
  // clears the cursor when the dashboard pivots projects without unmounting.
  const inboxRows = waiting.slice(0, MAX_ROWS);
  const triageItems = useMemo<TriageItem[]>(
    () =>
      inboxRows.map(({ view }) => {
        const id = view.session.id;
        return {
          key: id,
          runId: id,
          gate: gates[id],
          openPath: modePath(projectId, runModeOf(id), id),
          projectId,
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- inboxRows/runModeOf derive from these
    [waiting, gates, memberKinds, projectId],
  );
  const cursor = useTriageCursor(triageItems, navigate, projectId);

  return (
    <div data-testid="project-dashboard" data-project-id={projectId} style={CSS.page}>
      {/* ── Project header: name, the four mode verbs, the meta line (§4.1) ── */}
      <header>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <h1 style={CSS.name}>{name}</h1>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {(Object.keys(MODE_LABEL) as Mode[]).map((m) => (
              <a
                key={m}
                {...link(modePath(projectId, m))}
                data-testid={`dashboard-mode-${m}`}
                style={CSS.modeBtn}
              >
                {MODE_LABEL[m]}
              </a>
            ))}
          </div>
        </div>
        <p style={CSS.meta} data-testid="dashboard-meta">
          last activity {ago(lastActivity)} ago · {openRuns.length} open {openRuns.length === 1 ? 'run' : 'runs'}
        </p>
        {/* ── Slice J (§10.2): bound repos in the header's meta-line region —
            not a fifth tile (the 2×2 grid is a load-bearing §4.1 shape). Names
            resolve from the SAME session repo cache the palette holds (§1.4) —
            never a fetch; an unresolvable ref renders the raw ref in --ink-dim
            (membership is the truth even when the repo listing lags). Zero
            repos = the row is absent (empty-state budget). ── */}
        {repoRefs.length > 0 && (
          <p data-testid="dashboard-repos" style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', margin: '6px 0 0' }}>
            {repoRefs.map((ref) => {
              const known = getCachedRepos()?.find((r) => r.id === ref || r.name === ref);
              return (
                <a
                  key={ref}
                  {...link(`/repo-detail/${encodeURIComponent(known?.id ?? ref)}`)}
                  data-testid="dashboard-repo"
                  data-repo-ref={ref}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: '4px',
                    fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)',
                    color: known !== undefined ? 'var(--ink-muted)' : 'var(--ink-dim)',
                    textDecoration: 'none',
                  }}
                >
                  <span aria-hidden>⬡</span>
                  {known?.name ?? ref}
                </a>
              );
            })}
          </p>
        )}
      </header>

      {/* Slice L (§9.2): the batch bar docks above the tiles while ≥1 simple
          gate is selected — the same bar (and fan-out) as the home board. */}
      <BatchGateBar navigate={navigate} />

      <div style={CSS.grid}>
        {/* ── Tile 1: runs, attention-ordered, each a link into its mode view ── */}
        {/* Slice W (§5.3, EC34): the header counts the SAME collection its rows
            render — the old "Active runs (open-count)" over an all-runs list was
            the "ACTIVE RUNS (0) over two rows" contradiction class. `data-count`
            is the RENDERED row count (set-equal on the same paint); the cap
            declares itself in the head, and the window is named (EC39). */}
        <section
          data-testid="dashboard-runs"
          data-count={Math.min(myRuns.length, MAX_ROWS)}
          data-window="all"
          style={CSS.tile}
        >
          <p style={CSS.tileHead}>
            Runs ({myRuns.length > MAX_ROWS ? `${MAX_ROWS} of ${myRuns.length}` : myRuns.length}){' '}
            <span data-testid="dashboard-runs-window" style={WINDOW_LABEL_STYLE}>all</span>
          </p>
          {/* ── studio#122: what these runs PRODUCED, counted over ALL of them,
              never the MAX_ROWS window — 665a9aeb (the run that read as the most
              productive in the project and delivered nothing) is not in the
              visible six, and a census that could not see it would be exactly
              the lie this slice exists to remove. Pure DTO: zero requests. ── */}
          {myRuns.length > 0 && (
            <p data-testid="dashboard-delivery-summary" style={CSS.deliverySummary}>
              {deliverySummary(myRuns.map(({ view }) => view))}
            </p>
          )}
          {myRuns.length === 0 ? (
            <p style={CSS.empty}>No runs yet — Build starts one.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {myRuns.slice(0, MAX_ROWS).map(({ view, signal }) => {
                const { session } = view;
                const style = STATUS_STYLE[session.status];
                return (
                  <a
                    key={session.id}
                    {...link(modePath(projectId, runModeOf(session.id), session.id))}
                    data-testid="dashboard-run"
                    data-run-id={session.id}
                    data-status={session.status}
                    style={CSS.row}
                  >
                    <span
                      aria-hidden
                      style={{
                        width: '6px', height: '6px', borderRadius: 'var(--radius-full)', flexShrink: 0,
                        // SignalKind is a subset of Attention, so the board's dot map reads directly.
                        background: signal !== null ? ATTENTION_DOT[signal.kind] : 'var(--ink-dim)',
                      }}
                    />
                    <span style={CSS.rowText}>{session.problem}</span>
                    {/* studio#122: what the run produced, beside what it is
                        doing — DTO-derived, so the row costs no request. */}
                    <DeliveryChip view={view} />
                    <span style={{ flexShrink: 0, color: style?.color ?? 'var(--ink-dim)' }}>
                      {style?.label ?? session.status}
                    </span>
                  </a>
                );
              })}
              {myRuns.length > MAX_ROWS && (
                <p style={CSS.overflow}>{myRuns.length - MAX_ROWS} more</p>
              )}
            </div>
          )}
        </section>

        {/* ── Tile 2: documents, from the one listDocs the Document mode makes ── */}
        <section data-testid="dashboard-docs" data-count={Math.min(docs.length, MAX_ROWS)} style={CSS.tile}>
          {/* EC34 (slice W): head + data-count name the RENDERED rows; the cap
              declares itself in the same breath ("N of M", plus "more" below). */}
          <p style={CSS.tileHead}>
            Documents ({docs.length > MAX_ROWS ? `${MAX_ROWS} of ${docs.length}` : docs.length})
          </p>
          {docs.length === 0 ? (
            <p style={CSS.empty}>No documents yet — Document drafts one.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {docs.slice(0, MAX_ROWS).map((d) => (
                <a
                  key={d.name}
                  {...link(modePath(projectId, d.kind === 'demo' ? 'video' : 'document', d.name))}
                  data-testid="dashboard-doc"
                  data-doc-id={d.name}
                  style={CSS.row}
                >
                  <span aria-hidden style={{ flexShrink: 0, color: 'var(--ink-dim)' }}>
                    {d.kind === 'demo' ? '▶' : '▤'}
                  </span>
                  <span style={CSS.rowText}>{d.name}</span>
                  <span style={{ flexShrink: 0, color: 'var(--ink-dim)' }}>v{d.head}</span>
                </a>
              ))}
              {docs.length > MAX_ROWS && (
                <p style={CSS.overflow}>{docs.length - MAX_ROWS} more</p>
              )}
            </div>
          )}
        </section>

        {/* ── Tile 3: the gate inbox — the SAME answerable chip as the board (§4.1) ── */}
        <section data-testid="dashboard-gates" data-count={Math.min(waiting.length, MAX_ROWS)} style={CSS.tile}>
          <p style={CSS.tileHead}>
            Gate inbox ({waiting.length > MAX_ROWS ? `${MAX_ROWS} of ${waiting.length}` : waiting.length})
          </p>
          {waiting.length === 0 ? (
            <p style={CSS.empty}>Nothing is waiting on you.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {inboxRows.map(({ view }) => {
                const id = view.session.id;
                const gate = gates[id];
                const selected = cursor.selectedKey === id;
                return (
                  <div
                    key={id}
                    data-testid="dashboard-gate"
                    data-run-id={id}
                    // Slice H (§2.2, EC22): the cursor is real focus — the row
                    // takes programmatic focus and the 2px `--accent` ring.
                    tabIndex={-1}
                    data-kbd-item={id}
                    {...(selected ? { 'data-kbd-selected': 'true' } : {})}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0,
                      outline: selected ? '2px solid var(--accent)' : 'none',
                      outlineOffset: '2px',
                    }}
                  >
                    {cursor.noteFor === id ? (
                      // §2.3: the open reject note replaces the chip row.
                      <GateRejectNote runId={id} onClose={cursor.closeNote} />
                    ) : (
                      <>
                        {/* Slice L (§9.2): checkbox / ↗ marker, once ≥1 selected. */}
                        <BatchSelectBox runId={id} gate={gate} />
                        <span
                          title={gate?.prompt}
                          style={{
                            flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap', fontSize: 'var(--text-xs)',
                            fontFamily: 'var(--font-mono)', color: 'var(--ink-body)',
                          }}
                        >
                          {gate?.prompt ?? view.session.problem}
                        </span>
                        <GateChip runId={id} projectId={projectId} gate={gate} navigate={navigate} />
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* ── Tile 4: 7-day activity sparkline (§2.3's SVG approach, own component) ── */}
        <section data-testid="dashboard-activity" data-total={sparkTotal} style={CSS.tile}>
          <p style={CSS.tileHead}>Activity (7d)</p>
          {sparkTotal === 0 ? (
            <p style={CSS.empty}>No runs in the last 7 days.</p>
          ) : (
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: '12px' }}>
              <RunSparkline counts={sparkCounts} width={168} height={40} color="var(--accent)" testId="activity-sparkline" />
              <span style={{ fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', color: 'var(--ink-muted)' }}>
                {sparkTotal} {sparkTotal === 1 ? 'run' : 'runs'} this week
              </span>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
