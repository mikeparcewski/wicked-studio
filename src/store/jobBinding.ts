import { create } from 'zustand';

/**
 * THE COMPOSER'S ONE BINDING for a job (DES-CATALOG-002 §2.4, rev 6 §2.7.6 "one binding at a time"): Change at a held
 * plan (the send-back), or a question that is answered in words (a QE skip's reason, a missing text input), binds the
 * session's composer. The composer shows "Answering: …" with × to leave, and its next Send goes to the job instead of
 * the chat — but only while the job is still what the binding was made on (`instance`, the press target): if the plan
 * moved or the proposal was replaced since, nothing is sent and the box says why.
 */
export interface JobBinding {
  /** The session whose composer is bound. */
  sessionId: string;
  /** The reply that bound it, for the passage's "Change · answering" mark. */
  replyKey: string;
  /** "Answering: what should change in plan v1". */
  label: string;
  placeholder: string;
  /** The target the binding answers (a pid, or `plan:<run>:<ord>:<planRev>`). */
  instance: string;
  /** The target now (read at Send): a binding whose target moved sends nothing. */
  current: () => string | null;
  send: (text: string) => void;
}

interface JobBindingStore {
  binding: JobBinding | null;
  bind: (b: JobBinding) => void;
  /** Leave the binding (×, Escape, or the job moved on). Only the given reply's binding is cleared when one is named. */
  clear: (replyKey?: string) => void;
}

export const useJobBinding = create<JobBindingStore>((set, get) => ({
  binding: null,
  bind: (b) => set({ binding: b }),
  clear: (replyKey) => {
    const cur = get().binding;
    if (cur === null || (replyKey !== undefined && cur.replyKey !== replyKey)) return;
    set({ binding: null });
  },
}));

/** Put the session composer's caret in its box (the binding was just made by a press in the passage). */
export function focusSessionComposer(): void {
  const el = document.querySelector<HTMLTextAreaElement>('[data-testid="session-composer-input"]');
  el?.focus();
}
