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
 */
export interface SkillsWriter {
  run(mutation: (expectedRevision: string) => Promise<SkillGuardResult>): Promise<SkillGuardResult | null>;
}
