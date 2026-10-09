import { WORKFLOWS_EMPTY_LINE, WORKFLOWS_LOADING_LINE, type WorkflowRow } from '../../board/workflowCommand.js';
import type { SlashItem } from '../../board/planDraft.js';

/** One `@` row: a project (a destination) or a helper (a subject). */
export interface AtItem {
  kind: 'project' | 'helper';
  id: string;
  label: string;
  line: string;
}

/**
 * THE `/` AND `@` MENU (DES-STUDIO-REBUILD-001 §5.5/§5.7; extracted from the composer in S19b) — one
 * listbox for every box that takes the grammar: the Desk's and a session's composer, and the launch
 * form's problem box. Render only: the box owns the token, the cursor and what a pick does.
 *
 *  - "Start work": the `/workflow-<key>` rows (only while `startCommands` — a FIRST token).
 *  - "Add a step": the plan-draft commands (refused ones say why).
 *  - `@`: projects and helpers.
 *
 * Option ids are `composer-menu-option-<menuKey>-<i>`, so the box's `aria-activedescendant` names one.
 */
export function SlashMenu({
  menuKey, trigger, startCommands, defsLoading, anyWorkflows, wf, slash = [], ats = [], active, head, ariaLabel,
  onPickWorkflow, onPickSlash, onPickAt,
}: {
  /** The box's key (`desk`, a session id, `launch`): the listbox and option ids carry it. */
  menuKey: string;
  trigger: '/' | '@';
  /** The `/` is the box's first token and no workflow is named yet: the "Start work" rows lead. */
  startCommands: boolean;
  /** The daemon's workflow list is still being read. */
  defsLoading: boolean;
  /** The daemon lists at least one ordinary workflow (any query). */
  anyWorkflows: boolean;
  wf: readonly WorkflowRow[];
  slash?: readonly SlashItem[];
  ats?: readonly AtItem[];
  active: number;
  /** The head line before "· ↑↓ Enter"; by default the composer's words. */
  head?: string;
  /** The listbox's accessible name; by default the composer's ("Add a step" / "Name a project or a helper"). */
  ariaLabel?: string;
  onPickWorkflow: (it: WorkflowRow) => void;
  onPickSlash?: (it: SlashItem) => void;
  onPickAt?: (it: AtItem) => void;
}): React.ReactElement {
  const count = trigger === '/' ? wf.length + slash.length : ats.length;
  const headLine = head ?? (trigger === '/' ? (startCommands ? 'Start work, or add a step' : 'Add a step to this session') : 'Name a project or a helper');
  return (
    <div data-testid="composer-menu" id={`composer-menu-list-${menuKey}`} data-trigger={trigger} role="listbox" aria-label={ariaLabel ?? (trigger === '/' ? 'Add a step' : 'Name a project or a helper')} className="wk-composer-menu">
      <p className="wk-composer-menu-head">{headLine} · ↑↓ Enter</p>
      {count === 0 && startCommands && defsLoading && <p data-testid="composer-menu-empty" className="wk-composer-menu-empty">{WORKFLOWS_LOADING_LINE}</p>}
      {count === 0 && startCommands && !defsLoading && !anyWorkflows && <p data-testid="composer-menu-empty" className="wk-composer-menu-empty">{WORKFLOWS_EMPTY_LINE}</p>}
      {count === 0 && !(startCommands && (defsLoading || !anyWorkflows)) && <p data-testid="composer-menu-empty" className="wk-composer-menu-empty">Nothing matches.</p>}
      {trigger === '/' && wf.length > 0 && (
        <>
          <p data-testid="composer-menu-group" data-group="start-work" className="wk-composer-menu-group">Start work</p>
          {wf.map((it, i) => (
            <button
              key={it.cmd}
              type="button"
              id={`composer-menu-option-${menuKey}-${i}`}
              role="option"
              aria-selected={i === active}
              data-testid="composer-menu-item"
              data-cmd={it.cmd}
              data-group="start-work"
              data-workflow={it.workflowId}
              title={it.line}
              onMouseDown={(e) => { e.preventDefault(); onPickWorkflow(it); }}
              className={`wk-composer-menu-item${i === active ? ' wk-composer-menu-item--on' : ''}`}
            >
              <code className="wk-composer-cmd">/{it.cmd}</code>
              <span><b>{it.key}</b> <small>{it.line}</small></span>
            </button>
          ))}
        </>
      )}
      {trigger === '/' && (wf.length > 0 && slash.length > 0) && (
        <p data-testid="composer-menu-group" data-group="add-step" className="wk-composer-menu-group">Add a step</p>
      )}
      {trigger === '/' && slash.map((it, i) => (
        <button
          key={it.command.cmd}
          type="button"
          id={`composer-menu-option-${menuKey}-${wf.length + i}`}
          role="option"
          aria-selected={wf.length + i === active}
          aria-disabled={it.refused !== null}
          data-testid="composer-menu-item"
          data-cmd={it.command.cmd}
          data-group="add-step"
          data-refused={it.refused !== null ? 'true' : 'false'}
          title={it.refused ?? it.command.line}
          onMouseDown={(e) => { e.preventDefault(); onPickSlash?.(it); }}
          className={`wk-composer-menu-item${wf.length + i === active ? ' wk-composer-menu-item--on' : ''}${it.refused !== null ? ' wk-composer-menu-item--off' : ''}`}
        >
          <code className="wk-composer-cmd">/{it.command.cmd}</code>
          <span><b>{it.command.word}</b> <small>{it.refused ?? it.command.line}</small></span>
        </button>
      ))}
      {trigger === '@' && ats.map((it, i) => (
        <button
          key={`${it.kind}:${it.id}`}
          type="button"
          id={`composer-menu-option-${menuKey}-${i}`}
          role="option"
          aria-selected={i === active}
          data-testid="composer-menu-item"
          data-kind={it.kind}
          data-id={it.id}
          onMouseDown={(e) => { e.preventDefault(); onPickAt?.(it); }}
          className={`wk-composer-menu-item${i === active ? ' wk-composer-menu-item--on' : ''}`}
        >
          <code className="wk-composer-cmd">@</code>
          <span><b>{it.label}</b> <small>{it.line}</small></span>
        </button>
      ))}
    </div>
  );
}
