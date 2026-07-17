import { useState } from 'react';
import type { SessionView } from '../api/types.js';
import { api } from '../api/client.js';
import { useRunModel } from '../hooks/useRunModel.js';
import { AssumptionsPanel } from './AssumptionsPanel.js';
import { Burn } from './Burn.js';
import { CoverageView } from './CoverageView.js';
import { DataUsed } from './DataUsed.js';
import { DecisionsLedger } from './DecisionsLedger.js';
import { GovernanceAudit } from './GovernanceAudit.js';
import { Modal } from './Modal.js';
import { SteeringTimeline } from './SteeringTimeline.js';
import { Terminal } from './Terminal.js';
import { WhatWhere } from './WhatWhere.js';

interface Props {
  view: SessionView;
  onRefresh: () => void;
}

type AccordionId =
  | 'decisions'
  | 'governance'
  | 'burn'
  | 'data'
  | 'steering'
  | 'whatwhere'
  | 'assumptions';

const ACCORDIONS: { id: AccordionId; label: string }[] = [
  { id: 'decisions', label: 'Decisions' },
  { id: 'governance', label: 'Governance' },
  { id: 'burn', label: 'Burn' },
  { id: 'data', label: 'Data' },
  { id: 'steering', label: 'Steering' },
  { id: 'whatwhere', label: 'What / Where' },
  { id: 'assumptions', label: 'Assumptions' },
];

const TERMINAL_STATUSES = new Set(['completed', 'cancelled', 'failed']);

export function RightPanel({ view, onRefresh }: Props): React.ReactElement {
  const [collapsed, setCollapsed] = useState(false);
  const [openAccordion, setOpenAccordion] = useState<AccordionId | null>(null);
  const [termOpen, setTermOpen] = useState(false);
  const [coverageOpen, setCoverageOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const { session } = view;
  const model = useRunModel(session.id, view);
  const isTerminal = TERMINAL_STATUSES.has(session.status);
  const canKill = !isTerminal;

  async function killRun(): Promise<void> {
    if (!canKill) return;
    setCancelling(true);
    try {
      await api.cancelRun(session.id);
      onRefresh();
    } catch {
      // Cancel is best-effort — the run may already be terminal; refresh to sync state.
      onRefresh();
    } finally {
      setCancelling(false);
    }
  }

  function toggleAccordion(id: AccordionId): void {
    setOpenAccordion((prev) => (prev === id ? null : id));
  }

  if (collapsed) {
    return (
      <div className="flex flex-col items-center bg-zinc-50 border-l w-10 shrink-0 py-3 gap-2">
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="text-zinc-400 hover:text-zinc-700 text-sm leading-none"
          aria-label="Expand insights panel"
        >
          ‹
        </button>
        {canKill && (
          <button
            type="button"
            onClick={() => void killRun()}
            disabled={cancelling}
            title="Kill run"
            aria-label="Kill run"
            className="w-7 h-7 flex items-center justify-center rounded hover:bg-red-100 text-red-500 text-sm disabled:opacity-40"
          >
            ✕
          </button>
        )}
        <button
          type="button"
          onClick={() => setTermOpen(true)}
          title="Terminal"
          aria-label="Open terminal"
          className="w-7 h-7 flex items-center justify-center rounded hover:bg-zinc-200 text-zinc-500 text-sm"
        >
          ⬛
        </button>
        <button
          type="button"
          onClick={() => setCoverageOpen(true)}
          title="Coverage"
          aria-label="Open coverage"
          className="w-7 h-7 flex items-center justify-center rounded hover:bg-zinc-200 text-zinc-500 text-sm"
        >
          %
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col bg-zinc-50 border-l w-72 shrink-0 overflow-hidden">
      {/* Header: expand/collapse + action buttons */}
      <div className="flex items-center gap-1 px-3 py-2 border-b bg-white shrink-0">
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          className="text-zinc-400 hover:text-zinc-700 text-sm leading-none mr-1"
          aria-label="Collapse insights panel"
        >
          ›
        </button>
        <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 flex-1">
          Insights
        </span>
        {/* Action buttons */}
        <button
          type="button"
          onClick={() => void killRun()}
          disabled={!canKill || cancelling}
          title="Kill run (Ctrl+K)"
          aria-label="Kill run"
          className="rounded px-2 py-0.5 text-[11px] font-medium text-red-600 hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Kill
        </button>
        <button
          type="button"
          onClick={() => setTermOpen(true)}
          title="Terminal"
          aria-label="Open terminal"
          className="rounded px-2 py-0.5 text-[11px] text-zinc-600 hover:bg-zinc-100"
        >
          Terminal
        </button>
        <button
          type="button"
          onClick={() => setCoverageOpen(true)}
          title="Coverage"
          aria-label="Open coverage report"
          className="rounded px-2 py-0.5 text-[11px] text-zinc-600 hover:bg-zinc-100"
        >
          Coverage
        </button>
      </div>

      {/* Accordion sections */}
      <div className="flex-1 overflow-y-auto">
        {ACCORDIONS.map(({ id, label }) => (
          <div key={id} className="border-b">
            <button
              type="button"
              onClick={() => toggleAccordion(id)}
              className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-zinc-100 transition-colors"
              aria-expanded={openAccordion === id}
            >
              <span className="text-xs font-medium text-zinc-700">{label}</span>
              <span className="text-zinc-400 text-xs">{openAccordion === id ? '▲' : '▼'}</span>
            </button>
            {openAccordion === id && model && (
              <div className="px-4 py-3 bg-white">
                {id === 'decisions' && <DecisionsLedger model={model} />}
                {id === 'governance' && <GovernanceAudit model={model} />}
                {id === 'burn' && <Burn model={model} />}
                {id === 'data' && <DataUsed model={model} />}
                {id === 'steering' && <SteeringTimeline runId={model.session.id} />}
                {id === 'whatwhere' && <WhatWhere model={model} />}
                {id === 'assumptions' && <AssumptionsPanel model={model} />}
              </div>
            )}
            {openAccordion === id && !model && (
              <div className="px-4 py-3">
                <p className="text-xs text-zinc-400">Loading…</p>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Terminal modal */}
      {termOpen && (
        <Modal title="Operator shell" onClose={() => setTermOpen(false)}>
          <Terminal
            cwd={session.workdir ?? '.'}
            governed
          />
        </Modal>
      )}

      {/* Coverage modal */}
      {coverageOpen && (
        <Modal title="Coverage report" onClose={() => setCoverageOpen(false)}>
          <CoverageView />
        </Modal>
      )}
    </div>
  );
}
