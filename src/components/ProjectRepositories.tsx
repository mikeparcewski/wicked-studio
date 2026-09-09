import { useMemo, useState } from 'react';
import { api } from '../api/client.js';
import type { ProjectMember, RepoEntry } from '../api/types.js';
import { fetchReposCached, getCachedRepos } from '../store/repoCache.js';

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
 * disagree. The synthesized `default` project rejects attach on the wire
 * (routes.ts) and has no stored members to detach, so the section is omitted
 * there entirely.
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

interface Props {
  projectId: string;
  /** Every member the parent holds — this section filters to `crew.repo` itself. */
  members: ProjectMember[];
  /** The parent's membership state with the change applied: attach appends, detach filters. */
  onMembersChange: (members: ProjectMember[]) => void;
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
  const [error, setError] = useState<string | null>(null);

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

  /** The first gesture that needs the registry warms the ONE session cache. */
  function openPicker(): void {
    setPickerOpen(true);
    if (repos !== null) return;
    fetchReposCached()
      .then(setRepos)
      .catch((e: unknown) => setError(`registered repos unreadable: ${e instanceof Error ? e.message : String(e)}`));
  }

  async function attach(repo: RepoEntry): Promise<void> {
    if (attaching !== null) return;
    setAttaching(repo.id);
    setError(null);
    try {
      const { member } = await api.attachProjectMember(projectId, {
        kind: REPO_KIND,
        ref: repo.id,
        attachedBy: 'studio',
      });
      onMembersChange([...members, member]);
      setQuery('');
    } catch (e) {
      setError(`attach failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setAttaching(null);
    }
  }

  async function detach(member: ProjectMember): Promise<void> {
    if (detaching !== null) return;
    setDetaching(member.id);
    setError(null);
    try {
      await api.detachProjectMember(projectId, member.id);
      onMembersChange(members.filter((m) => m.id !== member.id));
      setConfirming(null);
    } catch (e) {
      setError(`detach failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setDetaching(null);
    }
  }

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
            return (
              <div key={m.id} data-testid="project-repo-row" data-repo={m.member_ref} style={CSS.row}>
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
                      disabled={detaching !== null}
                      onClick={() => void detach(m)}
                      style={{ ...CSS.dangerBtn, opacity: detaching === m.id ? 0.5 : 1 }}
                    >
                      {detaching === m.id ? 'Detaching…' : 'Detach'}
                    </button>
                    <button
                      type="button"
                      data-testid="project-repo-detach-cancel"
                      disabled={detaching !== null}
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
                      onClick={() => setConfirming(m.id)}
                      style={CSS.ghostBtn}
                    >
                      Detach
                    </button>
                  </>
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
                  disabled={attaching !== null}
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
        {error !== null && (
          <p data-testid="project-repo-error" style={CSS.error}>{error}</p>
        )}
      </div>
    </section>
  );
}
