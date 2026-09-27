import { useState } from 'react';
import type { SessionView } from '../api/types.js';
import { OUTBOUND_TITLE, outboundKindFor } from '../api/outbound.js';
import { useReusePreset } from '../hooks/useReusePreset.js';
import { Modal } from './Modal.js';
import { OutboundDraft } from './OutboundDraft.js';
import { RunLink } from './RunLink.js';

/**
 * A finished run on the Runs list (Wave C, idea 11): the row carries what the run can become next,
 * not only Archive. "Reuse as preset" (only when the run has a catalog plan) opens the save with
 * its consequence said first; "Draft update" opens the outbound draft (Copy; nothing is sent);
 * Archive stays, last.
 */

const BTN = 'rounded-lg px-2 py-1 text-[11px] font-mono shrink-0';
const QUIET: React.CSSProperties = { color: 'var(--ink-muted)', border: '1px solid var(--surface-raised)' };
const NEXT: React.CSSProperties = { color: 'var(--accent)', border: '1px solid var(--surface-raised)' };

export function FinishedRunRow({ view, selectedRunId, onSelect, onArchive }: {
  view: SessionView;
  selectedRunId: string | null;
  onSelect: (id: string) => void;
  onArchive: (id: string) => void;
}): React.ReactElement {
  const reuse = useReusePreset(view);
  const [drafting, setDrafting] = useState(false);
  const s = reuse.state;
  const panelOpen = s.phase === 'open' || s.phase === 'saving' || s.phase === 'error';
  const id = view.session.id;
  const kind = outboundKindFor(view.session.status);

  return (
    <div data-testid="run-finished-row" data-run-id={id} className="flex flex-col">
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <RunLink view={view} selectedRunId={selectedRunId} onSelect={onSelect} />
        </div>
        {reuse.steps.length > 0 && s.phase !== 'saved' && (
          <button
            type="button"
            data-testid="run-reuse-preset"
            aria-expanded={panelOpen}
            onClick={() => (panelOpen ? reuse.close() : reuse.open())}
            title={`Save this run's ${reuse.steps.length}-step plan as a preset you can launch by name`}
            className={BTN}
            style={NEXT}
          >
            Reuse as preset
          </button>
        )}
        {s.phase === 'saved' && (
          <span data-testid="run-reuse-saved" className="text-[11px] font-mono shrink-0" style={{ color: 'var(--status-done)' }}>
            {`Saved as preset “${s.name}”`}
          </span>
        )}
        <button
          type="button"
          data-testid="run-draft-update-row"
          onClick={() => setDrafting(true)}
          title="Draft an update about this run from its record. Nothing is sent: edit it, then copy it out"
          className={BTN}
          style={NEXT}
        >
          Draft update
        </button>
        <button
          type="button"
          data-testid="run-archive-row"
          onClick={() => onArchive(id)}
          className={BTN}
          style={QUIET}
        >
          Archive
        </button>
      </div>
      {panelOpen && reuse.consequence !== null && (
        <div
          data-testid="run-reuse-panel"
          className="flex flex-col gap-2 px-3 py-2 mb-1 rounded-lg"
          style={{ border: '1px solid var(--surface-raised)', background: 'var(--surface-card)' }}
        >
          <p
            data-testid="run-reuse-consequence"
            data-blocked={String(reuse.consequence.blocked)}
            className="text-[11px] font-mono"
            style={{ margin: 0, color: reuse.consequence.blocked && reuse.consequence.waiting !== true ? 'var(--status-fail)' : 'var(--ink-body)' }}
          >
            {reuse.consequence.text}
          </p>
          <span className="flex items-center gap-2">
            <input
              data-testid="run-reuse-name"
              aria-label="Preset name"
              value={s.name}
              maxLength={64}
              onChange={(e) => reuse.setName(e.target.value)}
              className="rounded-md px-2 py-1 text-[11px] font-mono"
              style={{ minWidth: '16rem', background: 'var(--surface-base)', color: 'var(--ink-body)', border: '1px solid var(--surface-raised)' }}
            />
            <button
              type="button"
              data-testid="run-reuse-save"
              disabled={reuse.consequence.blocked || s.phase === 'saving'}
              onClick={() => void reuse.save()}
              className={BTN}
              style={NEXT}
            >
              {s.phase === 'saving' ? 'Saving…' : 'Save preset'}
            </button>
            <button type="button" onClick={reuse.close} className={BTN} style={QUIET}>
              Cancel
            </button>
          </span>
          {s.phase === 'error' && (
            <p role="alert" data-testid="run-reuse-error" className="text-[11px] font-mono" style={{ margin: 0, color: 'var(--status-fail)' }}>
              {`Not saved: ${s.message}`}
            </p>
          )}
        </div>
      )}
      {drafting && (
        <Modal title={OUTBOUND_TITLE[kind]} onClose={() => setDrafting(false)}>
          <OutboundDraft kind={kind} runId={id} />
        </Modal>
      )}
    </div>
  );
}
