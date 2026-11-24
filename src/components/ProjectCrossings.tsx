import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { isRouteUnsupported } from '../api/errors.js';
import type {
  ProjectBlastRadiusWire, ProjectGraphBoundaries, ProjectGraphHitWire, ProjectGraphMemberCoverage, ProjectGraphPath,
} from '../api/projectGraph-wire.js';
import type { ProjectGraphCrossing, ProjectGraphRepo } from '../api/types.js';
import { TechDetails } from './ui/TechDetails.js';

/**
 * ACROSS REPOSITORIES (studio#1079, estate#414 slice X3s, the package part): what a change in one member repository
 * crosses into the others, over crew's project graph answers (crew `packages/crew/src/projects/routes.ts`:
 * `/projects/:id/graph/boundaries`, `/graph/blast-radius`, `/graph/path`; written by `projects/graph.ts`).
 *
 * - The links: each member's links in and out as estate counted them (an omitted count is unknown, never 0).
 * - Might also depend: imports estate could not prove are links to another member (crew#1477), listed with estate's
 *   reason and never counted as a dependency.
 * - What depends on a symbol: its dependents in every member, grouped by repository, the crossings the walk took and
 *   each dependent reached through one marked. What the answer could not place is said under it.
 * - A route from one symbol to another, each step attributed with its confidence, a step into another repository
 *   marked, an uncertain route said to be a lead.
 * - The card never says "nothing crosses" unless the links are built, complete and listed in full.
 *
 * Mounted keyed by the graph's build (ProjectCodeGraph), so a refresh rereads the links and drops every earlier
 * answer, and a question asked before it can never land after.
 */

type Read<T> = { state: 'idle' } | { state: 'busy' } | { state: 'done'; value: T } | { state: 'failed'; error: unknown };

const POSSIBLE_SHOWN = 40;
/** Below this a route step is uncertain (estate's own warning line for path confidence). */
const SURE = 0.5;

/** Words for a refusal: crew's own standing sentence when it sent one (a 404 "no graph to ask" carries `status`). */
function refusalWords(e: unknown): string {
  if (isRouteUnsupported(e)) return 'This version of wicked can’t answer questions across repositories. Update wicked to use it.';
  const body = typeof e === 'object' && e !== null ? (e as { body?: unknown }).body : undefined;
  const detail = typeof body === 'object' && body !== null ? (body as { status?: { detail?: unknown } }).status?.detail : undefined;
  if (typeof detail === 'string' && detail !== '') return detail;
  return 'The project graph couldn’t answer.';
}
const techOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

function coverageWords(m: ProjectGraphMemberCoverage): string {
  const parts: string[] = [];
  if (typeof m.links_out === 'number') parts.push(`${plural(m.links_out, 'link', 'links')} out`);
  if (typeof m.links_in === 'number') parts.push(`${plural(m.links_in, 'link', 'links')} in`);
  if (parts.length === 0) parts.push('links not counted');
  if (m.incomplete === true) parts.push('linking incomplete');
  return `${m.repo}: ${parts.join(', ')}`;
}

/** A crossing in words: a package link names its package; another kind (HTTP, a contract) names its steps. */
function crossingWords(c: ProjectGraphCrossing): string {
  const ev = c.evidence ?? {};
  const pkg = typeof ev.package === 'string' ? ev.package : null;
  const kinds = [...new Set((c.hops ?? []).map((h) => h.kind))].join(', ');
  const how = [
    typeof ev.identity === 'string' ? `matched by ${ev.identity}` : null,
    typeof ev.confidence === 'number' ? `confidence ${ev.confidence}` : null,
    typeof ev.skew === 'string' && ev.skew !== '' ? `version skew ${ev.skew}` : null,
  ].filter((x): x is string => x !== null);
  const through = pkg !== null ? ` through package ${pkg}` : kinds !== '' ? ` by ${kinds}` : '';
  return `${c.from.repo} → ${c.to.repo}${through}${how.length > 0 ? ` (${how.join(', ')})` : ''}`;
}

/** crew marks the links stale when a member changed since they were built or the last linking step failed. */
function staleWords(labels: readonly string[] | undefined): string {
  const named = labels !== undefined && labels.length > 0 ? ` (${labels.join(', ')})` : '';
  return `The links between repositories are out of date${named}: a repository changed since they were built, or the last linking step failed. A crossing may be missing. Refresh the code graph to relink them.`;
}

/** What one answer knows about the links: from the answer's own coverage, else the links card. */
interface LinkView {
  /** The links were published (a link generation above 0); `false` = never; `null` = unknown. */
  built: boolean | null;
  /** Every member's coverage carries estate's own link counts and none is incomplete. Rows crew fills in without
   *  estate's numbers (a member estate did not report) prove nothing, so they leave this false. */
  complete: boolean;
  incomplete: string[];
  /** The links card already said they are stale. */
  staleSaid: boolean;
  /** Member id → label, cause and remedy (ProjectGraphStatus.repos). */
  members: ReadonlyMap<string, ProjectGraphRepo>;
}

const counted = (m: ProjectGraphMemberCoverage): boolean => typeof m.links_in === 'number' || typeof m.links_out === 'number';

function linkViewOf(answerCoverage: ProjectGraphMemberCoverage[] | undefined, b: ProjectGraphBoundaries | null, members: ReadonlyMap<string, ProjectGraphRepo>): LinkView {
  const coverage = answerCoverage ?? (b?.linked === true ? b.members : undefined) ?? [];
  // codex r2: crew answers `linked: true` for any link status estate holds, and estate records generation 0 after a
  // first link that published nothing. Built means a generation above 0 (or counted coverage on the answer itself).
  const built = b !== null
    ? b.linked && typeof b.generation === 'number' ? b.generation > 0 : b.linked ? (coverage.some(counted) ? true : null) : false
    : coverage.some(counted) ? true : null;
  const incomplete = coverage.filter((m) => m.incomplete === true).map((m) => m.repo);
  const complete = coverage.length > 0 && coverage.every((m) => counted(m) && m.incomplete !== true);
  return { built, complete, incomplete, staleSaid: b?.stale === true, members };
}

/** `missingRepos` are member ids; each is said with its label and crew's own cause and remedy for it. */
function missingWords(ids: readonly string[], members: ReadonlyMap<string, ProjectGraphRepo>): string {
  const names = ids.map((id) => {
    const m = members.get(id);
    return `${m?.label ?? id}${typeof m?.reason === 'string' && m.reason !== '' ? ` (${m.reason})` : ''}`;
  });
  const remedies = [...new Set(ids.map((id) => members.get(id)?.remedy).filter((x): x is string => typeof x === 'string' && x !== ''))];
  return `Not searched: ${names.join(', ')}.${remedies.length > 0 ? ` ${remedies.join(' ')}` : ''}`;
}

export function ProjectCrossings({ projectId, repos = [] }: { projectId: string; repos?: readonly ProjectGraphRepo[] }): React.ReactElement {
  const [bounds, setBounds] = useState<Read<ProjectGraphBoundaries>>({ state: 'idle' });
  const [blast, setBlast] = useState<Read<ProjectBlastRadiusWire>>({ state: 'idle' });
  const [path, setPath] = useState<Read<ProjectGraphPath>>({ state: 'idle' });
  const [name, setName] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [allPossible, setAllPossible] = useState(false);
  // Every answer is fenced to the project and the question it was asked for: a late one never lands on another.
  const gen = useRef({ bounds: 0, blast: 0, path: 0 });
  const members = new Map(repos.map((r) => [r.repoId, r]));

  useEffect(() => {
    const g = ++gen.current.bounds;
    gen.current.blast++;
    gen.current.path++;
    setBounds({ state: 'busy' });
    setBlast({ state: 'idle' });
    setPath({ state: 'idle' });
    setAllPossible(false);
    api.getProjectGraphBoundaries(projectId).then(
      (value) => { if (gen.current.bounds === g) setBounds({ state: 'done', value }); },
      (error: unknown) => { if (gen.current.bounds === g) setBounds({ state: 'failed', error }); },
    );
  }, [projectId]);

  const askBlast = (e: React.FormEvent): void => {
    e.preventDefault();
    const q = name.trim();
    if (q === '') return;
    const g = ++gen.current.blast;
    setBlast({ state: 'busy' });
    api.getProjectBlastRadius(projectId, q).then(
      (value) => { if (gen.current.blast === g) setBlast({ state: 'done', value }); },
      (error: unknown) => { if (gen.current.blast === g) setBlast({ state: 'failed', error }); },
    );
  };
  const askPath = (e: React.FormEvent): void => {
    e.preventDefault();
    const a = from.trim();
    const b = to.trim();
    if (a === '' || b === '') return;
    const g = ++gen.current.path;
    setPath({ state: 'busy' });
    api.getProjectGraphPath(projectId, a, b).then(
      (value) => { if (gen.current.path === g) setPath({ state: 'done', value }); },
      (error: unknown) => { if (gen.current.path === g) setPath({ state: 'failed', error }); },
    );
  };

  const b = bounds.state === 'done' ? bounds.value : null;
  const possible = b?.possible ?? [];
  const possibleTotal = b?.possible_total ?? possible.length;
  const view = (coverage: ProjectGraphMemberCoverage[] | undefined): LinkView => linkViewOf(coverage, b, members);

  return (
    <section data-testid="project-crossings" className="wk-pg-proj-stack" aria-labelledby="project-crossings-title">
      <p id="project-crossings-title" className="wk-list-row-title">Across repositories</p>

      {bounds.state === 'busy' && <p className="wk-field-note">Reading the links between repositories…</p>}
      {bounds.state === 'failed' && (
        <div data-testid="project-crossings-links-error">
          <p className="wk-field-note">{refusalWords(bounds.error)}</p>
          {!isRouteUnsupported(bounds.error) && <TechDetails text={techOf(bounds.error)} />}
        </div>
      )}
      {b !== null && !b.linked && (
        <div data-testid="project-crossings-unlinked">
          <p className="wk-field-note">The repositories in this project aren’t linked yet, so no answer here crosses from one into another. Refresh the code graph to link them (it needs wicked-estate 0.34 or later).</p>
          <TechDetails text={b.note} />
        </div>
      )}
      {b !== null && b.linked && (
        <>
          {b.stale === true && <p data-testid="project-crossings-stale" role="status" className="wk-field-note">{staleWords(b.stale_labels)}</p>}
          <ul data-testid="project-crossings-links" className="wk-list-row-meta" aria-label="Links per repository">
            {b.members.map((m) => <li key={m.repoId}>{coverageWords(m)}</li>)}
          </ul>
          {typeof b.last_error === 'string' && b.last_error !== '' && (
            <div><p className="wk-field-note">The last linking step failed; these are the links from before it.</p><TechDetails text={b.last_error} /></div>
          )}
          {possibleTotal > 0 && (
            <div data-testid="project-crossings-possible">
              <p className="wk-field-note">
                Might also depend on another repository: {plural(possibleTotal, 'import', 'imports')} estate couldn’t prove {possibleTotal === 1 ? 'is a link' : 'are links'}, so {possibleTotal === 1 ? 'it is' : 'they are'} not counted as dependencies.
              </p>
              <ul className="wk-list-row-meta" aria-label="Imports that might also depend on another repository">
                {(allPossible ? possible : possible.slice(0, POSSIBLE_SHOWN)).map((p) => (
                  <li key={`${p.repoId}\u0000${p.reason}\u0000${p.package}`}>{p.repo} imports <span className="font-mono">{p.package}</span> <span className="font-mono">({p.reason})</span></li>
                ))}
              </ul>
              {!allPossible && possible.length > POSSIBLE_SHOWN && (
                <button type="button" data-testid="project-crossings-possible-all" className="wk-btn wk-btn--quiet wk-btn--sm" onClick={() => setAllPossible(true)}>
                  Show all {possible.length}{b.possible_truncated === true ? ' listed' : ''}
                </button>
              )}
              {b.possible_truncated === true && <p className="wk-field-note">The daemon listed {possible.length} of {possibleTotal}.</p>}
            </div>
          )}
        </>
      )}

      <form className="wk-pg-proj-actions" style={{ alignItems: 'flex-end' }} onSubmit={askBlast}>
        <label className="wk-pg-proj-field">What depends on this symbol, in every repository
          <input data-testid="project-crossings-name" className="wk-field" value={name} onChange={(e) => setName(e.target.value)} placeholder="Exact symbol name" />
        </label>
        <button type="submit" data-testid="project-crossings-ask" className="wk-btn wk-btn--secondary wk-btn--sm" disabled={name.trim() === '' || blast.state === 'busy'}>
          {blast.state === 'busy' ? 'Looking…' : 'Find dependents'}
        </button>
      </form>
      <div role="status" aria-live="polite">
        {blast.state === 'failed' && (
          <div data-testid="project-crossings-blast-error">
            <p className="wk-field-note">{refusalWords(blast.error)}</p>
            {!isRouteUnsupported(blast.error) && <TechDetails text={techOf(blast.error)} />}
          </div>
        )}
        {blast.state === 'done' && <BlastAnswer answer={blast.value} links={view(blast.value.coverage)} />}
      </div>

      <p id="project-crossings-route-title" className="wk-list-row-meta">How one symbol reaches another, across repositories</p>
      <form className="wk-pg-proj-actions" style={{ alignItems: 'flex-end' }} onSubmit={askPath} aria-labelledby="project-crossings-route-title">
        <label className="wk-pg-proj-field">From
          <input data-testid="project-crossings-from" className="wk-field" value={from} onChange={(e) => setFrom(e.target.value)} placeholder="Exact symbol name" />
        </label>
        <label className="wk-pg-proj-field">To
          <input data-testid="project-crossings-to" className="wk-field" value={to} onChange={(e) => setTo(e.target.value)} placeholder="Exact symbol name" />
        </label>
        <button type="submit" data-testid="project-crossings-route" className="wk-btn wk-btn--secondary wk-btn--sm" disabled={from.trim() === '' || to.trim() === '' || path.state === 'busy'}>
          {path.state === 'busy' ? 'Looking…' : 'Find a route'}
        </button>
      </form>
      <div role="status" aria-live="polite">
        {path.state === 'failed' && (
          <div data-testid="project-crossings-path-error">
            <p className="wk-field-note">{refusalWords(path.error)}</p>
            {!isRouteUnsupported(path.error) && <TechDetails text={techOf(path.error)} />}
          </div>
        )}
        {path.state === 'done' && <PathAnswer answer={path.value} links={view(path.value.coverage)} />}
      </div>
    </section>
  );
}

/** Why an answer may miss what crosses: links not built, unknown, or incomplete. */
function linkGaps(l: LinkView): string[] {
  const out: string[] = [];
  if (l.built === false) out.push('The repositories aren’t linked, so nothing reached through another repository could be followed.');
  if (l.built === null) out.push('Whether the repositories are linked couldn’t be read, so a crossing may be missing.');
  if (l.incomplete.length > 0) out.push(`Linking is incomplete for ${l.incomplete.join(', ')}, so a crossing may be missing.`);
  else if (l.built === true && !l.complete) out.push('Whether linking covered every repository isn’t known, so a crossing may be missing.');
  return out;
}

/** Why the index may be behind what is on disk (estate's freshness). */
function freshnessWords(fresh: ProjectBlastRadiusWire['freshness']): string[] {
  const out: string[] = [];
  if (fresh === undefined) return out;
  // codex r2: crew sums the total over answer pages, so one file can count more than once.
  if (fresh.stale_files_total > 0) out.push(`Files have changed since they were indexed (${fresh.stale_files_total_partial === true ? 'up to ' : ''}${fresh.stale_files_total} counted; a file can count more than once).`);
  if (typeof fresh.unindexed_files === 'number' && fresh.unindexed_files > 0) out.push(`${plural(fresh.unindexed_files, 'file isn’t', 'files aren’t')} indexed yet, so symbols and dependents in ${fresh.unindexed_files === 1 ? 'it' : 'them'} are missing.`);
  if (typeof fresh.commits_behind === 'number' && fresh.commits_behind > 0) out.push(`The index is ${plural(fresh.commits_behind, 'commit', 'commits')} behind.`);
  // codex r2: estate's marker stays after an interrupted index too.
  if (Array.isArray(fresh.indexing) && fresh.indexing.length > 0) out.push(`Indexing is running or was interrupted for ${fresh.indexing.join(', ')}.`);
  return out;
}

function Changed({ fresh }: { fresh: ProjectBlastRadiusWire['freshness'] }): React.ReactElement | null {
  const words = freshnessWords(fresh);
  return words.length === 0 ? null : <p data-testid="project-crossings-blast-changed" className="wk-field-note">{words.join(' ')} This answer may be out of date; refresh the code graph.</p>;
}

function BlastAnswer({ answer: a, links }: { answer: ProjectBlastRadiusWire; links: LinkView }): React.ReactElement {
  const searched = a.reposSearched.length > 0 ? ` (${a.reposSearched.join(', ')})` : '';
  const stale = a.link_stale === true && !links.staleSaid
    ? <p data-testid="project-crossings-blast-stale" className="wk-field-note">{staleWords(a.link_stale_labels)}</p> : null;
  if (a.resolved === false) {
    return (
      <div data-testid="project-crossings-blast" data-resolved="false">
        <Changed fresh={a.freshness} />
        <p className="wk-field-note">No symbol is named {a.target} in the repositories searched{searched}. The name must match exactly.</p>
        {a.missingRepos.length > 0 && <p data-testid="project-crossings-blast-missing" className="wk-field-note">{missingWords(a.missingRepos, links.members)}</p>}
        {stale}
      </div>
    );
  }
  const crossings = a.crossings ?? [];
  const byRepo = new Map<string, ProjectGraphHitWire[]>();
  for (const d of a.dependents) byRepo.set(d.repo, [...(byRepo.get(d.repo) ?? []), d]);
  const listedCrossings = new Set(crossings.map((c) => c.id));
  const crossingsTotal = Math.max(a.crossings_total ?? crossings.length, crossings.length);
  const reachedThrough = (d: ProjectGraphHitWire): boolean => d.via_crossing !== undefined || d.via_crossing_omitted === true;
  const omittedVia = a.dependents.filter((d) => d.via_crossing_omitted === true || (d.via_crossing !== undefined && !listedCrossings.has(d.via_crossing))).length;
  // "Nothing crosses" is said only when the links are built and complete, none was taken, and none is unlisted.
  const noneCrossed = crossingsTotal === 0 && a.crossings_truncated !== true && !a.dependents.some(reachedThrough) && links.built === true && links.complete;

  const unplaced: string[] = [];
  if (a.missingRepos.length > 0) unplaced.push(missingWords(a.missingRepos, links.members));
  unplaced.push(...linkGaps(links));
  if (crossingsTotal > crossings.length || a.crossings_truncated === true) {
    unplaced.push(`${plural(crossingsTotal, 'crossing was', 'crossings were')} taken; ${crossings.length} ${crossings.length === 1 ? 'is' : 'are'} listed.`);
  }
  if (omittedVia > 0) unplaced.push(`${plural(omittedVia, 'dependent was', 'dependents were')} reached through a crossing that is not listed.`);
  if (a.depth_horizon_reached === true) unplaced.push(`The search stopped at ${typeof a.searched_depth === 'number' ? plural(a.searched_depth, 'hop', 'hops') : 'its hop limit'}; more dependents lie beyond it.`);
  if (a.node_cap_reached === true) unplaced.push('The search reached its size limit, so some dependents are missing.');
  if (typeof a.truncated_dependents === 'number' && a.truncated_dependents > 0) unplaced.push(`${plural(a.truncated_dependents, 'more dependent was', 'more dependents were')} left out of the answer to fit its size.`);
  if (a.unresolved > 0) unplaced.push(`${plural(a.unresolved, 'reference', 'references')} to it couldn’t be placed on any symbol, so the impact may be larger.`);

  return (
    <div data-testid="project-crossings-blast" data-linkage={a.linkage} className="wk-pg-proj-stack">
      {stale}
      <Changed fresh={a.freshness} />
      <p className="wk-list-row-meta">
        {a.dependents.length === 0
          ? `Nothing found that depends on ${a.target} in the repositories searched${searched}.`
          : `${plural(a.dependents.length, 'dependent', 'dependents')} of ${a.target} in ${plural(byRepo.size, 'repository', 'repositories')}: ${[...byRepo].map(([r, ds]) => `${r} ${ds.length}`).join(' · ')}`}
      </p>
      {crossings.length > 0 && (
        <div>
          <p className="wk-list-row-title">Crossings between repositories</p>
          <ul data-testid="project-crossings-crossings" className="wk-list-row-meta" aria-label="Crossings between repositories">
            {crossings.map((c) => <li key={c.id} data-testid="project-crossings-crossing">{crossingWords(c)}</li>)}
          </ul>
        </div>
      )}
      {noneCrossed && a.dependents.length > 0 && (
        <p data-testid="project-crossings-none" className="wk-field-note">No crossing between repositories was taken: each repository’s dependents are its own.</p>
      )}
      {[...byRepo].map(([repo, deps]) => (
        <div key={repo} data-testid="project-crossings-repo" data-repo={repo}>
          <p className="wk-list-row-title">{repo}</p>
          <ul className="wk-list-row-meta" aria-label={`Dependents in ${repo}`}>
            {deps.map((d) => (
              <li key={d.id}>
                <span className="font-mono">{d.name}</span> <span className="font-mono" style={{ overflowWrap: 'anywhere' }}>{d.file}:{d.line}</span>
                {reachedThrough(d) && <span data-testid="project-crossings-via"> · reached from another repository</span>}
                {d.stale !== undefined && <span> · file {d.stale} since indexed</span>}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {unplaced.length > 0 && (
        <div data-testid="project-crossings-unplaced" className="wk-field-note">
          <p>What this answer couldn’t place:</p>
          <ul>{unplaced.map((u) => <li key={u}>{u}</li>)}</ul>
        </div>
      )}
    </div>
  );
}

function PathAnswer({ answer: p, links }: { answer: ProjectGraphPath; links: LinkView }): React.ReactElement {
  const bounded = p.depth_bounded || p.node_bounded;
  const stale = p.link_stale === true && !links.staleSaid ? <p className="wk-field-note">{staleWords(p.link_stale_labels)}</p> : null;
  const missing = p.missingRepos.length > 0 ? <p className="wk-field-note">{missingWords(p.missingRepos, links.members)}</p> : null;
  if (!p.found) {
    const why = p.unresolved !== null
      ? `No symbol is named ${p.unresolved === 'from' ? p.from : p.to} in the repositories searched. The name must match exactly.`
      : p.excluded !== undefined
        ? 'The route found runs through a repository that is no longer in this project. Refresh the code graph.'
        : `No route from ${p.from} to ${p.to} was found in the repositories searched.${bounded ? ' The search stopped at its depth or size limit, so a longer route may still exist.' : ''}`;
    return (
      <div data-testid="project-crossings-path" data-found="false">
        {stale}
        <p className="wk-field-note">{why}</p>
        {p.unresolved === null && p.excluded === undefined && linkGaps(links).map((g) => <p key={g} className="wk-field-note">{g}</p>)}
        {missing}
      </div>
    );
  }
  const unsure = p.hops.filter((h) => typeof h.confidence === 'number' && h.confidence < SURE).length;
  return (
    <div data-testid="project-crossings-path" data-found="true" className="wk-pg-proj-stack">
      {stale}
      {p.hops.length === 0 ? (
        <p data-testid="project-crossings-path-same" className="wk-field-note">{p.from} and {p.to} were found at the same symbol, so there is no step between them.</p>
      ) : (
        <ol className="wk-list-row-meta" aria-label={`Route from ${p.from} to ${p.to}`}>
          {p.hops.map((h, i) => (
            <li key={i} data-testid="project-crossings-hop" data-crosses={h.source.repo !== h.target.repo ? 'true' : 'false'}>
              <span className="font-mono">{h.source.name}</span> ({h.source.repo}, <span className="font-mono">{h.source.file}:{h.source.line}</span>) {h.kind}{' '}
              <span className="font-mono">{h.target.name}</span> ({h.target.repo}, <span className="font-mono">{h.target.file}:{h.target.line}</span>)
              {typeof h.confidence === 'number' && <span> · confidence {h.confidence}</span>}
              {h.source.repo !== h.target.repo && <span> · crosses into {h.target.repo}</span>}
            </li>
          ))}
        </ol>
      )}
      {unsure > 0 && (
        <p data-testid="project-crossings-path-unsure" className="wk-field-note">
          {plural(unsure, 'step is', 'steps are')} uncertain (confidence under {SURE}): treat this route as a lead to check, not as proof.
        </p>
      )}
      {(p.crossings ?? []).length > 0 && (
        <ul className="wk-list-row-meta" aria-label="Crossings on this route">
          {(p.crossings ?? []).map((c) => <li key={c.id}>{crossingWords(c)}</li>)}
        </ul>
      )}
      {missing}
    </div>
  );
}
