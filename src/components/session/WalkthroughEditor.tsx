import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { demoFileUrl, putDemoScript } from '../../api/demo.js';
import { walkthroughApi, walkthroughFileUrl, type DemoExportFormat } from '../../api/walkthrough.js';
import type { ArtifactSize } from '../../board/artifactMorph.js';
import {
  authorWaiting, chapterMarks, checksTrack, exportOptions, failedChapter, fmtTime, gateVerbs, playheadStart,
  seatLine, stateLine, takeFingerprint, underneathLines, type Recording, type RecordingKind, type UnitLike,
} from '../../board/walkthroughModel.js';
import { useDisplayText } from '../../hooks/useHomePath.js';
import { useRecording } from '../editorPorts/useRecording.js';
import { consumeWalkthroughSeek, useWalkthroughSeek } from '../../store/walkthroughSeek.js';
import { addAboutChip } from '../../store/composerChips.js';

/**
 * THE WALKTHROUGH ARTIFACT (DES-WALKTHROUGH-PROOF-001 §3 scenes 18–23 and 41, slice WT-U1): the
 * body of {@link ArtifactMorph}'s kind slot for the `walkthrough` and `demo-video` kinds.
 *
 *  - inline: the take itself, playable in place (S15d, Amendment 5 item 2 — the preview IS the video;
 *    a failed walkthrough shows its failing frame instead), beside the state line ("● Recording ·
 *    chapter 4 of 6", "✗ Failed at 0:41", "✓ Ready to watch · 3 chapters · 1:45"), who checks and who
 *    builds, the chapter marks (each a seek point), what happened underneath in red, and the actions
 *    the open escalation allows — nothing load-bearing below the fold.
 *  - pane / full: the video editor — the stitched take with the playhead on the failing moment, the
 *    chapters as seek points, the narration (a demo's script, editable while its plan gate is open —
 *    crew accepts the PUT only then), the checks track (each check at its moment, with its evidence
 *    under ⋯), the red mark where it failed, and Export. The gate actions live in host chrome.
 *
 * ONE tree at every size: the `<video>` keeps its place in it, so the morph never remounts the player
 * (what is playing inline keeps playing in the pane). Picking a chapter seeks AND makes it the subject
 * of the next message (DESIGN-interaction rule 2: an "about: chapter 2 · …" chip on the composer).
 *
 * The host's actions are the run's own gate: "Ask helpers to fix" is a `request_changes` with what the
 * walkthrough caught; "Edit the check" is the storyline PUT then an approve. Both are offered only
 * while the open gate is THIS walkthrough's escalation (crew refuses the PUT otherwise).
 *
 * Everything shown is read from `GET /runs/:id/walkthrough` (polled while it moves, re-read when the
 * run's status changes) or, for the `demo-video` kind, `GET /runs/:id/demo`; the files come through
 * the contained file routes. Nothing here says "checked" — that word is the acceptance read's (WT-U2).
 */

/**
 * studio#509: a keyboard entry into the player (Tab / Shift+Tab from outside it) lands the focus on
 * one of the native controls' own buttons, inside Chromium's user-agent shadow tree — and from there
 * Chromium delivers NO key event to the page (measured: not keydown, not keyup, not even at a
 * window-level capture listener), so Esc could not shrink the artifact. The focus event is still
 * retargeted to the `<video>`, so on an entry from OUTSIDE (`relatedTarget` is not the player) the
 * focus is re-pointed at the player itself: Space / arrows still drive it there, Esc reaches the
 * artifact, and Tab from it walks the native buttons as before (moves between them fire no focus
 * event at the host, so this never pulls the focus back out of them).
 */
export function focusPlayerOnEntry(e: React.FocusEvent<HTMLMediaElement>): void {
  if (e.relatedTarget !== e.currentTarget) e.currentTarget.focus({ preventScroll: true });
}

export { useRecording } from '../editorPorts/useRecording.js';

function fileUrl(rec: Recording, path: string): string {
  return rec.kind === 'demo-video' ? demoFileUrl(rec.runId, path) : walkthroughFileUrl(rec.runId, rec.step, path);
}

export function WalkthroughEditor({ runId, kind, step, size, morph, units, runStatus, composerKey = null }: {
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
  /** The session composer a picked chapter becomes the subject of (rule 2); `null` = no chip. */
  composerKey?: string | null;
}): React.ReactElement {
  const { load, reload } = useRecording(runId, kind, step, runStatus);
  if (load.kind === 'loading') return <p data-testid="walkthrough-loading" className="wk-walk-quiet wk-walk-pad">Reading the recording…</p>;
  if (load.kind === 'absent') return <p data-testid="walkthrough-absent" className="wk-walk-quiet wk-walk-pad">No recording for this run on this daemon.</p>;
  if (load.kind === 'failed') return <p data-testid="walkthrough-error" role="alert" className="wk-walk-quiet wk-walk-bad wk-walk-pad">Could not read the recording: {load.message}</p>;
  return <Body rec={load.rec} size={size} morph={morph} units={units} reload={reload} composerKey={composerKey} />;
}

type ChapterMark = ReturnType<typeof chapterMarks>[number];

function ChapterMarks({ rec, onSeek }: { rec: Recording; onSeek?: (m: ChapterMark) => void }): React.ReactElement | null {
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
              ? <button type="button" data-testid="walkthrough-marker" data-sec={String(m.sec)} onClick={() => onSeek(m)} className="wk-walk-chapter-btn">{inner}</button>
              : <span className="wk-walk-chapter-btn">{inner}</span>}
          </li>
        );
      })}
    </ol>
  );
}

/** One component at every size, so what the operator started (an edit, a made export, a note)
 *  survives the morph — only the layout changes. */
function Body({ rec, size, morph, units, reload, composerKey }: {
  rec: Recording;
  size: ArtifactSize;
  morph: (to: ArtifactSize) => void;
  units: readonly UnitLike[];
  reload: () => void;
  composerKey: string | null;
}): React.ReactElement {
  const video = useRef<HTMLVideoElement | null>(null);
  const wantPlay = useRef(false);
  // WT-U2 (scene 22): a "checked at 0:34 ▸" chip on the chain asks for a moment. Open, the player
  // seeks; inline, the pane opens and the playhead is placed there (instead of the failing moment)
  // once the player is up.
  const seekReq = useWalkthroughSeek((s) => s.byRun[rec.runId]);
  const seenSeek = useRef(0);
  const pendingSeek = useRef<number | null>(null);
  const showText = useDisplayText();
  const line = stateLine(rec, { authorWaiting: authorWaiting(rec, units) });
  const seats = seatLine(rec);
  const failed = failedChapter(rec);
  const under = underneathLines(rec);
  const track = useMemo(() => checksTrack(rec), [rec]);
  const verbs = gateVerbs(rec, false);
  const options = exportOptions(rec);
  const [duration, setDuration] = useState<number | null>(null);
  const [raw, setRaw] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [made, setMade] = useState<Partial<Record<DemoExportFormat, string>>>({});
  const src = rec.video === null ? null : fileUrl(rec, rec.video);
  const startAt = playheadStart(rec);
  const take = takeFingerprint(rec);
  // Mounted, as of the commit: the cleanup runs inside the unmount's commit (a layout effect), so a
  // read that resolves right after it never finds the flag still up.
  const live = useRef(true);
  useLayoutEffect(() => { live.current = true; return () => { live.current = false; }; }, []);

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
    if (play) void safePlay(el);
  }, []);
  // Rule 2: a picked chapter is what the next message is about — one chip per chapter, relabelled
  // in place when the same chapter is picked again.
  const pickChapter = useCallback((m: ChapterMark): void => {
    if (m.sec !== null) seek(m.sec);
    if (composerKey !== null) addAboutChip(composerKey, { kind: 'about', key: `chapter:${rec.runId}:${m.key}`, label: `chapter ${m.index} · ${m.title}` });
  }, [seek, composerKey, rec.runId]);
  // S15d: the presenter's script, rewritten at the plan gate (crew refuses the PUT at any other stage).
  const [scriptDraft, setScriptDraft] = useState<{ take: string; text: string } | null>(null);
  const scriptText = scriptDraft !== null && scriptDraft.take === take ? scriptDraft.text : (rec.script ?? '');
  const saveScript = (): Promise<void> => act('Script saved — the recorder reads it when you approve the plan.', async () => {
    await putDemoScript(rec.runId, scriptText);
    if (live.current) setScriptDraft(null);
    reload();
  });

  // The playhead opens on the failing moment (scene 19 → 20), each time the player appears; a
  // Watch pressed at the inline size plays from there once the player is up.
  const open = size !== 'inline';
  useEffect(() => {
    const el = video.current;
    if (!open || el === null) return undefined;
    const place = (): void => {
      // A take already playing inline (S15d) keeps its place through the morph; a player that is at
      // its start (just mounted, or never played) opens on the failing moment.
      const target = pendingSeek.current ?? (el.currentTime > 0.5 ? null : startAt);
      if (target !== null) el.currentTime = target;
      pendingSeek.current = null;
      if (wantPlay.current) { wantPlay.current = false; void safePlay(el); }
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
  const exportAs = (format: DemoExportFormat): Promise<void> => act(`${format === 'gif' ? 'GIF' : 'Poster'} made.`, async () => {
    const r = await walkthroughApi.demoExport(rec.runId, format);
    if (live.current) setMade((m) => ({ ...m, [format]: r.path }));
  });
  const watch = (): void => {
    if (open) seek(startAt);
    else { wantPlay.current = src !== null; morph('pane'); }
  };
  const actions = verbs.includes('watch') && (
    <div data-testid="walkthrough-actions" className="wk-walk-actions">
      <button type="button" data-testid="walkthrough-watch" onClick={watch} className="wk-prop-btn wk-prop-btn--ghost">Watch</button>
    </div>
  );
  const noteLine = note !== null && (
    <p data-testid="walkthrough-note" data-tone={note.tone} role={note.tone === 'bad' ? 'alert' : 'status'} className={`wk-walk-quiet${note.tone === 'bad' ? ' wk-walk-bad' : ''}`}>{note.text}</p>
  );
  // The take is the preview (rule 1). A failed walkthrough's preview is its failing frame instead —
  // the moment that matters; the pane opens the player on it.
  const showVideo = src !== null && (open || rec.kind === 'demo-video' || failed === null);
  const lineText = rec.state === 'passed' && duration !== null && duration > 0 ? `${line.text} · ${fmtTime(Math.round(duration))}` : line.text;
  const mark = (sec: number | null): number | null => (sec === null || duration === null || duration <= 0 ? null : Math.min(100, Math.max(0, (sec / duration) * 100)));
  const failMark = failed === null ? null : mark(failed.failedAbsSec);
  const chapters = showVideo ? <ChapterMarks rec={rec} onSeek={pickChapter} /> : <ChapterMarks rec={rec} />;
  const narration = open && (rec.script !== null
    ? rec.kind === 'demo-video' && rec.scriptEditable
      ? (
        <div data-testid="demo-script-box" className="wk-walk-edit">
          <p className="wk-walk-quiet">The presenter’s script. Change it here before anything records; the recorder reads it when you approve the plan.</p>
          <textarea data-testid="demo-script" value={scriptText} onChange={(e) => setScriptDraft({ take, text: e.target.value })} rows={6} className="wk-walk-storyline" aria-label="The presenter’s script" />
          <div className="wk-prop-btns">
            <button type="button" data-testid="demo-script-save" disabled={busy || scriptText.trim() === '' || scriptText === (rec.script ?? '')} onClick={() => void saveScript()} className="wk-prop-btn wk-prop-btn--primary">Save the script</button>
          </div>
        </div>
      )
      : (
        <>
          <details data-testid="walkthrough-narration" className="wk-walk-narration"><summary>Narration</summary><pre className="wk-walk-pre">{rec.script}</pre></details>
          {rec.kind === 'demo-video' && <p data-testid="demo-script-fixed" className="wk-walk-quiet">Fixed when the demo recorded — pick a chapter and ask in the composer for another take.</p>}
        </>
      )
    : rec.chapters.some((c) => c.blurb !== '') && (
      <details data-testid="walkthrough-narration" className="wk-walk-narration" open={size === 'full'}>
        <summary>Narration</summary>
        <ol className="wk-walk-narration-list">
          {rec.chapters.map((c) => (c.blurb === '' ? null : <li key={c.key}><b>{c.title}</b> — {c.blurb}</li>))}
        </ol>
      </details>
    ));

  return (
    <div data-testid="walkthrough" data-kind={rec.kind} data-state={rec.state} data-run-id={rec.runId} data-size={size} className={`wk-walk wk-walk--${size}${open ? '' : ' wk-walk--preview'}`}>
      <div className="wk-walk-head">
        <p data-testid="walkthrough-state" data-tone={line.tone} className={`wk-walk-state wk-walk-state--${line.tone}`}><span aria-hidden className="wk-walk-mark">{line.mark}</span> {showText(lineText)}</p>
        {seats !== null && <p data-testid="walkthrough-seats" className="wk-walk-quiet">{seats}</p>}
        {open && rec.kind === 'walkthrough' && rec.video !== null && <p data-testid="walkthrough-sealed" data-sealed={rec.sealed ? 'true' : 'false'} className="wk-walk-quiet">{rec.sealed ? 'Sealed: the take matches the files on disk.' : 'Not sealed.'}</p>}
        {open && options.length > 0 && (
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
          {showVideo ? (
            <video
              key={take}
              ref={video}
              data-testid="walkthrough-video"
              data-playhead={String(startAt)}
              src={src ?? undefined}
              poster={rec.poster !== null ? fileUrl(rec, rec.poster) : undefined}
              controls
              preload="metadata"
              playsInline
              className="wk-walk-video"
              onLoadedMetadata={(e) => setDuration(Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : null)}
              onFocus={focusPlayerOnEntry}
            />
          ) : failed?.failedFrame != null ? (
            <img data-testid="walkthrough-failed-frame" src={fileUrl(rec, failed.failedFrame)} alt={`The failing frame of chapter ${failed.index}`} className={open ? 'wk-walk-video' : 'wk-walk-frame'} />
          ) : open ? (
            <p data-testid="walkthrough-no-video" className="wk-walk-quiet">No take to play yet.</p>
          ) : null}
          {/* The timeline: a mark per chapter, a red mark at the failing moment. */}
          {open && duration !== null && (
            <div data-testid="walkthrough-timeline" className="wk-walk-timeline" aria-hidden>
              {chapterMarks(rec).map((m) => { const p = mark(m.sec); return p === null ? null : <span key={m.key} className="wk-walk-tick" style={{ left: `${p}%` }} title={m.title} />; })}
              {failed !== null && failMark !== null && <span data-testid="walkthrough-fail-mark" className="wk-walk-tick wk-walk-tick--fail" style={{ left: `${failMark}%` }} title={`Failed at ${fmtTime(failed.failedAbsSec ?? 0)}`} />}
            </div>
          )}
          {open && chapters}
        </div>
        {/* Beside the take inline and at full screen, under it in the pane: what to do, then every check — above the fold. */}
        <div className="wk-walk-side">
          {!open && chapters}
          {/* Inline, the red lines say what happened underneath; open, the checks track carries them. */}
          {!open && under.length > 0 && (
            <ul data-testid="walkthrough-underneath" className="wk-walk-under">
              {under.map((u, i) => <li key={i} className="wk-walk-bad">{u}</li>)}
            </ul>
          )}
          {actions}
          {noteLine}
          {open && track.length > 0 && (
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
          {narration}
        </div>
      </div>
    </div>
  );
}

/** `play()` returns a promise in browsers (rejected when autoplay is blocked) and nothing in jsdom. */
function safePlay(el: HTMLVideoElement): void {
  const p = el.play() as unknown;
  if (p instanceof Promise) p.catch(() => undefined);
}
