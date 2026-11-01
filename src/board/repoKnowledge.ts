import type { GraphKind, RepoEntry, SessionView } from '../api/types.js';
import { relTime } from './relTime.js';
import { repoGraphGap, repoOnboard, type RepoGraphGap, type RepoOnboard } from './repoStats.js';
import { DOMAIN_EXTRACTION_ID, type GraphBuild, type RequirementsCoverage } from './requirementsState.js';
import { statusWord } from './statusWords.js';

/**
 * WHAT WE KNOW about a repository (operator, round 10: "needs visuals to show what we know (e.g. has been run)
 * against it (code graph, requirements graph, etc...) with links to it and any sub content"). Five small marks,
 * each one a link to the thing itself. Pure: the reads come from `store/repoKnowledge.ts`, the runs from the
 * page's own `GET /runs`.
 *
 * Wire honesty (crew 0.16.x):
 *  - the code graph's size is `GET /governance/graph?repo=` (node counts by kind over the repo's own store: their
 *    sum is the graph's node total, `File` its files, `domain` the requirements graph's domains);
 *  - its "when" is the newest onboarding run (crew keeps no other index clock for a repo graph), and the engine's
 *    checkout findings outrank both (F-2R2-003);
 *  - requirements are `GET /repos/:id/requirements?limit=1` (`coverage`: the real share against the minimum;
 *    `graphBuild`: the requirements graph's generation and whether it is behind); a `notGenerated` 404 = none yet;
 *  - runs are the run list's `domain-extraction` runs and every other run on the repo (onboarding is the code
 *    graph's own mark).
 * A failed read says "unknown", never "none".
 */

/** The graph's node kinds, read once per repo. */
export type KindsRead =
  | { state: 'loading' }
  | { state: 'ok'; nodes: number; files: number; domains: number; reqGraph: boolean }
  | { state: 'failed' };

/** The requirements read (the list's header only: `limit=1`). */
export type ReqsRead =
  | { state: 'loading' }
  | { state: 'ok'; coverage: RequirementsCoverage | null; build: GraphBuild | null }
  | { state: 'none'; share: RequirementsCoverage | null }
  | { state: 'failed' };

export interface RepoKnowledgeRead { kinds: KindsRead; reqs: ReqsRead }

/** Node kinds folded into the few numbers a mark shows. */
export function kindsRead(kinds: readonly GraphKind[]): KindsRead {
  let nodes = 0; let files = 0; let domains = 0; let reqGraph = false;
  for (const k of kinds) {
    const n = Number.isFinite(k.count) && k.count > 0 ? k.count : 0;
    nodes += n;
    if (k.kind === 'File') files += n;
    else if (k.kind === 'domain') domains += n;
    else if (k.kind === 'requirements_graph' && n > 0) reqGraph = true;
  }
  return { state: 'ok', nodes, files, domains, reqGraph };
}

export type MarkTone = 'ok' | 'warn' | 'fail' | 'run' | 'gate' | 'none' | 'unknown';
export type MarkId = 'code' | 'reqs' | 'reqgraph' | 'domain-runs' | 'runs';
export type MarkTarget =
  | { kind: 'code-graph' }
  | { kind: 'requirements' }
  | { kind: 'req-graph' }
  | { kind: 'run'; runId: string }
  | { kind: 'none' };

export interface KnowMark {
  id: MarkId;
  /** The mark's name ("Code graph"). */
  label: string;
  /** Its short value ("46k symbols · 901 files"). */
  value: string;
  /** The full sentence (title and the accessible name's tail). */
  title: string;
  tone: MarkTone;
  /** Requirements only: the real share against the minimum, drawn as a small meter. */
  meter?: { pct: number; min: number };
  /** A second, quieter word ("behind"). */
  flag?: string;
  target: MarkTarget;
}

const DAY_MS = 86_400_000;

/** 46477 -> "46k", 1234 -> "1.2k", 980 -> "980". */
export function compactCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(Math.floor(n / 100) / 10).toString()}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(Math.round(n / 100_000) / 10).toString()}M`;
}
const plural = (n: number, one: string, many = `${one}s`): string => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

function secs(v: unknown): number | null { return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v * 1000 : null; }
function startedAt(v: SessionView): number | null {
  return secs((v.session as { ended_at?: unknown }).ended_at) ?? secs(v.session.created_at);
}
function newestFirst(runs: readonly SessionView[]): SessionView[] {
  return [...runs].sort((a, b) => (secs(b.session.created_at) ?? 0) - (secs(a.session.created_at) ?? 0));
}

function runTone(v: SessionView): MarkTone {
  const t = statusWord(v).tone;
  return t === 'quiet' ? 'none' : t;
}

function codeMark(onboard: RepoOnboard, gap: RepoGraphGap | null, kinds: KindsRead, now: number): KnowMark {
  const base = { id: 'code' as const, label: 'Code graph' };
  const at = onboard.run === null ? null : startedAt(onboard.run);
  const when = at === null ? 'when is not on record' : `indexed ${relTime(at, now)}`;
  if (onboard.state === 'onboarding' && onboard.run !== null) {
    return { ...base, value: 'indexing now', title: 'Code graph: an indexing job is building it now', tone: 'run', target: { kind: 'run', runId: onboard.run.session.id } };
  }
  if (gap !== null) {
    const v = gap.kind === 'no-graph-root' ? 'no place to keep one' : 'not built';
    return { ...base, value: v, title: `Code graph: ${gap.finding.message}`, tone: 'fail', target: { kind: 'code-graph' } };
  }
  if (kinds.state === 'loading') return { ...base, value: '…', title: 'Code graph: reading…', tone: 'unknown', target: { kind: 'code-graph' } };
  if (kinds.state === 'ok' && kinds.nodes > 0) {
    // Older than a week: amber (the row's own line already says how old).
    const stale = at !== null && now - at > 7 * DAY_MS;
    return {
      ...base,
      value: `${compactCount(kinds.nodes)} symbols`,
      title: `Code graph: ${kinds.nodes.toLocaleString('en-US')} nodes in ${plural(kinds.files, 'file')}, ${when}`,
      tone: stale ? 'warn' : 'ok',
      target: { kind: 'code-graph' },
    };
  }
  if (onboard.state === 'failed' && onboard.run !== null) {
    return { ...base, value: 'indexing failed', title: `Code graph: the last indexing job failed (${when})`, tone: 'fail', target: { kind: 'run', runId: onboard.run.session.id } };
  }
  if (kinds.state === 'failed' && onboard.state !== 'never') {
    return { ...base, value: 'unknown', title: 'Code graph: its size could not be read just now', tone: 'unknown', target: { kind: 'code-graph' } };
  }
  return { ...base, value: 'not built', title: 'Code graph: not built yet. Indexing the repository builds it.', tone: 'none', target: { kind: 'code-graph' } };
}

function reqsMark(reqs: ReqsRead): KnowMark {
  const base = { id: 'reqs' as const, label: 'Requirements', target: { kind: 'requirements' } as MarkTarget };
  if (reqs.state === 'loading') return { ...base, value: '…', title: 'Requirements: reading…', tone: 'unknown' };
  if (reqs.state === 'failed') return { ...base, value: 'unknown', title: 'Requirements: could not be read just now', tone: 'unknown' };
  const c = reqs.state === 'ok' ? reqs.coverage : reqs.share;
  if (c === null) {
    return reqs.state === 'none'
      ? { ...base, value: 'none yet', title: 'Requirements: not extracted yet. A domain extraction job states them.', tone: 'none' }
      : { ...base, value: 'listed', title: 'Requirements: listed (this service does not count the real share)', tone: 'ok' };
  }
  // Nothing extracted yet, though the repository has behaviour to cover: still none, with the count in the title.
  if (reqs.state === 'none' && c.real === 0) {
    return { ...base, value: 'none yet', title: `Requirements: not extracted yet (0 of ${c.behaviorBearing.toLocaleString('en-US')} behaviours). A domain extraction job states them.`, tone: 'none' };
  }
  const pct = c.realPct === 0 && c.real > 0 ? '<1%' : `${c.realPct}%`;
  const met = c.realPct >= c.minPct;
  return {
    ...base,
    value: `${pct} real`,
    title: `Requirements: ${pct} real (${c.real.toLocaleString('en-US')} of ${c.behaviorBearing.toLocaleString('en-US')}), minimum ${c.minPct}%`
      + `${c.placeholders > 0 ? `, ${plural(c.placeholders, 'placeholder')}` : ''}${reqs.state === 'none' ? '; not built into a graph yet' : ''}`,
    tone: met ? 'ok' : 'warn',
    meter: { pct: Math.max(0, Math.min(100, c.realPct)), min: Math.max(0, Math.min(100, c.minPct)) },
  };
}

function reqGraphMark(reqs: ReqsRead, kinds: KindsRead): KnowMark {
  const base = { id: 'reqgraph' as const, label: 'Requirements graph', target: { kind: 'req-graph' } as MarkTarget };
  const domains = kinds.state === 'ok' ? kinds.domains : null;
  const dom = domains === null || domains === 0 ? '' : ` · ${plural(domains, 'domain')}`;
  if (reqs.state === 'loading' || (reqs.state !== 'ok' && kinds.state === 'loading')) return { ...base, value: '…', title: 'Requirements graph: reading…', tone: 'unknown' };
  const build = reqs.state === 'ok' ? reqs.build : null;
  if (build !== null) {
    if (build.generation === 0) return { ...base, value: 'not built', title: 'Requirements graph: not built yet. A domain extraction job builds it once the real share reaches the minimum.', tone: 'none' };
    return {
      ...base,
      value: `build ${build.generation}${dom}`,
      title: `Requirements graph: build ${build.generation}${dom}${build.behind ? '. It is behind: requirements were mapped since it was built.' : ', up to date'}`,
      tone: build.behind ? 'warn' : 'ok',
      ...(build.behind ? { flag: 'behind' } : {}),
    };
  }
  // An older service sends no build: the store's own requirements_graph node says whether one exists.
  if (kinds.state === 'ok' && kinds.reqGraph) return { ...base, value: `built${dom}`, title: `Requirements graph: built${dom}`, tone: 'ok' };
  if (reqs.state === 'failed' && kinds.state !== 'ok') return { ...base, value: 'unknown', title: 'Requirements graph: could not be read just now', tone: 'unknown' };
  return { ...base, value: 'not built', title: 'Requirements graph: not built yet', tone: 'none' };
}

function runsMark(id: 'domain-runs' | 'runs', label: string, runs: readonly SessionView[], now: number): KnowMark {
  const newest = newestFirst(runs)[0];
  if (newest === undefined) {
    return { id, label, value: 'none', title: `${label}: none on record`, tone: 'none', target: { kind: 'none' } };
  }
  const w = statusWord(newest);
  const at = secs(newest.session.created_at);
  return {
    id, label,
    value: String(runs.length),
    title: `${label}: ${plural(runs.length, 'job')} on record; the newest ${w.word.toLowerCase()}${at === null ? '' : `, started ${relTime(at, now)}`}`,
    tone: runTone(newest),
    target: { kind: 'run', runId: newest.session.id },
  };
}

/** The five marks for one repository. `runs` may hold every run: the repo's own are picked here. */
export function knowledgeMarks(repo: Pick<RepoEntry, 'id' | 'findings'>, runs: readonly SessionView[], read: RepoKnowledgeRead, now: number): KnowMark[] {
  const mine = runs.filter((v) => v.session.repo_ref === repo.id && v.session.archived_at == null);
  const onboard = repoOnboard(mine, repo.id);
  const domain = mine.filter((v) => v.session.workflow_id === DOMAIN_EXTRACTION_ID);
  const other = mine.filter((v) => v.session.workflow_id !== DOMAIN_EXTRACTION_ID && v.session.workflow_id !== 'onboarding');
  return [
    codeMark(onboard, repoGraphGap(repo), read.kinds, now),
    reqsMark(read.reqs),
    reqGraphMark(read.reqs, read.kinds),
    runsMark('domain-runs', 'Domain runs', domain, now),
    runsMark('runs', 'Other runs', other, now),
  ];
}

/** "What we know" in one sentence, for a row's accessible description. */
export function knowledgeSentence(marks: readonly KnowMark[]): string {
  return marks.map((m) => `${m.label} ${m.value}${m.flag !== undefined ? ` (${m.flag})` : ''}`).join(' · ');
}
