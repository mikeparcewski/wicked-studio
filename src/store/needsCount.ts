import { create } from 'zustand';

/** The app-wide settled needs count, published by App for voice to read. */
export const useNeedsCount = create<{
  phase: 'loading' | 'complete' | 'partial';
  count: number | null;
}>(() => ({ phase: 'loading', count: null }));
