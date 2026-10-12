import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client.js';
import type { ProjectMember, RepoEntry } from '../api/types.js';
import { fetchReposCached, getCachedRepos } from '../store/repoCache.js';
import { RepoFindings, repoFindings } from './RepoFindings.js';
import { readErrorKind } from '../api/errors.js';
import { relTime } from '../board/relTime.js';
import { SectionTitle } from './ui/PageFrame.js';
import { StatLine } from './ui/StatLine.js';
import { EmptyState, Skeleton, StateBanner } from './ui/StateBanner.js';
import { TechDetails } from './ui/TechDetails.js';
import type { ProjectIssueHandler } from './product/ProjectAggregates.js';
import type { RepoUse } from '../board/projectModel.js';

/**
 * The project's repositories — the one UI path that attaches a `crew.repo`
 * member to a project (studio#207). Before this section a UI-created project
 * could never launch a project-scoped test: crew's multiscope resolver 400s a
 * project-only launch whose project holds zero repository members, and the
 * launch panel's own warning pointed at an action the product had no control
 * for.
 *
 * Wire (verified against wicked-crew `projects/routes.ts` + the pinned
 * `wicked-crew-api-types`): attach is `POST /projects/:id/members` with
 * `AttachMemberBody` `{ kind: 'crew.repo', ref: <repo id>, attachedBy: 'studio' }`
 * — the SAME body RepositoriesPanel's register flow sends when a project is
 * selected at registration — and detach is `DELETE /projects/:id/members/:mid`.
 * The picker is the registered-repo list from the ONE session repo cache
 * (DES-FEEDBACK-002 §1.4): fetched on the first gesture that needs it (the
 * search field's focus) — and, since acceptance finding F-2R2-004, on mount
 * for a project that HAS repository members: the rows' engine findings
 * (`in_tree_code_graph_ignored` + "Re-run onboarding") live on the registry
 * record, and the checklist path "project → repositories" showed none while
 * the cache stayed cold. Still the one shared cache: at most one GET /repos
 * per session however many surfaces ask.
 *
 * Membership state stays with the parent (the dashboard's / detail page's one
 * membership read): this section filters to `crew.repo` and reports every
 * change through `onMembersChange`, so the header chips and this list can never
 * disagree. A change is reported as an UPDATER over the parent's current state,
 * never as a replacement array, and only for the project the section still
 * shows — see `Props.onMembersChange`. The synthesized `default` project rejects
 * attach on the wire (routes.ts) and has no stored members to detach, so the
 * section is omitted there entirely.
 */

const DEFAULT_PROJECT_ID = 'default';
const REPO_KIND = 'crew.repo';
/** Picker rows before the list asks the operator to narrow instead of growing. */
const MAX_OPTIONS = 8;

/** A member ref names a registered repo by id; a legacy ref may carry the name instead
 *  (the dashboard's header chips resolve the same two ways). */
function repoOf(ref: string, repos: RepoEntry[] | null): RepoEntry | undefined {
  return repos?.find((r) => r.id === ref || r.name === ref);
}

function isAttached(repo: RepoEntry, members: ProjectMember[]): boolean {
  return members.some((m) => m.member_ref === repo.id || m.member_ref === repo.name);
}

/**
 * A membership change, expressed against whatever the parent holds at APPLY time
 * — the parent runs it inside its own functional state update. The section
 * never hands back a replacement array built from the snapshot it rendered with:
 * that snapshot goes stale the moment anything else touches membership while a
 * request is in flight (a non-repo member detached through the generic Members
 * list, the dashboard's membership read landing), and applying it wholesale
 * would silently undo that change.
 */
export type MembersUpdate = (current: ProjectMember[]) => ProjectMember[];

interface Props {
  projectId: string;
  onIssue?: ProjectIssueHandler;
  /**
   * The parent's membership state — every member (ProjectDetailPage) or already
   * just the `crew.repo` subset (ProjectDashboard). This section filters to
   * `crew.repo` itself, so either shape is fine; it never inspects the rest.
   */
  members: ProjectMember[];
  /**
   * Reports one repo change as an updater the parent applies to its CURRENT
   * membership: attach appends the new member (unless it is already there),
   * detach filters the one member id out, and whatever non-repo entries the
   * parent holds pass through untouched. Called only for the project this
   * section is still showing — a result that lands after `projectId` changed
   * (both parents stay mounted across a navigation) or after unmount is dropped,
   * never applied to another project's state.
   */
  onMembersChange: (update: MembersUpdate) => void;
  /** DES-frontdoor P: the repositories the project's jobs used (`board/projectModel.reposUsed`) —
   *  an attached row says how many jobs used it, and a used-but-not-attached one is offered Attach. */
  used?: readonly RepoUse[];
}

/** "on main" and the latest commit's first line, read once when the row is shown (`GET /repos/:id/git-history`). */
function BranchLine({ repo }: { repo: RepoEntry }): React.ReactElement {
  const [latest, setLatest] = useState<{ id: string; line: string | null } | null>(null);
  useEffect(() => {
    let live = true;
    Promise.resolve().then(() => api.getRepoGitHistory(repo.id))
      .then(({ commits }) => { if (live) setLatest({ id: repo.id, line: commits[0]?.message.split('\n')[0]?.trim() || null }); })
      .catch(() => { if (live) setLatest({ id: repo.id, line: null }); });
    return () => { live = false; };
  }, [repo.id]);
  const line = latest !== null && latest.id === repo.id ? latest.line : null;
  return (
    <p data-testid="project-repo-branch" className="wk-list-row-meta">
      on {repo.default_branch || 'its default branch'}{line !== null ? <> · latest: <span title={line}>{line.length > 80 ? `${line.slice(0, 79)}…` : line}</span></> : null}
    </p>
  );
}

export function ProjectRepositories({ projectId, members, onMembersChange, onIssue, used = [] }: Props): React.ReactElement | null {
  const [repos, setRepos] = useState<RepoEntry[] | null>(getCachedRepos);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState('');
  /** The repo id being attached, or null. */
  const [attaching, setAttaching] = useState<string | null>(null);
  /** The member id whose detach awaits confirmation, or null. */
  const [confirming, setConfirming] = useState<string | null>(null);
  /** The member id being detached, or null. */
  const [detaching, setDetaching] = useState<string | null>(null);
  /** The last attach/detach failure, or null. */
  const [error, setError] = useState<string | null>(null);
  /** The last registry (picker) fetch failure, kept apart from the mutation error
   *  so the retry gesture clears exactly the one that just went stale. */
  const [registryError, setRegistryError] = useState<string | null>(null);
  /** studio#251: the repo id whose onboarding re-run is in flight, or null. */
  const [reonboarding, setReonboarding] = useState<string | null>(null);
  /** studio#251: the outcome of the last re-run per repo id — the started run, or the refusal. */
  const [reonboardNote, setReonboardNote] = useState<Record<string, { text: string; failed: boolean }>>({});

  /**
   * ONE mutation at a time. The lock keeps a second row's Detach from re-pointing
   * `confirming` while a detach is mid-request, and keeps the picker from
   * starting an attach on top of it.
   */
  const busy = attaching !== null || detaching !== null || reonboarding !== null;

  /**
   * The project this section shows RIGHT NOW — `null` once unmounted. Neither
   * parent is keyed on the project (App.tsx), so navigating `/p/A` → `/p/B`
   * re-renders this same instance with a new `projectId` while an attach or
   * detach begun on A may still be in flight; on the detail page the section
   * unmounts for the loading tick instead. Either way that request's result
   * belongs to A: each mutation pins the project it started for and reports
   * only if this still matches. A project change also abandons the previous
   * project's in-progress UI — its pending confirm, its errors, its picker
   * query, and its mutation lock (the guarded-out request can no longer act).
   */
  const liveProjectId = useRef<string | null>(projectId);
  /**
   * Which mutation is the CURRENT one. `busy` admits one request at a time, but a
   * project change releases the lock while the request is still out, so a second
   * mutation can begin before the first settles — for the SAME repo id, when the
   * operator attaches the same repo on the next project (or navigates back). The
   * repo id alone cannot tell the two requests apart: the first one's `finally`
   * would release the lock the second one holds, re-enabling the controls while
   * its request is still in flight (Copilot on #208). So every mutation, and
   * every project change, takes the next token; a request applies its result —
   * the membership update, the error, the lock release — only while it still
   * holds the token it started with.
   */
  const mutationToken = useRef(0);
  useEffect(() => {
    liveProjectId.current = projectId;
    mutationToken.current += 1;
    setConfirming(null);
    setError(null);
    setRegistryError(null);
    setQuery('');
    setPickerOpen(false);
    setAttaching(null);
    setDetaching(null);
    setReonboarding(null);
    setReonboardNote({});
    return () => { liveProjectId.current = null; };
  }, [projectId]);

  const repoMembers = useMemo(
    () => members.filter((m) => m.member_kind === REPO_KIND),
    [members],
  );

  const retryRegistry = useCallback(() => {
    setError(null);
    setRegistryError(null);
    setReonboardNote((notes) => Object.fromEntries(Object.entries(notes).filter(([, note]) => !note.failed)));
    void fetchReposCached().then(setRepos).catch((e: unknown) => setRegistryError(e instanceof Error ? e.message : String(e)));
  }, []);
  const issueError = error ?? registryError ?? Object.values(reonboardNote).find((n) => n.failed)?.text ?? null;
  useEffect(() => {
    onIssue?.('repositories', issueError === null ? null : { what: 'repositories', error: issueError, retry: retryRegistry });
    return () => onIssue?.('repositories', null);
  }, [issueError, onIssue, retryRegistry]);

  // F-2R2-004: the rows can only show the engine's findings (and their "Re-run onboarding")
  // once the registry is known — warm the ONE session cache when this project has members and
  // the cache is cold. A failed read stays silent here: the picker's gesture retries and
  // reports it (`registryError`), so the failure is never lost, only not doubled.
  useEffect(() => {
    if (repos !== null || repoMembers.length === 0 || projectId === DEFAULT_PROJECT_ID) return;
    let cancelled = false;
    Promise.resolve()
      .then(() => fetchReposCached())
      .then((rs) => { if (!cancelled) setRepos(rs); })
      .catch((e: unknown) => { if (!cancelled) setRegistryError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [repos, repoMembers.length, projectId]);

  const options = useMemo(() => {
    if (repos === null) return [];
    const q = query.trim().toLowerCase();
    return repos
      .filter((r) => !isAttached(r, repoMembers))
      .filter((r) => q === '' || r.name.toLowerCase().includes(q) || r.id.toLowerCase().includes(q));
  }, [repos, query, repoMembers]);

  if (projectId === DEFAULT_PROJECT_ID) return null;

  /** The first gesture that needs the registry warms the ONE session cache. A
   *  failed fetch caches nothing (repoCache), so every later gesture retries —
   *  and the retry retires the failure it supersedes before it starts. */
  function openPicker(): void {
    setPickerOpen(true);
    if (repos !== null) return;
    setRegistryError(null);
    fetchReposCached()
      .then(setRepos)
      .catch((e: unknown) => setRegistryError(`registered repos unreadable: ${e instanceof Error ? e.message : String(e)}`));
  }

  /**
   * Begin a mutation: pin the project it is for and take the next token. The
   * returned predicate is true only while this request is still the current one
   * — same project shown (a navigation away and back bumps the token too, so a
   * result from before the round trip is stale even though the id matches), no
   * project change since, no newer mutation begun since. Everything a request does
   * after its `await` is gated on it, the lock release included.
   */
  function beginMutation(): () => boolean {
    const forProject = projectId;
    const token = ++mutationToken.current;
    return () => liveProjectId.current === forProject && mutationToken.current === token;
  }

  async function attach(repo: RepoEntry): Promise<void> {
    if (busy) return;
    const forProject = projectId;
    const stillMine = beginMutation();
    setAttaching(repo.id);
    setError(null);
    try {
      const { member } = await api.attachProjectMember(forProject, {
        kind: REPO_KIND,
        ref: repo.id,
        attachedBy: 'studio',
      });
      if (!stillMine()) return; // landed after a navigation or behind a newer mutation — not this request's result to apply
      onMembersChange((current) => (current.some((m) => m.id === member.id) ? current : [...current, member]));
      setQuery('');
    } catch (e) {
      if (!stillMine()) return;
      setError(`attach failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      // Release the lock only while it is still this request's: a project change
      // released it already, and a mutation begun since then — for this same repo
      // id included — owns it now. The token, not the repo id, decides.
      if (stillMine()) setAttaching(null);
    }
  }

  /**
   * studio#251: the "Re-run onboarding" remedy the engine names on an in-tree-ignored repo with no
   * live graph — the EXISTING onboard wire (`POST /repos/:id/onboard`, what the Repositories page's
   * Onboard button posts). This section has no run navigation, so the started run is STATED inline.
   */
  async function rerunOnboarding(repo: RepoEntry): Promise<void> {
    // One mutation at a time, the SAME lock attach/detach hold (Copilot on #253): a concurrent
    // mutation would take the token and this request's `finally` could never clear its flag.
    if (busy) return;
    const stillMine = beginMutation();
    setReonboarding(repo.id);
    try {
      const { runId } = await api.rerunOnboarding(repo.id);
      if (!stillMine()) return;
      setReonboardNote((prev) => ({ ...prev, [repo.id]: { text: `onboarding run ${runId} started — the live graph is rebuilt when it completes`, failed: false } }));
    } catch (e) {
      if (!stillMine()) return;
      setReonboardNote((prev) => ({ ...prev, [repo.id]: { text: `re-run refused: ${e instanceof Error ? e.message : String(e)}`, failed: true } }));
    } finally {
      if (stillMine()) setReonboarding(null);
    }
  }

  async function detach(member: ProjectMember): Promise<void> {
    if (busy) return;
    const forProject = projectId;
    const stillMine = beginMutation();
    setDetaching(member.id);
    setError(null);
    try {
      await api.detachProjectMember(forProject, member.id);
      if (!stillMine()) return; // landed after a navigation or behind a newer mutation — not this request's result to apply
      onMembersChange((current) => current.filter((m) => m.id !== member.id));
      setConfirming(null);
    } catch (e) {
      if (!stillMine()) return;
      setError(`detach failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      if (stillMine()) setDetaching(null);
    }
  }

  const shownError = issueError;
  const unattached = used.filter((u) => !u.attached && u.jobs > 0);
  const usedBy = (ref: string): number => used.find((u) => u.attached && (u.ref === ref || u.repo?.id === ref || u.repo?.name === ref))?.jobs ?? 0;

  const shown = options.slice(0, MAX_OPTIONS);
  const overflow = options.length - shown.length;

  return (
    <section data-testid="project-repos" data-count={repoMembers.length} className="wk-card wk-pg-proj-stack">
      <SectionTitle>Repositories and branches</SectionTitle>
      <StatLine items={[{ label: 'attached', value: registryError === null ? repoMembers.length : null }, { label: 'used by jobs, not attached', value: unattached.length }]} />
      {unattached.length > 0 && (
        <div data-testid="project-repos-used">
          {unattached.map((u) => (
            <div key={u.ref} data-testid="project-repo-used" data-repo={u.ref} className="wk-list-row wk-pg-proj-row">
              <div>
                <span className="wk-list-row-title">{u.name}</span>
                <p className="wk-list-row-meta">Used by {u.jobs} {u.jobs === 1 ? 'job' : 'jobs'}, not attached</p>
                {u.repo !== null && <BranchLine repo={u.repo} />}
              </div>
              <div className="wk-list-row-actions">
                {u.repo !== null
                  ? <button type="button" data-testid="project-repo-attach-used" data-repo={u.ref} disabled={busy} onClick={() => void attach(u.repo!)} className="wk-btn wk-btn--secondary">{attaching === u.repo.id ? 'Attaching…' : 'Attach'}</button>
                  : <span className="wk-field-note">No longer registered</span>}
              </div>
            </div>
          ))}
        </div>
      )}
      {repoMembers.length === 0 ? unattached.length === 0 && <EmptyState data-testid="project-repos-empty" title="No repository attached" body="Attach a repository before running this project’s tests." /> : (
        <div>
          {repoMembers.map((m) => {
            const repo = repoOf(m.member_ref, repos);
            const label = repo?.name ?? 'Repository';
            const isConfirming = confirming === m.id;
            const note = repo !== undefined ? reonboardNote[repo.id] : undefined;
            const findings = repo !== undefined ? repoFindings(repo) : [];
            return <div key={m.id} className="wk-pg-proj-stack">
              <div data-testid="project-repo-row" data-repo={m.member_ref} className="wk-list-row wk-pg-proj-row">
                <div>
                  {repos === null && registryError === null ? <Skeleton rows={1} variant="line" /> : <span className="wk-list-row-title">{label}</span>}
                  <p className="wk-list-row-meta" title={new Date(m.attached_at).toLocaleString()}>Attached {relTime(m.attached_at)}{usedBy(m.member_ref) > 0 ? ` · used by ${usedBy(m.member_ref)} ${usedBy(m.member_ref) === 1 ? 'job' : 'jobs'}` : ''}</p>
                  {repo !== undefined && <BranchLine repo={repo} />}
                  {repo?.root_path && <TechDetails text={repo.root_path} />}
                </div>
                <div className="wk-list-row-actions wk-pg-proj-actions">
                  {isConfirming ? <>
                    <span className="wk-list-row-meta">Detach {label}?</span>
                    <button type="button" data-testid="project-repo-detach-confirm" data-repo={m.member_ref} disabled={busy} onClick={() => void detach(m)} className="wk-btn wk-btn--danger">{detaching === m.id ? 'Detaching…' : 'Detach'}</button>
                    <button type="button" data-testid="project-repo-detach-cancel" disabled={busy} onClick={() => setConfirming(null)} className="wk-btn wk-btn--quiet">Cancel</button>
                  </> : <button type="button" data-testid="project-repo-detach" data-repo={m.member_ref} disabled={busy} onClick={() => setConfirming(m.id)} className="wk-btn wk-btn--quiet">Detach</button>}
                </div>
              </div>
              {/* studio#251: the engine's checkout findings for this member — the ONE findings
                  component (plain sentence + Re-run onboarding; the engine's text in Technical details). */}
              {repo !== undefined && findings.length > 0 && (
                <RepoFindings
                  findings={repo.findings}
                  onRerunOnboarding={() => void rerunOnboarding(repo)}
                  rerunning={reonboarding === repo.id}
                  disabled={busy}
                  testId="project-repo-findings"
                />
              )}
              {note && <div data-testid="project-repo-reonboard-note" data-failed={note.failed}>
                <p className="wk-pg-proj-note">{note.failed ? 'Onboarding couldn’t be started.' : 'Onboarding started. The code map updates when it finishes.'}</p>
                <TechDetails text={note.text} />
              </div>}
            </div>;
          })}
        </div>
      )}
      <label className="wk-pg-proj-field">Attach a registered repository
        <input data-testid="project-repo-search" className="wk-field" value={query} onFocus={openPicker}
          onChange={(e) => { setQuery(e.target.value); if (!pickerOpen) openPicker(); }}
          onKeyDown={(e) => { if (e.key === 'Escape') { setPickerOpen(false); setQuery(''); } }} placeholder="Search repositories to attach" />
      </label>
      {pickerOpen && repos === null && registryError === null && <Skeleton rows={2} />}
      {pickerOpen && repos !== null && (shown.length === 0 ? <p className="wk-field-note" data-testid="project-repo-options-empty">
        {repos.length === 0 ? 'No repositories registered yet. Register a repository first.' : query.trim() === '' ? 'Every registered repository is already attached.' : 'No registered repository matches.'}
      </p> : <div data-testid="project-repo-options" className="wk-pg-proj-actions">
        {shown.map((r) => <button key={r.id} type="button" data-testid="project-repo-option" data-repo={r.id} disabled={busy} onClick={() => void attach(r)} className="wk-btn wk-btn--secondary">{attaching === r.id ? 'Attaching…' : 'Attach'} {r.name}</button>)}
        {overflow > 0 && <span className="wk-field-note">{overflow} more — type to narrow</span>}
      </div>)}
      {busy && <p className="wk-field-note">Wait for the current repository change to finish.</p>}
      {shownError !== null && (onIssue === undefined
        ? <StateBanner data-testid="project-repo-error" kind={readErrorKind(shownError)} what="repositories" error={shownError} onRetry={retryRegistry} />
        : <TechDetails data-testid="project-repo-error" text={shownError} />)}
    </section>
  );
}
