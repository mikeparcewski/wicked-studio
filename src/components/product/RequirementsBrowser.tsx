import { useEffect, useState } from 'react';
import {
  getProjectRequirements, rowWhy,
  type AggregateRead, type ProjectRequirementsResponse, type RequirementSummary,
} from '../../api/product.js';
import { readErrorKind } from '../../api/errors.js';
import { StateBanner, Skeleton, EmptyState } from '../ui/StateBanner.js';
import { Switch } from '../ui/Switch.js';
import { TechDetails } from '../ui/TechDetails.js';
import { requirementReadWords } from './ProjectAggregates.js';

/** At most this many requirements one draft takes (crew#372's compose cap). */
export const COMPOSE_MAX = 40;
const PAGE = 50;

/** One chosen requirement: the repository it lives in, its key, and its title for the summary. */
export interface ChosenRequirement { repoId: string; key: string; title: string }

const repoHref = (id: string): string => `/repo-detail/${encodeURIComponent(id)}`;

export const reqKey = (repoId: string, key: string): string => `${repoId}\u0000${key}`;

/**
 * A project's requirements across its repositories (crew's fold, `GET /projects/:id/requirements`,
 * crew#371): searchable, paged, each row naming its repository. Moved here from the retired Product
 * page (operator 2026-10-12) so the requirements list page and the "Draft epics" wizard step share
 * one browser. With `selection`, each row is a switch (at most {@link COMPOSE_MAX}).
 */
export function RequirementsBrowser({ projectId, navigate, selection, 'data-testid': testId = 'requirements-browser' }: {
  projectId: string;
  navigate: (path: string) => void;
  selection?: {
    chosen: ReadonlyMap<string, ChosenRequirement>;
    onToggle: (row: ChosenRequirement) => void;
    max?: number;
  };
  'data-testid'?: string;
}): React.ReactElement {
  const [draftQ, setDraftQ] = useState('');
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const [got, setGot] = useState<{ at: string; read: AggregateRead<ProjectRequirementsResponse> } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const retry = (): void => { setGot(null); setAttempt((n) => n + 1); };
  const at = `${projectId}\u0000${q}\u0000${offset}`;
  useEffect(() => {
    let cancelled = false;
    void getProjectRequirements(projectId, { q, offset, limit: PAGE }).then((read) => { if (!cancelled) setGot({ at, read }); });
    return () => { cancelled = true; };
  }, [projectId, q, offset, at, attempt]);
  const read = got !== null && got.at === at ? got.read : null;
  const max = selection?.max ?? COMPOSE_MAX;
  const full = selection !== undefined && selection.chosen.size >= max;

  const body = read?.state === 'ok' ? read.body : null;
  const total = body?.totals.total ?? 0;
  const matching = q === '' ? 'requirements' : `matching “${q}”`;
  const totalsLine = body === null ? '' : `${total === 0
    ? (q === '' ? 'No requirements in this project’s repositories yet' : `No requirement matches “${q}”`)
    : body.offset >= total
      ? `Past the last of ${total} ${matching}: the list shrank, so go back a page`
      : `${body.offset + 1}–${Math.min(body.offset + body.limit, total)} of ${total} ${matching}`} · ${body.totals.ok} of ${body.totals.repos} ${body.totals.repos === 1 ? 'repository' : 'repositories'} read`;
  const noRepo = body !== null && (body.rows.length === 0 || body.totals.repos === 0);
  const unavailable = read === null || read.state !== 'ok';
  const searchReason = noRepo ? 'Attach a repository to this project first.' : unavailable ? 'Wait until requirements can be read.' : null;
  const rowErrors = body?.rows.filter((r) => r.state === 'error').map(rowWhy).join('\n') || null;
  const error = read?.state === 'failed' ? read.why : rowErrors;
  const attachHref = `/repos/new?project=${encodeURIComponent(projectId)}`;

  if (read?.state === 'absent') {
    return <EmptyState data-testid="requirements-absent" title="Requirements aren’t available yet" body="Update Studio’s service to use this view." />;
  }
  return (
    <div data-testid={testId} data-state={read?.state ?? 'loading'} className="wk-pg-proj-stack wk-reqs">
      {error !== null && error !== undefined && <StateBanner data-testid="requirements-error" kind={readErrorKind(error)} what="requirements" error={error} onRetry={retry} />}
      <form onSubmit={(e) => { e.preventDefault(); if (searchReason !== null) return; setOffset(0); setQ(draftQ.trim()); }} className="wk-pg-proj-search">
        <label className="wk-pg-proj-field">Search requirements<input data-testid="requirements-search" type="search" className="wk-field" placeholder="Search requirements" value={draftQ} onChange={(e) => setDraftQ(e.target.value)} disabled={searchReason !== null} aria-describedby={searchReason !== null ? `${testId}-search-note` : undefined} /></label>
        <button type="submit" className="wk-btn wk-btn--secondary" disabled={searchReason !== null} aria-describedby={searchReason !== null ? `${testId}-search-note` : undefined}>Search</button>
      </form>
      {searchReason !== null && <p id={`${testId}-search-note`} className="wk-field-note">{searchReason}</p>}
      <p role="status" className="sr-only">{read === null ? 'Reading requirements…' : read.state === 'failed' ? 'The requirements could not be read.' : noRepo ? 'No repository in this project yet.' : totalsLine}</p>
      {read === null ? <Skeleton data-testid="requirements-loading" /> : noRepo ? (
        <EmptyState data-testid="requirements-empty" title="No repository in this project yet" body="Attach a repository to see its requirements."
          action={<a className="wk-btn wk-btn--primary" href={attachHref} onClick={(e) => { e.preventDefault(); navigate(attachHref); }}>Attach a repository</a>} />
      ) : body !== null && <>
        <p data-testid="requirements-totals" className="wk-pg-proj-note">{totalsLine}</p>
        {total === 0 && rowErrors === null && <EmptyState title={q === '' ? 'No requirements yet' : 'No matching requirements'} body={q === '' ? 'Index the attached repositories to build their requirements maps.' : 'Try another search.'} />}
        {/* A repository that was not read is said first, right under the totals that count it (codex on S5). */}
        {[...body.rows].sort((a, b) => Number(a.state === 'ok') - Number(b.state === 'ok')).map((row) => row.state !== 'ok' ? (
          <div key={row.repo.id} data-testid="requirements-repo-unread" data-repo={row.repo.id} data-state={row.state}>
            <p className="wk-pg-proj-note">{requirementReadWords(row)}{row.state !== 'dangling' && <>{' '}
              {/* The way to fix it is on the repository's page (its requirements map is built there; codex on S5). */}
              <a className="wk-link" data-testid="requirements-repo-open" href={repoHref(row.repo.id)} onClick={(e) => { e.preventDefault(); navigate(repoHref(row.repo.id)); }}>Open {row.repo.name ?? 'the repository'}</a></>}</p>
            <TechDetails text={rowWhy(row)} />
          </div>
        ) : row.items.length > 0 ? (
          <div key={row.repo.id} data-testid="requirements-repo" data-repo={row.repo.id}>
            <p className="wk-pg-proj-note">{row.repo.name ?? 'Unnamed repository'} · {row.total} of {row.corpus}</p>
            <ul className="wk-pg-proj-list">
              {row.items.map((r: RequirementSummary) => {
                const k = reqKey(row.repo.id, r.key);
                const on = selection?.chosen.has(k) === true;
                return (
                  <li key={r.key} data-testid="requirement" data-repo={row.repo.id} data-key={r.key} className={`wk-list-row${selection !== undefined ? ' wk-pg-proj-pick-row' : ''}`}>
                    {selection !== undefined
                      ? <Switch label={r.title} checked={on} disabled={!on && full ? `A draft takes at most ${max} requirements.` : null} onChange={() => selection.onToggle({ repoId: row.repo.id, key: r.key, title: r.title })} data-testid="requirement-pick" />
                      : <span className="wk-list-row-title">{r.title}</span>}
                    <p className="wk-list-row-meta">{r.reqId} · {r.domain}{r.risk && <> · <span className="wk-reqs-risk">At risk</span></>}</p>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null)}
        {full && <p className="wk-field-note">A draft takes at most {max} requirements. Clear a choice to add another.</p>}
        {(total > body.limit || body.offset > 0) && <>
          <div className="wk-pg-proj-actions">
            <button type="button" data-testid="requirements-prev" disabled={body.offset === 0} onClick={() => setOffset(Math.max(0, body.offset - body.limit))} className="wk-btn wk-btn--secondary">Previous</button>
            <button type="button" data-testid="requirements-next" disabled={body.offset + body.limit >= total} onClick={() => setOffset(body.offset + body.limit)} className="wk-btn wk-btn--secondary">Next</button>
          </div>
          {(body.offset === 0 || body.offset + body.limit >= total) && <p className="wk-field-note">{body.offset === 0 ? 'You’re on the first page.' : 'You’re on the last page.'}</p>}
        </>}
      </>}
    </div>
  );
}
