import { useEffect, useMemo, useState } from 'react';
import { getCampaign, type CampaignDetail, type CampaignRun } from '../api/campaigns.js';
import { testingPath } from '../api/testing.js';
import { downloadRunEvidence } from '../api/client.js';
import { apiStatus } from '../api/errors.js';
import type { SessionView } from '../api/types.js';
import { useAcceptanceStore } from '../store/acceptance.js';
import { useCampaignsStore, type CampaignNodeLive } from '../store/campaigns.js';
import { deliveryOf, isPrUrl, resolveDelivery, DELIVERY_LABEL } from './delivery.js';
import { STATUS_STYLE } from './RunCard.js';
import { runShortId } from './runIdentity.js';

/**
 * The campaign scoreboard (TH-14, extends wicked-studio#27) — READ-ONLY: one surface that
 * groups a campaign's sibling runs. The ladder is one row per filed run (DES-CAMPAIGN-001
 * §4.4's table, deliberately not a graph — there is no edge data in this model to draw);
 * node status goes live off core's Campaign* `/ws` frames the moment the daemon relays them
 * (TH-9 — see `store/campaigns.ts` for the fold and the frame shapes), and falls back to the
 * live run list, then to the detail snapshot, in that order.
 *
 * ── THE WIRE RULES THIS SURFACE HOLDS ────────────────────────────────────────────────────────
 *  - The delivery rollup ("K of N siblings delivered") reads `session.delivery` off the run
 *    LIST wire (CREW-UX-8, crew#321) plus the server-resolved `prUrl` snapshot the detail
 *    payload carries (§4.3) — NEVER a per-run transcript fetch. Zero requests beyond the one
 *    `GET /campaigns/:id`.
 *  - Verdict chips are a per-run acceptance read (`GET /runs/:id/acceptance`) behind ONE
 *    explicit gesture (the MakeDashboard fan-out precedent): zero requests on render,
 *    exactly N on click, cached per run id forever after (`store/acceptance.ts`).
 *  - Evidence links download through the existing `GET /runs/:id/evidence` — on click only.
 *  - The cost column is an honest "—" until TH-20 folds per-node cost into the wire (the
 *    integration point is typed on `CampaignRun.cost`); flake/coverage trends need the
 *    TH-6 per-scenario flake history, which has no studio-reachable wire yet — named here so
 *    it is a known gap, not an invisible one.
 */

const terminal = (s: string | null): boolean =>
  s !== null && ['completed', 'failed', 'cancelled'].includes(s);

/** The node-frame status words, rendered with the closest run-status token. */
const NODE_STATUS_STYLE: Record<string, { label: string; color: string }> = {
  ready:          { label: 'Ready',          color: 'var(--ink-muted)' },
  started:        { label: 'Executing',      color: 'var(--status-run)' },
  awaiting_human: { label: 'Awaiting human', color: 'var(--status-gate)' },
  completed:      { label: 'Completed',      color: 'var(--status-done)' },
  failed:         { label: 'Failed',         color: 'var(--status-fail)' },
  blocked:        { label: 'Blocked',        color: 'var(--status-fail)' },
};

const CELL: React.CSSProperties = { padding: '8px 10px', verticalAlign: 'top' };
const HEAD: React.CSSProperties = {
  ...CELL,
  textAlign: 'left',
  color: 'var(--ink-dim)',
  fontSize: 'var(--text-xs)',
  fontWeight: 500,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
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

/**
 * One sibling's row-level facts, joined zero-fetch: live view (run list) over snapshot
 * (detail), Campaign* node fold over both for the status chip.
 */
function rowStatus(
  row: CampaignRun,
  view: SessionView | undefined,
  node: CampaignNodeLive | undefined,
): { label: string; color: string; source: 'frame' | 'live' | 'snapshot' | 'gone' } {
  if (node !== undefined) {
    const s = NODE_STATUS_STYLE[node.status] ?? { label: node.status, color: 'var(--ink-dim)' };
    return { ...s, source: 'frame' };
  }
  const status = view?.session.status ?? row.status;
  if (status === null) return { label: 'No longer held', color: 'var(--ink-dim)', source: 'gone' };
  const s = STATUS_STYLE[status] ?? { label: status, color: 'var(--ink-dim)' };
  return { ...s, source: view !== undefined ? 'live' : 'snapshot' };
}

interface Props {
  campaignId: string;
  /** The board's live run list — sibling rows render live status/delivery from it, zero-fetch. */
  runs: SessionView[];
  navigate: (path: string) => void;
}

export function CampaignScoreboard({ campaignId, runs, navigate }: Props): React.ReactElement {
  const [detail, setDetail] = useState<CampaignDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const live = useCampaignsStore((s) => s.live[campaignId]);
  const verdicts = useAcceptanceStore((s) => s.byRun);
  const loadVerdict = useAcceptanceStore((s) => s.load);
  const [verdictsRequested, setVerdictsRequested] = useState(false);

  // The one fetch this surface makes on its own: the campaign's per-run roll-up. Re-read when
  // a Campaign* frame for THIS campaign lands (`live` identity changes) — new nodes mean new
  // filed runs the snapshot does not hold yet. The run list itself arrives via props.
  useEffect(() => {
    let cancelled = false;
    setNotFound(false);
    setFailed(null);
    getCampaign(campaignId)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        if (apiStatus(e) === 404) setNotFound(true);
        else setFailed(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [campaignId, live]);

  const runsById = useMemo(() => {
    const m = new Map<string, SessionView>();
    for (const v of runs) m.set(v.session.id, v);
    return m;
  }, [runs]);

  /** Campaign* node fold joined by the runId the started/awaitingHuman frames carry. */
  const nodeByRun = useMemo(() => {
    const m = new Map<string, CampaignNodeLive>();
    for (const id of live?.nodeOrder ?? []) {
      const n = live?.nodes[id];
      if (n?.runId != null) m.set(n.runId, n);
    }
    return m;
  }, [live]);

  if (notFound) {
    return (
      <div data-testid="campaign-notfound" style={{ padding: '32px', color: 'var(--ink-muted)' }}>
        <p style={{ marginBottom: '12px' }}>
          No campaign is filed under <b style={{ color: 'var(--ink-high)' }}>{campaignId}</b> on
          this daemon — a campaign is minted by its first filed run, so this label either never
          launched one or lives on another daemon.
        </p>
        <button
          type="button"
          onClick={() => navigate(testingPath('campaigns'))}
          style={{ color: 'var(--status-run)', textDecoration: 'underline' }}
        >
          All campaigns
        </button>
      </div>
    );
  }
  if (failed !== null) {
    return (
      <div data-testid="campaign-load-failed" style={{ padding: '32px', color: 'var(--ink-muted)' }}>
        {failed}
      </div>
    );
  }
  if (detail === null) {
    return (
      <div data-testid="campaign-loading" style={{ padding: '32px', color: 'var(--ink-muted)' }}>
        Loading campaign {campaignId}…
      </div>
    );
  }

  const { campaign, counts } = detail;
  // §3.3 denominator honesty: `expected` set ⇒ a real denominator; unset ⇒ "so far" — two
  // DIFFERENT strings, never rendered identically, because one of them can grow.
  const progress =
    campaign.expected !== null
      ? `${counts.landed} of ${campaign.expected} landed`
      : `${counts.landed} of ${counts.filed} landed so far`;

  // The delivery rollup, strictly off wire-carried facts (never a transcript fetch): a
  // sibling counts as delivered when its live DTO's deliver phase is approved (state
  // 'delivered' — `session.delivery` is what upgrades the CLAIM to a linkable pr-open), or —
  // for a run the list no longer shows (archived/gone) — when the detail snapshot carries the
  // server-resolved prUrl (§4.3).
  const deliveredCount = detail.runs.filter((row) => {
    const view = runsById.get(row.runId);
    if (view !== undefined) return deliveryOf(view).state === 'delivered';
    return typeof row.prUrl === 'string' && isPrUrl(row.prUrl);
  }).length;

  const seg = [
    { n: counts.landed, color: 'var(--status-done)' },
    { n: counts.failed, color: 'var(--status-fail)' },
    { n: counts.awaitingHuman, color: 'var(--status-gate)' },
    { n: counts.running, color: 'var(--status-run)' },
    { n: counts.cancelled + counts.other, color: 'var(--ink-dim)' },
  ];
  const segTotal = Math.max(
    1,
    campaign.expected ?? counts.filed,
    seg.reduce((a, s) => a + s.n, 0),
  );

  return (
    <div data-testid="campaign-scoreboard" style={{ padding: '24px', maxWidth: '1100px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px', flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 'var(--text-xl)', color: 'var(--ink-high)', fontWeight: 600 }}>
          {campaign.title ?? campaign.id}
        </h1>
        {campaign.title !== null && (
          <span style={{ color: 'var(--ink-dim)', fontSize: 'var(--text-sm)' }}>{campaign.id}</span>
        )}
        {live?.status != null && (
          <Chip
            testid="campaign-live-status"
            label={live.status}
            color={
              live.status === 'completed' ? 'var(--status-done)'
              : live.status === 'paused' ? 'var(--status-gate)'
              : 'var(--status-fail)'
            }
          />
        )}
      </div>

      <div style={{ marginTop: '10px', display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
        <span data-testid="campaign-progress" style={{ color: 'var(--ink-high)', fontSize: 'var(--text-sm)' }}>
          {progress}
          {counts.archived > 0 && (
            <span style={{ color: 'var(--ink-dim)' }}> ({counts.archived} archived)</span>
          )}
        </span>
        <span data-testid="campaign-delivery-rollup" style={{ color: 'var(--ink-muted)', fontSize: 'var(--text-sm)' }}>
          {deliveredCount} of {detail.runs.length} siblings delivered
        </span>
      </div>

      <div
        aria-hidden
        style={{ marginTop: '8px', display: 'flex', height: '6px', borderRadius: '3px', overflow: 'hidden', background: 'var(--surface-raised)', maxWidth: '520px' }}
      >
        {seg.filter((s) => s.n > 0).map((s, i) => (
          <div key={i} style={{ width: `${(s.n / segTotal) * 100}%`, background: s.color }} />
        ))}
      </div>

      <div style={{ marginTop: '20px', display: 'flex', alignItems: 'center', gap: '12px' }}>
        <h2 style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-muted)', fontWeight: 500 }}>
          Sibling runs
        </h2>
        {!verdictsRequested ? (
          // Verdicts are a per-run read the list wire deliberately does not carry — loaded
          // behind ONE explicit gesture (zero fetches on render, exactly N on click).
          <button
            type="button"
            data-testid="campaign-load-verdicts"
            onClick={() => {
              setVerdictsRequested(true);
              for (const row of detail.runs) if (terminal(runsById.get(row.runId)?.session.status ?? row.status)) loadVerdict(row.runId);
            }}
            style={{ color: 'var(--status-run)', fontSize: 'var(--text-xs)', textDecoration: 'underline' }}
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
              <th style={HEAD} title="Per-node cost lands with campaign budget governance (TH-20); no daemon serves it yet">
                Cost
              </th>
            </tr>
          </thead>
          <tbody>
            {detail.runs.map((row) => {
              const view = runsById.get(row.runId);
              const node = nodeByRun.get(row.runId);
              const status = rowStatus(row, view, node);
              // Delivery, zero-fetch: the DTO derivation (which reads the wire-carried
              // `session.delivery`) with the detail's server-resolved prUrl as the read-back
              // source — `resolveDelivery` re-validates the shape of both.
              const d = view !== undefined
                ? resolveDelivery(deliveryOf(view), row.prUrl ?? null)
                : null;
              const href = d?.href ?? null;
              // The snapshot-only arm (archived / no longer listed) goes through the SAME
              // shape gate as every other PR claim (delivery.ts's one invariant).
              const snapshotHref =
                view === undefined && typeof row.prUrl === 'string' && isPrUrl(row.prUrl)
                  ? row.prUrl
                  : null;
              const verdict = verdicts[row.runId];
              return (
                <tr
                  key={row.runId}
                  data-testid="campaign-ladder-row"
                  data-run-id={row.runId}
                  style={{ borderBottom: '1px solid var(--surface-raised)' }}
                >
                  <td style={CELL}>
                    <button
                      type="button"
                      data-testid="campaign-run-link"
                      onClick={() => navigate(`/runs/${encodeURIComponent(row.runId)}`)}
                      style={{ color: 'var(--ink-high)', textAlign: 'left' }}
                      title={row.runId}
                    >
                      <span style={{ color: 'var(--ink-dim)', fontFamily: 'var(--font-mono)', marginRight: '8px' }}>
                        {runShortId(row.runId)}
                      </span>
                      {row.problem}
                    </button>
                    {row.archived && (
                      <span style={{ marginLeft: '8px', color: 'var(--ink-dim)', fontSize: 'var(--text-xs)' }}>
                        archived
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
                        node?.prompt != null ? node.prompt
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
                        style={{ color: 'var(--status-run)', textDecoration: 'underline' }}
                      >
                        {DELIVERY_LABEL['pr-open']}
                      </a>
                    ) : (
                      <span style={{ color: d !== null && d.claim === 'failed' ? 'var(--status-fail)' : 'var(--ink-dim)' }} title={d?.reason ?? undefined}>
                        {d !== null && DELIVERY_LABEL[d.claim] !== '' ? DELIVERY_LABEL[d.claim] : '—'}
                      </span>
                    )}
                  </td>
                  <td style={CELL}>
                    <button
                      type="button"
                      data-testid="campaign-evidence-link"
                      onClick={() => void downloadRunEvidence(row.runId)}
                      style={{ color: 'var(--status-run)', fontSize: 'var(--text-xs)', textDecoration: 'underline' }}
                    >
                      download
                    </button>
                  </td>
                  <td style={CELL} data-testid="campaign-cost-cell">
                    {typeof row.cost === 'number' ? (
                      <span style={{ color: 'var(--ink-high)' }}>${row.cost.toFixed(2)}</span>
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

      {/* Ladder rungs the frames announced but no filed run answers yet (a node whose run has
          not been dispatched, or whose filing the snapshot has not caught up with). */}
      {(live?.nodeOrder ?? []).filter((id) => {
        const n = live?.nodes[id];
        return n !== undefined && (n.runId === null || !detail.runs.some((r) => r.runId === n.runId));
      }).length > 0 && (
        <div style={{ marginTop: '12px' }} data-testid="campaign-pending-nodes">
          {(live?.nodeOrder ?? [])
            .filter((id) => {
              const n = live?.nodes[id];
              return n !== undefined && (n.runId === null || !detail.runs.some((r) => r.runId === n.runId));
            })
            .map((id) => {
              const n = live!.nodes[id]!;
              const s = NODE_STATUS_STYLE[n.status] ?? { label: n.status, color: 'var(--ink-dim)' };
              return (
                <div key={id} data-testid="campaign-pending-node" style={{ display: 'flex', gap: '10px', alignItems: 'center', padding: '4px 0' }}>
                  <Chip testid="campaign-node-status" label={s.label} color={s.color} extra={{ 'data-status-source': 'frame' }} title={n.prompt ?? undefined} />
                  <span style={{ color: 'var(--ink-muted)', fontSize: 'var(--text-sm)' }}>{id}</span>
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}
