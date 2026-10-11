import { useEffect, useMemo, useState } from 'react';
import { campaignPath, testingPath, type LaunchIntent } from '../api/testing.js';
import type { SessionView } from '../api/types.js';
import {
  campaignCards, campaignTotals, deliveryRollupWord, matchesCampaignChip, memberRunIdSet, soloMatchesChip, soloTestRunIds, soloTotals,
  passRateHealth, passRateWord, progressWord, testSetCountsWord, testSetPrHref, testSetTotals, testSetsWord,
  unattributedTestSets, cardTitleWord, workflowWord,
  type CampaignCardModel, type CampaignChip,
} from '../board/campaignStats.js';
import { everythingPath } from '../board/everythingModel.js';
import { recentActivity } from '../board/homeActivity.js';
import { api } from '../api/client.js';
import { sessionPath } from '../board/sessionModel.js';
import { outcomeOf } from '../board/metrics.js';
import { windowBuckets, windowDelta } from '../board/windowStats.js';
import type { Navigate } from '../hooks/useRoute.js';
import { rangeWord, useTimeRange } from '../hooks/useTimeRange.js';
import { useCampaignsStore } from '../store/campaigns.js';
import { useRunEventStore } from '../store/events.js';
import { useRuntimeStore } from '../store/runtime.js';
import {
  DashboardGrid, FilterStrip, type FilterChip,
} from './dashboardKit.js';
import { TONE_COLOR, TONE_GLYPH, type NarrationLine } from './narrator.js';
import { humanTitle } from './runIdentity.js';
import { statusWord } from '../board/statusWords.js';
import { EmptyState, PageFrame, Skeleton, StatLine } from './ui/index.js';
import { AuthorPanel } from './SteeringAuthorPanel.js';
import { TestingLaunchPanel } from './TestingLaunchPanel.js';

/**
 * `/testing/campaigns` — THE Testing landing (the testing-UX wave), a COMMAND SURFACE with
 * the section-dashboard kit (`dashboardKit`, zero forks — the /projects //make grammar): a
 * KPI band under the three operator questions, the creation verbs in the header (Run recon /
 * New test / Add with chat — one panel open at a time; a `?new=` arrival intent pre-opens one,
 * see `readLaunchIntent`), then a filterable grid where
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


type PanelKind = 'recon' | 'campaign' | 'author' | null;

/** Most per-sibling PR links a card renders inline; the rest fold into a "+n" word. */
const CARD_PR_CAP = 4;
/** Produced test sets shown per card, newest first; older ones are counted, never hidden silently. */
const CARD_SET_CAP = 3;

/**
 * The scoreboard's segmented status bar, condensed onto the card — real counts, no series. Only
 * landed / failed / waiting / running fill it; everything not yet finished is EMPTY track
 * (studio#685 row 8: "0 of 2 landed" over a full bar read as complete).
 */
function StatusBar({ m }: { m: CampaignCardModel }): React.ReactElement {
  const seg = [
    { n: m.landed, tone: 'done' },
    { n: m.failed, tone: 'fail' },
    { n: m.awaitingHuman, tone: 'gate' },
    { n: m.running, tone: 'run' },
  ];
  const total = Math.max(1, m.total);
  return (
    <div
      data-testid="campaign-card-bar"
      role="img"
      aria-label={`${m.landed} landed, ${m.failed} failed of ${m.total}`}
      className="wk-test-bar"
    >
      {seg.filter((s) => s.n > 0).map((s) => (
        <span key={s.tone} data-tone={s.tone} className={`wk-test-bar-seg wk-test-bar-seg--${s.tone}`} style={{ width: `${(Math.min(s.n, total) / total) * 100}%` }} />
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
    <div data-testid="campaign-card-narration" data-run-id={runId} data-tone={line.tone} className="wk-test-card-line wk-test-card-narration">
      <span aria-hidden style={{ color: TONE_COLOR[line.tone], flexShrink: 0 }}>{TONE_GLYPH[line.tone]}</span>
      <span className="wk-test-card-clip" style={{ color: TONE_COLOR[line.tone] }}>{line.text}</span>
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
  // The gate jump: STRAIGHT to the waiting run's page, where the approval dock is pinned —
  // when the live list still holds one; otherwise the campaign's own surface.
  const firstWaiting = m.waiting[0]?.session.id ?? null;
  const rollupWord = deliveryRollupWord(m.rollup);
  const isCampaign = m.kind === 'campaign';
  const open = (): void => {
    if (isCampaign) navigate(campaignPath(m.id));
  };
  // Generated one-off workflow ids (`wf-…`) are handles, not names: only named workflows show.
  const workflows = m.workflowIds.flatMap((w) => {
    const word = workflowWord(w);
    return word === null ? [] : [{ id: w, word }];
  });

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
      className={`wk-card wk-test-card${isCampaign ? ' wk-test-card--door' : ''}`}
    >
      <div className="wk-test-card-head">
        <span className="wk-test-card-title" title={m.title}>{cardTitleWord(m)}</span>
        {m.awaitingHuman > 0 && (
          <button
            type="button"
            data-testid="campaign-needs-you"
            {...(firstWaiting !== null ? { 'data-run-id': firstWaiting } : {})}
            title={firstWaiting !== null ? 'Open the run that is waiting on you' : 'Open this test'}
            onClick={(e) => {
              e.stopPropagation();
              if (firstWaiting !== null) navigate(sessionPath(`run:${firstWaiting}`));
              else if (isCampaign) navigate(campaignPath(m.id));
            }}
            className="wk-btn wk-btn--secondary wk-btn--sm wk-test-card-needs"
          >
            {m.awaitingHuman} need{m.awaitingHuman === 1 ? 's' : ''} you
          </button>
        )}
      </div>

      <div className="wk-test-card-line">
        {/* §3.3 denominator honesty — a campaign's DAG is declared; a group's grows ("so far"). */}
        <span data-testid="campaign-card-progress" className="wk-test-card-strong">{progressWord(m)}</span>
        {m.failed > 0 && (
          <span data-testid="campaign-card-split" data-health={passRateHealth(m.landed, m.landed + m.failed)} className="wk-test-card-fail">
            {m.failed} failed
          </span>
        )}
        {m.running > 0 && <span className="wk-test-card-run">{m.running} running</span>}
      </div>

      <StatusBar m={m} />

      {/* ── The delivery rollup — wire facts only; absent on a pre-0.19 daemon ── */}
      {rollupWord !== null && (
        <div className="wk-test-card-line">
          <span data-testid="campaign-card-delivery">{rollupWord}</span>
          {m.rollup.prs.slice(0, CARD_PR_CAP).map((pr) => (
            <a
              key={pr.runId + pr.href}
              data-testid="campaign-card-pr"
              data-run-id={pr.runId}
              href={pr.href}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="wk-link"
            >
              PR #{pr.href.split('/').pop()}
            </a>
          ))}
          {m.rollup.prs.length > CARD_PR_CAP && (
            <span title="Open the test for every pull request">+{m.rollup.prs.length - CARD_PR_CAP} more</span>
          )}
          {m.rollup.stranded.length > 0 && (
            <button
              type="button"
              data-testid="campaign-card-stranded"
              data-run-id={m.rollup.stranded[0]!.runId}
              title="Finished, but the work has no pull request yet. Open the run to deliver it."
              onClick={(e) => {
                e.stopPropagation();
                navigate(sessionPath(`run:${m.rollup.stranded[0]!.runId}`));
              }}
              className="wk-btn wk-btn--secondary wk-btn--sm"
            >
              {m.rollup.stranded.length} not delivered
            </button>
          )}
        </div>
      )}

      {/* ── The produced test sets (wave 6, F-7R2-014; api-types 0.36.0) — joined onto this card by
             run_id / label in the fold, with the counts the verify phase re-derived, the plan and the
             delivered PR. A pre-0.36 daemon serves no sets: nothing below renders (absence, never 0). ── */}
      {(workflows.length > 0 || m.testSets.length > 0) && (
        <div className="wk-test-card-sets">
          {workflows.length > 0 && (
            <div className="wk-test-card-line">
              {workflows.map((w) => (
                <span key={w.id} data-testid="campaign-card-workflow" data-workflow={w.id} className="wk-tag">{w.word}</span>
              ))}
            </div>
          )}
          {m.testSets.slice(0, CARD_SET_CAP).map((t) => {
            const pr = testSetPrHref(t);
            return (
              <div
                key={t.id}
                data-testid="campaign-card-testset"
                data-set-id={t.id}
                data-run-id={t.run_id}
                data-verified={t.verified}
                data-produced={t.produced}
                data-executed={t.executed}
                data-passed={t.passed}
                data-failed={t.failed}
                data-not-executed={t.not_executed}
                title={t.files.length > 0 ? t.files.map((f) => `${f.path} — ${f.status}`).join('\n') : undefined}
                className="wk-test-card-line"
              >
                <span
                  data-testid="campaign-card-testset-verified"
                  title={t.verified ? 'Every produced test ran and passed, and the repository checks passed' : 'The checks did not confirm this set yet'}
                  className={`wk-tag ${t.verified ? 'wk-tag--ok' : 'wk-tag--gate'}`}
                >
                  {t.verified ? 'Verified' : 'Not verified'}
                </span>
                <span className={t.failed > 0 ? 'wk-test-card-fail' : undefined}>
                  {testSetCountsWord(t)}
                  {t.not_executed > 0 && (
                    <span data-testid="campaign-card-testset-unverified" className="wk-test-card-gate">
                      {' '}· {t.not_executed} not executed
                    </span>
                  )}
                </span>
                {t.plan !== null && (
                  <button
                    type="button"
                    data-testid="campaign-card-testset-plan"
                    data-run-id={t.run_id}
                    data-plan={t.plan}
                    title={`The test plan (${t.plan}). Open the run to read it.`}
                    onClick={(e) => { e.stopPropagation(); navigate(sessionPath(`run:${t.run_id}`)); }}
                    className="wk-link"
                  >
                    Plan
                  </button>
                )}
                {pr !== null && (
                  <a
                    data-testid="campaign-card-testset-pr"
                    data-run-id={t.run_id}
                    href={pr}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="wk-link"
                  >
                    PR #{pr.split('/').pop()}
                  </a>
                )}
              </div>
            );
          })}
          {m.testSets.length > CARD_SET_CAP && (
            <span data-testid="campaign-card-testset-more" className="wk-test-card-meta">
              +{m.testSets.length - CARD_SET_CAP} older set{m.testSets.length - CARD_SET_CAP === 1 ? '' : 's'}
            </span>
          )}
        </div>
      )}

      {/* ── Live narration — the freshest member-run frame, narrator-spoken ── */}
      {narration !== null && <CardNarration line={narration.line} runId={narration.runId} />}

      <div className="wk-test-card-line wk-test-card-meta">
        <span>
          {isCampaign
            ? `${m.total} step${m.total === 1 ? '' : 's'}${m.attached > 0 ? ` · +${m.attached} attached` : ''}`
            : `${m.total} run${m.total === 1 ? '' : 's'}`}
        </span>
        {!isCampaign && m.group !== null && m.group.runs.map((r, i) => (
          <button
            key={r.runId}
            type="button"
            data-testid="campaign-card-run"
            data-run-id={r.runId}
            title={`Open run ${i + 1}`}
            onClick={(e) => { e.stopPropagation(); navigate(sessionPath(`run:${r.runId}`)); }}
            className="wk-link"
          >
            Run {i + 1}
          </button>
        ))}
      </div>
    </div>
  );
}

interface Props {
  /** The board's live run list — KPI windows, gate jumps and narration read it, zero extra fetches. */
  runs: SessionView[];
  navigate: Navigate;
  /** The landing's `?project=` (S16a-4f: the moved `/p/:id/campaigns`), the project a new test's
   *  launch panel preselects. No other scoping is claimed. */
  projectId?: string | null;
  /** The `?new=` arrival intent (`readLaunchIntent`) — the rail's ＋ / "Run recon" row land here
   *  with that launch panel OPEN. `null` = a plain arrival, nothing opens. */
  launchIntent?: LaunchIntent | null;
}

export function CampaignsPage({ runs, navigate, projectId = null, launchIntent = null }: Props): React.ReactElement {
  const support = useCampaignsStore((s) => s.support);
  const campaigns = useCampaignsStore((s) => s.campaigns);
  const groups = useCampaignsStore((s) => s.groups);
  const testSets = useCampaignsStore((s) => s.testSets);
  const malformedTestSets = useCampaignsStore((s) => s.malformedTestSets);
  const refresh = useCampaignsStore((s) => s.refresh);
  const byRun = useRunEventStore((s) => s.byRun);
  const logs = useRuntimeStore((s) => s.logs);

  const [panel, setPanel] = useState<PanelKind>(null);
  const openPanel = (p: Exclude<PanelKind, null>): void => setPanel((cur) => (cur === p ? null : p));
  // Counts `?new=` ARRIVALS (not intents): part of the launch panel's `key`, so a re-arrival on
  // an already-open panel remounts a FRESH launch instance instead of `setPanel(same)` no-op-ing
  // onto one that has already launched (or errored) — the rail's ＋ after a successful launch
  // must start a second test, not re-show the first one's "launched" state (#210 review).
  const [arrival, setArrival] = useState(0);

  const [query, setQuery] = useState('');
  const [chip, setChip] = useState<CampaignChip>('all');
  const { range, setRange } = useTimeRange('30d');

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // The arrival intent (wicked-studio#203): a create affordance that lands here must land with
  // its panel OPEN. Open it, then CONSUME the query — replace, so Back never re-opens the panel
  // and a second ＋ click from this very page changes the address again and re-fires.
  // Consuming is also what makes EVERY ＋ click a distinct arrival (`null → intent → null`), so
  // repeated same-intent arrivals each bump `arrival` and each get a fresh panel.
  useEffect(() => {
    if (launchIntent === null) return;
    setPanel(launchIntent);
    setArrival((n) => n + 1);
    navigate(testingPath('campaigns'), { replace: true });
  }, [launchIntent, navigate]);

  // ── The window (Work page idiom, over the CAMPAIGN/GROUP-member runs) ────────
  const runsById = useMemo(() => {
    const m = new Map<string, SessionView>();
    for (const v of runs) m.set(v.session.id, v);
    return m;
  }, [runs]);
  const memberIds = useMemo(() => memberRunIdSet(campaigns, groups), [campaigns, groups]);
  // studio#216: the single-repo tests this landing launched — crew files them under no campaign and
  // no group, so they are read off the `run.launched` trail (`detail.recon`). One read per visit; a
  // daemon without the audit route shows none (never a guessed list).
  const [soloLaunched, setSoloLaunched] = useState<string[]>([]);
  /** Bumped by a launch from this page: the trail is re-read so the new solo test appears (codex r2). */
  const [trailTick, setTrailTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    Promise.resolve()
      // The trail's own ceiling (crew audit.ts: at most 1000 per read, newest first) — the action
      // filter runs before it, so this is the newest 1000 launches (codex r1 on #216).
      .then(() => api.getAuditByAction('run.launched', 1000))
      .then((page) => { if (!cancelled) setSoloLaunched(soloTestRunIds(page.entries, new Set())); })
      .catch(() => { /* no audit trail: the landing shows campaigns and groups only */ });
    return () => { cancelled = true; };
  }, [trailTick]);
  const soloRuns = useMemo(
    () => soloLaunched
      .filter((id) => !memberIds.has(id))
      .map((id) => runsById.get(id))
      .filter((v): v is SessionView => v !== undefined && v.session.archived_at == null),
    [soloLaunched, memberIds, runsById],
  );
  const memberRuns = useMemo(
    () => runs.filter((v) => v.session.archived_at == null && memberIds.has(v.session.id)).concat(soloRuns),
    [runs, memberIds, soloRuns],
  );
  const buckets = useMemo(() => windowBuckets(memberRuns, range), [memberRuns, range]);
  const windowIds = useMemo(() => new Set(buckets.current.map((v) => v.session.id)), [buckets]);

  // ── KPI folds (pure, board/campaignStats) ───────────────────────────────────
  const totals = useMemo(() => {
    const t = campaignTotals(campaigns, groups, runsById);
    const solo = soloTotals(soloRuns);
    return {
      ...t,
      // A solo test moving or waiting is a test active now, like a campaign or group (codex r2).
      activeNow: t.activeNow + solo.running + solo.awaitingHuman,
      landed: t.landed + solo.landed, failed: t.failed + solo.failed, running: t.running + solo.running,
      awaitingHuman: t.awaitingHuman + solo.awaitingHuman, terminal: t.terminal + solo.terminal,
      cancelled: t.cancelled + solo.cancelled,
    };
  }, [campaigns, groups, runsById, soloRuns]);
  // The registered sets' rollup — `null` on a pre-0.36 daemon, so the tile says nothing about sets.
  const setTotals = useMemo(() => (testSets === null ? null : testSetTotals(testSets)), [testSets]);
  const failedDelta = useMemo(
    () => windowDelta(buckets, (rs) => rs.filter((v) => outcomeOf(v.session.status) === 'fail').length),
    [buckets],
  );
  const firstWaiting = memberRuns.find((v) => v.session.status === 'awaiting_human')?.session.id ?? null;

  // ── The card models (needs-you first; campaigns and groups, one sorted set) ──
  const cards = useMemo(
    () => campaignCards(campaigns, groups, runsById, windowIds, testSets ?? []),
    [campaigns, groups, runsById, windowIds, testSets],
  );
  // Sets no card carries (the producing run archived / its group gone) — said, never folded away.
  const unattributed = useMemo(
    () => (testSets === null ? [] : unattributedTestSets(cards, testSets)),
    [cards, testSets],
  );
  // The tile's sets word — FIRST in the context so it survives the tile's ellipsis (#266 F-1);
  // absent on a pre-0.36 daemon (`setTotals === null`), "no test sets registered yet" on a 0.36
  // daemon's real zero (F-3), "· N unattributed" / "· N malformed" whenever non-zero (F-2).
  const setsWord = setTotals === null ? null : testSetsWord(setTotals, unattributed.length, malformedTestSets);
  // The unabridged line for the span's hover title (R2-1): "1 test set · …" where the painted lead
  // says "1 set · …" so it clears the ellipsis glyph at 1440 px.
  const setsWordFull = setTotals === null ? null : testSetsWord(setTotals, unattributed.length, malformedTestSets, 'full');

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
    all: cards.length + soloRuns.length,
    'needs-you': cards.filter((m) => matchesCampaignChip(m, 'needs-you')).length + soloRuns.filter((v) => soloMatchesChip(v, 'needs-you')).length,
    running: cards.filter((m) => matchesCampaignChip(m, 'running')).length + soloRuns.filter((v) => soloMatchesChip(v, 'running')).length,
    failing: cards.filter((m) => matchesCampaignChip(m, 'failing')).length + soloRuns.filter((v) => soloMatchesChip(v, 'failing')).length,
    quiet: cards.filter((m) => matchesCampaignChip(m, 'quiet')).length + soloRuns.filter((v) => soloMatchesChip(v, 'quiet')).length,
  }), [cards, soloRuns]);

  const q = query.trim().toLowerCase();
  const filtered = cards.filter((m) =>
    matchesCampaignChip(m, chip)
    && (q === '' || m.title.toLowerCase().includes(q) || m.id.toLowerCase().includes(q)));
  // The recency window scopes the GRID to campaigns with a member run in it; older campaigns
  // stay one honest chip away ("+N older"), never silently gone — the FilterStrip idiom.
  const visible = range === 'all' ? filtered : filtered.filter((m) => m.inWindow);
  // studio#216: the solo tests take the SAME query, chip and window as the grid (codex r1).
  const soloFiltered = soloRuns.filter((v) =>
    soloMatchesChip(v, chip)
    && (q === '' || (v.session.problem ?? '').toLowerCase().includes(q) || v.session.id.toLowerCase().includes(q)));
  const visibleSolo = range === 'all' ? soloFiltered : soloFiltered.filter((v) => windowIds.has(v.session.id));
  const hiddenByWindow = filtered.length - visible.length + (soloFiltered.length - visibleSolo.length);

  const chips: FilterChip[] = [
    { id: 'all', label: 'All', count: chipCounts.all },
    { id: 'needs-you', label: 'Needs you', count: chipCounts['needs-you'] },
    { id: 'running', label: 'Running', count: chipCounts.running },
    { id: 'failing', label: 'Failing', count: chipCounts.failing },
    { id: 'quiet', label: 'Quiet', count: chipCounts.quiet },
  ];

  // ── The creation verbs + panels (the Harness, folded in) ────────────────────
  const actions = (
    <>
      <button
        type="button"
        data-testid="testing-recon-open"
        aria-expanded={panel === 'recon'}
        onClick={() => openPanel('recon')}
        title="Look over a repository and suggest what to test, without writing anything"
        className="wk-btn wk-btn--secondary"
      >
        Run recon
      </button>
      <button
        type="button"
        data-testid="testing-author-open"
        aria-expanded={panel === 'author'}
        onClick={() => openPanel('author')}
        // F-075 (2): this verb authors TESTING STEERING RULES (the AuthorPanel), not tests — the
        // label says so, so a customer who wants tests does not get a policy-authoring run.
        title="Draft rules for how tests are written and judged (not a test run)"
        className="wk-btn wk-btn--secondary"
      >
        Add testing rules
      </button>
      <button
        type="button"
        data-testid="testing-campaign-open"
        aria-expanded={panel === 'campaign'}
        onClick={() => openPanel('campaign')}
        className="wk-btn wk-btn--primary"
      >
        New test
      </button>
    </>
  );
  // studio#685 row 50: one plain sentence, not the workflow diagram.
  const intro = 'New test plans tests for a repository, waits for you to approve the plan, runs what it wrote and opens a pull request.';
  const panels = (
    <>
      {/* Keyed by intent AND arrival: a new `?new=` arrival, or switching the verb (recon ⇄ test),
          is a NEW launch instance — a launched/errored panel never carries over into the next ask. */}
      {(panel === 'recon' || panel === 'campaign') && (
        <TestingLaunchPanel
          key={`${panel}:${arrival}`}
          intent={panel}
          navigate={navigate}
          onClose={() => setPanel(null)}
          onLaunched={() => { void refresh(); setTrailTick((n) => n + 1); }}
          initialProjectId={projectId ?? undefined}
        />
      )}
      {/* The steering AuthorPanel, REUSED VERBATIM with this surface's type: the authoring run
          drafts `testing` steering rules and stops at its propose gate — one component set. */}
      {panel === 'author' && <AuthorPanel type="testing" onClose={() => setPanel(null)} onAuthored={() => {}} />}
    </>
  );
  const frame = (children: React.ReactNode): React.ReactElement => (
    <div data-testid="campaigns-page" className="wk-test-page">
      <PageFrame title="Testing" intro={intro} actions={actions} data-testid="campaigns-frame">
        {panels}
        {children}
      </PageFrame>
    </div>
  );

  if (support === 'unknown') {
    // While probing: the frame's title and a skeleton ALONE — no verbs before the probe answers.
    return (
      <div data-testid="campaigns-probing" className="wk-test-page">
        <PageFrame title="Testing" intro={intro}><Skeleton rows={3} variant="card" /></PageFrame>
      </div>
    );
  }
  if (support === 'unsupported') {
    // The listing needs `GET /campaigns`; the creation verbs stay usable — a daemon this old
    // also predates `POST /testing/recon`, so `launchTestingRun` falls back to the shipping
    // `POST /runs` wire for ≤ 1-repo scopes. The folded-in Harness must not regress here.
    return frame(
      <div data-testid="campaigns-unsupported">
        <EmptyState
          title="This version of Studio’s service can’t list tests."
          body="New test still works. Update Studio to see each test's runs grouped here."
        />
      </div>,
    );
  }

  // Settled-zero filter chips are hidden unless active (UI-CONTRACT §4.5); "All" always shows.
  const shownChips = chips.filter((c) => c.id === 'all' || c.id === chip || (c.count ?? 0) > 0);
  const passWord = passRateWord(totals.landed, totals.terminal);

  return frame(
    <>
      {/* ── The facts line (KPI tiles retired, UI-CONTRACT §4.6): one sentence-case line ── */}
      <div data-testid="campaigns-kpis" className="wk-test-facts"
        data-tests={totals.campaigns + totals.groups + soloRuns.length}
        data-test-sets={setTotals === null ? 'absent' : setTotals.sets}
        data-test-sets-unattributed={unattributed.length}
        data-test-sets-malformed={malformedTestSets}
        data-active-now={totals.activeNow}
        data-runs={buckets.current.length}
        data-running={totals.running}
        data-gates={totals.awaitingHuman}
        data-failed={failedDelta.current}
      >
        <StatLine
          showZero={false}
          items={[
            { label: totals.campaigns + totals.groups + soloRuns.length === 1 ? 'test' : 'tests', value: totals.campaigns + totals.groups + soloRuns.length },
            { label: `${buckets.current.length === 1 ? 'run' : 'runs'} in the ${rangeWord(range)}`, value: buckets.current.length },
            { label: 'running now', value: totals.running },
            { label: totals.awaitingHuman === 1 ? 'needs you' : 'need you', value: totals.awaitingHuman },
            { label: 'failed', value: failedDelta.current },
          ]}
        />
        <p data-testid="stat-campaign-pass-rate" data-value={passWord} className="wk-test-facts-meta">
          {totals.terminal > 0
            ? `Runs: ${passWord} passed · ${totals.landed} landed of ${totals.terminal} finished`
            : 'Runs: no finished runs yet'}
          {totals.cancelled > 0 ? ` · ${totals.cancelled} cancelled` : ''}

        </p>
        {setsWord !== null && (
          <p className="wk-test-facts-meta">
            <span
              data-testid="campaigns-sets-word"
              title={(setsWordFull ?? '') + (unattributed.length > 0 ? ` — not shown on any card: ${unattributed.map((t) => t.plan ?? t.id).join(', ')}` : '')}
            >Test sets: {setsWord}</span>
          </p>
        )}
        <p className="wk-steer-usage-doors">
          {buckets.current.length > 0 && (
            <a
              data-testid="campaigns-all-runs"
              href={everythingPath({ tab: 'sessions' })}
              onClick={(e) => { e.preventDefault(); navigate(everythingPath({ tab: 'sessions' })); }}
              className="wk-link"
            >
              See all runs
            </a>
          )}
          {totals.running > 0 && (
            <a
              data-testid="campaigns-running-runs"
              href={everythingPath({ tab: 'sessions', filter: 'active' })}
              onClick={(e) => { e.preventDefault(); navigate(everythingPath({ tab: 'sessions', filter: 'active' })); }}
              className="wk-link"
            >
              See running
            </a>
          )}
          {failedDelta.current > 0 && (
            <a
              data-testid="campaigns-failed-runs"
              href={everythingPath({ tab: 'sessions', filter: 'failed' })}
              onClick={(e) => { e.preventDefault(); navigate(everythingPath({ tab: 'sessions', filter: 'failed' })); }}
              className="wk-link"
            >
              See failed runs
            </a>
          )}
          {firstWaiting !== null && (
            <a
              data-testid="campaigns-first-waiting"
              href={sessionPath(`run:${firstWaiting}`)}
              onClick={(e) => { e.preventDefault(); navigate(sessionPath(`run:${firstWaiting}`)); }}
              className="wk-link"
            >
              Open the run waiting on you
            </a>
          )}
        </p>
      </div>

      {/* ── Filters — first-class, never hidden ── */}
      <FilterStrip
        testId="campaigns-filter"
        query={query}
        onQuery={setQuery}
        placeholder="Search tests…"
        chips={shownChips}
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
            title={`${hiddenByWindow} test${hiddenByWindow === 1 ? '' : 's'} with no run in the ${rangeWord(range)} window`}
            className="wk-btn wk-btn--quiet wk-btn--sm"
          >
            Show {hiddenByWindow} older
          </button>
        )}
      </FilterStrip>

      {/* studio#216: single-repo tests — each run New test / Run recon launched on ONE repository. */}
      {visibleSolo.length > 0 && (
        <section data-testid="testing-solo-runs" className="wk-test-solo">
          <h2 className="wk-section-title">Single-repository tests</h2>
          {visibleSolo.map((v) => {
            const st = statusWord(v);
            return (
              <a
                key={v.session.id}
                data-testid="testing-solo-run"
                data-run-id={v.session.id}
                data-status={v.session.status}
                href={sessionPath(`run:${v.session.id}`)}
                onClick={(e) => { e.preventDefault(); navigate(sessionPath(`run:${v.session.id}`)); }}
                className="wk-list-row wk-test-solo-row"
              >
                <span className={`wk-tag${st.tone === 'ok' || st.tone === 'fail' || st.tone === 'gate' ? ` wk-tag--${st.tone}` : ''}`}>{st.word}</span>
                <span className="wk-list-row-title">{humanTitle(v.session.problem || 'Untitled test')}</span>
                <span className="wk-list-row-meta">{v.session.repo_ref != null ? (v.session.repo_ref.split(/[\\/]/).filter(Boolean).pop() ?? v.session.repo_ref) : 'No repository'}</span>
              </a>
            );
          })}
        </section>
      )}

      {cards.length === 0 && soloRuns.length === 0 ? (
        // The honest empty state, with the way in: a test appears with its first run.
        <div data-testid="campaigns-empty">
          <EmptyState
            title="No tests yet"
            body="A test shows up here as soon as you start one, and fills in with its results when it finishes."
            action={(
              <button type="button" data-testid="campaigns-empty-cta" onClick={() => setPanel('campaign')} className="wk-btn wk-btn--primary">
                New test
              </button>
            )}
          />
        </div>
      ) : visible.length === 0 && visibleSolo.length > 0 ? null : visible.length === 0 ? (
        <p data-testid="campaigns-empty-filter" className="wk-test-facts-meta">
          No tests match these filters.{' '}
          <button type="button" onClick={() => { setChip('all'); setQuery(''); setRange('all'); }} className="wk-link">
            Clear filters
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
    </>,
  );
}
