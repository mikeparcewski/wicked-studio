import { useEffect, useMemo, useRef, useState } from 'react';
import {
  composeProduct, getProjectRequirements, rowWhy,
  type AggregateRead, type ProjectRequirementsResponse, type RequirementSummary,
} from '../../api/product.js';
import { sessionPath } from '../../board/sessionModel.js';
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

const CSS = {
  page: { maxWidth: '960px', padding: '24px 32px', display: 'flex', flexDirection: 'column', gap: '16px' },
  head: { fontSize: 'var(--text-2xs)', fontWeight: 'var(--weight-bold)', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-muted)', margin: '0 0 8px' },
  line: { fontSize: 'var(--text-xs)', color: 'var(--ink-muted)', margin: 0 },
  bad: { fontSize: 'var(--text-xs)', color: 'var(--status-fail)', margin: 0 },
  list: { display: 'flex', flexDirection: 'column', gap: '2px', background: 'var(--surface-card)', border: '1px solid var(--surface-raised)', borderRadius: 'var(--radius-lg)', padding: '4px', listStyle: 'none', margin: 0 },
  row: { display: 'flex', alignItems: 'baseline', gap: '10px', padding: '6px 8px', fontSize: 'var(--text-xs)', color: 'var(--ink-high)' },
  dim: { color: 'var(--ink-dim)' },
} as const satisfies Record<string, React.CSSProperties>;

const selKey = (repoId: string, key: string): string => `${repoId}\u0000${key}`;

export function ProductPage({ navigate, search }: { navigate: (path: string, opts?: { replace?: boolean }) => void; search: string }): React.ReactElement {
  const projectId = new URLSearchParams(search).get('project');
  const projects = useProjectsStore((s) => s.projects);
  const loading = useProjectsStore((s) => s.loading);
  useEffect(() => { if (useProjectsStore.getState().projects.length === 0) void useProjectsStore.getState().load(); }, []);
  const choices = useMemo(() => projects.filter((p) => p.id !== 'default' && p.status !== 'archived'), [projects]);

  return (
    <div data-testid="product-page" style={CSS.page}>
      <div>
        <h1 style={{ fontSize: 'var(--text-lg)', fontWeight: 600, margin: '0 0 4px', color: 'var(--ink-high)' }}>Product</h1>
        <p style={CSS.line}>What a project is building: its requirements across its repositories, drafted into epics, features and stories by a governed run.</p>
      </div>
      <label style={{ ...CSS.line, display: 'flex', alignItems: 'center', gap: '8px' }}>
        Project
        <select
          data-testid="product-project"
          className="wk-field"
          value={projectId ?? ''}
          onChange={(e) => navigate(productPath(e.target.value === '' ? null : e.target.value), { replace: true })}
        >
          <option value="">{loading && choices.length === 0 ? 'Loading projects…' : 'Choose a project'}</option>
          {choices.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          {projectId !== null && !choices.some((p) => p.id === projectId) && <option value={projectId}>{projectId}</option>}
        </select>
      </label>
      {projectId === null
        ? <p data-testid="product-no-project" style={CSS.line}>{!loading && choices.length === 0 ? 'No project yet. A project groups the repositories a product is built from; create one on See everything › Projects.' : 'Choose the project whose requirements to work with.'}</p>
        : <ProjectProduct key={projectId} projectId={projectId} navigate={navigate} />}
    </div>
  );
}

function ProjectProduct({ projectId, navigate }: { projectId: string; navigate: (path: string) => void }): React.ReactElement {
  const [draftQ, setDraftQ] = useState('');
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const [got, setGot] = useState<{ at: string; read: AggregateRead<ProjectRequirementsResponse> } | null>(null);
  const at = `${q}\u0000${offset}`;
  useEffect(() => {
    let cancelled = false;
    void getProjectRequirements(projectId, { q, offset, limit: PAGE }).then((read) => { if (!cancelled) setGot({ at, read }); });
    return () => { cancelled = true; };
  }, [projectId, q, offset, at]);
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
  if (read !== null && read.state === 'absent') {
    return <p data-testid="product-absent" style={CSS.line}>This daemon does not serve project requirements (it predates crew#371). Upgrade wicked-crew to use the Product view.</p>;
  }
  const body = read?.state === 'ok' ? read.body : null;
  const total = body?.totals.total ?? 0;
  const matching = q === '' ? 'requirements' : `matching “${q}”`;
  // The one totals sentence: shown under the search, and announced by the status region below.
  const totalsLine = body === null ? '' : `${total === 0
    ? (q === '' ? 'No requirements in this project\'s repositories yet' : `No requirement matches “${q}”`)
    : body.offset >= total
      ? `Past the last of ${total} ${matching} — the list shrank; go back a page`
      : `${body.offset + 1}–${Math.min(body.offset + body.limit, total)} of ${total} ${matching}`} · ${body.totals.ok} of ${body.totals.repos} ${body.totals.repos === 1 ? 'repository' : 'repositories'} read`;

  return (
    <>
      <p style={CSS.line}>
        Coverage and the domain model for this project are on{' '}
        <a href={projectHref} onClick={(e) => { e.preventDefault(); navigate(projectHref); }} className="wk-since-toggle" data-testid="product-project-link">its project page</a>.
      </p>

      <section data-testid="product-requirements" aria-labelledby="product-requirements-head" data-state={read?.state ?? 'loading'}>
        <h2 id="product-requirements-head" style={CSS.head}>Requirements</h2>
        <form
          onSubmit={(e) => { e.preventDefault(); setOffset(0); setQ(draftQ.trim()); }}
          style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}
        >
          <input data-testid="product-search" type="search" className="wk-field" aria-label="Search requirements" placeholder="Search requirements" value={draftQ} onChange={(e) => setDraftQ(e.target.value)} style={{ padding: '0 8px', minWidth: '280px' }} />
          <button type="submit" className="wk-prop-btn wk-prop-btn--ghost">Search</button>
        </form>
        {/* One status region, mounted throughout, so a screen reader hears each search / page result
            (codex r2 on #157). */}
        <p data-testid="product-status" role="status" className="sr-only">
          {read === null ? 'Reading requirements…'
            : read.state === 'failed' ? 'The requirements could not be read.'
            : body === null || body.rows.length === 0 ? 'No repository in this project yet.'
            : totalsLine}
        </p>
        {read === null ? (
          <p data-testid="product-loading" style={CSS.line}>Reading the project's requirements…</p>
        ) : read.state === 'failed' ? (
          <p data-testid="product-error" role="alert" style={CSS.bad}>The project's requirements could not be read — {read.why}</p>
        ) : body !== null && body.rows.length === 0 ? (
          <p data-testid="product-empty" style={CSS.line}>No repository in this project yet, so there are no requirements. Attach one on <a href={projectHref} onClick={(e) => { e.preventDefault(); navigate(projectHref); }} className="wk-since-toggle">the project page</a>.</p>
        ) : body !== null && (
          <>
            <p data-testid="product-totals" style={{ ...CSS.line, marginBottom: '8px' }}>{totalsLine}</p>
            {body.rows.map((row) => (
              row.state !== 'ok' ? (
                <p key={row.repo.id} data-testid="product-repo-unread" data-repo={row.repo.id} data-state={row.state} style={{ ...CSS.line, marginBottom: '6px' }}>
                  <b>{row.repo.name ?? row.repo.id}</b> — {rowWhy(row)}
                </p>
              ) : row.items.length > 0 ? (
                <div key={row.repo.id} data-testid="product-repo" data-repo={row.repo.id} style={{ marginBottom: '8px' }}>
                  <p style={{ ...CSS.line, margin: '0 0 4px' }}><b>{row.repo.name ?? row.repo.id}</b> · {row.total} of {row.corpus}</p>
                  <ul style={CSS.list}>
                    {row.items.map((r) => {
                      const k = selKey(row.repo.id, r.key);
                      const on = chosen.has(k);
                      return (
                        <li key={r.key} data-testid="product-requirement" data-repo={row.repo.id} data-key={r.key} style={CSS.row}>
                          <input type="checkbox" checked={on} disabled={!on && full} onChange={() => toggle(row.repo.id, r)} aria-label={`Choose ${r.reqId} ${r.title}`} data-testid="product-requirement-pick" />
                          <span style={{ fontFamily: 'var(--font-mono)', ...CSS.dim }}>{r.reqId}</span>
                          <span>{r.title}</span>
                          <span style={CSS.dim}>{r.domain}{r.risk ? ' · risk' : ''}</span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null
            ))}
            {/* Previous stays while the window is past the start, even when the corpus shrank under it. */}
            {(total > body.limit || body.offset > 0) && (
              <div style={{ display: 'flex', gap: '8px' }}>
                <button type="button" data-testid="product-prev" disabled={body.offset === 0} onClick={() => setOffset(Math.max(0, body.offset - body.limit))} className="wk-prop-btn wk-prop-btn--ghost">Previous</button>
                <button type="button" data-testid="product-next" disabled={body.offset + body.limit >= total} onClick={() => setOffset(body.offset + body.limit)} className="wk-prop-btn wk-prop-btn--ghost">Next</button>
              </div>
            )}
          </>
        )}
      </section>

      <section data-testid="product-compose" aria-labelledby="product-compose-head">
        <h2 id="product-compose-head" style={CSS.head}>Draft epics</h2>
        <p data-testid="product-chosen" style={{ ...CSS.line, marginBottom: '8px' }}>
          {chosen.size === 0
            ? `Choose the requirements to draft from (at most ${COMPOSE_MAX}).`
            : `${chosen.size} ${chosen.size === 1 ? 'requirement' : 'requirements'} chosen${full ? ` — the most one draft takes` : ''}: ${[...chosen.values()].map((c) => c.title).join(' · ')}`}
          {chosen.size > 0 && <> {' '}<button type="button" data-testid="product-clear" onClick={() => setChosen(new Map())} className="wk-since-toggle">Clear</button></>}
        </p>
        <textarea
          data-testid="product-instructions"
          className="wk-field"
          aria-label="Instructions for the draft"
          rows={2}
          maxLength={INSTRUCTIONS_MAX}
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder="Optional: how to group them (e.g. one epic per domain, stories small enough for a day)"
          style={{ width: '100%', marginBottom: '8px', padding: '6px 8px' }}
        />
        {refusal !== null && <p data-testid="product-compose-error" role="alert" style={{ ...CSS.bad, marginBottom: '8px' }}>The draft was not started — {refusal}</p>}
        <button type="button" data-testid="product-draft" disabled={busy || chosen.size === 0} onClick={() => void draft()} className="wk-prop-btn wk-prop-btn--primary">
          {busy ? 'Starting the draft…' : 'Draft epics'}
        </button>
        <p style={{ ...CSS.line, marginTop: '6px' }}>Starts a governed run: a draft, an independent review, then your approval. It opens in its session.</p>
      </section>
    </>
  );
}
