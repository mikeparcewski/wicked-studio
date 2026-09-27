import { useCallback, useRef, useState } from 'react';
import { approveProposal } from '../api/proposals.js';
import { acceptMemoryPreview } from '../board/proposalTriage.js';
import { queueDecision, reportDecision, undoDecision } from '../board/undoQueue.js';
import { useNeedsSources } from '../store/needsSources.js';

/**
 * The proposal group's "Accept N memory-only" (studio Wave B, idea 4): PREVIEW exactly which
 * proposals, then COMMIT into the shared undo window (`board/undoQueue.ts`, the gate decisions'
 * 10 s window and toast), and only when the window ends POST each one through the EXISTING
 * `POST /proposals/:id/approve`. What the preview named is exactly what is sent: the list is
 * snapshot at open. Undo (or closing the tab inside the window) sends nothing. Skins render the
 * states; they never post.
 */

export interface AcceptItem {
  id: string;
  /** The proposal's body line, as the queue row shows it. */
  subject: string;
}

export type AcceptMemoryState =
  | { phase: 'idle' }
  /** The snapshot the operator is looking at; `staying` stay for individual review. */
  | { phase: 'preview'; items: readonly AcceptItem[]; staying: number }
  | { phase: 'queued'; undoId: number; count: number }
  | { phase: 'sending'; done: number; total: number };

export interface AcceptMemory {
  state: AcceptMemoryState;
  /** Show the preview for exactly these proposals. */
  open: (items: readonly AcceptItem[], staying: number) => void;
  /** Close the preview; nothing is queued. */
  cancel: () => void;
  /** Queue the previewed set behind the undo window. */
  confirm: () => void;
  /** Undo a queued accept (the toast's Undo does the same). */
  undo: () => void;
}

const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export const ACCEPT_CLOSE_NOTE = 'Close this tab before then and nothing is sent: the proposals stay pending.';

/** Accept each proposal in turn through the existing approve route; a refusal names its id. */
export async function acceptProposals(
  ids: readonly string[],
  onProgress?: (done: number) => void,
): Promise<{ accepted: number; failures: Array<{ id: string; error: string }> }> {
  const failures: Array<{ id: string; error: string }> = [];
  let accepted = 0;
  for (const [i, id] of ids.entries()) {
    try {
      await approveProposal(id);
      accepted += 1;
    } catch (err) {
      failures.push({ id, error: errText(err) });
    }
    onProgress?.(i + 1);
  }
  return { accepted, failures };
}

export function useAcceptMemory(): AcceptMemory {
  const [state, setState] = useState<AcceptMemoryState>({ phase: 'idle' });
  const stateRef = useRef(state);
  stateRef.current = state;

  const open = useCallback((items: readonly AcceptItem[], staying: number) => {
    if (stateRef.current.phase !== 'idle' && stateRef.current.phase !== 'preview') return;
    if (items.length === 0) return;
    setState({ phase: 'preview', items: [...items], staying });
  }, []);

  const cancel = useCallback(() => {
    if (stateRef.current.phase === 'preview') setState({ phase: 'idle' });
  }, []);

  const confirm = useCallback(() => {
    const s = stateRef.current;
    if (s.phase !== 'preview') return;
    const ids = s.items.map((i) => i.id);
    const n = ids.length;
    const undoId = queueDecision({
      verb: 'approve',
      runIds: [],
      label: `${n} memory-only proposal${n === 1 ? '' : 's'}`,
      preview: acceptMemoryPreview(n, s.staying),
      closeNote: ACCEPT_CLOSE_NOTE,
      commit: async () => {
        setState({ phase: 'sending', done: 0, total: n });
        const { accepted, failures } = await acceptProposals(ids, (done) => setState({ phase: 'sending', done, total: n }));
        if (failures.length === 0) {
          reportDecision('sent', `Accepted ${accepted} memory-only proposal${accepted === 1 ? '' : 's'}.`);
        } else {
          reportDecision(
            'failed',
            `Accepted ${accepted} of ${n}; ${failures.length} refused: ${failures.map((f) => `${f.id}: ${f.error}`).join('; ')}`,
          );
        }
        setState({ phase: 'idle' });
        // Re-read the queue: the accepted ones leave it, the ones to review stay.
        await useNeedsSources.getState().load(0);
      },
      onUndo: () => setState({ phase: 'idle' }),
    });
    setState({ phase: 'queued', undoId, count: n });
  }, []);

  const undo = useCallback(() => {
    const s = stateRef.current;
    if (s.phase === 'queued') undoDecision(s.undoId);
  }, []);

  return { state, open, cancel, confirm, undo };
}
