import { bandLabel } from './bandCopy.js';
import type { Band } from './boardAttention.js';

/**
 * Dark when healthy (studio wave 1). A band shows its cards only while it holds an
 * EXCEPTION — NEEDS YOU (a gate, a fresh failure, a stall). Healthy running work
 * (WORKING) and idle work (QUIET) collapse to one count line the operator can expand:
 * nothing moves on the board while everything is fine, so the one card that needs a
 * human is the only thing that draws the eye.
 *
 * The skin renders these answers; it does not decide them.
 */
export function bandExpandsByDefault(band: Band): boolean {
  return band === 'needs-you';
}

/** A collapsed band's one line — the label and how many projects it holds. */
export function bandCountLine(band: Band, count: number): string {
  return `${bandLabel(band)} (${count})`;
}
