import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { demoFileUrl, getDemo } from '../../api/demo.js';
import { isWalkthroughUnsupported, walkthroughApi, walkthroughFileUrl, type DemoExportFormat, type WalkthroughView } from '../../api/walkthrough.js';
import type { ArtifactSize } from '../../board/artifactMorph.js';
import {
  authorWaiting, chapterMarks, checksTrack, escalationOpen, exportOptions, failedChapter, fixNote, fmtTime, gateVerbs, isLive, playheadStart,
  recordingOf, recordingOfDemo, seatLine, stateLine, takeFingerprint, underneathLines, type GateVerb, type Recording, type RecordingKind, type UnitLike,
} from '../../board/walkthroughModel.js';
import { commitGateDecision, refreshGate } from '../../board/gateActions.js';
import { useGateStore } from '../../store/gates.js';
import { publishRecording, withdrawRecording } from '../../store/recordings.js';
import { consumeWalkthroughSeek, useWalkthroughSeek } from '../../store/walkthroughSeek.js';

/**
 * THE WALKTHROUGH ARTIFACT (DES-WALKTHROUGH-PROOF-001 §3 scenes 18–23 and 41, slice WT-U1): the
 * body of {@link ArtifactMorph}'s kind slot for the `walkthrough` and `demo-video` kinds.
 *
 *  - inline: the state line ("● Recording · chapter 4 of 6", "✗ Failed at 0:41"), who checks and who
 *    builds, the chapter marks with their verdicts, what happened underneath in red, the failing
 *    frame, and the actions the open escalation allows — nothing load-bearing below the fold.
 *  - pane / full: the video editor — the stitched take with the playhead on the failing moment, the
 *    chapters as seek points, the narration, the checks track (each check at its moment, with its
 *    evidence under ⋯), the red mark where it failed, the same actions, and Export.
 *
 * The actions are the run's own gate: "Ask helpers to fix" is a `request_changes` with what the
 * walkthrough caught; "Edit the check" is the storyline PUT then an approve. Both are offered only
 * while the open gate is THIS walkthrough's escalation (crew refuses the PUT otherwise).
 *
 * Everything shown is read from `GET /runs/:id/walkthrough` (polled while it moves, re-read when the
 * run's status changes) or, for the `demo-video` kind, `GET /runs/:id/demo`; the files come through
 * the contained file routes. Nothing here says "checked" — that word is the acceptance read's (WT-U2).
 */

const POLL_MS = 2500;
/** A read that keeps failing is retried this many times (5 s apart), then left: the line says it failed. */
const MAX_FAILED_READS = 5;

type Load = { kind: 'loading' } | { kind: 'absent' } | { kind: 'failed'; message: string } | { kind: 'ready'; rec: Recording };

export function useRecording(runId: string, kind: RecordingKind, step: string | null, runStatus: string): { load: Load; reload: () => void } {
  // What is read belongs to ONE (kind, run, step): after any of them changes, the previous
  // recording is never shown — or acted on — under the new identity, not even while the new read fails.
  const ident = `${kind}\u0000${runId}\u0000${step ?? ''}`;
  const [held, setHeld] = useState<{ ident: string; load: Load }>({ ident, load: { kind: 'loading' } });
  const load: Load = held.ident === ident ? held.load : { kind: 'loading' };
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const setLoad = (next: Load | ((was: Load) => Load)): void => setHeld((h) => {
      const was: Load = h.ident === ident ? h.load : { kind: 'loading' };
      return { ident, load: typeof next === 'function' ? next(was) : next };
    });
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let fails = 0;
    const read = async (): Promise<void> => {
      try {
        const rec = kind === 'demo-video' ? recordingOfDemo(await getDemo(runId)) : recordingOf(await walkthroughApi.view(runId, step));
        if (cancelled) return;
        fails = 0;
        publishRecording(rec); // WT-U2: the chain's chips place their moments by this take's chapter marks
        setLoad(kind === 'walkthrough' && rec.step === null && rec.planStep === null ? { kind: 'absent' } : { kind: 'ready', rec });
        if (isLive(rec.state)) timer = setTimeout(() => void read(), POLL_MS);
      } catch (e) {
        if (cancelled) return;
        if (kind === 'walkthrough') withdrawRecording(runId); // WT-U2: no chip moment from a take not re-read
        // A read that fails while a recording is on screen keeps it (a blip must not blank the take).
        setLoad((was) => (isWalkthroughUnsupported(e) ? { kind: 'absent' }
          : was.kind === 'ready' ? was : { kind: 'failed', message: e instanceof Error ? e.message : String(e) }));
        fails += 1;
        if (!isWalkthroughUnsupported(e) && fails < MAX_FAILED_READS) timer = setTimeout(() => void read(), POLL_MS * 2);
      }
    };
    void read();
    return () => { cancelled = true; if (timer !== null) clearTimeout(timer); };
  }, [runId, kind, step, runStatus, tick, ident]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { load, reload };
}

function fileUrl(rec: Recording, path: string): string {
  return rec.kind === 'demo-video' ? demoFileUrl(rec.runId, path) : walkthroughFileUrl(rec.runId, rec.step, path);
}

export function WalkthroughEditor({ runId, kind, step, size, morph, units, runStatus }: {
  runId: string;
  kind: RecordingKind;
  /** The walkthrough step (`walkthrough_review` id); `null` = the newest pair. */
  step: string | null;
  size: ArtifactSize;
  morph: (to: ArtifactSize) => void;
  /** The run's units — which one is denied says whether the open gate is this walkthrough's. */
  units: readonly UnitLike[];
  /** The run's status: a change (a gate answered, the run moving again) re-reads the recording. */
  runStatus: string;
}): React.ReactElement {
  const { load, reload } = useRecording(runId, kind, step, runStatus);
  if (load.kind === 'loading') return <p data-testid="walkthrough-loading" className="wk-walk-quiet wk-walk-pad">Reading the recording…</p>;
  if (load.kind === 'absent') return <p data-testid="walkthrough-absent" className="wk-walk-quiet wk-walk-pad">No recording for this run on this daemon.</p>;
  if (load.kind === 'failed') return <p data-testid="walkthrough-error" role="alert" className="wk-walk-quiet wk-walk-bad wk-walk-pad">Could not read the recording: {load.message}</p>;
  return <Body rec={load.rec} size={size} morph={morph} units={units} reload={reload} />;
}

function ChapterMarks({ rec, onSeek }: { rec: Recording; onSeek?: (sec: number) => void }): React.ReactElement | null {
  const marks = chapterMarks(rec);
  if (marks.length === 0) return null;
  return (
    <ol data-testid="walkthrough-chapters" className="wk-walk-chapters" aria-label="Chapters">
      {marks.map((m) => {
        const inner = (
          <>
            <span aria-hidden className={`wk-walk-chip wk-walk-chip--${m.verdict === 'FAIL' ? 'fail' : m.verdict === 'PASS' ? 'pass' : m.current ? 'live' : m.recorded ? 'done' : 'todo'}`}>
              {m.verdict === 'FAIL' ? '✗' : m.verdict === 'PASS' ? '✓' : m.current ? '●' : String(m.index)}
            </span>
            <span className="wk-walk-chapter-title">{m.title}</span>
            {m.sec !== null && <span className="wk-walk-quiet">{fmtTime(m.sec)}</span>}
          </>
        );
        return (
          <li key={m.key} data-testid="walkthrough-chapter" data-key={m.key} data-verdict={m.verdict ?? ''} data-current={m.current ? 'true' : 'false'} className="wk-walk-chapter">
            {onSeek !== undefined && m.sec !== null
              ? <button type="button" data-testid="walkthrough-marker" data-sec={String(m.sec)} onClick={() => onSeek(m.sec as number)} className="wk-walk-chapter-btn">{inner}</button>
              : <span className="wk-walk-chapter-btn">{inner}</span>}
          </li>
        );
      })}
    </ol>
  );
}

/** One component at every size, so what the operator started (an edit, a made export, a note)
 *  survives the morph — only the layout changes. */
function Body({ rec, size, morph, units, reload }: {
  rec: Recording;
  size: ArtifactSize;
  morph: (to: ArtifactSize) => void;
  units: readonly UnitLike[];
  reload: () => void;
}): React.ReactElement {
  const video = useRef<HTMLVideoElement | null>(null);
  const wantPlay = useRef(false);
  // WT-U2 (scene 22): a "checked at 0:34 ▸" chip on the chain asks for a moment. Open, the player
  // seeks; inline, the pane opens and the playhead is placed there (instead of the failing moment)
  // once the player is up.
  const seekReq = useWalkthroughSeek((s) => s.byRun[rec.runId]);
  const seenSeek = useRef(0);
  const pendingSeek = useRef<number | null>(null);
  const line = stateLine(rec, { authorWaiting: authorWaiting(rec, units) });
  const seats = seatLine(rec);
  const failed = failedChapter(rec);
  const under = underneathLines(rec);
  const track = useMemo(() => checksTrack(rec), [rec]);
  const gate = useGateStore((s) => s.gates[rec.runId]);
  const verbs = gateVerbs(rec, escalationOpen(rec, gate?.ord ?? null, units));
  const options = exportOptions(rec);
  const [duration, setDuration] = useState<number | null>(null);
  const [raw, setRaw] = useState<string | null>(null);
  // An Edit-the-check draft belongs to the take it was opened on, BY CONSTRUCTION: it carries that
  // take's fingerprint, and on any other take there is no open box and no text — in the same render
  // that shows the other take, with no effect in between. It can never be saved over a newer take.
  const [draft, setDraft] = useState<{ take: string; text: string } | null>(null);
  const [note, setNote] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [made, setMade] = useState<Partial<Record<DemoExportFormat, string>>>({});
  const src = rec.video === null ? null : fileUrl(rec, rec.video);
  const startAt = playheadStart(rec);
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

  // Esc closes the export menu before it shrinks the artifact (the artifact's own listener skips a
  // prevented event); a click elsewhere closes it too.
  useEffect(() => {
    if (!exportOpen) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      setExportOpen(false);
    };
    const onDown = (e: MouseEvent): void => {
      const t = e.target as HTMLElement | null;
      if (t === null || t.closest('.wk-walk-export') === null) setExportOpen(false);
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('mousedown', onDown);
    return () => { document.removeEventListener('keydown', onKey, true); document.removeEventListener('mousedown', onDown); };
  }, [exportOpen]);

  const seek = useCallback((sec: number, play = true): void => {
    const el = video.current;
    if (el === null) return;
    el.currentTime = sec;
    if (play) void el.play().catch(() => undefined);
  }, []);

  // The playhead opens on the failing moment (scene 19 → 20), each time the player appears; a
  // Watch pressed at the inline size plays from there once the player is up.
  const open = size !== 'inline';
  useEffect(() => {
    const el = video.current;
    if (!open || el === null) return undefined;
    const place = (): void => {
      el.currentTime = pendingSeek.current ?? startAt;
      pendingSeek.current = null;
      if (wantPlay.current) { wantPlay.current = false; void el.play().catch(() => undefined); }
    };
    if (el.readyState >= 1) { place(); return undefined; }
    el.addEventListener('loadedmetadata', place, { once: true });
    // Closed (or re-sourced) before the metadata came: the pending Watch is dropped, never replayed
    // on a later open.
    return () => { el.removeEventListener('loadedmetadata', place); wantPlay.current = false; };
  }, [open, src, startAt, take]);
  useEffect(() => {
    if (rec.kind !== 'walkthrough' || seekReq === undefined || seekReq.n === seenSeek.current) return;
    seenSeek.current = seekReq.n;
    consumeWalkthroughSeek(rec.runId, seekReq.n);
    if (open) seek(seekReq.sec);
    else { pendingSeek.current = seekReq.sec; wantPlay.current = src !== null; morph('pane'); }
  }, [seekReq, open, src, seek, morph, rec.kind, rec.runId]);

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
  const exportAs = (format: DemoExportFormat): Promise<void> => act(`${format === 'gif' ? 'GIF' : 'Poster'} made.`, async () => {
    const r = await walkthroughApi.demoExport(rec.runId, format);
    if (live.current) setMade((m) => ({ ...m, [format]: r.path }));
  });
  const onVerb = (v: GateVerb): void => {
    if (v === 'watch') {
      if (open) seek(startAt);
      else { wantPlay.current = src !== null; morph('pane'); }
    } else if (v === 'fix') void fix();
    else {
      // Opens the box for THIS take (at the inline size it also opens the pane); pressed again, closes it.
      setDraft(editing && open ? null : { take, text: storyline });
      if (!open) morph('pane');
    }
  };

  const actions = verbs.length > 0 && (
    <div data-testid="walkthrough-actions" className="wk-walk-actions">
      {verbs.includes('watch') && <button type="button" data-testid="walkthrough-watch" onClick={() => onVerb('watch')} className="wk-prop-btn wk-prop-btn--ghost">Watch</button>}
      {verbs.includes('fix') && <button type="button" data-testid="walkthrough-fix" disabled={busy} onClick={() => onVerb('fix')} className="wk-prop-btn wk-prop-btn--primary">Ask helpers to fix</button>}
      {verbs.includes('edit') && <button type="button" data-testid="walkthrough-edit-check" disabled={busy} aria-expanded={editing && open} onClick={() => onVerb('edit')} className="wk-prop-btn wk-prop-btn--ghost">Edit the check</button>}
    </div>
  );
  const noteLine = note !== null && (
    <p data-testid="walkthrough-note" data-tone={note.tone} role={note.tone === 'bad' ? 'alert' : 'status'} className={`wk-walk-quiet${note.tone === 'bad' ? ' wk-walk-bad' : ''}`}>{note.text}</p>
  );

  if (!open) {
    return (
      <div data-testid="walkthrough" data-kind={rec.kind} data-state={rec.state} data-run-id={rec.runId} data-size={size} className="wk-walk wk-walk--preview">
        <div className="wk-walk-cols">
          <div className="wk-walk-main">
            <p data-testid="walkthrough-state" data-tone={line.tone} className={`wk-walk-state wk-walk-state--${line.tone}`}>
              <span aria-hidden className="wk-walk-mark">{line.mark}</span> {line.text}
            </p>
            {seats !== null && <p data-testid="walkthrough-seats" className="wk-walk-quiet">{seats}</p>}
            <ChapterMarks rec={rec} />
            {under.length > 0 && (
              <ul data-testid="walkthrough-underneath" className="wk-walk-under">
                {under.map((u, i) => <li key={i} className="wk-walk-bad">{u}</li>)}
              </ul>
            )}
            {actions}
            {noteLine}
          </div>
          {failed?.failedFrame != null && (
            <img data-testid="walkthrough-failed-frame" src={fileUrl(rec, failed.failedFrame)} alt={`The failing frame of chapter ${failed.index}`} className="wk-walk-frame" />
          )}
        </div>
      </div>
    );
  }

  const mark = (sec: number | null): number | null => (sec === null || duration === null || duration <= 0 ? null : Math.min(100, Math.max(0, (sec / duration) * 100)));
  const failMark = failed === null ? null : mark(failed.failedAbsSec);
  return (
    <div data-testid="walkthrough" data-kind={rec.kind} data-state={rec.state} data-run-id={rec.runId} data-size={size} className={`wk-walk wk-walk--${size}`}>
      <div className="wk-walk-head">
        <p data-testid="walkthrough-state" data-tone={line.tone} className={`wk-walk-state wk-walk-state--${line.tone}`}><span aria-hidden className="wk-walk-mark">{line.mark}</span> {line.text}</p>
        {seats !== null && <p data-testid="walkthrough-seats" className="wk-walk-quiet">{seats}</p>}
        {rec.kind === 'walkthrough' && rec.video !== null && <p data-testid="walkthrough-sealed" data-sealed={rec.sealed ? 'true' : 'false'} className="wk-walk-quiet">{rec.sealed ? 'Sealed: the take matches the files on disk.' : 'Not sealed.'}</p>}
        {options.length > 0 && (
          <span className="wk-walk-export">
            <button type="button" data-testid="walkthrough-export" aria-expanded={exportOpen} aria-controls="wk-walk-export-list" onClick={() => setExportOpen((o) => !o)} className="wk-prop-btn wk-prop-btn--ghost">Export ▾</button>
            {exportOpen && (
              <span id="wk-walk-export-list" data-testid="walkthrough-export-menu" className="wk-walk-export-menu">
                {options.map((o) => {
                  if (o.format === 'mp4') return <a key="mp4" href={src ?? '#'} download data-testid="walkthrough-export-mp4" className="wk-walk-export-item">Video<small>the take, as recorded</small></a>;
                  if (o.how === 'download' && o.path !== undefined) return <a key="poster" href={fileUrl(rec, o.path)} download data-testid="walkthrough-export-poster-file" className="wk-walk-export-item">Poster<small>one still frame</small></a>;
                  if (o.format === 'gif') {
                    return made.gif !== undefined
                      ? <a key="gif" href={fileUrl(rec, made.gif)} download data-testid="walkthrough-download-gif" className="wk-walk-export-item">Download the GIF</a>
                      : <button key="gif" type="button" data-testid="walkthrough-export-gif" disabled={busy} onClick={() => void exportAs('gif')} className="wk-walk-export-item">GIF<small>a short loop</small></button>;
                  }
                  return made.poster !== undefined
                    ? <a key="poster" href={fileUrl(rec, made.poster)} download data-testid="walkthrough-download-poster" className="wk-walk-export-item">Download the poster</a>
                    : <button key="poster" type="button" data-testid="walkthrough-export-poster" disabled={busy} onClick={() => void exportAs('poster')} className="wk-walk-export-item">Poster<small>one still frame</small></button>;
                })}
              </span>
            )}
          </span>
        )}
      </div>
      <div className="wk-walk-grid">
      <div className="wk-walk-stage">
        {src !== null ? (
          <video
            key={take}
            ref={video}
            data-testid="walkthrough-video"
            data-playhead={String(startAt)}
            src={src}
            poster={rec.poster !== null ? fileUrl(rec, rec.poster) : undefined}
            controls
            preload="metadata"
            className="wk-walk-video"
            onLoadedMetadata={(e) => setDuration(Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : null)}
          />
        ) : failed?.failedFrame != null ? (
          <img data-testid="walkthrough-failed-frame" src={fileUrl(rec, failed.failedFrame)} alt={`The failing frame of chapter ${failed.index}`} className="wk-walk-video" />
        ) : (
          <p data-testid="walkthrough-no-video" className="wk-walk-quiet">No take to play yet.</p>
        )}
        {/* The timeline: a mark per chapter, a red mark at the failing moment. */}
        {duration !== null && (
          <div data-testid="walkthrough-timeline" className="wk-walk-timeline" aria-hidden>
            {chapterMarks(rec).map((m) => { const p = mark(m.sec); return p === null ? null : <span key={m.key} className="wk-walk-tick" style={{ left: `${p}%` }} title={m.title} />; })}
            {failed !== null && failMark !== null && <span data-testid="walkthrough-fail-mark" className="wk-walk-tick wk-walk-tick--fail" style={{ left: `${failMark}%` }} title={`Failed at ${fmtTime(failed.failedAbsSec ?? 0)}`} />}
          </div>
        )}
        <ChapterMarks rec={rec} onSeek={(sec) => seek(sec)} />
      </div>
      {/* Beside the take at full screen, under it in the pane: what to do, then every check — above the fold. */}
      <div className="wk-walk-side">
      {actions}
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
      {noteLine}
      {track.length > 0 && (
        <ol data-testid="walkthrough-checks" className="wk-walk-checks" aria-label="Checks">
          {track.map((k) => (
            <li key={`${k.chapter.key}/${k.id}`} data-testid="walkthrough-check" data-kind={k.kind} data-passed={k.passed === null ? '' : String(k.passed)} className={`wk-walk-check${k.passed === false ? ' wk-walk-check--fail' : ''}`}>
              <span aria-hidden className={`wk-walk-chip${k.passed === true ? ' wk-walk-chip--pass' : k.passed === false ? ' wk-walk-chip--fail' : ''}`}>{k.passed === true ? '✓' : k.passed === false ? '✗' : '·'}</span>
              <span className="wk-walk-check-text">{k.sentence}</span>
              <span className="wk-walk-quiet">{k.kind.replace(/_/g, ' ')}</span>
              {k.atAbsSec !== null && <button type="button" data-testid="walkthrough-check-time" data-sec={String(k.atAbsSec)} aria-label={`Play from ${fmtTime(k.atAbsSec)}`} onClick={() => seek(k.atAbsSec as number)} className="wk-walk-time">{fmtTime(k.atAbsSec)} ▸</button>}
              {k.evidence.length > 0 && (
                <button type="button" data-testid="walkthrough-evidence-toggle" aria-expanded={raw === `${k.chapter.key}/${k.id}`} aria-label={`Evidence for: ${k.sentence}`} onClick={() => setRaw((r) => (r === `${k.chapter.key}/${k.id}` ? null : `${k.chapter.key}/${k.id}`))} className="wk-walk-time">⋯</button>
              )}
              {k.detail !== null && k.detail !== '' && <span data-testid="walkthrough-check-detail" className="wk-walk-bad wk-walk-detail">{k.detail}</span>}
              {raw === `${k.chapter.key}/${k.id}` && (
                <ul data-testid="walkthrough-evidence" className="wk-walk-evidence">
                  {k.evidence.map((p) => <li key={p}><a href={fileUrl(rec, p)} target="_blank" rel="noreferrer" data-testid="walkthrough-evidence-file">{p}</a></li>)}
                  {k.vaultEntry !== null && <li className="wk-walk-quiet">vault {k.vaultEntry}</li>}
                </ul>
              )}
            </li>
          ))}
        </ol>
      )}
      {rec.script !== null && <details data-testid="walkthrough-narration" className="wk-walk-narration"><summary>Narration</summary><pre className="wk-walk-pre">{rec.script}</pre></details>}
      {rec.script === null && rec.chapters.some((c) => c.blurb !== '') && (
        <details data-testid="walkthrough-narration" className="wk-walk-narration" open={size === 'full'}>
          <summary>Narration</summary>
          <ol className="wk-walk-narration-list">
            {rec.chapters.map((c) => (c.blurb === '' ? null : <li key={c.key}><b>{c.title}</b> — {c.blurb}</li>))}
          </ol>
        </details>
      )}
      </div>
      </div>
    </div>
  );
}
