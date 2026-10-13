import { create } from 'zustand';
import type { SteeringType } from '../api/steering.js';

/**
 * The hand-off from Evaluate's "Draft rules" to Steer's assistant (DES-steer-eval §3.3): the
 * request text lands in the steering assistant's composer for the gap's type. The Steer surface
 * takes it once (`take`) and opens the assistant with it typed in — the operator sends it. No
 * request is made here; a reload drops an untaken seed.
 */
interface SteerDraftState {
  seed: { type: SteeringType; text: string; at: number } | null;
  put: (type: SteeringType, text: string) => void;
  take: () => { type: SteeringType; text: string; at: number } | null;
}

export const useSteerDraft = create<SteerDraftState>((set, get) => ({
  seed: null,
  put: (type, text) => set({ seed: { type, text, at: Date.now() } }),
  take: () => {
    const s = get().seed;
    if (s !== null) set({ seed: null });
    return s;
  },
}));
