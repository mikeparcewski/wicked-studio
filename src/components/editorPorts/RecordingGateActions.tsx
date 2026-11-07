import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { demoFileUrl, getDemo, makeDemoDocument, putDemoScript, rerecordNote, sendBackDemo } from '../../api/demo.js';
import { walkthroughApi, type WalkthroughView } from '../../api/walkthrough.js';
import { commitGateDecision, refreshGate } from '../../board/gateActions.js';
import { demoReviewLine, demoReviewPolicy, demoTakeFingerprint, escalationOpen, fixNote, fmtTime, gateVerbs, recordingOf, recordingOfDemo, SHEET_LABEL, takeFingerprint, type Recording, type RecordingKind, type UnitLike } from '../../board/walkthroughModel.js';
import type { ArtifactBinding } from '../../editors/hostApi.js';
import { useGateStore } from '../../store/gates.js';
import { useRecording } from './useRecording.js';
import './editorPorts.css';

/** The run's gate controls live in host chrome, alongside the recording plugin. */
export function RecordingGateActions({ runId, kind, step, units, onChanged, onEditOpen, script = false, cutOpens = false }: {
  runId: string;
  kind: RecordingKind;
  step: string | null;
  units: readonly UnitLike[];
  onChanged?: () => void;
  /** "Edit the check" opened its storyline box: a host that can give it room (an inline slot grows to the pane) does. */
  onEditOpen?: () => void;
  /** Draw the plan gate's script editor: on a plugin card only (the morphing slot's own editor has its box). */
  script?: boolean;
  /** The host opens a demo's cut once it is made (it binds `DemoView.document`, G7 piece 2): only then is "Edit the
   *  cut" offered. A host that cannot open it never offers a verb whose result the person cannot reach. */
  cutOpens?: boolean;
}): React.ReactElement | null {
  if (kind === 'demo-video') {
    return (
      <>
        {script && <DemoScriptActions runId={runId} units={units} {...(onChanged === undefined ? {} : { onChanged })} />}
        <DemoReviewActions runId={runId} units={units} cutOpens={cutOpens} {...(onChanged === undefined ? {} : { onChanged })} />
      </>
    );
  }
  return <WalkthroughGateActions runId={runId} step={step} units={units} {...(onChanged === undefined ? {} : { onChanged })} {...(onEditOpen === undefined ? {} : { onEditOpen })} />;
}

function WalkthroughGateActions({ runId, step, units, onChanged, onEditOpen }: {
  runId: string; step: string | null; units: readonly UnitLike[]; onChanged?: () => void; onEditOpen?: () => void;
}): React.ReactElement | null {
  // Unit changes replace the run-status signal the old editor received from the run page.
  const { load, reload } = useRecording(runId, 'walkthrough', step, JSON.stringify(units));
  const changed = (): void => { reload(); onChanged?.(); };
  return load.kind === 'ready' ? <GateActions rec={load.rec} units={units} reload={changed} {...(onEditOpen === undefined ? {} : { onEditOpen })} /> : null;
}

/** `cutOpens`: the caller's host binds a demo's made cut to its card (G7 piece 2, the run-artifact binding); until a host
 *  says so, "Edit the cut" is not offered. */
export function recordingGateActions(binding: ArtifactBinding, units: readonly UnitLike[], onEditOpen?: () => void, script = false, cutOpens = false): ReactNode | null {
  if ((binding.source !== 'walkthrough' && binding.source !== 'demo') || binding.runId === undefined) return null;
  return <RecordingGateActions runId={binding.runId} kind={binding.source === 'walkthrough' ? 'walkthrough' : 'demo-video'} step={binding.source === 'walkthrough' ? binding.docId || null : null} units={units} script={script} cutOpens={cutOpens} {...(onEditOpen === undefined ? {} : { onEditOpen })} />;
}

function GateActions({ rec, units, reload, onEditOpen }: { rec: Recording; units: readonly UnitLike[]; reload: () => void; onEditOpen?: () => void }): React.ReactElement | null {
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

  // The gate closes once "Ask helpers to fix" is sent: its verbs go, but the note saying so stays (ev2-run 10:40Z).
  if (!verbs.includes('fix') && !verbs.includes('edit')) {
    return note === null ? null : <p data-testid="walkthrough-note" data-tone={note.tone} role={note.tone === 'bad' ? 'alert' : 'status'} className={`wk-walk-quiet${note.tone === 'bad' ? ' wk-walk-bad' : ''}`}>{note.text}</p>;
  }
  return <>
    <div data-testid="walkthrough-actions" className="wk-walk-actions">
      {verbs.includes('fix') && <button type="button" data-testid="walkthrough-fix" disabled={busy} onClick={() => void fix()} className="wk-prop-btn wk-prop-btn--primary">Ask helpers to fix</button>}
      {verbs.includes('edit') && <button type="button" data-testid="walkthrough-edit-check" disabled={busy} aria-expanded={editing} onClick={() => { if (!editing) onEditOpen?.(); setDraft(editing ? null : { take, text: storyline }); }} className="wk-prop-btn wk-prop-btn--ghost">Edit the check</button>}
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

/**
 * S15d's presenter script, rewritten at the plan gate only (crew refuses the PUT at any other stage), as host chrome
 * beside the recording (codex final review P2: a protocol-2 video editor had replaced the only place it was edited).
 * Outside the plan gate there is nothing to draw: the narration is the plugin's to show.
 */
function DemoScriptActions({ runId, units, onChanged }: { runId: string; units: readonly UnitLike[]; onChanged?: () => void }): React.ReactElement | null {
  const { load, reload } = useRecording(runId, 'demo-video', null, JSON.stringify(units));
  const [draft, setDraft] = useState<{ take: string; text: string } | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const live = useRef(true);
  useLayoutEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  if (load.kind !== 'ready' || !load.rec.scriptEditable || load.rec.script === null) return null;
  const rec = load.rec;
  const take = takeFingerprint(rec);
  const text = draft !== null && draft.take === take ? draft.text : (rec.script ?? '');
  const save = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      await putDemoScript(rec.runId, text);
      if (!live.current) return;
      setDraft(null);
      setNote({ tone: 'ok', text: 'Script saved — the recorder reads it when you approve the plan.' });
      reload();
      onChanged?.();
    } catch (e) {
      if (live.current) setNote({ tone: 'bad', text: e instanceof Error ? e.message : String(e) });
    } finally {
      if (live.current) setBusy(false);
    }
  };
  return (
    <div data-testid="demo-script-actions" className="wk-walk-actions">
      {rec.storyline !== undefined && rec.storyline.length > 0 && (
        <details data-testid="demo-storyline" className="wk-walk-edit">
          <summary className="wk-walk-quiet">What the engine will record: {rec.storyline.length} chapter{rec.storyline.length === 1 ? '' : 's'}, read-only against the app</summary>
          <ol className="wk-demo-storyline">
            {rec.storyline.map((c) => (
              <li key={c.key}>
                <strong>{c.title}</strong>
                {c.steps.length > 0 && <ul>{c.steps.map((st, i) => <li key={i}>{st}</li>)}</ul>}
              </li>
            ))}
          </ol>
        </details>
      )}
      <button type="button" data-testid="demo-script-edit" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="wk-prop-btn wk-prop-btn--ghost">Edit the script</button>
      {open && (
        <div data-testid="demo-script-box" className="wk-walk-edit">
          <p className="wk-walk-quiet">The presenter’s script. Change it here before anything records; the recorder reads it when you approve the plan.</p>
          {/* Read-only while it saves: the save then clears exactly the text it sent (codex fu r2 P2). */}
          <textarea data-testid="demo-script" value={text} readOnly={busy} onChange={(e) => setDraft({ take, text: e.target.value })} rows={6} className="wk-walk-storyline" aria-label="The presenter’s script" />
          <div className="wk-prop-btns">
            <button type="button" data-testid="demo-script-save" disabled={busy || text.trim() === '' || text === (rec.script ?? '')} onClick={() => void save()} className="wk-prop-btn wk-prop-btn--primary">Save the script</button>
          </div>
        </div>
      )}
      {note !== null && <p data-testid="demo-script-note" data-tone={note.tone} role={note.tone === 'bad' ? 'alert' : 'status'} className={`wk-walk-quiet${note.tone === 'bad' ? ' wk-walk-bad' : ''}`}>{note.text}</p>}
    </div>
  );
}

type Note = { tone: 'ok' | 'bad'; text: string };

function NoteLine({ note, testId }: { note: Note | null; testId: string }): React.ReactElement | null {
  return note === null ? null : <p data-testid={testId} data-tone={note.tone} role={note.tone === 'bad' ? 'alert' : 'status'} className={`wk-walk-quiet${note.tone === 'bad' ? ' wk-walk-bad' : ''}`}>{note.text}</p>;
}

/**
 * A demo's review and its two host verbs (plugins S4: G8, G22, G23, G7 piece 1):
 *
 *  - at the review gate: who reviewed it and what they found, the contact sheets, and **Record it again** — a gate
 *    send-back with a note, so the planner changes the plan and the engine records a whole new take of it (operator
 *    ruling D3; DES-DEMO-RECORD-001 §3.6). There is no one-chapter re-record.
 *  - once the run is done: **Edit the cut**, which makes the run's editable cut (crew imports the segments into a
 *    document the video editor re-cuts).
 */
function DemoReviewActions({ runId, units, cutOpens, onChanged }: { runId: string; units: readonly UnitLike[]; cutOpens: boolean; onChanged?: () => void }): React.ReactElement | null {
  const { load, reload } = useRecording(runId, 'demo-video', null, JSON.stringify(units));
  /** The box is bound to the take it was opened on and to the gate instance open then (when one was known). */
  const [open, setOpen] = useState<{ take: string; gate: { ord: number; receivedAt: number } | null; pick: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note | null>(null);
  const live = useRef(true);
  useLayoutEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const recRef = useRef<Recording | null>(null);
  const rec = load.kind === 'ready' ? load.rec : null;
  useLayoutEffect(() => { recRef.current = rec; }, [rec]);
  if (rec === null) return null;
  const atGate = rec.demoStage === 'review_gate';
  const canCut = cutOpens && rec.demoStage === 'done' && rec.video !== null && (rec.document ?? null) === null;
  if (!atGate && !canCut) return <NoteLine note={note} testId="demo-review-note" />;
  const take = demoTakeFingerprint(rec);
  const review = rec.review;
  // Whether a model reviews this demo comes from the run's own steps, never from a seat not assigned yet. Unless a model
  // reviews it, the note sent to the planner carries no text the recording showed: chapter keys, titles and times only.
  const policy = demoReviewPolicy(runId, units);
  const isPrivate = policy !== 'model';
  const findings = review?.findings ?? [];
  const choices: Array<{ id: string; label: string; note: string }> = [
    { id: 'whole', label: 'The whole take', note: rerecordNote() },
    ...findings.map((f, i) => {
      const c = rec.chapters.find((x) => x.key === f.chapterKey);
      return { id: `f${i}`, label: `${f.at !== '' ? `${f.at} · ` : ''}${c?.title ?? f.chapter}${isPrivate ? '' : ` · ${f.issue}`}`.slice(0, 120),
        note: rerecordNote(c === undefined ? undefined : { key: c.key, title: c.title }, f, { private: isPrivate }) };
    }),
    ...rec.chapters.filter((c) => !findings.some((f) => f.chapterKey === c.key)).map((c) => ({ id: `c:${c.key}`, label: `Chapter ${c.index}: ${c.title}`, note: rerecordNote({ key: c.key, title: c.title }) })),
  ];
  const editing = open !== null && open.take === take;
  const startAgain = (): void => {
    const first = choices.find((c) => c.id === 'f0') ?? choices[0]!;
    setNote(null);
    const g = useGateStore.getState().gates[runId];
    setOpen(editing ? null : { take, gate: g === undefined ? null : { ord: g.ord, receivedAt: g.receivedAt }, pick: first.id, text: first.note });
  };
  const send = async (): Promise<void> => {
    if (busy || !editing) return;
    setBusy(true);
    setNote(null);
    try {
      // The verb was drawn from one take at one gate: read both again, and send only while the same take is still at
      // that review gate. The decision names that gate instance, so a gate answered meanwhile (another tab) is not.
      await refreshGate(runId);
      const now = recordingOfDemo(await getDemo(runId));
      if (!live.current) return;
      const gate = useGateStore.getState().gates[runId];
      const shown = recRef.current;
      const sameGate = gate !== undefined && (open.gate === null || (gate.ord === open.gate.ord && gate.receivedAt === open.gate.receivedAt));
      if (!sameGate || now.demoStage !== 'review_gate' || demoTakeFingerprint(now) !== open.take || shown === null || demoTakeFingerprint(shown) !== open.take) {
        reload();
        throw new Error('The take changed since this was shown — nothing was sent. Look at it again.');
      }
      const outcome = await sendBackDemo(runId, open.text.trim(), { ord: gate.ord, receivedAt: gate.receivedAt });
      if (outcome === 'undone') throw new Error('Undone — nothing was sent.');
      if (outcome !== 'sent') throw new Error('Not sent — the gate changed or was already answered.');
      if (!live.current) return;
      setOpen(null);
      setNote({ tone: 'ok', text: 'Sent back to the planner. Approve the new plan and the engine records a new take.' });
      reload();
      onChanged?.();
    } catch (e) {
      if (live.current) setNote({ tone: 'bad', text: e instanceof Error ? e.message : String(e) });
    } finally {
      if (live.current) setBusy(false);
    }
  };
  const makeCut = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      const doc = await makeDemoDocument(runId);
      if (!live.current) return;
      setNote({ tone: 'ok', text: doc.created ? 'The cut is made. It opens here: chapters, trims, captions and theme, each change a version.' : 'The cut was made before. It opens here.' });
      reload();
      onChanged?.();
    } catch (e) {
      if (live.current) setNote({ tone: 'bad', text: `The cut was not made: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      if (live.current) setBusy(false);
    }
  };
  if (!atGate) {
    return (
      <div data-testid="demo-cut-actions" className="wk-walk-actions wk-demo-verbs">
        <button type="button" data-testid="demo-edit-cut" disabled={busy} onClick={() => void makeCut()} className="wk-prop-btn wk-prop-btn--ghost">{busy ? 'Making the cut…' : 'Edit the cut'}</button>
        <NoteLine note={note} testId="demo-review-note" />
      </div>
    );
  }
  const line = demoReviewLine(rec, policy);
  const tone = policy !== 'person' && review !== undefined && (review.rejected || review.verdict === 'changes') ? 'bad' : policy !== 'person' && review?.verdict === 'accept' ? 'ok' : 'quiet';
  return (
    <div data-testid="demo-review" className="wk-demo-review">
      {line !== null && <p data-testid="demo-review-line" data-tone={tone} className={`wk-walk-quiet${tone === 'bad' ? ' wk-walk-bad' : ''}`}>{line}</p>}
      {findings.length > 0 && (
        <ol data-testid="demo-review-findings" className="wk-demo-findings">
          {findings.map((f, i) => (
            <li key={i} data-testid="demo-review-finding" data-verdict={f.verdict}>
              <span className="wk-session-grey">{f.atSec !== null ? fmtTime(f.atSec) : f.at}{f.chapterKey !== null ? ` · ${rec.chapters.find((c) => c.key === f.chapterKey)?.title ?? f.chapter}` : ''}</span>
              {' '}{f.issue}
            </li>
          ))}
        </ol>
      )}
      {(rec.sheets ?? []).length > 0 && (
        <div data-testid="demo-review-sheets" className="wk-demo-sheets">
          {(rec.sheets ?? []).map((sh) => (
            <a key={sh.name} href={demoFileUrl(runId, sh.path)} target="_blank" rel="noreferrer" data-testid="demo-review-sheet" data-sheet={sh.name} className="wk-demo-sheet" title={`${SHEET_LABEL[sh.name] ?? sh.name} (opens full size)`}>
              <img src={demoFileUrl(runId, sh.path)} alt={SHEET_LABEL[sh.name] ?? sh.name} loading="lazy" />
              <span className="wk-session-grey">{SHEET_LABEL[sh.name] ?? sh.name}</span>
            </a>
          ))}
        </div>
      )}
      <div className="wk-walk-actions wk-demo-verbs">
        <button type="button" data-testid="demo-record-again" disabled={busy} aria-expanded={editing} onClick={startAgain} className="wk-prop-btn wk-prop-btn--ghost">Record it again</button>
      </div>
      {editing && (
        <div data-testid="demo-record-again-box" className="wk-walk-edit">
          <p className="wk-walk-quiet">The planner changes the plan with your note. You approve the new plan, then the engine records every chapter again.</p>
          <label className="wk-walk-quiet">What to change
            <select data-testid="demo-record-again-pick" value={open.pick} disabled={busy}
              onChange={(e) => { const c = choices.find((x) => x.id === e.target.value); if (c !== undefined) setOpen({ ...open, pick: c.id, text: c.note }); }}>
              {choices.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </label>
          <textarea data-testid="demo-record-again-note" value={open.text} readOnly={busy} onChange={(e) => setOpen({ ...open, text: e.target.value })} rows={4} className="wk-walk-storyline" aria-label="The note to the planner" />
          <div className="wk-prop-btns">
            <button type="button" data-testid="demo-record-again-send" disabled={busy || open.text.trim() === ''} onClick={() => void send()} className="wk-prop-btn wk-prop-btn--primary">Send back and record again</button>
            <button type="button" data-testid="demo-record-again-cancel" disabled={busy} onClick={() => setOpen(null)} className="wk-prop-btn wk-prop-btn--ghost">Cancel</button>
          </div>
        </div>
      )}
      <NoteLine note={note} testId="demo-review-note" />
    </div>
  );
}
