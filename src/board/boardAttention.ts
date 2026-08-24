/**
 * The board's attention score model (DES-UXFIX-001 §2.1.3, slice 1).
 *
 * Attention is a DECAYED SCORE over signals, not a fixed bucket over projects —
 * the F3 fix. A signal's base severity is discounted by how long it has sat
 * unattended; a project scores as the MAX over its signals ("projects whose top
 * score falls below a triage threshold" — §2.1.3), and the signal that set that
 * max is what the card labels itself with.
 *
 * Everything here is a pure function of its arguments, INCLUDING `now` — no
 * clock of its own, no React — which is what makes the decay curve pinnable at
 * exact ages in `boardAttention.test.ts`.
 *
 * The numbers are tuning constants; the SHAPE (gate ∞, everything else
 * half-life-decayed) is the design commitment.
 */

export type SignalKind = 'gate' | 'failing' | 'running' | 'drafts';

/** One thing about a project that could want attention, and when it last said so. */
export interface Signal {
  kind: SignalKind;
  /** Epoch millis of the signal's OWN clock (the D3 source ladder), never Date.now() at call time. */
  at: number;
  /** The run this signal came from, when it came from one — the card's headline subject. */
  runId?: string;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Base severity per signal kind (§2.1.3's table). */
export const SEVERITY: Record<SignalKind, number> = {
  gate: 100,
  failing: 70,
  running: 40,
  drafts: 15,
};

/**
 * Half-lives, in millis. `gate` is Infinity — a waiting gate is a person
 * blocked, and it must NOT decay (it stays top until answered). `failing` ages
 * out over hours (the exact F3 fix: a fresh failure is urgent, a week-old one
 * is history); `running` over minutes (a run silent for a half-life is suspect,
 * not urgent); `drafts` over days (a draft is a nudge, never a demand).
 */
export const HALF_LIFE: Record<SignalKind, number> = {
  gate: Infinity,
  running: 30 * MINUTE,
  failing: 4 * HOUR,
  drafts: 7 * DAY,
};

/**
 * Scores at or above this lead the board (NEEDS YOU); below it they drop into
 * the QUIET band. 20 sits just above the `drafts` base (15) — that is the rule,
 * not the number: no draft of any age can enter the live band (D2).
 */
export const TRIAGE_THRESHOLD = 20;

/** `base × 0.5^(Δ/halfLife)`, Δ clamped at 0 so a skewed clock (a daemon slightly
 *  ahead of the browser) reads as "just now", never as a future signal scoring
 *  above its own base. An Infinity half-life means no decay at all. */
export function scoreOf(signal: Signal, now: number): number {
  const base = SEVERITY[signal.kind];
  const halfLife = HALF_LIFE[signal.kind];
  if (halfLife === Infinity) return base;
  const age = Math.max(0, now - signal.at);
  return base * Math.pow(0.5, age / halfLife);
}

/** The project's score and the signal that set it; no signals ⇒ score 0, signal null. */
export function topSignal(
  signals: Signal[],
  now: number,
): { score: number; signal: Signal | null } {
  let signal: Signal | null = null;
  let score = 0;
  for (const s of signals) {
    const v = scoreOf(s, now);
    if (signal === null || v > score) {
      signal = s;
      score = v;
    }
  }
  return signal === null ? { score: 0, signal: null } : { score, signal };
}

export type Band = 'needs-you' | 'working' | 'quiet';

/** Which band a score renders in. Exactly the threshold is still NEEDS YOU.
 *  Score-only — the C6 fix demoted it from the board's band verdict (that is
 *  `bandFor`, which reads run STATUS first); it survives for score→band
 *  labelling where no run status exists. */
export function bandOf(score: number): Band {
  return score >= TRIAGE_THRESHOLD ? 'needs-you' : 'quiet';
}

/**
 * The board's band verdict (BRIEF-UX-002 C6 fix). Bands are DERIVED FROM RUN
 * STATUS first and decay second — the C6 finding was a project with two
 * EXECUTING runs reading "Nothing needs you right now" because its band hung
 * off a decaying live-frame clock instead of the run DTO the board already held.
 *
 *   NEEDS YOU — a human is the blocker: a waiting gate (never decays), or a
 *               failure fresh enough to still demand triage (the F3 decay).
 *   WORKING   — work is accumulating fine WITHOUT needing anyone: any
 *               non-terminal run (`hasActiveRun`, read off DTO statuses — a
 *               project with one is NEVER quiet, no matter what any clock
 *               says), or live doc activity fresh enough to score.
 *   QUIET     — genuinely nothing moving and nothing demanding.
 *
 * Pure in all arguments including `now`, like everything else in this file.
 */
export function bandFor(signals: Signal[], hasActiveRun: boolean, now: number): Band {
  if (signals.some((s) => s.kind === 'gate')) return 'needs-you';
  if (signals.some((s) => s.kind === 'failing' && scoreOf(s, now) >= TRIAGE_THRESHOLD)) {
    return 'needs-you';
  }
  if (hasActiveRun) return 'working';
  if (signals.some((s) => s.kind === 'running' && scoreOf(s, now) >= TRIAGE_THRESHOLD)) {
    return 'working';
  }
  return 'quiet';
}

/** Score desc → newest signal first → name asc — the parent's deterministic tail,
 *  so the board never orders on list position. */
export function compareScored<T extends { score: number; at: number; name: string }>(
  a: T,
  b: T,
): number {
  return b.score - a.score || b.at - a.at || a.name.localeCompare(b.name);
}
