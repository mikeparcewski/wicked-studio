/**
 * What a voice question carries (studio#1438): the lines voice mode itself shows around the person — the running jobs,
 * what needs them, the machine — read when the question is asked. Without them the system chat had no live view, and
 * "what needs me right now?" got "I can't tell you" while the answer was on screen. It rides the question the way Ask's
 * context pack does (`context.page` on a crew that takes it, else joined after the words), so it opens the same way.
 */
import type { SystemSnapshot } from '../api/system.js';
import { PACK_OPENING } from '../board/askPack.js';
import type { NeedsSource } from '../board/attention.js';
import type { NeedRow } from '../board/needsYou.js';
import { isRunningJob, loadWord, stepWords } from './widgets.js';

/** At most this many jobs and this many needs are named; the rest are counted. */
const NAMED_MAX = 20;
const LINE_MAX = 300;

const clip = (s: string): string => (s.length <= LINE_MAX ? s : `${s.slice(0, LINE_MAX - 1)}…`);

function named(items: readonly string[]): string[] {
  const shown = items.slice(0, NAMED_MAX).map((t) => `  - ${clip(t)}`);
  return items.length > NAMED_MAX ? [...shown, `  - and ${items.length - NAMED_MAX} more`] : shown;
}

/** A needs row and a folded group's members, one line each, in the Desk's words (a gate's plain question). */
function rowWords(rows: readonly NeedRow[]): string[] {
  return rows.flatMap((r) => r.members ?? [r]).map((r) => `${r.subject}: ${r.question ?? r.text}`);
}

/**
 * The pack. `snapshot` is the system read voice shows, `null` when none is fresh enough to call now; `needs` is the
 * one needs-you source the app counts from (crew's ranked list, else the app's needs rows); `needsPhase` is the app's
 * settled needs phase and `count` the number the person sees: while it is loading nothing is said about needs, a partial
 * read says so, and while the list has moved on from a held number the number is said without names (never a list the
 * number does not count).
 */
export function voiceGround(a: { snapshot: SystemSnapshot | null; needs: NeedsSource; needsPhase: 'loading' | 'complete' | 'partial'; count: number | null; now: number }): string {
  const jobs = a.snapshot === null ? null : a.snapshot.runs.filter(isRunningJob).map((r) => {
    const step = stepWords(r.phase);
    return `${r.title}${step !== null ? ` · on ${step}` : ''}${r.liveness !== 'working' ? ` (${r.liveness})` : ''}`;
  });
  const needs = a.needs.phase === 'loading' || a.needsPhase === 'loading' ? null
    : a.needs.from === 'crew' ? a.needs.items.map((i) => (i.reason !== null && i.reason !== '' ? `${i.text}: ${i.reason}` : i.text))
    : rowWords(a.needs.rows);
  const from = a.needsPhase === 'partial' ? ' (some of studio\u2019s reads have not answered, so there may be more)' : '';
  const settling = needs !== null && a.count !== null && needs.length !== a.count;
  const needsLine = needs === null ? 'needs you: not read yet'
    : settling ? `needs you: ${a.count} (the list behind that number is still changing, so its names are not read yet)`
    : needs.length === 0 ? `needs you: nothing${from}` : `needs you: ${needs.length}${from}`;
  const load = a.snapshot?.infra.find((i) => i.key === 'load');
  return [
    `${PACK_OPENING}${new Date(a.now).toISOString()}]`,
    'where: voice mode. These lines are what studio shows the person around this question right now.',
    jobs === null ? 'jobs running: not read yet' : jobs.length === 0 ? 'jobs running: none' : `jobs running: ${jobs.length}`,
    ...named(jobs ?? []),
    needsLine,
    ...named(settling ? [] : needs ?? []),
    `machine load: ${loadWord(load)}`,
    'Answer from these lines first. For anything they do not say, read it (the estate/garden tooling, the run record)',
    'or say it is not reachable; never guess.',
  ].join('\n');
}
