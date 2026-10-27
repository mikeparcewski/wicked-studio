import { useId, useMemo, useState } from 'react';
import type { SessionView } from '../../api/types.js';
import { needsByRun, needTextByRun, railGroups } from '../../board/deskModel.js';
import type { NeedRow } from '../../board/needsYou.js';
import { useCapabilities } from '../../store/capabilities.js';
import { useDeliveredNow } from '../../store/postHocDeliver.js';
import { MoveProjectStatus, MoveToProject, useMovableBoardModel } from './MoveToProject.js';

/** The list shows this many of the newest unfiled jobs; the sidebar's "Not in a project" has every one. */
const SHOWN = 12;

/**
 * "Not in a project" is not a project (coordinator review 2026-10-27): its home has no ask box and no
 * ⋯, only this line — "These jobs aren't filed in a project · Move to a project". The move opens the
 * newest unfiled jobs, each with the one Move to project picker the sidebar uses (the same write path,
 * one move at a time).
 */
export function UnfiledLine({ runs, needRows }: { runs: SessionView[]; needRows: NeedRow[] }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const { items, unfiled } = useMovableBoardModel(runs);
  const runChatId = useCapabilities((s) => s.runChatId);
  const deliveredNow = useDeliveredNow();
  const sessions = useMemo(() => railGroups(items, unfiled, needsByRun(needRows), Infinity, needTextByRun(needRows), runChatId, deliveredNow)
    .find((g) => g.projectId === null)?.sessions ?? [], [items, unfiled, needRows, runChatId, deliveredNow]);
  return (
    <div className="wk-pj-unfiled" data-testid="project-unfiled">
      <p className="wk-calm-foot wk-pj-unfiled-line">
        These jobs aren&apos;t filed in a project ·{' '}
        <button type="button" className="wk-pj-unfiled-move" data-testid="project-unfiled-move" aria-expanded={open} aria-controls={listId}
          onClick={() => setOpen((o) => !o)} disabled={sessions.length === 0}>Move to a project</button>
      </p>
      {open && (
        <ul id={listId} className="wk-pj-move-list" data-testid="project-unfiled-list" aria-label="Jobs not in a project">
          {sessions.slice(0, SHOWN).map((s) => (
            <li key={s.id} className="wk-desk-session-row wk-pj-move-row" data-move-row={s.id} data-testid="project-unfiled-row">
              <span className="wk-pj-move-title" title={s.fullTitle ?? s.title}>{s.title}</span>
              <MoveToProject session={s} projectId={null} runs={runs} />
            </li>
          ))}
          {sessions.length > SHOWN && <li className="wk-calm-foot wk-pj-move-more">{sessions.length - SHOWN} more are in the sidebar, under Not in a project.</li>}
        </ul>
      )}
      <MoveProjectStatus />
    </div>
  );
}
