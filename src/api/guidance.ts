import type { AgentSession } from './types.js';

/**
 * CREW-UX-7 — durable operator guidance (DES-UX-002 §7.2; the doc specs it as
 * "CREW-UX-4", it LANDED as CREW-UX-7 in crew#312 because crew#308 had already
 * spent that id). The daemon contract, live since crew#312:
 *
 *   - `PUT /runs/:id/guidance` `{text}` upserts the ONE operator note on the
 *     run; `text: ''` CLEARS it; unknown run → 404; >8192 bytes → a named 400.
 *     Response: `{runId, guidance}`.
 *   - `GET /runs` + `GET /runs/:id` DTOs carry `guidance?: string` — ABSENT
 *     (never null/'') when no note is set, so `'guidance' in session` and
 *     `!== undefined` agree, and a pre-0.9.0 daemon reads as "no note".
 *
 * TYPED LOCALLY, not via a dep bump: the fields ship in wicked-crew-api-types
 * 0.9.0, which exists only in the crew repo's workspace — npm has 0.8.0, the
 * version this package pins (`^0.8.0`). Faking a bump would break `npm ci`;
 * when 0.9.0 publishes, these locals collapse into the package types.
 */

/** Response of `PUT /runs/:id/guidance` (crew#312; api-types 0.9.0 GuidanceUpdate). */
export interface GuidanceUpdate {
  runId: string;
  /** What was stored — `''` after a clear. */
  guidance: string;
}

/**
 * The run DTO's durable guidance note (api-types 0.9.0 `AgentSession.guidance`),
 * read off the 0.8.0-typed session without a cast leaking anywhere else:
 * `undefined` = no note (never set, cleared, or a pre-0.9.0 daemon).
 */
export function sessionGuidance(session: AgentSession): string | undefined {
  const raw = (session as AgentSession & { guidance?: unknown }).guidance;
  return typeof raw === 'string' ? raw : undefined;
}
