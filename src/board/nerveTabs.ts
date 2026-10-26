import type { SystemAttention, SystemSnapshot } from '../api/system.js';
import type { NerveState } from './nerveCenter.js';

/**
 * NERVE CENTER'S TABS (operator 2026-10-25: "Nerve center is one giant page — use tabs or some
 * treatment that isn't so overwhelming"). `/watch` is a compact header (the verdict, its sentence,
 * Re-check and one summary chip per area) over five tabs: Attention · CLIs · Runs · Infra ·
 * Governance. Pure, so the rules are pinned by tests:
 *
 *  - the tab rides the address (`?tab=`), so a link, Back/Forward and a reload land on the same tab;
 *  - without one, a feed filter (`?filter=`, the Desk's "See all" link) opens Runs, where the feed is;
 *  - otherwise the page lands on Attention when anything needs attention, else on CLIs;
 *  - every area's chip and tab dot is coloured by its worst state, and is NEVER green over a read
 *    that is not fresh (checking, failed or stale): the tile's rule, applied to every area.
 */

export type NerveTab = 'attention' | 'clis' | 'runs' | 'infra' | 'governance';

export const NERVE_TABS: readonly NerveTab[] = ['attention', 'clis', 'runs', 'infra', 'governance'];

export const NERVE_TAB_LABEL: Record<NerveTab, string> = {
  attention: 'Attention', clis: 'CLIs', runs: 'Runs', infra: 'Infra', governance: 'Governance',
};

/** `?tab=` on the address when it names a tab; anything else is no choice (`null`). */
export function readNerveTab(search: string): NerveTab | null {
  const v = new URLSearchParams(search).get('tab');
  return (NERVE_TABS as readonly string[]).includes(v ?? '') ? (v as NerveTab) : null;
}

/** A tab's address, keeping the rest of the query (the feed's `?filter=`). */
export function nerveTabPath(search: string, tab: NerveTab): string {
  const params = new URLSearchParams(search);
  params.set('tab', tab);
  return `/watch?${params.toString()}`;
}

/** Where the page lands with no `?tab=`: Attention when anything needs attention, else CLIs.
 *  `null` while crew has not answered yet (the caller holds Attention, which says "checking"). */
export function landingTab(state: Pick<NerveState, 'read' | 'attention'>): NerveTab | null {
  if (state.read === 'checking') return null;
  return state.attention.length > 0 ? 'attention' : 'clis';
}

/** The tab shown: the address's choice, else the feed's filter (Runs), else the landing (held on
 *  Attention while checking). */
export function activeNerveTab(search: string, landing: NerveTab | null): NerveTab {
  const chosen = readNerveTab(search);
  if (chosen !== null) return chosen;
  if (new URLSearchParams(search).get('filter') !== null) return 'runs';
  return landing ?? 'attention';
}

/** An area's colour: `fail` blocks work (red), `warn` needs a look (yellow), `ok` is green — only over
 *  a fresh read — and `unknown` is not known yet or no longer current (grey, never green). */
export type AreaTone = 'ok' | 'warn' | 'fail' | 'unknown';

export const AREA_TONE_WORD: Record<AreaTone, string> = { ok: 'ok', warn: 'needs a look', fail: 'blocking', unknown: 'not known' };

export interface AreaSummary {
  id: NerveTab;
  label: string;
  /** The chip's words after the label ("3/5 signed in", "1 waiting", "1 down", "ok"). */
  words: string;
  tone: AreaTone;
  /** Attention's item count (the tab carries it); `undefined` for the other areas. */
  count?: number;
  /** The read behind this is not fresh: its tone was held off green. */
  stale: boolean;
}

/** One roster seat as the CLIs summary reads it (an older crew): ready to work (signed in, or no
 *  sign-in needed), not ready (signed out, or not picked), or not known; and whether the roster
 *  reports a failure for it (its health is not active: a quota hit, a crash). */
export interface FallbackSeat { ready: boolean | null; failing: boolean }

/** What an older crew (no snapshot) can still say per area. */
export interface FallbackSignals {
  /** The roster's seats (`null` until the roster is read). */
  roster: readonly FallbackSeat[] | null;
  /** The roster read behind `roster`: a failed or overdue re-read keeps the last seats on screen,
   *  and the CLIs chip must not stay green over them. */
  rosterRead?: 'fresh' | 'failed' | 'stale';
  /** The Desk's settled needs-you count. */
  needCount: number;
  /** The governance read: `unread` until it answers, `absent` when this crew has none. */
  governance: 'unread' | 'absent' | 'error' | 'ok';
}

const RANK: Record<AreaTone, number> = { ok: 0, unknown: 1, warn: 2, fail: 3 };
const worse = (a: AreaTone, b: AreaTone): AreaTone => (RANK[b] > RANK[a] ? b : a);

function attentionTone(items: readonly SystemAttention[]): AreaTone {
  if (items.some((a) => a.level === 'red')) return 'fail';
  return items.length > 0 ? 'warn' : 'ok';
}

/** Counts in words, worst kind first: `[[2, 'down'], [1, 'degraded']]` → "2 down". */
function worstCount(pairs: readonly [number, string][]): string | null {
  const hit = pairs.find(([n]) => n > 0);
  return hit === undefined ? null : `${hit[0]} ${hit[1]}`;
}

/** When the data says nothing is wrong but attention has items for this area: their words. */
function attentionWords(items: readonly SystemAttention[]): string | null {
  if (items.length === 0) return null;
  return items.length === 1 ? items[0]!.text : `${items.length} need a look`;
}

/**
 * The five areas, in tab order. `snapshot` is crew's `GET /system` (a crew with the capability);
 * `fallback` is what an older crew can say. A read that is not fresh never colours an area green.
 */
export function nerveSummary(state: Pick<NerveState, 'read' | 'attention'>, snapshot: SystemSnapshot | null, fallback: FallbackSignals): AreaSummary[] {
  const fresh = state.read === 'fresh';
  const checking = state.read === 'checking';
  const of = (panel: SystemAttention['panel']): SystemAttention[] => state.attention.filter((a) => a.panel === panel);
  const done = (id: NerveTab, words: string, tone: AreaTone, count?: number, held = false): AreaSummary => {
    const off = (!fresh || held) && tone === 'ok';
    return { id, label: NERVE_TAB_LABEL[id], words, tone: off ? 'unknown' : tone, ...(count !== undefined ? { count } : {}), stale: !fresh || held };
  };
  // Not answered yet ("checking") only while the verdict itself is checking; after a failed read the
  // area is "not known", never "checking".
  const pending = checking ? 'checking' : 'not known';

  // Attention: the verdict's own items.
  const n = state.attention.length;
  const attention = checking ? done('attention', 'checking', 'unknown') : done('attention', String(n), attentionTone(state.attention), n);

  // CLIs: how many are signed in. A signed-out, benched or unknown CLI needs a look; only crew's own
  // attention (a red item) says one blocks work.
  let clis: AreaSummary;
  const cliItems = of('clis');
  if (snapshot !== null) {
    const total = snapshot.clis.length;
    const signed = snapshot.clis.filter((c) => c.state === 'signed_in').length;
    const base: AreaTone = total === 0 ? 'unknown' : signed < total ? 'warn' : 'ok';
    clis = done('clis', total === 0 ? 'none reported' : `${signed}/${total} signed in`, worse(base, attentionTone(cliItems)));
  } else if (fallback.roster !== null) {
    const seats = fallback.roster;
    const total = seats.length;
    const signed = seats.filter((s) => s.ready === true).length;
    // A seat known to be out or failing needs a look, even when another seat's state is not known.
    const bad = seats.some((s) => s.ready === false || s.failing);
    const known = seats.every((s) => s.ready !== null);
    const base: AreaTone = total === 0 ? 'unknown' : bad ? 'warn' : known ? 'ok' : 'unknown';
    const read = fallback.rosterRead ?? 'fresh';
    const tone = worse(read === 'failed' ? worse(base, 'warn') : base, attentionTone(cliItems));
    const words = read === 'failed' ? "roster can't be read" : total === 0 ? 'none reported' : `${signed}/${total} signed in`;
    clis = done('clis', words, tone, undefined, read !== 'fresh');
  } else {
    clis = done('clis', pending, worse('unknown', attentionTone(cliItems)));
  }

  // Runs: the worst liveness, counted. Waiting on you, held, stalled or quiet needs a look; crew's
  // attention says which block work.
  let runs: AreaSummary;
  const runItems = of('runs');
  if (snapshot !== null) {
    const c = (l: string): number => snapshot.runs.filter((r) => r.liveness === l).length;
    const bad = worstCount([[c('waiting_on_you'), 'waiting'], [c('held'), 'held'], [c('stalled'), 'stalled'], [c('quiet'), 'quiet']]);
    const working = c('working');
    const words = bad ?? (working > 0 ? `${working} working` : 'none');
    runs = done('runs', words, worse(bad !== null ? 'warn' : 'ok', attentionTone(runItems)));
  } else if (!checking) {
    // An older crew: no liveness, only the needs-you count.
    const words = fallback.needCount > 0 ? `${fallback.needCount} waiting` : 'none waiting';
    runs = done('runs', words, worse(fallback.needCount > 0 ? 'warn' : 'ok', attentionTone(runItems)));
  } else {
    runs = done('runs', pending, 'unknown');
  }

  // Infra: a component down blocks work; degraded or unknown needs a look; `off` is not a problem.
  let infra: AreaSummary;
  const infraItems = of('infra');
  if (snapshot !== null) {
    const c = (s: string): number => snapshot.infra.filter((r) => r.state === s).length;
    const down = c('down');
    const bad = worstCount([[down, 'down'], [c('degraded'), 'degraded'], [c('unknown'), 'unknown']]);
    const tone = worse(down > 0 ? 'fail' : bad !== null ? 'warn' : 'ok', attentionTone(infraItems));
    infra = done('infra', bad ?? attentionWords(infraItems) ?? 'ok', tone);
  } else if (!checking) {
    infra = done('infra', attentionWords(infraItems) ?? 'ok', attentionTone(infraItems));
  } else {
    infra = done('infra', pending, 'unknown');
  }

  // Governance: the same states as infra, over crew's governance cards (or an older crew's findings).
  let governance: AreaSummary;
  const govItems = of('governance');
  if (snapshot !== null) {
    const c = (s: string): number => snapshot.governance.filter((g) => g.state === s).length;
    const down = c('down');
    const bad = worstCount([[down, 'down'], [c('degraded'), 'degraded'], [c('unknown'), 'unknown']]);
    const tone = worse(down > 0 ? 'fail' : bad !== null ? 'warn' : 'ok', attentionTone(govItems));
    governance = done('governance', bad ?? attentionWords(govItems) ?? 'ok', tone);
  } else if (fallback.governance === 'unread' || checking) {
    governance = done('governance', pending, worse('unknown', attentionTone(govItems)));
  } else if (fallback.governance === 'absent') {
    governance = done('governance', 'not reported', worse('unknown', attentionTone(govItems)));
  } else if (fallback.governance === 'error') {
    // A governance read that failed is never "ok", whatever attention says.
    governance = done('governance', attentionWords(govItems) ?? "can't be read", worse('warn', attentionTone(govItems)));
  } else {
    governance = done('governance', attentionWords(govItems) ?? 'ok', attentionTone(govItems));
  }

  return [attention, clis, runs, infra, governance];
}
