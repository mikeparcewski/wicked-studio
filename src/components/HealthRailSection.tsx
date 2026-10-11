import { useEffect, useRef, useState } from 'react';
import { seatLabel, seatRoleWord } from '../board/seatNames.js';
import { api } from '../api/client.js';
import { getDiagnostics, isDiagnosticsUnsupported } from '../api/diagnostics.js';
import { HEALTH_RECHECKED } from '../hooks/useRailHealthDot.js';
import type { SeatRecord } from '../api/seatRecord.js';
import type { DiagnosticsGovernance, DiagnosticsGovernanceFinding, RosterSeat } from '../api/types.js';
import { coachSeat, phaseWords, recordsByCli, seatWeekLine, type CoachMove } from '../board/seatCoaching.js';
import { TechDetails } from './ui/index.js';
import { useSeatWeek, type MoveState, type SeatWeekRead } from '../hooks/useSeatWeek.js';
import { useConnectionStore } from '../store/connection.js';
import { setCachedRoster, subscribeRoster } from '../store/rosterCache.js';
import { signInLapsed } from '../board/deskModel.js';

/**
 * The health registry (DES-FEEDBACK-003 §6.2, slice O): the two chrome check rows
 * (WebSocket / API server — CheckRow + the `getHealth()` fetch moved verbatim from
 * the retired AppChrome popover, §8.2) plus one row per council seat off
 * `GET /roster` (`display_name`, `health: SeatHealth`, `signed_in` —
 * routes.ts:308, crew#274) and the week + governance groups.
 *
 * The `/health` page (`HealthPage`) mounts this engine active for its whole life:
 * the page IS the fetch gesture (EC30), carded. The rail's own Health LINK reads a
 * lighter dot (`useRailHealthDot` — the mount read alone, EC30-strict); this
 * registry is what does the full week + governance reads the page shows.
 *
 * Fetch discipline (EC30): `GET /health`, `GET /roster` and the week read fire
 * when the registry turns active — never on a timer. Re-activating refetches
 * (staleness by gesture, §6.3). `reprobeNow` re-runs a still-active registry's
 * probes without a collapse (the "check again" rows).
 *
 * `health` is OPTIONAL on the wire (additive, absent on a daemon predating
 * crew#274): an absent `health` renders a dim `·` glyph and "no answer yet"
 * detail — never a fabricated "active".
 *
 * GOVERNANCE (studio#246, crew#495 / F-022): the same read also pulls
 * `GET /diagnostics` and renders its `governance` block as a registry group —
 * the store (path + which rule chose it), the record counts (`null` =
 * "engine cannot count", never 0), the folded dead-letter outbox (count, by
 * type / by reason, the timestamp range, `truncated`, the pre-fix HOME outbox)
 * and every finding as a severity-styled row. Null-safe by construction: a
 * daemon predating the block renders one honest plain-words row ("Not available
 * from this version of crew…"), a daemon
 * reporting `store: null` is NOT shown as governed. The engine still derives the
 * heart verdicts from these findings (an error finding or a null store reads
 * unhealthy, a warning degraded); the rail link's dot reads its own overlap
 * (`useRailHealthDot`), and the page renders the rows alone.
 */

interface HealthInfo {
  status: string;
  version: string;
  ping: string;
}

/** Moved verbatim from the retired AppChrome popover (§6.2/§8.2). */
export function CheckRow({ label, ok, detail, since, testId, state, action }: {
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
    <div data-testid={testId} data-state={state} className="wk-health-row" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: '5px' }}>
      <span style={{ width: '12px', fontSize: 'var(--text-xs)', color, fontFamily: 'var(--font-mono)', flexShrink: 0 }}>{icon}</span>
      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-body)', fontFamily: 'var(--font-mono)', flex: 1 }}>{label}</span>
      <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--ink-body)', fontFamily: 'var(--font-mono)' }}>{detail}</span>
      {since !== undefined && (
        <span data-testid="rail-probe-checked" data-at={since} title="when this probe last answered" style={{ fontSize: 'var(--text-2xs)', color: 'var(--ink-muted)', fontFamily: 'var(--font-mono)' }}>
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
 * answered. RC1 saw all three rows stuck on "checking…" 2.5 s after the mount while the daemon's
 * /health answered in < 50 ms — a request that never settles must not look like one in flight.
 */
export const PROBE_DEADLINE_MS = 4000;

/** The words a probe past its deadline wears — not an error (nothing answered), not "checking…". */
export function probeOverdueWord(deadlineMs: number): string {
  const span = deadlineMs < 1000 ? `${deadlineMs} ms` : `${Math.round(deadlineMs / 1000)} s`;
  return `no answer after ${span} — still waiting`;
}

const MONO_2XS = { fontSize: 'var(--text-2xs)', fontFamily: 'var(--font-mono)' } as const;

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
export const SIGNED_OUT_DETAIL = 'signed out — it may be skipped for checks';
export const SIGNED_OUT_TITLE =
  'Studio\'s service saw no sign-in for this helper. A helper that cannot sign in fails when it starts '
  + 'and is skipped — but a provider free tier may still answer; Studio cannot tell yet. '
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
    // studio#724: plain words; the service's own reason ("not enabled for council") is the hover only.
    return { kind: 'ineligible', detail: 'not picked for checks', title: reason !== '' ? `Studio's service: ${reason.replace(/council/gi, 'checks')}` : 'Studio\'s service does not pick this helper for checks', auth };
  }
  if (auth === 'not_required') {
    return { kind: 'no-sign-in-needed', detail: `no sign-in needed${tier !== '' ? ` (${tier})` : ''}`, title: tier !== '' ? `answers on its provider free tier: ${tier}` : null, auth };
  }
  if (auth === 'signed_in' || seat.signed_in === true) return { kind: 'signed-in', detail: 'signed in', title: null, auth };
  if (auth === 'signed_out' || seat.signed_in === false) {
    return eligible === true
      ? { kind: 'signed-out', detail: 'signed out — still picked for checks', title: 'No sign-in observed, and Studio\'s service still picks this helper for checks.', auth }
      : { kind: 'signed-out', detail: SIGNED_OUT_DETAIL, title: SIGNED_OUT_TITLE, auth };
  }
  return { kind: 'unknown', detail: null, title: null, auth };
}

/**
 * A seat-level failure that is NOT a sign-in problem (r4, image-review row 5): a quota / usage-limit
 * message on the wire means the seat's provider budget is spent — Sign in is withheld, and the row
 * says the limit is reached, naming the return time when the daemon's message carries one.
 */
export function usageLimitWord(message: string): string | null {
  if (!/quota|usage limit|rate limit|too many requests|\b429\b/i.test(message)) return null;
  const when = message.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?/);
  return when !== null ? `access returns ${when[0]}` : 'usage limit reached';
}

/** One registry row (§6.2's anatomy): glyph, name, the honest detail. */
export function SeatRow({ seat, onSignIn }: { seat: RosterSeat; onSignIn?: (seat: RosterSeat) => void }): React.ReactElement {
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
  // r4 (rows 4-6): the page wraps the WHOLE message — every word, no truncating excerpt — with the
  // action on its own line below. A seat that has not answered stays "no answer yet", never blank.
  const detail = message !== null
    ? message
    : h === undefined
      ? standing.detail ?? 'no answer yet'
      : [h.status, standing.detail].filter((s): s is string => s != null).join(' · ');
  const detailColor = message !== null ? 'var(--status-fail)' : hedged ? 'var(--status-gate)' : 'var(--ink-body)';
  // A quota / usage-limit failure is not a sign-in problem: no Sign in action, and the sentence
  // names the return time when the wire carries one.
  const quota = message !== null ? usageLimitWord(message) : null;
  const offerSignIn = onSignIn !== undefined && signInLapsed(seat) && quota === null;
  return (
    <div
      data-testid="rail-seat-row"
      data-seat={seat.key}
      data-health={h?.status ?? 'unknown'}
      data-signed-in={seat.signed_in === true ? 'true' : seat.signed_in === false ? 'false' : 'unknown'}
      data-standing={standing.kind}
      {...(quota !== null ? { 'data-quota': quota } : {})}
      {...(standing.auth !== null ? { 'data-auth': standing.auth } : {})}
      title={message ?? standing.title ?? undefined}
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', marginBottom: '5px', minWidth: 0 }}
    >
      <div className="wk-health-row" style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-2)', minWidth: 0 }}>
        <span style={{ width: '12px', fontSize: 'var(--text-xs)', color, fontFamily: 'var(--font-mono)', flexShrink: 0 }}>{glyph}</span>
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-body)', flexShrink: 0 }}>
          {seatLabel(seat)}
        </span>
        {/* UI-CONTRACT §5: a reviewer-only helper, where it must be shown, says so (one name, no "(judge)"). */}
        {seatRoleWord(seat) !== null && <span data-testid="rail-seat-role" className="wk-tag">{seatRoleWord(seat)}</span>}
        {message === null && (
          <span style={{ marginLeft: 'auto', fontSize: 'var(--text-2xs)', color: detailColor, fontFamily: 'var(--font-mono)', textAlign: 'right' }}>
            {detail}
          </span>
        )}
      </div>
      {message !== null && quota === null && (
        <p data-testid="rail-seat-error" style={{ ...MONO_2XS, margin: 0, paddingLeft: '20px', color: detailColor, overflowWrap: 'anywhere' }}>
          {detail}
        </p>
      )}
      {quota !== null && (
        <p data-testid="rail-seat-quota" style={{ ...MONO_2XS, margin: 0, paddingLeft: '20px', color: 'var(--status-fail)', overflowWrap: 'anywhere' }}>
          {quota.charAt(0).toUpperCase() + quota.slice(1)}
        </p>
      )}
      {/* Amendment 5, decision 5: wherever a seat is signed out, Sign in is one click away — not only
          when the week's record happens to show an auth bench. It rides its own line under the outseat
          name (r4 row 4), withheld for a quota / usage-limit failure (r4 row 5). */}
      {offerSignIn && (
        <div style={{ paddingLeft: '20px' }}>
          <button
            type="button"
            data-testid="rail-seat-signin"
            data-seat={seat.key}
            onClick={() => onSignIn(seat)}
            aria-label={`Sign in ${seat.display_name || seat.key}`}
            style={{ ...MONO_2XS, padding: '0 6px', borderRadius: 'var(--radius-md)', border: '1px solid var(--status-gate-dim)', background: 'var(--status-gate-dim)', color: 'var(--status-gate)', cursor: 'pointer' }}
          >
            Sign in
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * The seat's weekly 1:1 (Wave B, idea 9) under its registry row: the week's record on one line, then
 * the ONE coaching move — its consequence first, then the button that takes it. "No change needed"
 * has no button. The move's result replaces the button once it lands.
 */
export function SeatWeek({ seat, record, move, state, onMove }: {
  seat: RosterSeat;
  record: SeatRecord | undefined;
  move: CoachMove;
  state: MoveState | undefined;
  onMove: () => void;
}): React.ReactElement {
  return (
    <div data-testid="rail-seat-week" data-seat={seat.key} style={{ paddingLeft: '20px', marginBottom: '6px', minWidth: 0 }}>
      <div data-testid="rail-seat-week-line" style={{ ...MONO_2XS, color: 'var(--ink-body)', overflowWrap: 'anywhere' }}>
        {seatWeekLine(record)}
      </div>
      <div data-testid="rail-seat-move" data-kind={move.kind} data-seat={seat.key} style={{ marginTop: '2px' }}>
        {move.consequence === null ? (
          <div title={move.why} style={{ ...MONO_2XS, color: 'var(--ink-muted)' }}>
            {move.label}
          </div>
        ) : (
          <>
            <p data-testid="rail-seat-move-consequence" style={{ ...MONO_2XS, margin: '0 0 3px', color: 'var(--ink-body)', overflowWrap: 'anywhere' }}>
              <span style={{ color: 'var(--status-gate)' }}>{move.why}.</span> {move.consequence}
            </p>
            {/* studio#702: the raw phase key (a step address) only behind Technical details. */}
            {move.kind === 'route-away' && move.phase !== phaseWords(move.phase) && (
              <TechDetails data-testid="rail-seat-move-detail" text={`phase key: ${move.phase}`} />
            )}
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
                {move.label}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** The window caption under the seats header: what the week covers, or why there is no week. The
 *  heading ("This week") already names the block — the caption never repeats it (r4 row 8). */
export function weekCaption(week: SeatWeekRead): { text: string; color: string } | null {
  if (week.kind === 'loading') return { text: 'checking…', color: 'var(--ink-body)' };
  if (week.kind === 'absent') return { text: 'Not available yet', color: 'var(--ink-body)' };
  if (week.kind === 'error') return { text: `unavailable — ${week.message}`, color: 'var(--status-fail)' };
  const r = week.record;
  const to = new Date(r.until).toISOString().slice(0, 10);
  return {
    text: `last ${r.days} days to ${to} · ${r.runsRead} run${r.runsRead === 1 ? '' : 's'} read${r.truncated ? ' (capped: oldest skipped)' : ''}`,
    color: 'var(--ink-body)',
  };
}

/** What the mount read learned about governance (studio#246). */
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
export function DetailLine({ label, value, color, testId }: { label: string; value: string; color?: string; testId?: string }): React.ReactElement {
  return (
    <div data-testid={testId} style={{ display: 'flex', gap: 'var(--space-2)', paddingLeft: '20px', marginBottom: '3px', minWidth: 0 }}>
      <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--ink-muted)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>{label}</span>
      <span className="truncate" title={value} style={{ fontSize: 'var(--text-2xs)', color: color ?? 'var(--ink-body)', fontFamily: 'var(--font-mono)', minWidth: 0 }}>{value}</span>
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
export function GovernanceRows({ read, overdue = 0, onReprobe }: {
  read: GovernanceRead;
  /** the probe deadline (ms) once passed, 0 while inside it */
  overdue?: number;
  /** the mount read's re-probe, offered on an overdue row */
  onReprobe?: () => void;
}): React.ReactElement {
  if (read.kind === 'loading') {
    return (
      <CheckRow
        label="" ok={null} detail={overdue ? probeOverdueWord(overdue) : 'checking…'} testId="rail-governance-probe" state={overdue ? 'overdue' : 'checking'}
        {...(overdue && onReprobe !== undefined ? { action: { label: 'check again', testId: 'rail-governance-recheck', onClick: onReprobe } } : {})}
      />
    );
  }
  if (read.kind === 'error') {
    return (
      <div data-testid="rail-governance" data-state="error">
        <CheckRow label="Governance" ok={false} detail="couldn't be read" />
        <TechDetails data-testid="rail-governance-error" text={read.message} />
      </div>
    );
  }
  if (read.kind === 'absent') {
    // r4 (rows 7-8): one plain-words sentence — no route names, no repeated "governance" row label
    // under the Governance heading. The absent ANSWER is the row; `data-why` keeps the distinction.
    return (
      <div data-testid="rail-governance" data-state="absent" data-why={read.why}>
        <p className="wk-health-absent">Not available yet</p>
      </div>
    );
  }
  const g = read.governance;
  const dl = g.deadletters;
  const errors = g.findings.filter((f) => f.severity === 'error').length;
  const state = g.store === null || errors > 0 ? 'error' : g.findings.length > 0 ? 'warning' : 'ok';
  // Reel UX gate ch56 (P1): plain words in the card; every store / outbox path, the tallies and the
  // raw finding lines ("info · governance.legacy-outbox — …") live behind ONE Technical details,
  // where TechDetails shows home paths as ~/… . `total` and `sinceBoot` are independently nullable.
  const records = [
    g.records.total === null ? 'not counted' : `${g.records.total} record${g.records.total === 1 ? '' : 's'}`,
    g.records.sinceBoot === null ? null : `${g.records.sinceBoot} since the service started`,
  ].filter((x): x is string => x !== null).join(' · ');
  const range =
    dl.oldestTs !== null && dl.newestTs !== null ? `${stamp(dl.oldestTs)} → ${stamp(dl.newestTs)}` : null;
  const tech = [
    g.store === null ? 'store: none resolved — emits dead-letter' : `store: ${g.store.path} (via ${g.store.source})`,
    g.records.total === null ? 'records total: engine cannot count' : null,
    dl.count > 0 ? `dead letters by type: ${tally(dl.byType)}` : null,
    dl.count > 0 ? `dead letters by reason: ${tally(dl.byReason)}` : null,
    dl.count > 0 ? `when: ${(range ?? 'no timestamps') + (dl.untimestamped > 0 ? ` · ${dl.untimestamped} untimestamped` : '') + (dl.truncated ? ' · fold truncated at its size cap — count is a floor' : '')}` : null,
    dl.path !== null ? `outbox: ${dl.path}` : null,
    dl.legacyOutbox !== null ? `legacy outbox: ${dl.legacyOutbox.path} · ${dl.legacyOutbox.bytes} bytes` : null,
    ...g.findings.map((f) => `${f.severity} · ${f.kind} — ${f.message}`),
  ].filter((x): x is string => x !== null);
  return (
    <div data-testid="rail-governance" data-state={state} data-deadletters={dl.count} data-store={g.store === null ? 'none' : g.store.source}>
      {g.store === null
        ? <CheckRow label="Evidence store" ok={false} detail="none found: evidence waits in a holding file" />
        : <CheckRow label="Evidence store" ok detail="found" />}
      <CheckRow label="Records" ok={g.records.total === null && g.records.sinceBoot === null ? null : true} detail={records} />
      <CheckRow
        label="Undelivered evidence"
        ok={dl.count === 0}
        detail={dl.count === 0 ? 'none' : `${dl.count}${dl.truncated ? '+' : ''} waiting to be replayed`}
      />
      {dl.legacyOutbox !== null && (
        <p data-testid="rail-governance-legacy" className="wk-health-plain">An older holding file from before an upgrade still has evidence in it ({kb(dl.legacyOutbox.bytes)}).</p>
      )}
      {/* The legacy-outbox finding IS the line above when that file is known: said once. */}
      {g.findings.filter((f) => !(f.kind === 'governance.legacy-outbox' && dl.legacyOutbox !== null)).map((f, i) => (
        <p
          key={`${f.kind}-${i}`}
          data-testid="rail-governance-finding"
          data-kind={f.kind}
          data-severity={f.severity}
          className="wk-health-finding"
          style={{ borderLeftColor: FINDING_COLOR[f.severity] }}
        >
          <span style={{ color: FINDING_COLOR[f.severity], fontWeight: 'var(--weight-semi)' }}>{SEVERITY_WORD[f.severity] ?? 'Note'}:</span>{' '}
          {plainFinding(f.message)}
        </p>
      ))}
      <TechDetails data-testid="rail-governance-detail" text={tech} />
    </div>
  );
}

const SEVERITY_WORD: Record<string, string> = { info: 'Note', warning: 'Warning', error: 'Problem' };

function kb(bytes: number): string {
  return bytes < 1024 ? `${bytes} bytes` : `${Math.round(bytes / 1024)} KB`;
}

/** A finding's message in the default layer: its first sentence, cut before any path, command or
 *  `key=value` token; the whole message is in Technical details. */
export function plainFinding(message: string): string {
  const first = message.split(/(?<=[.!?])\s/u)[0] ?? message;
  const cut = /\s+(?:at|in|under|from|to|with|via|run|open)?\s*(?:~|\$TMPDIR|\/|[A-Z][A-Z0-9]*_[A-Z0-9_]+|[\w.-]+\/[\w./-]+|`)|\s+\(|\s*:\s|\s+—\s|\s+[\w.-]+=/u.exec(first);
  const line = (cut !== null && cut.index > 0 ? first.slice(0, cut.index) : first).trim().replace(/[\s,;:—-]+$/u, '');
  const text = line === '' ? 'See Technical details.' : line;
  return /[.!?]$/u.test(text) ? text : `${text}.`;
}

/** The whole registry's live answer — the engine behind the /health page. */
export interface HealthRegistry {
  wsStatus: 'connecting' | 'connected' | 'disconnected';
  health: HealthInfo | null;
  healthError: string | null;
  healthCheckedAt: number | null;
  overdue: boolean;
  healthFresh: boolean;
  rosterFresh: boolean;
  roster: RosterSeat[] | null;
  rosterError: boolean;
  governance: GovernanceRead;
  week: SeatWeekRead;
  moves: Record<string, MoveState>;
  apply: (seat: string, move: CoachMove) => Promise<void>;
  markOpened: (seat: string) => void;
  signIn: RosterSeat | null;
  setSignIn: (seat: RosterSeat | null) => void;
  /** A roster re-read landed anywhere (the sign-in panel) refreshes the registry rows. */
  acceptRoster: (r: RosterSeat[]) => void;
  weekRecords: Map<string, SeatRecord> | null;
  sick: boolean;
  degraded: boolean;
  heartState: 'healthy' | 'degraded' | 'unhealthy';
  heartColor: string;
  reprobeNow: () => void;
  probeDeadlineMs: number;
}

/**
 * The health registry engine behind the `/health` page (`active` = mounted). All probe
 * effects, the generation guard (a completion from an earlier activation must not overwrite
 * a later one) and the derived heart verdicts live here once.
 */
export function useHealthRegistry(
  active: boolean,
  probeDeadlineMs = PROBE_DEADLINE_MS,
): HealthRegistry {
  const wsStatus = useConnectionStore((s) => s.status);
  const [health, setHealth] = useState<HealthInfo | null>(null);
  /** The rejected probe's own sentence (`null` = not rejected) — the row shows WHY, never a bare "unreachable". */
  const [healthError, setHealthError] = useState<string | null>(null);
  /** When the /health probe last SETTLED (answer or rejection); `null` until it has. */
  const [healthCheckedAt, setHealthCheckedAt] = useState<number | null>(null);
  /** studio#280 item 2: the current activation's probes have outlived the deadline without settling. */
  const [overdue, setOverdue] = useState(false);
  /** Whether the shown /health and /roster answers belong to THIS activation (false = kept from an
   *  earlier one): a kept answer past the deadline is said to be stale, never passed off as fresh. */
  const [healthFresh, setHealthFresh] = useState(false);
  const [rosterFresh, setRosterFresh] = useState(false);
  /** Bumped by "check again" — re-runs the probes without a collapse. */
  const [reprobe, setReprobe] = useState(0);
  const [roster, setRoster] = useState<RosterSeat[] | null>(null);
  const [rosterError, setRosterError] = useState(false);
  const [governance, setGovernance] = useState<GovernanceRead>({ kind: 'loading' });
  // Wave B, idea 9: the seats' week, read on the same activation gesture.
  const { week, moves, apply, markOpened } = useSeatWeek(active);
  const [signIn, setSignIn] = useState<RosterSeat | null>(null);
  // Amendment 5: a roster re-read anywhere (the sign-in panel's "check again" on the Desk or in
  // Helpers) refreshes this registry too — the rows clear without another activation.
  useEffect(() => subscribeRoster((r) => { setRoster(r); setRosterError(false); }), []);
  const weekRecords = week.kind === 'ok' ? recordsByCli(week.record) : null;
  /** The activation generation a probe belongs to — a completion from an earlier activation (or an
   *  earlier "check again") must not overwrite a later one: the findings drive the heart and the
   *  dot, and a slow /health answer landing over a fresh one would read as settled when it is not. */
  const probeGen = useRef(0);
  // Unmount retires every in-flight probe: its completion must not reach a setter.
  useEffect(() => () => { probeGen.current++; }, []);

  // EC30: activation IS the fetch gesture — one GET /health + one GET /roster per activation.
  // The page mounts active for its whole life; studio#280 item 2: every probe SETTLES visibly —
  // an answer stamps its clock, a rejection shows its sentence, a probe past `probeDeadlineMs`
  // says it has not answered (with a re-probe) instead of reading "checking…" forever.
  useEffect(() => {
    if (!active) return;
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
    // Only the CURRENT activation's answer lands: a slow earlier read resolving after a re-activation
    // would otherwise paint stale governance health.
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
    return () => clearTimeout(deadline);
  }, [active, reprobe, probeDeadlineMs]);

  /** "check again": re-runs these probes — offered on every overdue row. */
  const reprobeNow = (): void => { setReprobe((n) => n + 1); window.dispatchEvent(new Event(HEALTH_RECHECKED)); };

  const wsDown = wsStatus === 'disconnected';
  // The derived heart verdict (§6.2): fail-red if any seat is inactive or the
  // socket is down; a null store or an error finding (dead letters, no store) is a
  // health failure — the board must not read "Governed" over it.
  const govErrors =
    governance.kind === 'ok' &&
    (governance.governance.store === null || governance.governance.findings.some((f) => f.severity === 'error'));
  const govWarnings =
    governance.kind === 'error' ||
    (governance.kind === 'ok' && governance.governance.findings.some((f) => f.severity === 'warning'));
  const sick = wsDown || govErrors || (roster ?? []).some((s) => s.health?.status === 'inactive');
  // The ♥ glyph is colored by health: red when unhealthy (a seat down or the socket gone), amber
  // when degraded (socket still connecting, a probe errored, or the API server not reporting ok),
  // green otherwise. It reads the same signals the registry already computes — no new data source.
  // F-2R2-009 (review): the sign-in HEURISTIC is said per row (the amber `!`), never folded into
  // the heart — on a default roster most seats read `signed_in:false`, and a healthy daemon must
  // not wear a permanently degraded heart over a guess. Only a daemon-declared `council_eligible:
  // false` (crew#533, api-types 0.35.0) degrades it, because that IS the daemon's own word.
  const ineligible = (roster ?? []).some((s) => (s as Record<string, unknown>)['council_eligible'] === false && s.health?.status !== 'inactive');
  const degraded =
    wsStatus === 'connecting' || healthError !== null || rosterError || govWarnings || ineligible || (health !== null && health.status !== 'ok');
  const heartState = sick ? 'unhealthy' : degraded ? 'degraded' : 'healthy';
  const heartColor = sick
    ? 'var(--status-fail)'
    : degraded
      ? 'var(--status-gate)'
      : 'var(--status-run)';

  return {
    wsStatus,
    health,
    healthError,
    healthCheckedAt,
    overdue,
    healthFresh,
    rosterFresh,
    roster,
    rosterError,
    governance,
    week,
    moves,
    apply,
    markOpened,
    signIn,
    setSignIn,
    acceptRoster: (r) => { setRoster(r); setRosterError(false); },
    weekRecords,
    sick,
    degraded,
    heartState,
    heartColor,
    reprobeNow,
    probeDeadlineMs,
  };
}

/** The connection rows (WebSocket + API server) on the /health page's Connection card. */
export function ConnectionRegistry({ registry }: { registry: HealthRegistry }): React.ReactElement {
  const { wsStatus, health, healthError, healthCheckedAt, overdue, healthFresh, probeDeadlineMs, reprobeNow } = registry;
  const pillLabel = wsStatus === 'connected' ? 'Connected' : wsStatus === 'connecting' ? 'Connecting' : 'Disconnected';
  return (
    <>
      <CheckRow label="WebSocket" ok={wsStatus === 'connected'} detail={pillLabel} />
      {healthError !== null ? (
        <CheckRow label="API server" ok={false} detail={`unreachable — ${healthError}`} since={healthCheckedAt ?? undefined} testId="rail-api-server" state="error" />
      ) : health ? (
        // A kept answer past this activation's deadline is STALE: its clock says when, the state
        // says so, and the re-probe rides the row — never the old answer passed off as this one's.
        <CheckRow
          label="API server" ok={health.status === 'ok'} detail={`${health.status} · ${health.version}`} since={healthCheckedAt ?? undefined}
          testId="rail-api-server" state={overdue && !healthFresh ? 'stale' : 'answered'}
          {...(overdue && !healthFresh ? { action: { label: 'check again', testId: 'rail-health-recheck', onClick: reprobeNow } } : {})}
        />
      ) : overdue ? (
        <CheckRow
          label="API server" ok={null} detail={probeOverdueWord(probeDeadlineMs)} testId="rail-api-server" state="overdue"
          action={{ label: 'check again', testId: 'rail-health-recheck', onClick: reprobeNow }}
        />
      ) : (
        <CheckRow label="API server" ok={null} detail="checking…" testId="rail-api-server" state="checking" />
      )}
    </>
  );
}

/** The seats registry (studio#421 r3): one row per council seat. The week's own card is
 *  `WeekRegistry`, below — a card per section (Connection · Seats · This week · Governance). */
export function SeatsRegistry({ registry }: { registry: HealthRegistry }): React.ReactElement {
  const { roster, rosterError, overdue, rosterFresh, probeDeadlineMs, reprobeNow } = registry;
  if (rosterError) return <CheckRow label="helpers" ok={false} detail="unreachable" />;
  if (roster === null) {
    return (
      <CheckRow
        label="helpers" ok={null} detail={overdue ? probeOverdueWord(probeDeadlineMs) : 'checking…'} testId="rail-seats-probe" state={overdue ? 'overdue' : 'checking'}
        {...(overdue ? { action: { label: 'check again', testId: 'rail-seats-recheck', onClick: reprobeNow } } : {})}
      />
    );
  }
  return (
    <>
      {overdue && !rosterFresh && (
        <CheckRow
          label="helpers" ok={null} detail={`${probeOverdueWord(probeDeadlineMs)} · showing the last answer`} testId="rail-seats-probe" state="stale"
          action={{ label: 'check again', testId: 'rail-seats-recheck', onClick: reprobeNow }}
        />
      )}
      {roster.map((seat) => (
        <div key={seat.key} data-testid="rail-seat" data-seat={seat.key}>
          <SeatRow seat={seat} onSignIn={registry.setSignIn} />
        </div>
      ))}
    </>
  );
}

/** The week's own card: the window caption and each seat's weekly 1:1 move (studio#421 r3). Split
 *  out of SeatsRegistry so /health reads Connection · Seats · This week · Governance. */
export function WeekRegistry({ registry }: { registry: HealthRegistry }): React.ReactElement {
  const { roster, week, weekRecords, moves } = registry;
  if (roster === null) return <></>;
  const cap = weekCaption(week);
  return (
    <>
      {cap !== null && (
        <p data-testid="rail-seat-week-window" data-state={week.kind} style={{ ...MONO_2XS, margin: '0 0 4px', color: cap.color, overflowWrap: 'anywhere' }}>
          {cap.text}
        </p>
      )}
      {roster.map((seat) => {
        const record = weekRecords?.get(seat.key);
        const move = week.kind === 'ok' ? coachSeat(record, seat, week.record) : null;
        return (
          <div key={seat.key} data-testid="rail-week-seat" data-seat={seat.key} aria-label={move !== null ? `${seat.display_name || seat.key} this week` : undefined} role={move !== null ? 'group' : undefined}>
            {/* Its own card now, so each record names its seat (codex review r1). */}
            {move !== null && <p data-testid="rail-week-seat-name" className="wk-health-week-seat">{seat.display_name || seat.key}</p>}
            {move !== null && (
              <SeatWeek
                seat={seat}
                record={record}
                move={move}
                state={moves[seat.key]}
                onMove={() => {
                  if (move.kind === 'sign-in') {
                    registry.setSignIn(seat);
                    registry.markOpened(seat.key);
                  } else {
                    void registry.apply(seat.key, move);
                  }
                }}
              />
            )}
          </div>
        );
      })}
    </>
  );
}
