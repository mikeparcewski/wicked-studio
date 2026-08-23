import { useId, useEffect } from 'react';
import type { ReactNode } from 'react';
import { useLayerStore } from '../store/layers.js';

interface Props {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

/**
 * The modal family's document-level Escape listener (EC21-exempt: local, not
 * registry-routed, so it fires even from typing contexts inside the modal).
 * DES-UX-001 §7.7 (slice AC) made it universal — the former `disableEscapeKey`
 * opt-out is gone: ONE Escape contract closes every layer, the Operator-shell
 * and sign-in terminals included. The one yield is the '?' overlay, which sits
 * above modals in the §7.7 chain and closes first.
 */
export function Modal({ title, onClose, children }: Props): React.ReactElement {
  const titleId = useId();

  useEffect(() => {
    function handler(e: KeyboardEvent): void {
      if (e.key !== 'Escape') return;
      if (useLayerStore.getState().shortcutOverlayOpen) return; // overlay closes first
      onClose();
    }
    // CAPTURE phase: an embedded widget (xterm cancels the keydown it handles)
    // must not be able to eat the contract — Escape closes the modal, always.
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [onClose]);
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
