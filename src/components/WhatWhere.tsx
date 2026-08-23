import type { RunModel } from '../hooks/useRunModel.js';
import type { Provenance } from '../store/provenance.js';
import { ProvenanceLine } from './ProvenanceLine.js';

interface Props {
  model: RunModel;
  /** Derived audit provenance (DES-UX-001 §3.3) — `null`/absent degrades honestly. */
  provenance?: Provenance | null;
  /** Forward lineage: run ids the loaded index shows as retries of this run (§4.3). */
  retriedAs?: readonly string[];
  onSelectRun?: (id: string) => void;
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }): React.ReactElement {
  return (
    <div className="flex gap-2 text-[11px]">
      <span className="w-20 shrink-0 font-mono" style={{ color: 'var(--ink-dim)' }}>{label}</span>
      <span
        className={mono ? 'font-mono break-all' : ''}
        style={{ color: 'var(--ink-muted)' }}
      >
        {value}
      </span>
    </div>
  );
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
      <Row label="intent" value={session.problem} />
      <Row label="repo" value={session.repo_ref ?? '—'} mono />
      <Row label="worktree" value={session.workdir ?? '—'} mono />
      <Row label="roster" value={session.clis.length > 0 ? session.clis.join(', ') : '—'} mono />
      <Row label="entity" value={session.entity_mode} />
      <div
        className="mt-1 rounded p-1.5 text-[10px] font-mono"
        style={{ border: '1px dashed var(--surface-raised)', color: 'var(--ink-dim)' }}
      >
        diff: not exposed on the run DTO (<code>work_output</code> pending daemon surface)
      </div>
    </div>
  );
}
