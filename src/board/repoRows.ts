import type { CodeGraphData, SessionView } from '../api/types.js';
import { relTime } from './relTime.js';
import type { RepoFleetModel } from './repoStats.js';

/**
 * THE REPOSITORIES PAGE, calm v2 (operator-approved pages mockup, 2026-10-26). One row per repository:
 * its name, one muted line (language · readiness) and one word on the right: what waits on you, the
 * index to redo ("Re-index", a link), or when it was last worked on. Pure.
 *
 * Wire honesty: `GET /repos` carries no language, index-freshness or build-guide field. Readiness is
 * the repo's newest onboarding run (as the card always read it), corrected by the engine's checkout
 * findings; freshness is that run's age; the language is read from the repo's code map, which the page
 * fetches lazily per row (`languageWords`). A build guide's state is not on the wire, so the page does
 * not claim one.
 */

/** An index older than this many days reads as stale: the row's word becomes "Re-index". */
export const STALE_INDEX_DAYS = 7;
const DAY_MS = 86_400_000;

export type RepoReadiness = 'ready' | 'stale' | 'onboarding' | 'failed' | 'never' | 'missing';
export type RepoTone = 'ready' | 'run' | 'gate' | 'warn' | 'fail' | 'quiet';

function secs(v: unknown): number | null { return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v * 1000 : null; }

/** When the repo's code map was last built: its newest onboarding run's end (else its start). */
export function indexedAt(m: Pick<RepoFleetModel, 'onboard'>): number | null {
  const s = m.onboard.run?.session;
  if (s === undefined) return null;
  return secs((s as { ended_at?: unknown }).ended_at) ?? secs(s.created_at);
}

/** Where the repo's index stands. The engine's findings outrank the run history (F-2R2-003). */
export function repoReadiness(m: Pick<RepoFleetModel, 'onboard' | 'graphGap'>, now: number): RepoReadiness {
  if (m.graphGap !== null && m.onboard.state !== 'onboarding') return 'missing';
  if (m.onboard.state !== 'ready') return m.onboard.state;
  const at = indexedAt(m);
  return at !== null && now - at > STALE_INDEX_DAYS * DAY_MS ? 'stale' : 'ready';
}

/** The readiness half of the muted line. */
export function readinessWords(r: RepoReadiness, m: Pick<RepoFleetModel, 'onboard' | 'graphGap'>, now: number): string {
  if (r === 'ready') return 'indexed';
  if (r === 'stale') {
    const at = indexedAt(m);
    const days = at === null ? STALE_INDEX_DAYS : Math.floor((now - at) / DAY_MS);
    return `index is ${days} days old`;
  }
  if (r === 'onboarding') return 'indexing now';
  if (r === 'failed') return 'indexing failed';
  if (r === 'missing') return m.graphGap?.kind === 'no-graph-root' ? 'no place to keep a code map' : 'no code map';
  return 'not indexed yet';
}

/** The newest moment any job touched the repo (started or ended), from the run list itself. */
export function lastActivity(repoId: string, runs: readonly SessionView[]): number | null {
  let best: number | null = null;
  for (const v of runs) {
    if (v.session.repo_ref !== repoId) continue;
    for (const t of [secs(v.session.created_at), secs((v.session as { ended_at?: unknown }).ended_at)]) {
      if (t !== null && (best === null || t > best)) best = t;
    }
  }
  return best;
}

/** What sits on the row's right: one word, or one link that does the next thing. */
export type RepoSide =
  | { kind: 'needs'; label: string; runId: string; tone: RepoTone }
  | { kind: 'reindex'; label: string; tone: RepoTone }
  | { kind: 'index'; label: string; tone: RepoTone }
  | { kind: 'word'; label: string; tone: RepoTone };

/**
 * The right side, most urgent first: a job waiting on you (a link straight to its gate), an index to
 * redo (stale, failed, or no code map: "Re-index"), a repo never indexed ("Index"), a job working on it
 * now, then when it was last active (or added).
 */
export function repoSide(m: RepoFleetModel, r: RepoReadiness, last: number | null, now: number): RepoSide {
  const gate = m.waiting[0]?.session.id;
  if (gate !== undefined) return { kind: 'needs', label: m.waiting.length === 1 ? 'Waiting on you' : `${m.waiting.length} waiting on you`, runId: gate, tone: 'gate' };
  if (r === 'stale' || r === 'failed' || r === 'missing') return { kind: 'reindex', label: 'Re-index', tone: 'run' };
  if (r === 'never') return { kind: 'index', label: 'Index', tone: 'run' };
  if (r === 'onboarding') return { kind: 'word', label: 'Indexing…', tone: 'run' };
  if (m.activeNow) return { kind: 'word', label: 'Working now', tone: 'run' };
  if (last !== null) return { kind: 'word', label: activeWords(last, now), tone: 'quiet' };
  return { kind: 'word', label: `Added ${relTime(secs(m.repo.registered_at) ?? now, now)}`, tone: 'quiet' };
}

function activeWords(at: number, now: number): string {
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  if (at >= start.getTime()) return 'Active today';
  return `Active ${relTime(at, now)}`;
}

/** The row's dot: green when indexed and fresh, the gate tint when it waits on you, amber when the index wants redoing. */
export function repoTone(m: RepoFleetModel, r: RepoReadiness): RepoTone {
  if (m.waiting.length > 0) return 'gate';
  if (r === 'failed' || r === 'missing') return 'fail';
  if (r === 'stale' || r === 'never') return 'warn';
  if (r === 'onboarding' || m.activeNow) return 'run';
  return 'ready';
}

const WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve'];
const said = (n: number): string => WORDS[n] ?? String(n);

/**
 * The one sentence under "Repositories".
 *  "Five repositories, all indexed and ready." / "Six repositories. Four are indexed; two need re-indexing."
 */
export function reposSentence(read: 'loading' | 'failed' | 'known', readiness: readonly RepoReadiness[], waiting: number): string {
  if (read === 'loading') return 'Reading your repositories…';
  if (read === 'failed') return 'Your repositories could not be read just now.';
  const n = readiness.length;
  if (n === 0) return 'Studio maps each repository you add, so your agents can find their way around it.';
  const of = (r: RepoReadiness): number => readiness.filter((x) => x === r).length;
  const repos = `${said(n)} ${n === 1 ? 'repository' : 'repositories'}`;
  const ready = of('ready');
  const redo = of('stale') + of('failed') + of('missing');
  const never = of('never');
  const building = of('onboarding');
  const wait = waiting > 0 ? ` ${said(waiting)} ${waiting === 1 ? 'job waits' : 'jobs wait'} on you.` : '';
  if (ready === n) return n === 1 ? `${repos}, indexed and ready.${wait}` : `${repos}, all indexed and ready.${wait}`;
  const parts = [
    ready > 0 ? `${said(ready).toLowerCase()} ${ready === 1 ? 'is' : 'are'} indexed` : null,
    building > 0 ? `${said(building).toLowerCase()} ${building === 1 ? 'is' : 'are'} indexing now` : null,
    redo > 0 ? `${said(redo).toLowerCase()} ${redo === 1 ? 'needs' : 'need'} re-indexing` : null,
    never > 0 ? `${said(never).toLowerCase()} ${never === 1 ? 'is' : 'are'} not indexed yet` : null,
  ].filter((x): x is string => x !== null);
  const body = parts.join('; ');
  return `${repos}. ${body.charAt(0).toUpperCase()}${body.slice(1)}.${wait}`;
}

const LANG_NAMES: Record<string, string> = {
  rust: 'Rust', typescript: 'TypeScript', tsx: 'TypeScript', javascript: 'JavaScript', jsx: 'JavaScript', python: 'Python',
  go: 'Go', java: 'Java', kotlin: 'Kotlin', swift: 'Swift', ruby: 'Ruby', csharp: 'C#', 'c#': 'C#', cpp: 'C++', 'c++': 'C++', c: 'C',
  php: 'PHP', scala: 'Scala', shell: 'Shell', bash: 'Shell', html: 'HTML', css: 'CSS', markdown: 'Markdown', sql: 'SQL',
};

/**
 * A repo's language from its code map: the languages holding at least a quarter of the mapped files,
 * biggest first, at most two ("Python + TypeScript"). Null when the map holds no files.
 */
export function languageWords(graph: Pick<CodeGraphData, 'nodes'> | null): string | null {
  if (graph === null) return null;
  const files = new Map<string, Set<string>>();
  for (const n of graph.nodes) {
    if (!n.file || n.file.startsWith('node_modules/')) continue;
    const raw = (n.lang || '').toLowerCase();
    if (raw === '' || raw === 'other' || raw === 'unknown') continue;
    const name = LANG_NAMES[raw] ?? raw.charAt(0).toUpperCase() + raw.slice(1);
    const set = files.get(name) ?? new Set<string>();
    set.add(n.file);
    files.set(name, set);
  }
  const total = [...files.values()].reduce((a, s) => a + s.size, 0);
  if (total === 0) return null;
  const big = [...files.entries()].map(([k, s]) => ({ k, n: s.size })).sort((a, b) => b.n - a.n || a.k.localeCompare(b.k));
  const shown = big.filter((x, i) => i === 0 || x.n / total >= 0.25).slice(0, 2);
  return shown.map((x) => x.k).join(' + ');
}
