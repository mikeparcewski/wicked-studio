import { create } from 'zustand';

export interface PendingGate {
  sessionId: string;
  phaseId: string;
  receivedAt: number;
}

interface GateStore {
  pendingGates: PendingGate[];
  addGate: (gate: PendingGate) => void;
  removeGate: (sessionId: string, phaseId: string) => void;
}

export const useGateStore = create<GateStore>((set) => ({
  pendingGates: [],
  addGate: (gate) => set((s) => ({ pendingGates: [...s.pendingGates, gate] })),
  removeGate: (sessionId, phaseId) =>
    set((s) => ({
      pendingGates: s.pendingGates.filter(
        (g) => !(g.sessionId === sessionId && g.phaseId === phaseId),
      ),
    })),
}));
