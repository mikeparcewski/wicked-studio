import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { walkthroughApi, type WalkthroughView } from '../../api/walkthrough.js';
import { commitGateDecision, refreshGate } from '../../board/gateActions.js';
import { escalationOpen, fixNote, gateVerbs, recordingOf, takeFingerprint, type Recording, type RecordingKind, type UnitLike } from '../../board/walkthroughModel.js';
import type { DemoCutSurfaceAdapter } from '../../editors/adapters/recording.js';
import type { ArtifactBinding } from '../../editors/hostApi.js';
import { useGateStore } from '../../store/gates.js';
import { useRecording } from './useRecording.js';

type RetakeProps = { adapter: DemoCutSurfaceAdapter; chapter: string };

/** The run's gate controls live in host chrome, alongside the recording plugin. */
export function RecordingGateActions({ runId, kind, step, units, onChanged, retake }: {
  runId: string;
  kind: RecordingKind;
  step: string | null;
  units: readonly UnitLike[];
  onChanged?: () => void;
  retake?: RetakeProps;
}): React.ReactElement | null {
  // Unit changes replace the run-status signal the old editor received from the run page.
  const { load, reload } = useRecording(runId, kind, step, JSON.stringify(units));
  const changed = (): void => { reload(); onChanged?.(); };
  return <>
    {load.kind === 'ready' && <GateActions rec={load.rec} units={units} reload={changed} />}
    {kind === 'demo-video' && retake !== undefined && <RetakeChapter key={retake.chapter} {...retake} />}
  </>;
}

export function recordingGateActions(binding: ArtifactBinding, units: readonly UnitLike[]): ReactNode | null {
  if ((binding.source !== 'walkthrough' && binding.source !== 'demo') || binding.runId === undefined) return null;
  return <RecordingGateActions runId={binding.runId} kind={binding.source === 'walkthrough' ? 'walkthrough' : 'demo-video'} step={null} units={units} />;
}

function GateActions({ rec, units, reload }: { rec: Recording; units: readonly UnitLike[]; reload: () => void }): React.ReactElement | null {
  const gate = useGateStore((s) => s.gates[rec.runId]);
  const verbs = gateVerbs(rec, escalationOpen(rec, gate?.ord ?? null, units));
  // An Edit-the-check draft belongs to the take it was opened on, BY CONSTRUCTION: it carries that
  // take's fingerprint, and on any other take there is no open box and no text — in the same render
  // that shows the other take, with no effect in between. It can never be saved over a newer take.
  const [draft, setDraft] = useState<{ take: string; text: string } | null>(null);
  const [note, setNote] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const take = takeFingerprint(rec);
  const editing = draft !== null && draft.take === take;
  const storyline = editing ? draft.text : '';
  // Mounted, as of the commit: the cleanup runs inside the unmount's commit (a layout effect), so a
  // read that resolves right after it never finds the flag still up.
  const live = useRef(true);
  useLayoutEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  // The run's units as of the LATEST render: a check made after an await must not read the units
  // the click handler closed over (the denial may have been cleared meanwhile).
  // (A layout effect: it runs in the commit itself, so no awaited continuation can resume between a
  // commit of newer units and this mirror of them.)
  const unitsRef = useRef(units);
  useLayoutEffect(() => { unitsRef.current = units; }, [units]);
  // The take on screen as of the latest commit, for the same reason.
  const recRef = useRef(rec);
  useLayoutEffect(() => { recRef.current = rec; }, [rec]);

  // A failed walkthrough's gate may predate this page (a late join): read it once, so the actions
  // the escalation allows are offered without a visit to the run page.
  const failedWalk = rec.kind === 'walkthrough' && rec.state === 'failed';
  useEffect(() => {
    if (failedWalk && useGateStore.getState().gates[rec.runId] === undefined) void refreshGate(rec.runId);
  }, [failedWalk, rec.runId]);

  const act = async (done: string, fn: () => Promise<void>): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      await fn();
      if (live.current) setNote({ tone: 'ok', text: done });
    } catch (e) {
      if (live.current) setNote({ tone: 'bad', text: e instanceof Error ? e.message : String(e) });
    } finally {
      if (live.current) setBusy(false);
    }
  };
  // The verbs were drawn from an older read: before anything is sent, the gate and the take are read
  // again and the write goes out only if it is still this walkthrough's own escalation, for this take.
  /** The gate and the take, read now. */
  const readNow = async (): Promise<WalkthroughView> => {
    const [, view] = await Promise.all([refreshGate(rec.runId), walkthroughApi.view(rec.runId, rec.step)]);
    return view;
  };
  /** SYNCHRONOUS, and called in the same run as the send it guards (never awaited): nothing can
   *  change between a check and the write that follows it. Throws when the write must not go out. */
  const assertMine = (view: WalkthroughView): void => {
    // Left the page while they were read: the operator is not looking at this any more.
    if (!live.current) throw new Error('Nothing was sent.');
    const now = useGateStore.getState().gates[rec.runId];
    if (!escalationOpen(rec, now?.ord ?? null, unitsRef.current)) throw new Error('This walkthrough is no longer waiting on you — nothing was sent.');
    // The same step can escalate again for a NEWER take (recorded again, failed again): the take the
    // click was made on (`rec`: the fix note is built from it), the take on screen now and the take
    // the daemon holds now must be one and the same.
    const clicked = takeFingerprint(rec);
    if (takeFingerprint(recordingOf(view)) !== clicked || takeFingerprint(recRef.current) !== clicked) {
      reload();
      throw new Error('The walkthrough changed since this was shown — nothing was sent. Look at it again.');
    }
  };
  const decide = async (decision: Parameters<typeof commitGateDecision>[1]): Promise<void> => {
    const view = await readNow();
    assertMine(view);
    const outcome = await commitGateDecision(rec.runId, decision);
    if (outcome === 'undone') throw new Error('Undone — nothing was sent.');
    if (outcome !== 'sent') throw new Error('Not sent — the gate changed or was already answered.');
  };
  const fix = (): Promise<void> => act('Sent back to the helpers with what the walkthrough caught.', async () => {
    await decide({ approve: false, action: 'request_changes', amend: fixNote(rec) });
    reload();
  });
  const saveStoryline = (): Promise<void> => act('The check was changed; the walkthrough records again.', async () => {
    const stepId = rec.step ?? rec.planStep;
    if (stepId === null) throw new Error('This recording has no walkthrough step.');
    const view = await readNow();
    assertMine(view);
    await walkthroughApi.putStoryline(rec.runId, stepId, storyline);
    if (!live.current) return; // the file is written; the approve is the operator's to send, on the gate
    try {
      await decide({ approve: true });
    } catch (e) {
      // The file is written; only the approve did not go out. Say both, so the gate is not left a mystery.
      throw new Error(`The check was saved, but it was not sent to record again: ${e instanceof Error ? e.message : String(e)} Approve the gate to record it.`);
    }
    if (live.current) setDraft(null);
    reload();
  });

  // The note outlives the verbs: after Ask helpers to fix the gate closes, and the note must still say so.
  if (!verbs.includes('fix') && !verbs.includes('edit') && note === null) return null;
  return <>
    <div data-testid="walkthrough-actions" className="wk-walk-actions">
      {verbs.includes('fix') && <button type="button" data-testid="walkthrough-fix" disabled={busy} onClick={() => void fix()} className="wk-prop-btn wk-prop-btn--primary">Ask helpers to fix</button>}
      {verbs.includes('edit') && <button type="button" data-testid="walkthrough-edit-check" disabled={busy} aria-expanded={editing} onClick={() => setDraft(editing ? null : { take, text: storyline })} className="wk-prop-btn wk-prop-btn--ghost">Edit the check</button>}
    </div>
    {editing && verbs.includes('edit') && (
      <div data-testid="walkthrough-edit" className="wk-walk-edit">
        <p className="wk-walk-quiet">Paste the storyline with your change to the check (the author’s <code>storyline.mjs</code>, whole). Saving re-checks it and the walkthrough records again.</p>
        <textarea data-testid="walkthrough-storyline" value={storyline} onChange={(e) => setDraft({ take, text: e.target.value })} rows={4} className="wk-walk-storyline" aria-label="The storyline" />
        <div className="wk-prop-btns">
          <button type="button" data-testid="walkthrough-storyline-save" disabled={busy || storyline.trim() === ''} onClick={() => void saveStoryline()} className="wk-prop-btn wk-prop-btn--primary">Save and record again</button>
          <button type="button" data-testid="walkthrough-storyline-cancel" onClick={() => setDraft(null)} className="wk-prop-btn wk-prop-btn--ghost">Cancel</button>
        </div>
      </div>
    )}
    {note !== null && <p data-testid="walkthrough-note" data-tone={note.tone} role={note.tone === 'bad' ? 'alert' : 'status'} className={`wk-walk-quiet${note.tone === 'bad' ? ' wk-walk-bad' : ''}`}>{note.text}</p>}
  </>;
}

/** The demo cut adapter owns the take request; only host chrome offers the verb. */
export function RetakeChapter({ adapter, chapter }: RetakeProps): React.ReactElement {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const live = useRef(true);
  const pending = useRef(false);
  useLayoutEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const retake = async (): Promise<void> => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setNote(null);
    try {
      const result = await adapter.retake(chapter);
      if (live.current) setNote('error' in result
        ? { tone: 'bad', text: result.message }
        : { tone: 'ok', text: 'The chapter was recorded again.' });
    } catch (e) {
      if (live.current) setNote({ tone: 'bad', text: e instanceof Error ? e.message : String(e) });
    } finally {
      pending.current = false;
      if (live.current) setBusy(false);
    }
  };
  return <div className="wk-walk-actions">
    <button type="button" data-testid="demo-retake-chapter" disabled={busy} onClick={() => void retake()} className="wk-prop-btn wk-prop-btn--ghost">Re-record this chapter</button>
    {note !== null && <p data-testid="demo-retake-note" data-tone={note.tone} role={note.tone === 'bad' ? 'alert' : 'status'} className={`wk-walk-quiet${note.tone === 'bad' ? ' wk-walk-bad' : ''}`}>{note.text}</p>}
  </div>;
}
