import { useConnectionStore } from '../store/connection.js';
import { useAppearanceStore } from '../theming/appearance.js';
import { prefersReducedMotion } from './LiveEdge.js';
import { WickedLogo } from './WickedLogo.js';

/**
 * The app chrome (DES-VISION-001 §6.3 slice 3, §3.1, §5.2): the one place the
 * product frames itself — the logo slot, the product name, and the connection
 * status. It renders as the rail's header region (the chrome the product
 * already had, token-converted — §6.0: no IA change), at the §2.7 chrome
 * height (`--space-12`).
 *
 * The settings gear is GONE from the chrome (DES-FEEDBACK-001 §1.2, §4.4,
 * slice A): its dropdown moved into the rail's expand/collapse settings
 * section (SettingsRailSection); the freed slot is reserved for the §4.3
 * project-switcher breadcrumb. The logo slot and connection dot are untouched.
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
 * `prefers-reduced-motion`.
 *
 * The health POPOVER retired (DES-FEEDBACK-003 §6.2/§8.2, slice O): the dot
 * stays as glanceable ws state, and clicking it now expands the rail-foot
 * HealthRailSection (one surface for health detail, not two) — CheckRow and
 * the `getHealth()` fetch moved there verbatim.
 */

interface Props {
  /** The rail's collapsed state: icon-only column instead of the header row. */
  collapsed: boolean;
  navigate: (path: string) => void;
  /** Clicking the dot expands the rail-foot Health section (§6.2, slice O). */
  onDotClick?: () => void;
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

/**
 * The connection status dot — glanceable ws state. Its old health popover is
 * RETIRED (§8.2): a click hands off to the rail-foot Health section instead.
 */
function ConnectionDot({ collapsed, onClick }: { collapsed: boolean; onClick?: (() => void) | undefined }): React.ReactElement {
  const wsStatus = useConnectionStore((s) => s.status);

  const pillLabel =
    wsStatus === 'connected' ? 'Connected' :
    wsStatus === 'connecting' ? 'Connecting' : 'Disconnected';

  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <button
        type="button"
        onClick={onClick}
        title={`Connection: ${pillLabel} — health details below`}
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
    </div>
  );
}

export function AppChrome({ collapsed, navigate, onDotClick }: Props): React.ReactElement {
  const logoUrl = useAppearanceStore((s) => s.appearance.logo_url);

  // The §3.1 slot: 32×32 exactly, clearspace by margin, contain-fit custom
  // asset via the --logo-url custom property. The accent-stroked default mark
  // renders ONLY while no custom logo is set (§3.1: "when no custom logo is
  // set, the default SVG mark renders" — the slice-7 AC asserts its absence
  // when `--logo-url` carries an asset, so the two never stack).
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
      {logoUrl === null && <WickedLogo size={32} />}
    </button>
  );

  if (collapsed) {
    return (
      <div
        data-testid="app-chrome"
        style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-1)' }}
      >
        {logoSlot}
        <ConnectionDot collapsed onClick={onDotClick} />
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
      <ConnectionDot collapsed={false} onClick={onDotClick} />
    </div>
  );
}
