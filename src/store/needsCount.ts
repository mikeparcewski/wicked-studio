import { create } from 'zustand';
import type { NeedRow } from '../board/needsYou.js';

/** The app-wide settled needs count, published by App for voice to read, and the needs rows it folds (studio#1438:
 *  a voice question names them on a crew without a ranked list). */
export const useNeedsCount = create<{
  phase: 'loading' | 'complete' | 'partial';
  count: number | null;
  rows: readonly NeedRow[];
}>(() => ({ phase: 'loading', count: null, rows: [] }));
