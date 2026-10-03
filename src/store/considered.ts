import { create } from 'zustand';
import {
  consideredApi, isConsideredUnsupported, turnConsideredKey, unitConsideredKey, type Consideration,
} from '../api/considered.js';

/**
 * The Considerations studio has read (DC-S8): one per chat turn or run step, by crew's own key
 * (`considered:<chat>:<turn>` / `considered:<run>:<ord>:<attempt>`). A read is made when a turn's
 * replies have landed or a step's sheet opens, and again when the turn gains a reply (the component
 * asks; the store only de-duplicates reads in flight). `null` = the daemon holds no such turn or
 * unit (404), so the line draws nothing; `unsupported` = a daemon before DC-S7, nothing is asked
 * again this session. A refused read (403: the actor is below operator) or a failed one also draws
 * nothing — the line is a quiet decoration, never a plausible count standing in for the real one.
 *
 * The rule page's "Where it was considered" (B11) is read from this same store: everything studio
 * has read whose considered, cited or set-aside list names the rule.
 */

interface ConsideredStore {
  byKey: Record<string, Consideration | null>;
  unsupported: boolean;
  loadTurn: (chatId: string, turnId: string) => Promise<void>;
  loadUnit: (runId: string, ord: number, attempt?: number) => Promise<void>;
}

const inflight = new Map<string, Promise<void>>();

export const useConsideredStore = create<ConsideredStore>((set, get) => {
  const read = (key: string, fn: () => Promise<Consideration>): Promise<void> => {
    if (get().unsupported) return Promise.resolve();
    const running = inflight.get(key);
    if (running !== undefined) return running;
    const p = fn()
      .then((c) => { set((s) => ({ byKey: { ...s.byKey, [key]: c } })); })
      .catch((e: unknown) => {
        if (isConsideredUnsupported(e)) set({ unsupported: true });
        else set((s) => ({ byKey: { ...s.byKey, [key]: null } }));
      })
      .finally(() => { inflight.delete(key); });
    inflight.set(key, p);
    return p;
  };
  return {
    byKey: {},
    unsupported: false,
    loadTurn: (chatId, turnId) => read(turnConsideredKey(chatId, turnId), () => consideredApi.turn(chatId, turnId)),
    loadUnit: (runId, ord, attempt = 0) => read(unitConsideredKey(runId, ord, attempt), () => consideredApi.unit(runId, ord, attempt)),
  };
});

/** Every Consideration read so far that names `ruleId` (considered, cited or set aside). */
export function considerationsNaming(byKey: Record<string, Consideration | null>, ruleId: string): Consideration[] {
  return Object.values(byKey).filter((c): c is Consideration => c !== null
    && (c.considered.some((r) => r.id === ruleId) || c.cited.some((x) => x.id === ruleId) || c.set_aside.some((s) => s.id === ruleId)));
}

/** Tests: start from nothing. */
export function resetConsideredStoreForTest(): void {
  inflight.clear();
  useConsideredStore.setState({ byKey: {}, unsupported: false });
}
