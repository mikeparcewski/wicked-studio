import type {
  AttachedRunView,
  Campaign,
  CampaignNodeDelivery,
  CampaignNodeStatus,
  RunGroup,
} from '../api/campaigns.js';
import type { SessionView } from '../api/types.js';
import type { TestSet } from '../api/wave6-wire.js';
import { isPrUrl } from '../components/delivery.js';
import { healthOf, type Health } from './windowStats.js';

/**
 * The Campaigns landing's pure folds — everything the KPI band and the card grid derive from
 * the ONE `GET /campaigns` answer (engine campaigns + ad-hoc `RunGroup`s, api-types 0.19.0)
 * plus the live run list the app already holds. Pure and unit-tested, like `windowStats`, so
 * the band and the cards cannot disagree.
 *
 * HONESTY NOTES:
 *  - Node statuses are ENGINE-PERSISTED over the FULL node set — folding over `node_status`
 *    keeps the §4.2 archived-run honesty (the live run list is archive-filtered; the campaign
 *    is not).
 *  - The engine campaign carries NO clocks, so nothing here fabricates a time series or an
 *    "N ago" — recency stays the positional window idiom over the live member runs.
 *  - The delivery rollup reads ONLY wire-carried facts: `node_delivery` / the members'
 *    `delivery`+`deliverUrl` (both daemon-joined, 0.19.0). A pre-0.19 daemon omits them and
 *    the rollup says so by being absent (`onWire: false`) — never a fabricated "0 of N".
 *  - Every PR href passes {@link isPrUrl} — the one shape gate every PR claim in studio takes.
 *  - The produced TEST SETS (wave 6, api-types 0.36.0) arrive as the top-level
 *    `CampaignsListResponse.test_sets`, NOT as a row-level join: the fold joins them onto a card by
 *    `run_id` against the member runs and, for a label group, by the `qe-tests-<repo>` `label` the
 *    daemon filed the producing run under. A pre-0.36 daemon carries none — every card's list is
 *    `[]` and the KPI context says nothing about sets (absence, never a fabricated zero).
 */

// ── Status folding ─────────────────────────────────────────────────────────────

/** Run counts folded CLIENT-SIDE from the engine's persisted per-node statuses. */
export interface CampaignCounts {
  /** DAG nodes — the campaign's own declared denominator. */
  nodes: number;
  landed: number;
  failed: number;
  cancelled: number;
  running: number;
  awaitingHuman: number;
  /** pending | ready — declared work not yet moving. */
  queued: number;
  /** Ad-hoc runs filed onto this campaign at launch (provenance, not DAG nodes). */
  attached: number;
}

const NODE_BUCKET: Record<CampaignNodeStatus, keyof Omit<CampaignCounts, 'nodes' | 'attached'>> = {
  pending: 'queued',
  ready: 'queued',
  running: 'running',
  ready_to_resume: 'running',
  awaiting_human: 'awaitingHuman',
  completed: 'landed',
  // `blocked` is a terminal non-delivery: a dep failed, this node will not run.
  blocked: 'failed',
  failed: 'failed',
  cancelled: 'cancelled',
};

export function campaignCounts(c: Campaign): CampaignCounts {
  const t: CampaignCounts = {
    nodes: c.def.nodes.length, landed: 0, failed: 0, cancelled: 0,
    running: 0, awaitingHuman: 0, queued: 0, attached: c.attached_runs?.length ?? 0,
  };
  for (const node of c.def.nodes) {
    const s = c.node_status[node.node_id];
    // A node the status map does not name yet is declared-but-unmoved work.
    t[s === undefined ? 'queued' : NODE_BUCKET[s]] += 1;
  }
  return t;
}

// ── Members: the run-id join against the live list ─────────────────────────────

/** Every member run id of one campaign — DAG-node runs first, attached runs after. */
export function campaignMemberRunIds(c: Campaign): string[] {
  const ids: string[] = [];
  for (const node of c.def.nodes) {
    const id = c.node_run_id[node.node_id];
    if (id !== undefined) ids.push(id);
  }
  for (const a of c.attached_runs ?? []) ids.push(a.runId);
  return ids;
}

/** Every member run id across campaigns AND groups — the window join key. */
export function memberRunIdSet(campaigns: readonly Campaign[], groups: readonly RunGroup[]): Set<string> {
  const ids = new Set<string>();
  for (const c of campaigns) for (const id of campaignMemberRunIds(c)) ids.add(id);
  for (const g of groups) for (const r of g.runs) ids.add(r.runId);
  return ids;
}

// ── The delivery rollup (wire facts only) ──────────────────────────────────────

/** One delivered member's linkable PR — the href already passed {@link isPrUrl}. */
export interface RollupPr {
  runId: string;
  href: string;
}

/** One stranded member — finished work waiting on a person, no PR (needs-you class). */
export interface StrandedMember {
  runId: string;
  /** node_id for a DAG node; the run id for an attached/grouped run. */
  label: string;
}

export interface DeliveryRollup {
  /** Whether this daemon carried per-member delivery at all (api-types 0.19.0). */
  onWire: boolean;
  /** Members whose wire-carried delivery is `'delivered'`. */
  delivered: number;
  /** The rollup denominator — every member that could deliver (nodes + attached/grouped). */
  total: number;
  /** Delivered members' PR links, {@link isPrUrl}-gated; wire order. */
  prs: RollupPr[];
  stranded: StrandedMember[];
}

function foldMember(
  rollup: DeliveryRollup,
  runId: string,
  label: string,
  d: CampaignNodeDelivery | AttachedRunView,
): void {
  if (d.delivery === 'delivered') {
    rollup.delivered += 1;
    if (typeof d.deliverUrl === 'string' && isPrUrl(d.deliverUrl)) {
      rollup.prs.push({ runId, href: d.deliverUrl });
    }
  } else if (d.delivery === 'stranded') {
    rollup.stranded.push({ runId, label });
  }
}

/**
 * The campaign's "n of N delivered" — N is every DAG node plus every attached run (declared
 * work counts before it dispatches; an undispatched node simply has no delivery fact yet).
 */
export function campaignDeliveryRollup(c: Campaign): DeliveryRollup {
  const rollup: DeliveryRollup = {
    onWire: c.node_delivery !== undefined || c.attached_runs !== undefined,
    delivered: 0,
    total: c.def.nodes.length + (c.attached_runs?.length ?? 0),
    prs: [],
    stranded: [],
  };
  for (const node of c.def.nodes) {
    const d = c.node_delivery?.[node.node_id];
    if (d === undefined) continue;
    foldMember(rollup, c.node_run_id[node.node_id] ?? node.node_id, node.node_id, d);
  }
  for (const a of c.attached_runs ?? []) foldMember(rollup, a.runId, a.runId, a);
  return rollup;
}

/** A group's rollup — same fold, members are the label's runs (always wire-carried). */
export function groupDeliveryRollup(g: RunGroup): DeliveryRollup {
  const rollup: DeliveryRollup = {
    onWire: true, delivered: 0, total: g.runs.length, prs: [], stranded: [],
  };
  for (const r of g.runs) foldMember(rollup, r.runId, r.runId, r);
  return rollup;
}

// ── Aggregates for the KPI band ────────────────────────────────────────────────

export interface CampaignTotals {
  campaigns: number;
  groups: number;
  /** Campaigns/groups with anything moving or waiting right now. */
  activeNow: number;
  landed: number;
  failed: number;
  running: number;
  awaitingHuman: number;
  /** landed + failed + cancelled — the pass-rate denominator. */
  terminal: number;
}

function groupStatusCounts(g: RunGroup): { running: number; awaitingHuman: number; landed: number; failed: number; cancelled: number } {
  const t = { running: 0, awaitingHuman: 0, landed: 0, failed: 0, cancelled: 0 };
  for (const r of g.runs) {
    if (r.status === 'awaiting_human') t.awaitingHuman += 1;
    else if (r.status === 'completed') t.landed += 1;
    else if (r.status === 'failed') t.failed += 1;
    else if (r.status === 'cancelled') t.cancelled += 1;
    else t.running += 1; // planning | distributing | executing
  }
  return t;
}

export function campaignTotals(campaigns: readonly Campaign[], groups: readonly RunGroup[]): CampaignTotals {
  const t: CampaignTotals = {
    campaigns: campaigns.length, groups: groups.length, activeNow: 0,
    landed: 0, failed: 0, running: 0, awaitingHuman: 0, terminal: 0,
  };
  for (const c of campaigns) {
    const n = campaignCounts(c);
    if (n.running > 0 || n.awaitingHuman > 0) t.activeNow += 1;
    t.landed += n.landed;
    t.failed += n.failed;
    t.running += n.running;
    t.awaitingHuman += n.awaitingHuman;
    t.terminal += n.landed + n.failed + n.cancelled;
  }
  for (const g of groups) {
    const n = groupStatusCounts(g);
    if (n.running > 0 || n.awaitingHuman > 0) t.activeNow += 1;
    t.landed += n.landed;
    t.failed += n.failed;
    t.running += n.running;
    t.awaitingHuman += n.awaitingHuman;
    t.terminal += n.landed + n.failed + n.cancelled;
  }
  return t;
}

/** The pass-rate word: whole-percent when a denominator exists, an honest "—" otherwise. */
export function passRateWord(landed: number, terminal: number): string {
  if (terminal === 0) return '—';
  return `${Math.round((landed / terminal) * 100)}%`;
}

/** The pass-rate health — `windowStats.healthOf` reused so the thresholds cannot drift. */
export function passRateHealth(landed: number, terminal: number): Health {
  return healthOf(landed, terminal);
}

// ── The produced test sets (wave 6, api-types 0.36.0 — F-7R2-014) ─────────────

/**
 * The sets that belong on ONE card: joined by `run_id` against the member runs and — for a label
 * group — by the `label` the daemon filed the producing run under (`qe-tests-<repo>`, so a set can
 * name its group even when the group's member list is read from an older snapshot). Deduped by set
 * id; wire order kept (newest first).
 */
export function joinTestSets(
  memberRunIds: readonly string[],
  label: string | null,
  testSets: readonly TestSet[],
): TestSet[] {
  const members = new Set(memberRunIds);
  const seen = new Set<string>();
  const out: TestSet[] = [];
  for (const t of testSets) {
    if (!members.has(t.run_id) && (label === null || t.label !== label)) continue;
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    out.push(t);
  }
  return out;
}

/** The registered sets' rollup — the landing's KPI context and the Home door. Pure sums of the
 *  wire's counts; nothing here is a rate or a fabricated denominator. */
export interface TestSetTotals {
  sets: number;
  /** Sets whose verify phase PASSED (`verified: true`). */
  verified: number;
  produced: number;
  executed: number;
  passed: number;
  failed: number;
  notExecuted: number;
}

export function testSetTotals(testSets: readonly TestSet[]): TestSetTotals {
  const t: TestSetTotals = { sets: 0, verified: 0, produced: 0, executed: 0, passed: 0, failed: 0, notExecuted: 0 };
  for (const s of testSets) {
    t.sets += 1;
    if (s.verified) t.verified += 1;
    t.produced += s.produced;
    t.executed += s.executed;
    t.passed += s.passed;
    t.failed += s.failed;
    t.notExecuted += s.not_executed;
  }
  return t;
}

/** The ONE spelling of a set's four counts — "11 produced · 11 executed · 11 passed · 0 failed".
 *  The card appends "· N not executed" beside it only when the verify phase left tests unrun
 *  (F-7R2-015's lesson: never silently). */
export function testSetCountsWord(t: Pick<TestSet, 'produced' | 'executed' | 'passed' | 'failed'>): string {
  return `${t.produced} produced · ${t.executed} executed · ${t.passed} passed · ${t.failed} failed`;
}

/** The set's delivered PR — `deliverUrl` through {@link isPrUrl}, the one gate every PR claim
 *  takes; `null` when absent or out of shape. */
export function testSetPrHref(t: TestSet | Pick<TestSet, 'deliverUrl'>): string | null {
  return typeof t.deliverUrl === 'string' && isPrUrl(t.deliverUrl) ? t.deliverUrl : null;
}

/**
 * The Home "Test" door's count line — the SAME census as the landing's "Tests" tile (campaigns +
 * label groups), with the registered sets appended once a 0.36 daemon serves them: "2 tests ·
 * 3 test sets". A 0.36 daemon with nothing registered says "2 tests · 0 test sets" — its REAL zero;
 * a pre-0.36 daemon (`testSets: null`) says only "2 tests" — the sets are absent, not zero (review
 * of #266, F-3). (`groups` is optional only for older partial answers; it reads as none.)
 */
export function testDoorWord(listing: {
  campaigns: readonly unknown[];
  groups?: readonly unknown[] | undefined;
  testSets?: readonly TestSet[] | null | undefined;
}): string {
  const plural = (n: number, w: string): string => `${n} ${w}${n === 1 ? '' : 's'}`;
  const tests = plural(listing.campaigns.length + (listing.groups?.length ?? 0), 'test');
  const sets = listing.testSets ?? null;
  return sets === null ? tests : `${tests} · ${plural(sets.length, 'test set')}`;
}

/**
 * The registered sets NO card carries (review of #266, F-2): a set joins a card only through a
 * member `run_id` or a group `label`, so once the producing run is archived / reaped and its group
 * drops off the wire, the set — a durable audit entry the daemon still hydrates — has nowhere to
 * open. Counted on the Tests tile as "N unattributed", never folded silently into the sets total.
 */
export function unattributedTestSets(cards: readonly CampaignCardModel[], testSets: readonly TestSet[]): TestSet[] {
  const carried = new Set<string>();
  for (const c of cards) for (const t of c.testSets) carried.add(t.id);
  return testSets.filter((t) => !carried.has(t.id));
}

/**
 * The Tests tile's sets word — FIRST in the tile's context so it is the part that survives the
 * tile's ellipsis (review of #266, F-1), plus "· N unattributed" and "· N malformed" whenever either
 * is non-zero (deny-dominates: never hidden). A 0.36 daemon with nothing registered says its real
 * zero (F-3); a pre-0.36 daemon has no word at all (the caller passes no totals).
 *
 * Two forms of the same fact (R2-1): the `lead` — "1 set · 11/11 passed" — is what the tile PAINTS,
 * sized so the whole lead clears the `…` glyph at 1440 px (it is the Tests tile: "set" needs no
 * "test"); the `full` — "1 test set · 11/11 passed" — rides the span's `title`, so hover always
 * reads the unabridged line.
 */
export function testSetsWord(
  totals: TestSetTotals,
  unattributed: number,
  malformed: number,
  form: 'lead' | 'full' = 'lead',
): string {
  const noun = form === 'full' ? 'test set' : 'set';
  if (totals.sets === 0 && malformed === 0) return `no ${noun}s registered yet`;
  const parts = [`${totals.sets} ${noun}${totals.sets === 1 ? '' : 's'} · ${totals.passed}/${totals.produced} passed`];
  if (unattributed > 0) parts.push(`${unattributed} unattributed`);
  if (malformed > 0) parts.push(`${malformed} malformed`);
  return parts.join(' · ');
}

// ── The card models (needs-you first) ──────────────────────────────────────────

/** One campaign OR one ad-hoc group, as the grid renders it — one sort, one chip fold. */
export interface CampaignCardModel {
  kind: 'campaign' | 'group';
  /** Campaign id, or the group's label. */
  id: string;
  /** def.name for a campaign (id fallback); the label for a group. */
  title: string;
  campaign: Campaign | null;
  group: RunGroup | null;
  /** Landed / total for the progress word; campaign = nodes, group = member runs. */
  landed: number;
  total: number;
  failed: number;
  running: number;
  awaitingHuman: number;
  attached: number;
  rollup: DeliveryRollup;
  memberRunIds: string[];
  /** Member runs waiting on a human RIGHT NOW, from the live run list (a gate is a gate). */
  waiting: SessionView[];
  failing: boolean;
  runningNow: boolean;
  /** ≥ 1 member run inside the current recency window (positional, over the live list). */
  inWindow: boolean;
  /** The produced test sets joined onto this card (wave 6, api-types 0.36.0 — F-7R2-014): every
   *  `CampaignsListResponse.test_sets` row whose `run_id` is a member run, plus — for a group — every
   *  row the daemon tagged with this group's `label` (`qe-tests-<repo>`). Wire order (newest first);
   *  `[]` when none, and always `[]` on a pre-0.36 daemon. See {@link joinTestSets}. */
  testSets: TestSet[];
  /** The distinct workflow ids of the member runs the live list knows (`session.workflow_id`) —
   *  how a card says "qe-author-tests" before any registration lands. */
  workflowIds: string[];
}

export type CampaignChip = 'all' | 'needs-you' | 'running' | 'failing' | 'quiet';

export function matchesCampaignChip(m: CampaignCardModel, chip: CampaignChip): boolean {
  if (chip === 'all') return true;
  // Stranded siblings are needs-you: finished work waiting on a person (crew#393's word).
  if (chip === 'needs-you') return m.awaitingHuman > 0 || m.rollup.stranded.length > 0;
  if (chip === 'running') return m.runningNow;
  if (chip === 'failing') return m.failing;
  return m.awaitingHuman === 0 && m.rollup.stranded.length === 0 && !m.runningNow && !m.failing; // quiet
}

function withLiveJoin(
  m: Omit<CampaignCardModel, 'waiting' | 'inWindow' | 'workflowIds'>,
  runsById: ReadonlyMap<string, SessionView>,
  windowIds: ReadonlySet<string>,
): CampaignCardModel {
  const members = m.memberRunIds
    .map((id) => runsById.get(id))
    .filter((v): v is SessionView => v !== undefined);
  return {
    ...m,
    waiting: members.filter((v) => v.session.status === 'awaiting_human'),
    inWindow: m.memberRunIds.some((id) => windowIds.has(id)),
    // Distinct, live-list order — `chat` is a system workflow, not a test's.
    workflowIds: [...new Set(members.map((v) => v.session.workflow_id).filter((w) => typeof w === 'string' && w !== '' && w !== 'chat'))],
  };
}

/**
 * One fold per campaign AND per ad-hoc group, sorted the attention-routing way: needs-you
 * FIRST (gates, then stranded work), then failing, then server order — the same order the
 * /projects grid taught. Groups ride the same grid as campaigns: one sort, no second surface.
 */
export function campaignCards(
  campaigns: readonly Campaign[],
  groups: readonly RunGroup[],
  runsById: ReadonlyMap<string, SessionView>,
  windowIds: ReadonlySet<string>,
  /** `CampaignsListResponse.test_sets` as the store holds it — pass `[]` for a pre-0.36 daemon. */
  testSets: readonly TestSet[] = [],
): CampaignCardModel[] {
  const models: CampaignCardModel[] = [];
  for (const c of campaigns) {
    const n = campaignCounts(c);
    const memberRunIds = campaignMemberRunIds(c);
    models.push(withLiveJoin({
      kind: 'campaign',
      id: c.id,
      title: c.def.name !== '' ? c.def.name : c.id,
      campaign: c,
      group: null,
      landed: n.landed,
      total: n.nodes,
      failed: n.failed,
      running: n.running,
      awaitingHuman: n.awaitingHuman,
      attached: n.attached,
      rollup: campaignDeliveryRollup(c),
      memberRunIds,
      failing: n.failed > 0,
      runningNow: n.running > 0,
      testSets: joinTestSets(memberRunIds, null, testSets),
    }, runsById, windowIds));
  }
  for (const g of groups) {
    const n = groupStatusCounts(g);
    models.push(withLiveJoin({
      kind: 'group',
      id: g.label,
      title: g.label,
      campaign: null,
      group: g,
      landed: n.landed,
      total: g.runs.length,
      failed: n.failed,
      running: n.running,
      awaitingHuman: n.awaitingHuman,
      attached: 0,
      rollup: groupDeliveryRollup(g),
      memberRunIds: g.runs.map((r) => r.runId),
      failing: n.failed > 0,
      runningNow: n.running > 0,
      testSets: joinTestSets(g.runs.map((r) => r.runId), g.label, testSets),
    }, runsById, windowIds));
  }
  return models.sort((a, b) =>
    (b.awaitingHuman > 0 ? 1 : 0) - (a.awaitingHuman > 0 ? 1 : 0)
    || (b.rollup.stranded.length > 0 ? 1 : 0) - (a.rollup.stranded.length > 0 ? 1 : 0)
    || (b.failing ? 1 : 0) - (a.failing ? 1 : 0),
  );
}

/**
 * §3.3 denominator honesty, the ONE spelling shared by card and scoreboard: a campaign's DAG
 * is a DECLARED denominator ("n of N landed"); an ad-hoc group's grows with every launch
 * under the label, so it MUST say "so far" — two different strings, never rendered
 * identically, because one of them can grow.
 */
export function progressWord(m: Pick<CampaignCardModel, 'kind' | 'landed' | 'total'>): string {
  return m.kind === 'campaign'
    ? `${m.landed} of ${m.total} landed`
    : `${m.landed} of ${m.total} landed so far`;
}

/**
 * The delivery-rollup sentence — the card's second line, wire facts only. `null` when this
 * daemon does not carry per-member delivery (pre-0.19): absence, never a fabricated zero.
 */
export function deliveryRollupWord(r: DeliveryRollup): string | null {
  if (!r.onWire) return null;
  return `${r.delivered} of ${r.total} delivered`;
}
