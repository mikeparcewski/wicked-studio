import { DEFAULT_SITE_NAME, useAppearanceStore } from '../theming/appearance.js';
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
 * The connection status dot RETIRED from the chrome (nav-ui-tweaks): the logo
 * slot and the product name are the only branding the header carries now.
 * Health detail lives in ONE place — the rail-foot HealthRailSection, opened
 * from its own header toggle (its ♥ glyph is colored by health there).
 *
 * The Ask entry took the slot the connection word once held (rail-header
 * restyle): a compact circular `?` button that opens the app-wide assist dock.
 */

interface Props {
  /** The rail's collapsed state: icon-only column instead of the header row. */
  collapsed: boolean;
  navigate: (path: string) => void;
  /** Opens the app-wide ASK dock (AskDock). The Ask entry renders only when the
   *  app wires this; the chrome never paints a dead door. The Ctrl/⌘+Shift+A
   *  chord does the same. */
  onOpenAsk?: () => void;
}

/**
 * The Ask entry — a compact CIRCULAR `?` button (nav-ui-tweaks) that opens the
 * app-wide assist dock (AskDock). Its OWN idiom, not a nav row and not a bell
 * sibling; the accent dress keeps it visually distinct. The chord
 * Ctrl/⌘+Shift+A does the same and is documented in the '?' overlay. Renders
 * only when the app wires `onOpenAsk` — the chrome never paints a dead door.
 */
const ASK_LABEL = 'Ask — governed answers about your projects, repos, and this studio (Ctrl/⌘+Shift+A)';
function AskEntry({ collapsed, onOpenAsk }: { collapsed: boolean; onOpenAsk: () => void }): React.ReactElement {
  // A circle either way; collapsed keeps the 28px hit target, expanded is a
  // touch smaller to sit inside the header row.
  const size = collapsed ? '28px' : '24px';
  return (
    <button
      type="button"
      data-testid="rail-ask"
      data-idiom="ask"
      aria-label={ASK_LABEL}
      aria-keyshortcuts="Control+Shift+A Meta+Shift+A"
      title="ask"
      onClick={onOpenAsk}
      className="flex items-center justify-center transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-1"
      style={{
        flexShrink: 0,
        width: size, height: size, padding: 0,
        borderRadius: 'var(--radius-full)',
        background: 'var(--accent-subtle)',
        border: '1px solid var(--accent)',
        color: 'var(--accent)',
      }}
    >
      <span aria-hidden style={{ fontSize: 'var(--text-xs)', lineHeight: 1, fontWeight: 'var(--weight-semi)' }}>?</span>
    </button>
  );
}

export function AppChrome({ collapsed, navigate, onOpenAsk }: Props): React.ReactElement {
  const logoUrl = useAppearanceStore((s) => s.appearance.logo_url);
  // The product name shown in the chrome (nav-ui-tweaks): a Settings override,
  // falling back to the default wordmark when unset.
  const siteName = useAppearanceStore((s) => s.appearance.site_name)?.trim() || DEFAULT_SITE_NAME;

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
        {onOpenAsk !== undefined && <AskEntry collapsed onOpenAsk={onOpenAsk} />}
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
        {siteName}
      </button>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexShrink: 0 }}>
        {onOpenAsk !== undefined && <AskEntry collapsed={false} onOpenAsk={onOpenAsk} />}
      </div>
    </div>
  );
}
