import { create } from 'zustand';

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

interface ConnectionStore {
  status: ConnectionStatus;
  setStatus: (status: ConnectionStatus) => void;
}

export const useConnectionStore = create<ConnectionStore>((set) => ({
  status: 'connecting',
  setStatus: (status) => set({ status }),
}));
