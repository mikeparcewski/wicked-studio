import { useState } from 'react';
import type { SessionView } from '../api/types.js';
import { useRunModel } from '../hooks/useRunModel.js';
import type { RunModel } from '../hooks/useRunModel.js';
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
}

type AccordionId =
  | 'decisions'
  | 'governance'
  | 'burn'
  | 'data'
  | 'steering'
  | 'whatwhere'
  | 'assumptions'
  | 'artifacts';

const ACCORDIONS: { id: AccordionId; label: string }[] = [
  { id: 'whatwhere', label: 'What / Where' },
  { id: 'decisions', label: 'Decisions' },
  { id: 'governance', label: 'Governance' },
  { id: 'burn', label: 'Burn' },
  { id: 'data', label: 'Data' },
  { id: 'steering', label: 'Steering' },
  { id: 'assumptions', label: 'Assumptions' },
  { id: 'artifacts', label: 'Artifacts' },
];

function ArtifactsPanel({ model }: { model: RunModel }): React.ReactElement {
  const files = Array.from(
    new Set(model.units.flatMap((u) => u.filesRead))
  ).sort();

  if (files.length === 0) {
    return (
      <p className="text-xs font-mono" style={{ color: 'rgba(230,237,243,0.35)' }}>
        No files referenced yet.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-1">
      {files.map((f) => {
        const parts = f.replace(/\\/g, '/').split('/');
        const name = parts.pop() ?? f;
        const dir = parts.length > 0 ? `${parts.join('/')}/` : '';
        return (
          <li key={f} title={f} className="flex items-start gap-1.5 min-w-0">
            <span className="shrink-0 mt-0.5 text-[9px] font-mono" style={{ color: 'rgba(230,237,243,0.25)' }}>~</span>
            <span className="min-w-0 leading-5 font-mono text-[10px] break-all">
              {dir && <span style={{ color: 'rgba(230,237,243,0.3)' }}>{dir}</span>}
              <span style={{ color: '#e6edf3' }}>{name}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function RightPanel({ view }: Props): React.ReactElement {
  const [collapsed, setCollapsed] = useState(false);
  const [openAccordion, setOpenAccordion] = useState<AccordionId | null>('whatwhere');
  const [termOpen, setTermOpen] = useState(false);
  const [coverageOpen, setCoverageOpen] = useState(false);

  const { session } = view;
  const model = useRunModel(session.id, view);

  function toggleAccordion(id: AccordionId): void {
    setOpenAccordion((prev) => (prev === id ? null : id));
  }

  if (collapsed) {
    return (
      <div
        className="flex flex-col items-center w-10 shrink-0 py-3 gap-2"
        style={{ background: '#0c1015', borderLeft: '1px solid rgba(230,237,243,0.07)' }}
      >
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="text-sm leading-none"
          style={{ color: 'rgba(230,237,243,0.4)' }}
          aria-label="Expand insights panel"
        >
          ‹
        </button>
        <button
          type="button"
          onClick={() => setTermOpen(true)}
          title="Terminal"
          aria-label="Open terminal"
          className="w-7 h-7 flex items-center justify-center rounded text-sm"
          style={{ color: 'rgba(230,237,243,0.4)' }}
        >
          ⬛
        </button>
        <button
          type="button"
          onClick={() => setCoverageOpen(true)}
          title="Coverage"
          aria-label="Open coverage"
          className="w-7 h-7 flex items-center justify-center rounded text-sm font-mono"
          style={{ color: 'rgba(230,237,243,0.4)' }}
        >
          %
        </button>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col w-72 shrink-0 overflow-hidden"
      style={{ background: '#0c1015', borderLeft: '1px solid rgba(230,237,243,0.07)' }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-1 px-3 py-2 border-b shrink-0"
        style={{ background: '#090d12', borderColor: 'rgba(230,237,243,0.07)' }}
      >
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          className="flex items-center gap-1.5 flex-1 min-w-0 text-left"
          aria-label="Collapse insights panel"
        >
          <span className="text-sm leading-none shrink-0" style={{ color: 'rgba(230,237,243,0.35)' }}>›</span>
          <span className="text-[10px] font-semibold uppercase tracking-widest font-mono" style={{ color: 'rgba(230,237,243,0.4)' }}>
            Insights
          </span>
        </button>
        <button
          type="button"
          onClick={() => setTermOpen(true)}
          title="Terminal"
          aria-label="Open terminal"
          className="rounded px-2 py-0.5 text-[11px] font-mono"
          style={{ color: 'rgba(230,237,243,0.45)' }}
        >
          Term
        </button>
        <button
          type="button"
          onClick={() => setCoverageOpen(true)}
          title="Coverage"
          aria-label="Open coverage report"
          className="rounded px-2 py-0.5 text-[11px] font-mono"
          style={{ color: 'rgba(230,237,243,0.45)' }}
        >
          Cov
        </button>
      </div>

      {/* Accordion sections */}
      <div className="flex-1 overflow-y-auto">
        {ACCORDIONS.map(({ id, label }) => (
          <div key={id} style={{ borderBottom: '1px solid rgba(230,237,243,0.06)' }}>
            <button
              type="button"
              onClick={() => toggleAccordion(id)}
              className="w-full flex items-center justify-between px-4 py-2.5 text-left transition-colors"
              style={{ color: openAccordion === id ? '#e6edf3' : 'rgba(230,237,243,0.55)' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(230,237,243,0.04)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              aria-expanded={openAccordion === id}
            >
              <span className="text-xs font-medium font-mono">{label}</span>
              <span className="text-xs" style={{ color: 'rgba(230,237,243,0.3)' }}>
                {openAccordion === id ? '▲' : '▼'}
              </span>
            </button>
            {openAccordion === id && model && (
              <div className="px-4 py-3" style={{ background: '#0a0d12' }}>
                {id === 'decisions' && <DecisionsLedger model={model} />}
                {id === 'governance' && <GovernanceAudit model={model} />}
                {id === 'burn' && <Burn model={model} />}
                {id === 'data' && <DataUsed model={model} />}
                {id === 'steering' && <SteeringTimeline runId={model.session.id} />}
                {id === 'whatwhere' && <WhatWhere model={model} />}
                {id === 'assumptions' && <AssumptionsPanel model={model} />}
                {id === 'artifacts' && <ArtifactsPanel model={model} />}
              </div>
            )}
            {openAccordion === id && !model && (
              <div className="px-4 py-3">
                <p className="text-xs font-mono" style={{ color: 'rgba(230,237,243,0.35)' }}>Loading…</p>
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
