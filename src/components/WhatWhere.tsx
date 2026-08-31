import type { RunModel } from '../hooks/useRunModel.js';
import type { Provenance } from '../store/provenance.js';
import { ProvenanceLine } from './ProvenanceLine.js';
import { RunTimes } from './runIdentity.js';

interface Props {
  model: RunModel;
  /** Derived audit provenance (DES-UX-001 §3.3) — `null`/absent degrades honestly. */
  provenance?: Provenance | null;
  /** Forward lineage: run ids the loaded index shows as retries of this run (§4.3). */
  retriedAs?: readonly string[];
  onSelectRun?: (id: string) => void;
}

function Row({ label, value, mono, title }: {
  label: string; value: string; mono?: boolean; title?: string;
}): React.ReactElement {
  return (
    <div className="flex gap-2 text-[11px]">
      <span className="w-20 shrink-0 font-mono" style={{ color: 'var(--ink-dim)' }}>{label}</span>
      <span
        className={mono ? 'font-mono break-all' : ''}
        style={{ color: 'var(--ink-muted)' }}
        {...(title !== undefined ? { title } : {})}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * §7.10 (slice X2): long absolute worktree paths retire from the visible text —
 * the 5-line /private/var wrap read as debug output. The visible value is the
 * path's meaningful tail; the full path stays one hover away (title).
 */
export function compactPath(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/').filter((s) => s !== '');
  if (parts.length <= 3) return p;
  return `…/${parts.slice(-2).join('/')}`;
}

export function WhatWhere({ model, provenance, retriedAs, onSelectRun }: Props): React.ReactElement {
  const { session } = model;

  return (
    <div data-testid="what-where" className="flex flex-col gap-1.5">
      {/* The provenance line — FIRST row of the card (DES-UX-001 §3.3): who or
          what launched this run, degrading to "launched via API (actor
          unknown)" rather than omitting the line. Lineage cross-links (§4.3)
          ride inside it. */}
      <ProvenanceLine
        provenance={provenance ?? null}
        retryOf={session.retry_of}
        retriedAs={retriedAs}
        onSelectRun={onSelectRun}
        testId="run-provenance"
      />
      {/* The when block (started · ended · duration) — moved here from the run
          header strip (DES-RUN-NARRATOR §8, revised 2026-08-31): the header
          condensed to one row and this is where the run's context rows live. */}
      <RunTimes runId={session.id} status={session.status} />
      <Row label="intent" value={session.problem} />
      <Row label="repo" value={session.repo_ref ?? '—'} mono />
      {/* §7.10: the compact tail, full path on hover — never the 5-line wrap.
          The DTO debug note that used to sit below ("work_output pending daemon
          surface") is retired: internal notes are not user copy; the diff lives
          behind Files → Full diff. */}
      <Row
        label="worktree"
        value={session.workdir !== undefined && session.workdir !== null ? compactPath(session.workdir) : '—'}
        mono
        {...(session.workdir !== undefined && session.workdir !== null ? { title: session.workdir } : {})}
      />
      <Row label="roster" value={session.clis.length > 0 ? session.clis.join(', ') : '—'} mono />
      <Row label="entity" value={session.entity_mode} />
    </div>
  );
}
