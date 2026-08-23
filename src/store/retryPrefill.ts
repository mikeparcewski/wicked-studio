import type { EntityMode, HumanConfirm } from '../api/types.js';

/**
 * Retry-as-prefill (DES-UX-001 §4.3): a failed/cancelled run's Retry button
 * deposits the original run's launch configuration here and navigates to the
 * standard composer, which consumes it ONCE at mount — a prefill, never a
 * hidden relaunch. Nothing auto-launches; the operator's tweak-before-send is
 * the point. The launch then carries `retryOf` (CREW-UX-3) so lineage is
 * recorded in the system of record, not inferred from prompt equality.
 */
export interface RetryPrefill {
  /** The run being retried — rides the launch body as `retryOf`. */
  retryOf: string;
  problem: string;
  clis: readonly string[];
  /** The original `workflow_id`; `null` = free-text (nothing to prefill). */
  workflowId: string | null;
  repoRef: string | null;
  entityMode: EntityMode;
  humanConfirm: HumanConfirm;
  /** From the DTO's `project_id` echo (CREW-UX-2); `null` = unfiled. */
  projectId: string | null;
}

let pending: RetryPrefill | null = null;

export function setRetryPrefill(prefill: RetryPrefill): void {
  pending = prefill;
}

/** Consume-once: the first composer to mount takes it; later mounts see null. */
export function takeRetryPrefill(): RetryPrefill | null {
  const taken = pending;
  pending = null;
  return taken;
}

/**
 * Map the wire's `HumanConfirm` onto the composer's gate-posture controls
 * (`ConfirmMode` + the before-ordinal). Pure — unit-tested.
 */
export function confirmModeOf(
  hc: HumanConfirm | undefined,
): { mode: 'none' | 'all' | 'before'; beforeOrd: number } {
  if (hc === 'all') return { mode: 'all', beforeOrd: 1 };
  if (typeof hc === 'object' && hc !== null && typeof hc.before === 'number') {
    return { mode: 'before', beforeOrd: hc.before };
  }
  return { mode: 'none', beforeOrd: 1 };
}
