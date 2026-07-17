import { useState } from 'react';
import type { RunModel } from '../hooks/useRunModel.js';
import { DecisionsLedger } from './DecisionsLedger.js';
import { GovernanceAudit } from './GovernanceAudit.js';
import { SteeringTimeline } from './SteeringTimeline.js';
import { Burn } from './Burn.js';
import { DataUsed } from './DataUsed.js';
import { WhatWhere } from './WhatWhere.js';
import { AssumptionsPanel } from './AssumptionsPanel.js';
import { CampaignDagStub } from './CampaignDagStub.js';

interface Props {
  model: RunModel;
}

type TabId = 'decisions' | 'governance' | 'burn' | 'data' | 'steering' | 'what' | 'assumptions' | 'unwired';

const TABS: { id: TabId; label: string }[] = [
  { id: 'decisions', label: 'Decisions' },
  { id: 'governance', label: 'Governance' },
  { id: 'burn', label: 'Burn' },
  { id: 'data', label: 'Data' },
  { id: 'steering', label: 'Steering' },
  { id: 'what', label: 'What/Where' },
  { id: 'assumptions', label: 'Assumptions' },
  { id: 'unwired', label: 'Unwired' },
];

/**
 * The right-hand insight rail (DES-STUDIO-COCKPIT-001 §2). Tabbed views, each a pure view
 * over the merged {@link RunModel}. The "Unwired" tab collects the honestly-labeled
 * boundaries (NFR-3): campaign DAG (engine-real, not wired), the workflow selector
 * (runs launch from free-text), and memory recall (surfaced in the Data tab).
 */
export function InsightRail({ model }: Props): React.ReactElement {
  const [tab, setTab] = useState<TabId>('decisions');

  return (
    <div data-testid="insight-rail" className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1 border-b border-gray-200 pb-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            data-testid={`insight-tab-${t.id}`}
            aria-pressed={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`rounded px-2 py-1 text-[11px] font-medium ${
              tab === t.id ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-100'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div>
        {tab === 'decisions' && <DecisionsLedger model={model} />}
        {tab === 'governance' && <GovernanceAudit model={model} />}
        {tab === 'burn' && <Burn model={model} />}
        {tab === 'data' && <DataUsed model={model} />}
        {tab === 'steering' && <SteeringTimeline runId={model.session.id} />}
        {tab === 'what' && <WhatWhere model={model} />}
        {tab === 'assumptions' && <AssumptionsPanel model={model} />}
        {tab === 'unwired' && (
          <div className="flex flex-col gap-2 text-[11px]">
            <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-2 text-gray-500">
              <p className="font-semibold">Live output streaming — engine-pending</p>
              <p className="mt-1 text-gray-400">
                The engine does not yet emit <code>cliOutputDelta</code> events. Output is
                available as a transcript after each unit completes (auto-shown below).
              </p>
            </div>
            <CampaignDagStub />
          </div>
        )}
      </div>
    </div>
  );
}
