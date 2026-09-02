import type {
  AttachedRunView,
  Campaign,
  CampaignNodeDelivery,
  CampaignNodeStatus,
  RunGroup,
} from '../api/campaigns.js';
import type { SessionView } from '../api/types.js';
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
  m: Omit<CampaignCardModel, 'waiting' | 'inWindow'>,
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
): CampaignCardModel[] {
  const models: CampaignCardModel[] = [];
  for (const c of campaigns) {
    const n = campaignCounts(c);
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
      memberRunIds: campaignMemberRunIds(c),
      failing: n.failed > 0,
      runningNow: n.running > 0,
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
