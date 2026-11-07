import { useCallback, useEffect, useRef, useState } from 'react';
import { getDocChecks, type ChecksRead } from '../../api/docChecks.js';
import { postEvent } from '../../api/interactive.js';
import { checkRows, checksSummary, reviewLanded, reviewRequestOf } from '../../board/checksPanel.js';

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
  const [read, setRead] = useState<ChecksRead | null>(null);
  const [asks, setAsks] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [asked, setAsked] = useState<Asked | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getDocChecks(projectId, docId, head).then((r) => { if (!cancelled) setRead(r); });
    return () => { cancelled = true; };
  }, [projectId, docId, head, asks]);

  const gen = useRef(0);
  useEffect(() => { gen.current += 1; setAsked(null); }, [projectId, docId, head]);
  // While an ask runs: when a read settles, it either shows every verdict on the version (landed), or the next read
  // starts 10 s later. A late ask still lands on a later read ("Read again").
  const pending = asked !== null && (asked.state === 'asked' || asked.state === 'late');
  useEffect(() => {
    if (!pending || asked === null || read === null) return undefined;
    if (read.state === 'ok' && reviewLanded(read.checks, asked.version)) { setAsked((a) => (a?.gen === asked.gen ? { ...a, state: 'landed' } : a)); return undefined; }
    if (asked.state === 'late') return undefined;
    if (Date.now() - asked.at > REVIEW_POLL_FOR_MS) { setAsked((a) => (a?.gen === asked.gen ? { ...a, state: 'late' } : a)); return undefined; }
    const t = setTimeout(() => setAsks((n) => n + 1), REVIEW_POLL_MS);
    return () => clearTimeout(t);
  }, [pending, asked, read]);
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
  const again = <button type="button" data-testid="artifact-checks-refresh" onClick={() => setAsks((n) => n + 1)} className="wk-since-toggle">Read again</button>;
  if (read.state === 'failed') {
    return (
      <section data-testid="artifact-checks" data-state="failed" className="wk-checks" aria-label="Checks">
        <p className="wk-checks-head wk-artifact-line--bad">The reviews could not be read: {read.why} · {again}</p>
      </section>
    );
  }
  const rows = checkRows(read.checks, head);
  const mine = asked !== null && asked.version === head ? asked : null;
  return (
    <section data-testid="artifact-checks" data-state="ok" data-count={rows.length} className="wk-checks" aria-label="Checks">
      <p data-testid="artifact-checks-summary" className="wk-checks-head"><b>Checks</b> · {checksSummary(rows)} · {again}</p>
      <p className="wk-checks-head">
        <button type="button" data-testid="artifact-checks-review" disabled={mine?.state === 'sending' || mine?.state === 'asked'}
          onClick={() => void askReview()} className="wk-host-btn">Review this version</button>
        {mine !== null && (
          <span data-testid="artifact-checks-review-state" data-state={mine.state} role="status" className={mine.state === 'failed' ? 'wk-artifact-line--bad' : undefined}>
            {' '}{mine.state === 'sending' ? 'Asking…'
              : mine.state === 'asked' ? `Asked for version ${mine.version}: four reviewers read it in a review run. Their verdicts show here when it finishes.`
              : mine.state === 'landed' ? (mine.already === true ? `Version ${mine.version} already has its four reviews.` : `Version ${mine.version} is reviewed.`)
              : mine.state === 'late' ? `No verdicts on version ${mine.version} after 15 minutes. Read again to look later.`
              : `The review was not asked for: ${mine.why ?? 'no answer'}`}
          </span>
        )}
      </p>
      {note !== null && <p data-testid="artifact-checks-note" role="status" className="wk-checks-note">{note}</p>}
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
