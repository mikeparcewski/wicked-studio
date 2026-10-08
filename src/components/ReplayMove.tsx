import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { replayPreviewLines, replayResultLine } from '../board/repairMoves.js';
import type { useDeadletterReplay } from '../hooks/useRepairMoves.js';

/**
 * The governance dead-letter Replay move (dry run first) and the repair popover it opens — moved
 * out of the classic command deck (S18c) because the Desk's chores row renders it (`desk/Desk.tsx`).
 */

const POP_W = 320;

/** The repair button on a tile (on its own line under the tile's rows), and its
 *  consequence popover — portalled, because the ribbon's panels clip their overflow. */
export function RepairShell({ kind, label, title, open, onOpen, children }: {
  kind: 'replay' | 'retry';
  label: string;
  /** What the move does, in full — the button's hover and accessible name. */
  title: string;
  open: boolean;
  onOpen: () => void;
  children: React.ReactNode;
}): React.ReactElement {
  const btn = useRef<HTMLButtonElement>(null);
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    if (!open || btn.current === null) return;
    const place = (): void => {
      const r = btn.current!.getBoundingClientRect();
      setAt({ top: r.bottom + 6, left: Math.max(8, Math.min(r.right - POP_W, window.innerWidth - POP_W - 8)) });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);
  return (
    <>
      <button ref={btn} type="button" className="deck-repair" data-testid="kpi-repair" data-repair={kind}
        aria-expanded={open} aria-label={title} title={title} onClick={onOpen}>
        {label}
      </button>
      {open && at !== null && createPortal(
        <div className="deck-repair-pop" role="dialog" aria-label={title} data-testid="kpi-repair-preview" data-repair={kind}
          style={{ top: at.top, left: at.left, width: POP_W }}>
          {children}
        </div>,
        document.body,
      )}
    </>
  );
}

export function RepairButtons({ confirm, onConfirm, onCancel, disabled }: {
  confirm: string | null;
  onConfirm?: () => void;
  onCancel: () => void;
  disabled?: boolean;
}): React.ReactElement {
  return (
    <div className="deck-repair-actions">
      {confirm !== null && (
        <button type="button" className="deck-repair-go" data-testid="kpi-repair-confirm" disabled={disabled} onClick={onConfirm}>
          {confirm}
        </button>
      )}
      <button type="button" className="deck-repair-cancel" data-testid="kpi-repair-cancel" onClick={onCancel}>
        {confirm === null ? 'Close' : 'Cancel'}
      </button>
    </div>
  );
}

/** Governed tile: "Replay" — a dry run first; the real replay only on confirm. */
export function ReplayMove({ replay }: { replay: ReturnType<typeof useDeadletterReplay> }): React.ReactElement {
  const s = replay.state;
  return (
    <RepairShell kind="replay" label="Replay ›" title="Replay the dead-lettered governance events (dry run first)" open={s.phase !== 'idle'} onOpen={() => void replay.preview()}>
      {s.phase === 'previewing' && <p className="deck-repair-line">Dry run: reading the outbox…</p>}
      {s.phase === 'preview' && (
        <>
          <p className="deck-repair-head">Dry run — nothing has moved yet</p>
          {replayPreviewLines(s.outcome).map((l) => <p key={l} className="deck-repair-line">{l}</p>)}
          <RepairButtons
            confirm={s.outcome.read > 0 ? `Replay ${s.outcome.read}` : null}
            disabled={s.outcome.blocker !== null}
            onConfirm={() => void replay.confirm()}
            onCancel={replay.dismiss}
          />
        </>
      )}
      {s.phase === 'replaying' && <p className="deck-repair-line">Replaying {s.preview.read}…</p>}
      {s.phase === 'done' && (
        <>
          <p className="deck-repair-line" data-testid="kpi-repair-result">{replayResultLine(s.outcome)}</p>
          <RepairButtons confirm={null} onCancel={replay.dismiss} />
        </>
      )}
      {s.phase === 'error' && (
        <>
          <p className="deck-repair-line" data-testid="kpi-repair-result">{s.message}</p>
          <RepairButtons confirm={null} onCancel={replay.dismiss} />
        </>
      )}
    </RepairShell>
  );
}
