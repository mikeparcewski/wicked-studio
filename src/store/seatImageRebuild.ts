import { create } from 'zustand';
import { ApiError } from '../api/errors.js';
import { rebuildSeatImages } from '../api/system.js';
import { HEALTH_RECHECKED } from './systemSnapshot.js';

interface SeatImageRebuildStore {
  phase: 'idle' | 'starting';
  refusal: string | null;
  start: () => Promise<void>;
}

/** studio#936: every rebuild button shares one request and its refusal. */
export const useSeatImageRebuild = create<SeatImageRebuildStore>((set, get) => ({
  phase: 'idle', refusal: null,
  start: async () => {
    if (get().phase === 'starting') return;
    set({ phase: 'starting', refusal: null });
    try {
      await rebuildSeatImages();
      window.dispatchEvent(new Event(HEALTH_RECHECKED));
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        window.dispatchEvent(new Event(HEALTH_RECHECKED));
      } else {
        const body = e instanceof ApiError ? e.body as { reason?: unknown; error?: unknown } | null : null;
        const reason = body?.reason ?? body?.error;
        set({ refusal: typeof reason === 'string' && reason !== '' ? reason : e instanceof Error ? e.message : String(e) });
      }
    } finally { set({ phase: 'idle' }); }
  },
}));
