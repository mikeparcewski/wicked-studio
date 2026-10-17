import { useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import { listDocs } from '../../api/interactive.js';
import type { SessionView } from '../../api/types.js';
import { DRAFT_WORDS, draftRunOf, draftState } from '../../board/draftStatus.js';
import { failureWhy } from '../../board/failureWhy.js';
import { sessionIdOf, sessionPath } from '../../board/sessionModel.js';
import { useDisplayText } from '../../hooks/useHomePath.js';
import { useDocsCache } from '../../store/docsCache.js';
import { TechDetails } from '../ui/TechDetails.js';

/**
 * studio#765: in place of a document that has no version yet, what its draft is doing — being written
 * (and where to watch it), stopped (why, and the run that says more), or finished (the list is read
 * again, so the page opens as soon as its first version is listed).
 */
export function DraftStatus({ projectId, docId, title, runs, runsLoaded, runChatId, navigate }: {
  projectId: string;
  docId: string;
  title: string;
  runs: readonly SessionView[];
  /** Whether the run list has been read: before it, no draft run is "missing" yet. */
  runsLoaded: boolean;
  runChatId: boolean;
  navigate: (path: string) => void;
}): React.ReactElement | null {
  const showText = useDisplayText();
  const run = draftRunOf(runs, projectId, docId);
  // Before the run list is read, a draft run cannot be missing yet: the page reads as being written.
  const state = run === null && !runsLoaded ? 'writing' : draftState(run);
  const runId = run?.session.id ?? null;
  const status = run?.session.status ?? null;
  const [frames, setFrames] = useState<{ id: string; list: readonly Record<string, unknown>[] } | null>(null);
  useEffect(() => {
    if (state !== 'stopped' || runId === null) return;
    let live = true;
    api.getRunEvents(runId, ['stepFailed', 'error'])
      .then(({ events }) => { if (live) setFrames({ id: runId, list: events as unknown as Record<string, unknown>[] }); })
      .catch(() => { if (live) setFrames({ id: runId, list: [] }); });
    return () => { live = false; };
  }, [state, runId]);
  // The draft ended with a version the list has not read yet: read this project's documents again.
  useEffect(() => {
    if (state !== 'landing') return;
    void listDocs(projectId).then((docs) => useDocsCache.getState().deposit(projectId, docs)).catch(() => undefined);
  }, [state, projectId, status]);
  const href = run === null ? null : sessionPath(sessionIdOf(run, runChatId));
  const why = state === 'stopped' && run !== null && frames !== null && frames.id === runId ? failureWhy(run, frames.list) : null;
  return (
    <div data-testid="made-draft-status" data-state={state} role={state === 'stopped' ? 'alert' : 'status'} className={`wk-made-draft${state === 'stopped' ? ' wk-made-draft--bad' : ''}`}>
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
      {why !== null && why.detail.length > 0 && <TechDetails data-testid="made-draft-detail" text={why.detail.map(showText)} />}
    </div>
  );
}
