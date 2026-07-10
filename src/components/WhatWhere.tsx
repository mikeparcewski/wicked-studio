import type { RunModel } from '../hooks/useRunModel.js';

interface Props {
  model: RunModel;
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }): React.ReactElement {
  return (
    <div className="flex gap-2">
      <span className="w-20 shrink-0 text-gray-400">{label}</span>
      <span className={`text-gray-700 ${mono ? 'font-mono break-all' : ''}`}>{value}</span>
    </div>
  );
}

/**
 * FR-8 What/Where. The run's intent, target repo, git worktree, and roster — all from the
 * snapshot's `AgentSession`. The diff (`work_output`) is not exposed on the current daemon
 * DTO, so it is labeled honestly rather than faked (NFR-1/NFR-3).
 */
export function WhatWhere({ model }: Props): React.ReactElement {
  const { session } = model;

  return (
    <div data-testid="what-where" className="flex flex-col gap-1.5 text-[11px]">
      <Row label="intent" value={session.problem} />
      <Row label="repo" value={session.repo_ref ?? '—'} mono />
      <Row label="worktree" value={session.workdir ?? '—'} mono />
      <Row label="roster" value={session.clis.length > 0 ? session.clis.join(', ') : '—'} mono />
      <Row label="entity" value={session.entity_mode} />
      <div className="mt-1 rounded border border-dashed border-gray-300 bg-gray-50 p-1.5 text-gray-400">
        diff: not exposed on the run DTO (<code>work_output</code> pending daemon surface)
      </div>
    </div>
  );
}
