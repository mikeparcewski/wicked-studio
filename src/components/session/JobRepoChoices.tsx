import { useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import type { ArtifactProposal, RepoEntry } from '../../api/types.js';
import { jobWords, moveOf, useJobMoves } from '../../store/jobMoves.js';
import { reposNamedIn } from '../../store/repoProjects.js';
import { JobMovedLine } from './JobProjectChoices.js';

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

/**
 * (studio#1335) Which of crew's "Which repository?" choices an asking card shows before "N more", by their index: the
 * same rule as these chips, every one the words (and their corrections) name plus the first others in crew's order to
 * fill {@link CHOICES_MAX}. `null` when every choice shows. crew sends every repository in the chat's scope (crew#1791).
 */
export function askingChoicesShown(p: Pick<ArtifactProposal, 'question' | 'words' | 'details'>): ReadonlySet<number> | null {
  const choices = p.question?.choices ?? [];
  if (choices.length <= CHOICES_MAX) return null;
  const repos = choices.map((c, i) => {
    const ref = (c.edit as { repoRef?: unknown } | undefined)?.repoRef;
    return { i, id: typeof ref === 'string' ? ref : '', name: typeof ref === 'string' ? c.label : '' };
  });
  const shown = new Set(reposNamedIn(jobWords(p), repos.filter((r) => r.id !== '')).map((r) => r.i));
  for (const r of repos) { if (shown.size >= CHOICES_MAX) break; shown.add(r.i); }
  return shown.size >= choices.length ? null : shown;
}

/** The repositories offered: those the words name first (in registry order), then the rest by name. */
export function repoChoices<R extends Pick<RepoEntry, 'id' | 'name'>>(words: string, repos: readonly R[]): { named: R[]; list: R[] } {
  const named = reposNamedIn(words, repos);
  const rest = repos.filter((r) => !named.includes(r)).sort((a, b) => a.name.localeCompare(b.name));
  return { named, list: [...named, ...rest] };
}

/**
 * "WHICH REPOSITORY?" ON A JOB (F41, studio#1094). A job that takes a repository, proposed in a chat with none in its
 * scope (a new chat: `/analyze domain Map the domain of rg1 …`), is asked "Which repository?" by crew with nothing to
 * press. The passage offers the registered repositories as chips (those the words name first); a press answers crew's
 * question in this chat, as the revision `{repoRef}`: crew sets a repository-less chat's first repository from the
 * person's pick (crew#1672), so the job stays where it was asked and no chat is left behind. A project the job still
 * lacks is crew's next question (F39's chips). The only write is the press's revision, sent by the passage.
 */
export function JobRepoChoices({ chatId, proposal, disabled, onPick }: {
  chatId: string;
  proposal: ArtifactProposal;
  /** A change or a Start/Not now of this job is in flight: nothing is pressable. */
  disabled: boolean;
  /** Answer crew's question with this repository (the passage sends the revision and owns its hold); false when the
   *  passage refused the press (an answer already out). */
  onPick: (repoRef: string) => boolean;
}): React.ReactElement | null {
  const [repos, setRepos] = useState<RepoEntry[] | 'failed' | null>(null);
  const [tries, setTries] = useState(0);
  const [all, setAll] = useState(false);
  /** The chip whose answer the passage sent: it reads busy while that revision is out. */
  const [pressed, setPressed] = useState<string | null>(null);
  /** A job an earlier studio moved to a new chat (kept in this browser): the old chat still says where it went. */
  const moved = useJobMoves((s) => moveOf(s.moves, proposal.pid));
  useEffect(() => {
    let live = true;
    setRepos(null);
    api.listRepos().then(({ repos: list }) => { if (live) setRepos(list); }, () => { if (live) setRepos('failed'); });
    return () => { live = false; };
  }, [tries]);

  if (moved !== null) return <JobMovedLine chatId={chatId} pid={proposal.pid} moved={moved} />;
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
    <div data-testid="job-passage-repos" role="group" aria-label="Which repository?" className="wk-pass-sub wk-composer-start-need">
      <span className="wk-composer-note">
        {list.length === 0 ? 'Add a repository first: this job runs on one.'
          : named.length === 1 ? `You named ${named[0]!.name}. The job runs on the one you pick, in this chat.`
            : 'Pick one: the job runs on it, in this chat.'}
      </span>
      {shown.map((r) => (
        <button key={r.id} type="button" data-testid="job-passage-repo" data-repo={r.id} data-named={named.includes(r) ? 'true' : undefined}
          disabled={disabled} aria-busy={disabled && pressed === r.id}
          onClick={() => { if (!disabled && onPick(r.id)) setPressed(r.id); }} className="wk-composer-chip wk-composer-suggestion">
          {disabled && pressed === r.id ? `${r.name}…` : r.name}
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
