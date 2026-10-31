import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api/client.js';
import { postCapture, toCaptureFile } from '../../api/capture.js';
import { addMemory, editMemory, isMemoryEditUnsupported, type MemoryItem } from '../../api/memory.js';
import { approveProposal, listProposals, memoryPayload, proposalKind, rejectProposal, type Proposal } from '../../api/proposals.js';
import type { Ask, AskAnswer } from '../../api/ask.js';
import { AskCard, AskRecord } from '../ask/AskCard.js';

/**
 * Memory gets Steering's ways in (program DES-LEARN §6.3; mockup f-memory). Every write stays the proposal
 * queue: add-with-chat and import never write a memory directly.
 *
 *   MemoryCaptureAdd  Add with chat / Import a doc: what you say or attach goes to the project's capture
 *                     (`POST /projects/:id/capture`, a read-only run that files proposals), and ends in a
 *                     pick-several of the memories it would keep (kept = approved, unticked = rejected).
 *   MemoryTable       Edit as a table: change many memories' words at once (`POST /memory/edit` each).
 *   MemoryRetired     Show retired: estate erases a retired memory (nothing to list or bring back), so this
 *                     says so, and lists the suggestions you said no to, each of which can be brought back.
 */

const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
const TIMEOUT_MS = 15 * 60_000;

interface Turn { id: number; you: string; runId: string | null; error: string | null; decided: string | null; at: number }

export function MemoryCaptureAdd({ mode, project, projects, onClose, onKept }: {
  mode: 'chat' | 'import';
  /** The project the capture is filed under (its memories are recalled there); `default` = Unfiled. */
  project: string;
  projects: readonly { id: string; name: string }[];
  onClose: () => void;
  onKept: () => void;
}): React.ReactElement {
  const [where, setWhere] = useState(project);
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [sending, setSending] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const seq = useRef(0);

  const send = async (): Promise<void> => {
    const words = text.trim();
    if (sending || (words === '' && files.length === 0)) return;
    setSending(true);
    const id = (seq.current += 1);
    const you = words !== '' ? words : `Attached ${files.map((f) => f.name).join(', ')}`;
    setTurns((t) => [...t, { id, you, runId: null, error: null, decided: null, at: Date.now() }]);
    try {
      const body = {
        notes: mode === 'chat'
          ? `The person is telling you what helpers should remember. File each durable thing as a MEMORY (not a rule, not an intent unless they ask for work).\n\n${words}`
          : `Read the attached document(s) and file each durable thing helpers should remember as a MEMORY.${words !== '' ? `\n\nThe person adds: ${words}` : ''}`,
        ...(files.length > 0 ? { files: await Promise.all(files.map((f) => toCaptureFile(f))) } : {}),
      };
      const { runId } = await postCapture(where, body);
      setTurns((t) => t.map((x) => (x.id === id ? { ...x, runId } : x)));
      setText('');
      setFiles([]);
    } catch (e) {
      setTurns((t) => t.map((x) => (x.id === id ? { ...x, error: e instanceof Error ? e.message : String(e) } : x)));
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="wk-mem-add" data-testid={`memory-${mode}`} aria-label={mode === 'chat' ? 'Add with chat' : 'Import a doc'}>
      <div className="wk-mem-add-head">
        <b>{mode === 'chat' ? 'Add with chat' : 'Import a doc'}</b>
        <span className="wk-learn-quiet">
          {mode === 'chat' ? 'Tell it what helpers should remember. It suggests memories; you pick which to keep.' : 'Notes, a wiki page, a transcript: each memory it finds is a suggestion you keep or drop.'}
        </span>
        <button type="button" className="wk-btn wk-btn--quiet wk-btn--sm" data-testid="memory-add-close" onClick={onClose}>Close</button>
      </div>
      <div className="wk-mem-thread" data-testid="memory-add-thread">
        {turns.length === 0 && <p className="wk-learn-quiet">{mode === 'chat' ? 'For example: “We cut releases on Thursdays and freeze merges after 3pm that day.”' : 'Attach a document below.'}</p>}
        {turns.map((t) => <CaptureTurn key={t.id} turn={t} onDecided={(line) => { setTurns((x) => x.map((y) => (y.id === t.id ? { ...y, decided: line } : y))); onKept(); }} />)}
      </div>
      <form className="wk-mem-composer" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <textarea value={text} rows={mode === 'chat' ? 2 : 1} data-testid="memory-add-text" aria-label={mode === 'chat' ? 'Tell it what to remember' : 'Anything to add about the document'}
          placeholder={mode === 'chat' ? 'Tell it what to remember…' : 'Anything to add (optional)'} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && mode === 'chat') { e.preventDefault(); void send(); } }} />
        <div className="wk-learn-row">
          {mode === 'import' && (
            <>
              <button type="button" className="wk-btn wk-btn--secondary wk-btn--sm" data-testid="memory-import-pick" onClick={() => fileRef.current?.click()}>Choose a file…</button>
              <span className="wk-learn-quiet" data-testid="memory-import-files">{files.length === 0 ? 'No file yet' : files.map((f) => f.name).join(', ')}</span>
            </>
          )}
          <label className="wk-learn-quiet">Recalled in{' '}
            <select value={where} data-testid="memory-add-project" onChange={(e) => setWhere(e.target.value)}>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <button type="submit" className="wk-btn wk-btn--primary wk-btn--sm" data-testid="memory-add-send" disabled={sending || (text.trim() === '' && files.length === 0) || (mode === 'import' && files.length === 0)}>
            {sending ? 'Sending…' : mode === 'chat' ? 'Send' : 'Read it'}
          </button>
        </div>
        <input ref={fileRef} type="file" hidden multiple accept=".md,.markdown,.txt,.html,.htm,.pdf,.rst,.adoc,.vtt,.srt,image/*" onChange={(e) => { if (e.target.files !== null) setFiles(Array.from(e.target.files).slice(0, 8)); e.target.value = ''; }} />
      </form>
    </section>
  );
}

/** One exchange: what you said, the capture working, then the pick-several of what it would keep. */
function CaptureTurn({ turn, onDecided }: { turn: Turn; onDecided: (line: string) => void }): React.ReactElement {
  const [status, setStatus] = useState<string | null>(null);
  const [rows, setRows] = useState<Proposal[]>([]);
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState<string | null>(null);
  useEffect(() => {
    if (turn.runId === null || turn.decided !== null) return undefined;
    let stop = false;
    let t: ReturnType<typeof setTimeout> | undefined;
    const tick = async (): Promise<void> => {
      const run = await api.getRun(turn.runId!).then((r) => r.run, () => null);
      const st = run?.session.status ?? null;
      const got = await listProposals({ state: 'pending' }).catch(() => null);
      if (stop) return;
      if (st !== null) setStatus(st);
      if (got !== null) setRows(got.filter((p) => p.provenance['run_id'] === turn.runId && proposalKind(p) === 'memory'));
      if (!stop && (st === null || !TERMINAL.has(st)) && Date.now() - turn.at < TIMEOUT_MS) t = setTimeout(() => void tick(), 3000);
    };
    void tick();
    return () => { stop = true; if (t !== undefined) clearTimeout(t); };
  }, [turn.runId, turn.decided, turn.at]);

  const done = status !== null && TERMINAL.has(status);
  const ask: Ask | null = useMemo(() => (rows.length === 0 ? null : {
    id: `mem-${turn.id}`, host: 'learn', from: { kind: 'studio', id: 'memory', label: 'Memory' }, kind: 'pick', answeredBy: 'person',
    prompt: 'Which should helpers remember?', multi: { min: 0, max: rows.length }, default: rows.map((r) => r.id),
    options: rows.map((r) => ({ id: r.id, token: r.id, label: memoryPayload(r).content ?? '(empty)', meta: 'told by you' })),
    record: 'You kept {n} of {of} · in Memory now',
  }), [rows, turn.id]);

  const decide = async (a: AskAnswer): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setFail(null);
    const keep = new Set(a.options ?? []);
    try {
      let kept = 0;
      for (const r of rows) { if (keep.has(r.id)) { await approveProposal(r.id); kept += 1; } else await rejectProposal(r.id); }
      onDecided(`You kept ${kept} of ${rows.length} · in Memory now`);
    } catch (e) {
      setFail(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="wk-mem-turn" data-testid="memory-add-turn">
      <p className="wk-learn-you">{turn.you}</p>
      {turn.error !== null ? <p className="wk-learn-quiet wk-learn-bad" role="alert">Not sent: {turn.error}</p>
        : turn.decided !== null ? <AskRecord line={turn.decided} testId="memory-add-record" />
        : ask !== null && (done || rows.length > 0) ? (
          <div className="wk-ask-rows"><AskCard ask={ask} tag="Memories" busy={busy} onAnswer={(a) => void decide(a)} testIds={{ root: 'memory-add-ask' }} /></div>
        ) : (
          <p className="wk-learn-quiet" data-testid="memory-add-working" role="status">
            {turn.runId === null ? 'Sending…' : done ? (status === 'completed' ? 'Nothing durable to remember in that. Say more, or try other words.' : `The capture ${status}: nothing was filed.`) : 'Reading what you said and drafting memories…'}
          </p>
        )}
      {fail !== null && <p className="wk-learn-quiet wk-learn-bad" role="alert">{fail}</p>}
    </div>
  );
}

/** Edit as a table: every memory's words in one editable column; Save changes edits the changed ones. */
export function MemoryTable({ memories, onSaved, onClose }: { memories: readonly MemoryItem[]; onSaved: () => void; onClose: () => void }): React.ReactElement {
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: 'ok' | 'fail'; text: string } | null>(null);
  const changed = memories.filter((m) => edits[m.id] !== undefined && edits[m.id]!.trim() !== '' && edits[m.id]!.trim() !== m.content);
  const save = async (): Promise<void> => {
    if (busy || changed.length === 0) return;
    setBusy(true);
    setNote(null);
    let ok = 0;
    const failed: string[] = [];
    for (const m of changed) {
      try { await editMemory({ memory_id: m.id, content: edits[m.id]!.trim() }); ok += 1; } catch (e) {
        failed.push(isMemoryEditUnsupported(e) ? 'this crew cannot edit a memory' : e instanceof Error ? e.message : String(e));
      }
    }
    setBusy(false);
    setEdits({});
    setNote(failed.length === 0 ? { tone: 'ok', text: `Saved ${ok} ${ok === 1 ? 'change' : 'changes'}.` } : { tone: 'fail', text: `Saved ${ok}; ${failed.length} did not: ${[...new Set(failed)].join('; ')}` });
    onSaved();
  };
  return (
    <section className="wk-mem-table" data-testid="memory-table" aria-label="Edit memories as a table">
      <div className="wk-learn-row wk-mem-table-bar">
        <b>{memories.length} memories</b>
        <span className="wk-learn-quiet">Change the words in place; Save changes edits only the rows you changed.</span>
        <button type="button" className="wk-btn wk-btn--primary wk-btn--sm" data-testid="memory-table-save" disabled={busy || changed.length === 0} onClick={() => void save()}>
          {busy ? 'Saving…' : changed.length === 0 ? 'Save changes' : `Save ${changed.length} ${changed.length === 1 ? 'change' : 'changes'}`}
        </button>
        <button type="button" className="wk-btn wk-btn--quiet wk-btn--sm" data-testid="memory-table-close" onClick={onClose}>Done</button>
      </div>
      {note !== null && <p className={`wk-learn-quiet${note.tone === 'fail' ? ' wk-learn-bad' : ''}`} role="status" data-testid="memory-table-note">{note.text}</p>}
      <div className="wk-mem-table-scroll">
        <table>
          <thead><tr><th scope="col">Memory</th><th scope="col">Kind</th><th scope="col">Where</th></tr></thead>
          <tbody>
            {memories.map((m) => (
              <tr key={m.id} data-testid="memory-table-row" data-changed={changed.includes(m) ? 'true' : undefined}>
                <td><textarea aria-label={`Words of memory ${m.id}`} rows={2} value={edits[m.id] ?? m.content} data-testid="memory-table-text"
                  onChange={(e) => setEdits((x) => ({ ...x, [m.id]: e.target.value }))} /></td>
                <td>{m.tier}</td>
                <td>{m.facets.project ?? (m.scope === '' ? 'Everywhere' : m.scope)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Show retired: what estate keeps (nothing of a retired memory) and the suggestions you said no to. */
export function MemoryRetired({ onClose, onBrought }: { onClose: () => void; onBrought: () => void }): React.ReactElement {
  const [rows, setRows] = useState<Proposal[] | null>(null);
  const [fail, setFail] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [back, setBack] = useState<string[]>([]);
  useEffect(() => {
    listProposals({ state: 'rejected' }).then((ps) => setRows(ps.filter((p) => proposalKind(p) === 'memory').sort((a, b) => b.created_at - a.created_at)), (e: unknown) => setFail(e instanceof Error ? e.message : String(e)));
  }, []);
  const bring = async (p: Proposal): Promise<void> => {
    const content = memoryPayload(p).content;
    if (busy !== null || content === null) return;
    setBusy(p.id);
    try {
      await addMemory({ content, ...(p.facets.project !== undefined ? { project: p.facets.project } : {}) });
      setBack((b) => [...b, p.id]);
      onBrought();
    } catch (e) {
      setFail(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className="wk-mem-retired" data-testid="memory-retired" aria-label="Retired">
      <div className="wk-learn-row">
        <b>Retired</b>
        <button type="button" className="wk-btn wk-btn--quiet wk-btn--sm" data-testid="memory-retired-close" onClick={onClose}>Back to memories</button>
      </div>
      <p className="wk-learn-quiet" data-testid="memory-retired-erased">A retired memory is erased: the memory store keeps no copy, so it can’t be listed or brought back. Below are the suggestions you said no to; you can keep any of them now.</p>
      {fail !== null && <p className="wk-learn-quiet wk-learn-bad" role="alert">{fail}</p>}
      {rows === null && fail === null && <p className="wk-learn-quiet">Reading…</p>}
      {rows !== null && rows.length === 0 && <p className="wk-learn-quiet" data-testid="memory-retired-empty">No suggestion has been said no to.</p>}
      {rows !== null && rows.length > 0 && (
        <ul className="wk-learn-rules">
          {rows.slice(0, 50).map((p) => (
            <li key={p.id} className="wk-learn-rule" data-testid="memory-retired-row">
              <span className="wk-learn-dot wk-learn-dot--off" aria-hidden />
              <span><span className="wk-learn-rule-t">{memoryPayload(p).content ?? '(empty)'}</span><span className="wk-learn-rule-s">said no to · {new Date(p.created_at * 1000).toLocaleDateString()}</span></span>
              {back.includes(p.id) ? <span className="wk-learn-quiet" data-testid="memory-retired-back">Kept</span> : (
                <button type="button" className="wk-btn wk-btn--quiet wk-btn--sm" data-testid="memory-retired-bring" disabled={busy !== null} onClick={() => void bring(p)}>Bring back</button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
