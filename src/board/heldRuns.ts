import type { SessionView } from '../api/types.js';

/**
 * HELD RUNS (studio#805): a run whose DTO still reads live (`executing`, `planning`, …) but that a
 * Needs-you row holds — a stall, an orphan (the daemon restarted under it), an open question, a steer
 * hold — is not being worked on: it waits on you. The Desk says so in ONE place: App marks those runs
 * (a client-side copy, never sent anywhere) and {@link statusWord} reads the mark, so every surface
 * that says a run's state through statusWord — Running now, the Runs tab, the rail, the Report, the
 * peeks, the sheets, the Watchtower — agrees without each one being handed the held set.
 *
 * The wire `status` is untouched: gate logic, actions and anything reading the raw status see the
 * daemon's own word. A run at a gate (`awaiting_human`) or ended is never marked — it already says
 * what it is.
 */
const HELD_KEY = 'studio_held';
const NOT_LIVE: ReadonlySet<string> = new Set(['awaiting_human', 'completed', 'failed', 'cancelled']);

/** True when App marked this run as held by a Needs-you row. */
export function isHeldRun(session: SessionView['session']): boolean {
  return (session as unknown as Record<string, unknown>)[HELD_KEY] === true || isPowerPaused(session);
}

/**
 * Power mode (api-types 0.149.0): a run paused at a checkpoint ("this grew") waits on you although it stays
 * `executing` — the pause is not an engine gate. Only a power-mode crew sends `power`, so an older one never matches.
 */
export function isPowerPaused(session: SessionView['session']): boolean {
  if (NOT_LIVE.has(session.status)) return false;
  const p = (session as unknown as { power?: { pause?: unknown } | null }).power;
  return p !== null && typeof p === 'object' && p.pause !== null && typeof p.pause === 'object';
}

/** The runs with every live run in `held` marked; the same array when nothing is held. */
export function markHeld(runs: SessionView[], held: ReadonlySet<string>): SessionView[] {
  if (held.size === 0) return runs;
  let changed = false;
  const out = runs.map((v) => {
    if (!held.has(v.session.id) || NOT_LIVE.has(v.session.status)) return v;
    changed = true;
    return { ...v, session: { ...v.session, [HELD_KEY]: true } as SessionView['session'] };
  });
  return changed ? out : runs;
}
