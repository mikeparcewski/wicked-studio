import { useEffect, useMemo, useRef, useState } from 'react';
import {
  composeProduct, getProjectRequirements, rowWhy,
  type AggregateRead, type ProjectRequirementsResponse, type RequirementSummary,
} from '../../api/product.js';
import { sessionPath } from '../../board/sessionModel.js';
import { readErrorKind } from '../../api/errors.js';
import { PageFrame, SectionTitle } from '../ui/PageFrame.js';
import { StateBanner, Skeleton, EmptyState } from '../ui/StateBanner.js';
import { Switch } from '../ui/Switch.js';
import { TechDetails } from '../ui/TechDetails.js';
import { requirementReadWords } from './ProjectAggregates.js';
import { productPath } from '../../hooks/useRoute.js';
import { useProjectsStore } from '../../store/projects.js';

/**
 * studio#157 — the Product view: where a product owner lives. Work answers "what is executing";
 * Product answers "what are we building". One project at a time (`?project=`):
 *
 *  - its requirements across every member repository, read from crew's fold
 *    (`GET /projects/:id/requirements`, crew#371) — searchable, paged, each row naming its repo;
 *  - "Draft epics": the chosen requirements (at most {@link COMPOSE_MAX}) launch crew's governed
 *    compose run (`POST /projects/:id/product/compose`, crew#372) and the page opens that run's
 *    session, where the draft, its review and the approve gate live. Nothing here asserts a plan.
 *
 * Coverage and the domain model are on the project page (studio#158), linked, not repeated.
 * Publishing to a tracker is not offered: crew does not serve it yet (crew#372 stays open for it).
 */

export const COMPOSE_MAX = 40;
const PAGE = 50;
const INSTRUCTIONS_MAX = 500;

const selKey = (repoId: string, key: string): string => `${repoId}\u0000${key}`;

export function ProductPage({ navigate, search }: { navigate: (path: string, opts?: { replace?: boolean }) => void; search: string }): React.ReactElement {
  const projectId = new URLSearchParams(search).get('project');
  const projects = useProjectsStore((s) => s.projects);
  const loading = useProjectsStore((s) => s.loading);
  useEffect(() => { if (useProjectsStore.getState().projects.length === 0) void useProjectsStore.getState().load(); }, []);
  const choices = useMemo(() => projects.filter((p) => p.id !== 'default' && p.status !== 'archived'), [projects]);

  const error = useProjectsStore((s) => s.error);
  return (
    <PageFrame data-testid="product-page" title="Product" intro="Choose a project to turn its requirements into a draft plan.">
      {error !== null && projectId === null && <StateBanner kind={readErrorKind(error)} what="projects" error={error} onRetry={() => void useProjectsStore.getState().load()} />}
      <section className="wk-card wk-pg-proj-stack">
        <label className="wk-pg-proj-field">Project
          <select data-testid="product-project" className="wk-field" value={projectId ?? ''}
            onChange={(e) => navigate(productPath(e.target.value === '' ? null : e.target.value), { replace: true })}>
            <option value="">{loading && choices.length === 0 ? 'Loading projects…' : 'Choose a project'}</option>
            {choices.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            {projectId !== null && !choices.some((p) => p.id === projectId) && <option value={projectId}>{loading ? 'Loading projects…' : 'This project'}</option>}
          </select>
        </label>
        {projectId === null && (loading ? <Skeleton rows={1} variant="line" /> : error === null && <EmptyState data-testid="product-no-project" title={choices.length === 0 ? 'No projects yet' : 'Choose the project to work with'} body={choices.length === 0 ? 'Create a project to group its repositories and requirements.' : 'Its requirements and draft tools will appear here.'} />)}
      </section>
      {projectId !== null && <ProjectProduct key={projectId} projectId={projectId} navigate={navigate} projectsError={error} />}
    </PageFrame>
  );
}

function ProjectProduct({ projectId, navigate, projectsError }: { projectId: string; navigate: (path: string) => void; projectsError: string | null }): React.ReactElement {
  const [draftQ, setDraftQ] = useState('');
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const [got, setGot] = useState<{ at: string; read: AggregateRead<ProjectRequirementsResponse> } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const retry = (): void => { setGot(null); setAttempt((n) => n + 1); };
  const at = `${q}\u0000${offset}`;
  useEffect(() => {
    let cancelled = false;
    void getProjectRequirements(projectId, { q, offset, limit: PAGE }).then((read) => { if (!cancelled) setGot({ at, read }); });
    return () => { cancelled = true; };
  }, [projectId, q, offset, at, attempt]);
  const read = got !== null && got.at === at ? got.read : null;

  const [chosen, setChosen] = useState<ReadonlyMap<string, { repoId: string; key: string; title: string }>>(new Map());
  const full = chosen.size >= COMPOSE_MAX;
  const toggle = (repoId: string, r: RequirementSummary): void => {
    setChosen((prev) => {
      const next = new Map(prev);
      const k = selKey(repoId, r.key);
      if (next.has(k)) next.delete(k);
      else if (next.size < COMPOSE_MAX) next.set(k, { repoId, key: r.key, title: r.title });
      return next;
    });
  };

  // A draft answered after this project's view is gone (another project, another page) launched its
  // run all the same — it shows in the rail — but must not pull the operator away (codex on #157).
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const [instructions, setInstructions] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const draft = async (): Promise<void> => {
    if (busy || chosen.size === 0) return;
    setBusy(true);
    setRefusal(null);
    try {
      const steer = instructions.trim();
      const out = await composeProduct(projectId, {
        requirements: [...chosen.values()].map(({ repoId, key }) => ({ repoId, key })),
        ...(steer !== '' ? { instructions: steer } : {}),
      });
      if (live.current) navigate(sessionPath(`run:${out.runId}`));
    } catch (e) {
      if (!live.current) return;
      setRefusal(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const projectHref = `/projects/${encodeURIComponent(projectId)}`;

  const body = read?.state === 'ok' ? read.body : null;
  const total = body?.totals.total ?? 0;
  const matching = q === '' ? 'requirements' : `matching “${q}”`;
  // The one totals sentence: shown under the search, and announced by the status region below.
  const totalsLine = body === null ? '' : `${total === 0
    ? (q === '' ? 'No requirements in this project\'s repositories yet' : `No requirement matches “${q}”`)
    : body.offset >= total
      ? `Past the last of ${total} ${matching} — the list shrank; go back a page`
      : `${body.offset + 1}–${Math.min(body.offset + body.limit, total)} of ${total} ${matching}`} · ${body.totals.ok} of ${body.totals.repos} ${body.totals.repos === 1 ? 'repository' : 'repositories'} read`;

  const noRepo = body !== null && (body.rows.length === 0 || body.totals.repos === 0);
  const unavailable = read === null || read.state !== 'ok';
  const searchReason = noRepo ? 'Attach a repository to this project first.' : unavailable ? 'Wait until requirements can be read.' : null;
  const draftReason = searchReason ?? (busy ? 'Starting your draft…' : chosen.size === 0 ? 'Choose at least one requirement to draft from.' : null);
  const rowErrors = body?.rows.filter((r) => r.state === 'error').map(rowWhy).join('\n') || null;
  const errors = [projectsError, read?.state === 'failed' ? read.why : null, refusal, rowErrors].filter((e): e is string => e !== null);
  const error = errors.find((e) => readErrorKind(e) === 'offline') ?? errors[0];
  const attachHref = `/repos/new?project=${encodeURIComponent(projectId)}`;
  return (
    <>
      {error !== undefined && <StateBanner data-testid={refusal !== null ? 'product-compose-error' : 'product-error'} kind={readErrorKind(error)} what={refusal !== null ? 'the draft' : 'requirements'} error={errors.join('\n')} onRetry={() => { retry(); setRefusal(null); if (projectsError !== null) void useProjectsStore.getState().load(); }} />}
      <p className="wk-pg-proj-note">See coverage and domains on <a href={projectHref} onClick={(e) => { e.preventDefault(); navigate(projectHref); }} className="wk-link" data-testid="product-project-link">its project page</a>.</p>
      {read?.state === 'absent' ? <EmptyState data-testid="product-absent" title="Product requirements aren’t available yet" body="Update Studio’s service to use this view." /> : <>
        {noRepo && <div className="wk-pg-proj-actions"><a className="wk-btn wk-btn--primary" href={attachHref} onClick={(e) => { e.preventDefault(); navigate(attachHref); }}>Attach a repository</a></div>}
        <section data-testid="product-requirements" aria-label="Requirements" data-state={read?.state ?? 'loading'} className="wk-card wk-pg-proj-stack">
          <SectionTitle>Requirements</SectionTitle>
          <form onSubmit={(e) => { e.preventDefault(); if (searchReason !== null) return; setOffset(0); setQ(draftQ.trim()); }} className="wk-pg-proj-search">
            <label className="wk-pg-proj-field">Search requirements<input data-testid="product-search" type="search" className="wk-field" placeholder="Search requirements" value={draftQ} onChange={(e) => setDraftQ(e.target.value)} disabled={searchReason !== null} aria-describedby={searchReason !== null ? 'product-search-note' : undefined} /></label>
            <button type="submit" className="wk-btn wk-btn--secondary" disabled={searchReason !== null} aria-describedby={searchReason !== null ? 'product-search-note' : undefined}>Search</button>
          </form>
          {searchReason !== null && <p id="product-search-note" className="wk-field-note">{searchReason}</p>}
          <p data-testid="product-status" role="status" className="sr-only">{read === null ? 'Reading requirements…' : read.state === 'failed' ? 'The requirements could not be read.' : noRepo ? 'No repository in this project yet.' : totalsLine}</p>
          {read === null ? <Skeleton data-testid="product-loading" /> : noRepo ? <EmptyState data-testid="product-empty" title="No repository in this project yet" body="Attach a repository to see its requirements." /> : body !== null && <>
            <p data-testid="product-totals" className="wk-pg-proj-note">{totalsLine}</p>
            {total === 0 && rowErrors === null && <EmptyState title={q === '' ? 'No requirements yet' : 'No matching requirements'} body={q === '' ? 'Index the attached repositories to build their requirements maps.' : 'Try another search.'} />}
            {body.rows.map((row) => row.state !== 'ok' ? (
              <div key={row.repo.id} data-testid="product-repo-unread" data-repo={row.repo.id} data-state={row.state}>
                <p className="wk-pg-proj-note">{requirementReadWords(row)}</p><TechDetails text={rowWhy(row)} />
              </div>
            ) : row.items.length > 0 ? (
              <div key={row.repo.id} data-testid="product-repo" data-repo={row.repo.id}>
                <p className="wk-pg-proj-note">{row.repo.name ?? 'Unnamed repository'} · {row.total} of {row.corpus}</p>
                <ul className="wk-pg-proj-list">
                  {row.items.map((r) => {
                    const k = selKey(row.repo.id, r.key); const on = chosen.has(k);
                    return <li key={r.key} data-testid="product-requirement" data-repo={row.repo.id} data-key={r.key} className="wk-list-row wk-pg-proj-pick-row">
                      <Switch label={r.title} checked={on} disabled={!on && full ? `A draft takes at most ${COMPOSE_MAX} requirements.` : null} onChange={() => toggle(row.repo.id, r)} data-testid="product-requirement-pick" />
                      <p className="wk-list-row-meta">{r.reqId} · {r.domain}{r.risk ? ' · At risk' : ''}</p>
                    </li>;
                  })}
                </ul>
              </div>
            ) : null)}
            {full && <p className="wk-field-note">A draft takes at most {COMPOSE_MAX} requirements. Clear a choice to add another.</p>}
            {(total > body.limit || body.offset > 0) && <>
              <div className="wk-pg-proj-actions">
                <button type="button" data-testid="product-prev" disabled={body.offset === 0} onClick={() => setOffset(Math.max(0, body.offset - body.limit))} className="wk-btn wk-btn--secondary">Previous</button>
                <button type="button" data-testid="product-next" disabled={body.offset + body.limit >= total} onClick={() => setOffset(body.offset + body.limit)} className="wk-btn wk-btn--secondary">Next</button>
              </div>
              {(body.offset === 0 || body.offset + body.limit >= total) && <p className="wk-field-note">{body.offset === 0 ? 'You’re on the first page.' : 'You’re on the last page.'}</p>}
            </>}
          </>}
        </section>
        <section data-testid="product-compose" aria-label="Draft epics" className="wk-card wk-pg-proj-stack">
          <SectionTitle>Draft epics</SectionTitle>
          <p data-testid="product-chosen" className="wk-pg-proj-note">{chosen.size === 0 ? `Choose the requirements to draft from (at most ${COMPOSE_MAX}).` : `${chosen.size} ${chosen.size === 1 ? 'requirement' : 'requirements'} chosen${full ? ' — the most one draft takes' : ''}: ${[...chosen.values()].map((c) => c.title).join(' · ')}`}
            {chosen.size > 0 && <> <button type="button" data-testid="product-clear" onClick={() => setChosen(new Map())} className="wk-btn wk-btn--quiet">Clear</button></>}
          </p>
          <label className="wk-pg-proj-field">Instructions for the draft<textarea data-testid="product-instructions" className="wk-field" rows={2} maxLength={INSTRUCTIONS_MAX} value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="Optional: describe how to group the requirements" disabled={searchReason !== null} aria-describedby={searchReason !== null ? 'product-draft-note' : undefined} /></label>
          <div className="wk-pg-proj-actions"><button type="button" data-testid="product-draft" disabled={draftReason !== null} aria-describedby={draftReason !== null ? 'product-draft-note' : undefined} onClick={() => void draft()} className={`wk-btn ${noRepo ? 'wk-btn--secondary' : 'wk-btn--primary'}`}>{busy ? 'Starting the draft…' : 'Draft epics'}</button></div>
          {draftReason !== null && <p id="product-draft-note" className="wk-field-note">{draftReason}</p>}
          <p className="wk-pg-proj-note">Your draft opens in a session for review and approval.</p>
        </section>
      </>}
    </>
  );
}
