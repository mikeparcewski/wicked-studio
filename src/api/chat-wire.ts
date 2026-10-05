/**
 * Chat citation verdicts (crew#561 — `wicked-crew-api-types` 0.67.0).
 *
 * The frame and item types are imported from `wicked-crew-api-types` (pin 0.92.0, ASK-S1) and
 * re-exported here; the daemon's `tests/wire-contract.test.ts` pins the frame against its publisher.
 * `ChatCitationsRecord` / `ChatCitations` below are studio's own readings of them.
 *
 * What they are: the daemon verifies every citation in a seat's reply — repo-relative paths,
 * `path:line` / `path:symbol` refs, commit SHAs — against the read roots it handed that chat's
 * seats, and broadcasts ONE frame per reply. The reply TEXT is the seat's own; this surface marks
 * it, and never edits it.
 */

/**
 * The transcript's third record kind (api-types 0.68.0): the verdicts of the `seat` record with the
 * same `turnId` + `cliKey`, appended after it because verification finishes after the reply is
 * stored. This is what keeps a fabricated SHA marked across a reload — the live frame is gone by
 * then, and `/ws` replays nothing.
 */
import type { ChatCitationKind, ChatCitationStatus, ChatCitationItem, ChatCitationsFrame } from 'wicked-crew-api-types';
export type { ChatCitationKind, ChatCitationStatus, ChatCitationItem, ChatCitationsFrame };

export interface ChatCitationsRecord {
  at: number;
  turnId: string;
  kind: 'citations';
  cliKey: string;
  verified: number;
  unverifiable: number;
  corrected: number;
  unchecked: number;
  items: ChatCitationItem[];
}

/** What a reply carries once its frame arrived — the frame minus its routing fields. */
export interface ChatCitations {
  verified: number;
  unverifiable: number;
  corrected: number;
  unchecked: number;
  items: ChatCitationItem[];
}
