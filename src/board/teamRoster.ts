import type { TeamRow } from '../api/teamPlan.js';

/**
 * WHO IS ON THE RUN'S TEAM (DES-TEAMING-002 §0, §8.1, §8.5, §8.8), read from its `wicked.team.*` rows
 * (`GET /runs/:id/team` + the live frames): who leads, who watches and why that many, and which
 * steps went to another helper. Pure: the run panel's Agents and spend section draws it.
 *
 *  - The LEAD is `path.started.cli`, replaced by each `path.repicked.to` (the engine moved the lead
 *    after a failure); `selection` says whether the operator chose it or the engine picked at random.
 *  - The WATCH count comes from the score: `path.scored.plan.monitors` (the band's count: 0-19 → 0,
 *    20-39 → 1, 40-69 → 2, 70-100 → 3). The band only ratchets up, so the highest score read counts.
 *  - Each MEMBER is a `member.joined` row (one per seat per step attempt): its latest row says whether
 *    it is watching (`attached`) or could not open (`failed`, with the reason). A member that could
 *    not open is reported, never dropped. A row with no seat is the absent member (no distinct seat).
 *  - A STEP went to another helper when its `step.claimed.by` is not the lead: a non-evaluator step is
 *    work a member did, an evaluator step is a check on another seat (evaluator ≠ creator).
 */

export type LeadSelection = 'chosen' | 'random';

export interface TeamLead {
  seat: string;
  selection: LeadSelection | null;
  /** The seat the lead took over from, when the engine re-picked it. */
  from: string | null;
  /** Why the engine re-picked (`failed`, …), when it did. */
  repickReason: string | null;
}

export interface TeamWatch {
  score: number;
  monitors: number;
  /** `"score 30 → 1 monitor"`. */
  why: string;
}

export interface TeamMember {
  /** `null` = the plan asked for a member and no distinct seat exists. */
  seat: string | null;
  status: 'watching' | 'failed';
  /** Why it could not open (a `failed` member), verbatim. */
  error: string | null;
}

export interface TeamStep {
  ord: number;
  step: string;
  seat: string;
  /** `work` = a member did the step; `check` = an evaluator step on another seat. */
  kind: 'work' | 'check';
}

export interface TeamRoster {
  lead: TeamLead | null;
  watch: TeamWatch | null;
  members: TeamMember[];
  steps: TeamStep[];
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const kind = (r: TeamRow): string => r.event_type.replace(/^wicked\.team\./, '');

/** The monitors a score's band asks for (`THRESHOLDS.bands`), when the row does not say. */
export function monitorsForScore(score: number): number {
  return score >= 70 ? 3 : score >= 40 ? 2 : score >= 20 ? 1 : 0;
}

export function watchWhy(score: number, monitors: number): string {
  return `score ${score} → ${monitors} ${monitors === 1 ? 'monitor' : 'monitors'}`;
}

export function teamRosterOf(rows: readonly TeamRow[]): TeamRoster {
  const sorted = [...rows].sort((a, b) => a.event_id - b.event_id);
  let lead: TeamLead | null = null;
  let watch: TeamWatch | null = null;
  const members = new Map<string, TeamMember>();
  const claims = new Map<number, { step: string; seat: string; role: string | null }>();
  for (const r of sorted) {
    const p = r.payload;
    switch (kind(r)) {
      case 'path.started': {
        const seat = str(p['cli']);
        if (seat !== null) {
          const sel = str(p['selection']);
          lead = { seat, selection: sel === 'chosen' || sel === 'random' ? sel : null, from: null, repickReason: null };
        }
        break;
      }
      case 'path.repicked': {
        const to = str(p['to']);
        if (to !== null) {
          const sel = str(p['selection']);
          // (TS narrows `lead` to its initial `null` inside the loop's switch; it is reassigned above.)
          const was = lead as TeamLead | null;
          lead = {
            seat: to,
            selection: sel === 'chosen' || sel === 'random' ? sel : was?.selection ?? null,
            from: str(p['from']) ?? was?.seat ?? null,
            repickReason: str(p['reason']),
          };
        }
        break;
      }
      case 'path.scored': {
        const score = num(p['score']);
        if (score === null || (watch !== null && score < watch.score)) break;
        const plan = p['plan'];
        const said = typeof plan === 'object' && plan !== null ? num((plan as Record<string, unknown>)['monitors']) : null;
        const monitors = said ?? monitorsForScore(score);
        watch = { score, monitors, why: watchWhy(score, monitors) };
        break;
      }
      case 'member.joined': {
        const seat = str(p['seat']);
        const failed = p['status'] === 'failed';
        members.set(seat ?? '', { seat, status: failed ? 'failed' : 'watching', error: failed ? str(p['error']) : null });
        break;
      }
      case 'step.claimed': {
        const ord = num(p['ord']);
        const seat = str(p['by']);
        if (ord === null || seat === null || p['kind'] === 'tool') break;
        claims.set(ord, { step: str(p['step_id']) ?? str(p['phase']) ?? `step ${ord}`, seat, role: str(p['role']) });
        break;
      }
      default:
        break;
    }
  }
  const steps: TeamStep[] = [];
  if (lead !== null) {
    for (const [ord, c] of [...claims.entries()].sort((a, b) => a[0] - b[0])) {
      if (c.seat === lead.seat) continue;
      steps.push({ ord, step: c.step, seat: c.seat, kind: c.role === 'evaluator' ? 'check' : 'work' });
    }
  }
  return { lead, watch, members: [...members.values()], steps };
}
