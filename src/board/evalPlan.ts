import type { EvalRunSummary, SessionView, SteeringType } from '../api/types.js';
import type { EvalSample } from '../api/testing.js';
import type { DefaultEvalSuiteScore } from '../api/defaultEvals.js';
import { STEERING_TYPE_LABELS, STEERING_TYPES } from '../api/steering.js';

/**
 * EVALUATE, what to run and what to bring (DES-LEARN §5; mockup learn-and-panels state e), pure.
 *
 *  - {@link evalRecommendations}: what to run next, each with why — the weakest steering type in past results,
 *    types never evaluated, rules no behaviour exercises, jobs that failed lately, and the system judgment that
 *    agrees least with what happened. Everything is read off what crew already serves; nothing is invented.
 *  - {@link splitTranscript}: a pasted chat or log, split into behaviours for the person to mark good or bad.
 *  - {@link behavioursFromJob}: a job's steps as behaviours, labelled by how review judged them.
 */

const DAY_MS = 86_400_000;

/** "QE verdicts" stays as it is (an initialism); "What needs you" reads "what needs you" mid-sentence. */
function lowerFirst(s: string): string {
  const first = s.split(' ')[0] ?? '';
  return first.length > 1 && first === first.toUpperCase() ? s : s.charAt(0).toLowerCase() + s.slice(1);
}
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

function ago(atMs: number, now: number): string {
  const d = Math.floor(Math.max(0, now - atMs) / DAY_MS);
  if (d === 0) {
    const h = Math.floor(Math.max(0, now - atMs) / 3_600_000);
    return h === 0 ? `${Math.max(1, Math.floor(Math.max(0, now - atMs) / 60_000))} min ago` : `${h} h ago`;
  }
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

export type EvalRecAct =
  | { kind: 'run-type'; type: SteeringType }
  | { kind: 'run-all' }
  | { kind: 'run-suite'; suite: DefaultEvalSuiteScore['suite'] }
  | { kind: 'from-jobs'; runIds: string[] }
  | { kind: 'bring' };

export interface EvalRec {
  key: string;
  title: string;
  /** Why, in one or two sentences. */
  why: string;
  /** The evidence line: when, how many. */
  meta: string;
  /** The button's words. */
  label: string;
  act: EvalRecAct;
}

export interface EvalRecInput {
  /** The eval history, newest first. */
  history: readonly EvalRunSummary[];
  /** Rules in force now (null: not read). */
  ruleCount: number | null;
  /** The newest system-judgment report's suites, and when it ran (ms). */
  judge: { suites: readonly DefaultEvalSuiteScore[]; at: number } | null;
  /** The jobs the app holds (the failures of the last week are read off them). */
  runs: readonly SessionView[];
  now: number;
}

/** The suites' names (the "How well the system judges" rows say the same). */
export const SUITE_NAMES: Record<string, string> = {
  'needs-you': 'What needs you', 'floor-class': 'Floor decisions', 'qe-verdict': 'QE verdicts', attribution: 'Who built it',
  steering: 'Steering rules firing', recall: 'Memory recall', archetype: 'Routing a prompt', normalization: 'Judging the same thing the same way',
};

/** What to run next, most useful first; at most three. */
export function evalRecommendations(input: EvalRecInput): EvalRec[] {
  const { history, now } = input;
  const out: EvalRec[] = [];
  /** Asked for first (operator brief): the weakest past result, recent failures, the weakest judgment; then these. */
  const later: EvalRec[] = [];

  // 1. Never evaluated: everything is the recommendation.
  if (history.length === 0) {
    out.push({
      key: 'first', title: 'Every steering type', label: 'Run every type', act: { kind: 'run-all' },
      why: `No evaluation has run yet. A first run shows, for each kind of rule${input.ruleCount !== null ? ` (${plural(input.ruleCount, 'rule')} in force)` : ''}, which bad behaviours it blocks and which slip through.`,
      meta: 'Never run · the built-in behaviours',
    });
  } else {
    // 2. The weakest type in past results: the newest run that covered each type, most slipped through first.
    const newestFor = new Map<SteeringType, EvalRunSummary>();
    for (const r of history) {
      for (const t of Object.keys(r.per_type ?? {}) as SteeringType[]) if (!newestFor.has(t)) newestFor.set(t, r);
    }
    const weak = [...newestFor.entries()]
      .map(([t, r]) => ({ t, r, c: r.per_type[t]! }))
      .filter((x) => x.c.gaps > 0)
      .sort((a, b) => b.c.gaps / Math.max(1, b.c.total) - a.c.gaps / Math.max(1, a.c.total) || b.c.gaps - a.c.gaps);
    const w = weak[0];
    if (w !== undefined) {
      out.push({
        key: `weak:${w.t}`, title: `${STEERING_TYPE_LABELS[w.t]} rules`, label: `Re-run ${STEERING_TYPE_LABELS[w.t].toLowerCase()}`, act: { kind: 'run-type', type: w.t },
        why: `${plural(w.c.gaps, 'bad behaviour')} slipped through last time${w.c.false_positives > 0 ? `, and ${plural(w.c.false_positives, 'rule')} blocked good work` : ''}. Re-run it after adding or changing rules to see if they now catch ${w.c.gaps === 1 ? 'it' : 'them'}.`,
        meta: `Last run ${ago(w.r.created_at * 1000, now)} · ${plural(w.c.gaps, 'gap')} of ${w.c.total}`,
      });
    }
    // 3. Types never evaluated.
    const never = STEERING_TYPES.filter((t) => !newestFor.has(t));
    if (never.length > 0) {
      const t = never[0]!;
      later.push({
        key: `never:${t}`, title: never.length === 1 ? `${STEERING_TYPE_LABELS[t]} rules` : `${never.length} kinds of rule`,
        label: never.length === 1 ? `Run ${STEERING_TYPE_LABELS[t].toLowerCase()}` : 'Run every type', act: never.length === 1 ? { kind: 'run-type', type: t } : { kind: 'run-all' },
        why: never.length === 1
          ? `${STEERING_TYPE_LABELS[t]} rules have never been evaluated, so nothing says whether they block what they should.`
          : `${never.map((x) => STEERING_TYPE_LABELS[x]).join(', ')} rules have never been evaluated.`,
        meta: 'Never run',
      });
    }
    // 4. Rules no behaviour exercises (the newest run that measured coverage).
    const measured = history.find((r) => r.rule_coverage !== undefined);
    const idle = measured?.rule_coverage?.unexercised.length ?? 0;
    if (idle > 0) {
      later.push({
        key: 'unexercised', title: 'Rules nothing tests', label: 'Bring behaviours', act: { kind: 'bring' },
        why: `${plural(idle, 'rule')} in force ${idle === 1 ? 'was' : 'were'} not exercised by any behaviour in the last measured run, so a pass says nothing about ${idle === 1 ? 'it' : 'them'}. Bring behaviours that touch ${idle === 1 ? 'it' : 'them'}.`,
        meta: `Measured ${ago(measured!.created_at * 1000, now)}`,
      });
    }
  }

  // 5. Jobs that failed in the last week: what really went wrong, as behaviours.
  const since = now - 7 * DAY_MS;
  const failed = input.runs.filter((v) => v.session.status === 'failed' && ((v.session as { ended_at?: number | null }).ended_at ?? v.session.created_at ?? 0) * 1000 >= since);
  if (failed.length > 0) {
    out.push({
      key: 'failed-jobs', title: 'What went wrong this week', label: `Use ${failed.length === 1 ? 'that job' : `those ${failed.length} jobs`}`,
      act: { kind: 'from-jobs', runIds: failed.map((v) => v.session.id) },
      why: `${plural(failed.length, 'job')} failed in the last 7 days. Their steps become behaviours, labelled by how review judged them, so your rules are tested against what really happened.`,
      meta: `${plural(failed.length, 'failed job')} · last 7 days`,
    });
  }

  // 6. The system judgment that agrees least with what really happened.
  if (input.judge !== null) {
    const scored = input.judge.suites
      .filter((s) => s.combined.agreement.n > 0 && s.combined.agreement.tooFew !== true && s.combined.agreement.value !== null && s.combined.agreement.value < 0.9)
      .sort((a, b) => (a.combined.agreement.value ?? 1) - (b.combined.agreement.value ?? 1));
    const s = scored[0];
    if (s !== undefined) {
      const name = SUITE_NAMES[s.suite] ?? s.title;
      out.push({
        key: `judge:${s.suite}`, title: 'How well the system judges', label: `Run ${lowerFirst(name)}`, act: { kind: 'run-suite', suite: s.suite },
        why: `${name} agree${/s$/.test(name) ? '' : 's'} only ${Math.round((s.combined.agreement.value ?? 0) * 100)}% with what really happened. Worth a fresh look.`,
        meta: `${plural(s.combined.agreement.n, 'case')} · last run ${ago(input.judge.at, now)}`,
      });
    }
  }
  return [...out, ...later].slice(0, 3);
}

// ── Bring your own: a transcript, a past job ───────────────────────────────────────────────────

/** One behaviour the person reviews before it is imported. */
export interface BehaviourDraft {
  id: string;
  description: string;
  /** Unmarked behaviours are left out of the import (the person marks each). */
  kind: 'good' | 'bad' | null;
  type: SteeringType;
  /** Where it came from, for the signals. */
  phase?: string;
  content: string;
  /** Why it was labelled so (a job's step: "review sent it back: …"). */
  why?: string;
  keep: boolean;
}

const SPEAKER = /^\s*(?:user|assistant|human|ai|agent|system|you|me|operator|claude|codex|reviewer|tool)\s*[:>]/iu;

/** A pasted chat or log → behaviours: a speaker's turn or a paragraph each (at most 40), unmarked. */
export function splitTranscript(text: string, max = 40): BehaviourDraft[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const chunks: string[] = [];
  let cur: string[] = [];
  const flush = (): void => {
    const t = cur.join('\n').trim();
    if (t.length >= 12) chunks.push(t);
    cur = [];
  };
  for (const l of lines) {
    if (l.trim() === '' || (SPEAKER.test(l) && cur.length > 0)) flush();
    if (l.trim() !== '') cur.push(l);
  }
  flush();
  return chunks.slice(0, max).map((c, i) => ({
    id: `t${i + 1}`,
    description: oneLine(c, 200),
    kind: null,
    type: 'development',
    content: c.slice(0, 2000),
    keep: true,
  }));
}

function oneLine(s: string, cap: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > cap ? `${t.slice(0, cap - 1)}…` : t;
}

/** Home and absolute paths never ride into a corpus (the store keeps them). */
export function scrubPaths(s: string): string {
  return s.replace(/(?:\/Users|\/home|\/private\/tmp|\/var\/folders)\/[^\s'"`)]*/g, '<path>').replace(/[A-Za-z]:\\[^\s'"`)]*/g, '<path>');
}

const STAGE_TYPE: Record<string, SteeringType> = { test: 'testing', review: 'development', build: 'development', recon: 'architecture' };

/** A job's finished steps → behaviours: a step review accepted is good, one it sent back is bad (with why). */
export function behavioursFromJob(v: SessionView): BehaviourDraft[] {
  const out: BehaviourDraft[] = [];
  for (const u of [...v.units].sort((a, b) => a.ord - b.ord)) {
    if (u.status !== 'done' && u.status !== 'rejected') continue;
    const bad = u.status === 'rejected';
    const what = scrubPaths(u.description);
    out.push({
      id: `${v.session.id.slice(0, 8)}-${u.ord}`,
      description: oneLine(bad && u.denial_reason ? `${what} (sent back: ${scrubPaths(u.denial_reason)})` : what, 200),
      kind: bad ? 'bad' : 'good',
      type: STAGE_TYPE[u.stage] ?? 'development',
      phase: u.phase_ref ?? u.stage,
      content: scrubPaths(bad && u.denial_reason ? `${u.description}\n\nReview: ${u.denial_reason}` : u.description).slice(0, 2000),
      why: bad ? `review sent it back${u.denial_reason ? `: ${oneLine(scrubPaths(u.denial_reason), 120)}` : ''}` : 'review accepted it',
      keep: true,
    });
  }
  return out;
}

/** The kept, marked drafts as import samples (ids made unique per import). */
export function samplesOf(drafts: readonly BehaviourDraft[], prefix: string): EvalSample[] {
  return drafts
    .filter((d) => d.keep && d.kind !== null && d.description.trim() !== '')
    .map((d) => ({
      id: `${prefix}-${d.id}`,
      description: d.description.trim(),
      kind: d.kind!,
      steering_type: d.type,
      signals: { ...(d.phase !== undefined ? { phase: d.phase } : {}), content: d.content },
    }));
}

/** A corpus name from free words: lower-case, dashes, at most 40 characters. */
export function corpusName(words: string, fallback: string): string {
  const n = words.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return n === '' ? fallback : n;
}

// ── Past runs ──────────────────────────────────────────────────────────────────────────────────

/** A past run's title: what it covered and what it replayed. */
export function pastRunTitle(r: Pick<EvalRunSummary, 'type_filter' | 'corpus'>): string {
  const what = r.type_filter === null ? 'All types' : STEERING_TYPE_LABELS[r.type_filter] ?? r.type_filter;
  const set = r.corpus === null ? 'built-in behaviours' : `“${r.corpus.replace(/^evals:/u, '')}” (yours)`;
  return `${what} · ${set}`;
}

/** Its outcome as pills: caught, slipped through, false alarms. */
export function pastRunPills(s: EvalRunSummary['summary']): Array<{ key: string; tone: 'ok' | 'fail' | 'warn'; text: string }> {
  const out: Array<{ key: string; tone: 'ok' | 'fail' | 'warn'; text: string }> = [{ key: 'caught', tone: 'ok', text: `${s.caught} caught` }];
  if (s.gaps > 0) out.push({ key: 'gaps', tone: 'fail', text: `${s.gaps} slipped through` });
  if (s.false_positives > 0) out.push({ key: 'fp', tone: 'warn', text: `${plural(s.false_positives, 'false alarm')}` });
  return out;
}
