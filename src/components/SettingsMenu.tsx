import { useEffect, useRef } from 'react';

interface Props {
  onNavigate: (path: string) => void;
  onClose: () => void;
}

const ITEMS: { label: string; path: string }[] = [
  { label: 'Workflows', path: '/workflows' },
  { label: 'Policies', path: '/policies' },
  { label: 'Rules', path: '/rules' },
  { label: 'System', path: '/system' },
];

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
      className="absolute bottom-full left-0 mb-1 w-44 rounded-lg py-1 z-50"
      style={{
        background: '#1b222e',
        border: '1px solid rgba(230,237,243,0.1)',
        boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
      }}
      role="menu"
    >
      {ITEMS.map((item) => (
        <button
          key={item.path}
          type="button"
          role="menuitem"
          onClick={() => { onNavigate(item.path); onClose(); }}
          className="w-full text-left px-3 py-2 text-xs font-mono transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20 hover:bg-white/[0.06] hover:text-[#e6edf3] focus-visible:bg-white/[0.06] focus-visible:text-[#e6edf3]"
          style={{ color: 'rgba(230,237,243,0.6)' }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
