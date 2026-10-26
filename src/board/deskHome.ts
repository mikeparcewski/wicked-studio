import type { SessionView } from '../api/types.js';
import { deliveryOf } from '../components/delivery.js';
import { createdAtMs } from './windowStats.js';
import { statusWord, type StatusWord } from './statusWords.js';
import { deskVerb, jobTitle, plainRunTitle, repoNameOf } from './deskWords.js';
import { leadAgentOf, workflowLabel, workflowOf } from './deskInsights.js';
import type { NeedAction, NeedRow } from './needsYou.js';
import { inSectionOrder, topItem } from './needsQueue.js';
import { rankNeeds } from './needsYou.js';

/**
 * THE LANDING (`/`, the Desk's Work view), home v2 (operator-approved mockup, 2026-10-26): "needs more
 * whitespace, has to be easy to scan; think humans, we get overwhelmed easy". A greeting and one plain
 * sentence of state, one ask box, ONE card for the most important waiting item, at most three jobs in
 * progress, and one closing line. Everything else (the stat tiles, the event stream, agents, chores,
 * folders) lives on its own page.
 *
 * Pure in every input, including `now` and the hour, so the words are pinnable in unit tests.
 */

const WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];

/** A count as a sentence opens it: "Two", "Eleven" stays "11". */
export function countWord(n: number): string {
  return WORDS[n] ?? String(n);
}

export type HomeRead = 'checking' | 'failed' | 'known';

/**
 * The one sentence under the greeting, from the live counts:
 *  "Two things need you. One job is running." / "Nothing needs you. Three jobs are running." /
 *  "Nothing needs you, and nothing is running." A partial needs read is a floor and says so; an
 *  unread run list never yields a verdict.
 */
export function homeSentence({ read, waiting, partial, running }: { read: HomeRead; waiting: number | null; partial: boolean; running: number }): string {
  if (read === 'failed') return 'I can’t say what is going on until your work loads.';
  if (read === 'checking' || waiting === null) return 'Checking what is going on…';
  const run = running === 0 ? null : running === 1 ? 'One job is running.' : `${countWord(running)} jobs are running.`;
  if (partial) {
    const floor = waiting === 0 ? 'Some of what needs you could not be read.' : `At least ${countWord(waiting).toLowerCase()} ${waiting === 1 ? 'thing needs' : 'things need'} you.`;
    return run === null ? floor : `${floor} ${run}`;
  }
  if (waiting === 0) return run === null ? 'Nothing needs you, and nothing is running.' : `Nothing needs you. ${run}`;
  const need = waiting === 1 ? 'One thing needs you.' : `${countWord(waiting)} things need you.`;
  return run === null ? `${need} Nothing else is running.` : `${need} ${run}`;
}

/** The one item the card shows: the highest-ranked need, decisions first (the queue's own order). */
export function topNeed(rows: readonly NeedRow[], now: number): NeedRow | null {
  return topItem(inSectionOrder(rankNeeds([...rows], now)));
}

/** One move on the card: approve a simple gate in place, a need's own act, or a plain link. */
export type CardMove =
  | { kind: 'approve'; label: string; runId: string }
  | { kind: 'act'; label: string; action: NeedAction }
  | { kind: 'link'; label: string; path: string };

/** What the card says about a need: context, a plain title, one or two sentences, at most two moves. */
export interface NeedCardWords {
  context: string;
  title: string;
  body: string | null;
  primary: CardMove;
  secondary: CardMove | null;
}

function stepOf(v: SessionView): { at: number; of: number } | null {
  const units = v.units ?? [];
  if (units.length === 0) return null;
  const done = units.filter((u) => u.status === 'done').length;
  return { at: Math.min(units.length, done + 1), of: units.length };
}

/** The need row's move label in plain words ("Approve plan…", "Retry"); the generic "Open gate" reads as what it is for. */
function moveLabel(a: NeedAction): string {
  const words = deskVerb(a.label);
  return words === 'Open gate' ? 'Review and decide' : words;
}

/**
 * A gate the card may approve in place: a SIMPLE gate (the queue's `approval` group key: at most two
 * answers, no free text) whose recommended move is to approve a low-impact plan (`gateRowVerb` names
 * "Approve plan…" only below band 40). Every other gate (a delivery, a failed verdict, a floor, a
 * high-impact plan) opens the decision, where its evidence is. The approve takes the Desk's one
 * audited path (`runBatchDecision`: the 10 s undo window, per-id failures), as the approvals group
 * row's Approve all does.
 */
export function approvesInPlace(row: NeedRow, view: SessionView | null): boolean {
  return row.kind === 'gate' && row.groupKey === 'approval' && view !== null
    && row.action.kind === 'open' && /^Approve plan/.test(row.action.label);
}

export function needCardWords(row: NeedRow, view: SessionView | null, { agentName, ago }: { agentName: (cli: string) => string; ago: string | null }): NeedCardWords {
  const job = view !== null ? jobTitle(view.session) : plainRunTitle(row.subject);
  const agent = view === null ? null : leadAgentOf(view);
  const where = view === null ? senderOf(row) : (repoNameOf(view) ?? workflowOf(view).label);
  const context = [where, agent !== null ? agentName(agent) : null, ago].filter((x): x is string => x !== null && x !== '').join(' · ');
  const title = row.question ?? row.text;
  const step = view === null ? null : stepOf(view);
  const at = step === null ? '' : ` at step ${step.at} of ${step.of}`;
  const body = row.kind === 'gate'
    ? `“${job}” is paused${at} until you answer.`
    : row.kind === 'failed-run'
      ? `“${job}” stopped${at}. Retry starts it again, or open it to see why it failed.`
      : view !== null ? (row.text !== title ? `${row.text} In “${job}”.` : `In “${job}”.`)
        : row.text !== title ? row.text : null;
  const act: CardMove = { kind: 'act', label: moveLabel(row.action), action: row.action };
  if (approvesInPlace(row, view)) {
    return { context, title, body, primary: { kind: 'approve', label: 'Approve plan', runId: view!.session.id }, secondary: { ...act, label: 'See the plan' } };
  }
  const actPath = row.action.kind === 'open' ? row.action.path.split('#')[0] : null;
  const secondary: CardMove | null = row.kind === 'failed-run'
    ? { kind: 'link', label: 'See why', path: row.subjectPath }
    : view !== null && actPath !== row.subjectPath.split('#')[0] ? { kind: 'link', label: 'Open the job', path: row.subjectPath } : null;
  return { context, title, body, primary: act, secondary };
}

function senderOf(row: NeedRow): string {
  if (row.kind === 'repo-graph') return 'Repositories';
  if (row.kind === 'proposal') return 'Steering';
  if (row.kind === 'campaign') return 'Tests';
  if (row.kind === 'stalled-chat') return 'Chat';
  return 'Studio';
}

/** One job in progress: a title, its status word and tone, step x of y, one muted line. */
export interface ProgressRow {
  runId: string;
  title: string;
  word: StatusWord;
  tone: 'run' | 'gate';
  done: number;
  total: number;
  line: string;
}

const STAGE_WORDS: Record<string, string> = { recon: 'Looking around', build: 'Building', test: 'Testing', review: 'Reviewing', deliver: 'Delivering' };

/**
 * Jobs in progress: unarchived runs whose word is Working or Waiting on you (a held run reads
 * Waiting on you, never Working). Working first, then waiting, newest first in each; at most `max`.
 */
export function progressRows(runs: readonly SessionView[], { max, agentName }: { max: number; agentName: (cli: string) => string }): { rows: ProgressRow[]; total: number } {
  const live = runs
    .filter((v) => v.session.archived_at == null)
    .map((v) => ({ v, sw: statusWord(v) }))
    .filter(({ sw }) => sw.tone === 'run' || sw.tone === 'gate')
    .sort((a, b) => Number(a.sw.tone === 'gate') - Number(b.sw.tone === 'gate') || (createdAtMs(b.v) ?? 0) - (createdAtMs(a.v) ?? 0));
  const rows = live.slice(0, max).map(({ v, sw }) => {
    const units = v.units ?? [];
    const done = units.filter((u) => u.status === 'done').length;
    const current = units.find((u) => u.status !== 'done');
    const stage = (current as { stage?: string } | undefined)?.stage;
    const stageWord = stage === undefined ? null : (STAGE_WORDS[stage] ?? workflowLabel(stage));
    const step = units.length === 0 ? 'Planning' : `Step ${Math.min(units.length, done + 1)} of ${units.length}`;
    const tone = sw.tone as 'run' | 'gate';
    const doing = tone === 'gate' ? 'waiting for your answer' : stageWord;
    const who = tone === 'run' && current?.assigned_cli != null && current.assigned_cli !== '' ? agentName(current.assigned_cli) : null;
    return {
      runId: v.session.id,
      title: jobTitle(v.session),
      word: sw.word,
      tone,
      done,
      total: units.length,
      line: [step, doing, who].filter((x): x is string => x !== null && x !== '').join(' · '),
    };
  });
  return { rows, total: live.length };
}

function startOfDay(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** The closing line: what shipped today (since local midnight), pull requests first. */
export function shippedTodayWords(runs: readonly SessionView[], now: number): string {
  const since = startOfDay(now);
  let prs = 0;
  let other = 0;
  for (const v of runs) {
    const ended = v.session.ended_at;
    if (typeof ended !== 'number' || ended * 1000 < since) continue;
    const d = deliveryOf(v);
    if (d.state === 'delivered' && d.url !== null) prs += 1;
    else if (d.state === 'delivered' || d.state === 'pushed') other += 1;
  }
  if (prs === 0 && other === 0) return 'Nothing shipped yet today';
  const pr = prs === 0 ? null : `${prs} pull ${prs === 1 ? 'request' : 'requests'} shipped today`;
  const rest = other === 0 ? null : `${other} ${other === 1 ? 'job' : 'jobs'} delivered${pr === null ? ' today' : ''}`;
  return [pr, rest].filter((x): x is string => x !== null).join(', ');
}
