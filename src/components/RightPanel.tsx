import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import type { SessionView, SessionStatus } from '../api/types.js';
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
  | 'files';

const ACCORDIONS: { id: AccordionId; label: string }[] = [
  { id: 'whatwhere', label: 'What / Where' },
  { id: 'decisions', label: 'Decisions' },
  { id: 'governance', label: 'Governance' },
  { id: 'burn', label: 'Burn' },
  { id: 'data', label: 'Data' },
  { id: 'steering', label: 'Steering' },
  { id: 'assumptions', label: 'Assumptions' },
  { id: 'files', label: 'Files' },
];

/**
 * Tool names that indicate a file write/create/delete operation.
 * Derived from governance hook events (`governanceHookFired.toolName`).
 */
const WRITE_TOOLS: ReadonlySet<string> = new Set([
  'Write', 'Edit', 'MultiEdit', 'NotebookEdit',
]);
const DELETE_TOOLS: ReadonlySet<string> = new Set(['DeleteFile', 'Remove']);

type FileOpKind = 'write' | 'delete';

function FilePath({ path, opKind }: { path: string; opKind?: FileOpKind }): React.ReactElement {
  const [copied, setCopied] = useState(false);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (resetTimerRef.current !== null) clearTimeout(resetTimerRef.current); }, []);
  const parts = path.replace(/\\/g, '/').split('/');
  const name = parts.pop() ?? path;
  const dir = parts.length > 0 ? `${parts.join('/')}/` : '';

  const glyph = opKind === 'delete' ? '−' : opKind === 'write' ? '±' : '~';
  const glyphColor =
    opKind === 'delete'
      ? '#f85149'
      : opKind === 'write'
        ? '#ffda19'
        : 'rgba(230,237,243,0.25)';
  const nameColor =
    opKind === 'delete'
      ? '#f85149'
      : opKind === 'write'
        ? '#e6edf3'
        : '#e6edf3';

  function handleCopy(): void {
    void navigator.clipboard.writeText(path).then(() => {
      setCopied(true);
      if (resetTimerRef.current !== null) clearTimeout(resetTimerRef.current);
      resetTimerRef.current = setTimeout(() => { setCopied(false); resetTimerRef.current = null; }, 1500);
    }).catch(() => { /* clipboard unavailable — silently ignore */ });
  }

  return (
    <li title={copied ? 'Copied!' : path} className="flex items-start gap-1.5 min-w-0">
      <span className="shrink-0 mt-0.5 text-[9px] font-mono select-none" style={{ color: glyphColor }}>
        {glyph}
      </span>
      <button
        type="button"
        onClick={handleCopy}
        className="min-w-0 leading-5 font-mono text-[10px] break-all text-left transition-opacity hover:opacity-70"
        title={copied ? 'Copied!' : `Click to copy: ${path}`}
        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
      >
        {dir && <span style={{ color: 'rgba(230,237,243,0.3)' }}>{dir}</span>}
        <span style={{ color: nameColor }}>{name}</span>
        {copied && (
          <span className="ml-1 text-[9px]" style={{ color: '#3fb950' }}>✓</span>
        )}
      </button>
    </li>
  );
}

function FilesPanel({ model }: { model: RunModel }): React.ReactElement {
  // Build sets of "write units" and "delete units" from governance hook fires.
  // governanceHookFired events carry toolName but not file paths, so we use a unit's
  // entire filesRead set as a proxy for "files touched by write operations".
  const writeUnitOrds = new Set<number>();
  const deleteUnitOrds = new Set<number>();
  for (const u of model.units) {
    for (const h of u.hookFires) {
      if (WRITE_TOOLS.has(h.toolName)) writeUnitOrds.add(u.ord);
      if (DELETE_TOOLS.has(h.toolName)) deleteUnitOrds.add(u.ord);
    }
  }

  // Collect files: a file is "modified" if it appears in any write/delete unit.
  // A file is "referenced only" if it appears only in pure-read units.
  const modifiedFiles = new Set<string>();
  const deletedFiles = new Set<string>();
  const allFiles = new Set<string>();

  for (const u of model.units) {
    for (const f of u.filesRead) {
      allFiles.add(f);
      if (deleteUnitOrds.has(u.ord)) deletedFiles.add(f);
      else if (writeUnitOrds.has(u.ord)) modifiedFiles.add(f);
    }
  }

  // A file in both modified and deleted (across different units) is treated as deleted.
  for (const f of deletedFiles) modifiedFiles.delete(f);

  // "Referenced" = files that appear only in read units (not in any write/delete unit)
  const referencedFiles = new Set<string>();
  for (const f of allFiles) {
    if (!modifiedFiles.has(f) && !deletedFiles.has(f)) referencedFiles.add(f);
  }

  const hasModified = modifiedFiles.size > 0 || deletedFiles.size > 0;
  const hasAny = allFiles.size > 0;
  const isActive = !['completed', 'cancelled', 'failed'].includes(model.session.status);

  if (!hasAny) {
    return (
      <p className="text-xs font-mono" style={{ color: 'rgba(230,237,243,0.35)' }}>
        {isActive ? 'No files changed yet.' : 'No files changed.'}
      </p>
    );
  }

  const sortedModified = [...modifiedFiles].sort();
  const sortedDeleted = [...deletedFiles].sort();
  const sortedReferenced = [...referencedFiles].sort();

  return (
    <div className="flex flex-col gap-4">
      {/* Modified / Created section */}
      {(hasModified || isActive) && (
        <div>
          <p className="text-[10px] font-mono mb-2 uppercase tracking-wider" style={{ color: 'rgba(230,237,243,0.3)' }}>
            Modified / Created
          </p>
          {!hasModified ? (
            <p className="text-[10px] font-mono" style={{ color: 'rgba(230,237,243,0.3)' }}>
              No files changed yet.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {sortedModified.map((f) => (
                <FilePath key={f} path={f} opKind="write" />
              ))}
              {sortedDeleted.map((f) => (
                <FilePath key={f} path={f} opKind="delete" />
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Referenced section */}
      {sortedReferenced.length > 0 && (
        <div>
          <p className="text-[10px] font-mono mb-2 uppercase tracking-wider" style={{ color: 'rgba(230,237,243,0.3)' }}>
            Referenced
          </p>
          <ul className="flex flex-col gap-1">
            {sortedReferenced.map((f) => (
              <FilePath key={f} path={f} />
            ))}
          </ul>
        </div>
      )}

      <p className="text-[10px] font-mono" style={{ color: 'rgba(230,237,243,0.2)' }}>
        {allFiles.size} file{allFiles.size !== 1 ? 's' : ''} total
      </p>
    </div>
  );
}

const STEER_STATUSES: ReadonlySet<SessionStatus> = new Set([
  'executing', 'distributing', 'planning',
]);

export function RightPanel({ view }: Props): React.ReactElement {
  const [collapsed, setCollapsed] = useState(false);
  const [openAccordion, setOpenAccordion] = useState<AccordionId | null>('whatwhere');

  const [termOpen, setTermOpen] = useState(false);
  const [coverageOpen, setCoverageOpen] = useState(false);

  // Steering input state (scope C)
  const [steerText, setSteerText] = useState('');
  const [steerSending, setSteerSending] = useState(false);
  const [steerError, setSteerError] = useState<string | null>(null);
  const steerRef = useRef<HTMLTextAreaElement>(null);
  const steerInflightRef = useRef(false);

  const { session } = view;
  const model = useRunModel(session.id, view);
  const canSteer = STEER_STATUSES.has(session.status);

  const fileCount = model
    ? new Set(model.units.flatMap((u) => u.filesRead)).size
    : null;

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
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-medium font-mono">{label}</span>
                {id === 'files' && fileCount !== null && fileCount > 0 && (
                  <span
                    className="text-[9px] font-mono px-1 py-0.5 rounded"
                    style={{ background: 'rgba(121,192,255,0.12)', color: '#79c0ff' }}
                  >
                    {fileCount}
                  </span>
                )}
              </div>
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
                {id === 'files' && <FilesPanel model={model} />}
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

      {/* Compact steering input — visible when the run is executing, planning, or distributing */}
      {canSteer && (
        <div
          className="shrink-0 px-3 py-2 flex flex-col gap-1.5"
          style={{ borderTop: '1px solid rgba(230,237,243,0.07)', background: '#090d12' }}
        >
          <p className="text-[9px] font-mono uppercase tracking-widest" style={{ color: 'rgba(230,237,243,0.3)' }}>
            Steer
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const msg = steerText.trim();
              if (!msg || steerInflightRef.current) return;
              steerInflightRef.current = true;
              setSteerSending(true);
              setSteerError(null);
              void api.injectMessage(session.id, msg, 'all')
                .then(() => {
                  setSteerText('');
                })
                .catch((err: unknown) => {
                  const errMsg = err instanceof Error ? err.message : String(err);
                  setSteerError(errMsg || 'Failed to send instruction — please try again.');
                })
                .finally(() => {
                  steerInflightRef.current = false;
                  setSteerSending(false);
                });
            }}
            className="flex flex-col gap-1"
          >
            <div className="flex gap-1.5">
              <textarea
                ref={steerRef}
                value={steerText}
                onChange={(e) => { setSteerText(e.target.value); setSteerError(null); }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    e.currentTarget.form?.requestSubmit();
                  }
                }}
                aria-label="Steering instruction"
                rows={2}
                placeholder="Send instruction to agents…"
                disabled={steerSending}
                className="flex-1 resize-none rounded text-[11px] font-mono px-2 py-1.5 leading-relaxed"
                style={{
                  background: 'rgba(230,237,243,0.05)',
                  border: '1px solid rgba(230,237,243,0.1)',
                  color: '#e6edf3',
                  outline: 'none',
                  minHeight: 0,
                }}
              />
              <button
                type="submit"
                aria-label={steerSending ? 'Sending…' : 'Send steering instruction'}
                disabled={steerSending || !steerText.trim()}
                className="shrink-0 self-end rounded px-2 py-1 text-[11px] font-mono font-medium transition-opacity disabled:opacity-30"
                style={{ background: 'rgba(121,192,255,0.15)', color: '#79c0ff', border: '1px solid rgba(121,192,255,0.2)' }}
              >
                {steerSending ? '…' : '↑'}
              </button>
            </div>
            {steerError && (
              <p className="text-[10px] font-mono" style={{ color: '#f85149' }}>{steerError}</p>
            )}
          </form>
        </div>
      )}

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
