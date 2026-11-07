import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { getDocChecks, type ChecksRead } from '../../api/docChecks.js';
import { postEvent } from '../../api/interactive.js';
import { checkRows, checksSummary, floorRow, notesView, reviewLanded, reviewRequestOf } from '../../board/checksPanel.js';

/** While a review asked for here runs: how often the panel re-reads, and for how long at most. */
export const REVIEW_POLL_MS = 10_000;
export const REVIEW_POLL_FOR_MS = 15 * 60_000;

/** One ask, by generation: an answer for an older ask (another version, another press) never changes a newer one. */
type Asked = { gen: number; version: number; state: 'sending' | 'asked' | 'landed' | 'late' | 'failed'; already?: boolean; why?: string; at: number };

/**
 * EP-P3 — the checks panel the HOST draws under a page at pane and full size (DES-EDITOR-PLUGINS-001
 * §5.8): the four reviewers' verdicts from crew's checks read, for the version on screen. Who reviewed
 * is shown as recorded; a finding can be pointed at (the host's chip, in its own words), never applied.
 * An older daemon without the read draws no panel; a read that failed says why.
 *
 * "Review this version" (plugins-complete G21) asks for the four reviews again after a hand edit: it posts
 * `wicked.interactive.review.requested` for the version on screen, then re-reads (one read at a time, the next 10 s
 * after the last settled) until every reviewer has a verdict on that version, or 15 minutes pass. Another document or
 * version on screen drops the ask, and any answer still coming for it.
 */
export function ChecksPanel({ projectId, docId, head, pointAt }: {
  projectId: string;
  docId: string;
  head: number;
  /** The host's "point at it": a chip on the composer, or false when the element is not on this page. */
  pointAt: (wid: string) => Promise<boolean>;
}): React.ReactElement | null {
  // A read is kept with what it was read for: one for another document or version is never this one's.
  const [held, setRead] = useState<{ of: string; r: ChecksRead } | null>(null);
  const of = `${projectId}/${docId}@${head}`;
  const read = held !== null && held.of === of ? held.r : null;
  /** A read is in flight: the next poll waits for it, and "Read again" does not start a second one. */
  const [reading, setReading] = useState(false);
  const [asks, setAsks] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [asked, setAsked] = useState<Asked | null>(null);

  useEffect(() => {
    let cancelled = false;
    const readFor = `${projectId}/${docId}@${head}`;
    setReading(true);
    void getDocChecks(projectId, docId, head).then((r) => { if (!cancelled) { setRead({ of: readFor, r }); setReading(false); } });
    return () => { cancelled = true; };
  }, [projectId, docId, head, asks]);

  const gen = useRef(0);
  useEffect(() => { gen.current += 1; setAsked(null); }, [projectId, docId, head]);
  // While an ask runs: when a read settles, it either shows every verdict on the version (landed), or the next read
  // starts 10 s later. A late ask still lands on a later read ("Read again").
  const pending = asked !== null && (asked.state === 'asked' || asked.state === 'late');
  useEffect(() => {
    if (!pending || asked === null || read === null || reading) return undefined;
    if (read.state === 'ok' && reviewLanded(read.checks, asked.version)) { setAsked((a) => (a?.gen === asked.gen ? { ...a, state: 'landed' } : a)); return undefined; }
    if (asked.state === 'late') return undefined;
    const t = setTimeout(() => setAsks((n) => n + 1), REVIEW_POLL_MS);
    return () => clearTimeout(t);
  }, [pending, asked, read, reading]);
  // The 15-minute bound is its own timer: a read that never answers cannot hold the ask open.
  const askedGen = asked?.state === 'asked' ? asked.gen : null;
  const askedAt = asked?.state === 'asked' ? asked.at : 0;
  useEffect(() => {
    if (askedGen === null) return undefined;
    const t = setTimeout(() => setAsked((a) => (a?.gen === askedGen && a.state === 'asked' ? { ...a, state: 'late' } : a)), Math.max(0, askedAt + REVIEW_POLL_FOR_MS - Date.now()));
    return () => clearTimeout(t);
  }, [askedGen, askedAt]);
  const askReview = useCallback(async () => {
    const my = ++gen.current;
    const version = head;
    // Every reviewer already has a verdict on this version: crew answers a repeat ask from that record.
    const already = read?.state === 'ok' && reviewLanded(read.checks, version);
    setAsked({ gen: my, version, state: 'sending', at: Date.now() });
    try {
      await postEvent(projectId, reviewRequestOf(docId, version));
      if (gen.current === my) setAsked({ gen: my, version, state: already ? 'landed' : 'asked', already, at: Date.now() });
    } catch (e) {
      if (gen.current === my) setAsked({ gen: my, version, state: 'failed', why: e instanceof Error ? e.message : String(e), at: Date.now() });
    }
  }, [projectId, docId, head, read]);

  const point = useCallback(async (wid: string, where: string) => {
    const ok = await pointAt(wid);
    setNote(ok ? null : `${where.charAt(0).toUpperCase()}${where.slice(1)} is not on this version of the page.`);
  }, [pointAt]);

  if (read === null || read.state === 'absent') return null;
  const again = <button type="button" data-testid="artifact-checks-refresh" disabled={reading} onClick={() => setAsks((n) => n + 1)} className="wk-since-toggle">Read again</button>;
  if (read.state === 'failed') {
    return (
      <section data-testid="artifact-checks" data-state="failed" className="wk-checks" aria-label="Checks">
        <p className="wk-checks-head wk-artifact-line--bad">The reviews could not be read: {read.why} · {again}</p>
      </section>
    );
  }
  const rows = checkRows(read.checks, head);
  const mine = asked !== null && asked.version === head ? asked : null;
  // PLAN G12 / A6: what crew measured on this version before it landed, and the writer's notes beside it.
  const floor = floorRow(read.floor);
  const notes = notesView(read.notes, head);
  return (
    <section data-testid="artifact-checks" data-state="ok" data-count={rows.length} className="wk-checks" aria-label="Checks">
      <p data-testid="artifact-checks-summary" className="wk-checks-head"><b>Checks</b> · {checksSummary(rows)} · {again}</p>
      <p className="wk-checks-review">
        <button type="button" data-testid="artifact-checks-review" disabled={mine?.state === 'sending' || mine?.state === 'asked'}
          onClick={() => void askReview()} className="wk-host-btn">Review this version</button>
        {mine !== null && (
          <span data-testid="artifact-checks-review-state" data-state={mine.state} role="status" className={mine.state === 'failed' ? 'wk-artifact-line--bad' : undefined}>
            {mine.state === 'sending' ? 'Asking…'
              : mine.state === 'asked' ? `Asked for version ${mine.version}: four reviewers read it in a review run. Their verdicts show here when it finishes.`
              : mine.state === 'landed' ? (mine.already === true ? `Version ${mine.version} already has its four reviews.` : `Version ${mine.version} is reviewed.`)
              : mine.state === 'late' ? `Not every reviewer has a verdict on version ${mine.version} after 15 minutes. Read again to look later.`
              : `The review was not asked for: ${mine.why ?? 'no answer'}`}
          </span>
        )}
      </p>
      {note !== null && <p data-testid="artifact-checks-note" role="status" className="wk-checks-note">{note}</p>}
      {floor !== null && (
        <div data-testid="artifact-checks-floor" data-state={floor.state} className={`wk-check wk-check--floor wk-check--floor-${floor.state}`}>
          <p className="wk-check-top"><b>Floor</b> · <span data-testid="artifact-checks-floor-state">{floor.stateWord}</span> <span className="wk-check-dim">· {floor.attribution}</span></p>
          {floor.pages !== null && <p data-testid="artifact-checks-floor-pages" className="wk-check-sentence">{floor.pages}</p>}
          {floor.sentence !== '' && <p className="wk-check-dim">{floor.sentence}</p>}
        </div>
      )}
      {notes !== null && <NotesFold notes={notes} />}
      {rows.length > 0 && (
        <ul className="wk-checks-list">
          {rows.map((r) => (
            <li key={r.id} data-testid="artifact-check" data-reviewer={r.reviewer} data-state={r.state} className={`wk-check wk-check--${r.state}`}>
              <p className="wk-check-top">
                <b>{r.name}</b> · <span data-testid="artifact-check-state">{r.stateWord}</span>
                {r.onVersion !== null && <span data-testid="artifact-check-older" className="wk-check-dim"> · {r.onVersion}</span>}
              </p>
              {r.sentence !== '' && <p className="wk-check-sentence">{r.sentence}</p>}
              <p data-testid="artifact-check-by" data-independent={r.independent ? 'true' : 'false'} className="wk-check-dim">{r.by}</p>
              {r.findings.length > 0 && (
                <ul className="wk-check-findings">
                  {r.findings.map((f, i) => (
                    <li key={i} data-testid="artifact-check-finding" data-wid={f.wid ?? ''} data-severity={f.severity}>
                      <span className="wk-check-where">{f.where}:</span> {f.sentence}
                      {f.wid !== null && (
                        <> <button type="button" data-testid="artifact-check-point" onClick={() => void point(f.wid!, f.where)} className="wk-since-toggle">Point at it</button></>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The writer's notes, beside the page and never in it (DES-CHAT-ARTIFACTS-001 §11.2): folded; "from version N" when
 *  they belong to an earlier version than the one on screen; an empty list is said as such, never as a clean one. */
function NotesFold({ notes }: { notes: import('../../board/checksPanel.js').NotesView }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const has = notes.leftOut.length + notes.assumptions.length + notes.struck.length + notes.used.length + notes.unused.length > 0;
  return (
    <div data-testid="artifact-checks-notes" className="wk-checks-notes">
      <p className="wk-check-top">
        {has ? (
          <button type="button" data-testid="artifact-checks-notes-toggle" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen((o) => !o)} className="wk-since-toggle"
            aria-label={`The writer’s notes: ${notes.head}${notes.from !== null ? `, ${notes.from}` : ''}`}>
            <span aria-hidden="true">{open ? '▾' : '▸'}</span> {notes.head}
          </button>
        ) : <span data-testid="artifact-checks-notes-head">{notes.head}</span>}
        {notes.from !== null && <span data-testid="artifact-checks-notes-from" className="wk-check-dim"> · {notes.from}</span>}
      </p>
      {has && open && (
        <div id={bodyId} data-testid="artifact-checks-notes-body" className="wk-checks-notes-body">
          {notes.leftOut.length > 0 && (
            <ul className="wk-check-findings">
              {notes.leftOut.map((x, i) => <li key={i} data-testid="artifact-checks-notes-left-out"><b>{x.claim}</b> — {x.why}</li>)}
            </ul>
          )}
          {notes.assumptions.length > 0 && <p className="wk-check-dim">Assumed: {notes.assumptions.join(' · ')}</p>}
          {notes.used.length > 0 && <p className="wk-check-dim">Used: {notes.used.join(', ')}</p>}
          {notes.unused.length > 0 && <p className="wk-check-dim">Given but not used: {notes.unused.join(', ')}</p>}
          {notes.struck.length > 0 && <p className="wk-check-dim">Left out by crew before the run: {notes.struck.map((x) => `${x.token} (${x.reason})`).join('; ')}</p>}
        </div>
      )}
    </div>
  );
}
