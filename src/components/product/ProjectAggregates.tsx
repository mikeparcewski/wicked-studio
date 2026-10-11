import { useCallback, useEffect, useState } from 'react';
import {
  getProjectCoverage, getProjectDomain, rowWhy,
  type AggregateRead, type ProjectCoverageResponse,
} from '../../api/product.js';
import { readErrorKind } from '../../api/errors.js';
import { SectionTitle } from '../ui/PageFrame.js';
import { EmptyState, Skeleton, StateBanner } from '../ui/StateBanner.js';
import { StatLine } from '../ui/StatLine.js';
import { TechDetails } from '../ui/TechDetails.js';

/** Nested sections report failures to the page's single banner; standalone sections own theirs. */
export type ProjectReadIssue = { what: string; error: string; retry: () => void };
export type ProjectIssueHandler = (key: string, issue: ProjectReadIssue | null) => void;

function useAggregate<T>(projectId: string, load: (id: string) => Promise<AggregateRead<T>>) {
  const [got, setGot] = useState<{ id: string; read: AggregateRead<T> } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => { setGot(null); setAttempt((n) => n + 1); }, []);
  useEffect(() => {
    let cancelled = false;
    void load(projectId).then((read) => { if (!cancelled) setGot({ id: projectId, read }); });
    return () => { cancelled = true; };
  }, [projectId, load, attempt]);
  return { read: got !== null && got.id === projectId ? got.read : null, retry };
}

function RepoLink({ repo, navigate }: { repo: { id: string; name: string | null }; navigate: (p: string) => void }): React.ReactElement {
  const href = `/repo-detail/${encodeURIComponent(repo.id)}`;
  return <a href={href} onClick={(e) => { e.preventDefault(); navigate(href); }} className="wk-link wk-list-row-title">{repo.name ?? 'Unnamed repository'}</a>;
}

export function coverageTotalsLine(t: ProjectCoverageResponse['totals']): string {
  if (t.coverage === null) return t.ok === 0
    ? 'Coverage is unknown because no repository could be read.'
    : 'No requirements to cover yet in the repositories read.';
  if (t.behavior_bearing === 0 && t.resolved === 0) return '';
  const shown = t.resolved < t.behavior_bearing && t.coverage * 100 >= 99.95 ? '<100%' : `${(t.coverage * 100).toFixed(1)}%`;
  return `${t.resolved} of ${t.behavior_bearing} parts of the code traced to a requirement (${shown}) · ${t.ok} of ${t.repos} ${t.repos === 1 ? 'repository' : 'repositories'} read`;
}

/** Engine reasons belong in the disclosure, with a useful sentence in the default layer. */
export function requirementReadWords(row: { state: string; repo: { name: string | null } }): string {
  const name = row.repo.name ?? 'this repository';
  return row.state === 'absent' ? `No requirements map yet for ${name}.`
    : row.state === 'dangling' ? 'This repository is no longer registered.'
    : `Couldn’t read requirements for ${name}.`;
}

type SectionProps = { projectId: string; navigate: (p: string) => void; onIssue?: ProjectIssueHandler };
export function ProjectCoverage(props: SectionProps): React.ReactElement { return <CoverageSection key={props.projectId} {...props} />; }
export function ProjectDomain(props: SectionProps): React.ReactElement { return <DomainSection key={props.projectId} {...props} />; }

function useIssue(key: string, what: string, error: string | null, retry: () => void, onIssue?: ProjectIssueHandler): void {
  useEffect(() => {
    onIssue?.(key, error === null ? null : { what, error, retry });
    return () => onIssue?.(key, null);
  }, [key, what, error, retry, onIssue]);
}

function CoverageSection({ projectId, navigate, onIssue }: SectionProps): React.ReactElement | null {
  const { read, retry } = useAggregate(projectId, getProjectCoverage);
  const error = read?.state === 'failed' ? read.why : read?.state === 'ok'
    ? read.body.rows.filter((r) => r.state === 'error').map(rowWhy).join('\n') || null : null;
  useIssue('coverage', 'coverage', error, retry, onIssue);
  if (read?.state === 'absent') return null;
  if (read === null) return <Skeleton data-testid="project-coverage-loading" />;
  return (
    <section data-testid="project-coverage" data-state={read.state} aria-label="Coverage" className="wk-card">
      <SectionTitle>Coverage</SectionTitle>
      {error !== null && onIssue === undefined && <StateBanner data-testid="project-coverage-error" kind={readErrorKind(error)} what="coverage" error={error} onRetry={retry} />}
      {read.state === 'failed' ? onIssue !== undefined && <TechDetails data-testid="project-coverage-error" text={read.why} /> : read.body.rows.length === 0 ? (
        <EmptyState data-testid="project-coverage-empty" title="No coverage yet" body="Attach a repository to see which requirements are covered." />
      ) : (
        <>
          {coverageTotalsLine(read.body.totals) !== '' && <p data-testid="project-coverage-totals" className="wk-pg-proj-note">{coverageTotalsLine(read.body.totals)}</p>}
          <ul className="wk-pg-proj-list">
            {read.body.rows.map((r) => {
              const report = r.state === 'ok' ? r.report : null;
              const facts = report !== null ? [
                report.behavior_bearing > 0 ? `${report.resolved} of ${report.behavior_bearing} traced${report.coverage !== null && report.coverage !== undefined ? ` (${(report.coverage * 100).toFixed(1)}%)` : ''}` : '',
                report.risk_flagged > 0 ? `${report.risk_flagged} at risk` : '',
                report.unaccounted > 0 ? `${report.unaccounted} still to check` : '',
              ].filter(Boolean).join(' · ') : '';
              return (
                <li key={r.repo.id} data-testid="project-coverage-row" data-repo={r.repo.id} data-state={r.state} className="wk-list-row wk-pg-proj-row">
                  <div>
                    <RepoLink repo={r.repo} navigate={navigate} />
                    {facts !== '' && <p className="wk-list-row-meta">{facts}</p>}
                    {r.state !== 'ok' && <><p className="wk-list-row-meta">{requirementReadWords(r)}</p><TechDetails text={rowWhy(r)} /></>}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}

function DomainSection({ projectId, navigate, onIssue }: SectionProps): React.ReactElement | null {
  const { read, retry } = useAggregate(projectId, getProjectDomain);
  const error = read?.state === 'failed' ? read.why : read?.state === 'ok'
    ? read.body.rows.filter((r) => r.state === 'error').map(rowWhy).join('\n') || null : null;
  useIssue('domain', 'the domain model', error, retry, onIssue);
  if (read?.state === 'absent') return null;
  if (read === null) return <Skeleton data-testid="project-domain-loading" />;
  return (
    <section data-testid="project-domain" data-state={read.state} aria-label="Domain" className="wk-card">
      <SectionTitle>Domain</SectionTitle>
      {error !== null && onIssue === undefined && <StateBanner data-testid="project-domain-error" kind={readErrorKind(error)} what="the domain model" error={error} onRetry={retry} />}
      {read.state === 'failed' ? onIssue !== undefined && <TechDetails data-testid="project-domain-error" text={read.why} /> : read.body.rows.length === 0 ? (
        <EmptyState data-testid="project-domain-empty" title="No domain model yet" body="Attach a repository to see its domains." />
      ) : (
        <>
          <StatLine data-testid="project-domain-totals" items={[
            { label: 'domains', value: read.body.totals.domains },
            { label: 'requirements', value: read.body.totals.requirements },
            { label: 'entities', value: read.body.totals.entities },
          ]} />
          {read.body.merged.length > 0 && (
            <ul data-testid="project-domain-merged" aria-label="Domains across the project" className="wk-pg-proj-list">
              {read.body.merged.map((d) => (
                <li key={d.name} data-testid="project-domain-merged-row" data-domain={d.name} className="wk-list-row wk-pg-proj-row">
                  <div><span className="wk-list-row-title">{d.name}</span><span className="wk-list-row-meta">{d.requirements} requirements · {d.entities} entities · in {d.repoIds.length} {d.repoIds.length === 1 ? 'repository' : 'repositories'}</span></div>
                </li>
              ))}
            </ul>
          )}
          <ul aria-label="Domains per repository" className="wk-pg-proj-list">
            {read.body.rows.map((r) => (
              <li key={r.repo.id} data-testid="project-domain-row" data-repo={r.repo.id} data-state={r.state} className="wk-list-row wk-pg-proj-row">
                <div><RepoLink repo={r.repo} navigate={navigate} /><p className="wk-list-row-meta">{r.state === 'ok' ? r.domains.length === 0 ? 'No domains yet' : r.domains.map((d) => d.name).join(' · ') : requirementReadWords(r)}</p>
                  {r.state !== 'ok' && <TechDetails text={rowWhy(r)} />}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
