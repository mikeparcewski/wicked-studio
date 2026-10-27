import type { SessionView } from '../api/types.js';
import { deliveryOf } from '../components/delivery.js';
import { countWord, progressRows } from './deskHome.js';
import { repoNameOf } from './deskWords.js';
import { endedAtMs, finishedAtMs } from './needsYou.js';

/**
 * A PROJECT'S HOME (`/projects/:id`, the operator-approved mockup `ui-v2-projects`): the title and one
 * sentence, an ask box that starts a job here, what needs you, what is in progress (step x of y), the
 * repositories, and one line about the week. Pure over the project's own runs, so the words are pinned
 * by tests; nothing the runs do not say is said.
 */

const WEEK_MS = 7 * 86_400_000;

/** "One thing needs you. Two jobs are running across four repositories." */
export function projectHomeSentence({ known, waiting, running, repos }: { known: boolean; waiting: number; running: number; repos: number }): string {
  if (!known) return 'Reading this project’s jobs…';
  const need = waiting === 0 ? 'Nothing needs you.' : `${countWord(waiting)} ${waiting === 1 ? 'thing needs' : 'things need'} you.`;
  const across = repos === 0 ? '' : ` across ${countWord(repos).toLowerCase()} ${repos === 1 ? 'repository' : 'repositories'}`;
  const run = running === 0 ? 'Nothing is running.'
    : `${countWord(running)} ${running === 1 ? 'job is' : 'jobs are'} running${across}.`;
  return `${need} ${run}`;
}

/** One job in progress on the home: its title, the repository and step x of y. */
export interface HomeProgressRow { runId: string; title: string; line: string }

/** The project's working jobs (a job waiting on you is under Needs you, not here), newest first. */
export function homeProgress(runs: readonly SessionView[], max: number): { rows: HomeProgressRow[]; total: number } {
  const all = progressRows(runs, { max: Number.MAX_SAFE_INTEGER, agentName: () => '' }).rows.filter((r) => r.tone === 'run');
  const byId = new Map(runs.map((v) => [v.session.id, v]));
  const rows = all.slice(0, max).map((r) => {
    const v = byId.get(r.runId);
    const repo = v === undefined ? null : repoNameOf(v);
    const step = r.total === 0 ? 'planning' : `step ${Math.min(r.total, r.done + 1)} of ${r.total}`;
    return { runId: r.runId, title: r.title, line: [repo, step].filter((x): x is string => x !== null && x !== '').join(' · ') };
  });
  return { rows, total: all.length };
}

/** "This week: 12 jobs finished, 4 shipped" (shipped = delivered: a pull request or a push). */
export function weekWords(runs: readonly SessionView[], now: number): string {
  let finished = 0;
  let shipped = 0;
  for (const v of runs) {
    const at = endedAtMs(v) ?? finishedAtMs(v);
    if (at === null || now - at > WEEK_MS) continue;
    if (v.session.status !== 'completed') continue;
    finished += 1;
    const d = deliveryOf(v);
    if (d.state === 'delivered' || d.state === 'pushed') shipped += 1;
  }
  if (finished === 0) return 'Nothing finished this week';
  return `This week: ${finished} ${finished === 1 ? 'job' : 'jobs'} finished${shipped > 0 ? `, ${shipped} shipped` : ''}`;
}
