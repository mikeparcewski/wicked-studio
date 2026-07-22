import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import type { RepoEntry, RosterSeat, SessionView, WorkflowDef } from '../api/types.js';

type SessionRange = 'last30' | 'last60' | 'all';

interface Props {
  runs: SessionView[];
  navigate: (path: string) => void;
}

const ACTIVE_STATUSES = new Set(['planning', 'distributing', 'executing', 'awaiting_human']);

function statusDotColor(status: string): string {
  if (status === 'completed') return '#3fb950';
  if (status === 'failed') return '#f85149';
  if (status === 'awaiting_human') return '#ffda19';
  if (ACTIVE_STATUSES.has(status)) return '#79c0ff';
  return 'rgba(230,237,243,0.25)';
}

// ── Shared style tokens ──────────────────────────────────────────────────────

const sectionLabel = {
  fontSize: '10px' as const,
  fontWeight: 600 as const,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.1em',
  color: 'rgba(230,237,243,0.4)',
  fontFamily: 'monospace',
  margin: 0,
};

const cardBase = {
  background: '#1b222e',
  border: '1px solid rgba(230,237,243,0.08)',
  borderRadius: '16px',
};

const monoText = { fontFamily: 'monospace' } as const;

export function Dashboard({ runs, navigate }: Props): React.ReactElement {
  const [repos, setRepos] = useState<RepoEntry[]>([]);
  const [roster, setRoster] = useState<RosterSeat[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowDef[]>([]);
  const [range, setRange] = useState<SessionRange>('last30');

  useEffect(() => {
    api.listRepos().then(({ repos: rs }) => setRepos(rs)).catch(() => {});
    api.getRoster().then(({ roster: rs }) => setRoster(rs)).catch(() => {});
    api.listWorkflows().then(({ workflows: ws }) => setWorkflows(ws)).catch(() => {});
  }, []);

  // ── Session range filter ───────────────────────────────────────────────────
  // runs is status-sorted (active first); slice(0, n) preserves active sessions
  // and uses a positional proxy for recency (no timestamp on AgentSession).
  const filteredRuns = range === 'last30'
    ? runs.slice(0, 30)
    : range === 'last60'
    ? runs.slice(0, 60)
    : runs;

  // ── Derived metrics ────────────────────────────────────────────────────────

  const completedRuns = filteredRuns.filter((v) => v.session.status === 'completed');
  const failedRuns = filteredRuns.filter((v) => v.session.status === 'failed');
  const activeRuns = filteredRuns.filter((v) => ACTIVE_STATUSES.has(v.session.status));

  const successDivisor = completedRuns.length + failedRuns.length;
  const successRate =
    successDivisor > 0 ? Math.round((completedRuns.length / successDivisor) * 100) : 0;

  const totalUnits = filteredRuns.reduce((s, v) => s + v.units.length, 0);
  const avgUnits =
    filteredRuns.length > 0 ? Math.round((totalUnits / filteredRuns.length) * 10) / 10 : 0;

  const gateDenials = filteredRuns.filter((v) => v.units.some((u) => u.status === 'rejected')).length;
  const activeClis = roster.filter((r) => r.enabled_for_council).length;

  // Sparkline: last 10 filtered runs, oldest → newest
  const sparklineRuns = filteredRuns.slice(Math.max(0, filteredRuns.length - 10));

  // Recent activity: last 5 runs in current (status-sorted) order, reversed for display
  const recentRuns = filteredRuns.slice(-5).reverse();

  // Gate approval rate across all filtered units
  const allUnits = filteredRuns.flatMap((v) => v.units);
  const rejectedCount = allUnits.filter((u) => u.status === 'rejected').length;
  const gateApprovalRate =
    allUnits.length > 0
      ? Math.round(((allUnits.length - rejectedCount) / allUnits.length) * 100)
      : 100;

  // CLI usage: % of filtered runs that include each CLI key in session.clis
  function cliUsagePct(key: string): number {
    if (filteredRuns.length === 0) return 0;
    const count = filteredRuns.filter((v) => v.session.clis.includes(key)).length;
    return Math.round((count / filteredRuns.length) * 100);
  }

  const cliPcts = roster.map((s) => cliUsagePct(s.key));
  const maxCliPct = Math.max(1, ...cliPcts);

  // Workflow usage: how many filtered runs used each workflow
  function workflowRunCount(wfId: string): number {
    return filteredRuns.filter((v) => v.session.workflow_id === wfId).length;
  }

  const noWorkflowRuns = workflows.every((wf) => workflowRunCount(wf.id) === 0);

  // Recent failures: last 3, newest first
  const recentFailures = failedRuns.slice(-3).reverse();

  // Recommendations threshold
  const hasEnoughForAnalysis = completedRuns.length >= 3;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={{ color: '#e6edf3', ...monoText }}>
      <div style={{ maxWidth: '1140px', margin: '0 auto', padding: '32px' }}>

        {/* ── 1. Header ─────────────────────────────────────────────────────── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            marginBottom: '36px',
            flexWrap: 'wrap',
            gap: '16px',
          }}
        >
          <div>
            <h1
              style={{
                fontSize: '22px',
                fontWeight: 600,
                color: '#e6edf3',
                margin: 0,
                ...monoText,
              }}
            >
              How are you doing?
            </h1>
            <p
              style={{
                fontSize: '11px',
                color: 'rgba(230,237,243,0.4)',
                marginTop: '5px',
                ...monoText,
              }}
            >
              wicked-crew studio · {filteredRuns.length} of {runs.length} sessions
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            {/* Session range filter */}
            <div
              style={{
                display: 'flex',
                borderRadius: '8px',
                overflow: 'hidden',
                border: '1px solid rgba(230,237,243,0.1)',
              }}
            >
              {([['last30', 'Top 30'], ['last60', 'Top 60'], ['all', 'All']] as [SessionRange, string][]).map(([r, label]) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRange(r)}
                  style={{
                    padding: '5px 12px',
                    fontSize: '11px',
                    fontWeight: 600,
                    ...monoText,
                    border: 'none',
                    cursor: 'pointer',
                    background: range === r ? 'rgba(230,237,243,0.1)' : 'transparent',
                    color: range === r ? '#e6edf3' : 'rgba(230,237,243,0.4)',
                    transition: 'background 0.15s',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => navigate('/runs/new')}
              style={{
                background: '#ffda19',
                color: '#0d1117',
                border: 'none',
                borderRadius: '8px',
                padding: '8px 18px',
                fontSize: '12px',
                fontWeight: 700,
                ...monoText,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                flexShrink: 0,
              }}
            >
              Do Work ▷
            </button>
          </div>
        </div>

        {/* ── 2. Key Metrics row ─────────────────────────────────────────────── */}
        <p style={{ ...sectionLabel, marginBottom: '12px' }}>Key Metrics</p>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(6, 1fr)',
            gap: '12px',
            marginBottom: '36px',
          }}
        >
          {/* Success Rate */}
          <div style={{ ...cardBase, padding: '16px 20px' }}>
            <p style={sectionLabel}>Success Rate</p>
            <p
              style={{
                fontSize: '30px',
                fontWeight: 600,
                color: '#3fb950',
                margin: '6px 0 8px',
                ...monoText,
              }}
            >
              {successDivisor > 0 ? `${successRate}%` : '—'}
            </p>
            {/* Sparkline: one dot per run */}
            <div style={{ display: 'flex', gap: '3px', alignItems: 'center', flexWrap: 'nowrap' }}>
              {sparklineRuns.length === 0 ? (
                <span style={{ fontSize: '10px', color: 'rgba(230,237,243,0.25)' }}>no data</span>
              ) : (
                sparklineRuns.map((v, i) => (
                  <span
                    key={`${v.session.id}-${i}`}
                    title={v.session.status}
                    style={{
                      display: 'inline-block',
                      width: '7px',
                      height: '7px',
                      borderRadius: '50%',
                      background: statusDotColor(v.session.status),
                      flexShrink: 0,
                    }}
                  />
                ))
              )}
            </div>
          </div>

          {/* Total Sessions */}
          <div style={{ ...cardBase, padding: '16px 20px' }}>
            <p style={sectionLabel}>Total Sessions</p>
            <div
              style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '6px 0 0', flexWrap: 'wrap' }}
            >
              <span
                style={{ fontSize: '30px', fontWeight: 600, color: '#e6edf3', ...monoText }}
              >
                {filteredRuns.length}
              </span>
              {activeRuns.length > 0 && (
                <span
                  style={{
                    fontSize: '10px',
                    fontWeight: 600,
                    background: 'rgba(121,192,255,0.13)',
                    color: '#79c0ff',
                    border: '1px solid rgba(121,192,255,0.28)',
                    borderRadius: '4px',
                    padding: '2px 6px',
                    ...monoText,
                  }}
                >
                  {activeRuns.length} active
                </span>
              )}
            </div>
          </div>

          {/* Avg Units/Session */}
          <div style={{ ...cardBase, padding: '16px 20px' }}>
            <p style={sectionLabel}>Avg Units/Session</p>
            <p
              style={{
                fontSize: '30px',
                fontWeight: 600,
                color: '#e6edf3',
                margin: '6px 0 0',
                ...monoText,
              }}
            >
              {filteredRuns.length > 0 ? avgUnits : '—'}
            </p>
          </div>

          {/* Gate Denials */}
          <div style={{ ...cardBase, padding: '16px 20px' }}>
            <p style={sectionLabel}>Gate Denials</p>
            <p
              style={{
                fontSize: '30px',
                fontWeight: 600,
                color: gateDenials > 0 ? '#f85149' : '#3fb950',
                margin: '6px 0 0',
                ...monoText,
              }}
            >
              {gateDenials}
            </p>
          </div>

          {/* Active CLIs */}
          <div style={{ ...cardBase, padding: '16px 20px' }}>
            <p style={sectionLabel}>Active CLIs</p>
            <p
              style={{
                fontSize: '30px',
                fontWeight: 600,
                color: activeClis > 0 ? '#ffda19' : 'rgba(230,237,243,0.45)',
                margin: '6px 0 0',
                ...monoText,
              }}
            >
              {activeClis}
            </p>
          </div>

          {/* Repos */}
          <div style={{ ...cardBase, padding: '16px 20px' }}>
            <p style={sectionLabel}>Repos</p>
            <p
              style={{
                fontSize: '30px',
                fontWeight: 600,
                color: '#e6edf3',
                margin: '6px 0 0',
                ...monoText,
              }}
            >
              {repos.length}
            </p>
          </div>
        </div>

        {/* ── 3. Recent Activity ─────────────────────────────────────────────── */}
        <p style={{ ...sectionLabel, marginBottom: '12px' }}>Recent Activity</p>
        <div style={{ marginBottom: '36px' }}>
          {recentRuns.length === 0 ? (
            <p
              style={{ fontSize: '12px', color: 'rgba(230,237,243,0.4)', ...monoText }}
            >
              No sessions yet — click Do Work to start
            </p>
          ) : (
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {recentRuns.map((v) => (
                <button
                  key={v.session.id}
                  type="button"
                  onClick={() => navigate(`/runs/${v.session.id}`)}
                  style={{
                    background: '#1b222e',
                    border: '1px solid rgba(230,237,243,0.10)',
                    borderRadius: '999px',
                    padding: '6px 14px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '7px',
                    cursor: 'pointer',
                    fontSize: '11px',
                    color: '#e6edf3',
                    ...monoText,
                  }}
                >
                  <span
                    style={{
                      display: 'inline-block',
                      width: '7px',
                      height: '7px',
                      borderRadius: '50%',
                      background: statusDotColor(v.session.status),
                      flexShrink: 0,
                    }}
                  />
                  <span
                    style={{
                      maxWidth: '200px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap' as const,
                    }}
                  >
                    {v.session.problem.length > 30
                      ? `${v.session.problem.slice(0, 30)}…`
                      : v.session.problem}
                  </span>
                  <span
                    style={{
                      color: 'rgba(230,237,243,0.32)',
                      fontSize: '10px',
                      flexShrink: 0,
                    }}
                  >
                    {v.session.id.slice(0, 6)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── 4. Session Analysis CTA ────────────────────────────────────────── */}
        <div
          style={{
            ...cardBase,
            borderLeft: '3px solid #ffda19',
            background: '#1a2030',
            padding: '24px 28px',
            marginBottom: '36px',
          }}
        >
          <p
            style={{
              fontSize: '13px',
              fontWeight: 600,
              color: '#e6edf3',
              margin: '0 0 8px',
              ...monoText,
            }}
          >
            Session Analysis
          </p>
          <p
            style={{
              fontSize: '12px',
              color: 'rgba(230,237,243,0.6)',
              ...monoText,
              margin: '0 0 16px',
              maxWidth: '620px',
              lineHeight: 1.6,
            }}
          >
            Compare success rates across workflows, CLIs, and gate configurations to see what's
            actually improving output quality.
          </p>
          {/* Mini-stat chips */}
          <div
            style={{
              display: 'flex',
              gap: '10px',
              alignItems: 'center',
              flexWrap: 'wrap',
              marginBottom: '18px',
            }}
          >
            {[
              `${filteredRuns.length} sessions analyzed`,
              `${filteredRuns.length > 0 ? avgUnits : 0} avg units`,
              `${gateApprovalRate}% gate approval rate`,
            ].map((chip) => (
              <span
                key={chip}
                style={{
                  fontSize: '10px',
                  fontWeight: 600,
                  ...monoText,
                  background: 'rgba(255,218,25,0.10)',
                  color: '#ffda19',
                  border: '1px solid rgba(255,218,25,0.22)',
                  borderRadius: '4px',
                  padding: '3px 9px',
                }}
              >
                {chip}
              </span>
            ))}
          </div>
          <button
            type="button"
            onClick={() => navigate('/runs/new')}
            style={{
              background: '#ffda19',
              color: '#0d1117',
              border: 'none',
              borderRadius: '6px',
              padding: '6px 16px',
              fontSize: '12px',
              fontWeight: 700,
              ...monoText,
              cursor: 'pointer',
            }}
          >
            Analyze →
          </button>
        </div>

        {/* ── 5. Utilization ─────────────────────────────────────────────────── */}
        <p style={{ ...sectionLabel, marginBottom: '12px' }}>Utilization</p>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '16px',
            marginBottom: '36px',
          }}
        >
          {/* CLIs */}
          <div style={{ ...cardBase, padding: '20px 24px' }}>
            <p style={{ ...sectionLabel, marginBottom: '14px' }}>CLIs</p>
            {roster.length === 0 ? (
              <p style={{ fontSize: '11px', color: 'rgba(230,237,243,0.4)', ...monoText }}>
                No CLIs configured
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {roster.map((seat, i) => {
                  const pct = cliPcts[i] ?? 0;
                  const barWidth = `${Math.round((pct / maxCliPct) * 100)}%`;
                  return (
                    <div key={seat.key}>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          marginBottom: '5px',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span
                            style={{
                              display: 'inline-block',
                              width: '7px',
                              height: '7px',
                              borderRadius: '50%',
                              background: seat.enabled_for_council
                                ? '#3fb950'
                                : 'rgba(230,237,243,0.18)',
                              flexShrink: 0,
                            }}
                          />
                          <span
                            style={{
                              fontSize: '12px',
                              color: '#e6edf3',
                              ...monoText,
                            }}
                          >
                            {seat.display_name}
                          </span>
                        </div>
                        <span
                          style={{
                            fontSize: '11px',
                            color: 'rgba(230,237,243,0.45)',
                            ...monoText,
                          }}
                        >
                          {filteredRuns.length > 0 ? `${pct}%` : '—'}
                        </span>
                      </div>
                      <div
                        style={{
                          height: '3px',
                          background: 'rgba(230,237,243,0.07)',
                          borderRadius: '2px',
                          overflow: 'hidden',
                        }}
                      >
                        <div
                          style={{
                            height: '100%',
                            width: barWidth,
                            background: seat.enabled_for_council
                              ? '#3fb950'
                              : 'rgba(230,237,243,0.18)',
                            borderRadius: '2px',
                            transition: 'width 0.3s',
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Workflows */}
          <div style={{ ...cardBase, padding: '20px 24px' }}>
            <p style={{ ...sectionLabel, marginBottom: '14px' }}>Workflows</p>
            {workflows.length === 0 ? (
              <p style={{ fontSize: '11px', color: 'rgba(230,237,243,0.4)', ...monoText }}>
                No workflows registered
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {workflows.map((wf) => {
                  const count = workflowRunCount(wf.id);
                  return (
                    <div
                      key={wf.id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '6px 0',
                        borderBottom: '1px solid rgba(230,237,243,0.05)',
                      }}
                    >
                      <span style={{ fontSize: '12px', color: '#e6edf3', ...monoText }}>
                        {wf.id}
                      </span>
                      <span
                        style={{
                          fontSize: '11px',
                          color: count > 0 ? '#79c0ff' : 'rgba(230,237,243,0.35)',
                          ...monoText,
                        }}
                      >
                        {count} run{count !== 1 ? 's' : ''}
                      </span>
                    </div>
                  );
                })}
                {noWorkflowRuns && (
                  <p
                    style={{
                      fontSize: '11px',
                      color: 'rgba(230,237,243,0.32)',
                      marginTop: '4px',
                      ...monoText,
                    }}
                  >
                    No workflow runs yet
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── 6. Debug ───────────────────────────────────────────────────────── */}
        <p style={{ ...sectionLabel, marginBottom: '12px' }}>Debug</p>
        <div style={{ ...cardBase, padding: '20px 24px', marginBottom: '36px' }}>
          {recentFailures.length === 0 ? (
            <span
              style={{
                display: 'inline-block',
                fontSize: '11px',
                fontWeight: 600,
                ...monoText,
                background: 'rgba(63,185,80,0.11)',
                color: '#3fb950',
                border: '1px solid rgba(63,185,80,0.24)',
                borderRadius: '4px',
                padding: '4px 10px',
              }}
            >
              No recent failures ✓
            </span>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {recentFailures.map((v) => (
                <div
                  key={v.session.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '10px 14px',
                    background: 'rgba(248,81,73,0.06)',
                    border: '1px solid rgba(248,81,73,0.14)',
                    borderRadius: '8px',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p
                      style={{
                        fontSize: '12px',
                        color: '#e6edf3',
                        ...monoText,
                        margin: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap' as const,
                      }}
                    >
                      {v.session.problem.length > 70
                        ? `${v.session.problem.slice(0, 70)}…`
                        : v.session.problem}
                    </p>
                    <p
                      style={{
                        fontSize: '10px',
                        color: 'rgba(230,237,243,0.32)',
                        ...monoText,
                        margin: '3px 0 0',
                      }}
                    >
                      {v.session.id.slice(0, 8)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => navigate(`/runs/${v.session.id}`)}
                    style={{
                      fontSize: '11px',
                      color: '#79c0ff',
                      ...monoText,
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      padding: 0,
                      flexShrink: 0,
                    }}
                  >
                    → View
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── 7. Recommendations ────────────────────────────────────────────── */}
        <p style={{ ...sectionLabel, marginBottom: '12px' }}>Recommendations</p>
        <div style={{ ...cardBase, padding: '20px 24px' }}>
          <p
            style={{
              fontSize: '12px',
              color: 'rgba(230,237,243,0.55)',
              ...monoText,
              margin: '0 0 16px',
              maxWidth: '580px',
              lineHeight: 1.6,
            }}
          >
            After running sessions, wicked analyzes patterns in gate decisions, unit failures, and
            output quality to recommend new skills and tool configurations.
          </p>
          <div
            style={{
              padding: '12px 16px',
              background: '#161c26',
              border: '1px solid rgba(230,237,243,0.07)',
              borderRadius: '8px',
              fontSize: '12px',
              color: 'rgba(230,237,243,0.48)',
              ...monoText,
              marginBottom: '16px',
            }}
          >
            {hasEnoughForAnalysis
              ? `${completedRuns.length} sessions available for analysis — click Analyze to generate recommendations`
              : 'Run session analysis first to generate recommendations'}
          </div>
          <button
            type="button"
            onClick={() => navigate('/workflows')}
            style={{
              fontSize: '11px',
              color: '#79c0ff',
              ...monoText,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 0,
              textDecoration: 'underline',
            }}
          >
            Create Skill →
          </button>
        </div>

      </div>
    </div>
  );
}
