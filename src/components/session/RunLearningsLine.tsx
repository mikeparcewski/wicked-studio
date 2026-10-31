import { useEffect, useState } from 'react';
import { getRunLearnings, runLearningsPath, runLearningsWords, type RunLearnings } from '../../api/runLearnings.js';
import type { Navigate } from '../../hooks/useRoute.js';

/** While the distil seat works, the line is read again this often. */
export const RUN_LEARNINGS_POLL_MS = 15_000;

/**
 * A finished run's end card line: what it proposed to the approve queue ("3 learnings proposed · 2 waiting for you ·
 * Review"), linking to the Memory page's queue narrowed to this run. Nothing renders on an older crew (no route), on a
 * failed read, or when the run proposed nothing; while the run's distil seat is still reading it, the line says so and
 * is read again until it is done.
 */
export function RunLearningsLine({ runId, navigate }: { runId: string; navigate?: Navigate | undefined }): React.ReactElement | null {
  const [learnings, setLearnings] = useState<RunLearnings | null>(null);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const read = (): void => {
      getRunLearnings(runId)
        .then((l) => {
          if (!live) return;
          setLearnings(l);
          if (l?.distilling === true) timer = setTimeout(read, RUN_LEARNINGS_POLL_MS);
        })
        .catch(() => {
          // A failed read says nothing: the card is about the run, not this line.
        });
    };
    read();
    return () => {
      live = false;
      if (timer !== null) clearTimeout(timer);
    };
  }, [runId]);
  const words = runLearningsWords(learnings);
  if (words === null || learnings === null) return null;
  const href = runLearningsPath(runId);
  return (
    <p data-testid="run-learnings-line" data-distilling={learnings.distilling ? 'true' : 'false'} className="wk-chat-p wk-session-grey">
      {words}
      {learnings.proposed > 0 && (
        <>
          {' · '}
          <a data-testid="run-learnings-review" href={href} onClick={(e) => { if (navigate !== undefined) { e.preventDefault(); navigate(href); } }}>Review</a>
        </>
      )}
    </p>
  );
}
