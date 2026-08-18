import type { SessionStatus } from '../api/types.js';

/**
 * The live edge — the PRIMARY signal that an element is doing work (operator UX
 * directive). A blinking status dot was the old signal and was too easy to miss: 5px
 * of colour in a card header does not reach peripheral vision. A 2px strip running the
 * full leading edge of the card does, because it is long, and it *moves* — a slow
 * opacity breath (0.5→1 over 2s) rather than a blink, so a wall of 20 cards reads as
 * calm rather than as an alarm panel.
 *
 * Ranking is the constraint that shapes the rest (rule 2). GATE-WAITING needs a human
 * and must out-rank executing, so the two treatments are deliberately asymmetric:
 *
 *   executing    2px, link-blue, breathing 0.5→1, faint glow  — "something is happening"
 *   gate-waiting 3px, accent-yellow, SOLID at full opacity     — "you are the blocker"
 *
 * The gate edge does not breathe. Motion is a limited resource on this surface: if both
 * states moved, the wall of executing cards would drown out the one card that needs a
 * decision. The gate's own urgency is carried by contrast (wider, brighter, unwavering)
 * plus the controls beside it — the answerable `GateChip`, whose badge already pulses.
 *
 * Placement contract: the parent must be `position: relative`, and should be
 * `overflow: hidden` so the parent's border-radius clips the strip's ends.
 */

/** Statuses in which a run is moving under its own power — all of them get the edge. */
const WORKING: ReadonlySet<SessionStatus> = new Set(['planning', 'distributing', 'executing']);

export type EdgeState = 'gate' | 'executing' | 'none';

/**
 * The status → state reduction, gate-dominant. Takes a list so one function serves a
 * single run (`edgeStateOf([session.status])` — a chip, a run card, a stepper phase)
 * and a whole board card (every run on it) with the same ranking rule. `failed` and the
 * terminal statuses get no edge: they are not doing work, and they already carry their
 * own colour on the status dot and in `FailureBanner`.
 */
export function edgeStateOf(statuses: readonly SessionStatus[]): EdgeState {
  if (statuses.includes('awaiting_human')) return 'gate';
  if (statuses.some((s) => WORKING.has(s))) return 'executing';
  return 'none';
}

/** True when the OS asks for no animation. Guarded: jsdom and SSR have no `matchMedia`. */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * The state → class mapping (see `index.css` for what each class does).
 *
 * `reduced` swaps the executing treatment for `--static`: no animation, and a wider
 * solid edge at full opacity, so removing the motion makes the state *more* obvious
 * rather than less (rule 4). The gate treatment is already static, so it is unchanged.
 *
 * `pill` insets the strip for a fully-rounded container (the stepper's phase chips),
 * where an edge at `left: 0` would land on the cap's curve.
 */
export function liveEdgeClass(state: EdgeState, reduced: boolean, pill = false): string | null {
  if (state === 'none') return null;
  const base = state === 'gate'
    ? 'wk-live-edge wk-live-edge--gate'
    : reduced ? 'wk-live-edge wk-live-edge--static' : 'wk-live-edge';
  return pill ? `${base} wk-live-edge--pill` : base;
}

export function LiveEdge({ state, pill = false }: { state: EdgeState; pill?: boolean }): React.ReactElement | null {
  // Read per render rather than through a media-query listener: every consumer already
  // re-renders on store updates, so a mid-session preference change self-corrects.
  const className = liveEdgeClass(state, prefersReducedMotion(), pill);
  if (className === null) return null;
  return <span data-testid="live-edge" data-edge-state={state} aria-hidden="true" className={className} />;
}
