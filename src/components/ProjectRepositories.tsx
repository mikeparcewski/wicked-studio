import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client.js';
import type { ProjectMember, RepoEntry } from '../api/types.js';
import { fetchReposCached, getCachedRepos } from '../store/repoCache.js';
import { RepoFindings } from './RepoFindings.js';

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
 * search field's focus), never on mount.
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

const CSS = {
  sectionHead: {
    fontSize: 'var(--text-2xs)', fontWeight: 'var(--weight-bold)',
    letterSpacing: '0.08em', textTransform: 'uppercase',
    color: 'var(--ink-muted)', margin: '0 0 8px',
  },
  list: {
    display: 'flex', flexDirection: 'column', gap: '2px',
    background: 'var(--surface-card)', border: '1px solid var(--surface-raised)',
    borderRadius: 'var(--radius-lg)', padding: '4px',
  },
  row: {
    display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0,
    padding: '8px 10px', borderRadius: 'var(--radius-md)',
  },
  repoName: {
    fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', color: 'var(--ink-body)',
    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
  },
  repoPath: {
    flex: 1, minWidth: 0, fontSize: 'var(--text-2xs)', fontFamily: 'var(--font-mono)',
    color: 'var(--ink-dim)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
  },
  rowMeta: {
    fontSize: 'var(--text-2xs)', fontFamily: 'var(--font-mono)', color: 'var(--ink-dim)',
    whiteSpace: 'nowrap', flexShrink: 0,
  },
  ghostBtn: {
    background: 'transparent', border: '1px solid var(--surface-raised)',
    borderRadius: 'var(--radius-md)', color: 'var(--ink-muted)', cursor: 'pointer',
    fontSize: 'var(--text-2xs)', fontFamily: 'var(--font-sans)', padding: '2px 10px',
    flexShrink: 0,
  },
  dangerBtn: {
    background: 'transparent', border: '1px solid var(--status-fail)',
    borderRadius: 'var(--radius-md)', color: 'var(--status-fail)', cursor: 'pointer',
    fontSize: 'var(--text-2xs)', fontFamily: 'var(--font-sans)', padding: '2px 10px',
    flexShrink: 0,
  },
  empty: { fontSize: 'var(--text-xs)', color: 'var(--ink-dim)', margin: 0 },
  search: {
    width: '100%', maxWidth: '360px', boxSizing: 'border-box',
    background: 'var(--surface-base)', border: '1px solid var(--surface-raised)',
    borderRadius: 'var(--radius-sm)', color: 'var(--ink-body)', caretColor: 'var(--accent)',
    fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', padding: '4px 8px',
    outline: 'none',
  },
  option: {
    borderRadius: 'var(--radius-full)', padding: '2px 10px', cursor: 'pointer',
    border: '1px dashed var(--surface-raised)', background: 'transparent',
    color: 'var(--ink-muted)', fontSize: 'var(--text-2xs)', fontFamily: 'var(--font-mono)',
  },
  hint: { fontSize: 'var(--text-2xs)', fontFamily: 'var(--font-mono)', color: 'var(--ink-dim)', margin: 0 },
  error: { fontSize: 'var(--text-2xs)', fontFamily: 'var(--font-mono)', color: 'var(--status-fail)', margin: 0 },
} as const satisfies Record<string, React.CSSProperties>;

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
}

export function ProjectRepositories({ projectId, members, onMembersChange }: Props): React.ReactElement | null {
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
    return () => { liveProjectId.current = null; };
  }, [projectId]);

  const repoMembers = useMemo(
    () => members.filter((m) => m.member_kind === REPO_KIND),
    [members],
  );

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

  const shownError = error ?? registryError;

  const shown = options.slice(0, MAX_OPTIONS);
  const overflow = options.length - shown.length;

  return (
    <section data-testid="project-repos" data-count={repoMembers.length}>
      <p style={CSS.sectionHead}>Repositories ({repoMembers.length})</p>

      {repoMembers.length === 0 ? (
        <p style={CSS.empty} data-testid="project-repos-empty">
          No repository attached — a project-scoped test cannot launch until one is.
        </p>
      ) : (
        <div style={CSS.list}>
          {repoMembers.map((m) => {
            const repo = repoOf(m.member_ref, repos);
            const label = repo?.name ?? m.member_ref;
            const isConfirming = confirming === m.id;
            const note = repo !== undefined ? reonboardNote[repo.id] : undefined;
            return (
              <div key={m.id} style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              <div data-testid="project-repo-row" data-repo={m.member_ref} style={CSS.row}>
                <span aria-hidden style={{ color: 'var(--ink-dim)' }}>⬡</span>
                <span style={CSS.repoName} title={m.member_ref}>{label}</span>
                <span style={CSS.repoPath} title={repo?.root_path}>{repo?.root_path ?? ''}</span>
                {isConfirming ? (
                  <>
                    <span style={CSS.rowMeta}>detach {label}?</span>
                    <button
                      type="button"
                      data-testid="project-repo-detach-confirm"
                      data-repo={m.member_ref}
                      disabled={busy}
                      onClick={() => void detach(m)}
                      style={{ ...CSS.dangerBtn, opacity: detaching === m.id ? 0.5 : 1 }}
                    >
                      {detaching === m.id ? 'Detaching…' : 'Detach'}
                    </button>
                    <button
                      type="button"
                      data-testid="project-repo-detach-cancel"
                      disabled={busy}
                      onClick={() => setConfirming(null)}
                      style={CSS.ghostBtn}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <span style={CSS.rowMeta}>
                      {m.attached_by} · {new Date(m.attached_at).toLocaleDateString()}
                    </span>
                    <button
                      type="button"
                      data-testid="project-repo-detach"
                      data-repo={m.member_ref}
                      title="Detach this repository from the project (asks first)"
                      disabled={busy}
                      onClick={() => setConfirming(m.id)}
                      style={{ ...CSS.ghostBtn, opacity: busy ? 0.5 : 1 }}
                    >
                      Detach
                    </button>
                  </>
                )}
              </div>
              {/* studio#251: the engine's checkout findings for this member (wicked-core#406) —
                  known once the registry cache is warm (the picker's gesture), silent otherwise
                  and silent for a clean checkout. */}
              {repo !== undefined && (
                <div style={{ padding: '0 10px 6px 30px', minWidth: 0 }}>
                  <RepoFindings
                    compact
                    findings={repo.findings}
                    onRerunOnboarding={() => void rerunOnboarding(repo)}
                    rerunning={reonboarding === repo.id}
                    testId="project-repo-findings"
                  />
                  {note !== undefined && (
                    <p data-testid="project-repo-reonboard-note" data-failed={note.failed} style={note.failed ? CSS.error : CSS.hint}>
                      {note.text}
                    </p>
                  )}
                </div>
              )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Attach: the registered-repo picker (the launch panel's search idiom) ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '8px' }}>
        <input
          data-testid="project-repo-search"
          value={query}
          onFocus={openPicker}
          onChange={(e) => { setQuery(e.target.value); if (!pickerOpen) openPicker(); }}
          onKeyDown={(e) => { if (e.key === 'Escape') { setPickerOpen(false); setQuery(''); } }}
          placeholder="attach a registered repo…"
          aria-label="Attach a registered repository"
          style={CSS.search}
        />
        {pickerOpen && repos !== null && (
          shown.length === 0 ? (
            <p style={CSS.hint} data-testid="project-repo-options-empty">
              {repos.length === 0
                ? 'no repos registered yet — register one under Repositories first'
                : query.trim() === ''
                  ? 'every registered repo is already attached'
                  : 'no registered repo matches'}
            </p>
          ) : (
            <div data-testid="project-repo-options" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px' }}>
              {shown.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  data-testid="project-repo-option"
                  data-repo={r.id}
                  title={r.root_path}
                  disabled={busy}
                  onClick={() => void attach(r)}
                  style={{ ...CSS.option, opacity: attaching === r.id ? 0.5 : 1 }}
                >
                  {attaching === r.id ? '… ' : '+ '}{r.name}
                </button>
              ))}
              {overflow > 0 && (
                <span style={CSS.hint}>+{overflow} more — type to narrow</span>
              )}
            </div>
          )
        )}
        {shownError !== null && (
          <p data-testid="project-repo-error" style={CSS.error}>{shownError}</p>
        )}
      </div>
    </section>
  );
}
