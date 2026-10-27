/**
 * The calm Evaluate page's "How well the system judges" rows (DES-DEFAULT-EVALS-001 §7). Pure folds over crew's
 * report: crew computes every number, this module only says them in words. Too few cases never reads as a rate,
 * and real and synthetic are always named apart.
 */

import type { DefaultEvalDriftKey, DefaultEvalRate, DefaultEvalReport, DefaultEvalSlice, DefaultEvalSuiteScore, DefaultEvalTrend } from '../api/defaultEvals.js';

export type JudgeTone = 'ok' | 'warn' | 'fail' | 'quiet';

export interface JudgeRow {
  suite: DefaultEvalSuiteScore['suite'];
  /** A short name for the row. */
  name: string;
  /** "80% agree (64–90%) · 35 real cases" or "Too few cases to tell (2)". */
  words: string;
  /** "Real 28 of 35 · synthetic: 2 not scored" — the two kinds of case, always apart. */
  split: string;
  trend: string | null;
  tone: JudgeTone;
  /** Lines for the open row: per answerer or project, then the suite's own notes. */
  detail: string[];
}

const NAMES: Record<DefaultEvalSuiteScore['suite'], string> = {
  'needs-you': 'What needs you',
  'floor-class': 'Floor decisions',
  'qe-verdict': 'QE verdicts',
  attribution: 'Who built it',
  steering: 'Steering rules firing',
  recall: 'Memory recall',
  archetype: 'Routing a prompt',
  normalization: 'The same thing, judged the same everywhere',
};

const SURFACE_WORDS: Record<string, string> = {
  home: 'Home',
  'needs-page': 'Needs you page',
  'nerve-center': 'Nerve Center',
  codex: 'codex (asked the same question)',
};

export function pct(v: number | null): string {
  return v === null ? '—' : `${Math.round(v * 100)}%`;
}

/** A rate in words. Below the minimum it is never a percentage on its own. */
export function rateWords(r: DefaultEvalRate, noun = 'agree'): string {
  if (r.n === 0) return 'No cases yet';
  if (r.tooFew) return `Too few cases to tell (${r.n})`;
  return `${pct(r.value)} ${noun} (${pct(r.lo)}–${pct(r.hi)})`;
}

function sliceWords(label: string, s: DefaultEvalSlice): string | null {
  if (s.cases === 0) return null;
  const scored = s.agreement.n;
  const parts: string[] = [];
  if (scored > 0) parts.push(`${s.agreement.k} of ${scored} right`);
  if (s.unscored > 0) parts.push(`${s.unscored} not scored`);
  return `${label} ${parts.join(', ')}`;
}

export function trendWords(t: DefaultEvalTrend): string | null {
  switch (t) {
    case 'improved':
      return 'Better than last time';
    case 'regressed':
      return 'Worse than last time';
    case 'no-change':
      return 'No change';
    default:
      return null; // first run, or too few to call a trend
  }
}

function toneOf(s: DefaultEvalSuiteScore): JudgeTone {
  const a = s.combined.agreement;
  if (a.n === 0 || a.tooFew) return 'quiet';
  if (s.trend.word === 'regressed') return 'fail';
  if (a.value !== null && a.value >= 0.9) return 'ok';
  if (a.value !== null && a.value < 0.6) return 'fail';
  return 'warn';
}

export function judgeRow(s: DefaultEvalSuiteScore): JudgeRow {
  const a = s.combined.agreement;
  const real = s.real.cases;
  const words = a.n === 0 || a.tooFew ? rateWords(a) : s.suite === 'normalization' ? rateWords(a) : `${rateWords(a)} · ${a.n} ${a.n === 1 ? 'case' : 'cases'}`;
  const split =
    s.suite === 'normalization'
      ? a.n === 0 ? 'Nothing was judged in two places yet' : `${a.k} of ${a.n} judged the same in every place`
      : [sliceWords('Real', s.real), sliceWords('synthetic', s.synthetic)].filter((x): x is string => x !== null).join(' · ') || (real === 0 ? 'No real cases yet' : '');
  const detail: string[] = [];
  for (const [k, v] of Object.entries(s.bySurface ?? {})) detail.push(`${SURFACE_WORDS[k] ?? k}: ${v.agreement.k} of ${v.agreement.n} right`);
  for (const [k, v] of Object.entries(s.byProject ?? {})) detail.push(`${k}: ${rateWords(v.agreement)}, ${v.agreement.n} ${v.agreement.n === 1 ? 'case' : 'cases'}`);
  if (s.combined.pairs !== undefined && s.combined.pairs.recall.n > 0) {
    detail.push(`Merging: ${s.combined.pairs.recall.k} of ${s.combined.pairs.recall.n} pairs that are one cause were put together`);
  }
  const cal = s.combined.calibration;
  if (cal !== undefined) detail.push(cal.tooFew ? `Confidence: too few answers to check (${cal.n})` : `Confidence is off by ${pct(cal.ece)} on average`);
  if (s.model.cases > 0) detail.push(`${s.model.cases} more labelled by a model, counted apart: ${s.model.agreement.k} of ${s.model.agreement.n} right`);
  detail.push(...s.notes);
  return { suite: s.suite, name: NAMES[s.suite] ?? s.title, words, split, trend: trendWords(s.trend.word), tone: toneOf(s), detail };
}

const LABEL_WORDS: Record<string, string> = { count: 'counts it', not: 'leaves it out' };

/** What a drift row is about: the needs-you item, or the evidence class a floor or QE verdict had. */
function driftSubject(d: DefaultEvalDriftKey): string {
  const rest = d.inputKey.split(':').slice(1).join(':');
  if (d.suite === 'needs-you') return /^[0-9a-f]{8}$/.test(rest) ? `run ${rest}` : rest === 'proposals' ? 'the pending proposals' : rest.replace(/^infra:/, '').replace(/^cli:/, 'seat ');
  if (d.suite === 'floor-class') return `a floor whose checks say ${rest.split(':')[0]!.replace(/_/g, ' ')}`;
  return rest.replace(/_/g, ' ');
}

/**
 * The inputs judged differently by place, in words, grouped by answer:
 * "What needs you, run 7f4e149f: Home and Needs you page count it; Nerve Center and codex leave it out".
 */
export function driftLine(d: DefaultEvalDriftKey): string {
  const byAnswer = new Map<string, string[]>();
  for (const [place, labels] of Object.entries(d.observed)) {
    const known = labels.every((l) => LABEL_WORDS[l] !== undefined);
    const answer = known ? labels.map((l) => LABEL_WORDS[l]!).join(' or ') : `says ${labels.map((l) => l.replace(/_/g, ' ')).join(' or ')}`;
    byAnswer.set(answer, [...(byAnswer.get(answer) ?? []), SURFACE_SHORT[place] ?? place]);
  }
  const parts = [...byAnswer.entries()].map(([answer, places]) => {
    const who = places.length === 1 ? places[0]! : `${places.slice(0, -1).join(', ')} and ${places.at(-1)!}`;
    const verb = places.length === 1 ? answer : answer.replace(/^counts it$/, 'count it').replace(/^leaves it out$/, 'leave it out').replace(/^says /, 'say ');
    return `${who} ${verb}`;
  });
  return `${NAMES[d.suite] ?? d.suite}, ${driftSubject(d)}: ${parts.join('; ')}`;
}

const SURFACE_SHORT: Record<string, string> = { home: 'Home', 'needs-page': 'the Needs you page', 'nerve-center': 'Nerve Center', codex: 'codex' };

/** At most `max` drift lines, and how many more there are. */
export function driftLines(drift: readonly DefaultEvalDriftKey[], max = 8): { lines: string[]; more: number } {
  return { lines: drift.slice(0, max).map(driftLine), more: Math.max(0, drift.length - max) };
}

/** The sentence under the section title. */
export function judgeSentence(r: DefaultEvalReport): string {
  // Baseline cases are real cases, but not this daemon's: they are said apart, never as "from your runs".
  const own = Math.max(0, r.counts.real - r.counts.baseline);
  const parts = [`${own} real ${own === 1 ? 'case' : 'cases'} from your runs`];
  if (r.counts.baseline > 0) parts.push(`${r.counts.baseline} from the shipped baseline`);
  parts.push(`${r.counts.synthetic} synthetic`);
  return `${parts.join(', ')}. ${r.project === null ? 'Every project.' : `Project ${r.project}.`}`;
}
