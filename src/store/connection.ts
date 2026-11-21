import { create } from 'zustand';

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

interface ConnectionStore {
  status: ConnectionStatus;
  /** How many times the live socket came BACK (connected after a disconnect). The live stream has no replay, so frames
   *  sent while it was down are lost: a run's held event log is read again in each new epoch (studio#1009). */
  epoch: number;
  setStatus: (status: ConnectionStatus) => void;
}

export const useConnectionStore = create<ConnectionStore>((set) => ({
  status: 'connecting',
  epoch: 0,
  setStatus: (status) => set((s) => ({ status, epoch: status === 'connected' && s.status === 'disconnected' ? s.epoch + 1 : s.epoch })),
}));
