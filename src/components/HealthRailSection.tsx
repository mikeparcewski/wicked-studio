import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { getDiagnostics, isDiagnosticsUnsupported } from '../api/diagnostics.js';
import type { SeatRecord } from '../api/seatRecord.js';
import type { DiagnosticsGovernance, DiagnosticsGovernanceFinding, RosterSeat } from '../api/types.js';
import { coachSeat, recordsByCli, seatWeekLine, type CoachMove } from '../board/seatCoaching.js';
import { useSeatWeek, type MoveState, type SeatWeekRead } from '../hooks/useSeatWeek.js';
import { useConnectionStore } from '../store/connection.js';
import { setCachedRoster, subscribeRoster } from '../store/rosterCache.js';
import { SignInPanel } from './SignInPanel.js';
import { signInLapsed } from '../board/deskModel.js';
import { useDisplayPath } from '../hooks/useHomePath.js';

/**
 * The rail-foot health section (DES-FEEDBACK-003 §6.2, slice O): the operator —
 * "move health down to where settings was and behaving the same (just with it's
 * health registry)". The dress is the slice-A SettingsRailSection VERBATIM
 * (collapsed by default, chevron rotates 90°, header `--ink-muted` closed /
 * `--ink-high` open) in the rail-bottom slot Settings vacated when it became a
 * primary heading (§2.1/§8.1) — with `♥ Health` in place of `⚙ Settings`.
 *
 * Expanded contents are THE HEALTH REGISTRY: the two chrome check rows
 * (WebSocket / API server — CheckRow + the `getHealth()` fetch moved verbatim
 * from the retired AppChrome popover, §8.2) plus one row per council seat off
 * `GET /roster` (`display_name`, `health: SeatHealth`, `signed_in` —
 * routes.ts:308, crew#274).
 *
 * Fetch discipline (EC30): `GET /health` and `GET /roster` fire ON EXPAND — a
 * gesture, like the popover this replaces; never on mount, never on a timer.
 * Collapsing keeps the answers (the summary dot reads them); re-expanding
 * refetches (staleness by gesture, §6.3).
 *
 * `health` is OPTIONAL on the wire (additive, absent on a daemon predating
 * crew#274): an absent `health` renders a dim `·` glyph and no message — never
 * a fabricated "active".
 *
 * GOVERNANCE (studio#246, crew#495 / F-022): the same expand also reads
 * `GET /diagnostics` and renders its `governance` block as a third registry
 * group — the store the engine's emit seam writes to (path + which rule chose
 * it), the record counts (`null` = "engine cannot count", never 0), the folded
 * dead-letter outbox (count, by type / by reason, the timestamp range,
 * `truncated`, the pre-fix HOME outbox) and every finding as a severity-styled
 * row whose message carries the `wicked-crew governance replay …` recipe.
 * Null-safe by construction: a daemon predating the block (no `governance`
 * key, or no `/diagnostics` at all) renders one honest "not reported" row; a
 * daemon reporting `store: null` is NOT shown as governed — that is the
 * `governance.store` error row. The header heart/dot fold the findings in:
 * an error finding (or a null store) reads unhealthy, a warning degraded.
 */

interface HealthInfo {
  status: string;
  version: string;
  ping: string;
}

/** Moved verbatim from the retired AppChrome popover (§6.2/§8.2). */
function CheckRow({ label, ok, detail, since, testId, state, action }: {
  label: string; ok: boolean | null; detail: string;
  /** studio#280 item 2: the clock the probe SETTLED at — a timestamped "checked HH:MM:SS" so an
   *  answer is never mistaken for a probe still running (its own span: the detail stays verbatim). */
  since?: number | undefined;
  testId?: string;
  state?: string;
  /** An inline move for a row that cannot settle on its own (the re-probe). */
  action?: { label: string; testId: string; onClick: () => void };
}): React.ReactElement {
  const icon = ok === null ? '·' : ok ? '✓' : '✗';
  const color = ok === null ? 'var(--ink-dim)' : ok ? 'var(--status-run)' : 'var(--status-fail)';
  return (
    <div data-testid={testId} data-state={state} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: '5px' }}>
      <span style={{ width: '12px', fontSize: 'var(--text-xs)', color, fontFamily: 'var(--font-mono)', flexShrink: 0 }}>{icon}</span>
      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-body)', fontFamily: 'var(--font-mono)', flex: 1 }}>{label}</span>
      <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--ink-dim)', fontFamily: 'var(--font-mono)' }}>{detail}</span>
      {since !== undefined && (
        <span data-testid="rail-probe-checked" data-at={since} title="when this probe last answered" style={{ fontSize: 'var(--text-2xs)', color: 'var(--ink-dim)', fontFamily: 'var(--font-mono)', opacity: 0.8 }}>
          checked {clockWord(since)}
        </span>
      )}
      {action !== undefined && (
        <button
          type="button"
          data-testid={action.testId}
          onClick={action.onClick}
          style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', fontSize: 'var(--text-2xs)', fontFamily: 'var(--font-mono)', color: 'var(--ink-muted)', textDecoration: 'underline', cursor: 'pointer' }}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

/** HH:MM:SS of a settled probe — locale-free so the row reads the same everywhere. */
function clockWord(at: number): string {
  return new Date(at).toTimeString().slice(0, 8);
}

/**
 * studio#280 item 2: how long a probe may read "checking…" before the row says it has NOT
 * answered. RC1 saw all three rows stuck on "checking…" 2.5 s after the expand while the daemon's
 * /health answered in < 50 ms — a request that never settles must not look like one in flight.
 */
export const PROBE_DEADLINE_MS = 4000;

/** The words a probe past its deadline wears — not an error (nothing answered), not "checking…". */
export function probeOverdueWord(deadlineMs: number): string {
  const span = deadlineMs < 1000 ? `${deadlineMs} ms` : `${Math.round(deadlineMs / 1000)} s`;
  return `no answer after ${span} — still waiting`;
}

const EXCERPT_CH = 40;

/**
 * What a signed-out seat MEANS (acceptance finding F-2R2-009): the roster's `signed_in` is the
 * daemon's cheap file/env heuristic — "never proof the credential still works", and never proof
 * the seat cannot answer without one: the phase2-r2 rig saw opencode read `signed_in:false` and
 * still answer a chat on its provider free tier. So the rail must neither wear a green ✓ over
 * "active · signed out" as if nothing followed from it, nor assert an engine rule the wire does
 * not carry. Today's roster (api-types 0.33.0) has no eligibility field, so the row states the
 * OBSERVATION and HEDGES the consequence ("councils may bench this seat"). crew#533 (api-types
 * 0.35.0) adds `auth` (`signed_in | signed_out | not_required | unknown`), `free_tier`,
 * `council_eligible` and `council_ineligible_reason` — read off the seat when a daemon sends
 * them (`seatStandingWord`), so a daemon that SAYS what a council would do is believed.
 */
export const SIGNED_OUT_DETAIL = 'signed out — councils may bench this seat';
export const SIGNED_OUT_TITLE =
  'The daemon\'s file/env check saw no sign-in for this seat. A seat that cannot authenticate fails at spawn '
  + 'and a council benches it — but a provider free tier may still answer; the roster cannot tell yet. '
  + 'Sign in from Settings.';

/** The roster's word on one seat's standing, read for what the WIRE says (never inferred). */
export type SeatStanding =
  | { kind: 'signed-in'; detail: string; title: string | null; auth: string | null }
  | { kind: 'no-sign-in-needed'; detail: string; title: string | null; auth: string | null }
  | { kind: 'signed-out'; detail: string; title: string; auth: string | null }
  | { kind: 'ineligible'; detail: string; title: string; auth: string | null }
  | { kind: 'unknown'; detail: null; title: null; auth: string | null };

export function seatStandingWord(seat: RosterSeat): SeatStanding {
  const bag = seat as Record<string, unknown>;
  const auth = typeof bag['auth'] === 'string' ? (bag['auth'] as string) : null;
  const eligible = bag['council_eligible'];
  const reason = typeof bag['council_ineligible_reason'] === 'string' ? (bag['council_ineligible_reason'] as string) : '';
  const tier = typeof bag['free_tier'] === 'string' ? (bag['free_tier'] as string) : '';
  // The daemon SAYS a council would not seat it — its reason, its words (crew#533).
  if (eligible === false) {
    return { kind: 'ineligible', detail: `not council-eligible — ${reason !== '' ? reason : 'the daemon says a council would not seat it'}`, title: reason !== '' ? reason : 'the daemon reports this seat as not council-eligible', auth };
  }
  if (auth === 'not_required') {
    return { kind: 'no-sign-in-needed', detail: `no sign-in needed${tier !== '' ? ` (${tier})` : ''}`, title: tier !== '' ? `answers on its provider free tier: ${tier}` : null, auth };
  }
  if (auth === 'signed_in' || seat.signed_in === true) return { kind: 'signed-in', detail: 'signed in', title: null, auth };
  if (auth === 'signed_out' || seat.signed_in === false) {
    return eligible === true
      ? { kind: 'signed-out', detail: 'signed out — still council-eligible', title: 'No sign-in observed, and the daemon still reports the seat as council-eligible.', auth }
      : { kind: 'signed-out', detail: SIGNED_OUT_DETAIL, title: SIGNED_OUT_TITLE, auth };
  }
  return { kind: 'unknown', detail: null, title: null, auth };
}

/** One registry row (§6.2's anatomy): glyph, name, the honest detail. */
function SeatRow({ seat, onSignIn }: { seat: RosterSeat; onSignIn?: (seat: RosterSeat) => void }): React.ReactElement {
  const h = seat.health;
  const standing = seatStandingWord(seat);
  const hedged = standing.kind === 'signed-out' || standing.kind === 'ineligible';
  // Absent health (a daemon predating crew#274) is UNKNOWN — a dim `·`, no
  // message, never a fabricated "active" (§6.2). An ACTIVE seat with no sign-in
  // observed (or one the daemon calls ineligible) is reachable but in question:
  // the `!` in gate-amber, not a green ✓ (F-2R2-009).
  const glyph = h === undefined ? '·' : h.status === 'active' ? (hedged ? '!' : '✓') : '✗';
  const color = h === undefined
    ? 'var(--ink-dim)'
    : h.status === 'active' ? (hedged ? 'var(--status-gate)' : 'var(--status-run)') : 'var(--status-fail)';
  const message = h?.status === 'inactive' && h.message !== undefined ? h.message : null;
  const detail = message !== null
    ? message.length > EXCERPT_CH ? `${message.slice(0, EXCERPT_CH)}…` : message
    : [h?.status, standing.detail].filter((s): s is string => s != null).join(' · ');
  const detailColor = message !== null ? 'var(--status-fail)' : hedged ? 'var(--status-gate)' : 'var(--ink-dim)';
  return (
    <div
      data-testid="rail-seat-row"
      data-seat={seat.key}
      data-health={h?.status ?? 'unknown'}
      data-signed-in={seat.signed_in === true ? 'true' : seat.signed_in === false ? 'false' : 'unknown'}
      data-standing={standing.kind}
      {...(standing.auth !== null ? { 'data-auth': standing.auth } : {})}
      title={message ?? standing.title ?? undefined}
      style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: '5px' }}
    >
      <span style={{ width: '12px', fontSize: 'var(--text-xs)', color, fontFamily: 'var(--font-mono)', flexShrink: 0 }}>{glyph}</span>
      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-body)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
        {seat.display_name}
      </span>
      <span
        className="truncate"
        style={{ marginLeft: 'auto', fontSize: 'var(--text-2xs)', color: detailColor, fontFamily: 'var(--font-mono)' }}
      >
        {detail}
      </span>
      {/* Amendment 5, decision 5: wherever a seat is signed out, Sign in is one click away — not only
          when the week's record happens to show an auth bench. */}
      {onSignIn !== undefined && signInLapsed(seat) && (
        <button
          type="button"
          data-testid="rail-seat-signin"
          data-seat={seat.key}
          onClick={() => onSignIn(seat)}
          aria-label={`Sign in ${seat.display_name || seat.key}`}
          style={{ ...MONO_2XS, flexShrink: 0, padding: '0 6px', borderRadius: 'var(--radius-md)', border: '1px solid var(--status-gate-dim)', background: 'var(--status-gate-dim)', color: 'var(--status-gate)', cursor: 'pointer' }}
        >
          Sign in
        </button>
      )}
    </div>
  );
}

const MONO_2XS = { fontSize: 'var(--text-2xs)', fontFamily: 'var(--font-mono)' } as const;

/**
 * The seat's weekly 1:1 (Wave B, idea 9) under its registry row: the week's record on one line, then
 * the ONE coaching move — its consequence first, then the button that takes it. "No change needed"
 * has no button. The move's result replaces the button once it lands.
 */
function SeatWeek({ seat, record, move, state, onMove }: {
  seat: RosterSeat;
  record: SeatRecord | undefined;
  move: CoachMove;
  state: MoveState | undefined;
  onMove: () => void;
}): React.ReactElement {
  return (
    <div data-testid="rail-seat-week" data-seat={seat.key} style={{ paddingLeft: '20px', marginBottom: '6px', minWidth: 0 }}>
      <div data-testid="rail-seat-week-line" style={{ ...MONO_2XS, color: 'var(--ink-muted)', overflowWrap: 'anywhere' }}>
        {seatWeekLine(record)}
      </div>
      <div data-testid="rail-seat-move" data-kind={move.kind} data-seat={seat.key} style={{ marginTop: '2px' }}>
        {move.consequence === null ? (
          <div title={move.why} style={{ ...MONO_2XS, color: 'var(--ink-dim)' }}>
            {move.label}
          </div>
        ) : (
          <>
            <p data-testid="rail-seat-move-consequence" title={move.kind === 'route-away' ? move.rule.statement : undefined} style={{ ...MONO_2XS, margin: '0 0 3px', color: 'var(--ink-body)', overflowWrap: 'anywhere' }}>
              <span style={{ color: 'var(--status-gate)' }}>{move.why}.</span> {move.consequence}
            </p>
            {state?.status === 'done' || state?.status === 'error' ? (
              <p
                data-testid="rail-seat-move-result"
                data-status={state.status}
                style={{ ...MONO_2XS, margin: 0, color: state.status === 'done' ? 'var(--status-run)' : 'var(--status-fail)', overflowWrap: 'anywhere' }}
              >
                {state.note}
              </p>
            ) : (
              <button
                type="button"
                data-testid="rail-seat-move-button"
                disabled={state?.status === 'busy'}
                onClick={onMove}
                className="rounded px-1.5 py-0.5"
                style={{ ...MONO_2XS, color: 'var(--ink-high)', background: 'var(--surface-raised)', border: '1px solid var(--surface-raised)', cursor: state?.status === 'busy' ? 'wait' : 'pointer' }}
              >
                {move.label} ›
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** The window caption under the seats header: what the week covers, or why there is no week. */
function weekCaption(week: SeatWeekRead): { text: string; color: string } | null {
  if (week.kind === 'loading') return { text: 'this week: checking…', color: 'var(--ink-dim)' };
  if (week.kind === 'absent') return { text: 'this week: not reported by this daemon — upgrade wicked-crew', color: 'var(--ink-dim)' };
  if (week.kind === 'error') return { text: `this week: unavailable — ${week.message}`, color: 'var(--status-fail)' };
  const r = week.record;
  const to = new Date(r.until).toISOString().slice(0, 10);
  return {
    text: `last ${r.days} days to ${to} · ${r.runsRead} run${r.runsRead === 1 ? '' : 's'} read${r.truncated ? ' (capped: oldest skipped)' : ''}`,
    color: 'var(--ink-dim)',
  };
}

/** What the expand learned about governance (studio#246). */
type GovernanceRead =
  | { kind: 'loading' }
  | { kind: 'absent'; why: 'no-route' | 'no-block' }
  | { kind: 'error'; message: string }
  | { kind: 'ok'; governance: DiagnosticsGovernance };

const FINDING_COLOR: Record<DiagnosticsGovernanceFinding['severity'], string> = {
  error: 'var(--status-fail)',
  warning: 'var(--status-gate)',
  // api-types 0.35.0 (crew#533) widened the union with `info` — a disclosed fact, not a warning.
  info: 'var(--ink-muted)',
};

/** Sub-rows under a check row: `label · value`, dim mono. */
function DetailLine({ label, value, color, testId }: { label: string; value: string; color?: string; testId?: string }): React.ReactElement {
  return (
    <div data-testid={testId} style={{ display: 'flex', gap: 'var(--space-2)', paddingLeft: '20px', marginBottom: '3px', minWidth: 0 }}>
      <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--ink-dim)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>{label}</span>
      <span className="truncate" title={value} style={{ fontSize: 'var(--text-2xs)', color: color ?? 'var(--ink-muted)', fontFamily: 'var(--font-mono)', minWidth: 0 }}>{value}</span>
    </div>
  );
}

function tally(rec: Record<string, number>): string {
  const entries = Object.entries(rec);
  return entries.length === 0 ? 'none' : entries.map(([k, n]) => `${k} ×${n}`).join(' · ');
}

function stamp(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19) + 'Z';
}

/** The governance registry group — one CheckRow per question, the findings as banners. */
function GovernanceRows({ read, overdue = 0 }: { read: GovernanceRead; /** the probe deadline (ms) once passed, 0 while inside it */ overdue?: number }): React.ReactElement {
  const showPath = useDisplayPath();
  if (read.kind === 'loading') {
    return <CheckRow label="governance" ok={null} detail={overdue ? probeOverdueWord(overdue) : 'checking…'} testId="rail-governance-probe" state={overdue ? 'overdue' : 'checking'} />;
  }
  if (read.kind === 'error') {
    return (
      <div data-testid="rail-governance" data-state="error">
        <CheckRow label="governance" ok={false} detail="unreachable" />
        <DetailLine testId="rail-governance-error" label="why" value={read.message} color="var(--status-fail)" />
      </div>
    );
  }
  if (read.kind === 'absent') {
    return (
      <div data-testid="rail-governance" data-state="absent" data-why={read.why}>
        <CheckRow label="governance" ok={null} detail="not reported by this daemon" />
        <DetailLine label="why" value={read.why === 'no-route' ? 'no /diagnostics route — upgrade wicked-crew' : 'no governance block on /diagnostics — upgrade wicked-crew to see where governance events land'} />
      </div>
    );
  }
  const g = read.governance;
  const dl = g.deadletters;
  const errors = g.findings.filter((f) => f.severity === 'error').length;
  const state = g.store === null || errors > 0 ? 'error' : g.findings.length > 0 ? 'warning' : 'ok';
  // `total` and `sinceBoot` are independently nullable — each field states itself.
  const records = [
    g.records.total === null ? 'total: engine cannot count' : `${g.records.total} record${g.records.total === 1 ? '' : 's'}`,
    g.records.sinceBoot === null ? null : `${g.records.sinceBoot} since boot`,
  ].filter((x): x is string => x !== null).join(' · ');
  const range =
    dl.oldestTs !== null && dl.newestTs !== null ? `${stamp(dl.oldestTs)} → ${stamp(dl.newestTs)}` : null;
  return (
    <div data-testid="rail-governance" data-state={state} data-deadletters={dl.count} data-store={g.store === null ? 'none' : g.store.source}>
      {g.store === null ? (
        <CheckRow label="store" ok={false} detail="none resolved — emits dead-letter" />
      ) : (
        <>
          <CheckRow label="store" ok detail={`via ${g.store.source}`} />
          <DetailLine testId="rail-governance-store-path" label="path" value={showPath(g.store.path)} />
        </>
      )}
      <CheckRow label="records" ok={g.records.total === null && g.records.sinceBoot === null ? null : true} detail={records} />
      <CheckRow
        label="dead letters"
        ok={dl.count === 0}
        detail={dl.count === 0 ? 'none' : `${dl.count}${dl.truncated ? '+' : ''}`}
      />
      {dl.count > 0 && (
        <>
          <DetailLine testId="rail-governance-by-type" label="by type" value={tally(dl.byType)} />
          <DetailLine testId="rail-governance-by-reason" label="by reason" value={tally(dl.byReason)} />
          <DetailLine
            testId="rail-governance-range"
            label="when"
            value={
              (range ?? 'no timestamps') +
              (dl.untimestamped > 0 ? ` · ${dl.untimestamped} untimestamped` : '') +
              (dl.truncated ? ' · fold truncated at its size cap — count is a floor' : '')
            }
          />
        </>
      )}
      {dl.path !== null && <DetailLine testId="rail-governance-outbox" label="outbox" value={showPath(dl.path)} />}
      {dl.legacyOutbox !== null && (
        <DetailLine testId="rail-governance-legacy" label="legacy outbox" value={`${showPath(dl.legacyOutbox.path)} · ${dl.legacyOutbox.bytes} bytes`} color="var(--status-gate)" />
      )}
      {g.findings.map((f, i) => (
        <p
          key={`${f.kind}-${i}`}
          data-testid="rail-governance-finding"
          data-kind={f.kind}
          data-severity={f.severity}
          style={{
            margin: '2px 0 5px', padding: '4px 8px', borderLeft: `2px solid ${FINDING_COLOR[f.severity]}`,
            background: 'var(--surface-raised)', borderRadius: 'var(--radius-sm)',
            fontSize: 'var(--text-2xs)', fontFamily: 'var(--font-mono)', color: 'var(--ink-body)',
            overflowWrap: 'anywhere', whiteSpace: 'pre-wrap',
          }}
        >
          <span style={{ color: FINDING_COLOR[f.severity], fontWeight: 'var(--weight-bold)' }}>{f.severity} · {f.kind}</span>
          {' — '}
          {f.message}
        </p>
      ))}
    </div>
  );
}

interface Props {
  /** Controlled by the rail so the chrome dot can expand this section (§6.2). */
  open: boolean;
  onToggle: () => void;
  /** The collapsed / icon nav: the header is the heart icon alone (aria-label "Health") and
   *  the registry opens as a flyout beside the rail. Same state, same fetches, same rows. */
  compact?: boolean;
  /** studio#280 item 2: how long a probe may read "checking…" (tests shorten it). */
  probeDeadlineMs?: number;
}

export function HealthRailSection({ open, onToggle, compact = false, probeDeadlineMs = PROBE_DEADLINE_MS }: Props): React.ReactElement {
  const wsStatus = useConnectionStore((s) => s.status);
  const [health, setHealth] = useState<HealthInfo | null>(null);
  /** The rejected probe's own sentence (`null` = not rejected) — the row shows WHY, never a bare "unreachable". */
  const [healthError, setHealthError] = useState<string | null>(null);
  /** When the /health probe last SETTLED (answer or rejection); `null` until it has. */
  const [healthCheckedAt, setHealthCheckedAt] = useState<number | null>(null);
  /** studio#280 item 2: the current expand's probes have outlived the deadline without settling. */
  const [overdue, setOverdue] = useState(false);
  /** Whether the shown /health and /roster answers belong to THIS expand (false = kept from an
   *  earlier one): a kept answer past the deadline is said to be stale, never passed off as fresh. */
  const [healthFresh, setHealthFresh] = useState(false);
  const [rosterFresh, setRosterFresh] = useState(false);
  /** Bumped by "check again" — re-runs the expand's probes without a collapse. */
  const [reprobe, setReprobe] = useState(0);
  const [roster, setRoster] = useState<RosterSeat[] | null>(null);
  const [rosterError, setRosterError] = useState(false);
  const [governance, setGovernance] = useState<GovernanceRead>({ kind: 'loading' });
  // Wave B, idea 9: the seats' week, read on the same expand gesture.
  const { week, moves, apply, markOpened } = useSeatWeek(open);
  const [signIn, setSignIn] = useState<RosterSeat | null>(null);
  // Amendment 5: a roster re-read anywhere (the sign-in panel's "check again" on the Desk or in
  // Helpers) refreshes this registry too — the rows clear without another expand.
  useEffect(() => subscribeRoster((r) => { setRoster(r); setRosterError(false); }), []);
  const weekRecords = week.kind === 'ok' ? recordsByCli(week.record) : null;
  /** The expand generation a probe belongs to — a completion from an earlier expand (or an
   *  earlier "check again") must not overwrite a later one: the findings drive the heart and the
   *  dot, and a slow /health answer landing over a fresh one would read as settled when it is not. */
  const probeGen = useRef(0);
  const ref = useRef<HTMLDivElement>(null);
  // Unmount retires every in-flight probe: its completion must not reach a setter (codex on the
  // #280 PR). Unmount only — a collapse keeps the generation so an answer still landing can feed
  // the summary dot, exactly as before.
  useEffect(() => () => { probeGen.current++; }, []);

  // EC30: the expand IS the fetch gesture — one GET /health + one GET /roster
  // per expansion (the retired popover's exact `[open]` effect, moved); the
  // answers survive a collapse so the summary dot can keep reading them.
  // studio#280 item 2: every probe SETTLES visibly — an answer stamps its clock, a rejection
  // shows its sentence, and a probe past `probeDeadlineMs` says it has not answered (with a
  // re-probe) instead of reading "checking…" forever.
  useEffect(() => {
    if (!open) return;
    const gen = ++probeGen.current;
    const live = (): boolean => probeGen.current === gen;
    setHealthError(null);
    setRosterError(false);
    setOverdue(false);
    setHealthFresh(false);
    setRosterFresh(false);
    let pending = 3;
    const settled = (): void => { if (live() && --pending === 0) setOverdue(false); };
    const deadline = setTimeout(() => { if (live() && pending > 0) setOverdue(true); }, probeDeadlineMs);
    // Through resolved promises so a client that cannot serve a read at all (a partial mock, a
    // missing export) becomes the honest error row, not a throw out of the effect.
    Promise.resolve()
      .then(() => api.getHealth())
      .then((h) => { if (!live()) return; setHealth(h); setHealthCheckedAt(Date.now()); setHealthFresh(true); })
      .catch((e: unknown) => { if (!live()) return; setHealthError(e instanceof Error && e.message !== '' ? e.message : String(e)); setHealthCheckedAt(Date.now()); setHealthFresh(true); })
      .finally(settled);
    Promise.resolve()
      .then(() => api.getRoster())
      .then(({ roster: seats }) => { if (!live()) return; setRoster(seats); setCachedRoster(seats); setRosterFresh(true); })
      .catch(() => { if (live()) { setRosterError(true); setRosterFresh(true); } })
      .finally(settled);
    // studio#246: the same gesture reads the governance block. Absence is a
    // named state (older daemon), never an invented healthy store.
    setGovernance({ kind: 'loading' });
    // Only the CURRENT expand's answer lands (Copilot on #253): a slow earlier read
    // resolving after a re-expand would otherwise paint stale governance health.
    Promise.resolve()
      .then(() => getDiagnostics())
      .then((d) => {
        if (!live()) return;
        setGovernance(d.governance === undefined ? { kind: 'absent', why: 'no-block' } : { kind: 'ok', governance: d.governance });
      })
      .catch((e: unknown) => {
        if (!live()) return;
        setGovernance(isDiagnosticsUnsupported(e) ? { kind: 'absent', why: 'no-route' } : { kind: 'error', message: e instanceof Error ? e.message : String(e) });
      })
      .finally(settled);
    // Opened from the chrome dot: bring the foot into view (§6.2).
    ref.current?.scrollIntoView({ block: 'nearest' });
    return () => clearTimeout(deadline);
  }, [open, reprobe, probeDeadlineMs]);

  const wsDown = wsStatus === 'disconnected';
  const pillLabel = wsStatus === 'connected' ? 'Connected' : wsStatus === 'connecting' ? 'Connecting' : 'Disconnected';
  // The passive header summary (§6.2): fail-red if any seat is inactive or the
  // socket is down — the rail's foot says "look inside" without being opened.
  // studio#246: a null store or an error finding (dead letters, no store) is a
  // health failure — the board must not read "Governed" over it.
  const govErrors =
    governance.kind === 'ok' &&
    (governance.governance.store === null || governance.governance.findings.some((f) => f.severity === 'error'));
  const govWarnings =
    governance.kind === 'error' ||
    (governance.kind === 'ok' && governance.governance.findings.some((f) => f.severity === 'warning'));
  const sick = wsDown || govErrors || (roster ?? []).some((s) => s.health?.status === 'inactive');
  // The ♥ glyph is colored by health (nav-ui-tweaks): red when unhealthy (a
  // seat down or the socket gone), amber when degraded (socket still connecting,
  // a probe errored, or the API server not reporting ok), green otherwise. It
  // reads the same signals the section already computes — no new data source.
  // F-2R2-009 (review): the sign-in HEURISTIC is said per row (the amber `!`), never folded into the
  // heart — on a default roster most seats read `signed_in:false`, and a healthy daemon must not
  // wear a permanently degraded heart over a guess. Only a daemon-declared `council_eligible: false`
  // (crew#533, api-types 0.35.0) degrades it, because that IS the daemon's own word.
  const ineligible = (roster ?? []).some((s) => (s as Record<string, unknown>)['council_eligible'] === false && s.health?.status !== 'inactive');
  const degraded =
    wsStatus === 'connecting' || healthError !== null || rosterError || govWarnings || ineligible || (health !== null && health.status !== 'ok');
  const heartState = sick ? 'unhealthy' : degraded ? 'degraded' : 'healthy';
  const heartColor = sick
    ? 'var(--status-fail)'
    : degraded
      ? 'var(--status-gate)'
      : 'var(--status-run)';

  return (
    <div
      ref={ref}
      data-testid="rail-health-section"
      data-open={open}
      data-compact={compact || undefined}
      className={compact ? 'shrink-0 relative flex flex-col items-center pb-2 pt-1' : 'shrink-0 px-2 pb-2 pt-1 flex flex-col max-h-[45vh]'}
      style={{ borderTop: '1px solid var(--surface-raised)' }}
    >
      <button
        type="button"
        data-testid="rail-health-toggle"
        data-nav-dest="health"
        aria-expanded={open}
        aria-label={compact ? 'Health' : undefined}
        title={compact ? 'Health' : undefined}
        onClick={onToggle}
        className={compact
          ? 'w-9 h-9 relative flex items-center justify-center rounded-md transition-colors'
          : 'w-full flex items-center gap-2 px-1 py-1.5 text-left transition-colors'}
        style={{
          background: 'transparent',
          color: open ? 'var(--ink-high)' : 'var(--ink-muted)',
          fontSize: 'var(--text-xs)',
          fontFamily: 'var(--font-sans)',
          fontWeight: 'var(--weight-semi)',
        }}
      >
        {!compact && <span
          aria-hidden
          data-testid="rail-health-chevron"
          className="inline-block leading-none"
          style={{
            transition: 'transform var(--dur-fast)',
            transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
          }}
        >
          ›
        </span>}
        <span
          aria-hidden
          data-testid="rail-health-heart"
          data-health={heartState}
          style={{ color: heartColor }}
        >
          ♥
        </span>
        {!compact && <span>Health</span>}
        {sick && (
          <span
            data-testid="rail-health-summary-dot"
            aria-label="a health check needs attention"
            className={compact ? 'w-2 h-2 rounded-full absolute top-1 right-1' : 'w-2 h-2 rounded-full shrink-0 ml-auto'}
            style={{ background: 'var(--status-fail)' }}
          />
        )}
      </button>
      {open && (
        <div
          data-testid={compact ? 'rail-health-flyout' : undefined}
          className={compact
            ? 'fixed z-50 flex flex-col p-2 overflow-y-auto rounded-lg'
            : 'flex flex-col pt-0.5 px-1 overflow-y-auto min-h-0 flex-1'}
          style={compact
            ? {
                left: '64px', bottom: '40px', width: '300px', maxHeight: '60vh',
                background: 'var(--surface-overlay)', border: '1px solid var(--surface-raised)',
                boxShadow: 'var(--shadow-overlay)',
              }
            : undefined}
        >
          <CheckRow label="WebSocket" ok={wsStatus === 'connected'} detail={pillLabel} />
          {healthError !== null ? (
            <CheckRow label="API server" ok={false} detail={`unreachable — ${healthError}`} since={healthCheckedAt ?? undefined} testId="rail-api-server" state="error" />
          ) : health ? (
            // A kept answer past this expand's deadline is STALE: its clock says when, the state says so,
            // and the re-probe rides the row — never the old answer passed off as this expand's.
            <CheckRow
              label="API server" ok={health.status === 'ok'} detail={`${health.status} · ${health.version}`} since={healthCheckedAt ?? undefined}
              testId="rail-api-server" state={overdue && !healthFresh ? 'stale' : 'answered'}
              {...(overdue && !healthFresh ? { action: { label: 'check again', testId: 'rail-health-recheck', onClick: () => setReprobe((n) => n + 1) } } : {})}
            />
          ) : overdue ? (
            <CheckRow
              label="API server" ok={null} detail={probeOverdueWord(probeDeadlineMs)} testId="rail-api-server" state="overdue"
              action={{ label: 'check again', testId: 'rail-health-recheck', onClick: () => setReprobe((n) => n + 1) }}
            />
          ) : (
            <CheckRow label="API server" ok={null} detail="checking…" testId="rail-api-server" state="checking" />
          )}
          <p
            aria-hidden
            className="select-none"
            style={{ margin: '2px 0 5px', fontSize: 'var(--text-2xs)', color: 'var(--ink-dim)', fontFamily: 'var(--font-mono)' }}
          >
            ── seats ─────────────
          </p>
          {rosterError ? (
            <CheckRow label="seats" ok={false} detail="unreachable" />
          ) : roster === null ? (
            <CheckRow label="seats" ok={null} detail={overdue ? probeOverdueWord(probeDeadlineMs) : 'checking…'} testId="rail-seats-probe" state={overdue ? 'overdue' : 'checking'} />
          ) : (
            <>
              {overdue && !rosterFresh && (
                <CheckRow label="seats" ok={null} detail={`${probeOverdueWord(probeDeadlineMs)} · showing the last answer`} testId="rail-seats-probe" state="stale" />
              )}
              {(() => {
                const cap = weekCaption(week);
                return cap === null ? null : (
                  <p data-testid="rail-seat-week-window" data-state={week.kind} style={{ ...MONO_2XS, margin: '0 0 4px', color: cap.color, overflowWrap: 'anywhere' }}>
                    {cap.text}
                  </p>
                );
              })()}
              {roster.map((seat) => {
                const record = weekRecords?.get(seat.key);
                const move = week.kind === 'ok' ? coachSeat(record, seat, week.record) : null;
                return (
                  <div key={seat.key} data-testid="rail-seat" data-seat={seat.key}>
                    <SeatRow seat={seat} onSignIn={setSignIn} />
                    {move !== null && (
                      <SeatWeek
                        seat={seat}
                        record={record}
                        move={move}
                        state={moves[seat.key]}
                        onMove={() => {
                          if (move.kind === 'sign-in') {
                            setSignIn(seat);
                            markOpened(seat.key);
                          } else {
                            void apply(seat.key, move);
                          }
                        }}
                      />
                    )}
                  </div>
                );
              })}
            </>
          )}
          <p
            aria-hidden
            className="select-none"
            style={{ margin: '2px 0 5px', fontSize: 'var(--text-2xs)', color: 'var(--ink-dim)', fontFamily: 'var(--font-mono)' }}
          >
            ── governance ────────
          </p>
          <GovernanceRows read={governance} overdue={overdue ? probeDeadlineMs : 0} />
        </div>
      )}
      {/* Amendment 5, decision 5: the one plain-words sign-in panel — the command, Copy, check again.
          A re-read that finds the seat back refreshes this registry's rows too. */}
      {signIn !== null && (
        <SignInPanel seat={signIn} onClose={() => setSignIn(null)} onChecked={(r) => { setRoster(r); setRosterError(false); }} />
      )}
    </div>
  );
}
