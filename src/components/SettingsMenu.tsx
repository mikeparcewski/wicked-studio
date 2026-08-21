import { useEffect, useRef } from 'react';

interface Props {
  onNavigate: (path: string) => void;
  onClose: () => void;
}

const ITEMS: { label: string; path: string }[] = [
  { label: 'Coverage', path: '/coverage' },
  { label: 'Domain', path: '/domain' },
  { label: 'Workflows', path: '/workflows' },
  { label: 'Policies', path: '/policies' },
  { label: 'Rules', path: '/rules' },
  { label: 'System', path: '/system' },
];

/**
 * The settings popover, anchored to the chrome's gear (DES-VISION-001 §6.3
 * slice 3). It opens DOWNWARD now — the gear moved from the rail footer into
 * the app chrome — and its colors are the token contract's (§2.11): a raised
 * overlay surface, ink-ramp text, no raw values. The version tag the old rail
 * footer carried rides along as the menu's quiet last row.
 */
export function SettingsMenu({ onNavigate, onClose }: Props): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute top-full left-0 mt-1 w-44 rounded-lg py-1 z-50"
      style={{
        background: 'var(--surface-overlay)',
        border: '1px solid var(--surface-raised)',
        boxShadow: 'var(--shadow-overlay)',
      }}
      role="menu"
    >
      {ITEMS.map((item) => (
        <button
          key={item.path}
          type="button"
          role="menuitem"
          onClick={() => { onNavigate(item.path); onClose(); }}
          className="w-full text-left px-3 py-2 text-xs font-mono transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-dim hover:bg-surface-raised hover:text-ink-body focus-visible:bg-surface-raised focus-visible:text-ink-body"
          style={{ color: 'var(--ink-muted)' }}
        >
          {item.label}
        </button>
      ))}
      <p
        className="px-3 pt-1.5 pb-0.5 text-[10px] font-mono select-none"
        style={{ color: 'var(--ink-dim)', margin: 0 }}
      >
        v0.3.2
      </p>
    </div>
  );
}
