import { useEffect, useState } from 'react';
import {
  getProjectCoverage, getProjectDomain, rowWhy,
  type AggregateRead, type ProjectCoverageResponse, type ProjectDomainResponse,
} from '../../api/product.js';
import { coveragePct } from '../CoverageView.js';

/**
 * studio#158: the Settings panels that had no context, back where they mean something. One project,
 * every member repository, read from crew's own folds (crew#371): `GET /projects/:id/coverage` and
 * `GET /projects/:id/domain`. Every member repo is a row, never dropped — an unread one says why in
 * crew's words. A daemon without the routes (an older crew) draws neither section.
 */

const CSS = {
  head: { fontSize: 'var(--text-2xs)', fontWeight: 'var(--weight-bold)', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-muted)', margin: '0 0 8px' },
  list: { display: 'flex', flexDirection: 'column', gap: '2px', background: 'var(--surface-card)', border: '1px solid var(--surface-raised)', borderRadius: 'var(--radius-lg)', padding: '4px', listStyle: 'none', margin: 0 },
  row: { display: 'flex', alignItems: 'baseline', gap: '10px', padding: '6px 8px', fontSize: 'var(--text-xs)', color: 'var(--ink-high)', minWidth: 0 },
  dim: { color: 'var(--ink-dim)' },
  bad: { color: 'var(--status-fail)' },
  line: { fontSize: 'var(--text-xs)', color: 'var(--ink-muted)', margin: '0 0 8px' },
} as const satisfies Record<string, React.CSSProperties>;

/** One read per project id; a later project's answer never lands on the previous one. */
function useAggregate<T>(projectId: string, load: (id: string) => Promise<AggregateRead<T>>): AggregateRead<T> | null {
  const [got, setGot] = useState<{ id: string; read: AggregateRead<T> } | null>(null);
  useEffect(() => {
    let cancelled = false;
    void load(projectId).then((read) => { if (!cancelled) setGot({ id: projectId, read }); });
    return () => { cancelled = true; };
  }, [projectId, load]);
  return got !== null && got.id === projectId ? got.read : null;
}

function RepoLink({ repo, navigate }: { repo: { id: string; name: string | null }; navigate: (p: string) => void }): React.ReactElement {
  const href = `/repo-detail/${encodeURIComponent(repo.id)}`;
  return (
    <a href={href} onClick={(e) => { e.preventDefault(); navigate(href); }} className="wk-since-toggle" style={{ fontWeight: 600 }}>
      {repo.name ?? repo.id}
    </a>
  );
}

/** "Resolved 12 of 40 behavior-bearing nodes (30.0%)", or why there is no ratio. `coverage` is null
 *  when crew's denominator (over the repos it could READ) is 0: either nothing was read, or what was
 *  read has nothing behavior-bearing — two different sentences (codex on #158). A ratio below 1 never
 *  rounds up to 100% (the CoverageView rule, FINDING-009). */
export function coverageTotalsLine(t: ProjectCoverageResponse['totals']): string {
  const repos = `${t.ok} of ${t.repos} ${t.repos === 1 ? 'repository' : 'repositories'} read`;
  if (t.coverage === null) {
    return t.ok === 0
      ? `No repository's coverage could be read, so project coverage is unknown · ${repos}`
      : `The repositories read have nothing behavior-bearing yet, so project coverage is undefined · ${repos}`;
  }
  const shown = t.resolved < t.behavior_bearing && t.coverage * 100 >= 99.95 ? '<100%' : `${(t.coverage * 100).toFixed(1)}%`;
  return `Resolved ${t.resolved} of ${t.behavior_bearing} behavior-bearing nodes (${shown}) · ${repos}`;
}

type SectionProps = { projectId: string; navigate: (p: string) => void };

/** Keyed by the project: a new project is a new section with no answer yet, so A → B → A never shows
 *  A's earlier answer while A is read again (codex on #158). */
export function ProjectCoverage(props: SectionProps): React.ReactElement {
  return <CoverageSection key={props.projectId} {...props} />;
}

export function ProjectDomain(props: SectionProps): React.ReactElement {
  return <DomainSection key={props.projectId} {...props} />;
}

function CoverageSection({ projectId, navigate }: SectionProps): React.ReactElement | null {
  const read = useAggregate<ProjectCoverageResponse>(projectId, getProjectCoverage);
  if (read === null || read.state === 'absent') return null;
  return (
    <section data-testid="project-coverage" data-state={read.state} aria-labelledby="project-coverage-head" style={{ marginBottom: '28px' }}>
      <h2 id="project-coverage-head" style={CSS.head}>Coverage</h2>
      {read.state === 'failed' ? (
        <p data-testid="project-coverage-error" role="alert" style={{ ...CSS.line, ...CSS.bad }}>The project's coverage could not be read — {read.why}</p>
      ) : read.body.rows.length === 0 ? (
        <p data-testid="project-coverage-empty" style={CSS.line}>No repository in this project yet, so there is no coverage to show.</p>
      ) : (
        <>
          <p data-testid="project-coverage-totals" style={CSS.line}>{coverageTotalsLine(read.body.totals)}</p>
          <ul style={CSS.list}>
            {read.body.rows.map((r) => (
              <li key={r.repo.id} data-testid="project-coverage-row" data-repo={r.repo.id} data-state={r.state} style={CSS.row}>
                <RepoLink repo={r.repo} navigate={navigate} />
                {r.state === 'ok' && r.report !== null ? (
                  <span>
                    {coveragePct(r.report)}
                    <span style={CSS.dim}> · resolved {r.report.resolved} of {r.report.behavior_bearing} · {r.report.risk_flagged} risk-flagged · {r.report.unaccounted} unaccounted</span>
                  </span>
                ) : (
                  <span style={r.state === 'error' ? CSS.bad : CSS.dim}>{rowWhy(r)}</span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function DomainSection({ projectId, navigate }: SectionProps): React.ReactElement | null {
  const read = useAggregate<ProjectDomainResponse>(projectId, getProjectDomain);
  if (read === null || read.state === 'absent') return null;
  return (
    <section data-testid="project-domain" data-state={read.state} aria-labelledby="project-domain-head" style={{ marginBottom: '28px' }}>
      <h2 id="project-domain-head" style={CSS.head}>Domain</h2>
      {read.state === 'failed' ? (
        <p data-testid="project-domain-error" role="alert" style={{ ...CSS.line, ...CSS.bad }}>The project's domain model could not be read — {read.why}</p>
      ) : read.body.rows.length === 0 ? (
        <p data-testid="project-domain-empty" style={CSS.line}>No repository in this project yet, so there is no domain model to show.</p>
      ) : (
        <>
          <p data-testid="project-domain-totals" style={CSS.line}>
            {read.body.totals.domains} {read.body.totals.domains === 1 ? 'domain' : 'domains'} · {read.body.totals.requirements} requirements · {read.body.totals.entities} entities · {read.body.totals.ok} of {read.body.totals.repos} {read.body.totals.repos === 1 ? 'repository' : 'repositories'} read
          </p>
          {read.body.merged.length > 0 && (
            <ul data-testid="project-domain-merged" aria-label="Domains across the project" style={{ ...CSS.list, marginBottom: '8px' }}>
              {read.body.merged.map((d) => (
                <li key={d.name} data-testid="project-domain-merged-row" data-domain={d.name} style={CSS.row}>
                  <span style={{ fontWeight: 600 }}>{d.name}</span>
                  <span style={CSS.dim}>{d.requirements} requirements · {d.entities} entities · in {d.repoIds.length} {d.repoIds.length === 1 ? 'repository' : 'repositories'}</span>
                </li>
              ))}
            </ul>
          )}
          <ul aria-label="Domains per repository" style={CSS.list}>
            {read.body.rows.map((r) => (
              <li key={r.repo.id} data-testid="project-domain-row" data-repo={r.repo.id} data-state={r.state} style={CSS.row}>
                <RepoLink repo={r.repo} navigate={navigate} />
                {r.state === 'ok'
                  ? <span style={CSS.dim}>{r.domains.length === 0 ? 'no domains' : r.domains.map((d) => d.name).join(' · ')}</span>
                  : <span style={r.state === 'error' ? CSS.bad : CSS.dim}>{rowWhy(r)}</span>}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
