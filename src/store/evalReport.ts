import { create } from 'zustand';
import type { EvalReport } from '../api/testing.js';

/**
 * The LATEST steering-eval report this session ran (Testing › Evals deposits it after a
 * successful `POST /testing/evals/run`). The daemon keeps no queryable eval history — the
 * run wire is a POST that computes and answers — so the Steering landing's success-lens
 * tile reads THIS session-local deposit, and renders the honest absent state ("no eval run
 * this session") when nothing has run. Never persisted: a stored report would relabel a
 * stale verdict as current.
 */

export interface EvalDeposit {
  report: EvalReport;
  /** What the report ran against (`null` = the built-in default corpus). */
  corpus: string | null;
  /** When the report landed (ms epoch). */
  at: number;
}

interface EvalReportState {
  latest: EvalDeposit | null;
  deposit: (report: EvalReport, corpus: string | null) => void;
}

export const useEvalReportStore = create<EvalReportState>((set) => ({
  latest: null,
  deposit: (report, corpus) => set({ latest: { report, corpus, at: Date.now() } }),
}));
