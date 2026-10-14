import type { CoreEvent } from '../api/types.js';
import { planRefusalWords } from '../api/planRefusal.js';

/**
 * Run clarity: why a failed run stopped when no STEP was refused. The engine's own reason is the
 * newest `error` frame of the run's trail (e.g. "council distribution failed: no eligible seat …")
 * — said as one plain headline, with the engine's words kept whole for Technical details. `null`
 * when the trail carries no error message (the page then claims no reason). Pure.
 */
export interface EngineFailure {
  headline: string;
  raw: string;
}

const HEADLINE_MAX = 160;

export function engineFailureOf(events: readonly CoreEvent[]): EngineFailure | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const e = events[i] as unknown as { type?: unknown; message?: unknown };
    if (e.type !== 'error' || typeof e.message !== 'string') continue;
    const raw = e.message.trim();
    if (raw === '') continue;
    return { headline: failureHeadline(raw), raw };
  }
  return null;
}

function failureHeadline(raw: string): string {
  const refusal = planRefusalWords(raw);
  if (refusal !== null) return `The plan was refused: ${refusal}.`;
  // Only the engine's own "every configured seat is benched" says WHY no seat was eligible; a bare "no
  // eligible seat" can mean seats that are signed in but not eligible (codex r2), so it says no more.
  if (/every configured seat is benched/i.test(raw)) {
    return 'No helper could take the work: every helper on this run was signed out or benched. Sign one in to try again.';
  }
  if (/no eligible seat/i.test(raw)) return 'No helper was eligible to take the work — Technical details say why.';
  const first = raw.split('\n')[0]!.trim();
  const clipped = first.length > HEADLINE_MAX ? `${first.slice(0, HEADLINE_MAX - 1).trimEnd()}…` : first;
  return `It stopped with an error: ${clipped}`;
}
