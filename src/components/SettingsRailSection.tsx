import { useState } from 'react';

/**
 * The rail's settings section (DES-FEEDBACK-001 §1.2, §4.4, slice A): the
 * expand/collapse block at the BOTTOM of the rail that carries everything the
 * AppChrome dropdown used to — the gear left the 48px chrome, its menu moved
 * here. Collapsed by default; the chevron rotates 90° on expand
 * (`transition: transform var(--dur-fast)`); the header reads `--ink-muted`
 * collapsed and `--ink-high` open.
 *
 * This is a persistent in-rail SHORTCUT LIST — every row is a `navigate()`
 * call to a settings route that already exists (`/system`, `/theme`, …).
 * It is NOT a parallel settings surface (§1.2: "does NOT duplicate the
 * settings route").
 */

/** The exact entries the AppChrome dropdown exposed (SettingsMenu, retired). */
export const SETTINGS_ITEMS: { label: string; path: string }[] = [
  { label: 'Theme', path: '/theme' },
  { label: 'Coverage', path: '/coverage' },
  { label: 'Domain', path: '/domain' },
  { label: 'Workflows', path: '/workflows' },
  { label: 'Policies', path: '/policies' },
  { label: 'Rules', path: '/rules' },
  { label: 'System', path: '/system' },
];

interface Props {
  navigate: (path: string) => void;
}

export function SettingsRailSection({ navigate }: Props): React.ReactElement {
  const [open, setOpen] = useState(false);

  return (
    <div
      data-testid="rail-settings-section"
      data-open={open}
      className="shrink-0 px-2 pb-2 pt-1"
      style={{ borderTop: '1px solid var(--surface-raised)' }}
    >
      <button
        type="button"
        data-testid="rail-settings-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
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
          data-testid="rail-settings-chevron"
          className="inline-block leading-none"
          style={{
            transition: 'transform var(--dur-fast)',
            transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
          }}
        >
          ›
        </span>
        <span aria-hidden>⚙</span>
        <span>Settings</span>
      </button>
      {open && (
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
          {/* The quiet version row the retired dropdown carried — moved, not dropped. */}
          <p
            className="px-6 pt-1.5 pb-0.5 text-[10px] font-mono select-none"
            style={{ color: 'var(--ink-dim)', margin: 0 }}
          >
            v0.3.2
          </p>
        </div>
      )}
    </div>
  );
}
