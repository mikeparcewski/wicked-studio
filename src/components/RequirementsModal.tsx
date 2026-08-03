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

const T = {
  canvas: '#0d1117',
  canvas2: '#121826',
  surface: '#151b2c',
  surface2: '#161d2f',
  ink: '#e6edf3',
  muted: 'rgba(230,237,243,0.6)',
  faint: 'rgba(230,237,243,0.35)',
  hairline: 'rgba(230,237,243,0.08)',
  hairlineS: 'rgba(230,237,243,0.14)',
  ok: '#3fb950',
  deny: '#f85149',
  link: '#79c0ff',
  accent: '#ffda19',
};

const PAGE_SIZE = 50;

interface Props {
  repoId: string;
  repoName: string;
  onClose: () => void;
  /** Navigate to a component symbol in the code graph (requirement → code). */
  onNavigateComponent?: (symbol: string) => void;
}

export function RequirementsModal({ repoId, repoName, onClose, onNavigateComponent }: Props): React.ReactElement {
  const [query, setQuery] = useState('');
  const [risk, setRisk] = useState<'all' | 'risk' | 'no-risk'>('all');
  // Functional by default: statements extracted from lockfiles/manifests/data fixtures
  // are honest but they're about the tooling, not the product.
  const [category, setCategory] = useState<'functional' | 'config-data' | 'all'>('functional');
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<RequirementsPage | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
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
        })
        .catch((e: unknown) => setLoadError(e instanceof Error ? e.message : String(e)));
    },
    [repoId],
  );

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

  const totalPages = page !== null ? Math.max(1, Math.ceil(page.total / PAGE_SIZE)) : 1;
  const pageNo = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.6)' }}>
      <div
        className="w-[92vw] h-[92vh] rounded-2xl flex flex-col overflow-hidden border"
        style={{ background: T.surface, border: `1px solid ${T.hairlineS}` }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-3 border-b shrink-0" style={{ borderColor: T.hairline, background: T.canvas2 }}>
          <span className="font-mono text-sm font-semibold" style={{ color: T.ink }}>{repoName}</span>
          <span className="font-mono text-[11px] px-2 py-0.5 rounded" style={{ background: T.surface2, color: T.muted }}>
            requirements
          </span>
          {page !== null && (
            <span className="font-mono text-[11px]" style={{ color: T.faint }}>
              {page.total === page.corpus
                ? `${page.corpus} total`
                : `${page.total} matching · ${page.corpus} total`}
            </span>
          )}
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

        {/* Toolbar: search (server-side) + risk filter */}
        <div className="flex items-center gap-3 px-5 py-2.5 border-b shrink-0" style={{ borderColor: T.hairline }}>
          <input
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOffset(0);
            }}
            placeholder="Search requirements (server-side: id, domain, title, description)…"
            className="flex-1 text-[12px] font-mono px-3 py-1.5 rounded-lg border outline-none"
            style={{ border: `1px solid ${T.hairlineS}`, background: T.canvas2, color: T.ink }}
          />
          <div className="flex items-center gap-1" role="group" aria-label="Category filter">
            {(['functional', 'config-data', 'all'] as const).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategoryFilter(c)}
                aria-pressed={category === c}
                className="px-2.5 py-1 rounded-lg text-[11px] font-mono font-semibold"
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
          <div className="w-px h-4" style={{ background: T.hairline }} />
          <div className="flex items-center gap-1" role="group" aria-label="Risk filter">
            {(['all', 'risk', 'no-risk'] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setFilter(r)}
                aria-pressed={risk === r}
                className="px-2.5 py-1 rounded-lg text-[11px] font-mono font-semibold"
                style={{
                  background: risk === r ? (r === 'risk' ? 'rgba(248,81,73,0.18)' : T.surface2) : 'transparent',
                  color: risk === r ? (r === 'risk' ? T.deny : T.ink) : T.faint,
                  border: `1px solid ${risk === r ? T.hairlineS : 'transparent'}`,
                }}
              >
                {r === 'all' ? 'All' : r === 'risk' ? 'Risk' : 'No risk'}
              </button>
            ))}
          </div>
        </div>

        {/* Body: list + edit rail */}
        <div className="flex-1 flex overflow-hidden">
          <div className="flex-1 overflow-y-auto">
            {loadError !== null ? (
              <p className="text-[12px] font-mono p-6" style={{ color: T.deny }}>{loadError}</p>
            ) : page === null ? (
              <p className="text-[12px] font-mono p-6" style={{ color: T.faint }}>Loading…</p>
            ) : page.corpus === 0 ? (
              // An EMPTY CORPUS is not a failed search. "No requirements match" asserts that
              // something was searched and the filters excluded it — for a repo whose extraction
              // has never run, that sentence is false and it hides the only action that would
              // help. `corpus === 0` means there is nothing to search at all, so no filter can be
              // responsible and the distinction is decidable here (FINDING-065).
              <div className="p-6 space-y-1">
                <p className="text-[12px] font-mono" style={{ color: T.ink }}>
                  No requirements have been extracted for this repo.
                </p>
                <p className="text-[12px] font-mono" style={{ color: T.faint }}>
                  Run domain extraction on it to populate this view.
                </p>
              </div>
            ) : page.items.length === 0 ? (
              <p className="text-[12px] font-mono p-6" style={{ color: T.faint }}>No requirements match.</p>
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
            {page !== null && page.total > PAGE_SIZE && (
              <div className="flex items-center justify-center gap-4 py-3">
                <button
                  type="button"
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                  className="text-[11px] font-mono px-3 py-1 rounded disabled:opacity-40"
                  style={{ color: T.link }}
                >
                  ← Prev
                </button>
                <span className="text-[11px] font-mono" style={{ color: T.faint }}>
                  page {pageNo} of {totalPages}
                </span>
                <button
                  type="button"
                  disabled={offset + PAGE_SIZE >= page.total}
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                  className="text-[11px] font-mono px-3 py-1 rounded disabled:opacity-40"
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
  return (
    <button
      type="button"
      onClick={onSelect}
      className="w-full text-left px-5 py-2.5 flex items-center gap-3 shrink-0"
      style={{ background: selected ? T.canvas2 : 'transparent', borderColor: T.hairline }}
    >
      <span className="text-[10px] font-mono shrink-0 w-16" style={{ color: T.faint }}>{req.reqId}</span>
      <span className="flex-1 min-w-0">
        <span className="block text-[12px] truncate" style={{ color: T.ink }}>{req.title}</span>
        {req.statement.trim() !== '' && (
          <span className="block text-[11px] truncate" style={{ color: T.muted }}>{req.statement.trim()}</span>
        )}
        <span className="block text-[10px] font-mono truncate" style={{ color: T.faint }}>{req.domain}</span>
      </span>
      {req.edited && (
        <span className="text-[9px] uppercase font-mono px-1.5 py-0.5 rounded shrink-0" style={{ background: T.surface2, color: T.link }}>
          edited
        </span>
      )}
      {req.risk && (
        <span
          className="text-[9px] uppercase font-semibold font-mono px-1.5 py-0.5 rounded shrink-0"
          style={{ background: 'rgba(248,81,73,0.15)', color: T.deny }}
          title={req.riskSource === 'operator' ? 'Marked risk by operator' : 'Risk derived from business rules'}
        >
          risk{req.riskSource === 'operator' ? ' ●' : ''}
        </span>
      )}
      <span
        className="text-[9px] uppercase font-mono px-1.5 py-0.5 rounded shrink-0"
        style={{
          background: req.status === 'active' ? 'rgba(63,185,80,0.12)' : req.status === 'deprecated' ? 'rgba(248,81,73,0.12)' : T.surface2,
          color: req.status === 'active' ? T.ok : req.status === 'deprecated' ? T.deny : T.muted,
        }}
      >
        {req.status}
      </span>
    </button>
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
        <span className="text-[11px] font-mono truncate" style={{ color: T.ink }}>{reqKey}</span>
        <button type="button" onClick={onClose} aria-label="Close requirement editor" className="ml-auto text-sm px-1 shrink-0" style={{ color: T.muted }}>
          ×
        </button>
      </div>
      {error !== null && <p className="text-[11px] font-mono px-4 py-2" style={{ color: T.deny }}>{error}</p>}
      {detail === null && error === null ? (
        <p className="text-[11px] font-mono px-4 py-3" style={{ color: T.faint }}>Loading…</p>
      ) : detail !== null ? (
        <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-mono uppercase" style={{ color: T.faint }}>Title</span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="text-[12px] font-mono px-3 py-1.5 rounded-lg border outline-none"
              style={{ border: `1px solid ${T.hairlineS}`, background: T.canvas2, color: T.ink }}
            />
          </label>
          {detail.title !== detail.sourceTitle && (
            <p className="text-[10px] font-mono" style={{ color: T.faint }}>source title: {detail.sourceTitle}</p>
          )}
          <div>
            <span className="text-[10px] font-mono uppercase" style={{ color: T.faint }}>Description (source)</span>
            <p className="text-[11px] mt-1 whitespace-pre-wrap" style={{ color: T.muted }}>
              {detail.description === '' ? '(none recorded)' : detail.description.slice(0, 1200)}
            </p>
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-mono uppercase" style={{ color: T.faint }}>Notes (operator)</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              className="text-[11px] font-mono px-3 py-1.5 rounded-lg border outline-none resize-y"
              style={{ border: `1px solid ${T.hairlineS}`, background: T.canvas2, color: T.ink }}
            />
          </label>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2">
              <span className="text-[10px] font-mono uppercase" style={{ color: T.faint }}>Status</span>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as 'active' | 'deprecated' | 'review')}
                className="text-[11px] font-mono px-2 py-1 rounded-lg border outline-none"
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
              className="text-[11px] font-mono font-semibold px-3 py-1 rounded-lg disabled:opacity-50"
              style={{
                background: detail.risk ? 'rgba(248,81,73,0.18)' : T.canvas2,
                color: detail.risk ? T.deny : T.muted,
                border: `1px solid ${T.hairlineS}`,
              }}
            >
              {detail.risk ? '⚑ Risk (clear)' : '⚑ Mark as risk'}
            </button>
          </div>
          {detail.riskSource === 'data' && (
            <p className="text-[10px] font-mono" style={{ color: T.faint }}>
              risk derived from business rules — an operator toggle overrides it
            </p>
          )}
          {detail.businessRules.length > 0 && (
            <div>
              <span className="text-[10px] font-mono uppercase" style={{ color: T.faint }}>Business rules</span>
              <ol className="mt-1 flex flex-col gap-1.5">
                {detail.businessRules.map((r, i) => {
                  const rule = r as { statement?: unknown; confidence?: unknown };
                  const raw = typeof rule.statement === 'string' ? rule.statement.trim() : '';
                  const st = raw !== '' ? raw : JSON.stringify(r);
                  const conf = typeof rule.confidence === 'number' ? rule.confidence : null;
                  return (
                    <li key={i} className="text-[11px] leading-snug" style={{ color: T.ink }}>
                      {st}
                      {conf !== null && (
                        <span className="text-[9px] font-mono ml-1.5" style={{ color: T.faint }}>conf {conf}</span>
                      )}
                    </li>
                  );
                })}
              </ol>
            </div>
          )}
          <div className="text-[10px] font-mono flex gap-3 flex-wrap" style={{ color: T.faint }}>
            <span>{detail.ruleCount} rules</span>
            <span>{detail.componentCount} components</span>
            <span>{detail.validationCount} validations</span>
            <span>{detail.errorPathCount} error paths</span>
          </div>
          {detail.legacyComponents.length > 0 && (
            <div>
              <span className="text-[10px] font-mono uppercase" style={{ color: T.faint }}>Components</span>
              <ul className="mt-1 flex flex-col gap-0.5">
                {detail.legacyComponents.map((c, i) => {
                  const label = typeof c === 'string' ? c : JSON.stringify(c);
                  // 'path#symbol' components navigate by the symbol part; bare paths by themselves.
                  const symbol = typeof c === 'string' ? (c.includes('#') ? c.split('#')[1]! : c) : '';
                  return (
                    <li key={i} className="text-[10px] font-mono truncate">
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
              className="px-4 py-1.5 rounded-lg text-[12px] font-mono font-semibold disabled:opacity-50"
              style={{ background: T.accent, color: '#0d1117' }}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            {savedAt !== null && !saving && (
              <span className="text-[10px] font-mono" style={{ color: T.ok }}>saved ✓</span>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
