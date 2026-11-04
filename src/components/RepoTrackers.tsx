import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useTrackerLinksSupported } from '../api/trackers.js';
import { projectDetailPath } from '../hooks/useRoute.js';
import { ReadState } from './ProjectTrackers.js';
import { LinkTrackerPicker } from './trackers/LinkTrackerPicker.js';
import { ProjectionPill, RemoveLink, TrackerRow } from './trackers/TrackerParts.js';
import { useTrackerLinks } from './trackers/useTrackerLinks.js';

/** "Billing and Ops", "Billing, Ops and Mobile". */
function andList(names: readonly string[]): string {
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * LINKED TRACKERS on a repository's page (DES-PM-001 §3.2 rule 1, §3.3, mockup screen 3): the trackers linked to the
 * repo, each with Remove, and, BEFORE the person links, the reach of a link here: every project the repo is in ("In 2
 * projects: Billing and Ops"), and any job that works on it. A project's own links never travel through the repo, and
 * the card says so. Everything shown is crew's answer (`GET /tracker-links?repo=`). Hidden on a crew without tracker
 * links.
 */
export function RepoTrackers({ repoId, repoName, navigate }: { repoId: string; repoName: string; navigate: (path: string) => void }): React.ReactElement | null {
  const supported = useTrackerLinksSupported();
  const { read, reload } = useTrackerLinks({ repo: repoId }, supported);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!supported) return null;
  const links = read.phase === 'ok' ? read.links : null;
  const names = links?.projects.map((p) => p.name) ?? [];
  return (
    <>
      <section className="wk-card wk-trk-card" aria-labelledby="wk-trk-repo-title" data-testid="repo-trackers" data-phase={read.phase}>
        <div className="wk-trk-head">
          <h2 id="wk-trk-repo-title" className="wk-section-title">Linked trackers</h2>
          <span className="wk-src-sp" />
          <button type="button" className="wk-btn wk-btn--secondary wk-btn--sm" data-testid="repo-trackers-add" aria-expanded={picking} onClick={() => setPicking((v) => !v)}>
            <Plus size={14} aria-hidden />Link a tracker
          </button>
        </div>
        {links !== null && (
          <p className="wk-trk-rule" data-testid="repo-trackers-reach">
            {names.length === 0
              ? <>This repository is in <b>no project</b> yet. A tracker linked here reaches any job that works on this repository.</>
              : <>This repository is in <b>{names.length === 1 ? `1 project: ${names[0]}` : `${names.length} projects: ${andList(names)}`}</b>. A tracker linked here reaches jobs and chats in {names.length === 1 ? 'it' : names.length === 2 ? 'both' : 'all of them'}, and any job that works on this repository.</>}
          </p>
        )}
        <ReadState read={read} onRetry={() => void reload()} what="this repository’s trackers" />
        {links !== null && links.links.length === 0 && <p className="wk-src-note" data-testid="repo-trackers-empty">No tracker is linked to {repoName} yet.</p>}
        {links?.links.map((l) => (
          <TrackerRow key={l.id} tracker={l} data-testid="repo-tracker" status={<ProjectionPill link={l} />} action={<RemoveLink link={l} onSettled={reload} onError={setError} />} />
        ))}
        {links !== null && <p className="wk-src-note" data-testid="repo-trackers-stay">Trackers linked to a project stay in that project: they never reach another project through this repository.</p>}
        {error !== null && <p role="alert" className="wk-src-note wk-src-tone-fail" data-testid="repo-trackers-error">{error}</p>}
        {picking && <LinkTrackerPicker target={{ kind: 'repo', id: repoId }} targetName={repoName} onLinked={reload} onClose={() => setPicking(false)} navigate={navigate} />}
      </section>
      {links !== null && links.projects.length > 0 && (
        <section className="wk-card wk-trk-card" aria-labelledby="wk-trk-inproj-title" data-testid="repo-trackers-projects">
          <h2 id="wk-trk-inproj-title" className="wk-section-title">In projects</h2>
          <div className="wk-trk-chips">
            {links.projects.map((p) => (
              <a key={p.id} className="wk-trk-chip" href={projectDetailPath(p.id)} onClick={(e) => { e.preventDefault(); navigate(projectDetailPath(p.id)); }}>{p.name}</a>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
