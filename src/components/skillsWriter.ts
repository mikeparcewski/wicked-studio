import type { SkillGuardResult } from '../api/skills.js';

/**
 * The Skills page's CAS seam, handed to every component that writes (the drawer, the confirm and
 * files-map modals). The page holds the catalog revision; a writer runs ONE mutation conditioned
 * on it and adopts the revision the daemon answers with, so consecutive writes chain correctly
 * without every component tracking revisions itself.
 *
 * `run` resolves the daemon's guard envelope, or `null` when the daemon answered **409** — the
 * revision was stale (another session, a hashed direct edit, a refresh). On `null` the PAGE owns
 * the moment (it raises the reload prompt) and the caller changes nothing: no findings, no state
 * flip, the draft kept. Every other failure throws, for the caller's own error line.
 *
 * A file EDIT is the one write that must not ride the page's latest revision blindly: the page
 * may have re-read the catalog (a Refresh, a toggle, a publish) after the editor read its content,
 * and adopting that newer revision would let an old-content edit overwrite an intervening change
 * the daemon's CAS exists to catch. So a read records `revision()` as the revision its content
 * stands at, and Save passes it back as `expectedRevision` — the daemon compares against what the
 * editor actually shows, not against what the page last heard.
 */
export interface SkillsWriter {
  /** The catalog revision the page holds right now (`null` before the first load). */
  revision(): string | null;
  run(
    mutation: (expectedRevision: string) => Promise<SkillGuardResult>,
    opts?: {
      /** Condition this write on the revision its CONTENT was read at, not the page's latest. */
      expectedRevision?: string;
    },
  ): Promise<SkillGuardResult | null>;
}
