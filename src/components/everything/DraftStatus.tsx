import { useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import { listDocs } from '../../api/interactive.js';
import type { SessionView } from '../../api/types.js';
import { DRAFT_WORDS, type DraftState } from '../../board/draftStatus.js';
import { failureWhy } from '../../board/failureWhy.js';
import { sessionIdOf, sessionPath } from '../../board/sessionModel.js';
import { useDisplayText } from '../../hooks/useHomePath.js';
import { useDocsCache } from '../../store/docsCache.js';
import { TechDetails } from '../ui/TechDetails.js';

/**
 * studio#765: in place of a document that has no version yet, what its draft is doing — being written
 * (and where to watch it), stopped (why, and the run that says more), or finished (the list is read
 * again, a bounded few times, so the page opens as soon as its first version is listed).
 */
/** codex r1: how often, and how many times, a finished draft's list is read again before the editor opens anyway. */
export const LANDING_RETRY_MS = 3000;
export const LANDING_TRIES = 5;

export function DraftStatus({ projectId, docId, title, state, run, runChatId, navigate, onOpenAnyway }: {
  projectId: string;
  docId: string;
  title: string;
  /** What the draft is doing (`draftCard`). */
  state: DraftState;
  run: SessionView | null;
  runChatId: boolean;
  navigate: (path: string) => void;
  /** Open the editor on what the page holds now (a finished draft whose version the list never shows). */
  onOpenAnyway: () => void;
}): React.ReactElement {
  const showText = useDisplayText();
  const runId = run?.session.id ?? null;
  const [frames, setFrames] = useState<{ id: string; list: readonly Record<string, unknown>[] } | null>(null);
  useEffect(() => {
    if (state !== 'stopped' || runId === null) return;
    let live = true;
    api.getRunEvents(runId, ['stepFailed', 'error'])
      .then(({ events }) => { if (live) setFrames({ id: runId, list: events as unknown as Record<string, unknown>[] }); })
      .catch(() => { if (live) setFrames({ id: runId, list: [] }); });
    return () => { live = false; };
  }, [state, runId]);
  // The draft finished: read this project's documents again until its first version is listed — a
  // bounded few times (a read can land before the version does, or fail) — then open the editor anyway.
  useEffect(() => {
    if (state !== 'landing') return;
    let tries = 0;
    let live = true;
    const read = (): void => {
      tries += 1;
      void listDocs(projectId).then((docs) => { if (live) useDocsCache.getState().deposit(projectId, docs); }).catch(() => undefined);
    };
    read();
    const t = setInterval(() => {
      if (tries >= LANDING_TRIES) { clearInterval(t); if (live) onOpenAnyway(); return; }
      read();
    }, LANDING_RETRY_MS);
    return () => { live = false; clearInterval(t); };
  }, [state, projectId, onOpenAnyway]);
  const href = run === null ? null : sessionPath(sessionIdOf(run, runChatId));
  const why = state === 'stopped' && run !== null && frames !== null && frames.id === runId ? failureWhy(run, frames.list) : null;
  return (
    <div data-testid="made-draft-status" data-state={state} data-doc={docId} role={state === 'stopped' ? 'alert' : 'status'} className={`wk-made-draft${state === 'stopped' ? ' wk-made-draft--bad' : ''}`}>
      <p className="wk-made-draft-title">{title}</p>
      <p data-testid="made-draft-line" className="wk-made-draft-line">
        {DRAFT_WORDS[state]}
        {why !== null && <> {why.plain}</>}
      </p>
      {href !== null && (
        <a href={href} data-testid="made-draft-run" className="wk-link" onClick={(e) => { e.preventDefault(); navigate(href); }}>
          {state === 'writing' ? 'Watch it being written' : 'Open the run'}
        </a>
      )}
      {state === 'landing' && (
        <button type="button" data-testid="made-draft-open" className="wk-btn wk-btn--quiet wk-btn--sm" onClick={onOpenAnyway}>Open it anyway</button>
      )}
      {why !== null && why.detail.length > 0 && <TechDetails data-testid="made-draft-detail" text={why.detail.map(showText)} />}
    </div>
  );
}
