import { useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import type { ArtifactProposal, Project } from '../../api/types.js';
import { postJob } from '../../store/inlineStart.js';
import { projectsForRepo } from '../../store/repoProjects.js';

/** How many projects show before "N more". */
const CHOICES_MAX = 6;

/** The job's missing project, when that is the question crew asks (and crew offers no choice for it). */
export function asksForProject(p: Pick<ArtifactProposal, 'question' | 'needs'>): boolean {
  const q = p.question;
  if (q == null || q.kind !== 'missing' || q.choices.length > 0 || q.input !== undefined) return false;
  const missing = (p.needs ?? []).find((n) => n.required && n.status === 'missing');
  return missing !== undefined && missing.id === 'project';
}

/**
 * "WHICH PROJECT?" ON A JOB (F39, DES-CATALOG-002 §4.6). A job whose card needs a project, proposed in a chat in no
 * project, is asked "Project?" by crew with nothing to press: crew keeps the project the chat's own (a revision's
 * `project` edit is refused). So the answer is the inline start's: one chip per project (those holding the job's
 * repository first, else every project), and a press puts the same job, with its words and repository, in a new chat in
 * that project, where its project is met and Start is offered. The old proposal is set aside (Not now), so the old
 * chat never shows two of the same job. Reads are GETs; the only writes are the press's.
 */
export function JobProjectChoices({ chatId, proposal, onError }: {
  chatId: string;
  proposal: ArtifactProposal;
  onError: (words: string) => void;
}): React.ReactElement | null {
  const repo = (proposal.needs ?? []).find((n) => n.id === 'repo' && n.status === 'met')?.value ?? null;
  const [choices, setChoices] = useState<{ list: Project[]; holding: boolean } | 'failed' | null>(null);
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    projectsForRepo(repo).then(
      ({ all: every, holding }) => { if (live) setChoices(holding.length > 0 ? { list: holding, holding: true } : { list: every, holding: false }); },
      () => { if (live) setChoices('failed'); },
    );
    return () => { live = false; };
  }, [repo]);

  const shape = proposal.shape;
  if (shape === undefined) return null;
  const pick = (p: Project): void => {
    if (busy !== null) return;
    setBusy(p.id);
    void postJob({
      card: shape.card, option: shape.option, depth: shape.depth, words: proposal.words ?? '', source: 'pick',
      chatId: null, projectId: p.id, repoRef: repo, pickKey: `${proposal.pid}:project:${p.id}`,
    }).then(
      (out) => {
        // The job now lives in the project's chat: this one is set aside, best effort (its chat says "Not started").
        if (out !== null) void api.decideChatProposal(chatId, proposal.pid, { decision: 'not_now' }).catch(() => undefined);
      },
      (e: unknown) => onError(`The job was not moved to ${p.name}: ${e instanceof Error ? e.message : String(e)}. Pick a project again.`),
    ).finally(() => setBusy(null));
  };

  if (choices === null) return <p data-testid="job-passage-projects" data-state="loading" className="wk-pass-sub wk-pass-grey">Reading your projects…</p>;
  if (choices === 'failed') return <p data-testid="job-passage-projects" data-state="failed" role="alert" className="wk-pass-sub">Your projects could not be read. Open the job again to pick one.</p>;
  const shown = all ? choices.list : choices.list.slice(0, CHOICES_MAX);
  return (
    <div data-testid="job-passage-projects" role="group" aria-label="Which project?" className="wk-pass-sub wk-composer-start-need">
      <span className="wk-composer-note">
        {choices.list.length === 0 ? 'Make a project first: this job belongs to a project.'
          : choices.holding ? 'Which project? These hold its repository. The job opens in a new chat there.'
            : 'Which project? The job opens in a new chat there.'}
      </span>
      {shown.map((p) => (
        <button key={p.id} type="button" data-testid="job-passage-project" data-project={p.id} disabled={busy !== null}
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
