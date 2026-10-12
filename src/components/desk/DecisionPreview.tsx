import { useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import type { CoreEvent, WorkUnit } from '../../api/types.js';
import { gateFrameFor, reviewedUnitFor } from '../gateVerdictModel.js';
import { unitKey } from '../NarratorFeed.js';
import { useDisplayText } from '../../hooks/useHomePath.js';

/** How many lines of the work under review the Desk shows before you answer. */
export const PREVIEW_LINES = 4;

/** The first few non-empty lines of a step's output, markdown markers dropped. */
export function previewLines(output: string, max = PREVIEW_LINES): { lines: string[]; more: boolean } {
  const all = output.split('\n').map((l) => l.replace(/^\s*(?:#{1,6}\s+|[-*+]\s+|>\s?)/, '').trim()).filter((l) => l !== '' && !/^[-=*_`]{3,}$/.test(l));
  return { lines: all.slice(0, max), more: all.length > max };
}

/**
 * What you are approving, before you approve it (DES-frontdoor §4 requirement 2): the first lines of
 * the finished step's output under the row's answers — read (`GET /runs/:id/units/:key/output`) only
 * when the row is opened. The intake gate (nothing ran yet) shows nothing; a failed read says so.
 */
export function DecisionPreview({ runId, units, gateOrd, events, openPath, onOpen }: {
  runId: string;
  units: readonly WorkUnit[];
  gateOrd: number | undefined;
  events: readonly CoreEvent[] | null;
  openPath: string;
  onOpen: (e: React.MouseEvent) => void;
}): React.ReactElement | null {
  const showText = useDisplayText();
  const reviewing = events === null ? null : gateFrameFor(events, gateOrd)?.reviewingOrd ?? null;
  const reviewed = reviewedUnitFor(units, gateOrd, reviewing);
  const key = reviewed === null ? null : unitKey(runId, reviewed.id, reviewed.ord);
  const [read, setRead] = useState<{ key: string; text: string | null; failed: boolean } | null>(null);
  useEffect(() => {
    if (key === null) return;
    let live = true;
    api.getUnitOutput(runId, key)
      .then(({ output }) => { if (live) setRead({ key, text: output, failed: false }); })
      .catch(() => { if (live) setRead({ key, text: null, failed: true }); });
    return () => { live = false; };
  }, [runId, key]);
  if (key === null) return null;
  const shown = read !== null && read.key === key ? read : null;
  const preview = shown?.text ? previewLines(shown.text) : null;
  return (
    <div data-testid="need-preview" className="wk-need-preview">
      <p className="wk-need-preview-head">What you are answering</p>
      {shown === null ? <p className="wk-need-preview-note" aria-busy="true">Reading it…</p>
        : preview !== null && preview.lines.length > 0 ? (
          <>
            <blockquote data-testid="need-preview-text" className="wk-need-preview-text">
              {preview.lines.map((l, i) => <p key={i}>{showText(l)}</p>)}
            </blockquote>
            {preview.more && <a href={openPath} onClick={onOpen} className="wk-link wk-need-preview-more">Read all of it</a>}
          </>
        ) : <p data-testid="need-preview-note" className="wk-need-preview-note">{shown.failed ? 'It could not be read here. Open it to read it.' : 'No output was kept for this step. Open it to see what it did.'}</p>}
    </div>
  );
}
