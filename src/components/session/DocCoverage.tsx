import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api/client.js';
import type { RequirementsPage } from '../../api/types.js';
import { anchorWords, coverageLine, coverageOf, requirementChip, type CoverageRow } from '../../board/artifactMorph.js';
import { addAboutChip } from '../../store/composerChips.js';
import type { FrameParts } from './PageEditor.js';

/**
 * S9 — the coverage slot of the document editor (DES-STUDIO-REBUILD-001 §11 S9). It renders only
 * where `GET /repos/:id/requirements` serves requirements for the run's repository, and what it
 * shows IS that read: the same rows, the same total. A run with no repository, a read that fails
 * or a repository with no requirements leaves the slot absent — never an empty panel, never a
 * made-up meter.
 *
 * Beside each requirement: where this document names it (its id, as a whole word, in a block of
 * text — a click goes there), or that it does not. "Named" is all the text can show; whether a
 * requirement is answered is the RFP chain's read, which is not built.
 */
const cache = new Map<string, { at: number; page: Promise<RequirementsPage | null> }>();
const FRESH_MS = 30_000;
const PAGE = 50;

function requirementsOf(repoId: string): Promise<RequirementsPage | null> {
  const hit = cache.get(repoId);
  if (hit !== undefined && Date.now() - hit.at < FRESH_MS) return hit.page;
  const page = api.listRequirements(repoId, { limit: PAGE }).catch(() => { cache.delete(repoId); return null; });
  cache.set(repoId, { at: Date.now(), page });
  return page;
}

/** Test seam. */
export function resetDocCoverageCache(): void {
  cache.clear();
}

export function DocCoverage({ parts, repoId, composerKey }: {
  parts: FrameParts;
  repoId: string;
  composerKey: string;
}): React.ReactElement | null {
  const [page, setPage] = useState<RequirementsPage | null>(null);
  useEffect(() => {
    let cancelled = false;
    setPage(null);
    void requirementsOf(repoId).then((p) => { if (!cancelled) setPage(p); });
    return () => { cancelled = true; };
  }, [repoId]);
  const rows = useMemo(
    () => (page === null || !Array.isArray(page.items) ? [] : coverageOf(page.items.map((r) => ({ key: r.key, reqId: r.reqId, title: r.title, risk: r.risk })), parts.blocks)),
    [page, parts.blocks],
  );
  if (page === null || rows.length === 0) return null;
  const total = typeof page.total === 'number' ? page.total : rows.length;
  const missing = rows.filter((r) => r.wid === null);
  const named = rows.filter((r) => r.wid !== null);
  const row = (r: CoverageRow): React.ReactElement => (
    <button
      key={r.key}
      type="button"
      data-testid="doc-coverage-row"
      data-key={r.key}
      data-req={r.reqId}
      data-named={r.wid !== null}
      className="wk-cov-row"
      onClick={() => {
        addAboutChip(composerKey, requirementChip(r));
        if (r.wid !== null) parts.pick(r.wid);
      }}
    >
      <span className="wk-cov-id">{r.reqId}</span>
      <span className="wk-cov-title">
        {r.title}
        {r.risk && <span className="wk-cov-risk"> · at risk</span>}
        {r.wid !== null && <span className="wk-cov-where"> · {anchorWords(r.wid, 'document')}</span>}
      </span>
    </button>
  );
  return (
    <aside data-testid="doc-coverage" data-repo={repoId} data-total={total} data-rows={rows.length} data-named={named.length} aria-label="Requirements" className="wk-artifact-side wk-cov">
      <b className="wk-cov-head">Requirements</b>
      <p data-testid="doc-coverage-line" className="wk-cov-line">{coverageLine(rows, total)} · from {repoId}</p>
      {missing.length > 0 && <p className="wk-cov-group">Not named ({missing.length})</p>}
      {missing.map(row)}
      {named.length > 0 && <p className="wk-cov-group">Named ({named.length})</p>}
      {named.map(row)}
    </aside>
  );
}
