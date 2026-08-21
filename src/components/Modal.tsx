import { useId, useEffect } from 'react';
import type { ReactNode } from 'react';

interface Props {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Opt out of the document-level Escape-to-close handler (e.g. modals that embed a terminal). */
  disableEscapeKey?: boolean;
}

export function Modal({ title, onClose, children, disableEscapeKey }: Props): React.ReactElement {
  const titleId = useId();

  useEffect(() => {
    if (disableEscapeKey) return;
    function handler(e: KeyboardEvent): void { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose, disableEscapeKey]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'var(--scrim)' }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative w-[90vw] h-[80vh] rounded-xl flex flex-col shadow-2xl"
        style={{ background: 'var(--surface-card)', border: '1px solid var(--surface-raised)' }}
      >
        <div
          className="flex items-center justify-between px-4 py-3 shrink-0"
          style={{ borderBottom: '1px solid var(--surface-raised)' }}
        >
          <h2 id={titleId} className="text-sm font-semibold font-mono" style={{ color: 'var(--ink-high)' }}>{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-lg leading-none transition-colors"
            style={{ color: 'var(--ink-dim)' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--ink-high)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--ink-dim)'; }}
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-auto p-4">{children}</div>
      </div>
    </div>
  );
}
