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
   * run id → membership `attached_at` (epoch ms) — the one honest per-run
   * clock (AgentSession carries no timestamps), merged across projects. The
   * Make dashboard's tiles bucket on it (DES-FEEDBACK-003 §4.2.1) exactly as
   * the board's own RunOutcomeBar does — read from the mirror, never refetched.
   */
  attachedAtByRun: Record<string, number>;
  /** Replace the mirror wholesale (the board model re-reads memberships whole). */
  setProjectNames: (map: Record<string, string>) => void;
  setAttachedAt: (map: Record<string, number>) => void;
}

export const useMembershipStore = create<MembershipStore>((set) => ({
  projectNameByRun: {},
  attachedAtByRun: {},
  setProjectNames: (map) => set({ projectNameByRun: map }),
  setAttachedAt: (map) => set({ attachedAtByRun: map }),
}));
