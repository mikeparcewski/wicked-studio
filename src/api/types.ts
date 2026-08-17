/**
 * Boundary types for the wicked-crew daemon's `/api/v1` JSON surface + the
 * verbatim CoreEvent WS frames.
 *
 * The studio is a separate package with no dependency on the daemon; it speaks
 * daemon-owned shapes over REST/WS. Those shapes are now defined ONCE, in the
 * shared contract package `wicked-crew-api-types`, which the daemon's route
 * layer compiles against too — this module is a pure re-export so the studio's
 * many `./types.js` importers keep working while the hand-copied mirror that
 * used to live here (and could drift from the daemon silently) is gone
 * (task #84). Optional/index-signature fields keep the shapes forward-additive
 * (DES-STUDIO-001 §5.1); no `any` at the boundary.
 */

export type * from 'wicked-crew-api-types';

// ── Temporary local extension (delta relay) ──────────────────────────────────
//
// TODO(wicked-crew-api-types@0.5.1): the delta-relay contract is not published
// yet — the local crew checkout's `feat/delta-relay` still packs 0.5.0, which
// is byte-identical to the registry 0.5.0 this package.json pins. Once 0.5.1
// lands with `UnitOutputDeltaEvent` in the shared contract, DELETE this local
// definition and re-export it from 'wicked-crew-api-types' like everything
// else above (drift risk lives exactly here — task #84 is why this file is
// otherwise a pure re-export).

/**
 * Live narration delta for one unit — streamed text from the active worker,
 * relayed verbatim over `/ws`. Same append semantics as `cliOutputDelta`
 * (high-volume, excluded from the durable event log, so there is no replay:
 * a late-joining client starts from the next chunk).
 */
export interface UnitOutputDeltaEvent {
  type: 'unitOutputDelta';
  session: string;
  ord: number;
  chunk: string;
}
