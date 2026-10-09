import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { api } from '../../api/client.js';
import type { SessionView } from '../../api/types.js';
import { OUTBOUND_TITLE, outboundKindFor, type OutboundKind } from '../../api/outbound.js';
import { retryPrefillOf } from '../../board/needsYou.js';
import { setRetryPrefill } from '../../store/retryPrefill.js';
import { Modal } from '../Modal.js';
import { OutboundDraft } from '../OutboundDraft.js';

/**
 * S16a-1d: the run page header's actions, homed under the session (DESIGN-interaction rule 9):
 *  - Retry (failed / cancelled): deposits the SAME prefill the Desk's failed row does
 *    (`retryPrefillOf`) and opens the launch form — nothing launches until the operator sends.
 *  - Archive (a terminal run not yet archived): the run page's confirm step, then exactly one
 *    POST /runs/:id/archive; the thread stays open and says "Archived".
 *  - Draft an update (any run): the same Modal + OutboundDraft — nothing is posted.
 * The mode pill is not carried: a mid-run change of pace is a message in the session composer.
 */

const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

/** Why a session action does not apply now, or null when it does. */
export function retryBlocked(v: SessionView | undefined): string | null {
  if (v === undefined) return 'Nothing in it is on this daemon.';
  return v.session.status === 'failed' || v.session.status === 'cancelled' ? null : v.session.status === 'completed' ? 'It finished; nothing to retry.' : 'It is still running.';
}

export function archiveBlocked(v: SessionView | undefined): string | null {
  if (v === undefined) return 'Nothing in it is on this daemon.';
  if (!TERMINAL.has(v.session.status)) return 'It is still running.';
  return v.session.archived_at == null ? null : 'It is already archived.';
}

/** Retry: the Desk row's prefill, then the launch form. Never a POST. */
export function startRetry(v: SessionView, navigate: (path: string) => void): void {
  setRetryPrefill(retryPrefillOf(v));
  navigate('/runs/new');
}

/** A ⌘K row asking the session sheet to open Archive's confirm or the draft (the sheet owns both). */
export const useRunActionAsk = create<{ ask: { runId: string; what: 'archive' | 'draft' } | null }>(() => ({ ask: null }));

export function askRunAction(runId: string, what: 'archive' | 'draft'): void {
  useRunActionAsk.setState({ ask: { runId, what } });
}

/** The session sheet's secondary actions for its newest run: Archive (with its confirm) and Draft update. */
export function SheetRunActions({ view }: { view: SessionView }): React.ReactElement {
  const runId = view.session.id;
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [archived, setArchived] = useState(view.session.archived_at != null);
  const [draft, setDraft] = useState<OutboundKind | null>(null);
  const ask = useRunActionAsk((s) => s.ask);
  useEffect(() => {
    if (ask === null || ask.runId !== runId) return;
    if (ask.what === 'archive' && archiveBlocked(view) === null && !archived) setConfirming(true);
    if (ask.what === 'draft') setDraft(outboundKindFor(view.session.status));
    useRunActionAsk.setState({ ask: null });
  }, [ask, runId, view, archived]);
  const canArchive = !archived && archiveBlocked(view) === null;

  const confirm = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.archiveRun(runId, true);
      setConfirming(false);
      setArchived(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid="sheet-run-actions" className="wk-sheet-actions">
      <button type="button" data-testid="sheet-draft-update" onClick={() => setDraft(outboundKindFor(view.session.status))} title="Draft an update about this run from its record — editable, then copy it out" className="wk-prop-btn wk-prop-btn--ghost">
        Draft update
      </button>
      {archived && <span data-testid="sheet-archived" className="wk-sheet-hint">Archived</span>}
      {canArchive && !confirming && (
        <button type="button" data-testid="sheet-archive" onClick={() => setConfirming(true)} title="Archive this run — write it off; moves it out of the active work list" className="wk-prop-btn wk-prop-btn--ghost">
          Archive
        </button>
      )}
      {canArchive && confirming && (
        <div data-testid="sheet-archive-confirm" role="group" aria-label="Confirm archiving this run" className="wk-sheet-actions"
          onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); if (!busy) { setConfirming(false); setError(null); } } }}>
          <span className="wk-sheet-hint">Archive this run? It moves to the Archived section.</span>
          <button type="button" data-testid="sheet-archive-yes" onClick={() => void confirm()} disabled={busy} autoFocus className="wk-prop-btn wk-prop-btn--primary">
            {busy ? 'Archiving…' : 'Yes, archive'}
          </button>
          <button type="button" data-testid="sheet-archive-keep" onClick={() => { if (!busy) { setConfirming(false); setError(null); } }} disabled={busy} className="wk-prop-btn wk-prop-btn--ghost">Keep</button>
        </div>
      )}
      {error !== null && <span role="alert" data-testid="sheet-archive-error" className="wk-composer-note wk-composer-note--bad">{error}</span>}
      {draft !== null && (
        <Modal title={OUTBOUND_TITLE[draft]} onClose={() => setDraft(null)}>
          <OutboundDraft kind={draft} runId={runId} />
        </Modal>
      )}
    </div>
  );
}
