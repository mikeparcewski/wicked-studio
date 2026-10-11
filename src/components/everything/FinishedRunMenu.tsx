import { useState } from 'react';
import type { SessionView } from '../../api/types.js';
import { OUTBOUND_TITLE, outboundKindFor } from '../../api/outbound.js';
import { useReusePreset } from '../../hooks/useReusePreset.js';
import { ReusePresetPanel } from '../FinishedRunRow.js';
import { Modal } from '../Modal.js';
import { OutboundDraft } from '../OutboundDraft.js';
import { OverflowMenu, type MenuItem } from '../ui/index.js';

/**
 * A finished run's next-use moves on "See everything" (studio#687, UX audit row 35): one "⋯" menu per
 * row instead of three text buttons. The moves are the Work page's (FinishedRunRow): "Reuse as preset"
 * (only when the run has a catalog plan) opens the save with its consequence first, "Draft update"
 * opens the outbound draft (nothing is sent), "Archive" puts the run away. `lead` items (Open, the
 * steps) come first. `children` is the row's link; the opened panels render under it.
 */
export function FinishedRunMenu({ view, title, lead = [], onArchive, children, lineClassName = 'wk-everything-frow-line', 'data-testid': testId = 'everything-row-menu' }: {
  view: SessionView;
  title: string;
  lead?: readonly MenuItem[];
  onArchive: (id: string) => void;
  children: React.ReactNode;
  lineClassName?: string;
  'data-testid'?: string;
}): React.ReactElement {
  const reuse = useReusePreset(view);
  const [drafting, setDrafting] = useState(false);
  const s = reuse.state;
  const id = view.session.id;
  const kind = outboundKindFor(view.session.status);
  const items: MenuItem[] = [
    ...lead,
    ...(reuse.steps.length > 0 && s.phase !== 'saved' ? [{ id: 'reuse-preset', label: 'Reuse as preset', onSelect: () => reuse.open() }] : []),
    { id: 'draft-update', label: 'Draft update', onSelect: () => setDrafting(true) },
    { id: 'archive', label: 'Archive', onSelect: () => onArchive(id) },
  ];
  return (
    <div data-testid="run-finished-row" data-run-id={id} className="wk-everything-frow">
      <div className={lineClassName}>
        {children}
        <OverflowMenu data-testid={testId} label={`More actions for ${title}`} items={items} />
      </div>
      <ReusePresetPanel reuse={reuse} />
      {s.phase === 'saved' && (
        <p data-testid="run-reuse-saved" className="wk-field-note">{`Saved as preset “${s.name}”. Start it with /workflow-${s.name}.`}</p>
      )}
      {drafting && (
        <Modal title={OUTBOUND_TITLE[kind]} onClose={() => setDrafting(false)}>
          <OutboundDraft kind={kind} runId={id} />
        </Modal>
      )}
    </div>
  );
}
