import { useCallback, useEffect, useState } from 'react';
import { getDocChecks, type ChecksRead } from '../../api/docChecks.js';
import { checkRows, checksSummary } from '../../board/checksPanel.js';

/**
 * EP-P3 — the checks panel the HOST draws under a page at pane and full size (DES-EDITOR-PLUGINS-001
 * §5.8): the four reviewers' verdicts from crew's checks read, for the version on screen. Who reviewed
 * is shown as recorded; a finding can be pointed at (the host's chip, in its own words), never applied.
 * An older daemon without the read draws no panel; a read that failed says why.
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

  useEffect(() => {
    let cancelled = false;
    void getDocChecks(projectId, docId, head).then((r) => { if (!cancelled) setRead(r); });
    return () => { cancelled = true; };
  }, [projectId, docId, head, asks]);

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
  return (
    <section data-testid="artifact-checks" data-state="ok" data-count={rows.length} className="wk-checks" aria-label="Checks">
      <p data-testid="artifact-checks-summary" className="wk-checks-head"><b>Checks</b> · {checksSummary(rows)} · {again}</p>
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
