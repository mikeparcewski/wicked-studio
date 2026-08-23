import type { ConfirmMode } from './ContextPopover.js';

/**
 * The composer's shipped gate-posture default (DES-UX-001 §7.8 + §13, slice
 * AC): `human_confirm` before the FIRST gate-bearing unit — `before:1` on the
 * wire — per the product's own tagline ("governed, verified work"), replacing
 * the pre-slice default of "none".
 *
 * §13 marks this flip operator-confirmable: it is implemented per the
 * document's adopted position, and THIS constant is the veto point — reverting
 * to the old default is the one-line change `mode: 'none'`. Prefills (retry)
 * and the Ask/Autonomous run modes still override it, as they always did.
 */
export const COMPOSER_DEFAULT_GATE_POSTURE: { mode: ConfirmMode; beforeOrd: number } = {
  mode: 'before',
  beforeOrd: 1,
};
