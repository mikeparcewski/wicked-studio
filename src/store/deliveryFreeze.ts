import { create } from 'zustand';
import { deliveryFreezeApi, type DeliveryFreezeState } from '../api/deliveryFreeze.js';

/**
 * Freeze deliveries (Wave C, idea 15) — the daemon's one switch, as the app holds it. Read once at
 * boot (App), after every change made here, and whenever an approve comes back
 * `deliveries_frozen` (someone else froze it), so the status bar's banner is the daemon's truth.
 *
 * `status`: `unknown` before the first read; `absent` when the daemon cannot say (a daemon
 * predating the route, or a failed read) — the switch is then not drawn, never a dead button;
 * `ready` with the daemon's state.
 */
interface DeliveryFreezeStore {
  status: 'unknown' | 'absent' | 'ready';
  state: DeliveryFreezeState | null;
  busy: boolean;
  /** The last refused change, in the daemon's words; cleared by the next attempt. */
  error: string | null;
  load: () => Promise<void>;
  set: (frozen: boolean, reason?: string) => Promise<boolean>;
}

export const useDeliveryFreezeStore = create<DeliveryFreezeStore>((set) => ({
  status: 'unknown',
  state: null,
  busy: false,
  error: null,
  load: async () => {
    try {
      const state = await deliveryFreezeApi.get();
      set({ status: 'ready', state });
    } catch {
      set((s) => (s.status === 'ready' ? s : { status: 'absent', state: null }));
    }
  },
  set: async (frozen, reason) => {
    set({ busy: true, error: null });
    try {
      const trimmed = reason?.trim();
      const state = await deliveryFreezeApi.put(
        frozen && trimmed !== undefined && trimmed !== '' ? { frozen, reason: trimmed } : { frozen },
      );
      set({ status: 'ready', state, busy: false });
      return true;
    } catch (e) {
      set({ busy: false, error: e instanceof Error ? e.message : String(e) });
      return false;
    }
  },
}));
