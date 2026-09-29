/**
 * Chat citation verdicts (crew#561 — `wicked-crew-api-types` 0.67.0).
 *
 * Typed here, not imported, for the usual reason (`mcp-wire.ts`, `wave6-wire.ts`): this surface is
 * pinned to a PUBLISHED api-types and the daemon's contract moves first. When the pin catches up,
 * these shapes are deleted and the import replaces them — they are byte-equivalent to
 * `ChatCitationsFrame` / `ChatCitationItem` on the daemon side, and the daemon's
 * `tests/wire-contract.test.ts` pins that frame against its own publisher.
 *
 * What they are: the daemon verifies every citation in a seat's reply — repo-relative paths,
 * `path:line` / `path:symbol` refs, commit SHAs — against the read roots it handed that chat's
 * seats, and broadcasts ONE frame per reply. The reply TEXT is the seat's own; this surface marks
 * it, and never edits it.
 */

/** What class of thing a citation is. */
export type ChatCitationKind = 'path' | 'line' | 'symbol' | 'sha';

/**
 * The verdict on one citation:
 *  - `verified` — it exists, exactly as cited;
 *  - `corrected` — it exists, but not where the reply said (`resolved` is the real place);
 *  - `unverified` — it is in no repo the chat can see (the fabricated-SHA case);
 *  - `unchecked` — the daemon's bounded pass did not reach it. NOT a claim either way.
 */
export type ChatCitationStatus = 'verified' | 'corrected' | 'unverified' | 'unchecked';

/** One citation as verified. `raw` is the token exactly as it appears in the reply. */
export interface ChatCitationItem {
  raw: string;
  kind: ChatCitationKind;
  status: ChatCitationStatus;
  /** `alpha/src/foo.ts:2069` for a corrected line ref, the repo name for a SHA. */
  resolved?: string;
  /** Why, in one phrase — the mark's hover text. */
  note?: string;
}

/** The `/ws` frame: one per verified reply, stamped with the reply's own `turn_id`. */
export interface ChatCitationsFrame {
  type: 'chatCitations';
  chat: string;
  cliKey: string;
  turn_id?: string;
  verified: number;
  unverifiable: number;
  corrected: number;
  unchecked: number;
  items: ChatCitationItem[];
  project_id?: string;
}

/**
 * The transcript's third record kind (api-types 0.68.0): the verdicts of the `seat` record with the
 * same `turnId` + `cliKey`, appended after it because verification finishes after the reply is
 * stored. This is what keeps a fabricated SHA marked across a reload — the live frame is gone by
 * then, and `/ws` replays nothing.
 */
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
