import { create } from 'zustand';
import {
  decisionsApi, isDecisionsUnsupported,
  type ChatDecisionsFrame, type DecisionChangedFrame, type DecisionDismissReason, type DecisionsMode, type DecisionView,
} from '../api/decisions.js';

/**
 * Decision capture's app-wide fold (DC-S6): every {@link DecisionView} studio has seen, by id, and
 * the ids each chat turn produced. Fed by the transcript (`GET /chats/:id` `decisions` records,
 * on a session's load — so a reload restores every line), by `/ws` `chatDecisions` frames (the
 * live line under the message the operator just sent) and by `decisionChanged` frames (ids only:
 * the view is re-read from `GET /decisions`, never guessed).
 *
 * `mode` is the daemon's `WICKED_DECISIONS` switch, read once from `GET /decisions` at startup:
 * `null` until it answers, and `'off'` on a daemon without the route (nothing is drawn).
 */

interface DecisionsStore {
  mode: DecisionsMode | null;
  loaded: boolean;
  byId: Record<string, DecisionView>;
  /** `${chatId}\u0000${turnId}` → decision ids, in the order they arrived. */
  byTurn: Record<string, string[]>;
  /** An action in flight per decision id (Remember / Undo / …), so a button is pressed once. */
  busy: Record<string, true>;
  /** The last refusal per decision id, in the daemon's words. */
  error: Record<string, string>;
  load: () => Promise<void>;
  /** A transcript's `decisions` records (or a live frame): remember the views and the turn they belong to.
   *  A view already held is kept (a transcript snapshot is as old as the turn; the ledger's outcome
   *  may be newer) — `syncChat` then re-reads the ledger's current views for the chat. */
  ingestTurn: (chatId: string, turnId: string, items: readonly DecisionView[]) => void;
  /** The ledger's CURRENT views for a chat (`GET /decisions?chat=`), read once per chat and again
   *  on demand: a transcript's `decisions` records carry the state at recording time, so a reload
   *  must not restore a chip for a decision remembered or undone since. */
  syncChat: (chatId: string) => Promise<void>;
  /** The `/ws` frames; anything else is ignored. */
  ingest: (frame: { type: string } & Record<string, unknown>) => void;
  /** Re-read one decision after a change (ids only came over the wire). */
  refresh: (id: string) => Promise<void>;
  /** The remembered decisions since `sinceMs` (the Desk's sentence), newest first. */
  loadRemembered: (sinceMs: number | null) => Promise<DecisionView[]>;
  remember: (id: string) => Promise<void>;
  undo: (id: string) => Promise<void>;
  dismiss: (id: string, reason: DecisionDismissReason) => Promise<void>;
  same: (id: string, same: boolean) => Promise<void>;
  widen: (id: string) => Promise<void>;
}

export const turnKey = (chatId: string, turnId: string): string => `${chatId}\u0000${turnId}`;

let inflight: Promise<void> | null = null;
/** Chats whose ledger views were read this session (`syncChat`). */
const synced = new Set<string>();
/** A monotonic order over "a read started" and "a decision changed on good authority" (an action
 *  answered here, or a `decisionChanged` frame). Never wall-clock: two events in one millisecond
 *  must still order. A read applies a view only when the decision was not touched after the read
 *  started, so a late response never steps a decision back. */
let clock = 0;
const tick = (): number => ++clock;
const touched = new Map<string, number>();
/** The views a read that started at `startedAt` may apply. */
function freshOf(views: readonly DecisionView[], startedAt: number): Record<string, DecisionView> {
  return Object.fromEntries(views.filter((d) => (touched.get(d.id) ?? 0) < startedAt).map((d) => [d.id, d]));
}
const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export const useDecisionsStore = create<DecisionsStore>((set, get) => {
  const act = async (id: string, fn: () => Promise<unknown>, optimistic?: Partial<DecisionView>): Promise<void> => {
    if (get().busy[id]) return;
    set((s) => ({ busy: { ...s.busy, [id]: true }, error: Object.fromEntries(Object.entries(s.error).filter(([k]) => k !== id)) }));
    try {
      await fn();
      touched.set(id, tick());
      if (optimistic !== undefined) {
        set((s) => {
          const cur = s.byId[id];
          return cur === undefined ? {} : { byId: { ...s.byId, [id]: { ...cur, ...optimistic } } };
        });
      }
      await get().refresh(id);
    } catch (e) {
      set((s) => ({ error: { ...s.error, [id]: msg(e) } }));
    } finally {
      set((s) => ({ busy: Object.fromEntries(Object.entries(s.busy).filter(([k]) => k !== id)) as Record<string, true> }));
    }
  };

  return {
    mode: null,
    loaded: false,
    byId: {},
    byTurn: {},
    busy: {},
    error: {},

    load: () => {
      if (get().loaded) return Promise.resolve();
      const startedAt = tick();
      inflight ??= decisionsApi.list({ since: Date.now() - 24 * 3_600_000 })
        .then((r) => {
          set((s) => ({ loaded: true, mode: r.mode, byId: { ...s.byId, ...freshOf(r.decisions, startedAt) } }));
        })
        .catch((e: unknown) => { set({ loaded: true, mode: isDecisionsUnsupported(e) ? 'off' : get().mode }); })
        .finally(() => { inflight = null; });
      return inflight;
    },

    ingestTurn: (chatId, turnId, items) => {
      if (items.length === 0) return;
      set((s) => {
        const key = turnKey(chatId, turnId);
        const have = s.byTurn[key] ?? [];
        const ids = [...have, ...items.map((d) => d.id).filter((id) => !have.includes(id))];
        // Never step a held view back: a snapshot is as old as its turn, the held one came later
        // (a frame, an action's re-read, or a sync).
        const fresh = Object.fromEntries(items.filter((d) => s.byId[d.id] === undefined).map((d) => [d.id, d]));
        return { byId: { ...s.byId, ...fresh }, byTurn: { ...s.byTurn, [key]: ids } };
      });
    },

    syncChat: async (chatId) => {
      if (synced.has(chatId)) return;
      synced.add(chatId);
      const startedAt = tick();
      try {
        const r = await decisionsApi.list({ chat: chatId });
        set((s) => ({ mode: r.mode, loaded: true, byId: { ...s.byId, ...freshOf(r.decisions, startedAt) } }));
      } catch (e) {
        synced.delete(chatId);
        if (isDecisionsUnsupported(e)) set({ loaded: true, mode: 'off' });
      }
    },

    ingest: (frame) => {
      if (frame.type === 'chatDecisions') {
        const f = frame as unknown as ChatDecisionsFrame;
        if (typeof f.chat === 'string' && typeof f.turn_id === 'string' && Array.isArray(f.items)) get().ingestTurn(f.chat, f.turn_id, f.items);
      } else if (frame.type === 'decisionChanged') {
        const f = frame as unknown as DecisionChangedFrame;
        if (typeof f.id === 'string') {
          // The frame carries ids only; the state is applied at once (so Undo elsewhere shows here),
          // then the full view is re-read. The frame is authority: a read in flight is older.
          touched.set(f.id, tick());
          set((s) => {
            const cur = s.byId[f.id];
            return cur === undefined ? {} : { byId: { ...s.byId, [f.id]: { ...cur, state: f.state, ...(f.rule_id !== undefined ? { rule_id: f.rule_id } : {}) } } };
          });
          void get().refresh(f.id);
        }
      }
    },

    refresh: async (id) => {
      const cur = get().byId[id];
      if (cur === undefined) return;
      const startedAt = tick();
      try {
        const filter = cur.origin.chat_id !== undefined ? { chat: cur.origin.chat_id } : cur.origin.run_id !== undefined ? { run: cur.origin.run_id } : {};
        const r = await decisionsApi.list(filter);
        const next = r.decisions.find((d) => d.id === id);
        set((s) => ({ mode: r.mode, byId: next === undefined ? s.byId : { ...s.byId, ...freshOf([next], startedAt) } }));
      } catch {
        /* the optimistic state stands; the next frame or load corrects it */
      }
    },

    loadRemembered: async (sinceMs) => {
      const startedAt = tick();
      try {
        const r = await decisionsApi.list({ state: 'remembered', ...(sinceMs !== null ? { since: sinceMs } : {}) });
        set((s) => ({ mode: r.mode, loaded: true, byId: { ...s.byId, ...freshOf(r.decisions, startedAt) } }));
        return r.decisions;
      } catch (e) {
        if (isDecisionsUnsupported(e)) set({ loaded: true, mode: 'off' });
        return [];
      }
    },

    remember: (id) => act(id, () => decisionsApi.remember(id), { state: 'remembered', how: 'chip' }),
    undo: (id) => act(id, () => decisionsApi.undo(id), { state: 'undone' }),
    dismiss: (id, reason) => act(id, () => decisionsApi.dismiss(id, reason), { state: 'dismissed' }),
    same: (id, same) => act(id, () => decisionsApi.same(id, same), same ? { state: 'restated' } : { route: 'offer' }),
    widen: (id) => act(id, () => decisionsApi.widen(id), { state: 'widened' }),
  };
});

/** Tests: start from nothing. */
export function resetDecisionsStoreForTest(): void {
  inflight = null;
  synced.clear();
  touched.clear();
  clock = 0;
  useDecisionsStore.setState({ mode: null, loaded: false, byId: {}, byTurn: {}, busy: {}, error: {} });
}
