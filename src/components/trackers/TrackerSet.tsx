import { ShieldCheck } from 'lucide-react';
import { trackerTitle, useTrackerLinksSupported, type TrackerLink, type TrackerLinksResponse } from '../../api/trackers.js';
import { ReadState } from '../ProjectTrackers.js';
import { FromTag, TrackerRow } from './TrackerParts.js';
import { useTrackerLinks } from './useTrackerLinks.js';

/** One tracker of a set, with every way it is in it (linked to the project, through one or more repos). */
export interface SetEntry {
  link: TrackerLink;
  viaProject: boolean;
  viaRepos: string[];
  /** The source's Agents switches for this project (`null`: crew said nothing, as for a job in no project). */
  agents: { see: boolean; query: boolean } | null;
}

/**
 * The tracker set as crew answered it (`GET /tracker-links?project=&repo=`), one entry per tracker: what the job or chat
 * can read (its source's switches let the project see it) and what is linked but not included (they don't). Pure: it
 * adds nothing crew did not send.
 */
export function trackerSetOf(r: TrackerLinksResponse): { included: SetEntry[]; excluded: SetEntry[] } {
  const by = new Map<string, SetEntry>();
  const hasProject = r.target.project !== undefined;
  const add = (l: TrackerLink, via: { project: true } | { repo: string }): void => {
    const cur = by.get(l.trackerId);
    const a = r.agents.find((x) => x.source === l.source);
    const e = cur ?? { link: l, viaProject: false, viaRepos: [], agents: a !== undefined ? { see: a.see, query: a.query } : null };
    if ('project' in via) e.viaProject = true;
    else if (!e.viaRepos.includes(via.repo)) e.viaRepos.push(via.repo);
    by.set(l.trackerId, e);
  };
  // Without a project, `links` are the repo's own links (crew answered for the repo alone).
  for (const l of r.links) add(l, hasProject ? { project: true } : { repo: l.target.id });
  for (const l of r.viaRepos) add(l, { repo: l.viaRepo });
  const all = [...by.values()];
  // With a project, crew says per source whether its switches admit it; a source crew said nothing about is not
  // admitted (never assumed in). Without a project crew sends no switches, and the job reads its repo's trackers only
  // from tools set to every project: shown as crew's links, with that rule said beside them.
  if (!hasProject) return { included: all, excluded: [] };
  return { included: all.filter((e) => e.agents?.see === true), excluded: all.filter((e) => e.agents?.see !== true) };
}

/**
 * TRACKERS THIS JOB (OR CHAT) CAN READ (DES-PM-001 §3.2, mockup screen 4): its tracker set as crew computes it, each
 * labelled with where it came from ("linked to Billing", "through repo billing-api"), the binding in one line, and
 * what is linked but not included. Shows only crew's answer for this job's project and repo: nothing is merged in from
 * another card or read. Hidden on a crew without tracker links, or with neither a project nor a repo.
 */
export function TrackerSet({ projectId, projectName, repoId, kind = 'job', 'data-testid': testId = 'tracker-set' }: {
  projectId: string | null;
  projectName: string | null;
  repoId: string | null;
  kind?: 'job' | 'chat';
  'data-testid'?: string;
}): React.ReactElement | null {
  const supported = useTrackerLinksSupported();
  const pid = projectId === 'default' ? null : projectId;
  const enabled = supported && (pid !== null || repoId !== null);
  const { read, reload } = useTrackerLinks({ project: pid, repo: repoId }, enabled);
  if (!enabled) return null;
  const set = read.phase === 'ok' ? trackerSetOf(read.links) : null;
  const who = projectName ?? 'this project';
  return (
    <section className="wk-trk-set" aria-labelledby={`${testId}-title`} data-testid={testId} data-phase={read.phase}>
      <div className="wk-trk-head">
        {/* In no project crew sends no switch decisions, so the list is what is linked, not a count of what is readable. */}
        <h3 id={`${testId}-title`} className="wk-trk-set-title">{pid === null ? 'Trackers linked to its repository' : `Trackers this ${kind} can read`}</h3>
        <span className="wk-src-sp" />
        {set !== null && pid !== null && <span className="wk-tag" data-testid={`${testId}-count`}>{set.included.length}</span>}
      </div>
      <p className="wk-src-note">
        {pid === null ? `This ${kind} is in no project: agents read these only from tools whose Agents switches allow every project, and crew checks that at every call.`
          : kind === 'chat' ? `${who}’s own links, plus the links of its repositories.` : `${who}’s own links, plus the links of the repositories it works on.`}
      </p>
      <ReadState read={read} onRetry={() => void reload()} what={`the trackers this ${kind} can read`} />
      {set !== null && set.included.length === 0 && <p className="wk-src-note" data-testid={`${testId}-empty`}>None: no tracker it may read is linked to {pid !== null ? `${who} or its repositories` : 'its repository'}.</p>}
      {set?.included.map((e) => (
        <TrackerRow
          key={e.link.trackerId}
          tracker={e.link}
          small
          readOnly
          data-testid={`${testId}-item`}
          status={(
            <>
              {e.viaProject && <FromTag via="project">linked to {who}</FromTag>}
              {e.viaRepos.map((r) => <FromTag key={r} via="repo">through repo {r}</FromTag>)}
              {e.agents !== null && !e.agents.query && <span className="wk-tag" data-testid={`${testId}-structure-only`} title="The source’s “Agents can read issues” switch is off.">structure only</span>}
            </>
          )}
        />
      ))}
      {set !== null && set.included.length > 0 && (
        <p className="wk-trk-bound"><ShieldCheck size={14} aria-hidden /><span>Searches are limited to these. An issue outside them is refused, and is dropped from a search before the agent sees it.</span></p>
      )}
      {set !== null && set.excluded.length > 0 && (
        <p className="wk-trk-excl" data-testid={`${testId}-excluded`}>
          <b>Not included:</b>{' '}
          {set.excluded.map((e, i) => (
            <span key={e.link.trackerId}>{i > 0 ? '; ' : ''}{trackerTitle(e.link)} ({e.link.source}) is linked{e.viaProject ? ` to ${who}` : ` through repo ${e.viaRepos[0] ?? ''}`}, but agents in {who} can’t use {e.link.source} yet</span>
          ))}.
        </p>
      )}
    </section>
  );
}
