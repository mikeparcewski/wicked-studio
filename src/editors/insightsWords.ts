/**
 * Run insights in everyday words (operator: "think humans, we get overwhelmed easy"). Crew's review carries the
 * numbers and the evidence; this turns each recommendation into what a person reads first: a plain title, ONE
 * sentence of evidence, the expected effect, a confidence chip and a verb for the action. Everything technical (the
 * interval, the sample sizes, what would change our mind, the runs) goes behind "Why we think this". Pure.
 */

import type { InsightsMetricDef, InsightsRecommendation, InsightsReview } from '../api/insights.js';

/** Engine words a person never needs to read. */
const CONDITION_WORDS: Record<string, string> = {
  judge_unavailable: 'no independent reviewer',
  floor_failed: 'failing checks',
  scope_drift: 'work outside the plan',
  verdict_not_pass: 'a reviewer saying no',
  qe_inconclusive: 'an unclear test review',
  qe_failed: 'failing acceptance tests',
  repo_checks: 'the checks',
  substance: 'the review',
  unknown: 'an unexplained stop',
};
const REASON_WORDS: Record<string, string> = {
  not_logged_in: 'signed out',
  quota_exhausted: 'out of quota',
};
export const ACTION_VERBS: Record<InsightsRecommendation['kind'], string> = {
  setting: 'Change a setting',
  issue: 'File an issue',
  'steering-rule': 'Add a steering rule',
  memory: 'Remember this',
  'resolve-stale': 'Resolve runs',
};
export const CONFIDENCE_WORDS: Record<InsightsRecommendation['confidence'], string> = { high: 'High', medium: 'Medium', low: 'Low' };

export function conditionWords(c: string): string {
  return CONDITION_WORDS[c] ?? c.replace(/_/g, ' ');
}
export function reasonWords(r: string): string {
  return REASON_WORDS[r] ?? r.replace(/_/g, ' ');
}

/** Leftover technical spellings in crew's lines, made readable: ids → words, `n=8` → `8 runs`, the CI spelled out. */
export function plainText(s: string): string {
  return s
    .replace(/\b(judge_unavailable|floor_failed|scope_drift|verdict_not_pass|qe_inconclusive|qe_failed|repo_checks|not_logged_in|quota_exhausted)\b/gu, (m) => (REASON_WORDS[m] ?? conditionWords(m)))
    .replace(/"(no independent reviewer|failing checks|work outside the plan|a reviewer saying no|an unclear test review|failing acceptance tests)"/gu, '$1')
    .replace(/\(95% CI ([^)–]+)–([^)]+)\)/gu, '(likely between $1 and $2)')
    .replace(/\bn=(\d+)\b/gu, (_m, n: string) => `${n} run${n === '1' ? '' : 's'}`);
}

/** Without the interval, for a line on the face. */
export function withoutInterval(s: string): string {
  return s.replace(/ ?\((?:95% CI|likely between)[^)]*\)/gu, '');
}

export function fmt(unit: InsightsMetricDef['unit'] | undefined, v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return 'none';
  if (unit === 'ratio') return `${Math.round(v * 100)}%`;
  if (unit === 'minutes') return v >= 120 ? `${(v / 60).toFixed(1)} hours` : `${Math.round(v)} min`;
  if (unit === 'usd') return `$${v.toFixed(2)}`;
  return v.toFixed(v % 1 === 0 ? 0 : 1);
}

const runs = (n: number): string => `${n} run${n === 1 ? '' : 's'}`;
/** "6 of 8" for a rate over its sample. */
const of = (rate: number | null | undefined, n: number): string => `${Math.round((rate ?? 0) * n)} of ${n}`;
const after = (line: string, re: RegExp): string | null => re.exec(line)?.[1] ?? null;

/** Where a regression's segment sits, in words ("" for all runs). */
function whereWords(segment: string | undefined): string {
  if (segment === undefined || segment === 'all') return '';
  const [k, ...rest] = segment.split(':');
  const v = rest.join(':');
  return k === 'repo' ? ` on ${v}` : k === 'agent' ? ` for ${v}` : ` in ${v} runs`;
}

/** Per metric: a plain title, the one sentence, the effect, and what would change our mind (each specific). */
const REGRESSION: Record<string, {
  title: (where: string) => string;
  say: (v: string, b: string, k: string, n: number) => string;
  effect: string;
  changeMind: string;
}> = {
  wait_on_people: {
    title: (w) => `Runs are waiting on people longer${w}`,
    say: (v, b) => `A typical run now waits ${v} for a person, up from ${b}.`,
    effect: 'Work moves again without someone having to step in.',
    changeMind: 'If the waits were reviews you chose to hold and read, they are by design, not a problem.',
  },
  override_rate: {
    title: (w) => `People are overriding more stops${w}`,
    say: (_v, b, k) => `In ${k} runs a person had to override a stop, up from ${b} of runs before.`,
    effect: 'Stops catch real problems again, instead of being waved through.',
    changeMind: 'If the overrides were for checks that are wrong rather than work that is wrong, fix the checks instead.',
  },
  pass_rate: {
    title: (w) => `Fewer runs are passing${w}`,
    say: (_v, b, k) => `${k} runs passed, down from ${b} before.`,
    effect: 'More runs finish with work you can use.',
    changeMind: 'If this window’s runs were harder work than before, the drop says more about the work than the setup.',
  },
  unresolved_rate: {
    title: (w) => `More runs are left unresolved${w}`,
    say: (_v, b, k) => `${k} runs were left with nobody closing them, up from ${b} before.`,
    effect: 'The run list shows only live work.',
    changeMind: 'If those runs are parked on purpose, archive them with a note instead.',
  },
  time_to_pr: {
    title: (w) => `Pull requests are taking longer${w}`,
    say: (v, b) => `A typical pull request now takes ${v}, up from ${b}.`,
    effect: 'Changes reach review sooner.',
    changeMind: 'If the changes themselves got bigger, longer is expected.',
  },
  floor_minutes: {
    title: (w) => `Checks are taking longer${w}`,
    say: (v, b) => `A typical run now spends ${v} in checks, up from ${b}.`,
    effect: 'Runs spend less time waiting for checks.',
    changeMind: 'If new checks were added on purpose, the extra time buys extra safety.',
  },
  spend: {
    title: (w) => `Runs are costing more${w}`,
    say: (v, b) => `A typical run now costs ${v}, up from ${b}.`,
    effect: 'The same work costs less.',
    changeMind: 'If the runs did more work each, the cost per run is not comparable.',
  },
  retries: {
    title: (w) => `Runs are retrying more${w}`,
    say: (v, b) => `A typical run now needs ${v} retries, up from ${b}.`,
    effect: 'Fewer runs redo work.',
    changeMind: 'If a single flaky agent caused the retries, fix that agent rather than the workflow.',
  },
};

export interface PlainRecommendation {
  title: string;
  say: string;
  effect: string;
  verb: string;
  confidence: string;
  /** Behind "Why we think this". */
  why: string[];
  changeMind: string;
}

/** One recommendation in everyday words. `interpreted`: the seat's own wording is kept where it gave one. */
export function plainRecommendation(rec: InsightsRecommendation, metrics: readonly InsightsMetricDef[], interpreted = false): PlainRecommendation {
  const e = rec.evidence;
  const n = e.n;
  const line = e.line;
  const verb = ACTION_VERBS[rec.kind];
  const confidence = CONFIDENCE_WORDS[rec.confidence];
  const why: string[] = [];
  let title = plainText(rec.title);
  let say = plainText(withoutInterval(line));
  let effect = plainText(rec.expectedEffect);
  let changeMind = plainText(rec.changeMind);
  const c = rec.candidate;
  if (c.startsWith('regression-') && e.metric !== undefined) {
    const def = metrics.find((m) => m.id === e.metric);
    const words = REGRESSION[e.metric];
    if (words !== undefined) {
      const v = fmt(def?.unit, e.value);
      const b = fmt(def?.unit, e.baseline);
      title = words.title(whereWords(e.segment));
      say = words.say(v, b, of(e.value, n), n);
      if (!interpreted) { effect = words.effect; changeMind = words.changeMind; }
      if (e.interval != null) why.push(`This window: ${v}, likely between ${fmt(def?.unit, e.interval.lo)} and ${fmt(def?.unit, e.interval.hi)}.`);
      why.push(`Based on ${runs(n)} in this window, against ${b} before.`);
    }
  } else if (c.startsWith('setting-judge-')) {
    const where = after(line, / runs on (.+)\.$/u);
    title = 'Sign in a second agent, so someone independent can review';
    say = `In ${runs(n)}${where !== null ? ` on ${where}` : ''} a person had to stand in for the reviewer.`;
    if (!interpreted) {
      effect = 'Reviews come from a different agent, so nobody has to stand in.';
      changeMind = 'If a second agent is already signed in but still sits out, the cause is its sign-in or quota, not the number of agents.';
    }
    why.push(`${runs(n)} stopped because there was no independent reviewer, and a person overrode the stop each time.`);
  } else if (c.startsWith('issue-floor-')) {
    const where = after(line, / runs on (.+)\.$/u);
    title = `Fix the checks that keep failing${where !== null ? ` on ${where}` : ''}`;
    say = `In ${runs(n)} a person had to wave failing checks through.`;
    if (!interpreted) {
      effect = 'Runs pass their checks on their own merit, and nobody has to wave them through.';
      changeMind = 'If the same checks pass on CI, the problem is this computer\u2019s setup: file that instead.';
    }
    why.push(`${runs(n)} stopped on failing checks, and a person overrode the stop each time.`);
  } else if (c.startsWith('steering-override-')) {
    const cond = after(line, /A "([^"]+)" escalation/u);
    const where = after(line, / runs on (.+)\.$/u);
    const plain = cond !== null ? conditionWords(cond) : 'the same stop';
    title = `Have plans${where !== null ? ` on ${where}` : ''} deal with ${plain} up front`;
    say = `In ${runs(n)} a person overrode a stop for ${plain}.`;
    if (!interpreted) effect = `Fewer runs stop for ${plain}, so fewer wait for a person.`;
    why.push(`${runs(n)} stopped for ${plain}, and a person overrode it each time.`);
  } else if (c.startsWith('setting-bench-')) {
    const cli = after(line, /^(\S+) was benched/u) ?? 'An agent';
    const reason = after(line, /benched \(([^)]+)\)/u)?.replace(/ /g, '_') ?? '';
    const r = reasonWords(reason);
    title = r === 'signed out' ? `Sign ${cli} back in` : r === 'out of quota' ? `Check ${cli}’s quota` : `Check why ${cli} keeps sitting out`;
    say = `${cli} sat out ${runs(n)}: ${r}.`;
    if (!interpreted) {
      effect = `${cli} takes work again, so more runs get an independent reviewer.`;
      changeMind = `If ${cli} sits out on purpose, remove it from the agents list so runs stop trying it.`;
    }
  } else if (c.startsWith('issue-failure-')) {
    const where = after(line, / runs on (.+?) failed/u);
    const sig = after(line, /failed the same way: (.+)\.$/u);
    title = `File the failure that keeps stopping runs${where !== null ? ` on ${where}` : ''}`;
    say = `${runs(n)} failed the same way${sig !== null ? `: ${plainText(sig.replace(/ \(([a-z_]+)\)$/u, ''))}` : ''}.`;
  } else if (c === 'resolve-stale') {
    title = `Close ${runs(n)} nobody finished`;
    say = `${runs(n)} failed or stalled, and nobody retried or archived them.`;
  }
  if (why.length === 0) why.push(`Based on ${runs(n)}.`);
  return { title, say, effect, verb, confidence, why, changeMind };
}

/** The review's one header sentence: "15 runs reviewed (Oct 25–27). One thing got better, five could improve." */
export function reviewSentence(r: Pick<InsightsReview, 'status' | 'window' | 'totals' | 'improvements' | 'recommendations' | 'error'>): string {
  const d = (ms: number): Date => new Date(ms);
  const month = (x: Date): string => x.toLocaleDateString('en-US', { month: 'short' });
  const s = d(r.window.startMs), e = d(r.window.endMs);
  const span = month(s) === month(e) ? `${month(s)} ${s.getDate()}–${e.getDate()}` : `${month(s)} ${s.getDate()}–${month(e)} ${e.getDate()}`;
  if (r.status === 'running') return 'A review is running now.';
  if (r.status !== 'completed') return `This review did not finish (${span}).`;
  const count = (k: number, one: string, many: string, none: string): string => (k === 0 ? none : k === 1 ? one : many.replace('#', NUMBER_WORDS[k] ?? String(k)));
  const total = r.totals?.['runs'] ?? 0;
  const better = count(r.improvements.length, 'One thing got better', '# things got better', 'Nothing got better');
  const improve = count(r.recommendations.length, 'one could improve', '# could improve', 'nothing needs changing');
  return `${total} run${total === 1 ? '' : 's'} reviewed (${span}). ${better}, ${improve}.`;
}
const NUMBER_WORDS: Record<number, string> = { 2: 'two', 3: 'three', 4: 'four', 5: 'five', 6: 'six', 7: 'seven', 8: 'eight', 9: 'nine' };

/** A "what got better" line in plain words (the interval dropped, sample sizes spelled out). */
export function plainImprovement(line: string): string {
  return plainText(withoutInterval(line));
}

/** One caption per trend line. */
export const TREND_CAPTIONS: Record<string, string> = {
  spend: 'What a typical run cost, review by review',
  pass_rate: 'Share of finished runs that passed',
  override_rate: 'Share of runs where a person overrode a stop',
  wait_on_people: 'How long a typical run waited on a person',
  unresolved_rate: 'Share of runs nobody closed',
};
