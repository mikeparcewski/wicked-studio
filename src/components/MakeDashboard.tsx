import { useCallback, useMemo, useRef, useState } from 'react';
import type { SessionView } from '../api/types.js';
import { UNFILED_MOUNT, type DocSummary } from '../api/interactive.js';
import { useDismissable } from '../hooks/useDismissable.js';
import { versionPath, type Mode } from '../hooks/useRoute.js';
import { useDocsCache } from '../store/docsCache.js';
import { useMembershipStore } from '../store/membership.js';
import { useProjectsStore } from '../store/projects.js';
import { isChatRun } from './ChatsPage.js';
import { MetricTile } from './MetricTile.js';
import { humanTitle } from './runIdentity.js';
import { RunOutcomeBar } from './RunOutcomeBar.js';
import { phaseWord, RUN_DOT } from './RunsSection.js';
import { TokenBurnSparkline } from './TokenBurnSparkline.js';

/**
 * The Make dashboard — `/make` (DES-FEEDBACK-003 §4.2, slice O): the combined
 * list + reporting over MADE THINGS — build runs and their deliverables,
 * documents, demos. Make = the verbatim complement of ChatsPage's filter
 * (§3.3/§4.2: every run under exactly one path).
 *
 * Reporting discipline (EC19/EC28): the tile band sits ABOVE the list, every
 * tile answers its §4.2.1 named question via `data-question`, SVG-first, no
 * chart library, tokens only.
 *
 * Data discipline: ZERO requests on mount. Runs ride the app's one `GET /runs`
 * (the `runs` prop); attach clocks and project names read the membership
 * mirror; spend reads the runtime store's observed `cliUsage` frames; doc
 * lists read the session docsCache — the honest corpus (§4.2.2), which the
 * EC24-grammar label says out loud. The one fan-out (`[load docs for all
 * projects]`) is an explicit gesture: P known-shape GETs, progress named,
 * cached for the session — a button the operator presses, never a mount cost.
 */

interface Props {
  runs: SessionView[];
  navigate: (path: string) => void;
  /** Where a run row lands — the caller's routing (flat `/runs/:id` here). */
  runPath: (id: string) => string;
}

const RUN_TERMINAL = new Set(['completed', 'cancelled', 'failed']);

/** Active before terminal, incoming order preserved (the RunsSection contract). */
function orderRuns(runs: SessionView[]): SessionView[] {
  const active = runs.filter((v) => !RUN_TERMINAL.has(v.session.status));
  const terminal = runs.filter((v) => RUN_TERMINAL.has(v.session.status));
  return [...active, ...terminal];
}

// ── The Made (7d) tile (§4.2.1 row 1) ─────────────────────────────────────────

const DAYS = 7;
const DAY_MS = 24 * 3_600_000;
const W = 168;
const H = 26;
const COL_GAP = 3;

type MadeKind = 'builds' | 'docs' | 'demos';
/** Kind → its fill. Kinds, not statuses — the accent family + one status
 *  token keep the three producible things tellable apart (C2: tokens only). */
const KIND_FILL: ReadonlyArray<{ key: MadeKind; fill: string }> = [
  { key: 'builds', fill: 'var(--status-run)' },
  { key: 'docs', fill: 'var(--accent)' },
  { key: 'demos', fill: 'var(--accent-dim)' },
];

function MadeTile({ builds, docs, attachedAt, now }: {
  builds: SessionView[];
  docs: Array<{ doc: DocSummary }>;
  attachedAt: Record<string, number>;
  now?: number;
}): React.ReactElement {
  const at = now ?? Date.now();
  const { buckets, totals } = useMemo(() => {
    const start = at - DAYS * DAY_MS;
    const days = Array.from({ length: DAYS }, () => ({ builds: 0, docs: 0, demos: 0 }));
    const sums = { builds: 0, docs: 0, demos: 0 };
    const place = (clock: number | undefined, kind: MadeKind): void => {
      if (clock === undefined || Number.isNaN(clock) || clock < start || clock > at) return;
      const ix = Math.min(DAYS - 1, Math.floor((clock - start) / DAY_MS));
      const day = days[ix];
      if (day !== undefined) day[kind] += 1;
      sums[kind] += 1;
    };
    for (const v of builds) {
      if (v.session.archived_at != null) continue;
      place(attachedAt[v.session.id], 'builds');
    }
    // Doc/demo versions counted from LOADED manifests only (§4.2.1) — each doc
    // at its newest update; the corpus label below owns the honesty.
    for (const { doc } of docs) {
      place(doc.updated_at === null ? undefined : Date.parse(doc.updated_at), doc.kind === 'demo' ? 'demos' : 'docs');
    }
    return { buckets: days, totals: sums };
  }, [builds, docs, attachedAt, at]);

  const total = totals.builds + totals.docs + totals.demos;
  const colMax = buckets.reduce((m, d) => Math.max(m, d.builds + d.docs + d.demos), 0);
  const colW = (W - COL_GAP * (DAYS - 1)) / DAYS;
  const value = total === 0
    ? 'nothing made in 7d'
    : [
        totals.builds > 0 ? `${totals.builds} builds` : null,
        totals.docs > 0 ? `${totals.docs} docs` : null,
        totals.demos > 0 ? `${totals.demos} demos` : null,
      ].filter((s) => s !== null).join(' · ');

  return (
    <MetricTile
      testId="made-tile"
      question="What is the shop producing, and of what kind?"
      title="Made (7d) · docs from loaded projects"
      value={value}
      data={{ 'data-total': total }}
    >
      {total === 0 ? (
        <p style={{ margin: 0, fontSize: 'var(--text-2xs)', color: 'var(--ink-dim)', fontFamily: 'var(--font-mono)' }}>
          Nothing made in the last 7 days.
        </p>
      ) : (
        <svg
          width="100%"
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`made over the last 7 days: ${value}`}
          style={{ display: 'block' }}
        >
          {buckets.map((d, i) => {
            let y = H;
            return KIND_FILL.map(({ key, fill }) => {
              if (d[key] === 0) return null;
              const h = Math.max(2, (d[key] / colMax) * H);
              y -= h;
              return <rect key={`${i}-${key}`} x={i * (colW + COL_GAP)} y={y} width={colW} height={h} fill={fill} />;
            });
          })}
        </svg>
      )}
    </MetricTile>
  );
}

// ── The dashboard ─────────────────────────────────────────────────────────────

export function MakeDashboard({ runs, navigate, runPath }: Props): React.ReactElement {
  const projects = useProjectsStore((s) => s.projects);
  const projectNameByRun = useMembershipStore((s) => s.projectNameByRun);
  const attachedAt = useMembershipStore((s) => s.attachedAtByRun);
  const byProject = useDocsCache((s) => s.byProject);
  const fanoutDone = useDocsCache((s) => s.fanoutDone);
  const fanoutProgress = useDocsCache((s) => s.fanoutProgress);
  const [whyOpen, setWhyOpen] = useState(false);
  // The overlay contract (usability review #10): the [why?] popover is a
  // transient surface — Escape closes it and refocuses its trigger.
  const whyRef = useRef<HTMLDivElement>(null);
  const whyTriggerRef = useRef<HTMLButtonElement>(null);
  const closeWhy = useCallback(() => setWhyOpen(false), []);
  useDismissable(whyOpen, closeWhy, whyRef, whyTriggerRef);

  // The spine (§4.2.2): non-chat runs — complete, all projects, active first.
  const made = useMemo(
    () => orderRuns(runs.filter((v) => !isChatRun(v) && v.session.archived_at == null)),
    [runs],
  );

  const projectNameById = useMemo(
    () => Object.fromEntries(projects.map((p) => [p.id, p.name])),
    [projects],
  );
  // The known corpus: doc rows off the session cache, newest first.
  const docRows = useMemo(
    () => Object.entries(byProject)
      // Slice U (§6.2): the default bucket never rides the board's store mirror
      // (F5), so its docs label "Unfiled" — the run rows' exact grammar above.
      .flatMap(([pid, docs]) => docs.map((doc) => ({
        doc, projectId: pid,
        projectName: projectNameById[pid] ?? (pid === UNFILED_MOUNT ? 'Unfiled' : pid),
      })))
      .sort((a, b) => (b.doc.updated_at ?? '').localeCompare(a.doc.updated_at ?? '')),
    [byProject, projectNameById],
  );

  const link = (path: string): { href: string; onClick: (e: React.MouseEvent) => void } => ({
    href: path,
    onClick: (e) => { e.preventDefault(); navigate(path); },
  });

  // The explicit fan-out (§4.2.2): every real project, one known-shape GET each.
  const fanout = (): void => {
    void useDocsCache.getState().loadAll(projects.filter((p) => p.id !== 'default').map((p) => p.id));
  };

  return (
    <div className="flex flex-col" style={{ color: 'var(--ink-high)' }}>
      <div className="px-8 pt-8 pb-4 flex items-baseline justify-between gap-4">
        <h1 className="text-2xl font-semibold font-mono">Make</h1>
        <p style={{ margin: 0, fontSize: 'var(--text-2xs)', color: 'var(--ink-dim)', fontFamily: 'var(--font-sans)' }}>
          build runs · documents · demos
        </p>
      </div>

      {/* ── The reporting band (§4.2.1) — tiles ABOVE the list (EC28) ────────── */}
      <div
        data-testid="make-dashboard-tiles"
        className="mx-8 mb-6 flex items-stretch"
        style={{ height: '64px', flexShrink: 0, background: 'var(--surface-rail)', borderRadius: 'var(--radius-md)', padding: '0 var(--space-3)' }}
      >
        <MadeTile builds={made} docs={docRows} attachedAt={attachedAt} />
        <RunOutcomeBar
          runs={made}
          attachedAt={attachedAt}
          question="Are makes landing or failing?"
          title="Outcome split (24h)"
        />
        <TokenBurnSparkline
          question="What is making costing?"
          title="Spend (observed)"
        />
      </div>

      {/* ── The corpus label (EC24 grammar, §4.2.2) heads the list ───────────── */}
      <div ref={whyRef} className="relative px-8 pb-2 flex items-center gap-3 flex-wrap">
        <p
          data-testid="make-corpus-label"
          style={{ margin: 0, fontSize: 'var(--text-2xs)', color: 'var(--ink-dim)', fontFamily: 'var(--font-mono)' }}
        >
          Listing: build runs (all projects) · documents (projects opened this session)
          {' — '}
          <button
            ref={whyTriggerRef}
            type="button"
            data-testid="make-corpus-why"
            aria-expanded={whyOpen}
            onClick={() => setWhyOpen((v) => !v)}
            style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit', color: 'var(--ink-muted)' }}
          >
            [why?]
          </button>
        </p>
        {whyOpen && (
          <p
            data-testid="make-corpus-why-popover"
            className="absolute left-8 top-6 z-20 max-w-md"
            style={{
              margin: 0, padding: 'var(--space-2) var(--space-3)',
              background: 'var(--surface-overlay)', border: '1px solid var(--surface-raised)',
              borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-overlay)',
              fontSize: 'var(--text-2xs)', color: 'var(--ink-body)', fontFamily: 'var(--font-sans)',
            }}
          >
            Documents load per project. Open a project — or use &lsquo;load docs for all
            projects&rsquo; — to list them here.
          </p>
        )}
        {fanoutProgress !== null ? (
          <p
            data-testid="make-fanout-progress"
            style={{ margin: 0, fontSize: 'var(--text-2xs)', color: 'var(--ink-dim)', fontFamily: 'var(--font-mono)' }}
          >
            loading docs… {fanoutProgress.done}/{fanoutProgress.total}
          </p>
        ) : fanoutDone ? (
          <p style={{ margin: 0, fontSize: 'var(--text-2xs)', color: 'var(--ink-dim)', fontFamily: 'var(--font-mono)' }}>
            docs loaded for all projects
          </p>
        ) : (
          <button
            type="button"
            data-testid="make-load-all-docs"
            onClick={fanout}
            className="rounded px-2 py-0.5 transition-opacity hover:opacity-80"
            style={{
              background: 'transparent', border: '1px solid var(--surface-raised)',
              fontSize: 'var(--text-2xs)', color: 'var(--ink-muted)', fontFamily: 'var(--font-mono)', cursor: 'pointer',
            }}
          >
            load docs for all projects
          </button>
        )}
      </div>

      {/* ── The list: run spine, then the known doc corpus (§4.2.2) ──────────── */}
      <div className="px-8 pb-8 flex flex-col gap-1" data-testid="make-list">
        {made.length === 0 && (
          <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--ink-dim)', fontFamily: 'var(--font-sans)', fontStyle: 'italic' }}>
            Nothing made yet — Make's ＋ forks Build / Document / Video.
          </p>
        )}
        {made.map((view) => (
          <a
            key={view.session.id}
            data-testid="make-run-row"
            data-run-id={view.session.id}
            data-status={view.session.status}
            {...link(runPath(view.session.id))}
            title={view.session.problem}
            className="flex items-center gap-2 min-w-0 px-3 py-1.5 rounded-md transition-colors hover:bg-surface-card"
            style={{ textDecoration: 'none' }}
          >
            <span
              aria-hidden
              className="w-2 h-2 rounded-full shrink-0"
              style={{ background: RUN_DOT[view.session.status] ?? 'var(--ink-dim)' }}
            />
            <span className="truncate" style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-body)', fontFamily: 'var(--font-sans)' }}>
              {/* The ONE human-title derivation (review #2) — the raw prompt
                  moves to this row's hover title. */}
              {humanTitle(view.session.problem)}
            </span>
            <span className="shrink-0" style={{ fontSize: 'var(--text-2xs)', color: 'var(--ink-muted)', fontFamily: 'var(--font-mono)' }}>
              {projectNameByRun[view.session.id] ?? 'Unfiled'}
            </span>
            <span className="ml-auto shrink-0" style={{ fontSize: 'var(--text-2xs)', color: 'var(--ink-dim)', fontFamily: 'var(--font-mono)' }}>
              {phaseWord(view)}
            </span>
          </a>
        ))}

        {docRows.length > 0 && (
          <p
            className="pt-3 pb-1"
            style={{
              margin: 0, fontSize: 'var(--text-2xs)', fontWeight: 'var(--weight-semi)', textTransform: 'uppercase',
              letterSpacing: '0.08em', color: 'var(--ink-dim)', fontFamily: 'var(--font-mono)',
            }}
          >
            documents · demos
          </p>
        )}
        {docRows.map(({ doc, projectId, projectName }) => {
          const mode: Mode = doc.kind === 'demo' ? 'video' : 'document';
          return (
            <a
              key={`${projectId}:${doc.name}`}
              data-testid="make-doc-row"
              data-doc-kind={doc.kind}
              {...link(versionPath(projectId, doc.name, null, mode))}
              title={`${doc.name} · ${projectName}`}
              className="flex items-center gap-2 min-w-0 px-3 py-1.5 rounded-md transition-colors hover:bg-surface-card"
              style={{ textDecoration: 'none' }}
            >
              <span aria-hidden className="shrink-0" style={{ fontSize: 'var(--text-2xs)', color: 'var(--ink-dim)' }}>
                {doc.kind === 'demo' ? '▶' : '▤'}
              </span>
              <span className="truncate" style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-body)', fontFamily: 'var(--font-sans)' }}>
                {doc.name}
              </span>
              <span className="shrink-0" style={{ fontSize: 'var(--text-2xs)', color: 'var(--ink-dim)', fontFamily: 'var(--font-mono)' }}>
                v{doc.head}
              </span>
              <span className="ml-auto shrink-0" style={{ fontSize: 'var(--text-2xs)', color: 'var(--ink-muted)', fontFamily: 'var(--font-mono)' }}>
                {projectName}
              </span>
            </a>
          );
        })}
      </div>
    </div>
  );
}
