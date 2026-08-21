import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { useConnectionStore } from '../store/connection.js';
import { prefersReducedMotion } from './LiveEdge.js';
import { SettingsMenu } from './SettingsMenu.js';
import { WickedLogo } from './WickedLogo.js';

/**
 * The app chrome (DES-VISION-001 §6.3 slice 3, §3.1, §5.2): the one place the
 * product frames itself — the logo slot, the product name, the connection
 * status, and the settings entry point. It renders as the rail's header region
 * (the chrome the product already had, token-converted — §6.0: no IA change),
 * at the §2.7 chrome height (`--space-12`).
 *
 * The logo slot contract (§3.1):
 *   - exactly 32×32, with `--space-2` clearspace to the viewport edge and the
 *     product name; nothing encroaches;
 *   - `background-image` resolves from the `--logo-url` custom property (none
 *     by default) with contain-fit, so a custom asset is letterboxed, never
 *     stretched or cropped — slice 7's Settings surface sets the property;
 *   - the default mark is an SVG path stroked in `var(--accent)` (WickedLogo);
 *     the old `[W]` font-character fallback is gone.
 *
 * The connection dot carries `data-state` = the websocket state, and its color
 * is the STATUS layer, not the accent (§2.6): live = run-emerald, connecting =
 * gate-amber, lost = fail-red. The reconnecting pulse is the ONE loop the
 * motion grammar allows (§1.6) — it is state communication, and it stops for
 * `prefers-reduced-motion`. The health popover it opens is the same one the
 * rail's old pill owned — moved, not removed.
 */

interface Props {
  /** The rail's collapsed state: icon-only column instead of the header row. */
  collapsed: boolean;
  navigate: (path: string) => void;
}

const DOT_COLOR = {
  connected: 'var(--status-run)',
  connecting: 'var(--status-gate)',
  disconnected: 'var(--status-fail)',
} as const;

const DOT_WORD = {
  connected: 'live',
  connecting: 'connecting…',
  disconnected: 'offline',
} as const;

interface HealthInfo {
  status: string;
  version: string;
  ping: string;
}

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

/** The connection status dot + the health popover (moved from the rail pill). */
function ConnectionDot({ collapsed }: { collapsed: boolean }): React.ReactElement {
  const wsStatus = useConnectionStore((s) => s.status);
  const [open, setOpen] = useState(false);
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [healthError, setHealthError] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setHealth(null);
    setHealthError(false);
    api.getHealth()
      .then((h) => setHealth(h))
      .catch(() => setHealthError(true));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onOutside(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('click', onOutside);
    return () => document.removeEventListener('click', onOutside);
  }, [open]);

  const pillLabel =
    wsStatus === 'connected' ? 'Connected' :
    wsStatus === 'connecting' ? 'Connecting' : 'Disconnected';

  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={`Connection: ${pillLabel}`}
        aria-label={`Connection: ${pillLabel}`}
        style={{
          display: 'flex', alignItems: 'center', gap: '5px', background: 'transparent',
          border: 'none', padding: 'var(--space-1)', cursor: 'pointer',
        }}
      >
        <span
          data-testid="connection-dot"
          data-state={wsStatus}
          style={{
            width: '7px', height: '7px', borderRadius: 'var(--radius-full)',
            background: DOT_COLOR[wsStatus], flexShrink: 0,
            // §1.6's one allowed loop: reconnecting IS a state, and it reads as one.
            animation: wsStatus === 'connecting' && !prefersReducedMotion()
              ? 'wk-live-pulse 2s ease-in-out infinite' : undefined,
          }}
        />
        {!collapsed && (
          <span style={{ fontSize: 'var(--text-2xs)', fontFamily: 'var(--font-mono)', color: 'var(--ink-dim)', whiteSpace: 'nowrap' }}>
            {DOT_WORD[wsStatus]}
          </span>
        )}
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 100,
          background: 'var(--surface-overlay)', border: '1px solid var(--surface-raised)',
          borderRadius: 'var(--radius-md)', padding: 'var(--space-3) 14px', minWidth: '220px',
          boxShadow: 'var(--shadow-overlay)',
        }}>
          <p style={{
            fontSize: 'var(--text-2xs)', fontWeight: 'var(--weight-semi)', textTransform: 'uppercase',
            letterSpacing: '0.1em', color: 'var(--ink-dim)', marginBottom: 'var(--space-2)',
            fontFamily: 'var(--font-mono)',
          }}>
            Health checks
          </p>
          <CheckRow label="WebSocket" ok={wsStatus === 'connected'} detail={pillLabel} />
          {healthError ? (
            <CheckRow label="API server" ok={false} detail="unreachable" />
          ) : health ? (
            <>
              <CheckRow label="API server" ok={health.status === 'ok'} detail={health.status} />
              <CheckRow label="wicked-core" ok detail={health.version} />
            </>
          ) : (
            <CheckRow label="API server" ok={null} detail="checking…" />
          )}
        </div>
      )}
    </div>
  );
}

export function AppChrome({ collapsed, navigate }: Props): React.ReactElement {
  const [settingsOpen, setSettingsOpen] = useState(false);

  // The §3.1 slot: 32×32 exactly, clearspace by margin, contain-fit custom
  // asset via the --logo-url custom property, the accent-stroked mark inside.
  const logoSlot = (
    <button
      type="button"
      data-testid="logo-slot"
      onClick={() => navigate('/')}
      aria-label="Home"
      style={{
        width: '32px', height: '32px', flexShrink: 0, padding: 0, border: 'none',
        margin: 'var(--space-2)',
        backgroundColor: 'transparent',
        backgroundImage: 'var(--logo-url, none)',
        backgroundSize: 'contain', backgroundPosition: 'center', backgroundRepeat: 'no-repeat',
        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <WickedLogo size={32} />
    </button>
  );

  const settingsButton = (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <button
        type="button"
        data-testid="chrome-settings"
        onClick={() => setSettingsOpen((v) => !v)}
        onMouseDown={(e) => e.stopPropagation()}
        aria-label="Settings"
        title="Settings"
        style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: 'var(--ink-muted)', fontSize: 'var(--text-md)', padding: 'var(--space-1)',
          borderRadius: 'var(--radius-sm)', lineHeight: 1,
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--ink-body)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--ink-muted)'; }}
      >
        ⚙
      </button>
      {settingsOpen && (
        <SettingsMenu onNavigate={navigate} onClose={() => setSettingsOpen(false)} />
      )}
    </div>
  );

  if (collapsed) {
    return (
      <div
        data-testid="app-chrome"
        style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-1)' }}
      >
        {logoSlot}
        <ConnectionDot collapsed />
        {settingsButton}
      </div>
    );
  }

  return (
    <div
      data-testid="app-chrome"
      style={{
        display: 'flex', alignItems: 'center', flex: 1, minWidth: 0,
        height: 'var(--space-12)',   /* the chrome height (§2.7) */
      }}
    >
      {logoSlot}
      <button
        type="button"
        onClick={() => navigate('/')}
        className="truncate transition-opacity hover:opacity-70"
        style={{
          background: 'transparent', border: 'none', cursor: 'pointer', padding: 0,
          textAlign: 'left', flex: 1, minWidth: 0,
          fontFamily: 'var(--font-sans)', fontSize: 'var(--text-sm)',
          fontWeight: 'var(--weight-semi)', color: 'var(--ink-body)',
        }}
      >
        wicked-studio
      </button>
      <ConnectionDot collapsed={false} />
      {settingsButton}
    </div>
  );
}
