import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { getDiagnostics, isDiagnosticsUnsupported } from '../api/diagnostics.js';
import type { DiagnosticsGovernance, DiagnosticsGovernanceFinding, RosterSeat } from '../api/types.js';
import { useConnectionStore } from '../store/connection.js';
import { setCachedRoster } from '../store/rosterCache.js';

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
function CheckRow({ label, ok, detail }: { label: string; ok: boolean | null; detail: string }): React.ReactElement {
  const icon = ok === null ? '·' : ok ? '✓' : '✗';
  const color = ok === null ? 'var(--ink-dim)' : ok ? 'var(--status-run)' : 'var(--status-fail)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: '5px' }}>
      <span style={{ width: '12px', fontSize: 'var(--text-xs)', color, fontFamily: 'var(--font-mono)', flexShrink: 0 }}>{icon}</span>
      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-body)', fontFamily: 'var(--font-mono)', flex: 1 }}>{label}</span>
      <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--ink-dim)', fontFamily: 'var(--font-mono)' }}>{detail}</span>
    </div>
  );
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
function SeatRow({ seat }: { seat: RosterSeat }): React.ReactElement {
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
    </div>
  );
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
function GovernanceRows({ read }: { read: GovernanceRead }): React.ReactElement {
  if (read.kind === 'loading') return <CheckRow label="governance" ok={null} detail="checking…" />;
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
          <DetailLine testId="rail-governance-store-path" label="path" value={g.store.path} />
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
      {dl.path !== null && <DetailLine testId="rail-governance-outbox" label="outbox" value={dl.path} />}
      {dl.legacyOutbox !== null && (
        <DetailLine testId="rail-governance-legacy" label="legacy outbox" value={`${dl.legacyOutbox.path} · ${dl.legacyOutbox.bytes} bytes`} color="var(--status-gate)" />
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
}

export function HealthRailSection({ open, onToggle }: Props): React.ReactElement {
  const wsStatus = useConnectionStore((s) => s.status);
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [healthError, setHealthError] = useState(false);
  const [roster, setRoster] = useState<RosterSeat[] | null>(null);
  const [rosterError, setRosterError] = useState(false);
  const [governance, setGovernance] = useState<GovernanceRead>({ kind: 'loading' });
  /** The expand generation a diagnostics read belongs to — a completion from an earlier
   *  expand must not overwrite a later one (the findings drive the heart and the dot). */
  const governanceGen = useRef(0);
  const ref = useRef<HTMLDivElement>(null);

  // EC30: the expand IS the fetch gesture — one GET /health + one GET /roster
  // per expansion (the retired popover's exact `[open]` effect, moved); the
  // answers survive a collapse so the summary dot can keep reading them.
  useEffect(() => {
    if (!open) return;
    setHealthError(false);
    setRosterError(false);
    api.getHealth()
      .then((h) => setHealth(h))
      .catch(() => setHealthError(true));
    api.getRoster()
      .then(({ roster: seats }) => { setRoster(seats); setCachedRoster(seats); })
      .catch(() => setRosterError(true));
    // studio#246: the same gesture reads the governance block. Absence is a
    // named state (older daemon), never an invented healthy store.
    setGovernance({ kind: 'loading' });
    const gen = ++governanceGen.current;
    // Through a resolved promise so a client that cannot serve the read at all
    // (a partial mock, a missing export) becomes the honest error row, not a throw.
    // Only the CURRENT expand's answer lands (Copilot on #253): a slow earlier read
    // resolving after a re-expand would otherwise paint stale governance health.
    Promise.resolve()
      .then(() => getDiagnostics())
      .then((d) => {
        if (governanceGen.current !== gen) return;
        setGovernance(d.governance === undefined ? { kind: 'absent', why: 'no-block' } : { kind: 'ok', governance: d.governance });
      })
      .catch((e: unknown) => {
        if (governanceGen.current !== gen) return;
        setGovernance(isDiagnosticsUnsupported(e) ? { kind: 'absent', why: 'no-route' } : { kind: 'error', message: e instanceof Error ? e.message : String(e) });
      });
    // Opened from the chrome dot: bring the foot into view (§6.2).
    ref.current?.scrollIntoView({ block: 'nearest' });
  }, [open]);

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
    wsStatus === 'connecting' || healthError || rosterError || govWarnings || ineligible || (health !== null && health.status !== 'ok');
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
      className="shrink-0 px-2 pb-2 pt-1"
      style={{ borderTop: '1px solid var(--surface-raised)' }}
    >
      <button
        type="button"
        data-testid="rail-health-toggle"
        aria-expanded={open}
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-1 py-1.5 text-left transition-colors"
        style={{
          background: 'transparent',
          color: open ? 'var(--ink-high)' : 'var(--ink-muted)',
          fontSize: 'var(--text-xs)',
          fontFamily: 'var(--font-sans)',
          fontWeight: 'var(--weight-semi)',
        }}
      >
        <span
          aria-hidden
          data-testid="rail-health-chevron"
          className="inline-block leading-none"
          style={{
            transition: 'transform var(--dur-fast)',
            transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
          }}
        >
          ›
        </span>
        <span
          aria-hidden
          data-testid="rail-health-heart"
          data-health={heartState}
          style={{ color: heartColor }}
        >
          ♥
        </span>
        <span>Health</span>
        {sick && (
          <span
            data-testid="rail-health-summary-dot"
            aria-label="a health check needs attention"
            className="w-2 h-2 rounded-full shrink-0 ml-auto"
            style={{ background: 'var(--status-fail)' }}
          />
        )}
      </button>
      {open && (
        <div className="flex flex-col pt-0.5 px-1">
          <CheckRow label="WebSocket" ok={wsStatus === 'connected'} detail={pillLabel} />
          {healthError ? (
            <CheckRow label="API server" ok={false} detail="unreachable" />
          ) : health ? (
            <CheckRow label="API server" ok={health.status === 'ok'} detail={`${health.status} · ${health.version}`} />
          ) : (
            <CheckRow label="API server" ok={null} detail="checking…" />
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
            <CheckRow label="seats" ok={null} detail="checking…" />
          ) : (
            roster.map((seat) => <SeatRow key={seat.key} seat={seat} />)
          )}
          <p
            aria-hidden
            className="select-none"
            style={{ margin: '2px 0 5px', fontSize: 'var(--text-2xs)', color: 'var(--ink-dim)', fontFamily: 'var(--font-mono)' }}
          >
            ── governance ────────
          </p>
          <GovernanceRows read={governance} />
        </div>
      )}
    </div>
  );
}
