import type { RepoEntry } from '../api/types.js';
import type { ConfirmMode } from './ContextPopover.js';
import type { RunMode } from './runMode.js';

/**
 * Which repo a launch WORKS IN — `LaunchRunBody.repoRef`, the one field the
 * wire has for it (api-types: a run is bound to exactly one repo; its worktree,
 * its deliver push and its PR all land there).
 *
 * F-028 (acceptance run 1f12f9ab): choosing a project auto-attached ALL of its
 * repos as chips and the launch took `repoRefs[0]` — so an explicit tick on the
 * repo the operator meant was silently outranked by whichever project member
 * happened to be listed first, and a studio bug fix was dispatched into
 * wicked-core. The chips are CONTEXT (what the project spans); the target is a
 * decision, and this module is the ONE place that decision is derived so the
 * Send guard, the wire body, the deliver notice and the pre-send summary can
 * never disagree about it.
 *
 * Precedence, highest first:
 *   1. `selectedTarget` — the Target-repo control, when it names an attached repo;
 *   2. the operator's explicit popover ticks (`explicitRefs ∩ repoRefs`): one
 *      tick IS the target, whatever else the project auto-attached;
 *   3. a single attached repo needs no choice;
 *   4. several candidates and no choice: `requireExplicit` (build-kind work —
 *      the launch opens a PR on exactly one repo) → AMBIGUOUS, no default; a
 *      non-build launch (chat, freeform) keeps the first, as before — the repo
 *      is context there, not a delivery target.
 */
export type LaunchTargetSource = 'selected' | 'explicit' | 'only' | 'first';

export type LaunchTarget =
  | { kind: 'none' }
  | { kind: 'resolved'; repoRef: string; source: LaunchTargetSource }
  | { kind: 'ambiguous'; candidates: string[] };

export interface LaunchTargetInput {
  /** Every attached repo, in attach order (auto-attached project members + ticks). */
  repoRefs: readonly string[];
  /** The subset the operator ticked in the popover (or a retry prefill seeded), in tick order. */
  explicitRefs: readonly string[];
  /** The Target-repo control's value, or `null` when the operator has not chosen. */
  selectedTarget: string | null;
  /** Build-kind work: more than one candidate without a choice is ambiguous, never `[0]`. */
  requireExplicit: boolean;
}

export function resolveLaunchTarget(input: LaunchTargetInput): LaunchTarget {
  const attached = input.repoRefs.filter((id, i, all) => id !== '' && all.indexOf(id) === i);
  if (attached.length === 0) return { kind: 'none' };
  if (input.selectedTarget !== null && attached.includes(input.selectedTarget)) {
    return { kind: 'resolved', repoRef: input.selectedTarget, source: 'selected' };
  }
  const ticked = input.explicitRefs.filter((id, i, all) => attached.includes(id) && all.indexOf(id) === i);
  const candidates = ticked.length > 0 ? ticked : attached;
  if (candidates.length === 1) {
    return { kind: 'resolved', repoRef: candidates[0]!, source: ticked.length > 0 ? 'explicit' : 'only' };
  }
  if (input.requireExplicit) return { kind: 'ambiguous', candidates };
  return { kind: 'resolved', repoRef: candidates[0]!, source: 'first' };
}

/**
 * `owner/repo` for the deliver notice ("→ opens a PR on acme/widgets"), read
 * off the registered `git_url` — `https://host/owner/repo(.git)`,
 * `ssh://git@host/owner/repo`, or the scp form `git@host:owner/repo.git`. A
 * repo registered without a URL, or with one that carries no owner/name pair,
 * is named by its registered name: the notice always names SOMETHING the
 * operator can recognise, never a blank.
 */
export function repoSlugOf(repo: Pick<RepoEntry, 'name'> & { git_url?: string | null | undefined }): string {
  const raw = repo.git_url?.trim() ?? '';
  if (raw === '') return repo.name;
  let path: string | null = null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    try {
      path = new URL(raw).pathname;
    } catch {
      path = null;
    }
  } else {
    const scp = /^[^/@:\s]+@[^/:\s]+:(.+)$/.exec(raw);
    if (scp !== null) path = scp[1] ?? null;
  }
  if (path === null) return repo.name;
  const segs = path.split('/').filter((s) => s !== '');
  if (segs.length < 2) return repo.name;
  const owner = segs[segs.length - 2]!;
  const name = segs[segs.length - 1]!.replace(/\.git$/i, '');
  return name === '' ? repo.name : `${owner}/${name}`;
}

/**
 * The gate posture a launch will carry, in the words of the composer's own
 * controls — the same precedence `submit` applies to `humanConfirm`: the
 * Ask/Autonomous mode pills override the gate selector; Balanced (or no mode)
 * lets the selector speak.
 */
export function describeGate(mode: RunMode | undefined, confirmMode: ConfirmMode, beforeOrd: number): string {
  if (mode === 'ask') return 'every unit';
  if (mode === 'autonomous') return 'no human gates';
  switch (confirmMode) {
    case 'all':
      return 'every unit';
    case 'before':
      return beforeOrd === 1 ? 'first gate' : `before unit #${beforeOrd}`;
    default:
      return 'no gates';
  }
}
