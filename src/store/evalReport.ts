import { create } from 'zustand';
import type { EvalMemoryAxis, EvalReport } from '../api/testing.js';

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
  /** When the report landed (ms epoch) — for display only, never for ordering. */
  at: number;
  /** Its place in this tab's read/run sequence ({@link nextEvalSeq}): only a history read that
   *  STARTED after it landed can supersede it (codex r3 #1). */
  seq: number;
}

let evalSeq = 0;
/** One counter for this tab's eval deposits and history reads: orders them without any clock. */
export function nextEvalSeq(): number { evalSeq += 1; return evalSeq; }

/** (studio#1301) The memory axis of the last run made in this tab, with when it landed. The history keeps no memory
 *  axis (crew records only the results), so this outlives the deposit's supersession: the store's coverage is only ever
 *  known from a run's own answer. `axis: null` = that run had no memory store. Absent key on an older crew: not kept. */
export interface EvalMemoryDeposit {
  axis: EvalMemoryAxis | null;
  at: number;
}

interface EvalReportState {
  latest: EvalDeposit | null;
  memory: EvalMemoryDeposit | null;
  deposit: (report: EvalReport, corpus: string | null) => void;
}

export const useEvalReportStore = create<EvalReportState>((set) => ({
  latest: null,
  memory: null,
  deposit: (report, corpus) => {
    const at = Date.now();
    set({ latest: { report, corpus, at, seq: nextEvalSeq() }, memory: report.memory !== undefined ? { axis: report.memory, at } : null });
  },
}));
