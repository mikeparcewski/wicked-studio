import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { isRouteUnsupported } from '../api/errors.js';
import type {
  ProjectBlastRadiusWire, ProjectGraphBoundaries, ProjectGraphHitWire, ProjectGraphMemberCoverage, ProjectGraphPath,
} from '../api/projectGraph-wire.js';
import type { ProjectGraphCrossing } from '../api/types.js';
import { TechDetails } from './ui/TechDetails.js';

/**
 * ACROSS REPOSITORIES (studio#1079, estate#414 slice X3s, the package part): what a change in one member repository
 * crosses into the others, over crew's project graph answers (crew `packages/crew/src/projects/routes.ts`:
 * `/projects/:id/graph/boundaries`, `/graph/blast-radius`, `/graph/path`; written by `projects/graph.ts`).
 *
 * - The links: each member's package links in and out as estate counted them (an omitted count is unknown, never 0).
 * - Might also depend: imports estate could not prove are links to another member (crew#1477), listed with estate's
 *   reason and never drawn as a dependency.
 * - What depends on a symbol: its dependents in every member, grouped by repository, with the package crossings the
 *   walk took and each dependent reached through one marked. What the answer could not place is said under it: a
 *   member not searched, a crossing past the listed cap, the walk's own limits, references no resolver bound.
 * - A route from one symbol to another, each step attributed, a step into another repository marked.
 * - Stale links (a member re-indexed since the last link) and changed files are said above the answers they weaken.
 *
 * HTTP crossings and contracts (estate X2/X3) arrive through the same `crossings` field and render here unchanged.
 */

type Read<T> = { state: 'idle' } | { state: 'busy' } | { state: 'done'; value: T } | { state: 'failed'; error: unknown };

const POSSIBLE_SHOWN = 40;

/** Words for a refusal: crew's own standing sentence when it sent one (a 404 "no graph to ask" carries `status`). */
function refusalWords(e: unknown): string {
  if (isRouteUnsupported(e)) return 'This version of wicked can’t answer questions across repositories. Update wicked to use it.';
  const body = (e as { body?: unknown }).body;
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

function crossingWords(c: ProjectGraphCrossing): string {
  const ev = c.evidence ?? {};
  const pkg = typeof ev.package === 'string' ? ev.package : null;
  const how = [
    typeof ev.identity === 'string' ? `matched by ${ev.identity}` : null,
    typeof ev.confidence === 'number' ? `confidence ${ev.confidence}` : null,
    typeof ev.skew === 'string' && ev.skew !== '' ? `version skew ${ev.skew}` : null,
  ].filter((x): x is string => x !== null);
  return `${c.from.repo} → ${c.to.repo}${pkg !== null ? ` through package ${pkg}` : ''}${how.length > 0 ? ` (${how.join(', ')})` : ''}`;
}

/** The stale-links sentence, shared by every answer that carries it. */
function staleWords(labels: readonly string[] | undefined): string {
  const named = labels !== undefined && labels.length > 0 ? ` (${labels.join(', ')} changed since)` : '';
  return `The links between repositories are older than the latest index${named}, so a crossing may be missing. Refresh the code graph to relink them.`;
}

export function ProjectCrossings({ projectId }: { projectId: string }): React.ReactElement {
  const [bounds, setBounds] = useState<Read<ProjectGraphBoundaries>>({ state: 'idle' });
  const [blast, setBlast] = useState<Read<ProjectBlastRadiusWire>>({ state: 'idle' });
  const [path, setPath] = useState<Read<ProjectGraphPath>>({ state: 'idle' });
  const [name, setName] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [allPossible, setAllPossible] = useState(false);
  // Every answer is fenced to the project and the question it was asked for: a late one never lands on another.
  const gen = useRef({ bounds: 0, blast: 0, path: 0 });

  useEffect(() => {
    const g = ++gen.current.bounds;
    gen.current.blast++;
    gen.current.path++;
    setBounds({ state: 'busy' });
    setBlast({ state: 'idle' });
    setPath({ state: 'idle' });
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
          <ul data-testid="project-crossings-links" className="wk-list-row-meta">
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
              <ul className="wk-list-row-meta">
                {(allPossible ? possible : possible.slice(0, POSSIBLE_SHOWN)).map((p) => (
                  <li key={`${p.repo}\u0000${p.reason}\u0000${p.package}`}>{p.repo} imports <span className="font-mono">{p.package}</span> <span className="font-mono">({p.reason})</span></li>
                ))}
              </ul>
              {!allPossible && possible.length > POSSIBLE_SHOWN && (
                <button type="button" data-testid="project-crossings-possible-all" className="wk-btn wk-btn--quiet wk-btn--sm" onClick={() => setAllPossible(true)}>
                  Show all {possible.length}
                </button>
              )}
              {b.possible_truncated === true && <p className="wk-field-note">The daemon listed {possible.length} of {possibleTotal}.</p>}
            </div>
          )}
        </>
      )}

      <form className="wk-pg-proj-actions" onSubmit={askBlast}>
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
        {blast.state === 'done' && <BlastAnswer answer={blast.value} />}
      </div>

      <form className="wk-pg-proj-actions" onSubmit={askPath}>
        <label className="wk-pg-proj-field">How one symbol reaches another: from
          <input data-testid="project-crossings-from" className="wk-field" value={from} onChange={(e) => setFrom(e.target.value)} placeholder="Exact symbol name" />
        </label>
        <label className="wk-pg-proj-field">to
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
        {path.state === 'done' && <PathAnswer answer={path.value} />}
      </div>
    </section>
  );
}

function BlastAnswer({ answer: a }: { answer: ProjectBlastRadiusWire }): React.ReactElement {
  if (a.resolved === false) {
    return <p data-testid="project-crossings-blast" data-resolved="false" className="wk-field-note">No symbol is named {a.target} in this project. The name must match exactly.</p>;
  }
  const crossings = a.crossings ?? [];
  const byRepo = new Map<string, ProjectGraphHitWire[]>();
  for (const d of a.dependents) byRepo.set(d.repo, [...(byRepo.get(d.repo) ?? []), d]);
  const listedCrossings = new Set(crossings.map((c) => c.id));
  const crossingsTotal = a.crossings_total ?? crossings.length;
  const omittedVia = a.dependents.filter((d) => d.via_crossing_omitted === true || (d.via_crossing !== undefined && !listedCrossings.has(d.via_crossing))).length;

  const unplaced: string[] = [];
  if (a.missingRepos.length > 0) unplaced.push(`Not searched: ${a.missingRepos.join(', ')} (not in the project graph yet; refresh it).`);
  if (crossingsTotal > crossings.length || a.crossings_truncated === true) {
    unplaced.push(`${plural(crossingsTotal, 'crossing was', 'crossings were')} taken; ${crossings.length} ${crossings.length === 1 ? 'is' : 'are'} listed.`);
  }
  if (omittedVia > 0) unplaced.push(`${plural(omittedVia, 'dependent was', 'dependents were')} reached through a crossing that is not listed.`);
  if (a.depth_horizon_reached === true) unplaced.push(`The search stopped at ${typeof a.searched_depth === 'number' ? plural(a.searched_depth, 'hop', 'hops') : 'its hop limit'}; more dependents lie beyond it.`);
  if (a.node_cap_reached === true) unplaced.push('The search reached its size limit, so some dependents are missing.');
  if (typeof a.truncated_dependents === 'number' && a.truncated_dependents > 0) unplaced.push(`${plural(a.truncated_dependents, 'more dependent was', 'more dependents were')} left out of the answer to fit its size.`);
  if (a.unresolved > 0) unplaced.push(`${plural(a.unresolved, 'reference', 'references')} to it couldn’t be placed on any symbol, so the impact may be larger.`);

  const fresh = a.freshness;
  const changed = fresh !== undefined && fresh.stale_files_total > 0
    ? `${fresh.stale_files_total_partial === true ? 'Up to ' : ''}${plural(fresh.stale_files_total, 'file has', 'files have')} changed since ${fresh.stale_files_total === 1 ? 'it was' : 'they were'} indexed, so this answer may be out of date.`
    : null;

  return (
    <div data-testid="project-crossings-blast" data-linkage={a.linkage} className="wk-pg-proj-stack">
      {a.link_stale === true && <p data-testid="project-crossings-blast-stale" className="wk-field-note">{staleWords(a.link_stale_labels)}</p>}
      {changed !== null && <p data-testid="project-crossings-blast-changed" className="wk-field-note">{changed}</p>}
      <p className="wk-list-row-meta">
        {a.dependents.length === 0
          ? `Nothing found that depends on ${a.target}.`
          : `${plural(a.dependents.length, 'dependent', 'dependents')} of ${a.target} in ${plural(byRepo.size, 'repository', 'repositories')}: ${a.byRepo.map((r) => `${r.repo} ${r.count}`).join(' · ')}`}
      </p>
      {crossings.length > 0 ? (
        <ul data-testid="project-crossings-crossings" className="wk-list-row-meta">
          {crossings.map((c) => <li key={c.id} data-testid="project-crossings-crossing">{crossingWords(c)}</li>)}
        </ul>
      ) : (
        <p data-testid="project-crossings-none" className="wk-field-note">No package link between repositories was crossed: each repository’s dependents are its own.</p>
      )}
      {[...byRepo].map(([repo, deps]) => (
        <div key={repo} data-testid="project-crossings-repo" data-repo={repo}>
          <p className="wk-list-row-title">{repo}</p>
          <ul className="wk-list-row-meta">
            {deps.map((d) => (
              <li key={d.id}>
                <span className="font-mono">{d.name}</span> <span className="font-mono" style={{ overflowWrap: 'anywhere' }}>{d.file}:{d.line}</span>
                {d.via_crossing !== undefined && <span data-testid="project-crossings-via"> · through a package link</span>}
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

function PathAnswer({ answer: p }: { answer: ProjectGraphPath }): React.ReactElement {
  const limits = p.depth_bounded || p.node_bounded;
  if (!p.found) {
    const why = p.unresolved !== null
      ? `No symbol is named ${p.unresolved === 'from' ? p.from : p.to} in this project. The name must match exactly.`
      : p.excluded !== undefined
        ? `The route found runs through a repository that is no longer in this project. Refresh the code graph.`
        : `No route from ${p.from} to ${p.to} in this project.${limits ? ' The search stopped at its depth or size limit, so a longer route may still exist.' : ''}`;
    return (
      <div data-testid="project-crossings-path" data-found="false">
        {p.link_stale === true && <p className="wk-field-note">{staleWords(p.link_stale_labels)}</p>}
        <p className="wk-field-note">{why}</p>
        {p.missingRepos.length > 0 && <p className="wk-field-note">Not searched: {p.missingRepos.join(', ')}.</p>}
      </div>
    );
  }
  return (
    <div data-testid="project-crossings-path" data-found="true" className="wk-pg-proj-stack">
      {p.link_stale === true && <p className="wk-field-note">{staleWords(p.link_stale_labels)}</p>}
      <ol className="wk-list-row-meta">
        {p.hops.map((h, i) => (
          <li key={i} data-testid="project-crossings-hop" data-crosses={h.source.repo !== h.target.repo ? 'true' : 'false'}>
            <span className="font-mono">{h.source.name}</span> ({h.source.repo}, <span className="font-mono">{h.source.file}:{h.source.line}</span>) {h.kind}{' '}
            <span className="font-mono">{h.target.name}</span> ({h.target.repo}, <span className="font-mono">{h.target.file}:{h.target.line}</span>)
            {h.source.repo !== h.target.repo && <span> · crosses into {h.target.repo}</span>}
          </li>
        ))}
      </ol>
      {p.missingRepos.length > 0 && <p className="wk-field-note">Not searched: {p.missingRepos.join(', ')}.</p>}
    </div>
  );
}
