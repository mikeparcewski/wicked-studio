import type { CampaignSummary } from '../api/campaigns.js';
import type { SessionView } from '../api/types.js';
import { healthOf, type Health, type StatDelta } from './windowStats.js';

/**
 * The Campaigns landing's pure folds (the testing-UX wave) — everything the KPI band and the
 * card grid derive from the ONE `GET /campaigns` answer plus the run list the app already
 * holds. Pure and unit-tested, like `windowStats`, so the band and the cards cannot disagree.
 *
 * HONESTY NOTES:
 *  - Campaign counts are SERVER aggregates over the FULL filed set (archived included, §4.2)
 *    — they are never re-derived from the archive-filtered run list.
 *  - Campaigns carry REAL clocks (`created_at`/`updated_at`), unlike the run DTO — so the
 *    campaigns tile's delta and sparkline are time-based (days), while every run-derived
 *    number stays on the positional window idiom (`windowStats`). The two models are never
 *    mixed inside one number.
 *  - There is NO per-run timestamp on the campaign LIST wire, so a per-card time sparkline is
 *    not derivable without N detail fetches — the card renders the scoreboard's segmented
 *    status bar (real, wire-carried counts) instead of a fabricated series.
 */

// ── Aggregates for the KPI band ───────────────────────────────────────────────

export interface CampaignTotals {
  campaigns: number;
  /** Campaigns with anything moving or waiting right now (running or awaitingHuman > 0). */
  activeNow: number;
  filed: number;
  landed: number;
  failed: number;
  cancelled: number;
  running: number;
  awaitingHuman: number;
  /** landed + failed + cancelled — the pass-rate denominator. */
  terminal: number;
}

export function campaignTotals(summaries: readonly CampaignSummary[]): CampaignTotals {
  const t: CampaignTotals = {
    campaigns: summaries.length, activeNow: 0, filed: 0, landed: 0, failed: 0,
    cancelled: 0, running: 0, awaitingHuman: 0, terminal: 0,
  };
  for (const s of summaries) {
    const c = s.counts;
    if (c.running > 0 || c.awaitingHuman > 0) t.activeNow += 1;
    t.filed += c.filed;
    t.landed += c.landed;
    t.failed += c.failed;
    t.cancelled += c.cancelled;
    t.running += c.running;
    t.awaitingHuman += c.awaitingHuman;
    t.terminal += c.landed + c.failed + c.cancelled;
  }
  return t;
}

/** Every run id filed under any campaign — the join key against the live run list. */
export function campaignRunIdSet(summaries: readonly CampaignSummary[]): Set<string> {
  const ids = new Set<string>();
  for (const s of summaries) for (const id of s.runIds) ids.add(id);
  return ids;
}

/**
 * Daily campaign-activity buckets off `updated_at` (the newest launch filed, or the newest
 * metadata write), oldest first — REAL clocks, so this series is time-based. Campaigns
 * outside the span are simply absent, never painted at an invented time.
 */
export function campaignActivitySeries(
  summaries: readonly CampaignSummary[],
  days: number,
  now: number,
): number[] {
  const DAY = 24 * 3_600_000;
  const counts = new Array<number>(days).fill(0);
  for (const s of summaries) {
    const age = now - s.campaign.updated_at;
    if (age < 0 || age >= days * DAY) continue;
    const bucket = days - 1 - Math.floor(age / DAY);
    counts[bucket] = (counts[bucket] ?? 0) + 1;
  }
  return counts;
}

/**
 * Campaigns created in the last `days` vs the `days` before that — a TIME delta (real
 * `created_at` clocks), unlike the run tiles' positional deltas. Always comparable: both
 * buckets are the same span, so `previous` is never null here.
 */
export function campaignCreatedDelta(
  summaries: readonly CampaignSummary[],
  days: number,
  now: number,
): StatDelta {
  const DAY = 24 * 3_600_000;
  let current = 0;
  let previous = 0;
  for (const s of summaries) {
    const age = now - s.campaign.created_at;
    if (age < 0) continue;
    if (age < days * DAY) current += 1;
    else if (age < 2 * days * DAY) previous += 1;
  }
  return { current, previous };
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

// ── The card models (needs-you first) ─────────────────────────────────────────

export interface CampaignCardModel {
  summary: CampaignSummary;
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
  if (chip === 'needs-you') return m.summary.counts.awaitingHuman > 0;
  if (chip === 'running') return m.runningNow;
  if (chip === 'failing') return m.failing;
  return m.summary.counts.awaitingHuman === 0 && !m.runningNow && !m.failing; // quiet
}

/**
 * One fold per campaign, sorted the attention-routing way: needs-you FIRST, then failing,
 * then newest-updated — the same order the /projects grid taught.
 */
export function campaignCards(
  summaries: readonly CampaignSummary[],
  runsById: ReadonlyMap<string, SessionView>,
  windowIds: ReadonlySet<string>,
): CampaignCardModel[] {
  return summaries
    .map((s) => {
      const members = s.runIds
        .map((id) => runsById.get(id))
        .filter((v): v is SessionView => v !== undefined);
      return {
        summary: s,
        waiting: members.filter((v) => v.session.status === 'awaiting_human'),
        failing: s.counts.failed > 0,
        runningNow: s.counts.running > 0,
        inWindow: s.runIds.some((id) => windowIds.has(id)),
      };
    })
    .sort((a, b) =>
      (b.summary.counts.awaitingHuman > 0 ? 1 : 0) - (a.summary.counts.awaitingHuman > 0 ? 1 : 0)
      || (b.failing ? 1 : 0) - (a.failing ? 1 : 0)
      || b.summary.campaign.updated_at - a.summary.campaign.updated_at,
    );
}

/**
 * §3.3 denominator honesty, the ONE spelling shared by card, row and scoreboard: a declared
 * `expected` is a real denominator; an undeclared one MUST say "so far" because it can grow.
 */
export function campaignProgressWord(s: CampaignSummary): string {
  return s.campaign.expected !== null
    ? `${s.counts.landed} of ${s.campaign.expected} landed`
    : `${s.counts.landed} of ${s.counts.filed} landed so far`;
}
