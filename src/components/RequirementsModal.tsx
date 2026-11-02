/**
 * REQUIREMENTS MODAL — readable, manageable requirements for a repo.
 *
 * Search and filters are SERVER-SIDE (crew `GET /repos/:id/requirements` — tokenized
 * AND-match + risk/domain filters + pagination over the ~35k-requirement corpus); the
 * browser never holds the 38MB artifact. Clicking a row opens an edit rail: title,
 * notes, status, and a risk toggle — persisted via PATCH into the overrides sidecar,
 * which survives artifact regeneration. `riskSource` distinguishes operator calls
 * from data-derived (business-rule) risk.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../api/client.js';
import type { RequirementSummary, RequirementDetail, RequirementsPage, RequirementPatch } from '../api/types.js';
import { useModalEscape } from './Modal.js';
import { openLaunchWizard } from '../store/launchWizard.js';
import {
  DOMAIN_EXTRACTION_ID,
  corroborationOf,
  corroborationSentence,
  configDataCountOf,
  coverageOf,
  graphBuildNote,
  graphBuildOf,
  isPlaceholder,
  pageUncountedOf,
  PLACEHOLDER_NOTE,
  UNCOUNTED_TITLE,
  uncountedLine,
  uncountedOf,
  requirementsNotGenerated,
  type RequirementsCoverage,
} from '../board/requirementsState.js';
import { workflowLabel } from '../board/workflowNames.js';
import { isLiveStatus, repeatLineOf } from '../board/repeatProgress.js';
import { RequirementsCoverageSummary } from './RequirementsCoverageSummary.js';

const T = {
  canvas: 'var(--surface-base)',
  canvas2: 'var(--surface-rail)',
  surface: 'var(--surface-card)',
  surface2: 'var(--surface-raised)',
  ink: 'var(--ink-high)',
  muted: 'var(--ink-muted)',
  faint: 'var(--ink-dim)',
  hairline: 'var(--surface-raised)',
  hairlineS: 'var(--surface-raised)',
  ok: 'var(--status-run)',
  deny: 'var(--status-fail)',
  link: 'var(--accent)',
  accent: 'var(--accent)',
};

const PAGE_SIZE = 50;

interface Props {
  repoId: string;
  repoName: string;
  onClose: () => void;
  /** Navigate to a component symbol in the code graph (requirement → code). */
  onNavigateComponent?: (symbol: string) => void;
  /** Open a job's page (the domain-extraction job mapping this repository). */
  onOpenRun?: (runId: string) => void;
}

/** A domain-extraction job mapping the repository, as the requirements view knows it: `undefined` while it is being
 *  looked up, `null` when none is going, `'unknown'` when the daemon could not say. */
type MappingJob = { runId: string; line: string | null } | null | 'unknown' | undefined;

/** How often the view re-reads the share and the job while a job is mapping (a page takes minutes). */
const MAPPING_REFRESH_MS = 30_000;

/** The newest domain-extraction job for `repoId` that is still going, with its progress line (null before its first
 *  page finished); `null` when none is; `'unknown'` when the job list could not be read. */
async function liveMappingJob(repoId: string): Promise<MappingJob> {
  let runs: Awaited<ReturnType<typeof api.listRuns>>['runs'];
  try {
    ({ runs } = await api.listRuns());
  } catch {
    return 'unknown';
  }
  const live = runs
    .filter((v) => v.session.repo_ref === repoId
      && (v.session as { workflow_id?: unknown }).workflow_id === DOMAIN_EXTRACTION_ID
      && isLiveStatus(v.session.status))
    .sort((a, b) => (b.session.created_at ?? 0) - (a.session.created_at ?? 0));
  const run = live[0];
  if (run === undefined) return null;
  const { events } = await api.getRunEvents(run.session.id, ['stepRepeated', 'awaitingHuman', 'resumed', 'unitExecuting'])
    .catch(() => ({ events: [] }));
  return { runId: run.session.id, line: repeatLineOf(events) };
}

export function RequirementsModal({ repoId, repoName, onClose, onNavigateComponent, onOpenRun }: Props): React.ReactElement {
  const [query, setQuery] = useState('');
  const [risk, setRisk] = useState<'all' | 'risk' | 'no-risk'>('all');
  // Functional by default: statements extracted from lockfiles/manifests/data fixtures
  // are honest but they're about the tooling, not the product.
  const [category, setCategory] = useState<'functional' | 'config-data' | 'all'>('functional');
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<RequirementsPage | null>(null);
  // "Config & data" is a filter only when the corpus holds some (crew 0.167.0 categories); a daemon from before the
  // count keeps it, and nothing shows before the first read.
  const configData = configDataCountOf(page);
  const hasConfigData = page !== null && (configData === null || configData > 0);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Lane repo-page: no requirements graph yet is a state with its own panel, never a red refusal.
  // Holds the workflow that generates it (crew's typed 404 names it).
  const [notGenerated, setNotGenerated] = useState<{ workflow: string; share: RequirementsCoverage | null } | null>(null);
  // domain-graph-3: a domain-extraction job for this repository that is still going, and its own progress line.
  // `undefined` while it is being looked up: the launch button waits for the answer, so it never flashes up beside a
  // job that is already mapping.
  const [mapping, setMapping] = useState<MappingJob>(undefined);
  const [mappingAsk, setMappingAsk] = useState(0);
  useEffect(() => { setMapping(undefined); }, [repoId]);
  useEffect(() => {
    if (notGenerated === null) {
      setMapping(undefined);
      return;
    }
    let live = true;
    void liveMappingJob(repoId).then((m) => { if (live) setMapping(m); });
    return () => { live = false; };
  }, [notGenerated, repoId, mappingAsk]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchPage = useCallback(
    (q: string, r: typeof risk, cat: typeof category, off: number) => {
      const params: Parameters<typeof api.listRequirements>[1] = { offset: off, limit: PAGE_SIZE };
      if (q.trim() !== '') params.q = q.trim();
      if (r !== 'all') params.risk = r;
      if (cat !== 'all') params.category = cat;
      api
        .listRequirements(repoId, params)
        .then((p) => {
          setPage(p);
          setLoadError(null);
          setNotGenerated(null);
        })
        .catch((e: unknown) => {
          const missing = requirementsNotGenerated(e);
          setNotGenerated(missing);
          setLoadError(missing !== null ? null : e instanceof Error ? e.message : String(e));
        });
    },
    [repoId],
  );

  // domain-graph-3: while a job is mapping, the share, the job's line and a graph it builds are read again every
  // half minute (the view never shows an opening snapshot as live).
  const mappingLive = mapping !== null && mapping !== undefined && mapping !== 'unknown';
  useEffect(() => {
    if (!mappingLive) return;
    const t = setInterval(() => fetchPage(query, risk, category, offset), MAPPING_REFRESH_MS);
    return () => clearInterval(t);
  }, [mappingLive, fetchPage, query, risk, category, offset]);
  // …and once more when the job it watched ends (codex r2 on the branch): the read that saw no graph may have come just
  // before the job built it, and the view must not keep saying there is none.
  const wasMapping = useRef(false);
  useEffect(() => {
    if (wasMapping.current && mapping === null) fetchPage(query, risk, category, offset);
    wasMapping.current = mappingLive;
  }, [mapping, mappingLive, fetchPage, query, risk, category, offset]);

  // One debounced (250ms) server fetch covers search, filter, and pagination changes.
  useEffect(() => {
    if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchPage(query, risk, category, offset), 250);
    return () => {
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    };
  }, [query, risk, category, offset, fetchPage]);

  function setFilter(r: 'all' | 'risk' | 'no-risk'): void {
    setRisk(r);
    setOffset(0);
  }

  function setCategoryFilter(c: 'functional' | 'config-data' | 'all'): void {
    setCategory(c);
    setOffset(0);
  }
  // The corpus no longer holds config and data (its filter is gone): a view still on it moves to Functional.
  useEffect(() => {
    if (!hasConfigData && page !== null && category === 'config-data') setCategoryFilter('functional');
  }, [hasConfigData, page, category]);

  // Patch a row in place after the edit rail saves (no full refetch needed).
  function absorbUpdate(updated: RequirementDetail): void {
    setPage((prev) =>
      prev === null
        ? prev
        : {
            ...prev,
            items: prev.items.map((i) => (i.key === updated.key ? { ...i, ...summaryOf(updated) } : i)),
          },
    );
  }

  // Escape must close the rail first (discarding unsaved edits is preferable to closing the
  // whole modal and losing navigation context). Only when no rail is open does it close the modal.
  const handleEscape = useCallback((): void => {
    if (selectedKey !== null) setSelectedKey(null);
    else onClose();
  }, [selectedKey, onClose]);
  useModalEscape(handleEscape);

  /** Generating needs a governed run, so this never starts one: it opens New job filled in with the
   *  generating workflow and this repository, and the operator launches it there (lane repo-page). */
  function generate(workflow: string): void {
    onClose();
    openLaunchWizard({
      workflowId: workflow,
      intent: `Map the domain of ${repoName}: the requirements its code implements, grouped by domain, and how much of the code they cover.`,
      contextRepo: repoId,
      composerKey: `repo:${repoId}`,
    });
  }


  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'var(--scrim)' }}>
      <div
        className="w-[92vw] h-[92vh] rounded-2xl flex flex-col overflow-hidden border"
        style={{ background: T.surface, border: `1px solid ${T.hairlineS}` }}
      >
        {/* Header */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-5 py-3 border-b shrink-0" style={{ borderColor: T.hairline, background: T.canvas2 }}>
          <span className=" text-sm font-semibold" style={{ color: T.ink }}>{repoName}</span>
          <span className=" text-xs px-2 py-0.5 rounded" style={{ background: T.surface2, color: T.muted }}>
            requirements
          </span>
          {page !== null && <GraphCoverage page={page} />}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close requirements"
            className="ml-auto text-lg px-2"
            style={{ color: T.muted }}
          >
            ×
          </button>
        </div>

        {/* Toolbar: search (server-side) + risk filter. Nothing to search before the graph exists. */}
        {notGenerated === null && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-2.5 border-b shrink-0" style={{ borderColor: T.hairline }}>
          <input
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOffset(0);
            }}
            placeholder="Search id, domain, title or statement…"
            className="flex-1 basis-full sm:basis-auto min-w-0 text-sm px-3 py-1.5 rounded-lg border outline-none"
            style={{ border: `1px solid ${T.hairlineS}`, background: T.canvas2, color: T.ink }}
          />
          <div className="flex items-center gap-1" role="group" aria-label="Category filter">
            {(['functional', 'config-data', 'all'] as const).filter((c) => c !== 'config-data' || hasConfigData).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategoryFilter(c)}
                aria-pressed={category === c}
                className="px-2.5 py-1 rounded-lg text-xs font-semibold"
                style={{
                  background: category === c ? T.surface2 : 'transparent',
                  color: category === c ? T.ink : T.faint,
                  border: `1px solid ${category === c ? T.hairlineS : 'transparent'}`,
                }}
              >
                {c === 'functional' ? 'Functional' : c === 'config-data' ? 'Config & data' : 'All'}
              </button>
            ))}
          </div>
          <div className="hidden sm:block w-px h-4" style={{ background: T.hairline }} />
          <div className="flex items-center gap-1" role="group" aria-label="Risk filter">
            {(['all', 'risk', 'no-risk'] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setFilter(r)}
                aria-pressed={risk === r}
                className="px-2.5 py-1 rounded-lg text-xs font-semibold"
                style={{
                  background: risk === r ? (r === 'risk' ? 'var(--status-fail-dim)' : T.surface2) : 'transparent',
                  color: risk === r ? (r === 'risk' ? T.deny : T.ink) : T.faint,
                  border: `1px solid ${risk === r ? T.hairlineS : 'transparent'}`,
                }}
              >
                {r === 'all' ? 'All' : r === 'risk' ? 'Risk' : 'No risk'}
              </button>
            ))}
          </div>
        </div>
        )}

        {/* Body: list + edit rail */}
        <div className="flex-1 flex overflow-hidden">
          <div className="flex-1 overflow-y-auto">
            {notGenerated !== null ? (
              <NotGenerated repoName={repoName} workflow={notGenerated.workflow} onGenerate={generate} share={notGenerated.share} mapping={mapping} onOpenRun={onOpenRun} onRetryMapping={() => setMappingAsk((n) => n + 1)} />
            ) : loadError !== null ? (
              <p className="text-xs p-6" style={{ color: T.deny }}>{loadError}</p>
            ) : page === null ? (
              <p className="text-xs p-6" style={{ color: T.faint }}>Loading…</p>
            ) : page.corpus === 0 ? (
              // An EMPTY CORPUS is not a failed search. "No requirements match" asserts that
              // something was searched and the filters excluded it — for a repo whose extraction
              // has never run, that sentence is false and it hides the only action that would
              // help. `corpus === 0` means there is nothing to search at all, so no filter can be
              // responsible and the distinction is decidable here (FINDING-065).
              <NotGenerated repoName={repoName} workflow={DOMAIN_EXTRACTION_ID} onGenerate={generate} empty />
            ) : page.items.length === 0 ? (
              <p className="text-xs p-6" style={{ color: T.faint }}>No requirements match.</p>
            ) : (
              <div className="divide-y" style={{ borderColor: T.hairline }}>
                {page.items.map((r) => (
                  <RequirementRow
                    key={r.key}
                    req={r}
                    selected={selectedKey === r.key}
                    onSelect={() => setSelectedKey(r.key)}
                  />
                ))}
              </div>
            )}
            {/* Pagination */}
            {notGenerated === null && page !== null && page.total > PAGE_SIZE && (
              <div className="flex items-center justify-center gap-4 py-3">
                <button
                  type="button"
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                  className="text-xs px-3 py-1 rounded disabled:opacity-40"
                  style={{ color: T.link }}
                >
                  ← Prev
                </button>
                <span data-testid="requirements-range" className="text-xs tabular-nums" style={{ color: T.faint }}>
                  Requirements {(offset + 1).toLocaleString('en-US')}–{Math.min(offset + PAGE_SIZE, page.total).toLocaleString('en-US')} of {page.total.toLocaleString('en-US')}
                </span>
                <button
                  type="button"
                  disabled={offset + PAGE_SIZE >= page.total}
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                  className="text-xs px-3 py-1 rounded disabled:opacity-40"
                  style={{ color: T.link }}
                >
                  Next →
                </button>
              </div>
            )}
          </div>
          {selectedKey !== null && (
            <RequirementEditRail
              repoId={repoId}
              reqKey={selectedKey}
              onClose={() => setSelectedKey(null)}
              onSaved={absorbUpdate}
              onNavigateComponent={onNavigateComponent}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * No requirements to show yet, said plainly with what this view would show and how to get it
 * (lane repo-page). `empty`: a graph was generated but holds no requirements (FINDING-065).
 */
function NotGenerated({ repoName, workflow, onGenerate, empty = false, share = null, mapping, onOpenRun, onRetryMapping }: {
  repoName: string;
  workflow: string;
  onGenerate: (workflow: string) => void;
  empty?: boolean;
  /** The real share so far against the minimum (crew's notGenerated answer, api-types 0.164.0). */
  share?: RequirementsCoverage | null;
  /** domain-graph-3: the domain-extraction job mapping it now and its own progress line (`undefined` while looked
   *  up, `'unknown'` when the daemon could not say). */
  mapping?: MappingJob;
  onOpenRun?: ((runId: string) => void) | undefined;
  onRetryMapping?: (() => void) | undefined;
}): React.ReactElement {
  return (
    <div data-testid="requirements-not-generated" data-state={empty ? 'empty' : 'not-generated'} className="wk-req-none">
      <h3 className="wk-req-none-title">
        {empty ? 'No requirements have been extracted for this repository' : 'No requirements graph yet for this repository'}
      </h3>
      {share !== null && share.behaviorBearing > 0 && (
        <RequirementsCoverageSummary
          coverage={share}
          testId="requirements-real-share"
          bar
          note="the graph is built once the minimum is reached; the real requirements found so far are kept"
        />
      )}
      {mapping === 'unknown' && (
        <p data-testid="requirements-mapping-unknown" className="wk-req-none-share">
          Could not check whether a job is mapping {repoName} now.
          {onRetryMapping !== undefined && (
            <>{' '}<button type="button" data-testid="requirements-mapping-retry" className="wk-link" onClick={onRetryMapping}>Check again</button></>
          )}
        </p>
      )}
      {mapping !== null && mapping !== undefined && mapping !== 'unknown' && (
        <p data-testid="requirements-mapping-job" className="wk-req-none-share">
          {mapping.line ?? `A job is mapping ${repoName} now.`}
          {onOpenRun !== undefined && (
            <>{' '}<button type="button" data-testid="requirements-open-mapping-job" className="wk-link" onClick={() => onOpenRun(mapping.runId)}>Open the job</button></>
          )}
        </p>
      )}
      <p className="wk-req-none-body">
        Once it is generated, this lists what {repoName} does as requirements, grouped by business domain: each one with
        the code that implements it, its business rules, and whether it carries risk. You can search, filter and edit
        them here.
      </p>
      {(mapping === null || mapping === 'unknown' || empty) && (
        <div className="wk-req-none-actions">
          <button type="button" data-testid="requirements-generate" className="wk-btn wk-btn--primary" onClick={() => onGenerate(workflow)}>
            {share !== null && share.real > 0 ? 'Keep mapping' : 'Generate it'}
          </button>
          <span className="wk-field-note">
            Opens a new {workflowLabel(workflow)} job for this repository, filled in. It maps page after page until the
            target, and asks before it spends more. Nothing starts until you launch it.
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * The graph's one coverage line (operator 2026-11-01: one set of numbers): the REAL-requirements share against the
 * minimum and what the rest of the behaviour is. Nothing renders for a graph (or a daemon) from before these fields.
 */
function GraphCoverage({ page }: { page: RequirementsPage }): React.ReactElement | null {
  const cov = coverageOf(page);
  if (cov === null) return null;
  // When the list is an older graph build than the store the header counts, it says so (crew 0.165.0 graphBuild).
  const behind = graphBuildNote(cov, graphBuildOf(page));
  // Rules and placeholders on type shapes are listed but not in the share (crew 0.167.0): said once, here.
  const uncounted = uncountedLine(pageUncountedOf(page));
  // Its own row under the title row, at every width: the breakdown is a sentence, not a chip.
  return (
    <div className="order-last basis-full min-w-0">
      <RequirementsCoverageSummary coverage={cov} inline />
      {behind !== null && (
        <p data-testid="requirements-graph-behind" className="text-xs mt-1" style={{ color: 'var(--status-warn)' }}>{behind}</p>
      )}
      {uncounted !== null && <p data-testid="requirements-uncounted" className="text-xs mt-1" style={{ color: T.muted }}>{uncounted}</p>}
    </div>
  );
}

/** An item's mark: validated (with its count of independent sources) or unconfirmed. */
function CorroborationMark({ req }: { req: unknown }): React.ReactElement | null {
  const c = corroborationOf(req);
  if (c === null) return null;
  const validated = c.status === 'validated';
  return (
    <span
      data-testid="requirement-corroboration"
      data-status={c.status}
      className="text-xs px-1.5 py-0.5 rounded shrink-0"
      style={{
        background: validated ? 'var(--status-ok-dim)' : 'var(--status-warn-dim)',
        color: validated ? 'var(--status-ok)' : 'var(--status-warn)',
      }}
      title={corroborationSentence(c)}
    >
      {validated ? `validated · ${c.sources}` : 'unconfirmed'}
    </span>
  );
}

function summaryOf(d: RequirementDetail): RequirementSummary {
  return {
    key: d.key,
    domain: d.domain,
    reqId: d.reqId,
    title: d.title,
    category: d.category,
    statement: d.statement,
    status: d.status,
    risk: d.risk,
    riskSource: d.riskSource,
    edited: d.edited,
  };
}

function RequirementRow({
  req,
  selected,
  onSelect,
}: {
  req: RequirementSummary;
  selected: boolean;
  onSelect: () => void;
}): React.ReactElement {
  const placeholder = isPlaceholder(req);
  const uncounted = uncountedOf(req);
  return (
    <button
      type="button"
      onClick={onSelect}
      data-testid="requirement-row"
      data-placeholder={placeholder ? 'true' : 'false'}
      className="wk-req-row"
      style={{ background: selected ? T.canvas2 : 'transparent', borderColor: T.hairline }}
    >
      <span className="wk-req-row-id font-mono" style={{ color: T.faint }}>{req.reqId}</span>
      <span className="wk-req-row-main">
        <span className="block text-sm font-semibold truncate" style={{ color: T.ink }}>{req.title}</span>
        {req.statement.trim() !== '' && (
          <span className="block text-xs truncate" style={{ color: T.muted }}>{req.statement.trim()}</span>
        )}
        <span className="block text-xs truncate" style={{ color: T.faint }}>{req.domain}</span>
        {!placeholder && uncounted === null && <UnconfirmedWhy req={req} />}
      </span>
      {/* The chips stack under the title on a narrow screen (operator 2026-11-01: titles collapsed beside them). */}
      <span className="wk-req-row-chips">
        {uncounted !== null ? <NotCountedMark why={uncounted} /> : placeholder ? <PlaceholderMark /> : <CorroborationMark req={req} />}
        {req.edited && (
          <span className="text-xs px-1.5 py-0.5 rounded shrink-0" style={{ background: T.surface2, color: T.link }}>
            edited
          </span>
        )}
        {req.risk && (
          <span
            className="text-xs font-semibold px-1.5 py-0.5 rounded shrink-0"
            style={{ background: 'var(--status-fail-dim)', color: T.deny }}
            title={req.riskSource === 'operator' ? 'Marked risk by operator' : 'placeholder: the engine does not resolve it'}
          >
            risk{req.riskSource === 'operator' ? ' ●' : ''}
          </span>
        )}
        <span
          className="text-xs px-1.5 py-0.5 rounded shrink-0"
          style={{
            background: req.status === 'active' ? 'var(--status-run-dim)' : req.status === 'deprecated' ? 'var(--status-fail-dim)' : T.surface2,
            color: req.status === 'active' ? T.ok : req.status === 'deprecated' ? T.deny : T.muted,
          }}
        >
          {req.status}
        </span>
      </span>
    </button>
  );
}

/** Not counted in the coverage share (crew 0.167.0): a type shape, code that is not the product, or an unindexed
 *  file. It stands instead of any corroboration or placeholder mark, which would be about a share it is not in. */
function NotCountedMark({ why }: { why: keyof typeof UNCOUNTED_TITLE }): React.ReactElement {
  return (
    <span
      data-testid="requirement-not-counted"
      data-why={why}
      className="text-xs px-1.5 py-0.5 rounded shrink-0"
      style={{ background: T.surface2, color: T.muted }}
      title={UNCOUNTED_TITLE[why]}
    >
      not counted
    </span>
  );
}

/** A placeholder's mark: unconfirmed by definition, so never a corroboration badge ("validated · 2" on an empty
 *  statement contradicted itself; operator 2026-11-01). */
function PlaceholderMark(): React.ReactElement {
  return (
    <span
      data-testid="requirement-placeholder"
      className="text-xs px-1.5 py-0.5 rounded shrink-0"
      style={{ background: 'var(--status-warn-dim)', color: 'var(--status-warn)' }}
      title={PLACEHOLDER_NOTE}
    >
      placeholder
    </span>
  );
}

/** The reason an item is unconfirmed, shown on the item itself (operator ruling 2026-10-31). */
function UnconfirmedWhy({ req }: { req: unknown }): React.ReactElement | null {
  const c = corroborationOf(req);
  if (c === null || c.status !== 'unconfirmed' || c.why === undefined) return null;
  return (
    <span
      data-testid="requirement-unconfirmed-why"
      data-code={c.why.code}
      className="block text-xs"
      // Two lines, not one: on a phone a one-line clip would cut the reason down to its first word.
      style={{ color: 'var(--status-warn)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
      title={c.why.text}
    >
      Unconfirmed: {c.why.text}
    </span>
  );
}

function RequirementEditRail({
  repoId,
  reqKey,
  onClose,
  onSaved,
  onNavigateComponent,
}: {
  repoId: string;
  reqKey: string;
  onClose: () => void;
  onSaved: (d: RequirementDetail) => void;
  onNavigateComponent?: ((symbol: string) => void) | undefined;
}): React.ReactElement {
  const [detail, setDetail] = useState<RequirementDetail | null>(null);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState<'active' | 'deprecated' | 'review'>('active');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDetail(null);
    setSavedAt(null);
    setError(null);
    api
      .getRequirement(repoId, reqKey)
      .then(({ requirement }) => {
        setDetail(requirement);
        setTitle(requirement.title);
        setNotes(requirement.notes);
        setStatus(
          requirement.status === 'deprecated' || requirement.status === 'review'
            ? requirement.status
            : 'active',
        );
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [repoId, reqKey]);

  function save(extra?: RequirementPatch): void {
    if (detail === null) return;
    const patch: RequirementPatch = { ...extra };
    if (title !== detail.title) patch.title = title;
    if (notes !== detail.notes) patch.notes = notes;
    if (status !== detail.status) patch.status = status;
    if (Object.keys(patch).length === 0) return;
    setSaving(true);
    setError(null);
    api
      .patchRequirement(repoId, reqKey, patch)
      .then(({ requirement }) => {
        setDetail(requirement);
        setTitle(requirement.title);
        setNotes(requirement.notes);
        setStatus(
          requirement.status === 'deprecated' || requirement.status === 'review'
            ? requirement.status
            : 'active',
        );
        onSaved(requirement);
        setSavedAt(Date.now());
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setSaving(false));
  }

  function toggleRisk(): void {
    if (detail === null) return;
    setSaving(true);
    setError(null);
    api
      .patchRequirement(repoId, reqKey, { risk: !detail.risk })
      .then(({ requirement }) => {
        setDetail(requirement);
        onSaved(requirement);
        setSavedAt(Date.now());
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setSaving(false));
  }

  return (
    <div className="w-[420px] shrink-0 border-l flex flex-col" style={{ borderColor: T.hairlineS, background: T.surface2 }}>
      <div className="px-4 py-2.5 border-b flex items-center gap-2 shrink-0" style={{ borderColor: T.hairline, background: T.canvas2 }}>
        <span className="text-xs font-mono truncate" style={{ color: T.ink }}>{reqKey}</span>
        <button type="button" onClick={onClose} aria-label="Close requirement editor" className="ml-auto text-sm px-1 shrink-0" style={{ color: T.muted }}>
          ×
        </button>
      </div>
      {error !== null && <p className="text-xs px-4 py-2" style={{ color: T.deny }}>{error}</p>}
      {detail === null && error === null ? (
        <p className="text-xs px-4 py-3" style={{ color: T.faint }}>Loading…</p>
      ) : detail !== null ? (
        <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs" style={{ color: T.faint }}>Title</span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="text-xs px-3 py-1.5 rounded-lg border outline-none"
              style={{ border: `1px solid ${T.hairlineS}`, background: T.canvas2, color: T.ink }}
            />
          </label>
          {detail.title !== detail.sourceTitle && (
            <p className="text-xs" style={{ color: T.faint }}>source title: {detail.sourceTitle}</p>
          )}
          <div>
            <span className="text-xs" style={{ color: T.faint }}>Description (source)</span>
            <p className="text-xs mt-1 whitespace-pre-wrap" style={{ color: T.muted }}>
              {detail.description === '' ? '(none recorded)' : detail.description.slice(0, 1200)}
            </p>
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-xs" style={{ color: T.faint }}>Notes (operator)</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              className="text-xs px-3 py-1.5 rounded-lg border outline-none resize-y"
              style={{ border: `1px solid ${T.hairlineS}`, background: T.canvas2, color: T.ink }}
            />
          </label>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2">
              <span className="text-xs" style={{ color: T.faint }}>Status</span>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as 'active' | 'deprecated' | 'review')}
                className="text-xs px-2 py-1 rounded-lg border outline-none"
                style={{ border: `1px solid ${T.hairlineS}`, background: T.canvas2, color: T.ink }}
              >
                <option value="active">active</option>
                <option value="review">review</option>
                <option value="deprecated">deprecated</option>
              </select>
            </label>
            <button
              type="button"
              onClick={toggleRisk}
              disabled={saving}
              className="text-xs font-semibold px-3 py-1 rounded-lg disabled:opacity-50"
              style={{
                background: detail.risk ? 'var(--status-fail-dim)' : T.canvas2,
                color: detail.risk ? T.deny : T.muted,
                border: `1px solid ${T.hairlineS}`,
              }}
            >
              {detail.risk ? '⚑ Risk (clear)' : '⚑ Mark as risk'}
            </button>
          </div>
          {detail.riskSource === 'data' && (
            <p className="text-xs" style={{ color: T.faint }}>
              risk derived from business rules — an operator toggle overrides it
            </p>
          )}
          {detail.businessRules.length > 0 && (
            <div>
              <span className="text-xs" style={{ color: T.faint }}>Business rules</span>
              <ol className="mt-1 flex flex-col gap-1.5">
                {detail.businessRules.map((r, i) => {
                  const rule = r as { statement?: unknown; confidence?: unknown };
                  const raw = typeof rule.statement === 'string' ? rule.statement.trim() : '';
                  const st = raw !== '' ? raw : JSON.stringify(r);
                  const conf = typeof rule.confidence === 'number' ? rule.confidence : null;
                  return (
                    <li key={i} className="text-xs leading-snug" style={{ color: T.ink }}>
                      {st}
                      {conf !== null && (
                        <span className="text-xs ml-1.5" style={{ color: T.faint }}>conf {conf}</span>
                      )}
                    </li>
                  );
                })}
              </ol>
            </div>
          )}
          <RailCorroboration detail={detail} />
          <div className="text-xs tabular-nums flex gap-3 flex-wrap" style={{ color: T.faint }}>
            <span>{detail.ruleCount} rules</span>
            <span>{detail.componentCount} components</span>
            <span>{detail.validationCount} validations</span>
            <span>{detail.errorPathCount} error paths</span>
          </div>
          {detail.legacyComponents.length > 0 && (
            <div>
              <span className="text-xs" style={{ color: T.faint }}>Components</span>
              <ul className="mt-1 flex flex-col gap-0.5">
                {detail.legacyComponents.map((c, i) => {
                  const label = typeof c === 'string' ? c : JSON.stringify(c);
                  // 'path#symbol' components navigate by the symbol part; bare paths by themselves.
                  const symbol = typeof c === 'string' ? (c.includes('#') ? c.split('#')[1]! : c) : '';
                  return (
                    <li key={i} className="text-xs font-mono truncate">
                      {onNavigateComponent !== undefined && symbol !== '' ? (
                        <button
                          type="button"
                          onClick={() => onNavigateComponent(symbol)}
                          className="hover:underline text-left truncate w-full"
                          style={{ color: T.link }}
                          title={`Open ${label} in the code graph`}
                        >
                          {label} →
                        </button>
                      ) : (
                        <span style={{ color: T.muted }}>{label}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          <div className="flex items-center gap-3 mt-1">
            <button
              type="button"
              onClick={() => save()}
              disabled={saving}
              className="px-4 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50"
              style={{ background: T.accent, color: 'var(--surface-base)' }}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            {savedAt !== null && !saving && (
              <span className="text-xs" style={{ color: T.ok }}>saved ✓</span>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function RailCorroboration({ detail }: { detail: RequirementDetail }): React.ReactElement | null {
  if (isPlaceholder(detail)) {
    return (
      <div data-testid="requirement-rail-corroboration" data-status="placeholder">
        <span className="text-xs" style={{ color: T.faint }}>Placeholder</span>
        <p className="text-xs mt-1" style={{ color: 'var(--status-warn)' }}>{PLACEHOLDER_NOTE}</p>
      </div>
    );
  }
  const c = corroborationOf(detail);
  if (c === null) return null;
  return (
    <div data-testid="requirement-rail-corroboration" data-status={c.status}>
      <span className="text-xs" style={{ color: T.faint }}>
        {c.status === 'validated' ? 'Validated' : 'Unconfirmed'}
      </span>
      <p className="text-xs mt-1" style={{ color: c.status === 'validated' ? T.ink : 'var(--status-warn)' }}>
        {corroborationSentence(c)}
      </p>
    </div>
  );
}
