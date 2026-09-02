import { useEffect, useMemo, useState } from 'react';
import { campaignPath } from '../api/testing.js';
import type { SessionView } from '../api/types.js';
import {
  campaignCards, campaignTotals, deliveryRollupWord, matchesCampaignChip, memberRunIdSet,
  passRateHealth, passRateWord, progressWord,
  type CampaignCardModel, type CampaignChip,
} from '../board/campaignStats.js';
import { recentActivity } from '../board/homeActivity.js';
import { outcomeOf } from '../board/metrics.js';
import { healthColor, windowBuckets, windowDelta, deltaWord } from '../board/windowStats.js';
import { rangeWord, useTimeRange } from '../hooks/useTimeRange.js';
import { useCampaignsStore } from '../store/campaigns.js';
import { useRunEventStore } from '../store/events.js';
import { useRuntimeStore } from '../store/runtime.js';
import {
  DashboardGrid, FilterStrip, KpiBand, KpiGroup, StatTile, type FilterChip,
} from './dashboardKit.js';
import { TONE_COLOR, TONE_GLYPH, type NarrationLine } from './narrator.js';
import { runShortId } from './runIdentity.js';
import { AuthorPanel } from './SteeringAuthorPanel.js';
import { TestingLaunchPanel } from './TestingLaunchPanel.js';

/**
 * `/testing/campaigns` — THE Testing landing (the testing-UX wave), a COMMAND SURFACE with
 * the section-dashboard kit (`dashboardKit`, zero forks — the /projects //make grammar): a
 * KPI band under the three operator questions, the creation verbs in the header (Run recon /
 * New campaign / Add with chat — one panel open at a time), then a filterable grid where
 * engine campaigns AND ad-hoc label groups (wicked-studio#27, api-types 0.19.0) render as one
 * sorted set of cards — needs-you first, attention routing before navigation.
 *
 * Every number derives from state the surface already holds — the store's ONE
 * `GET /campaigns` (engine campaigns + `groups`) plus the app's live run list — through the
 * pure folds in `board/campaignStats.ts`. The engine campaign carries NO clocks, so no tile
 * fabricates a time series; run-derived tiles keep the positional window idiom, honestly
 * labeled ("last 30", never "30d"). The §1.5 probe keeps its three honest states — probing /
 * supported / unsupported, never a boolean — and the creation verbs stay usable on an
 * unsupported daemon.
 *
 * What each card adds for #27's remainder:
 *  - the DELIVERY ROLLUP ("n of N delivered") off the wire-carried per-member facts, with
 *    per-sibling PR links (every href `isPrUrl`-gated in the fold) and stranded siblings
 *    surfaced as needs-you;
 *  - a LIVE NARRATION line — the freshest member-run CoreEvent this client observed, spoken
 *    by `narrator.ts` via the home board's `recentActivity` fold (ONE template source, zero
 *    per-surface wording forks; absence stays absent).
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

/** Most per-sibling PR links a card renders inline; the rest fold into a "+n" word. */
const CARD_PR_CAP = 4;

/** The scoreboard's segmented status bar, condensed onto the card — real counts, no series. */
function StatusBar({ m }: { m: CampaignCardModel }): React.ReactElement | null {
  const rest = Math.max(0, m.total - m.landed - m.failed - m.awaitingHuman - m.running);
  const seg = [
    { n: m.landed, color: 'var(--status-done)' },
    { n: m.failed, color: 'var(--status-fail)' },
    { n: m.awaitingHuman, color: 'var(--status-gate)' },
    { n: m.running, color: 'var(--status-run)' },
    { n: rest, color: 'var(--ink-dim)' },
  ];
  const total = Math.max(1, m.total);
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

/**
 * The card's one-line live narration — the freshest member-run CoreEvent, spoken by the ONE
 * narrator template layer. `null` (absent, never a placeholder) when this client has observed
 * nothing for any member run.
 */
function CardNarration({ line, runId }: { line: NarrationLine; runId: string }): React.ReactElement {
  return (
    <div
      data-testid="campaign-card-narration"
      data-run-id={runId}
      data-tone={line.tone}
      style={{
        display: 'flex', alignItems: 'baseline', gap: '6px', minWidth: 0,
        fontSize: 'var(--text-2xs)', fontFamily: 'var(--font-mono)',
      }}
    >
      <span aria-hidden style={{ color: TONE_COLOR[line.tone], flexShrink: 0 }}>
        {TONE_GLYPH[line.tone]}
      </span>
      <span style={{
        color: TONE_COLOR[line.tone], overflow: 'hidden', textOverflow: 'ellipsis',
        whiteSpace: 'nowrap', minWidth: 0,
      }}>
        {line.text}
      </span>
      <span style={{ color: 'var(--ink-dim)', flexShrink: 0 }}>{runShortId(runId)}</span>
    </div>
  );
}

/** One campaign or ad-hoc group as a mini-scoreboard row. A campaign card IS a door to its
 *  scoreboard; a group has no detail route, so its member runs link out directly. */
function CampaignCard({ m, narration, navigate }: {
  m: CampaignCardModel;
  narration: { runId: string; line: NarrationLine } | null;
  navigate: (path: string) => void;
}): React.ReactElement {
  const health = passRateHealth(m.landed, m.landed + m.failed);
  // The gate jump: STRAIGHT to the waiting run's page, where the approval dock is pinned —
  // when the live list still holds one; otherwise the campaign's own surface.
  const firstWaiting = m.waiting[0]?.session.id ?? null;
  const rollupWord = deliveryRollupWord(m.rollup);
  const isCampaign = m.kind === 'campaign';
  const open = (): void => {
    if (isCampaign) navigate(campaignPath(m.id));
  };

  return (
    <div
      data-testid="campaign-card"
      data-kind={m.kind}
      data-campaign-id={m.id}
      data-gates={m.awaitingHuman}
      data-runs={m.total}
      {...(isCampaign ? { role: 'link', tabIndex: 0 } : {})}
      onClick={open}
      onKeyDown={(e) => { if (e.key === 'Enter') open(); }}
      className={isCampaign ? 'transition-colors hover:bg-surface-raised' : undefined}
      style={{
        display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0,
        background: S.card, border: `1px solid ${S.border}`,
        borderRadius: 'var(--radius-lg)', padding: 'var(--space-4)',
        cursor: isCampaign ? 'pointer' : 'default',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
        <span style={{
          fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semi)', color: S.ink,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0,
        }}>
          {m.title}
        </span>
        {!isCampaign && (
          <span style={{ ...CARD_STAT, color: S.faint, flexShrink: 0 }} title="An ad-hoc label group — runs launched under one groupLabel; no scheduler, no DAG.">
            group
          </span>
        )}
        {m.awaitingHuman > 0 && (
          <button
            type="button"
            data-testid="campaign-needs-you"
            {...(firstWaiting !== null ? { 'data-run-id': firstWaiting } : {})}
            title={firstWaiting !== null
              ? 'A sibling run is waiting on you — jump to its approval dock'
              : isCampaign
                ? 'A sibling run is waiting on you — open the scoreboard'
                : 'A sibling run is waiting on you'}
            onClick={(e) => {
              e.stopPropagation();
              if (firstWaiting !== null) navigate(`/runs/${encodeURIComponent(firstWaiting)}`);
              else if (isCampaign) navigate(campaignPath(m.id));
            }}
            style={{
              marginLeft: 'auto', flexShrink: 0, cursor: 'pointer',
              background: 'var(--status-gate-dim)', border: '1px solid var(--status-gate-dim)',
              borderRadius: 'var(--radius-full)', padding: '2px 10px',
              fontSize: 'var(--text-2xs)', fontFamily: 'var(--font-mono)',
              fontWeight: 'var(--weight-bold)', color: 'var(--status-gate)',
            }}
          >
            needs you · {m.awaitingHuman} →
          </button>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        {/* §3.3 denominator honesty — a campaign's DAG is declared; a group's grows ("so far"). */}
        <span style={{ ...CARD_STAT, color: S.ink }} data-testid="campaign-card-progress">
          {progressWord(m)}
        </span>
        {m.landed + m.failed > 0 && (
          <span
            style={{ ...CARD_STAT, color: healthColor(health) ?? CARD_STAT.color }}
            data-testid="campaign-card-split"
            data-health={health}
            title={`${m.landed} landed, ${m.failed} failed of ${m.total}`}
          >
            ✓{m.landed} · ✕{m.failed}
          </span>
        )}
        {m.running > 0 && (
          <span style={{ ...CARD_STAT, color: 'var(--status-run)' }}>{m.running} running</span>
        )}
      </div>

      <StatusBar m={m} />

      {/* ── The delivery rollup — wire facts only; absent on a pre-0.19 daemon ── */}
      {rollupWord !== null && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <span data-testid="campaign-card-delivery" style={{ ...CARD_STAT, color: S.ink }}>
            {rollupWord}
          </span>
          {m.rollup.prs.slice(0, CARD_PR_CAP).map((pr) => (
            <a
              key={pr.runId + pr.href}
              data-testid="campaign-card-pr"
              data-run-id={pr.runId}
              href={pr.href}
              target="_blank"
              rel="noreferrer"
              title={`${runShortId(pr.runId)} — ${pr.href}`}
              onClick={(e) => e.stopPropagation()}
              style={{ ...CARD_STAT, color: S.accent, textDecoration: 'underline' }}
            >
              #{pr.href.split('/').pop()}
            </a>
          ))}
          {m.rollup.prs.length > CARD_PR_CAP && (
            <span style={CARD_STAT} title="More PRs — open the scoreboard for the full ladder">
              +{m.rollup.prs.length - CARD_PR_CAP} more
            </span>
          )}
          {m.rollup.stranded.length > 0 && (
            <button
              type="button"
              data-testid="campaign-card-stranded"
              data-run-id={m.rollup.stranded[0]!.runId}
              title={`Finished, but the work is stranded in its worktree — no PR: ${m.rollup.stranded.map((s) => s.label).join(', ')}. Open the run to lift it.`}
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/runs/${encodeURIComponent(m.rollup.stranded[0]!.runId)}`);
              }}
              style={{
                cursor: 'pointer', flexShrink: 0,
                background: 'transparent', border: '1px solid var(--status-gate)',
                borderRadius: 'var(--radius-full)', padding: '1px 8px',
                fontSize: 'var(--text-2xs)', fontFamily: 'var(--font-mono)',
                color: 'var(--status-gate)',
              }}
            >
              stranded · {m.rollup.stranded.length}
            </button>
          )}
        </div>
      )}

      {/* ── Live narration — the freshest member-run frame, narrator-spoken ── */}
      {narration !== null && <CardNarration line={narration.line} runId={narration.runId} />}

      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        <span style={CARD_STAT}>
          {isCampaign
            ? `${m.total} node${m.total === 1 ? '' : 's'}${m.attached > 0 ? ` · +${m.attached} attached` : ''}`
            : `${m.total} run${m.total === 1 ? '' : 's'}`}
        </span>
        {!isCampaign && m.group !== null && (
          <span style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {m.group.runs.map((r) => (
              <button
                key={r.runId}
                type="button"
                data-testid="campaign-card-run"
                data-run-id={r.runId}
                onClick={(e) => { e.stopPropagation(); navigate(`/runs/${encodeURIComponent(r.runId)}`); }}
                style={{ ...CARD_STAT, color: S.muted, textDecoration: 'underline', cursor: 'pointer' }}
              >
                {runShortId(r.runId)}
              </button>
            ))}
          </span>
        )}
      </div>
    </div>
  );
}

interface Props {
  /** The board's live run list — KPI windows, gate jumps and narration read it, zero extra fetches. */
  runs: SessionView[];
  navigate: (path: string) => void;
}

export function CampaignsPage({ runs, navigate }: Props): React.ReactElement {
  const support = useCampaignsStore((s) => s.support);
  const campaigns = useCampaignsStore((s) => s.campaigns);
  const groups = useCampaignsStore((s) => s.groups);
  const refresh = useCampaignsStore((s) => s.refresh);
  const byRun = useRunEventStore((s) => s.byRun);
  const logs = useRuntimeStore((s) => s.logs);

  const [panel, setPanel] = useState<PanelKind>(null);
  const openPanel = (p: Exclude<PanelKind, null>): void => setPanel((cur) => (cur === p ? null : p));

  const [query, setQuery] = useState('');
  const [chip, setChip] = useState<CampaignChip>('all');
  const { range, setRange } = useTimeRange('30d');

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // ── The window (Work page idiom, over the CAMPAIGN/GROUP-member runs) ────────
  const runsById = useMemo(() => {
    const m = new Map<string, SessionView>();
    for (const v of runs) m.set(v.session.id, v);
    return m;
  }, [runs]);
  const memberIds = useMemo(() => memberRunIdSet(campaigns, groups), [campaigns, groups]);
  const memberRuns = useMemo(
    () => runs.filter((v) => v.session.archived_at == null && memberIds.has(v.session.id)),
    [runs, memberIds],
  );
  const buckets = useMemo(() => windowBuckets(memberRuns, range), [memberRuns, range]);
  const windowIds = useMemo(() => new Set(buckets.current.map((v) => v.session.id)), [buckets]);

  // ── KPI folds (pure, board/campaignStats) ───────────────────────────────────
  const totals = useMemo(() => campaignTotals(campaigns, groups), [campaigns, groups]);
  const runsDelta = useMemo(() => windowDelta(buckets, (rs) => rs.length), [buckets]);
  const failedDelta = useMemo(
    () => windowDelta(buckets, (rs) => rs.filter((v) => outcomeOf(v.session.status) === 'fail').length),
    [buckets],
  );
  const firstWaiting = memberRuns.find((v) => v.session.status === 'awaiting_human')?.session.id ?? null;
  const passHealth = passRateHealth(totals.landed, totals.terminal);

  // ── The card models (needs-you first; campaigns and groups, one sorted set) ──
  const cards = useMemo(
    () => campaignCards(campaigns, groups, runsById, windowIds),
    [campaigns, groups, runsById, windowIds],
  );

  // The freshest member-run narration per card — `recentActivity` capped at 1 (the ONE
  // narrator fold the home pulse reads; a second derivation could contradict it), clocked by
  // the runtime log's arrival tail exactly like the home pulse.
  const narrationByCard = useMemo(() => {
    const tailAt = (id: string): number | undefined => {
      const log = logs[id];
      return log !== undefined && log.length > 0 ? log[log.length - 1]?.ts : undefined;
    };
    const out = new Map<string, { runId: string; line: NarrationLine }>();
    for (const m of cards) {
      const memberViews = m.memberRunIds
        .map((id) => runsById.get(id))
        .filter((v): v is SessionView => v !== undefined);
      const row = recentActivity(memberViews, byRun, tailAt, 1)[0];
      if (row !== undefined) out.set(m.id, { runId: row.runId, line: row.line });
    }
    return out;
  }, [cards, runsById, byRun, logs]);

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
    && (q === '' || m.title.toLowerCase().includes(q) || m.id.toLowerCase().includes(q)));
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
    // The listing needs `GET /campaigns`; the creation verbs stay usable — a daemon this old
    // also predates `POST /testing/recon`, so `launchTestingRun` falls back to the shipping
    // `POST /runs` wire for ≤ 1-repo scopes. The folded-in Harness must not regress here.
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
            value={totals.campaigns + totals.groups}
            context={`${totals.activeNow} active now${totals.groups > 0 ? ` · ${totals.groups} ad-hoc group${totals.groups === 1 ? '' : 's'}` : ''}`}
            title="Every campaign and ad-hoc group on this daemon — click to clear filters"
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

      {cards.length === 0 ? (
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
            <CampaignCard
              key={`${m.kind}:${m.id}`}
              m={m}
              narration={narrationByCard.get(m.id) ?? null}
              navigate={navigate}
            />
          ))}
        </DashboardGrid>
      )}
    </div>
  );
}
