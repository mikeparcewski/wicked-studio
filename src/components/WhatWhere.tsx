import type { RunModel } from '../hooks/useRunModel.js';

interface Props {
  model: RunModel;
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }): React.ReactElement {
  return (
    <div className="flex gap-2 text-[11px]">
      <span className="w-20 shrink-0 font-mono" style={{ color: 'rgba(230,237,243,0.4)' }}>{label}</span>
      <span
        className={mono ? 'font-mono break-all' : ''}
        style={{ color: 'rgba(230,237,243,0.7)' }}
      >
        {value}
      </span>
    </div>
  );
}

export function WhatWhere({ model }: Props): React.ReactElement {
  const { session } = model;

  return (
    <div data-testid="what-where" className="flex flex-col gap-1.5">
      <Row label="intent" value={session.problem} />
      <Row label="repo" value={session.repo_ref ?? '—'} mono />
      <Row label="worktree" value={session.workdir ?? '—'} mono />
      <Row label="roster" value={session.clis.length > 0 ? session.clis.join(', ') : '—'} mono />
      <Row label="entity" value={session.entity_mode} />
      <div
        className="mt-1 rounded p-1.5 text-[10px] font-mono"
        style={{ border: '1px dashed rgba(230,237,243,0.12)', color: 'rgba(230,237,243,0.35)' }}
      >
        diff: not exposed on the run DTO (<code>work_output</code> pending daemon surface)
      </div>
    </div>
  );
}
