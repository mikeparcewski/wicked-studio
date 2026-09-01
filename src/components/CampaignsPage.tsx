import { useEffect, useMemo, useState } from 'react';
import { campaignPath } from '../api/testing.js';
import type { CampaignSummary, CampaignCounts } from '../api/campaigns.js';
import type { SessionView } from '../api/types.js';
import {
  campaignActivitySeries, campaignCards, campaignCreatedDelta, campaignProgressWord,
  campaignRunIdSet, campaignTotals, matchesCampaignChip, passRateHealth, passRateWord,
  type CampaignCardModel, type CampaignChip,
} from '../board/campaignStats.js';
import { outcomeOf } from '../board/metrics.js';
import { healthColor, windowBuckets, windowDelta, deltaWord } from '../board/windowStats.js';
import { rangeWord, useTimeRange } from '../hooks/useTimeRange.js';
import { useCampaignsStore } from '../store/campaigns.js';
import {
  DashboardGrid, FilterStrip, KpiBand, KpiGroup, StatTile, type FilterChip,
} from './dashboardKit.js';
import { ago } from './ProjectCard.js';
import { AuthorPanel } from './SteeringAuthorPanel.js';
import { TestingLaunchPanel } from './TestingLaunchPanel.js';

/**
 * `/testing/campaigns` — THE Testing landing (the testing-UX wave), rebuilt as a COMMAND
 * SURFACE with the section-dashboard kit (`dashboardKit`, zero forks — the /projects //make
 * grammar): a KPI band under the three operator questions, the creation verbs in the header
 * (the retired Harness folded in: Run recon / New campaign / Add with chat — one panel open
 * at a time, the management-bar grammar), then a filterable grid of campaign cards, each the
 * scoreboard's stats condensed and a door to it.
 *
 * Every number derives from state the surface already holds — the store's ONE
 * `GET /campaigns` (server aggregates over the FULL filed set, §4.2) plus the app's live run
 * list — through the pure folds in `board/campaignStats.ts`. Campaign clocks are real, so the
 * campaigns tile's delta/spark are time-based (14d); run-derived tiles keep the positional
 * window idiom, honestly labeled ("last 30", never "30d"). The §1.5 probe keeps its three
 * honest states — probing / supported / unsupported, never a boolean — and the creation verbs
 * stay usable on an unsupported daemon (launching rides the shipping `POST /runs` wire; only
 * the LISTING needs the campaigns route).
 */

const S = {
  card:   'var(--surface-card)',
  border: 'var(--surface-raised)',
  ink:    'var(--ink-high)',
  muted:  'var(--ink-muted)',
  faint:  'var(--ink-dim)',
  accent: 'var(--accent)',
};

type PanelKind = 'recon' | 'campaign' | 'author' | null;

const CARD_STAT: React.CSSProperties = {
  fontSize: 'var(--text-2xs)', fontFamily: 'var(--font-mono)', color: 'var(--ink-muted)',
  whiteSpace: 'nowrap',
};

/** The scoreboard's segmented status bar, condensed onto the card — real counts, no series. */
function StatusBar({ counts, expected }: { counts: CampaignCounts; expected: number | null }): React.ReactElement | null {
  const seg = [
    { n: counts.landed, color: 'var(--status-done)' },
    { n: counts.failed, color: 'var(--status-fail)' },
    { n: counts.awaitingHuman, color: 'var(--status-gate)' },
    { n: counts.running, color: 'var(--status-run)' },
    { n: counts.cancelled + counts.other, color: 'var(--ink-dim)' },
  ];
  const total = Math.max(1, expected ?? counts.filed, seg.reduce((a, s) => a + s.n, 0));
  if (seg.every((s) => s.n === 0)) return null;
  return (
    <div
      data-testid="campaign-card-bar"
      aria-hidden
      style={{ display: 'flex', height: '5px', borderRadius: '3px', overflow: 'hidden', background: 'var(--surface-raised)' }}
    >
      {seg.filter((s) => s.n > 0).map((s, i) => (
        <div key={i} style={{ width: `${(s.n / total) * 100}%`, background: s.color }} />
      ))}
    </div>
  );
}

/** One campaign as a mini-scoreboard row — the card IS a door to its scoreboard. */
function CampaignCard({ m, navigate, now }: {
  m: CampaignCardModel;
  navigate: (path: string) => void;
  now: number;
}): React.ReactElement {
  const s = m.summary;
  const { counts } = s;
  const health = passRateHealth(counts.landed, counts.landed + counts.failed + counts.cancelled);
  // The gate jump: STRAIGHT to the waiting run's page, where the approval dock is pinned —
  // when the live list still holds one; otherwise the scoreboard names the waiting sibling.
  const firstWaiting = m.waiting[0]?.session.id ?? null;

  return (
    <div
      data-testid="campaign-card"
      data-campaign-id={s.campaign.id}
      data-gates={counts.awaitingHuman}
      data-runs={counts.filed}
      role="link"
      tabIndex={0}
      onClick={() => navigate(campaignPath(s.campaign.id))}
      onKeyDown={(e) => { if (e.key === 'Enter') navigate(campaignPath(s.campaign.id)); }}
      className="transition-colors hover:bg-surface-raised"
      style={{
        display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0,
        background: S.card, border: `1px solid ${S.border}`,
        borderRadius: 'var(--radius-lg)', padding: 'var(--space-4)', cursor: 'pointer',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
        <span style={{
          fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semi)', color: S.ink,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0,
        }}>
          {s.campaign.title ?? s.campaign.id}
        </span>
        {counts.awaitingHuman > 0 && (
          <button
            type="button"
            data-testid="campaign-needs-you"
            {...(firstWaiting !== null ? { 'data-run-id': firstWaiting } : {})}
            title={firstWaiting !== null
              ? 'A sibling run is waiting on you — jump to its approval dock'
              : 'A sibling run is waiting on you — open the scoreboard'}
            onClick={(e) => {
              e.stopPropagation();
              navigate(firstWaiting !== null ? `/runs/${encodeURIComponent(firstWaiting)}` : campaignPath(s.campaign.id));
            }}
            style={{
              marginLeft: 'auto', flexShrink: 0, cursor: 'pointer',
              background: 'var(--status-gate-dim)', border: '1px solid var(--status-gate-dim)',
              borderRadius: 'var(--radius-full)', padding: '2px 10px',
              fontSize: 'var(--text-2xs)', fontFamily: 'var(--font-mono)',
              fontWeight: 'var(--weight-bold)', color: 'var(--status-gate)',
            }}
          >
            needs you · {counts.awaitingHuman} →
          </button>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        {/* §3.3 denominator honesty — the scoreboard's exact two strings. */}
        <span style={{ ...CARD_STAT, color: S.ink }} data-testid="campaign-card-progress">
          {campaignProgressWord(s)}
        </span>
        {counts.landed + counts.failed + counts.cancelled > 0 && (
          <span
            style={{ ...CARD_STAT, color: healthColor(health) ?? CARD_STAT.color }}
            data-testid="campaign-card-split"
            data-health={health}
            title={`${counts.landed} landed, ${counts.failed} failed, ${counts.cancelled} cancelled of ${counts.filed} filed`}
          >
            ✓{counts.landed} · ✕{counts.failed}
          </span>
        )}
        {counts.running > 0 && (
          <span style={{ ...CARD_STAT, color: 'var(--status-run)' }}>{counts.running} running</span>
        )}
        <span style={{ ...CARD_STAT, marginLeft: 'auto' }} title="last activity (newest launch filed, or newest metadata write)">
          {ago(s.campaign.updated_at, now)} ago
        </span>
      </div>

      <StatusBar counts={counts} expected={s.campaign.expected} />

      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        <span style={CARD_STAT}>
          {counts.filed} run{counts.filed === 1 ? '' : 's'}
          {counts.archived > 0 && ` (${counts.archived} archived)`}
        </span>
        {s.projectIds.length > 0 && (
          <span style={CARD_STAT}>
            {s.projectIds.length === 1 ? '1 project' : `${s.projectIds.length} projects`}
          </span>
        )}
        {s.prs.length > 0 && (
          <span style={CARD_STAT}>
            {s.prs.length}{s.prsTruncated ? '+' : ''} PR{s.prs.length === 1 && !s.prsTruncated ? '' : 's'}
          </span>
        )}
      </div>
    </div>
  );
}

interface Props {
  /** The board's live run list — KPI windows and the gate jumps read it, zero extra fetches. */
  runs: SessionView[];
  navigate: (path: string) => void;
}

export function CampaignsPage({ runs, navigate }: Props): React.ReactElement {
  const support = useCampaignsStore((s) => s.support);
  const summaries = useCampaignsStore((s) => s.summaries);
  const refresh = useCampaignsStore((s) => s.refresh);

  const [panel, setPanel] = useState<PanelKind>(null);
  const openPanel = (p: Exclude<PanelKind, null>): void => setPanel((cur) => (cur === p ? null : p));

  const [query, setQuery] = useState('');
  const [chip, setChip] = useState<CampaignChip>('all');
  const { range, setRange } = useTimeRange('30d');

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const now = Date.now();

  // ── The window (Work page idiom, over the CAMPAIGN-member runs) ─────────────
  const runsById = useMemo(() => {
    const m = new Map<string, SessionView>();
    for (const v of runs) m.set(v.session.id, v);
    return m;
  }, [runs]);
  const memberIds = useMemo(() => campaignRunIdSet(summaries), [summaries]);
  const campaignRuns = useMemo(
    () => runs.filter((v) => v.session.archived_at == null && memberIds.has(v.session.id)),
    [runs, memberIds],
  );
  const buckets = useMemo(() => windowBuckets(campaignRuns, range), [campaignRuns, range]);
  const windowIds = useMemo(() => new Set(buckets.current.map((v) => v.session.id)), [buckets]);

  // ── KPI folds (pure, board/campaignStats) ───────────────────────────────────
  const totals = useMemo(() => campaignTotals(summaries), [summaries]);
  const createdDelta = useMemo(() => campaignCreatedDelta(summaries, 14, now), [summaries, now]);
  const activitySpark = useMemo(() => campaignActivitySeries(summaries, 14, now), [summaries, now]);
  const runsDelta = useMemo(() => windowDelta(buckets, (rs) => rs.length), [buckets]);
  const failedDelta = useMemo(
    () => windowDelta(buckets, (rs) => rs.filter((v) => outcomeOf(v.session.status) === 'fail').length),
    [buckets],
  );
  const firstWaiting = campaignRuns.find((v) => v.session.status === 'awaiting_human')?.session.id ?? null;
  const passHealth = passRateHealth(totals.landed, totals.terminal);

  // ── The card models (needs-you first) ───────────────────────────────────────
  const cards = useMemo(
    () => campaignCards(summaries, runsById, windowIds),
    [summaries, runsById, windowIds],
  );

  const chipCounts: Record<CampaignChip, number> = useMemo(() => ({
    all: cards.length,
    'needs-you': cards.filter((m) => matchesCampaignChip(m, 'needs-you')).length,
    running: cards.filter((m) => matchesCampaignChip(m, 'running')).length,
    failing: cards.filter((m) => matchesCampaignChip(m, 'failing')).length,
    quiet: cards.filter((m) => matchesCampaignChip(m, 'quiet')).length,
  }), [cards]);

  const q = query.trim().toLowerCase();
  const filtered = cards.filter((m) =>
    matchesCampaignChip(m, chip)
    && (q === ''
      || (m.summary.campaign.title ?? '').toLowerCase().includes(q)
      || m.summary.campaign.id.toLowerCase().includes(q)));
  // The recency window scopes the GRID to campaigns with a member run in it; older campaigns
  // stay one honest chip away ("+N older"), never silently gone — the FilterStrip idiom.
  const visible = range === 'all' ? filtered : filtered.filter((m) => m.inWindow);
  const hiddenByWindow = filtered.length - visible.length;

  const chips: FilterChip[] = [
    { id: 'all', label: 'All', count: chipCounts.all },
    { id: 'needs-you', label: 'Needs you', count: chipCounts['needs-you'] },
    { id: 'running', label: 'Running', count: chipCounts.running },
    { id: 'failing', label: 'Failing', count: chipCounts.failing },
    { id: 'quiet', label: 'Quiet', count: chipCounts.quiet },
  ];

  // ── The creation verbs + panels (the Harness, folded in) ────────────────────
  const header = (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        <p style={{ flex: 1, minWidth: 0, fontSize: '13px', color: S.muted, margin: 0 }}>
          Test campaigns over your codebases — recon proposes, you approve at the gate, sibling
          runs land the work.
        </p>
        <button
          type="button"
          data-testid="testing-recon-open"
          aria-expanded={panel === 'recon'}
          onClick={() => openPanel('recon')}
          style={{
            background: 'transparent', color: S.muted, border: `1px solid ${S.border}`,
            borderRadius: '7px', padding: '8px 14px', fontSize: '12px', fontWeight: 600,
            cursor: 'pointer', flexShrink: 0,
          }}
        >
          Run recon
        </button>
        <button
          type="button"
          data-testid="testing-author-open"
          aria-expanded={panel === 'author'}
          onClick={() => openPanel('author')}
          style={{
            background: 'transparent', color: S.muted, border: `1px solid ${S.border}`,
            borderRadius: '7px', padding: '8px 14px', fontSize: '12px', fontWeight: 600,
            cursor: 'pointer', flexShrink: 0,
          }}
        >
          Add with chat
        </button>
        <button
          type="button"
          data-testid="testing-campaign-open"
          aria-expanded={panel === 'campaign'}
          onClick={() => openPanel('campaign')}
          style={{
            background: S.accent, color: 'var(--accent-fg)', border: 'none', borderRadius: '7px',
            padding: '8px 14px', fontSize: '12px', fontWeight: 700, cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          New campaign
        </button>
      </div>

      {(panel === 'recon' || panel === 'campaign') && (
        <TestingLaunchPanel
          intent={panel}
          navigate={navigate}
          onClose={() => setPanel(null)}
          onLaunched={() => void refresh()}
        />
      )}
      {/* The steering AuthorPanel, REUSED VERBATIM with this surface's type: the authoring run
          drafts `testing` steering rules and stops at its propose gate — one component set. */}
      {panel === 'author' && <AuthorPanel type="testing" onClose={() => setPanel(null)} onAuthored={() => {}} />}
    </>
  );

  if (support === 'unknown') {
    return (
      <div data-testid="campaigns-probing" style={{ padding: '24px', color: 'var(--ink-muted)' }}>
        Checking this daemon for campaigns…
      </div>
    );
  }
  if (support === 'unsupported') {
    // The listing needs `GET /campaigns`; the creation verbs ride the shipping `POST /runs`
    // wire and stay usable — the folded-in Harness must not regress on an older daemon.
    return (
      <div data-testid="campaigns-page" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        {header}
        <div data-testid="campaigns-unsupported" style={{ color: 'var(--ink-muted)', maxWidth: '640px' }}>
          This daemon has no campaign surface — `GET /campaigns` is not served, which means the
          connected wicked-crew predates campaign grouping. Launches still work; upgrade the
          daemon to group a multi-run effort&rsquo;s sibling runs here.
        </div>
      </div>
    );
  }

  return (
    // FULL WIDTH — the landing flows with the viewport; no max-width constraint (lane B).
    <div data-testid="campaigns-page" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {header}

      {/* ── The KPI band — the command-center model: three questions, ≤6 tiles ── */}
      <KpiBand testId="campaigns-kpis">
        <KpiGroup label="Performance" grow={2}>
          <StatTile
            testId="stat-campaigns"
            label="Campaigns"
            value={totals.campaigns}
            delta={createdDelta}
            context={`${totals.activeNow} active now · created, 14d vs prior`}
            spark={activitySpark}
            title="Every campaign on this daemon — click to clear filters"
            onOpen={() => { setChip('all'); setQuery(''); }}
          />
          <StatTile
            testId="stat-campaign-runs"
            label="Campaign runs"
            value={buckets.current.length}
            delta={runsDelta}
            context={deltaWord(range, runsDelta)}
            title="Campaign-member runs in the window — open the Work list"
            href="/work"
            onOpen={() => navigate('/work')}
          />
        </KpiGroup>
        <KpiGroup label="Pipeline" grow={2}>
          <StatTile
            testId="stat-campaign-running"
            label="Running"
            value={totals.running}
            context="right now"
            title="Campaign runs moving under their own power — open the Work list"
            href="/work?filter=active"
            onOpen={() => navigate('/work?filter=active')}
          />
          <StatTile
            testId="stat-campaign-gates"
            label="Needs you"
            value={totals.awaitingHuman}
            valueColor={totals.awaitingHuman > 0 ? 'var(--status-gate)' : undefined}
            context={totals.awaitingHuman > 0 ? `${chipCounts['needs-you']} campaign${chipCounts['needs-you'] === 1 ? '' : 's'} waiting` : 'nothing waiting'}
            title={firstWaiting !== null
              ? 'A sibling run is waiting on you — jump to its approval dock'
              : 'Runs waiting on a human — filter the grid to them'}
            {...(firstWaiting !== null ? { href: `/runs/${encodeURIComponent(firstWaiting)}` } : {})}
            onOpen={() => {
              if (firstWaiting !== null) navigate(`/runs/${encodeURIComponent(firstWaiting)}`);
              else setChip('needs-you');
            }}
          />
        </KpiGroup>
        <KpiGroup label="Risk" grow={2}>
          <StatTile
            testId="stat-campaign-failed"
            label="Failed"
            value={failedDelta.current}
            valueColor={failedDelta.current > 0 ? 'var(--status-fail)' : undefined}
            delta={failedDelta}
            deltaSense="bad-up"
            context={deltaWord(range, failedDelta)}
            title="Failed campaign runs in the window — open them on the Work list"
            href="/work?filter=failed"
            onOpen={() => navigate('/work?filter=failed')}
          />
          <StatTile
            testId="stat-campaign-pass-rate"
            label="Pass rate"
            value={passRateWord(totals.landed, totals.terminal)}
            valueColor={healthColor(passHealth)}
            context={totals.terminal > 0 ? `${totals.landed} landed of ${totals.terminal} finished` : 'no finished runs yet'}
            title="Landed over finished, across every campaign — filter to the failing ones"
            onOpen={() => setChip('failing')}
          />
        </KpiGroup>
      </KpiBand>

      {/* ── Filters — first-class, never hidden ── */}
      <FilterStrip
        testId="campaigns-filter"
        query={query}
        onQuery={setQuery}
        placeholder="Search campaigns…"
        chips={chips}
        active={chip}
        onChip={(id) => setChip(id as CampaignChip)}
        range={range}
        onRange={setRange}
      >
        {hiddenByWindow > 0 && (
          <button
            type="button"
            data-testid="campaigns-show-older"
            onClick={() => setRange('all')}
            title={`${hiddenByWindow} campaign${hiddenByWindow === 1 ? '' : 's'} with no run in the ${rangeWord(range)} window`}
            style={{
              borderRadius: 'var(--radius-full)', padding: '3px 10px',
              fontSize: 'var(--text-2xs)', fontFamily: 'var(--font-mono)', cursor: 'pointer',
              border: '1px dashed var(--surface-raised)', background: 'transparent',
              color: 'var(--ink-dim)',
            }}
          >
            +{hiddenByWindow} older · show all
          </button>
        )}
      </FilterStrip>

      {summaries.length === 0 ? (
        // The honest empty state, with the way in: a campaign appears with its first run.
        <div data-testid="campaigns-empty" style={{
          textAlign: 'center', padding: '48px 24px',
          background: S.card, border: `1px solid ${S.border}`, borderRadius: '12px',
        }}>
          <p style={{ fontSize: '14px', color: S.muted, margin: 0, marginBottom: '4px' }}>
            No campaigns yet
          </p>
          <p style={{ fontSize: '12px', color: S.faint, margin: 0 }}>
            Campaigns appear when you launch a run with a campaign label — start one here.
          </p>
          <button
            type="button"
            data-testid="campaigns-empty-cta"
            onClick={() => setPanel('campaign')}
            style={{
              marginTop: '12px', padding: '6px 14px', borderRadius: 'var(--radius-md)',
              background: S.accent, color: 'var(--accent-fg)', fontSize: 'var(--text-sm)',
              fontWeight: 600, border: 'none', cursor: 'pointer',
            }}
          >
            New campaign
          </button>
        </div>
      ) : visible.length === 0 ? (
        <p data-testid="campaigns-empty-filter" style={{ fontSize: '13px', color: S.faint, margin: 0 }}>
          No campaigns match —{' '}
          <button
            type="button"
            onClick={() => { setChip('all'); setQuery(''); setRange('all'); }}
            style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', color: S.muted, textDecoration: 'underline', cursor: 'pointer' }}
          >
            clear filters
          </button>
        </p>
      ) : (
        <DashboardGrid testId="campaigns-grid" min={340}>
          {visible.map((m) => (
            <CampaignCard key={m.summary.campaign.id} m={m} navigate={navigate} now={now} />
          ))}
        </DashboardGrid>
      )}
    </div>
  );
}

export type { CampaignSummary };
