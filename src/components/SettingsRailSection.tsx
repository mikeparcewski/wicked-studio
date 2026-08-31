import { version } from '../../package.json';

/**
 * The Settings shortcut rows (DES-FEEDBACK-001 §1.2/§4.4, slice A — re-homed by
 * DES-FEEDBACK-003 §3.1, slice M): Settings is a PRIMARY heading in the rail's
 * five-path accordion now, and these rows are its expanded contents — the
 * slice-A list verbatim (rows + version line), moved, not redesigned. The old
 * rail-bottom wrapper (`rail-settings-section`) retired with the move; its
 * slot at the rail's foot goes to HealthRailSection (§6.2, slice O).
 *
 * This stays a SHORTCUT LIST — every row is a `navigate()` call to a settings
 * route that already exists (`/system`, `/theme`, …). It is NOT a parallel
 * settings surface (§1.2: "does NOT duplicate the settings route").
 */

/** The AppChrome-dropdown entries (SettingsMenu, retired) MINUS everything governance retired
 *  elsewhere: `Rules` (/rules) and `Arch Wiki` (/wiki) went to the Steering primary path with
 *  the STEERING program, and the steering-UX wave retired `Policies` (/policies — policies
 *  merged into steering rules; the address redirects to /steering) plus the orphaned
 *  `Coverage` (/coverage) and `Domain` (/domain) panels (both redirect to /system). */
export const SETTINGS_ITEMS: { label: string; path: string }[] = [
  { label: 'Theme', path: '/theme' },
  { label: 'Workflows', path: '/workflows' },
  { label: 'System', path: '/system' },
];

interface Props {
  navigate: (path: string) => void;
}

export function SettingsShortcutRows({ navigate }: Props): React.ReactElement {
  return (
    <div role="menu" className="flex flex-col pt-0.5">
      {SETTINGS_ITEMS.map((item) => (
        <button
          key={item.path}
          type="button"
          role="menuitem"
          onClick={() => navigate(item.path)}
          className="w-full text-left px-6 py-1.5 rounded text-xs font-mono transition-colors hover:bg-surface-raised hover:text-ink-body focus-visible:outline-none focus-visible:bg-surface-raised focus-visible:text-ink-body"
          style={{ color: 'var(--ink-muted)' }}
        >
          {item.label}
        </button>
      ))}
      {/* The quiet version row the retired dropdown carried — moved, not dropped.
          Read from package.json at build time so it can never go stale again
          (it sat hardcoded at "v0.3.2" while the app shipped 0.4.0). */}
      <p
        className="px-6 pt-1.5 pb-0.5 text-[10px] font-mono select-none"
        style={{ color: 'var(--ink-dim)', margin: 0 }}
      >
        {`v${version}`}
      </p>
    </div>
  );
}
