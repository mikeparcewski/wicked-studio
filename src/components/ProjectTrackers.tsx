import { useMemo, useState } from 'react';
import { repoDetailPath } from '../board/repoTabs.js';
import { onPlainClick } from './repoActions.js';
import { Plus } from 'lucide-react';
import { useTrackerLinksSupported, type TrackerLinksResponse } from '../api/trackers.js';
import { LinkTrackerPicker } from './trackers/LinkTrackerPicker.js';
import { AgentsOffWarning, FromTag, ProjectionPill, RemoveLink, TrackerRow } from './trackers/TrackerParts.js';
import { useTrackerLinks, type TrackerLinksRead } from './trackers/useTrackerLinks.js';


/**
 * LINKED TRACKERS on a project's Repositories tab (DES-PM-001 §3.3, mockup screen 2): the trackers linked to the
 * project, each with Remove; the trackers that reach it through its repositories, read-only and marked "through
 * <repo>"; the scope rule in one line; for a tool whose Agents switches keep this project out, a line that says so and
 * opens its Agents box (Q-PM1: a link never ticks a switch). Everything shown is crew's answer
 * (`GET /tracker-links?project=`): a link or a removal reads it again. Hidden on a crew without tracker links.
 */
export function ProjectTrackers({ projectId, projectName, repoNames = [], navigate }: {
  projectId: string;
  projectName: string;
  /** The project's own repositories (its `crew.repo` members), for the line of chips. */
  repoNames?: readonly string[];
  navigate: (path: string) => void;
}): React.ReactElement | null {
  const supported = useTrackerLinksSupported();
  // Attaching or detaching a repository changes what reaches the project through it: crew's links are read again.
  const { read, reload } = useTrackerLinks({ project: projectId }, supported, repoNames.join('\u0000'));
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!supported) return null;
  const links = read.phase === 'ok' ? read.links : null;
  return (
    <section className="wk-card wk-trk-card" aria-labelledby="wk-trk-project-title" data-testid="project-trackers" data-phase={read.phase}>
      <div className="wk-trk-head">
        <h2 id="wk-trk-project-title" className="wk-section-title">Linked trackers</h2>
        {links !== null && <span className="wk-src-cap" data-testid="project-trackers-count">{countWords(links)}</span>}
        <span className="wk-src-sp" />
        <button type="button" className="wk-btn wk-btn--secondary wk-btn--sm" data-testid="project-trackers-add" aria-expanded={picking} onClick={() => setPicking((v) => !v)}>
          <Plus size={14} aria-hidden />Link a tracker
        </button>
      </div>
      <p className="wk-trk-rule" data-testid="project-trackers-rule">Jobs and chats in this project see these, <b>plus the trackers linked to its repositories</b>. Nothing else from these tools.</p>
      <ReadState read={read} onRetry={() => void reload()} what="this project’s trackers" />
      {links !== null && (
        <div className="wk-trk-cols">
          <div className="wk-trk-col">
            <p className="wk-trk-sub">Linked to {projectName}</p>
            {links.links.length === 0 && <p className="wk-src-note" data-testid="project-trackers-empty">Nothing linked to {projectName} yet. Link a Jira project or a GitHub repository’s issues, and jobs and chats here can read them.</p>}
            {links.links.map((l) => {
              const agents = links.agents.find((a) => a.source === l.source);
              return (
                <TrackerRow
                  key={l.id}
                  tracker={l}
                  data-testid="project-tracker"
                  status={<ProjectionPill link={l} />}
                  action={<RemoveLink link={l} onSettled={reload} onError={setError} />}
                  warn={agents !== undefined && !agents.see ? <AgentsOffWarning who={projectName} link={l} navigate={navigate} /> : null}
                />
              );
            })}
          </div>
          <div className="wk-trk-col">
            <ViaRepos projectId={projectId} links={links} repoNames={repoNames} projectName={projectName} navigate={navigate} />
          </div>
        </div>
      )}
      {error !== null && <p role="alert" className="wk-src-note wk-src-tone-fail" data-testid="project-trackers-error">{error}</p>}
      {picking && (
        <LinkTrackerPicker target={{ kind: 'project', id: projectId }} targetName={projectName} onLinked={reload} onClose={() => setPicking(false)} navigate={navigate} />
      )}
    </section>
  );
}

function ViaRepos({ links, repoNames, projectId, projectName, navigate }: { links: TrackerLinksResponse; repoNames: readonly string[]; projectId: string; projectName: string; navigate: (path: string) => void }): React.ReactElement {
  const repos = useMemo(() => [...new Set([...repoNames, ...links.viaRepos.map((l) => l.viaRepo)])], [repoNames, links.viaRepos]);
  return (
    <>
      <p className="wk-trk-sub">This project’s repositories</p>
      {repos.length === 0 ? <p className="wk-src-note">No repository attached yet.</p> : (
        <div className="wk-trk-chips" data-testid="project-trackers-repos">
          {repos.map((r) => (
            <a key={r} className="wk-trk-chip" href={repoDetailPath(r, { project: projectId })} onClick={onPlainClick(navigate, repoDetailPath(r, { project: projectId }))}>{r}</a>
          ))}
        </div>
      )}
      <p className="wk-trk-sub">From its repositories</p>
      {links.viaRepos.length === 0 && <p className="wk-src-note" data-testid="project-trackers-via-empty">None of its repositories has a tracker linked.</p>}
      {links.viaRepos.map((l) => (
        <TrackerRow key={`${l.id}:${l.viaRepo}`} tracker={l} readOnly data-testid="project-tracker-via" status={<FromTag via="repo">through {l.viaRepo}</FromTag>}
          warn={links.agents.find((a) => a.source === l.source)?.see === false ? <AgentsOffWarning who={projectName} link={l} navigate={navigate} /> : null} />
      ))}
      <p className="wk-src-note">Change these on the repository: a tracker linked there reaches every project the repository is in.</p>
    </>
  );
}

function countWords(l: TrackerLinksResponse): string {
  return `${l.links.length} linked here · ${l.viaRepos.length} from its repositor${l.viaRepos.length === 1 ? 'y' : 'ies'}`;
}

/** Loading, an unreadable answer and a failed read, said the same way on every tracker card. */
export function ReadState({ read, onRetry, what }: { read: TrackerLinksRead; onRetry: () => void; what: string }): React.ReactElement | null {
  if (read.phase === 'loading') return <p className="wk-src-cap" data-testid="trackers-loading">Reading {what}…</p>;
  if (read.phase === 'unreadable') return <p className="wk-src-note wk-src-tone-fail" data-testid="trackers-unreadable">crew’s answer about {what} could not be read, so none is shown: update studio or crew.</p>;
  if (read.phase === 'failed') {
    return (
      <p className="wk-src-note wk-src-tone-fail" data-testid="trackers-failed" data-kind={read.kind}>
        {read.kind === 'offline' ? `crew couldn’t be reached, so ${what} aren’t shown.` : `${read.message} ${what[0]!.toUpperCase()}${what.slice(1)} aren’t shown.`}{' '}
        <button type="button" className="wk-btn wk-btn--quiet wk-btn--sm" onClick={onRetry}>Try again</button>
      </p>
    );
  }
  return null;
}
