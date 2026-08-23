import { useEffect, useMemo, useRef, useState } from 'react';
import type { SessionView } from '../api/types.js';
import type { BoardProject } from '../hooks/useBoardModel.js';
import type { Navigate } from '../hooks/useRoute.js';
import { modePath, projectPath } from '../hooks/useRoute.js';
import { gateOpenPath } from '../board/gateActions.js';
import type { OpenGate } from '../store/gates.js';
import type { LoggedEvent } from '../store/runtime.js';
import type { VersionLanding } from '../store/docThread.js';
import { outcomeOf, WINDOW_24H_MS } from '../board/metrics.js';

/**
 * The activity river (DES-FEEDBACK-003 §7.3, slice Q): the landing page's
 * graphical center — a per-project laned timeline of the last 24h. SVG-first,
 * no chart library (the §2.3 precedent at larger scale).
 *
 * THE HONEST CLOCKS, stated (§7.3): a span runs from a run's first observed
 * activity to its last — the membership `attached_at` the board already
 * fetched, extended by the runtime store's arrival-stamped frame clocks and
 * the backfilled failure tail (D3 step 2). Nothing is painted at an invented
 * time: a run with NO observed clock at all is excluded from the lanes and
 * counted in `data-unplaced` instead; live (non-terminal) runs end at `now`
 * and breach the now-edge with an arrowhead — the picture says "still moving"
 * without animation. The ONE loop is the waiting gate mark's pulse
 * (`.wk-river-gate-waiting`, reduced-motion honored in global.css).
 */

// Slice W (§5.3): the river's window IS the shared 24h window — one constant,
// so the lede's counts and the river's picture can never disagree on span.
export const RIVER_WINDOW_MS: number = WINDOW_24H_MS;
/** §7.3: at most this many lanes; the rest collapse into `({n} quiet)`. */
export const MAX_LANES = 6;

const TERMINAL: ReadonlySet<string> = new Set(['completed', 'failed', 'cancelled']);

export interface SpanMark {
  kind: 'gate' | 'fail';
  at: number;
  /** Gate marks only: still waiting on a human → the mark pulses. */
  waiting: boolean;
}

export interface RiverSpan {
  runId: string;
  projectId: string;
  problem: string;
  status: string;
  outcome: ReturnType<typeof outcomeOf>;
  /** First observed activity, clamped to the window's left edge. */
  start: number;
  /** Last observed activity; `now` for live (non-terminal) runs. */
  end: number;
  live: boolean;
  marks: SpanMark[];
}

export interface LaneMark { kind: 'doc' | 'demo'; at: number; version: number }

export interface RiverLane {
  projectId: string;
  name: string;
  spans: RiverSpan[];
  /** Version landings (docThread observations) on the project's own lane. */
  marks: LaneMark[];
}

export interface RiverModel {
  lanes: RiverLane[];
  /** Projects with no in-window activity (plus any beyond the lane cap). */
  quiet: number;
  /** Non-archived runs with NO observed clock at all — never painted (§7.3). */
  unplaced: number;
}

interface ModelInput {
  /** Board order (attention order, C3) — the lanes never re-sort it. */
  items: BoardProject[];
  runs: SessionView[];
  gates: Record<string, OpenGate>;
  logs: Record<string, LoggedEvent[]>;
  failedAt: Record<string, number>;
  landings: VersionLanding[];
  now: number;
}

/** Every observed clock a run has — attach, arrival-stamped frames, failure tail. */
function clocksOf(v: SessionView, attach: number | undefined,
                  logs: Record<string, LoggedEvent[]>, failedAt: Record<string, number>): number[] {
  const points: number[] = [];
  if (attach !== undefined) points.push(attach);
  for (const entry of logs[v.session.id] ?? []) points.push(entry.ts);
  const failed = failedAt[v.session.id];
  if (failed !== undefined) points.push(failed);
  return points;
}

/** The pure lane model — exported for the slice's unit tests. */
export function buildRiver({ items, runs, gates, logs, failedAt, landings, now }: ModelInput): RiverModel {
  const start = now - RIVER_WINDOW_MS;
  const lanes: RiverLane[] = [];
  let quiet = 0;

  for (const item of items) {
    const spans: RiverSpan[] = [];
    for (const v of item.runs) {
      if (v.session.archived_at != null) continue;
      const points = clocksOf(v, item.attachedAt[v.session.id], logs, failedAt);
      if (points.length === 0) continue; // clockless — counted below, never painted
      const live = !TERMINAL.has(v.session.status);
      const first = Math.min(...points);
      const last = live ? now : Math.max(...points);
      if (last < start || first > now) continue; // entirely outside the window
      const id = v.session.id;
      const marks: SpanMark[] = [];
      // Gate marks: the open gate's receivedAt (waiting → pulses), plus every
      // answered `awaitingHuman` the arrival-stamped log observed.
      const open = v.session.status === 'awaiting_human' ? gates[id] : undefined;
      if (open !== undefined) marks.push({ kind: 'gate', at: open.receivedAt, waiting: true });
      for (const entry of logs[id] ?? []) {
        // The live frame that OPENED the still-waiting gate landed in both
        // stores at the same arrival instant — skip its log twin, keep only
        // genuinely answered (earlier) gates as non-pulsing marks.
        if (entry.type === 'awaitingHuman' &&
            (open === undefined || Math.abs(entry.ts - open.receivedAt) > 2_000)) {
          marks.push({ kind: 'gate', at: entry.ts, waiting: false });
        }
      }
      const outcome = outcomeOf(v.session.status);
      // The failure ✗: the backfilled durable-log tail when the board has it;
      // otherwise the span's last OBSERVED point (the failure is known no
      // earlier than the last thing seen — still an observed clock).
      if (outcome === 'fail') marks.push({ kind: 'fail', at: failedAt[id] ?? last, waiting: false });
      spans.push({
        runId: id, projectId: item.project.id, problem: v.session.problem,
        status: v.session.status, outcome,
        start: Math.max(first, start), end: Math.min(last, now), live,
        marks: marks.filter((m) => m.at >= start && m.at <= now),
      });
    }
    const laneMarks: LaneMark[] = landings
      .filter((l) => l.projectId === item.project.id && l.at >= start && l.at <= now)
      .map((l) => ({ kind: l.kind === 'demo' ? 'demo' : 'doc', at: l.at, version: l.version }));
    if ((spans.length > 0 || laneMarks.length > 0) && lanes.length < MAX_LANES) {
      lanes.push({ projectId: item.project.id, name: item.project.name, spans, marks: laneMarks });
    } else {
      quiet += 1;
    }
  }

  // Unplaced honesty (§7.3): every non-archived run with no observed clock —
  // no attach (unfiled/orphaned) and no observed frame — is counted, not drawn.
  const attached = new Map<string, number>();
  for (const item of items) {
    for (const [id, at] of Object.entries(item.attachedAt)) attached.set(id, at);
  }
  const unplaced = runs.filter((v) =>
    v.session.archived_at == null &&
    clocksOf(v, attached.get(v.session.id), logs, failedAt).length === 0,
  ).length;

  return { lanes, quiet, unplaced };
}

// ── Geometry ──────────────────────────────────────────────────────────────────
const LANE_H = 20;
const QUIET_H = 14;
const AXIS_H = 16;
/** The now edge sits this far in from the right so live spans can BREACH it. */
const BREACH = 12;
const FALLBACK_W = 960;
/** Axis ticks, hours before now. 0 = the now edge (4 gridlines total). */
const TICKS = [18, 12, 6, 0] as const;

const LABEL: React.CSSProperties = {
  fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', color: 'var(--ink-muted)',
  height: `${LANE_H}px`, display: 'flex', alignItems: 'center',
  textDecoration: 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
};

interface Props {
  items: BoardProject[];
  runs: SessionView[];
  gates: Record<string, OpenGate>;
  logs: Record<string, LoggedEvent[]>;
  failedAt: Record<string, number>;
  landings: VersionLanding[];
  navigate: Navigate;
  /** Injectable clock for tests; defaults to the real one. */
  now?: number;
}

export function ActivityRiver({ items, runs, gates, logs, failedAt, landings, navigate, now }: Props): React.ReactElement {
  const at = now ?? Date.now();
  const model = useMemo(
    () => buildRiver({ items, runs, gates, logs, failedAt, landings, now: at }),
    [items, runs, gates, logs, failedAt, landings, at],
  );

  // True pixel coordinates (no viewBox stretch — marks keep their shape), the
  // board's own measure idiom: observe the plot column, fall back for jsdom.
  const plotRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = plotRef.current;
    if (el === null) return;
    const measure = (): void => setW(el.clientWidth);
    measure();
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      return () => ro.disconnect();
    }
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  const W = w || FALLBACK_W;
  const nowX = W - BREACH;
  const x = (t: number): number => ((t - (at - RIVER_WINDOW_MS)) / RIVER_WINDOW_MS) * nowX;
  const link = (path: string): { href: string; onClick: (e: React.MouseEvent) => void } => ({
    href: path,
    onClick: (e) => { e.preventDefault(); navigate(path); },
  });

  const lanesH = model.lanes.length * LANE_H;
  const H = lanesH + QUIET_H;

  return (
    <div
      data-testid="activity-river"
      data-question="What ran, when, and how did it end?"
      data-lanes={model.lanes.length}
      data-quiet={model.quiet}
      data-unplaced={model.unplaced}
      style={{ display: 'flex', gap: '10px', flex: 1, minWidth: 0, alignItems: 'flex-start' }}
    >
      {/* The label column — every project name is a real link to its dashboard. */}
      <div style={{ width: '148px', flexShrink: 0 }}>
        {model.lanes.map((lane) => (
          <a key={lane.projectId} {...link(projectPath(lane.projectId))}
             data-testid="river-lane-label" data-project-id={lane.projectId} style={LABEL}>
            {lane.name}
          </a>
        ))}
        <span data-testid="river-quiet" data-count={model.quiet}
              style={{ ...LABEL, height: `${QUIET_H}px`, color: 'var(--ink-dim)', fontSize: 'var(--text-2xs)' }}>
          ({model.quiet} quiet)
        </span>
        {/* §7.4's honesty word as the axis row's own label: what the window IS. */}
        <span style={{ ...LABEL, height: `${AXIS_H}px`, color: 'var(--ink-dim)', fontSize: 'var(--text-2xs)' }}>
          observed
        </span>
      </div>

      <div ref={plotRef} style={{ flex: 1, minWidth: 0 }}>
        <svg width="100%" height={H + AXIS_H} style={{ display: 'block' }} role="img"
             aria-label={`activity over the last 24h: ${model.lanes.length} projects with activity, ${model.quiet} quiet`}>
          {/* 4 dim gridlines (§7.3), the now edge last so live spans read against it. */}
          {TICKS.map((h) => (
            <line key={h} x1={x(at - h * 3_600_000)} x2={x(at - h * 3_600_000)} y1={0} y2={H}
                  stroke="var(--surface-raised)" strokeWidth={1} />
          ))}

          {model.lanes.map((lane, i) => {
            const top = i * LANE_H;
            const mid = top + LANE_H / 2;
            return (
              <g key={lane.projectId} data-testid="river-lane" data-project-id={lane.projectId}>
                {/* Lane separator (§7.5). */}
                <line x1={0} x2={W} y1={top + LANE_H} y2={top + LANE_H}
                      stroke="var(--surface-raised)" strokeWidth={1} />
                {lane.spans.map((span) => {
                  const x0 = x(span.start);
                  const x1 = Math.max(x(span.end), x0 + 2); // a point of activity stays visible
                  const body = span.live
                    ? 'var(--status-run-dim)'
                    : span.outcome === 'fail' ? 'var(--status-fail-dim)'
                    // Cancelled ≠ failed (J5/A5): neutral ink, no fail dress.
                    : span.outcome === 'cancelled' ? 'var(--ink-dim)'
                    : 'var(--status-done)';
                  return (
                    <a key={span.runId} {...link(modePath(span.projectId, 'build', span.runId))}
                       data-testid="river-span" data-run-id={span.runId}
                       data-live={span.live} data-outcome={span.outcome}>
                      <title>{`${span.problem} · ${span.status} · ${lane.name}`}</title>
                      <rect x={x0} y={mid - 4} width={x1 - x0} height={8} rx={2} fill={body} />
                      {/* Live: --status-run leading edge + the now-edge breach arrowhead. */}
                      {span.live && (
                        <>
                          <rect x={Math.max(x1 - 3, x0)} y={mid - 4} width={3} height={8} fill="var(--status-run)" />
                          <polygon data-testid="river-now-arrow"
                                   points={`${nowX},${mid - 5} ${nowX + 9},${mid} ${nowX},${mid + 5}`}
                                   fill="var(--status-run)" />
                        </>
                      )}
                    </a>
                  );
                })}
                {lane.spans.flatMap((span) =>
                  span.marks.map((mark, j) => {
                    const mx = x(mark.at);
                    const my = mid;
                    return mark.kind === 'gate' ? (
                      // ⏸-diamond in --status-gate; still waiting → the one loop.
                      <a key={`${span.runId}-g${j}`} {...link(gateOpenPath(span.projectId, span.runId))}
                         data-testid="river-gate-mark" data-run-id={span.runId} data-waiting={mark.waiting}>
                        <title>{`gate ${mark.waiting ? 'waiting' : 'answered'} · ${span.problem}`}</title>
                        <polygon
                          className={mark.waiting ? 'wk-river-gate-waiting' : undefined}
                          points={`${mx},${my - 5} ${mx + 5},${my} ${mx},${my + 5} ${mx - 5},${my}`}
                          fill="var(--status-gate)"
                        />
                      </a>
                    ) : (
                      // ✗ in --status-fail.
                      <a key={`${span.runId}-f${j}`} {...link(modePath(span.projectId, 'build', span.runId))}
                         data-testid="river-fail-mark" data-run-id={span.runId}>
                        <title>{`failed · ${span.problem}`}</title>
                        <line x1={mx - 4} y1={my - 4} x2={mx + 4} y2={my + 4} stroke="var(--status-fail)" strokeWidth={1.5} />
                        <line x1={mx - 4} y1={my + 4} x2={mx + 4} y2={my - 4} stroke="var(--status-fail)" strokeWidth={1.5} />
                      </a>
                    );
                  }),
                )}
                {lane.marks.map((mark, j) => {
                  const mx = x(mark.at);
                  return (
                    // ▤ / ▶ version-landed tick in --ink-muted (§7.3).
                    <a key={`v${j}`} {...link(projectPath(lane.projectId))}
                       data-testid="river-version-mark" data-kind={mark.kind}>
                      <title>{`${mark.kind === 'demo' ? 'demo' : 'doc'} v${mark.version} landed · ${lane.name}`}</title>
                      {mark.kind === 'demo' ? (
                        <polygon points={`${mx - 3},${mid - 8} ${mx + 4},${mid - 4.5} ${mx - 3},${mid - 1}`}
                                 fill="var(--ink-muted)" />
                      ) : (
                        <g stroke="var(--ink-muted)" strokeWidth={1} fill="none">
                          <rect x={mx - 3.5} y={mid - 8} width={7} height={7} />
                          <line x1={mx - 3.5} y1={mid - 5.5} x2={mx + 3.5} y2={mid - 5.5} />
                        </g>
                      )}
                    </a>
                  );
                })}
              </g>
            );
          })}

          {/* The compressed quiet lane: a dotted rest, never a grid of absence. */}
          <line x1={0} x2={W} y1={lanesH + QUIET_H / 2} y2={lanesH + QUIET_H / 2}
                stroke="var(--surface-raised)" strokeWidth={1} strokeDasharray="1 4" />

          {/* Axis labels — relative, mono, dim (§7.3). */}
          {TICKS.map((h) => (
            <text key={h} x={x(at - h * 3_600_000)} y={H + AXIS_H - 4}
                  textAnchor={h === 0 ? 'end' : 'middle'}
                  style={{ fontSize: 'var(--text-2xs)', fontFamily: 'var(--font-mono)' }}
                  fill="var(--ink-dim)">
              {h === 0 ? 'now' : `-${h}h`}
            </text>
          ))}
          <text x={x(at - RIVER_WINDOW_MS)} y={H + AXIS_H - 4} textAnchor="start"
                style={{ fontSize: 'var(--text-2xs)', fontFamily: 'var(--font-mono)' }}
                fill="var(--ink-dim)">
            -24h
          </text>
        </svg>
      </div>
    </div>
  );
}
