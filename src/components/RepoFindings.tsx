import type { RepoEntry, RepoFinding } from '../api/types.js';
import { TechDetails } from './ui/TechDetails.js';

/**
 * The engine's per-repo findings (`RepoEntry.findings[]`, wicked-core#406 via crew#517 —
 * api-types 0.32.0; studio#251), rendered wherever a repo card or detail header shows the repo:
 * one labelled row per finding with the engine's own message, and — for the ONE case that has a
 * UI remedy — the "Re-run onboarding" action wired to the existing onboarding trigger of the
 * surface that hosts it (`POST /repos/:id/onboard`, the same call the Onboard buttons make).
 *
 * The codes the engine emits today, and how each reads here:
 *
 *  - `in_tree_code_graph_ignored` — the checkout carries a `.codegraph/` an older engine indexed IN
 *    the working tree. It is ignored; the live graph lives under the daemon state home. Two
 *    sub-states share the code and differ only in the engine's message (the wire carries no
 *    machine-readable remedy field): "the live graph is <path>" (a graph exists — a tidy-up
 *    warning) versus "re-run onboarding (POST /repos/<id>/onboard)" (no live graph has been
 *    indexed yet — the repo is graph-less until it is onboarded again; F-024's upgraded
 *    checkouts). {@link findingNeedsReonboard} keys on the engine's remedy sentence — the same
 *    words core's own tests pin — and the row then carries the action.
 *  - `code_graph_root_unresolvable` — no repo-graph root resolves for this daemon at all
 *    (`code_graph_db` is empty); a daemon-environment fault the message names. No UI remedy.
 *  - anything else — rendered verbatim as a warning (forward-additive: a newer engine may add codes).
 *
 * SILENT when `findings` is absent (a daemon predating the field) or empty (a clean checkout):
 * the component renders nothing at all — no frame, no "no findings" copy.
 */

export const REPO_FINDING_IN_TREE_IGNORED = 'in_tree_code_graph_ignored';
export const REPO_FINDING_ROOT_UNRESOLVABLE = 'code_graph_root_unresolvable';

/** The engine's remedy sentence for an in-tree graph with NO live graph behind it (core `repo.rs`:
 *  "no graph has been indexed under the state home yet — re-run onboarding (POST /repos/<id>/onboard)").
 *  Matched on the words core's own tests pin, because the wire has no separate field for it. */
const REONBOARD_REMEDY = /re-run onboarding/i;

export type RepoFindingSeverity = 'warning' | 'error';

/** Whether this finding's remedy is the onboarding re-run this UI can trigger. */
export function findingNeedsReonboard(finding: RepoFinding): boolean {
  return finding.code === REPO_FINDING_IN_TREE_IGNORED && REONBOARD_REMEDY.test(finding.message);
}

/** How loud a finding reads: a graph-less repo is an error (every graph surface is empty until it
 *  is fixed); an ignored in-tree graph beside a live one is a tidy-up warning. */
export function findingSeverity(finding: RepoFinding): RepoFindingSeverity {
  if (finding.code === REPO_FINDING_ROOT_UNRESOLVABLE) return 'error';
  if (findingNeedsReonboard(finding)) return 'error';
  return 'warning';
}

/** The finding in plain words (UI-CONTRACT §1.5: no file names, API paths or issue numbers in the
 *  default layer; the engine's own message stays reachable inside Technical details). */
export function findingLabel(finding: RepoFinding): string {
  switch (finding.code) {
    case REPO_FINDING_IN_TREE_IGNORED:
      return findingNeedsReonboard(finding)
        ? 'This repository has no code map yet. Re-run onboarding to build it.'
        : 'An old code map saved inside this checkout is ignored; the current one is used.';
    case REPO_FINDING_ROOT_UNRESOLVABLE:
      return 'Studio’s service has nowhere to keep code maps, so this repository can’t be mapped.';
    default: {
      const words = finding.code.replace(/_/g, ' ');
      return `${words.charAt(0).toUpperCase()}${words.slice(1)}.`;
    }
  }
}

/** The findings a repo record carries, or `[]` — absent and empty read the same (silent). */
export function repoFindings(repo: Pick<RepoEntry, 'findings'> | null | undefined): RepoFinding[] {
  return repo?.findings ?? [];
}

interface Props {
  /** `RepoEntry.findings` as the wire carries it — `undefined` on an older daemon. */
  findings: RepoFinding[] | undefined;
  /** The host surface's EXISTING onboarding trigger (`api.rerunOnboarding` + its own state);
   *  when omitted the re-onboard row states the remedy without a button. */
  onRerunOnboarding?: (() => void) | undefined;
  /** The host's in-flight flag for THIS repo's trigger (disables the button, "Starting…"). */
  rerunning?: boolean | undefined;
  /** The host's shared mutation lock (another repo's re-run, an attach/detach): disables the
   *  button without claiming this repo is starting. */
  disabled?: boolean | undefined;
  /** Card dress: no Technical details (the host's detail page carries them). */
  compact?: boolean | undefined;
  /** The host already states an error-level gap in its own words (the repo card's graph line):
   *  such a row then renders only its action, so the gap is said once. */
  gapStated?: boolean | undefined;
  /** Test id root; per-finding rows are `<testId>-row`. */
  testId?: string | undefined;
}

export function RepoFindings({
  findings, onRerunOnboarding, rerunning = false, disabled = false, compact = false, gapStated = false, testId = 'repo-findings',
}: Props): React.ReactElement | null {
  if (findings === undefined || findings.length === 0) return null;
  return (
    <div
      data-testid={testId}
      data-count={findings.length}
      // Inside a clickable card (RepositoriesPanel's role=link) the action must not also navigate.
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      role="presentation"
      className={compact ? 'wk-pg-repo-findings wk-pg-repo-findings--compact' : 'wk-pg-repo-findings'}
    >
      {findings.map((f, i) => {
        const severity = findingSeverity(f);
        const reonboard = findingNeedsReonboard(f);
        const raw = [f.message, ...(f.path !== null ? [f.path] : [])]; // TechDetails sanitizes paths
        return (
          <div
            key={`${f.code}-${i}`}
            data-testid={`${testId}-row`}
            data-code={f.code}
            data-severity={severity}
            data-reonboard={reonboard}
            className={`wk-pg-repo-finding wk-pg-repo-finding--${severity}`}
          >
            <div className="wk-pg-repo-finding-line">
              {!(gapStated && severity === 'error') && <p className="wk-pg-repo-finding-text">{findingLabel(f)}</p>}
              {reonboard && onRerunOnboarding !== undefined && (
                <button
                  type="button"
                  data-testid={`${testId}-reonboard`}
                  disabled={rerunning || disabled}
                  title="Rebuild this repository’s code map as a tracked run"
                  onClick={(e) => { e.stopPropagation(); onRerunOnboarding(); }}
                  className="wk-btn wk-btn--secondary wk-btn--sm"
                >
                  {rerunning ? 'Starting…' : 'Re-run onboarding'}
                </button>
              )}
            </div>
            {!compact && <TechDetails data-testid={`${testId}-detail`} text={raw} />}
          </div>
        );
      })}
    </div>
  );
}
