import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import type { RosterSeat } from '../api/types.js';
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

/** One registry row (§6.2's anatomy): glyph, name, the honest detail. */
function SeatRow({ seat }: { seat: RosterSeat }): React.ReactElement {
  const h = seat.health;
  // Absent health (a daemon predating crew#274) is UNKNOWN — a dim `·`, no
  // message, never a fabricated "active" (§6.2).
  const glyph = h === undefined ? '·' : h.status === 'active' ? '✓' : '✗';
  const color = h === undefined ? 'var(--ink-dim)' : h.status === 'active' ? 'var(--status-run)' : 'var(--status-fail)';
  const signedIn = seat.signed_in === true ? 'signed in' : seat.signed_in === false ? 'signed out' : null;
  const message = h?.status === 'inactive' && h.message !== undefined ? h.message : null;
  const detail = message !== null
    ? message.length > EXCERPT_CH ? `${message.slice(0, EXCERPT_CH)}…` : message
    : [h?.status, signedIn].filter((s): s is string => s != null).join(' · ');
  return (
    <div
      data-testid="rail-seat-row"
      data-seat={seat.key}
      data-health={h?.status ?? 'unknown'}
      title={message ?? undefined}
      style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: '5px' }}
    >
      <span style={{ width: '12px', fontSize: 'var(--text-xs)', color, fontFamily: 'var(--font-mono)', flexShrink: 0 }}>{glyph}</span>
      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-body)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
        {seat.display_name}
      </span>
      <span
        className="truncate"
        style={{ marginLeft: 'auto', fontSize: 'var(--text-2xs)', color: message !== null ? 'var(--status-fail)' : 'var(--ink-dim)', fontFamily: 'var(--font-mono)' }}
      >
        {detail}
      </span>
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
    // Opened from the chrome dot: bring the foot into view (§6.2).
    ref.current?.scrollIntoView({ block: 'nearest' });
  }, [open]);

  const wsDown = wsStatus === 'disconnected';
  const pillLabel = wsStatus === 'connected' ? 'Connected' : wsStatus === 'connecting' ? 'Connecting' : 'Disconnected';
  // The passive header summary (§6.2): fail-red if any seat is inactive or the
  // socket is down — the rail's foot says "look inside" without being opened.
  const sick = wsDown || (roster ?? []).some((s) => s.health?.status === 'inactive');

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
        <span aria-hidden>♥</span>
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
        </div>
      )}
    </div>
  );
}
