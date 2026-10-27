import type { SystemAttention, SystemCli, SystemGovernanceCard, SystemInfra, SystemSnapshot } from '../api/system.js';
import { spendWords, type NerveState } from './nerveCenter.js';
import type { NerveTab } from './nerveTabs.js';
import { countWord } from './deskHome.js';

/**
 * NERVE CENTER'S OVERVIEW (`/watch`, the operator-approved mockup `ui-v2-nerve`, 2026-10-27): the calm
 * face of the page. One sentence of state, then three short sections, each a set of tiles that open the
 * tabbed detail (`?tab=`), where run ids, paths and raw checks live:
 *
 *  - SLOWING WORK NOW: crew's attention items that are the SYSTEM holding work up (infra, disk, load,
 *    a helper, no judge). A job waiting on a person is Needs you's, not the system's: it is counted in
 *    one quiet line instead.
 *  - HELPERS: one tile per CLI, its state in a word and, when crew counts it, the week's steps and pass
 *    rate.
 *  - SYSTEM: Services, This machine and Governance.
 *
 * Pure, so the words are pinned by tests. Nothing here is invented: a number crew did not send is left
 * out, never shown as 0.
 */

export type TileTone = 'ok' | 'warn' | 'fail' | 'quiet';

/** The system's own items: everything in attention that is not a job waiting on a person. */
export function slowingItems(attention: readonly SystemAttention[]): SystemAttention[] {
  return attention.filter((a) => a.panel !== 'runs');
}

/** The jobs that wait on a person (attention's run items): Needs you's, said in one line here. */
export function waitingItems(attention: readonly SystemAttention[]): SystemAttention[] {
  return attention.filter((a) => a.panel === 'runs');
}

/** Bytes in words, the way a person reads a disk: "51 GB", "820 MB". */
export function bytesWords(n: number): string {
  const gb = n / 1e9;
  if (gb >= 10) return `${Math.round(gb)} GB`;
  if (gb >= 1) return `${gb.toFixed(1).replace(/\.0$/, '')} GB`;
  return `${Math.max(1, Math.round(n / 1e6))} MB`;
}

export interface Tile {
  id: string;
  name: string;
  /** The state in a word or two ("Ready", "Not signed in", "All 10 running"). */
  state: string;
  tone: TileTone;
  /** One muted line, or null. */
  line: string | null;
  /** The detail tab the tile opens. */
  tab: NerveTab;
  /** A signed-out helper that can sign in here: its key (the tile carries a Sign in link). */
  signIn?: string;
}

/** A clock time in the user's words ("12:28 AM"). */
function at(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** One helper tile from crew's CLI card. */
export function cliTile(c: SystemCli): Tile {
  const base = { id: c.key, name: c.name, tab: 'clis' as const };
  const week = c.units === null ? null
    : [`${c.units.toLocaleString()} ${c.units === 1 ? 'step' : 'steps'}`, c.passPct !== null ? `${Math.round(c.passPct)}% pass` : null].filter((x): x is string => x !== null).join(' · ');
  if (c.state === 'signed_in') return { ...base, state: 'Ready', tone: 'ok', line: week ?? (c.statsNote !== null ? 'Not counted this week' : null) };
  if (c.state === 'benched') {
    const quota = c.reason !== null && /quota|usage limit|rate limit|too many requests|\b429\b/i.test(c.reason);
    return { ...base, state: c.benchedUntil !== null ? `Back at ${at(c.benchedUntil)}` : 'Resting', tone: 'warn', line: quota ? 'Out of quota' : 'Paused after errors' };
  }
  if (c.state === 'signed_out') return { ...base, state: 'Not signed in', tone: 'quiet', line: null, ...(c.canSignIn ? { signIn: c.key } : {}) };
  return { ...base, state: 'Not known', tone: 'quiet', line: null };
}

/** The machine's own rows (they get a tile of their own); every other infra row is a service. */
const MACHINE_KEYS = new Set(['disk', 'load']);

const isProblem = (s: SystemInfra['state']): boolean => s === 'down' || s === 'degraded' || s === 'unknown';

/** Services: every infra component but the machine's own rows. */
export function servicesTile(infra: readonly SystemInfra[]): Tile {
  const rows = infra.filter((r) => !MACHINE_KEYS.has(r.key));
  const base = { id: 'services', name: 'Services', tab: 'infra' as const };
  if (rows.length === 0) return { ...base, state: 'None reported', tone: 'quiet', line: null };
  const down = rows.filter((r) => r.state === 'down');
  const bad = rows.filter((r) => isProblem(r.state));
  const off = rows.filter((r) => r.state === 'off');
  const ok = rows.filter((r) => r.state === 'ok');
  const names = (list: readonly SystemInfra[]): string => {
    const shown = list.slice(0, 3).map((r) => r.name);
    return list.length > 3 ? `${shown.join(', ')}…` : shown.join(', ');
  };
  if (down.length > 0) return { ...base, state: `${down.length} down`, tone: 'fail', line: names(down) };
  if (bad.length > 0) return { ...base, state: `${bad.length} ${bad.length === 1 ? 'needs' : 'need'} a look`, tone: 'warn', line: names(bad) };
  const offLine = off.length === 0 ? null : `${names(off)} ${off.length === 1 ? 'starts' : 'start'} when needed`;
  return { ...base, state: off.length === 0 ? `All ${ok.length} running` : `${ok.length} running`, tone: 'ok', line: offLine ?? names(ok) };
}

/** This machine: free disk and the host's load. */
export function machineTile(infra: readonly SystemInfra[]): Tile {
  const disk = infra.find((r) => r.key === 'disk') ?? null;
  const load = infra.find((r) => r.key === 'load') ?? null;
  const base = { id: 'machine', name: 'This machine', tab: 'infra' as const };
  if (disk === null && load === null) return { ...base, state: 'Not reported', tone: 'quiet', line: null };
  const free = disk?.disk != null ? `${bytesWords(disk.disk.freeBytes)} free` : null;
  const busy = load !== null && isProblem(load.state);
  const loadWords = load === null ? null : busy ? 'Load is high' : load.state === 'ok' ? 'Load is normal' : null;
  if (disk !== null && isProblem(disk.state)) {
    return { ...base, state: disk.state === 'down' ? 'Disk full' : 'Disk nearly full', tone: disk.state === 'down' ? 'fail' : 'warn', line: [free, loadWords].filter((x): x is string => x !== null).join(' · ') || null };
  }
  if (busy) return { ...base, state: 'Running slowly', tone: load.state === 'down' ? 'fail' : 'warn', line: [free, loadWords].filter((x): x is string => x !== null).join(' · ') || null };
  return { ...base, state: 'Healthy', tone: 'ok', line: [free, loadWords].filter((x): x is string => x !== null).join(' · ') || null };
}

/** The QE pass rate, from the acceptance card's own counts (passed of passed + failed), or null. */
export function qePassPct(cards: readonly SystemGovernanceCard[]): number | null {
  const qe = cards.find((g) => g.key === 'qe_acceptance');
  const c = qe?.counts;
  if (c == null) return null;
  const passed = c['passed'] ?? c['pass'];
  const failed = c['failed'] ?? c['fail'];
  if (passed === undefined || failed === undefined || passed + failed === 0) return null;
  return Math.round((passed / (passed + failed)) * 100);
}

/** Below this QE pass rate (percent) the Governance tile says "QE passes rarely" (amber). */
export const QE_RARE_PCT = 50;

/** Governance: crew's cards, worst state first; the rules loaded and the QE pass rate when counted. */
export function governanceTile(cards: readonly SystemGovernanceCard[]): Tile {
  const base = { id: 'governance', name: 'Governance', tab: 'governance' as const };
  if (cards.length === 0) return { ...base, state: 'Not reported', tone: 'quiet', line: null };
  const down = cards.filter((g) => g.state === 'down');
  const bad = cards.filter((g) => g.state === 'degraded' || g.state === 'unknown');
  const rules = cards.find((g) => g.key === 'steering_rules');
  const qe = qePassPct(cards);
  const facts = [rules !== undefined && rules.value !== 'not counted' ? `${rules.value} ${rules.value === '1' ? 'rule' : 'rules'}` : null, qe !== null ? `QE pass ${qe}%` : null]
    .filter((x): x is string => x !== null).join(' · ') || null;
  if (down.length > 0) return { ...base, state: down.length === 1 ? down[0]!.name : `${down.length} problems`, tone: 'fail', line: facts };
  if (bad.length > 0) return { ...base, state: bad.length === 1 ? bad[0]!.name : `${bad.length} need a look`, tone: 'warn', line: facts };
  // Crew may call every card ok while QE acceptance passes rarely: never "Healthy" next to that figure.
  if (qe !== null && qe < QE_RARE_PCT) {
    const rest = rules !== undefined && rules.value !== 'not counted' ? ` · ${rules.value} ${rules.value === '1' ? 'rule' : 'rules'}` : '';
    return { ...base, state: 'QE passes rarely', tone: 'warn', line: `QE pass ${qe}%${rest}` };
  }
  return { ...base, state: 'Healthy', tone: 'ok', line: facts };
}

/** The three System tiles against a crew with the snapshot. */
export function systemTiles(snapshot: SystemSnapshot): Tile[] {
  return [servicesTile(snapshot.infra), machineTile(snapshot.infra), governanceTile(snapshot.governance)];
}

/** What a slowing item says on its card: the title, one line, and its fix in words. */
export function slowingLine(a: SystemAttention, infra: readonly SystemInfra[] | null): string | null {
  // The disk row in a person's words: what is left, and where jobs stop (crew's floor, when it says).
  if (a.panel === 'infra' && /disk/i.test(a.id)) {
    const d = infra?.find((r) => r.key === 'disk')?.disk ?? null;
    if (d != null) return `${bytesWords(d.freeBytes)} left${d.floorBytes !== null ? `; jobs stop below ${bytesWords(d.floorBytes)}` : ''}.`;
  }
  return a.reason;
}

/**
 * The page's sentence, in two parts: what holds work up (`lead`, coloured when anything does), then
 * the rest (`rest`, muted). `others` counts what needs a look without slowing work (a degraded
 * component, a helper out of quota, a signed-out helper).
 */
export function overviewSentence(state: Pick<NerveState, 'read'>, slowing: readonly SystemAttention[], others: number): { lead: string; rest: string; tone: 'ok' | 'warn' | 'fail' | 'quiet' } {
  if (state.read === 'checking') return { lead: 'Checking crew…', rest: '', tone: 'quiet' };
  if (state.read !== 'fresh') return { lead: 'Can’t reach crew.', rest: 'What you see below may be out of date.', tone: 'warn' };
  const n = slowing.length;
  const rest = others === 0 ? (n === 0 ? 'Everything is healthy.' : 'Everything else is healthy.')
    : `${countWord(others)} ${others === 1 ? 'thing needs' : 'things need'} a look.`;
  if (n === 0) return { lead: 'Nothing is slowing work.', rest, tone: 'ok' };
  const red = slowing.some((a) => a.level === 'red' || a.kind === 'prevents');
  const what = n === 1 ? 'one thing' : `${countWord(n).toLowerCase()} things`;
  return { lead: `Work is ${red ? 'stopped' : 'slowed'} by ${what}.`, rest, tone: red ? 'fail' : 'warn' };
}

/** Tiles that need a look but are not in attention: they count in the sentence's second part. */
export function tilesNeedingALook(tiles: readonly Tile[]): number {
  return tiles.filter((t) => t.tone === 'warn' || t.tone === 'fail' || t.signIn !== undefined).length;
}

/** "One job needs you." / "Three jobs need you." (the waiting line), or null with none. */
export function waitingWords(n: number): string | null {
  if (n <= 0) return null;
  return `${countWord(n)} ${n === 1 ? 'job needs' : 'jobs need'} you.`;
}

/** "16 jobs to tidy up ($4.20 spent)": work nobody resolved (failed, superseded, parked), or null with none. */
export function tidyWords(n: number, spendUsd: number | null): string | null {
  if (n <= 0) return null;
  return `${n} ${n === 1 ? 'job' : 'jobs'} to tidy up${spendUsd !== null && spendUsd > 0 ? ` (${spendWords(spendUsd)} spent)` : ''}`;
}
