import type { EvalMemoryResult, EvalResult } from '../api/testing.js';
import type { EvalMemoryDeposit } from '../store/evalReport.js';

/**
 * studio#1301 (crew#1128, core#397): the memory axis of a governance eval run, as Evaluate says it. Pure.
 *
 * Two sources, each said for what it is:
 *  - each sample's `memory` verdict rides the results, which the run history keeps verbatim, so the counts are read
 *    from the results (they are the axis summary's own counts: the samples that declare memories, by verdict);
 *  - the store's coverage (how many memories any sample's recall surfaced, and which never did) and "this run had no
 *    memory store" are only in a run's own answer (`report.memory`), which the history does not keep: they are shown
 *    from the last run made in this tab, said as that run's.
 */
export interface EvalMemoryView {
  /** Samples that declare memories, by verdict (from the results). */
  samples: number;
  caught: number;
  gaps: number;
  falsePositives: number;
  /** When the last run made here, which had no memory store (`report.memory: null`), landed; null otherwise. */
  noStoreAt: number | null;
  /** The store's coverage from the last run made here, or null when none is known. */
  coverage: { memories: number; surfaced: number; unsurfaced: Array<{ memory_id: string; scope: string }>; at: number } | null;
}

/** A sample's memory verdict, or null when it declares none (or the engine predates the axis). */
export function memoryOf(r: EvalResult): EvalMemoryResult | null {
  const m = r.memory;
  return m !== null && m !== undefined && typeof m === 'object' && typeof m.verdict === 'string' ? m : null;
}

/** The memory view, or null when there is nothing to say about memories. */
export function evalMemoryView(results: readonly EvalResult[], lastRun: EvalMemoryDeposit | null): EvalMemoryView | null {
  const verdicts = results.map(memoryOf).filter((m): m is EvalMemoryResult => m !== null);
  const noStoreAt = lastRun !== null && lastRun.axis === null ? lastRun.at : null;
  const coverage = lastRun !== null && lastRun.axis !== null ? { ...lastRun.axis.coverage, at: lastRun.at } : null;
  if (verdicts.length === 0 && noStoreAt === null && coverage === null) return null;
  return {
    samples: verdicts.length,
    caught: verdicts.filter((m) => m.verdict === 'caught').length,
    gaps: verdicts.filter((m) => m.verdict === 'gap').length,
    falsePositives: verdicts.filter((m) => m.verdict === 'false_positive').length,
    noStoreAt,
    coverage,
  };
}

/** One sample's memory verdict in words (the behaviour list's memory line). */
export function memoryVerdictWords(m: EvalMemoryResult): string {
  if (m.verdict === 'false_positive') {
    const missed = m.missing.length > 0 ? `; also missed ${m.missing.join(', ')}` : '';
    return `Memories: surfaced ${m.unexpected_surfaced.join(', ')}, which it should not${missed}`;
  }
  if (m.verdict === 'gap') return `Memories: missed ${m.missing.join(', ')}`;
  return 'Memories: every expected memory surfaced';
}

/** The axis summary in one sentence. */
export function memorySummaryWords(v: EvalMemoryView): string {
  if (v.samples === 0) return 'No behaviour in this run names a memory to expect or avoid.';
  const of = `${v.samples} ${v.samples === 1 ? 'behaviour names' : 'behaviours name'} memories`;
  return `${of}: ${v.caught} surfaced what ${v.caught === 1 ? 'it' : 'they'} should, ${v.gaps} missed one, ${v.falsePositives} surfaced one ${v.falsePositives === 1 ? 'it' : 'they'} should not.`;
}
