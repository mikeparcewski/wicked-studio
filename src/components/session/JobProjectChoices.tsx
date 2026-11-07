import { useEffect, useRef, useState } from 'react';
import type { ArtifactProposal, Project } from '../../api/types.js';
import { openChat } from '../../store/chatFlow.js';
import { moveJob, moveOf, retireMoved, useJobMoves, type JobMove } from '../../store/jobMoves.js';
import { projectsForRepo } from '../../store/repoProjects.js';

export { jobWords, useJobMoves } from '../../store/jobMoves.js';

/** How many projects show before "N more". */
const CHOICES_MAX = 6;

/** The job's missing project, when that is the question crew asks (and crew offers no choice for it). */
export function asksForProject(p: Pick<ArtifactProposal, 'question' | 'needs'>): boolean {
  const q = p.question;
  if (q == null || q.kind !== 'missing' || q.choices.length > 0 || q.input !== undefined) return false;
  const missing = (p.needs ?? []).find((n) => n.required && n.status === 'missing');
  return missing !== undefined && missing.id === 'project';
}

/** The job's repository: its met repository need, else the one repository it was proposed on. */
export function jobRepo(p: Pick<ArtifactProposal, 'needs' | 'repoRefs'>): string | null {
  const need = (p.needs ?? []).find((n) => n.id === 'repo' && n.status === 'met')?.value;
  if (need !== undefined) return need;
  return p.repoRefs?.length === 1 ? p.repoRefs[0]! : null;
}

/** The moved job, where its chips were: "This job moved to X · Open it", and a retry of only the set-aside when that
 *  failed (never a second seed). */
export function JobMovedLine({ chatId, pid, moved }: { chatId: string; pid: string; moved: JobMove }): React.ReactElement {
  return (
    <div data-testid="job-passage-projects" data-state="moved" role="status" className="wk-pass-sub wk-composer-start-need">
      <span className="wk-composer-note">This job moved to {moved.where}{moved.retired === 'failed' ? '; this copy is still here' : ''}.</span>
      <button type="button" data-testid="job-passage-projects-open" className="wk-btn wk-btn--link wk-btn--sm" onClick={() => openChat(moved.chatId)}>Open it</button>
      {moved.retired === 'failed' && (
        <>
          <span role="alert" data-testid="job-passage-projects-error" className="wk-composer-note wk-composer-note--bad">{moved.error}</span>
          <button type="button" data-testid="job-passage-projects-retire" className="wk-btn wk-btn--link wk-btn--sm" onClick={() => retireMoved(chatId, pid, moved)}>Set this one aside</button>
        </>
      )}
    </div>
  );
}

type Choices = { repo: string | null; list: Project[]; holding: boolean } | { repo: string | null; failed: true } | null;

/**
 * "WHICH PROJECT?" ON A JOB (F39, DES-CATALOG-002 §4.6). A job whose card needs a project, proposed in a chat in no
 * project, is asked "Project?" by crew with nothing to press: crew keeps the project the chat's own (a revision's
 * `project` edit is refused). So the answer is the inline start's: one chip per project (those holding the job's
 * repository first, else every project), and a press puts the same job (card, option, depth, words with their
 * corrections, repository) in a new chat in that project, where its project is met and Start is offered. The old
 * proposal is then set aside (Not now). Once moved, the chips give way to the moved job, so a second press never makes
 * a second one. Reads are GETs; the only writes are the press's.
 */
export function JobProjectChoices({ chatId, proposal, onError, repo: repoPicked, repoName }: {
  chatId: string;
  proposal: ArtifactProposal;
  onError: (words: string | null) => void;
  /** The repository the person just picked for this job (F41), when its chat had none: the move takes it along. */
  repo?: string;
  repoName?: string;
}): React.ReactElement | null {
  const repo = repoPicked ?? jobRepo(proposal);
  const [choices, setChoices] = useState<Choices>(null);
  const [tries, setTries] = useState(0);
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const busyRef = useRef(false);
  /** The job, once moved: where it went, and whether this one was set aside (else a retry that never seeds again). */
  const moved = useJobMoves((s) => moveOf(s.moves, proposal.pid));
  /** A move of this job already out (from this control, or another one the person left): nothing more is pressable. */
  const moving = useJobMoves((s) => s.moving[proposal.pid] === true);
  useEffect(() => {
    let live = true;
    // Choices belong to one repository: a newer one reads afresh, and nothing is pressable meanwhile (codex r4).
    setChoices(null);
    projectsForRepo(repo).then(
      ({ all: every, holding, certain }) => {
        if (live) setChoices(certain && holding.length > 0 ? { repo, list: holding, holding: true } : { repo, list: every, holding: false });
      },
      () => { if (live) setChoices({ repo, failed: true }); },
    );
    return () => { live = false; };
  }, [repo, tries]);

  const shape = proposal.shape;
  if (shape === undefined) {
    return <p data-testid="job-passage-projects" data-state="failed" role="alert" className="wk-pass-sub">This job can’t be moved to a project from here. Start it again from the / list in a project’s chat.</p>;
  }
  const pick = (p: Project): void => {
    // A ref, not the render's state: two presses in one tick seed once (pi r4).
    if (busyRef.current || moved !== null || moving) return;
    busyRef.current = true;
    setBusy(p.id);
    onError(null);
    void moveJob({ fromChatId: chatId, proposal, projectId: p.id, repoRef: repo, where: p.name, pickKey: `${proposal.pid}:project:${p.id}` }).then(
      () => undefined,
      (e: unknown) => onError(`The job was not moved to ${p.name}: ${e instanceof Error ? e.message : String(e)}. Pick a project again.`),
    ).finally(() => { busyRef.current = false; setBusy(null); });
  };

  if (moved !== null) return <JobMovedLine chatId={chatId} pid={proposal.pid} moved={moved} />;
  if (choices === null || choices.repo !== repo) return <p data-testid="job-passage-projects" data-state="loading" className="wk-pass-sub wk-pass-grey">Reading your projects…</p>;
  if ('failed' in choices) {
    return (
      <div data-testid="job-passage-projects" data-state="failed" role="alert" className="wk-pass-sub wk-composer-start-need">
        <span className="wk-composer-note">Your projects could not be read.</span>
        <button type="button" data-testid="job-passage-projects-retry" className="wk-btn wk-btn--link wk-btn--sm" onClick={() => setTries((n) => n + 1)}>Try again</button>
      </div>
    );
  }
  const shown = all ? choices.list : choices.list.slice(0, CHOICES_MAX);
  return (
    <div data-testid="job-passage-projects" role="group" aria-label="Which project?" className="wk-pass-sub wk-composer-start-need">
      <span className="wk-composer-note">
        {choices.list.length === 0 ? 'Make a project first: this job belongs to a project.'
          : choices.holding ? `Which project? ${repoName !== undefined ? `These hold ${repoName}.` : 'These hold its repository.'} The job opens in a new chat there.`
            : `Which project${repoName !== undefined ? ` for ${repoName}` : ''}? The job opens in a new chat there.`}
      </span>
      {shown.map((p) => (
        <button key={p.id} type="button" data-testid="job-passage-project" data-project={p.id} disabled={busy !== null || moving}
          aria-busy={busy === p.id} onClick={() => pick(p)} className="wk-composer-chip wk-composer-suggestion">
          {busy === p.id ? `${p.name}…` : p.name}
        </button>
      ))}
      {!all && choices.list.length > CHOICES_MAX && (
        <button type="button" data-testid="job-passage-projects-more" className="wk-btn wk-btn--link wk-btn--sm" onClick={() => setAll(true)}>
          {choices.list.length - CHOICES_MAX} more
        </button>
      )}
    </div>
  );
}
