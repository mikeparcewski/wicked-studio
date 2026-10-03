import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { getVersions, HeadMovedError, interactiveDocUrl, postEvent, postFork } from '../../api/interactive.js';
import {
  anchorWords, editedLine, elementChip, notUndoneLine, undoneLine, type ArtifactSize, type EditorKind,
} from '../../board/artifactMorph.js';
import { overlayBox, type OverlayBox, type ScrollState } from '../../interactive/anchoring.js';
import { FEEDBACK_EVENT, toWireItem } from '../../interactive/feedbackBatch.js';
import { hasInstrumentBridge, instrumentDocHtml } from '../../interactive/instrumented.js';
import {
  REQUEST_INVENTORY, makeScrollToWid, parseInbound, type WidBlock, type WidRect,
} from '../../interactive/instrument-protocol.js';
import { addAboutChip } from '../../store/composerChips.js';

/**
 * S8 — the built-in page element editor (DES-STUDIO-REBUILD-001 §11 S8; DESIGN-interaction rules
 * 2 and 3). The rendered page in a sandboxed frame (`allow-scripts` only — the same posture as the
 * Document canvas, §5.5), instrumented with the `data-wid` bridge, so:
 *
 *   · pointing at an element highlights it; a click picks it and makes it the subject of the next
 *     message — an "about: “…”" chip on the session composer (never a button row);
 *   · typing on the picked element edits it in place: the text lands as ONE deterministic
 *     `content-edit` (`feedback.submitted`, the ADR-0002 item with `before` as the staleness
 *     guard) → one `version.created`, and a line under the page says so with Undo;
 *   · Undo forks the page before the change as the new head with `expect_head` (C5): when a
 *     helper's version landed in between the bridge refuses (`409 head_moved`) and the line says
 *     "Not undone" — the helper's work is never buried;
 *   · what you type is text: `<b>x</b>` lands as those characters (interactive #247), never markup.
 *
 * Versions are read from `GET /api/versions` (polled after a write until the head moves — the
 * bridge's `version.created` frame is the thread's, not this editor's). EP-P2 re-hosts this as the
 * `wicked-page` plugin behind the same slot (`ArtifactMorph`'s kind slot accepts a PluginHost).
 *
 * S9: the document and slide editors are this editor with another `kind` — the same frame, the
 * same touch edit, the same Undo — plus what stands beside the frame (`side`: a deck's slide strip,
 * a document's requirement coverage). The element is named in plain words (`anchorWords`: "slide
 * 2’s title", "paragraph 3"), never by its raw anchor id. The field opens only over text that is
 * the element's own and whole: a container of other parts, or a text the bridge had to cut, cannot
 * be replaced by typing (the engine would refuse the first and call the second stale).
 */

/** What stands beside the frame reads the frame through this — the measured inventory and two
 *  moves. `null` until the frame has answered. */
export interface FrameParts {
  blocks: Readonly<Record<string, WidBlock>>;
  /** Each anchor's top edge in the document (not the viewport). */
  tops: Readonly<Record<string, number>>;
  scrollY: number;
  frameHeight: number;
  /** How many `scrollTo` jumps the frame has confirmed it performed (its `scroll-ack`s). */
  jumps: number;
  selected: string | null;
  /** Bring an anchor into view. */
  scrollTo: (wid: string) => void;
  /** Bring an anchor into view and pick it, as a click on it does. */
  pick: (wid: string) => void;
}

const HINT: Readonly<Record<EditorKind, string>> = {
  page: 'Click an element to make it the subject · type on it to change it',
  document: 'Click a paragraph to make it the subject · type on it to change it · Enter keeps it',
  deck: 'Click a slide’s words to make them the subject · type on them to change them',
};

/** The bridge script runs on the frame's load; ask a few times before giving up. */
const ASK_AT_MS = [0, 250, 750, 1500];
/** After a write: how often, and how long, the manifest is re-read for the edit's own version. */
const POLL_MS = 400;
const POLL_FOR_MS = 20_000;
/** Idle: how often the head is re-read, so a version the run lands shows up in the preview. */
const IDLE_MS = 5_000;

type Line =
  | { kind: 'edited'; version: number; parent: number; wid: string }
  | { kind: 'undone'; version: number }
  | { kind: 'not-undone'; head: number }
  | { kind: 'working'; text: string }
  | { kind: 'failed'; text: string };

interface Inventory {
  widMap: Record<string, WidRect>;
  blocks: Record<string, WidBlock>;
  measured: ScrollState;
}

export function PageEditor({ projectId, docId, composerKey, size, kind = 'page', side, onHead }: {
  projectId: string;
  docId: string;
  /** The composer the picked element's chip goes to (the session id). */
  composerKey: string;
  size: ArtifactSize;
  /** Which editor this is — a page, a written document, or a deck (S9). */
  kind?: EditorKind;
  /** What stands beside the frame at this size, if anything (the slide strip, the coverage). */
  side?: (parts: FrameParts | null) => React.ReactNode;
  /** The head version, whenever it is (re)read — the morph's header shows it. */
  onHead?: (head: number) => void;
}): React.ReactElement {
  const [head, setHead] = useState<number | null>(null);
  const [srcDoc, setSrcDoc] = useState<string | null>(null);
  const [frameSrc, setFrameSrc] = useState<string | null>(null);
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const inventoryRef = useRef<Inventory | null>(null);
  useEffect(() => { inventoryRef.current = inventory; }, [inventory]);
  const [current, setCurrent] = useState<ScrollState>({ scrollX: 0, scrollY: 0 });
  const [hover, setHover] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ wid: string; value: string; before: string } | null>(null);
  const [line, setLine] = useState<Line | null>(null);
  const [busy, setBusy] = useState(false);
  const frame = useRef<HTMLIFrameElement | null>(null);
  const handle = useRef<HTMLDivElement | null>(null);
  const input = useRef<HTMLTextAreaElement | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  // The frame's document generation: bumped for every new head, marked ready on that frame's load.
  // A message from the previous document (the WindowProxy survives a navigation) is ignored.
  const gen = useRef(0);
  const readyGen = useRef(-1);
  // The element the operator's last write touched. The frame for the new head opens scrolled to
  // it (`armed`, set when that head's frame is requested), so an edit far down a document or on a
  // late slide does not throw the reader back to the top.
  const returnTo = useRef<string | null>(null);
  const armed = useRef<string | null>(null);
  const [jumps, setJumps] = useState(0);
  // The frame's own height, measured — what stands beside the frame asks "which slide is in view".
  const [frameHeight, setFrameHeight] = useState(0);
  useEffect(() => {
    const el = frame.current;
    if (el === null) return undefined;
    setFrameHeight(el.clientHeight);
    if (typeof ResizeObserver !== 'function') return undefined;
    const seen = new ResizeObserver(() => setFrameHeight(el.clientHeight));
    seen.observe(el);
    return () => seen.disconnect();
  }, []);
  // Whether this editor is still mounted — a poll or an Undo that outlives it writes nothing.
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);

  // ── the head ───────────────────────────────────────────────────────────────────────
  const readHead = useCallback(async (): Promise<number | null> => {
    try {
      const m = await getVersions(projectId, docId);
      return m.head;
    } catch {
      return null;
    }
  }, [projectId, docId]);

  useEffect(() => {
    let cancelled = false;
    void readHead().then((h) => { if (!cancelled && h !== null) setHead(h); });
    return () => { cancelled = true; };
  }, [readHead]);

  useEffect(() => { if (head !== null) onHead?.(head); }, [head, onHead]);

  // A live preview: while nothing of the operator's is in flight, a version the run lands moves the
  // head (and reloads the frame). Not while an edit field is open — the frame under it would go.
  const idleRef = useRef({ editing: false, busy: false });
  useEffect(() => { idleRef.current = { editing: editing !== null, busy }; }, [editing, busy]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (idleRef.current.editing || idleRef.current.busy) return;
      void readHead().then((h) => {
        if (h === null || !live.current || idleRef.current.editing || idleRef.current.busy) return;
        setHead((was) => (was === null || h > was ? h : was));
      });
    }, IDLE_MS);
    return () => clearInterval(timer);
  }, [readHead]);

  // ── the frame: the head's HTML, instrumented, in a sandboxed frame ────────────────
  useEffect(() => {
    if (head === null) return undefined;
    let cancelled = false;
    // A new head is a new frame: what was pointed at belongs to the old one.
    gen.current += 1;
    armed.current = returnTo.current;
    returnTo.current = null;
    setInventory(null);
    setHover(null);
    setSelected(null);
    setEditing(null);
    const url = interactiveDocUrl(projectId, docId, head);
    fetch(url)
      .then((res) => (res.ok ? res.text() : Promise.reject(new Error(String(res.status)))))
      .then((html) => {
        if (cancelled) return;
        if (hasInstrumentBridge(html)) { setSrcDoc(null); setFrameSrc(url); }
        else { setFrameSrc(null); setSrcDoc(instrumentDocHtml(html, new URL(url, window.location.href).href)); }
      })
      .catch(() => { if (!cancelled) { setSrcDoc(null); setFrameSrc(url); } });
    return () => { cancelled = true; };
  }, [projectId, docId, head]);

  const post = useCallback((msg: unknown): void => {
    frame.current?.contentWindow?.postMessage(msg, '*');
  }, []);

  const askInventory = useCallback((): void => {
    readyGen.current = gen.current;
    for (const t of timers.current) clearTimeout(t);
    timers.current = ASK_AT_MS.map((ms) => setTimeout(() => post(REQUEST_INVENTORY), ms));
  }, [post]);

  useEffect(() => () => { for (const t of timers.current) clearTimeout(t); }, []);

  /** An element becomes the subject: picked, a chip on the composer, and typing reaches studio. */
  const select = useCallback((wid: string): void => {
    setSelected(wid);
    setEditing(null);
    addAboutChip(composerKey, elementChip(wid, inventoryRef.current?.blocks[wid]?.text ?? '', docId));
    // Typing must reach THIS document, not the frame the click focused.
    handle.current?.focus();
  }, [composerKey, docId]);

  const scrollTo = useCallback((wid: string): void => post(makeScrollToWid(wid)), [post]);
  const pick = useCallback((wid: string): void => { scrollTo(wid); select(wid); }, [scrollTo, select]);

  // ── bridge → editor ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const onMessage = (e: MessageEvent): void => {
      const f = frame.current;
      if (f === null || e.source !== f.contentWindow || readyGen.current !== gen.current) return;
      const msg = parseInbound(e.data);
      if (msg === null) return;
      if (msg.type === 'wid-inventory') {
        for (const t of timers.current) clearTimeout(t);
        setInventory({ widMap: msg.widMap, blocks: msg.blocks ?? {}, measured: { scrollX: msg.scrollX, scrollY: msg.scrollY } });
        setCurrent({ scrollX: msg.scrollX, scrollY: msg.scrollY });
        const back = armed.current;
        armed.current = null;
        if (back !== null && msg.widMap[back] !== undefined) post(makeScrollToWid(back));
      } else if (msg.type === 'scroll-state') {
        setCurrent({ scrollX: msg.scrollX, scrollY: msg.scrollY });
      } else if (msg.type === 'scroll-ack') {
        setJumps((n) => n + 1);
      } else if (msg.type === 'wid-hover') {
        setHover(msg.wid);
      } else if (msg.type === 'wid-click') {
        if (size === 'inline') return; // the preview is one control: it opens, it does not pick
        select(msg.wid);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [size, select, post]);

  // ── edit by touching ───────────────────────────────────────────────────────────────
  /** Whether typing can replace this element's text — and when not, why: the frame has not
   *  measured it, it holds other parts (the engine refuses to flatten them), or its text was cut
   *  (not the whole `before` the engine checks). */
  const typingOn = (wid: string): 'yes' | 'unmeasured' | 'container' | 'cut' => {
    const block = inventory?.blocks[wid];
    if (inventory === null || inventory.widMap[wid] === undefined || block === undefined) return 'unmeasured';
    if (block.composite) return 'container';
    return block.cut === true ? 'cut' : 'yes';
  };

  const beginEdit = (wid: string, typed: string | null): void => {
    if (inventory === null || typingOn(wid) !== 'yes') return;
    const before = inventory.blocks[wid]?.text ?? '';
    // The field exists and holds the focus before this key event returns: the characters typed
    // right behind it land in the field. Waiting for an animation frame left them on the handle,
    // where each one restarted the edit and the text was lost.
    flushSync(() => setEditing({ wid, value: typed ?? before, before }));
    const field = input.current;
    if (field === null) return;
    field.focus();
    if (typed === null) field.select();
    else field.setSelectionRange(field.value.length, field.value.length);
  };

  const onHandleKey = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (selected === null || busy) return;
    if (e.key === 'Escape') { setSelected(null); e.stopPropagation(); return; }
    if (e.key === 'Enter') { e.preventDefault(); beginEdit(selected, null); return; }
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); beginEdit(selected, e.key); }
  };

  /** The version THIS edit made: a deterministic (feedback-file) version branched off `base` —
   *  the lowest such one. A helper's generated version is not mistaken for it: `{other: head}` when
   *  the head moved without one, `null` when nothing landed in the window. Known limit: the bridge
   *  carries no correlation id on the manifest, so two deterministic edits off the same base inside
   *  the window cannot be told apart here — the Undo stays safe either way (`expect_head`). */
  const waitForLanded = useCallback(async (base: number): Promise<{ version: number } | { other: number } | null> => {
    const until = Date.now() + POLL_FOR_MS;
    let moved: number | null = null;
    while (Date.now() < until && live.current) {
      try {
        const m = await getVersions(projectId, docId);
        const mine = m.versions
          .filter((v) => v.version > base && v.parent === base && v.feedback_file !== null)
          .map((v) => v.version)
          .sort((a, b) => a - b)[0];
        if (mine !== undefined) return { version: mine };
        if (m.head > base) moved = m.head;
      } catch { /* re-read on the next tick */ }
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
    return moved === null ? null : { other: moved };
  }, [projectId, docId]);

  const commit = async (): Promise<void> => {
    if (editing === null || head === null) return;
    const { wid, before } = editing;
    // One line of text: a pasted line break is a space, as the page would render it.
    const value = editing.value.replace(/\s*\n\s*/g, ' ');
    const what = anchorWords(wid, kind);
    setEditing(null);
    if (value === before) return;
    setBusy(true);
    setLine({ kind: 'working', text: `Changing ${what}…` });
    try {
      // The base is the head NOW, not the one read at mount: a helper may have landed since.
      const base = (await readHead()) ?? head;
      if (!live.current) return;
      await postEvent(projectId, {
        event_type: FEEDBACK_EVENT,
        payload: {
          document_id: docId,
          version: base,
          author: 'studio',
          items: [toWireItem({ wid, text: value, mode: 'change-text', before })],
        },
      });
      const landed = await waitForLanded(base);
      if (!live.current) return;
      if (landed === null) setLine({ kind: 'failed', text: `The change was sent, but no new version appeared for ${what}.` });
      else if ('other' in landed) { setLine({ kind: 'failed', text: `The page changed (version ${landed.other}), but not by your edit to ${what} — it may have been stale.` }); returnTo.current = wid; setHead(landed.other); }
      else { setLine({ kind: 'edited', version: landed.version, parent: base, wid }); returnTo.current = wid; setHead(landed.version); }
    } catch (e: unknown) {
      if (live.current) setLine({ kind: 'failed', text: `Could not change ${what}: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      if (live.current) setBusy(false);
    }
  };

  const undo = async (): Promise<void> => {
    if (line === null || line.kind !== 'edited') return;
    setBusy(true);
    const { parent, version, wid } = line;
    setLine({ kind: 'working', text: 'Undoing…' });
    try {
      const r = await postFork(projectId, docId, parent, undefined, version);
      if (!live.current) return;
      setLine({ kind: 'undone', version: r.version });
      returnTo.current = wid;
      setHead(r.version);
    } catch (e: unknown) {
      if (!live.current) return;
      if (e instanceof HeadMovedError) { setLine({ kind: 'not-undone', head: e.head }); returnTo.current = wid; setHead(e.head); }
      else setLine({ kind: 'failed', text: `Could not undo: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      if (live.current) setBusy(false);
    }
  };

  const box = (wid: string | null): OverlayBox | null => {
    if (wid === null || inventory === null) return null;
    const rect = inventory.widMap[wid];
    return rect === undefined ? null : overlayBox(rect, inventory.measured, current);
  };
  const selBox = box(selected);
  const hoverBox = hover !== selected ? box(hover) : null;
  const editBox = editing === null ? null : box(editing.wid);
  const pickable = size !== 'inline' && inventory !== null;
  const selectedWords = selected === null ? '' : anchorWords(selected, kind);
  const SelectedWords = `${selectedWords.charAt(0).toUpperCase()}${selectedWords.slice(1)}`;
  const typing = selected === null ? 'unmeasured' : typingOn(selected);

  const scrollY = current.scrollY;
  const parts = useMemo<FrameParts | null>(() => (inventory === null ? null : {
    blocks: inventory.blocks,
    tops: Object.fromEntries(Object.entries(inventory.widMap).map(([wid, r]) => [wid, r.top + inventory.measured.scrollY])),
    scrollY,
    frameHeight,
    jumps,
    selected,
    scrollTo,
    pick,
  }), [inventory, scrollY, frameHeight, jumps, selected, scrollTo, pick]);

  return (
    <>
      <div className="wk-artifact-row">
      {side?.(parts)}
      <div className="wk-artifact-body" data-testid="page-editor" data-kind={kind} data-doc={docId} data-head={head ?? ''} data-pickable={pickable} data-selected={selected ?? ''}>
        <iframe
          ref={frame}
          title={`${docId} version ${head ?? ''}`}
          data-testid="page-frame"
          className="wk-artifact-frame"
          sandbox="allow-scripts"
          onLoad={askInventory}
          {...(srcDoc !== null ? { srcDoc } : frameSrc !== null ? { src: frameSrc } : {})}
        />
        {hoverBox !== null && editing === null && <div data-testid="page-hover-box" className="wk-artifact-box wk-artifact-box--hover" style={hoverBox} />}
        {selBox !== null && editing === null && <div data-testid="page-selected-box" data-wid={selected ?? ''} className="wk-artifact-box" style={selBox} />}
        {editing !== null && editBox !== null && (
          <textarea
            ref={input}
            data-testid="page-edit-input"
            data-wid={editing.wid}
            aria-label={`New text for ${anchorWords(editing.wid, kind)}`}
            className="wk-artifact-input"
            rows={1}
            style={{ left: editBox.left, top: editBox.top, width: Math.max(editBox.width, 160), height: Math.max(editBox.height, 30) }}
            value={editing.value}
            onChange={(e) => setEditing({ ...editing, value: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); void commit(); }
              else if (e.key === 'Escape') { e.stopPropagation(); setEditing(null); handle.current?.focus(); }
            }}
            onBlur={() => setEditing(null)}
          />
        )}
        {/* Where typing lands after a pick: focus moves here from the frame (the frame keeps the click). */}
        <div ref={handle} tabIndex={-1} data-testid="page-handle" className="wk-artifact-handle" onKeyDown={onHandleKey} />
        {pickable && selected === null && editing === null && (
          <p className="wk-artifact-hint" data-testid="page-hint">{HINT[kind]}</p>
        )}
        {pickable && selected !== null && editing === null && (
          <p className="wk-artifact-hint" data-testid="page-hint" data-editable={typing === 'yes'}>
            {typing === 'yes' && `Type to change ${selectedWords} · Enter to edit its text · Esc to let go`}
            {typing === 'container' && `${SelectedWords} holds other parts — click a line of text inside it to change the words · Esc to let go`}
            {typing === 'cut' && `${SelectedWords} is too long to change by typing — say what to change in the message box · Esc to let go`}
            {typing === 'unmeasured' && `${SelectedWords} can’t be changed by typing — say what to change in the message box · Esc to let go`}
          </p>
        )}
      </div>
      </div>
      {line !== null && (
        <p data-testid="page-line" data-kind={line.kind} className={`wk-artifact-line${line.kind === 'not-undone' || line.kind === 'failed' ? ' wk-artifact-line--bad' : ''}`}>
          {line.kind === 'edited' && (
            <>
              {editedLine(line.version, anchorWords(line.wid, kind))}{' '}
              <button type="button" data-testid="page-undo" disabled={busy} onClick={() => void undo()} className="wk-since-toggle">Undo</button>
            </>
          )}
          {line.kind === 'undone' && undoneLine(line.version)}
          {line.kind === 'not-undone' && notUndoneLine(line.head)}
          {(line.kind === 'working' || line.kind === 'failed') && line.text}
        </p>
      )}
    </>
  );
}
