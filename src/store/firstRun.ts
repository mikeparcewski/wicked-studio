import { create } from 'zustand';
import { apiFetch } from '../api/client.js';
import { FIRST_RUN_KEY, readFirstRun, type FirstRunState, type SetupAnswer, type SetupAskKey } from '../board/learnHub.js';

/**
 * `studio.firstRun` (program DES-LEARN §3.0, §4): when Learn was first used (it moves below Evaluate, for
 * good), whether setup was ignored or finished, and each setup answer. Kept in crew's settings (the
 * `studio.setup` mechanism) so it holds across browsers. Writes are serialized and optimistic: a failed
 * write rolls back and says so (`saveFailed`).
 */
export interface FirstRunStore {
  state: FirstRunState;
  read: 'idle' | 'loading' | 'ok' | 'failed';
  saveFailed: boolean;
  load: () => Promise<void>;
  /** Merge a patch (answers merge by key) and persist it. Resolves true when crew took it. */
  save: (patch: FirstRunState) => Promise<boolean>;
  /** §3.0: the first use of Learn. Set once, never cleared. */
  markLearnUsed: () => Promise<void>;
  answer: (key: SetupAskKey, a: SetupAnswer, done?: boolean) => Promise<boolean>;
  /** §4.4: Ignore setup (on) or Undo (off). */
  ignore: (on: boolean) => Promise<boolean>;
}

let inflight: Promise<void> | null = null;
let chain: Promise<unknown> = Promise.resolve();

function merge(a: FirstRunState, b: FirstRunState): FirstRunState {
  const answers = { ...(a.answers ?? {}), ...(b.answers ?? {}) };
  return { ...a, ...b, ...(Object.keys(answers).length > 0 ? { answers } : {}) };
}

export const useFirstRun = create<FirstRunStore>((set, get) => ({
  state: {},
  read: 'idle',
  saveFailed: false,
  load: () => {
    if (inflight !== null) return inflight;
    set((s) => (s.read === 'ok' ? s : { read: 'loading' }));
    inflight = readSettings()
      .then((r) => {
        // A write made here before the read landed wins over the read (it is newer).
        set((s) => ({ state: merge(readFirstRun(r?.settings), s.state), read: 'ok' }));
      })
      .catch(() => set((s) => (s.read === 'ok' ? s : { read: 'failed' })))
      .finally(() => { inflight = null; });
    return inflight;
  },
  save: (patch) => write(merge(get().state, patch)),
  markLearnUsed: async () => {
    if (get().state.learnUsedAt !== undefined) return;
    await get().save({ learnUsedAt: Date.now() });
  },
  answer: (key, a, done = false) => get().save({ answers: { [key]: a }, ...(done ? { completedAt: Date.now() } : {}) }),
  ignore: (on) => {
    const rest = { ...get().state };
    delete rest.ignoredAt;
    return write(on ? { ...rest, ignoredAt: Date.now() } : rest);
  },
}));

/** `GET /settings`, never throwing synchronously (a host whose client is stubbed answers a rejection). */
function readSettings(): Promise<{ settings?: Record<string, unknown> }> {
  try {
    return apiFetch<{ settings?: Record<string, unknown> }>('/settings');
  } catch (e) {
    return Promise.reject(e);
  }
}

/** Persist the whole blob: optimistic, serialized; a failed write rolls back to what was there and says so. */
function write(next: FirstRunState): Promise<boolean> {
  const before = useFirstRun.getState().state;
  useFirstRun.setState({ state: next, saveFailed: false });
  const w = chain.then(() => apiFetch<{ settings: Record<string, unknown> }>('/settings', {
    method: 'PUT',
    body: JSON.stringify({ [FIRST_RUN_KEY]: useFirstRun.getState().state }),
  })).then(() => true, () => {
    useFirstRun.setState({ state: before, saveFailed: true });
    return false;
  });
  chain = w;
  return w;
}

/** Tests only. */
export function resetFirstRun(): void {
  inflight = null;
  chain = Promise.resolve();
  useFirstRun.setState({ state: {}, read: 'idle', saveFailed: false });
}
