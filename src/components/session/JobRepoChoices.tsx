import { useEffect, useRef, useState } from 'react';
import { api } from '../../api/client.js';
import type { ArtifactProposal, Project, RepoEntry } from '../../api/types.js';
import { placeToken } from '../../store/inlineStart.js';
import { jobWords, moveJob, moveOf, useJobMoves } from '../../store/jobMoves.js';
import { projectsForRepo, reposNamedIn } from '../../store/repoProjects.js';
import { JobMovedLine, JobProjectChoices } from './JobProjectChoices.js';

/** How many repositories show before "N more". */
const CHOICES_MAX = 6;

/** The job's missing repository, when that is the question crew asks and crew offers no choice for it (its chat has
 *  no repository in scope: a new chat). */
export function asksForRepo(p: Pick<ArtifactProposal, 'question' | 'needs'>): boolean {
  const q = p.question;
  if (q == null || q.kind !== 'missing' || q.choices.length > 0 || q.input !== undefined) return false;
  const missing = (p.needs ?? []).find((n) => n.required && n.status === 'missing');
  return missing !== undefined && missing.id === 'repo';
}

/** The repositories offered: those the words name first (in registry order), then the rest by name. */
export function repoChoices<R extends Pick<RepoEntry, 'id' | 'name'>>(words: string, repos: readonly R[]): { named: R[]; list: R[] } {
  const named = reposNamedIn(words, repos);
  const rest = repos.filter((r) => !named.includes(r)).sort((a, b) => a.name.localeCompare(b.name));
  return { named, list: [...named, ...rest] };
}

/**
 * "WHICH REPOSITORY?" ON A JOB (F41). A job that takes a repository, proposed in a chat with none in its scope (a new
 * chat: `/analyze domain Map the domain of rg1 …`), is asked "Which repository?" by crew with nothing to press: crew's
 * choices are the chat's scope, and a revision's `repoRef` outside it is refused. So the passage offers the registered
 * repositories as chips (those the words name first), and a press moves the same job to a new chat on that repository
 * (F39's move), filed in the project that solely holds it. A job that also needs a project, and whose repository no
 * single project holds, asks which project next (F39's chips for that repository); that press moves it. The old
 * proposal is then set aside. Reads are GETs; the only writes are the press's.
 */
export function JobRepoChoices({ chatId, proposal, onError }: {
  chatId: string;
  proposal: ArtifactProposal;
  onError: (words: string | null) => void;
}): React.ReactElement | null {
  const [repos, setRepos] = useState<RepoEntry[] | 'failed' | null>(null);
  const [tries, setTries] = useState(0);
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const busyRef = useRef(false);
  /** The repository picked for a job that needs a project no single one holds: its project chips follow. */
  const [picked, setPicked] = useState<RepoEntry | null>(null);
  const moved = useJobMoves((s) => moveOf(s.moves, proposal.pid));
  /** A move of this job out now (the project chips' press, or a press before a remount): nothing else is pressable. */
  const moving = useJobMoves((s) => s.moving[proposal.pid] === true);
  /** Where focus goes after the person's own press changes the question (the project question, or back to the chips). */
  const nextRef = useRef<HTMLDivElement | null>(null);
  const turned = useRef(false);
  useEffect(() => {
    if (!turned.current) return;
    turned.current = false;
    const el = nextRef.current;
    const first = el?.querySelector<HTMLButtonElement>('button:not([disabled])');
    (first ?? el)?.focus();
  }, [picked, repos]);
  useEffect(() => {
    let live = true;
    setRepos(null);
    api.listRepos().then(({ repos: list }) => { if (live) setRepos(list); }, () => { if (live) setRepos('failed'); });
    return () => { live = false; };
  }, [tries]);

  if (moved !== null) return <JobMovedLine chatId={chatId} pid={proposal.pid} moved={moved} />;
  if (proposal.shape === undefined) {
    return <p data-testid="job-passage-repos" data-state="failed" role="alert" className="wk-pass-sub">This job can’t be moved to a repository from here. Start it again from the / list in a chat on that repository.</p>;
  }
  if (picked !== null) {
    return (
      <div ref={nextRef} tabIndex={-1} data-testid="job-passage-repo-picked" aria-live="polite" className="wk-pass-sub">
        <JobProjectChoices chatId={chatId} proposal={proposal} onError={onError} repo={picked.id} repoName={picked.name} />
        <button type="button" data-testid="job-passage-repos-back" className="wk-btn wk-btn--link wk-btn--sm" disabled={moving}
          onClick={() => { turned.current = true; setPicked(null); }}>Another repository</button>
      </div>
    );
  }

  const pick = (r: RepoEntry): void => {
    // A ref, not the render's state: two presses in one tick seed once (as F39's).
    if (busyRef.current || moving) return;
    busyRef.current = true;
    setBusy(r.id);
    onError(null);
    // Taken at the press: a person who went elsewhere while the projects were read is not moved over (codex r3's rule).
    const here = placeToken();
    void (async (): Promise<void> => {
      const need = (proposal.needs ?? []).find((n) => n.id === 'project');
      let projectId: string | null = null;
      let where = `a new chat on ${r.name}`;
      if (need !== undefined && need.status === 'met' && need.value !== undefined && need.value !== '') {
        projectId = need.value;
        where = proposal.filedIn?.label ?? where;
      } else {
        let holding: Project[] = [];
        let certain = false;
        try { ({ holding, certain } = await projectsForRepo(r.id)); } catch { /* unread: no project chosen for the person */ }
        if (placeToken() !== here) return;
        if (certain && holding.length === 1) {
          projectId = holding[0]!.id;
          where = holding[0]!.name;
        } else if (need !== undefined && need.required) {
          turned.current = true;
          setPicked(r);
          return;
        }
      }
      await moveJob({ fromChatId: chatId, proposal, projectId, repoRef: r.id, where, pickKey: `${proposal.pid}:repo:${r.id}` });
    })().catch(
      (e: unknown) => onError(`The job was not moved to ${r.name}: ${e instanceof Error ? e.message : String(e)}. Pick a repository again.`),
    ).finally(() => { busyRef.current = false; setBusy(null); });
  };

  if (repos === null) return <p data-testid="job-passage-repos" data-state="loading" className="wk-pass-sub wk-pass-grey">Reading your repositories…</p>;
  if (repos === 'failed') {
    return (
      <div data-testid="job-passage-repos" data-state="failed" role="alert" className="wk-pass-sub wk-composer-start-need">
        <span className="wk-composer-note">Your repositories could not be read.</span>
        <button type="button" data-testid="job-passage-repos-retry" className="wk-btn wk-btn--link wk-btn--sm" onClick={() => setTries((n) => n + 1)}>Try again</button>
      </div>
    );
  }
  const { named, list } = repoChoices(jobWords(proposal), repos);
  const shown = all ? list : list.slice(0, Math.max(CHOICES_MAX, named.length));
  return (
    <div ref={nextRef} tabIndex={-1} data-testid="job-passage-repos" role="group" aria-label="Which repository?" className="wk-pass-sub wk-composer-start-need">
      <span className="wk-composer-note">
        {list.length === 0 ? 'Add a repository first: this job runs on one.'
          : named.length === 1 ? `You named ${named[0]!.name}. The job opens in a new chat on the one you pick.`
            : 'Pick one: the job opens in a new chat on it.'}
      </span>
      {shown.map((r) => (
        <button key={r.id} type="button" data-testid="job-passage-repo" data-repo={r.id} data-named={named.includes(r) ? 'true' : undefined}
          disabled={busy !== null || moving} aria-busy={busy === r.id} onClick={() => pick(r)} className="wk-composer-chip wk-composer-suggestion">
          {busy === r.id ? `${r.name}…` : r.name}
        </button>
      ))}
      {!all && list.length > shown.length && (
        <button type="button" data-testid="job-passage-repos-more" className="wk-btn wk-btn--link wk-btn--sm" onClick={() => setAll(true)}>
          {list.length - shown.length} more
        </button>
      )}
    </div>
  );
}
