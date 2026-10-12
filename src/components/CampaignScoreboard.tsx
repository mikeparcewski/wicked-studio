import { everythingPath } from '../board/everythingModel.js';
import { useEffect, useMemo, useState } from 'react';
import { getCampaign, type Campaign, type CampaignNodeStatus } from '../api/campaigns.js';
import { downloadRunEvidence } from '../api/client.js';
import { apiStatus, readErrorKind } from '../api/errors.js';
import type { SessionView } from '../api/types.js';
import {
  campaignStatusWord, campaignCounts, campaignDeliveryRollup, deliveryRollupWord,
} from '../board/campaignStats.js';
import { sessionPath } from '../board/sessionModel.js';
import { useAcceptanceStore } from '../store/acceptance.js';
import { useCampaignsStore } from '../store/campaigns.js';
import { deliveryOf, isPrUrl, resolveDelivery, DELIVERY_LABEL } from './delivery.js';
import { humanTitle, STATUS_STYLE } from './runIdentity.js';
import { EmptyState, Skeleton, StateBanner } from './ui/index.js';

/**
 * The campaign scoreboard (TH-14, extends wicked-studio#27) — READ-ONLY: one surface that
 * groups a campaign's sibling runs. The ladder is one row per DAG NODE of the engine's
 * embedded `def` (the wire crew#342 actually serves — deliberately not a graph: the edges
 * exist but a table names the work; a DAG view is a later, additive lane), followed by the
 * ad-hoc runs attached at launch (api-types 0.19.0 — provenance rows, marked as such). Node
 * status goes live off core's Campaign* `/ws` frames (see `store/campaigns.ts` for the fold),
 * falling back to the live run list, then to the engine's persisted `node_status`, in that
 * order.
 *
 * ── THE WIRE RULES THIS SURFACE HOLDS ────────────────────────────────────────────────────────
 *  - The delivery rollup ("K of N siblings delivered") reads the DAEMON-JOINED
 *    `node_delivery` / `attached_runs` facts off the ONE `GET /campaigns/:id`, upgraded live
 *    by `session.delivery` where the run list still holds the sibling — NEVER a per-run
 *    transcript fetch. Zero requests beyond that one GET.
 *  - Every PR href passes the `isPrUrl` shape gate (delivery.ts's one invariant), whichever
 *    wire carried it.
 *  - Verdict chips are a per-run acceptance read (`GET /runs/:id/acceptance`) behind ONE
 *    explicit gesture (the MakeDashboard fan-out precedent): zero requests on render,
 *    exactly N on click, cached per run id forever after (`store/acceptance.ts`).
 *  - Evidence links download through the existing `GET /runs/:id/evidence` — on click only.
 */

const TERMINAL_NODE: ReadonlySet<CampaignNodeStatus> = new Set([
  'completed', 'failed', 'blocked', 'cancelled',
]);

const terminalRun = (s: string | null | undefined): boolean =>
  s != null && ['completed', 'failed', 'cancelled'].includes(s);

/** The engine node statuses + the frame vocabulary, in the closest run-status tokens. */
const NODE_STATUS_STYLE: Record<string, { label: string; color: string }> = {
  pending:         { label: 'Pending',        color: 'var(--ink-dim)' },
  ready:           { label: 'Ready',          color: 'var(--ink-muted)' },
  running:         { label: 'Executing',      color: 'var(--status-run)' },
  started:         { label: 'Executing',      color: 'var(--status-run)' },
  ready_to_resume: { label: 'Resuming',       color: 'var(--status-run)' },
  awaiting_human:  { label: 'Awaiting human', color: 'var(--status-gate)' },
  completed:       { label: 'Completed',      color: 'var(--status-done)' },
  failed:          { label: 'Failed',         color: 'var(--status-fail)' },
  blocked:         { label: 'Blocked',        color: 'var(--status-fail)' },
  cancelled:       { label: 'Cancelled',      color: 'var(--ink-dim)' },
};

const CAMPAIGN_STATUS_COLOR: Record<string, string> = {
  running: 'var(--status-run)',
  paused: 'var(--status-gate)',
  completed: 'var(--status-done)',
  partially_completed: 'var(--status-gate)',
  failed: 'var(--status-fail)',
  cancelled: 'var(--ink-dim)',
};

const CELL: React.CSSProperties = { padding: '8px 10px', verticalAlign: 'top' };
const HEAD: React.CSSProperties = {
  ...CELL,
  textAlign: 'left',
  color: 'var(--ink-dim)',
  fontSize: 'var(--text-xs)',
  fontWeight: 500,
};

function Chip({ label, color, testid, title, extra }: {
  label: string;
  color: string;
  testid: string;
  title?: string | undefined;
  extra?: Record<string, string> | undefined;
}): React.ReactElement {
  return (
    <span
      data-testid={testid}
      title={title}
      {...extra}
      style={{
        display: 'inline-block',
        padding: '1px 8px',
        borderRadius: '999px',
        fontSize: 'var(--text-xs)',
        color,
        border: `1px solid ${color}`,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );
}

/** One ladder row, whatever wire it came off — node or attached run, joined zero-fetch. */
interface LadderRow {
  kind: 'node' | 'attached';
  /** node_id, or the attached run's id. */
  label: string;
  runId: string | null;
  problem: string;
  /** Engine snapshot status (node_status for nodes; the DTO's status for attached). */
  snapshotStatus: string | null;
  /** Wire-carried delivery (node_delivery / the attached view) — the snapshot arm. */
  delivery: { delivery: string; deliverUrl?: string } | null;
}

/**
 * The row's status chip, joined zero-fetch: Campaign* frame fold over the live run list over
 * the engine snapshot, in that order — each arm labels its source honestly.
 */
function rowStatus(
  row: LadderRow,
  view: SessionView | undefined,
  frameStatus: string | undefined,
): { label: string; color: string; source: 'frame' | 'live' | 'snapshot' | 'gone' } {
  if (frameStatus !== undefined) {
    const s = NODE_STATUS_STYLE[frameStatus] ?? { label: frameStatus, color: 'var(--ink-dim)' };
    return { ...s, source: 'frame' };
  }
  if (view !== undefined) {
    const st = view.session.status;
    const s = STATUS_STYLE[st] ?? { label: st, color: 'var(--ink-dim)' };
    return { ...s, source: 'live' };
  }
  if (row.snapshotStatus === null) {
    return { label: 'No longer held', color: 'var(--ink-dim)', source: 'gone' };
  }
  const s = NODE_STATUS_STYLE[row.snapshotStatus]
    ?? (STATUS_STYLE as Record<string, { label: string; color: string }>)[row.snapshotStatus]
    ?? { label: row.snapshotStatus, color: 'var(--ink-dim)' };
  return { ...s, source: 'snapshot' };
}

interface Props {
  campaignId: string;
  /** The board's live run list — sibling rows render live status/delivery from it, zero-fetch. */
  runs: SessionView[];
  navigate: (path: string) => void;
}

export function CampaignScoreboard({ campaignId, runs, navigate }: Props): React.ReactElement {
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [failed, setFailed] = useState<{ error: unknown } | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const live = useCampaignsStore((s) => s.live[campaignId]);
  const verdicts = useAcceptanceStore((s) => s.byRun);
  const loadVerdict = useAcceptanceStore((s) => s.load);
  const [verdictsRequested, setVerdictsRequested] = useState(false);

  // The one fetch this surface makes on its own: the campaign with its daemon-joined rollup.
  // Re-read when a Campaign* frame for THIS campaign lands (`live` identity changes) — new
  // node statuses mean the snapshot moved. The run list itself arrives via props.
  useEffect(() => {
    let cancelled = false;
    setNotFound(false);
    setFailed(null);
    getCampaign(campaignId)
      .then((c) => {
        if (!cancelled) setCampaign(c);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        if (apiStatus(e) === 404) setNotFound(true);
        else setFailed({ error: e });
      });
    return () => {
      cancelled = true;
    };
  }, [campaignId, live, retryKey]);

  const runsById = useMemo(() => {
    const m = new Map<string, SessionView>();
    for (const v of runs) m.set(v.session.id, v);
    return m;
  }, [runs]);

  const allTests = (
    <a
      href={everythingPath({ tab: 'sessions' })}
      onClick={(e) => { e.preventDefault(); navigate(everythingPath({ tab: 'sessions' })); }}
      className="wk-link"
    >
      All jobs
    </a>
  );
  if (notFound) {
    return (
      <div data-testid="campaign-notfound" className="wk-page">
        <EmptyState
          title="This test isn’t here."
          body="A test appears with its first run, so this one may never have started."
          action={allTests}
        />
      </div>
    );
  }
  if (failed !== null) {
    return (
      <div data-testid="campaign-load-failed" className="wk-page">
        <StateBanner
          kind={readErrorKind(failed.error)}
          what="this test"
          error={failed.error instanceof Error ? failed.error.message : String(failed.error)}
          onRetry={() => setRetryKey((k) => k + 1)}
        />
      </div>
    );
  }
  if (campaign === null) {
    return (
      <div data-testid="campaign-loading" className="wk-page">
        <Skeleton rows={4} />
      </div>
    );
  }

  const counts = campaignCounts(campaign);
  // The campaign's DAG is a DECLARED denominator (§3.3) — no "so far" here; the ad-hoc
  // attached runs are provenance and counted beside it, never folded into the DAG number.
  const progress = `${counts.landed} of ${counts.nodes} landed`;

  // The delivery rollup, strictly off wire-carried facts (never a transcript fetch) — the
  // campaignStats fold over `node_delivery` + `attached_runs` (api-types 0.19.0).
  const rollup = campaignDeliveryRollup(campaign);
  const rollupWord = deliveryRollupWord(rollup);

  const seg = [
    { n: counts.landed, color: 'var(--status-done)' },
    { n: counts.failed, color: 'var(--status-fail)' },
    { n: counts.awaitingHuman, color: 'var(--status-gate)' },
    { n: counts.running, color: 'var(--status-run)' },
  ];
  // Not-yet-finished work is EMPTY track (studio#685 row 8), never a grey fill that reads as done.
  const segTotal = Math.max(1, counts.nodes, seg.reduce((a, s) => a + s.n, 0));

  // ── The ladder: one row per DAG node, then the attached provenance rows ──────
  const rows: LadderRow[] = [
    ...campaign.def.nodes.map((node): LadderRow => ({
      kind: 'node',
      label: node.node_id,
      runId: campaign.node_run_id[node.node_id] ?? null,
      problem: node.run_spec.problem,
      snapshotStatus: campaign.node_status[node.node_id] ?? null,
      delivery: campaign.node_delivery?.[node.node_id] ?? null,
    })),
    ...(campaign.attached_runs ?? []).map((a): LadderRow => ({
      kind: 'attached',
      label: a.runId,
      runId: a.runId,
      problem: runsById.get(a.runId)?.session.problem ?? 'Attached run',
      snapshotStatus: a.status,
      delivery: { delivery: a.delivery, ...(a.deliverUrl !== undefined ? { deliverUrl: a.deliverUrl } : {}) },
    })),
  ];

  const rowTerminal = (row: LadderRow, view: SessionView | undefined): boolean => {
    if (view !== undefined) return terminalRun(view.session.status);
    if (row.kind === 'node') {
      return row.snapshotStatus !== null && TERMINAL_NODE.has(row.snapshotStatus as CampaignNodeStatus);
    }
    return terminalRun(row.snapshotStatus);
  };

  const liveStatus = live?.status ?? null;
  // studio#216: an all-cancelled campaign reads cancelled, not the engine's `partially_completed`.
  // The normalization applies to the LIVE word too: a frame's `partially_completed` over nodes that
  // are all cancelled is the same overclaim (codex r2 on #216).
  const statusWord = campaignStatusWord(liveStatus === null ? campaign : { ...campaign, status: liveStatus });

  return (
    <div data-testid="campaign-scoreboard" className="wk-page wk-test-board">
      <p className="wk-test-board-back">{allTests}</p>
      <div className="wk-test-board-head">
        <h1 className="wk-page-title" title={campaign.def.name !== '' ? campaign.def.name : campaign.id}>
          {humanTitle(campaign.def.name !== '' ? campaign.def.name : campaign.id)}
        </h1>
        <span
          data-testid="campaign-live-status"
          data-status-source={liveStatus !== null ? 'frame' : 'snapshot'}
          className="wk-tag"
          style={{ color: CAMPAIGN_STATUS_COLOR[statusWord] ?? 'var(--ink-dim)' }}
        >
          {statusWord.replace(/_/g, ' ')}
        </span>
      </div>

      <div className="wk-test-card-line wk-test-board-facts">
        <span data-testid="campaign-progress" className="wk-test-card-strong">
          {progress}
          {counts.attached > 0 && (
            <span className="wk-test-card-meta"> (+{counts.attached} attached)</span>
          )}
        </span>
        {rollupWord !== null && (
          <span data-testid="campaign-delivery-rollup">
            {rollup.delivered} of {rollup.total} delivered
          </span>
        )}
        {rollup.stranded.length > 0 && (
          <span
            data-testid="campaign-stranded-chip"
            className="wk-tag wk-tag--gate"
            title="Finished, but the work has no pull request yet. Open the run to deliver it."
          >
            {rollup.stranded.length} not delivered
          </span>
        )}
      </div>

      <div role="img" aria-label={progress} className="wk-test-bar wk-test-board-bar">
        {seg.filter((s) => s.n > 0).map((s, i) => (
          <span key={i} className="wk-test-bar-seg" style={{ width: `${(s.n / segTotal) * 100}%`, background: s.color }} />
        ))}
      </div>

      <div className="wk-test-board-runs-head">
        <h2 className="wk-section-title">Runs</h2>
        {!verdictsRequested ? (
          // Verdicts are a per-run read the list wire deliberately does not carry — loaded
          // behind ONE explicit gesture (zero fetches on render, exactly N on click).
          <button
            type="button"
            data-testid="campaign-load-verdicts"
            onClick={() => {
              setVerdictsRequested(true);
              for (const row of rows) {
                if (row.runId !== null && rowTerminal(row, runsById.get(row.runId))) {
                  loadVerdict(row.runId);
                }
              }
            }}
            className="wk-btn wk-btn--secondary wk-btn--sm"
          >
            Load verdicts
          </button>
        ) : null}
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table data-testid="campaign-ladder" style={{ marginTop: '8px', borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--surface-raised)' }}>
              <th style={HEAD}>Run</th>
              <th style={HEAD}>Status</th>
              <th style={HEAD}>Verdict</th>
              <th style={HEAD}>Delivery</th>
              <th style={HEAD}>Evidence</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const view = row.runId !== null ? runsById.get(row.runId) : undefined;
              const frameNode = row.kind === 'node' ? live?.nodes[row.label] : undefined;
              const status = rowStatus(row, view, frameNode?.status);
              // Delivery, zero-fetch: the live DTO derivation (which reads the wire-carried
              // `session.delivery`) with the campaign's own daemon-joined url as the read-back
              // source — `resolveDelivery` re-validates the shape of both.
              const d = view !== undefined
                ? resolveDelivery(deliveryOf(view), row.delivery?.deliverUrl ?? null)
                : null;
              const href = d?.href ?? null;
              // The snapshot-only arm (archived / no longer listed) goes through the SAME
              // shape gate as every other PR claim (delivery.ts's one invariant).
              const snapshotHref =
                view === undefined
                  && row.delivery !== null
                  && typeof row.delivery.deliverUrl === 'string'
                  && isPrUrl(row.delivery.deliverUrl)
                  ? row.delivery.deliverUrl
                  : null;
              const snapshotStranded = view === undefined && row.delivery?.delivery === 'stranded';
              const snapshotPushed = view === undefined && row.delivery?.delivery === 'pushed';
              const verdict = row.runId !== null ? verdicts[row.runId] : undefined;
              return (
                <tr
                  key={`${row.kind}:${row.label}`}
                  data-testid="campaign-ladder-row"
                  data-kind={row.kind}
                  data-node-id={row.kind === 'node' ? row.label : undefined}
                  {...(row.runId !== null ? { 'data-run-id': row.runId } : {})}
                  style={{ borderBottom: '1px solid var(--surface-raised)' }}
                >
                  <td style={CELL} className="wk-test-board-run">
                    {row.runId !== null ? (
                      <a
                        data-testid="campaign-run-link"
                        href={sessionPath(`run:${row.runId}`)}
                        onClick={(e) => { e.preventDefault(); navigate(sessionPath(`run:${row.runId!}`)); }}
                        className="wk-link wk-test-board-run-title"
                      >
                        {humanTitle(row.problem, 90)}
                      </a>
                    ) : (
                      <span className="wk-test-board-run-title">{humanTitle(row.problem, 90)}</span>
                    )}
                    {humanTitle(row.problem, 90) !== row.problem.trim() && (
                      <details data-testid="campaign-run-brief" className="wk-test-board-brief">
                        <summary className="wk-link">Show brief</summary>
                        <p>{row.problem}</p>
                      </details>
                    )}
                    {row.kind === 'attached' && (
                      <span
                        className="wk-tag"
                        title="Added to this test at launch; the test doesn't schedule or stop it."
                      >
                        Attached
                      </span>
                    )}
                  </td>
                  <td style={CELL}>
                    <Chip
                      testid="campaign-node-status"
                      label={status.label}
                      color={status.color}
                      extra={{ 'data-status-source': status.source }}
                      title={
                        frameNode?.prompt != null ? frameNode.prompt
                        : status.source === 'snapshot' ? 'status at last read — the run is not in the live list'
                        : undefined
                      }
                    />
                  </td>
                  <td style={CELL}>
                    {verdict === undefined ? (
                      <span style={{ color: 'var(--ink-dim)' }}>—</span>
                    ) : verdict.gate === null ? (
                      <Chip testid="campaign-verdict-chip" label="unreadable" color="var(--ink-dim)" title={verdict.unavailable ?? undefined} extra={{ 'data-satisfied': 'unknown' }} />
                    ) : (
                      <Chip
                        testid="campaign-verdict-chip"
                        label={
                          !verdict.gate.satisfied ? (verdict.gate.verdict ?? 'deny')
                          : verdict.gate.required ? (verdict.gate.verdict ?? 'pass')
                          : 'no requirement'
                        }
                        color={
                          !verdict.gate.satisfied ? 'var(--status-fail)'
                          : verdict.gate.required ? 'var(--status-done)'
                          : 'var(--ink-dim)'
                        }
                        title={verdict.gate.reason}
                        extra={{ 'data-satisfied': String(verdict.gate.satisfied) }}
                      />
                    )}
                  </td>
                  <td style={CELL} data-testid="campaign-run-delivery">
                    {href !== null || snapshotHref !== null ? (
                      <a
                        href={(href ?? snapshotHref)!}
                        target="_blank"
                        rel="noreferrer"
                        className="wk-link"
                      >
                        {DELIVERY_LABEL['pr-open']}
                      </a>
                    ) : snapshotStranded ? (
                      <span style={{ color: 'var(--status-gate)' }}>{DELIVERY_LABEL['stranded']}</span>
                    ) : snapshotPushed ? (
                      <span style={{ color: 'var(--ink-body)' }}>{DELIVERY_LABEL['pushed']}</span>
                    ) : (
                      <span style={{ color: d !== null && d.claim === 'failed' ? 'var(--status-fail)' : 'var(--ink-dim)' }} title={d?.reason ?? undefined}>
                        {d !== null && DELIVERY_LABEL[d.claim] !== '' ? DELIVERY_LABEL[d.claim] : '—'}
                      </span>
                    )}
                  </td>
                  <td style={CELL}>
                    {row.runId !== null ? (
                      <button
                        type="button"
                        data-testid="campaign-evidence-link"
                        onClick={() => void downloadRunEvidence(row.runId!)}
                        className="wk-link"
                      >
                        Download
                      </button>
                    ) : (
                      <span style={{ color: 'var(--ink-dim)' }}>—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
