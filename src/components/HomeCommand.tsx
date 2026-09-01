import { useMemo, useState } from 'react';
import type { GovernanceClaim, RepoEntry, SessionView } from '../api/types.js';
import type { Diagnostics } from '../api/diagnostics.js';
import type { WikiRuleEvidenceRow } from '../api/wiki.js';
import type { SteeringRule } from '../api/steering.js';
import { recentActivity } from '../board/homeActivity.js';
import { oldestNeedAt, type NeedRow } from '../board/needsYou.js';
import { workingCount } from '../board/metrics.js';
import { governedRuns, ruleUsage } from '../board/steeringUsage.js';
import {
  attachSeries,
  deltaWord,
  healthColor,
  healthOf,
  statusCounts,
  windowBuckets,
  windowDelta,
} from '../board/windowStats.js';
import type { Navigate } from '../hooks/useRoute.js';
import { runTimelinePath } from '../hooks/useRoute.js';
import { useRunEventStore } from '../store/events.js';
import { useRuntimeStore } from '../store/runtime.js';
import { DashboardGrid, StatTile } from './dashboardKit.js';
import { TONE_COLOR, TONE_GLYPH } from './narrator.js';
import { NewProjectModal } from './NewProjectModal.js';
import { ago } from './ProjectCard.js';
import { humanTitle } from './runIdentity.js';

/**
 * The home command center's panels (DES-HOME-COMMAND-CENTER §4–§5), beside the
 * needs-you queue:
 *
 *  - {@link HomeVerbs} — the creation verbs + the board-level Ask invite (Q3).
 *  - {@link HomeKpiBand} — ≤6 portfolio tiles (Q2), dashboardKit verbatim,
 *    honest deltas ("—" over unproven prior windows), thresholds only where
 *    they mean something, every tile a door.
 *  - {@link EssenceStrip} — one number + one door per section (Q3); an entry
 *    whose wire is absent is OMITTED, never a fabricated zero.
 *  - {@link RecentActivity} — the pulse: the last ≤8 narrated lines across all
 *    observed runs, newest first, each a door to its run (§5).
 */

// ── The creation verbs + Ask ──────────────────────────────────────────────────

const VERB_CSS: React.CSSProperties = {
  background: 'transparent', color: 'var(--ink-muted)',
  border: '1px solid var(--surface-raised)', borderRadius: 'var(--radius-md)',
  padding: '6px 12px', fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semi)',
  cursor: 'pointer', whiteSpace: 'nowrap', textDecoration: 'none', font: 'inherit',
};

export function HomeVerbs({ navigate, onOpenAsk, prominent = false }: {
  navigate: Navigate;
  onOpenAsk: () => void;
  /** Fresh-install welcome: the verbs are the page (§6). */
  prominent?: boolean;
}): React.ReactElement {
  const [showCreate, setShowCreate] = useState(false);
  const verb = (label: string, path: string, testId: string): React.ReactElement => (
    <a
      key={testId}
      href={path}
      data-testid={testId}
      onClick={(e) => { e.preventDefault(); navigate(path); }}
      style={{ ...VERB_CSS, ...(prominent ? { padding: '10px 16px', fontSize: 'var(--text-sm)' } : {}) }}
    >
      {label}
    </a>
  );
  return (
    <div
      data-testid="home-verbs"
      style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}
    >
      {verb('Do Work', '/runs/new', 'home-verb-work')}
      <button
        type="button"
        data-testid="home-verb-project"
        onClick={() => setShowCreate(true)}
        style={{ ...VERB_CSS, ...(prominent ? { padding: '10px 16px', fontSize: 'var(--text-sm)' } : {}) }}
      >
        New project
      </button>
      {verb('New chat', '/chat/new', 'home-verb-chat')}
      {verb('Register repo', '/repos/new', 'home-verb-repo')}
      {verb('Run recon', '/testing/campaigns', 'home-verb-recon')}
      {/* The board-level Ask invite — the SAME dock the rail button opens
          (onOpenAsk is App's setAskOpen), never a second dock or rail fork. */}
      <button
        type="button"
        data-testid="home-ask"
        onClick={onOpenAsk}
        style={{
          ...VERB_CSS,
          color: 'var(--accent)', borderColor: 'var(--accent-subtle)',
          ...(prominent ? { padding: '10px 16px', fontSize: 'var(--text-sm)' } : {}),
        }}
        title="Ask across your runs, repos and stores — agents with estate access answer (Ctrl/⌘+Shift+A)"
      >
        Ask about your work…
      </button>
      {showCreate && <NewProjectModal navigate={navigate} onClose={() => setShowCreate(false)} />}
    </div>
  );
}

// ── The portfolio KPI band ────────────────────────────────────────────────────

/** The homepage's fixed recency window — the sections' "last 30" idiom. */
const HOME_RANGE = '30d' as const;
/** Days of attach-clock history the runs tile's sparkline buckets. */
const SPARK_DAYS = 14;

export function HomeKpiBand({ runs, attachedAt, needRows, claims, navigate, now }: {
  runs: SessionView[];
  attachedAt: Record<string, number>;
  /** THE queue fold's rows — the tile counts exactly what the queue lists. */
  needRows: NeedRow[];
  /** `GET /governance/claims`, or null when the daemon does not serve it. */
  claims: GovernanceClaim[] | null;
  navigate: Navigate;
  now?: number;
}): React.ReactElement {
  const at = now ?? Date.now();
  const live = useMemo(() => runs.filter((v) => v.session.archived_at == null), [runs]);
  const buckets = useMemo(() => windowBuckets(live, HOME_RANGE), [live]);
  const runsDelta = windowDelta(buckets, (rs) => rs.length);
  const failedDelta = windowDelta(buckets, (rs) => statusCounts(rs).failed);
  const counts = statusCounts(buckets.current);
  const activeNow = workingCount(runs);
  const spark = attachSeries(buckets.current.map((v) => v.session.id), attachedAt, SPARK_DAYS, at);
  const health = healthOf(counts.done, counts.terminal);
  const successWord = counts.terminal === 0 ? '—' : `${Math.round((counts.done / counts.terminal) * 100)}%`;
  const governed = claims !== null ? governedRuns(claims, runs) : null;
  const oldest = oldestNeedAt(needRows);

  const door = (path: string): { href: string; onOpen: () => void } => ({
    href: path,
    onOpen: () => navigate(path),
  });

  return (
    // DashboardGrid (kit) rather than the flex KpiBand: six tiles in a narrow
    // column wrap 2–3 per row instead of squeezing into one unreadable line.
    <DashboardGrid testId="home-kpis" min={170}>
      <StatTile
        testId="home-kpi-active"
        label="Active now"
        value={activeNow}
        context="right now"
        title="Runs moving under their own power — open the Work list"
        {...door('/work?filter=active')}
      />
      <StatTile
        testId="home-kpi-runs"
        label="Runs"
        value={buckets.current.length}
        delta={runsDelta}
        context={deltaWord(HOME_RANGE, runsDelta)}
        spark={spark}
        title="Runs in the window — open the Work list"
        {...door('/work')}
      />
      <StatTile
        testId="home-kpi-needs"
        label="Needs you"
        value={needRows.length}
        valueColor={needRows.length > 0 ? 'var(--status-gate)' : undefined}
        context={oldest !== null ? `oldest waiting ${ago(oldest, at)}` : 'nothing waiting'}
        title="Everything waiting on you — the queue on this page"
        href="#needs-you"
        onOpen={() => {
          document.querySelector('[data-testid="needs-you-queue"]')?.scrollIntoView({ block: 'start' });
        }}
      />
      <StatTile
        testId="home-kpi-failed"
        label="Failed"
        value={counts.failed}
        delta={failedDelta}
        deltaSense="bad-up"
        valueColor={counts.failed > 0 ? 'var(--status-fail)' : undefined}
        context={deltaWord(HOME_RANGE, failedDelta)}
        title="Failed runs in the window — open the Failed filter"
        {...door('/work?filter=failed')}
      />
      <StatTile
        testId="home-kpi-success"
        label="Success rate"
        value={successWord}
        valueColor={healthColor(health)}
        context={counts.terminal === 0 ? 'no finished runs in the window' : `${counts.done} of ${counts.terminal} finished runs passed`}
        title="Done over terminal in the window — open the Completed filter"
        {...door('/work?filter=completed')}
      />
      <StatTile
        testId="home-kpi-governed"
        label="Governed"
        value={governed !== null && governed.pct !== null ? `${governed.pct}%` : '—'}
        context={
          governed === null
            ? 'claims not served by this daemon'
            : governed.total === 0
              ? 'no runs on this daemon yet'
              : `${governed.governed} of ${governed.total} runs saw ≥1 gate evaluation`
        }
        title="Share of live runs with at least one recorded gate evaluation — open Steering"
        {...door('/steering')}
      />
    </DashboardGrid>
  );
}

// ── The section essence strip ─────────────────────────────────────────────────

export interface EssenceEntry {
  id: string;
  label: string;
  /** The one number (or short phrase, e.g. "crew 0.7.7 · up 3h"). */
  value: string;
  path: string;
  title: string;
}

/** Human uptime word: 2h, 3d — coarse on purpose. */
function upWord(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return `${Math.max(1, Math.floor(ms / 60_000))}m`;
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/**
 * The strip's entries — one per section whose wire ANSWERED (§5): an absent
 * wire is an omitted entry, never a fabricated 0. Pure; unit-tested.
 */
export function essenceEntries(inputs: {
  projects: number;
  docs: number;
  /** Live chat sessions, or null when `GET /chats` did not answer. */
  chats: number | null;
  repos: readonly RepoEntry[];
  campaigns: number | null;
  rules: SteeringRule[] | null;
  perRule: WikiRuleEvidenceRow[] | null;
  diag: Diagnostics | null;
  now: number;
}): EssenceEntry[] {
  const out: EssenceEntry[] = [
    { id: 'projects', label: 'Projects', value: String(inputs.projects), path: '/projects', title: 'The project register' },
    { id: 'docs', label: 'Docs', value: String(inputs.docs), path: '/make', title: 'Documents across your interactive projects' },
  ];
  if (inputs.chats !== null) {
    out.push({ id: 'chats', label: 'Chats', value: String(inputs.chats), path: '/chats', title: 'Live chat sessions (warm seats)' });
  }
  out.push({ id: 'repos', label: 'Repos', value: String(inputs.repos.length), path: '/repos', title: 'Registered repositories' });
  if (inputs.campaigns !== null) {
    out.push({ id: 'campaigns', label: 'Campaigns', value: String(inputs.campaigns), path: '/testing/campaigns', title: 'Test campaigns' });
  }
  if (inputs.rules !== null) {
    const unused = inputs.perRule !== null ? ruleUsage(inputs.rules, inputs.perRule).unusedIds.length : null;
    out.push({
      id: 'steering',
      label: 'Steering',
      value: `${inputs.rules.filter((r) => r.retired !== true).length} rules${unused !== null ? ` · ${unused} unused` : ''}`,
      path: '/steering',
      title: 'Active steering rules (unused = zero enforcement evidence)',
    });
  }
  if (inputs.diag !== null) {
    out.push({
      id: 'daemon',
      label: 'Daemon',
      value: `crew ${inputs.diag.components.crew} · up ${upWord(inputs.diag.daemon.uptimeMs)}`,
      path: '/system',
      title: 'The crew daemon serving this studio',
    });
  }
  return out;
}

export function EssenceStrip({ entries, navigate }: {
  entries: EssenceEntry[];
  navigate: Navigate;
}): React.ReactElement {
  return (
    <div
      data-testid="home-essence"
      style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}
    >
      {entries.map((e) => (
        <a
          key={e.id}
          href={e.path}
          data-testid="essence-entry"
          data-section={e.id}
          data-value={e.value}
          title={e.title}
          onClick={(ev) => { ev.preventDefault(); navigate(e.path); }}
          style={{
            display: 'inline-flex', alignItems: 'baseline', gap: '5px', textDecoration: 'none',
            fontSize: 'var(--text-2xs)', fontFamily: 'var(--font-mono)', color: 'var(--ink-muted)',
            border: '1px solid var(--surface-raised)', borderRadius: 'var(--radius-full)',
            padding: '3px 10px', whiteSpace: 'nowrap',
          }}
        >
          <span style={{ color: 'var(--ink-dim)' }}>{e.label}</span>
          <span style={{ color: 'var(--ink-high)', fontVariantNumeric: 'tabular-nums' }}>{e.value}</span>
        </a>
      ))}
    </div>
  );
}

// ── The recent-activity pulse ─────────────────────────────────────────────────

export function RecentActivity({ runs, navigate, now }: {
  runs: SessionView[];
  navigate: Navigate;
  now?: number;
}): React.ReactElement | null {
  const byRun = useRunEventStore((s) => s.byRun);
  const logs = useRuntimeStore((s) => s.logs);
  const at = now ?? Date.now();
  const rows = useMemo(
    () =>
      recentActivity(runs, byRun, (id) => {
        const log = logs[id];
        return log !== undefined && log.length > 0 ? log[log.length - 1]?.ts : undefined;
      }),
    [runs, byRun, logs],
  );
  // Nothing observed yet: the pulse is ABSENT, never an empty frame.
  if (rows.length === 0) return null;
  return (
    <section data-testid="home-activity" data-count={rows.length} style={{ minWidth: 0 }}>
      <p
        style={{
          margin: '0 0 4px', fontSize: 'var(--text-2xs)', fontWeight: 'var(--weight-bold)',
          letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-dim)',
        }}
      >
        Recent activity
      </p>
      {rows.map((r) => (
        <a
          key={r.runId}
          href={runTimelinePath(r.runId)}
          data-testid="activity-line"
          data-run-id={r.runId}
          title={`${humanTitle(r.problem)} — ${r.line.text}`}
          onClick={(e) => { e.preventDefault(); navigate(runTimelinePath(r.runId)); }}
          style={{
            display: 'flex', alignItems: 'baseline', gap: '6px', minWidth: 0,
            textDecoration: 'none', padding: '2px 0',
            fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)',
          }}
        >
          <span aria-hidden style={{ color: TONE_COLOR[r.line.tone], flexShrink: 0 }}>
            {TONE_GLYPH[r.line.tone]}
          </span>
          <span
            style={{
              color: TONE_COLOR[r.line.tone], overflow: 'hidden', textOverflow: 'ellipsis',
              whiteSpace: 'nowrap', minWidth: 0,
            }}
          >
            {r.line.text}
          </span>
          <span
            style={{
              color: 'var(--ink-dim)', overflow: 'hidden', textOverflow: 'ellipsis',
              whiteSpace: 'nowrap', flexShrink: 1, minWidth: '40px',
            }}
          >
            · {humanTitle(r.problem, 40)}
          </span>
          <span style={{ color: 'var(--ink-dim)', flexShrink: 0, fontSize: 'var(--text-2xs)' }}>
            {ago(r.at, at)}
          </span>
        </a>
      ))}
    </section>
  );
}
