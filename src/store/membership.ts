import { create } from 'zustand';

/**
 * The run→project-name mirror (DES-FEEDBACK-003 §5.4): the runs bottom
 * panel's sheet rows show each run's project, "resolved via the board
 * model's membership" — and the panel is bound by the zero-new-requests
 * rule (§5.1), so it can never fetch members itself. `useBoardModel`
 * (mounted app-wide by the rail) already fetches the memberships; it
 * mirrors the join here exactly the way it already mirrors projects into
 * `useProjectsStore` — a store WRITE of already-fetched data, no extra
 * request. Consumers read; only the board model writes.
 */
interface MembershipStore {
  /** run id → owning project's display name. Unlisted = unfiled/unknown. */
  projectNameByRun: Record<string, string>;
  /**
   * run id → owning project's ID, off the SAME members read (slice L,
   * DES-FEEDBACK-002 §8.2): the desktop notification's click must land on the
   * run's gate — `gateOpenPath(projectId, runId)` — synchronously, from a
   * context with no React tree (a `Notification.onclick`). Same mirror rule:
   * only the board model writes; unlisted = unfiled (the click falls back to
   * the legacy `/runs/:id` route, which resolves the project itself).
   */
  projectIdByRun: Record<string, string>;
  /**
   * run id → membership `attached_at` (epoch ms) — the one honest per-run
   * clock (AgentSession carries no timestamps), merged across projects. The
   * Make dashboard's tiles bucket on it (DES-FEEDBACK-003 §4.2.1) exactly as
   * the board's own RunOutcomeBar does — read from the mirror, never refetched.
   */
  attachedAtByRun: Record<string, number>;
  /** Replace the mirror wholesale (the board model re-reads memberships whole). */
  setProjectNames: (map: Record<string, string>) => void;
  setProjectIds: (map: Record<string, string>) => void;
  setAttachedAt: (map: Record<string, number>) => void;
}

export const useMembershipStore = create<MembershipStore>((set) => ({
  projectNameByRun: {},
  projectIdByRun: {},
  attachedAtByRun: {},
  setProjectNames: (map) => set({ projectNameByRun: map }),
  setProjectIds: (map) => set({ projectIdByRun: map }),
  setAttachedAt: (map) => set({ attachedAtByRun: map }),
}));
