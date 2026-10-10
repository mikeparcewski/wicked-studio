import { useEffect, useLayoutEffect, useRef } from 'react';
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
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    menuRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [active]);
  // On narrow viewports the menu's absolute positioning can be clipped by an overflow:hidden ancestor.
  // Switch to fixed (escaping all clip contexts) and compute coordinates from the composer's screen rect.
  const applyNarrowFixed = useRef(() => {});
  applyNarrowFixed.current = () => {
    const el = menuRef.current;
    if (!el) return;
    el.style.position = '';
    el.style.left = '';
    el.style.right = '';
    el.style.bottom = '';
    el.style.width = '';
    const vw = window.innerWidth;
    if (vw > 600) return;
    const parent = el.offsetParent as HTMLElement | null;
    const parentRect = parent?.getBoundingClientRect() ?? { top: window.innerHeight / 2, left: 0 };
    const menuW = Math.min(480, vw - 24);
    el.style.position = 'fixed';
    el.style.width = `${menuW}px`;
    el.style.bottom = `${window.innerHeight - parentRect.top + 6}px`;
    el.style.left = `${Math.max(12, Math.min(parentRect.left, vw - menuW - 12))}px`;
    el.style.right = 'auto';
  };
  useLayoutEffect(() => applyNarrowFixed.current());
  useEffect(() => {
    const handler = () => applyNarrowFixed.current();
    // Capture phase: a scrolling ancestor (the launch form's column) moves the box, and scroll does not bubble.
    window.addEventListener('resize', handler);
    window.addEventListener('scroll', handler, true);
    return () => {
      window.removeEventListener('resize', handler);
      window.removeEventListener('scroll', handler, true);
    };
  }, []);
  return (
    <div ref={menuRef} data-testid="composer-menu" id={`composer-menu-list-${menuKey}`} data-trigger={trigger} role="listbox" aria-label={ariaLabel ?? (trigger === '/' ? 'Add a step' : 'Name a project or a helper')} className="wk-composer-menu">
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
              <span className="wk-composer-cmd"><span className="wk-composer-cmd-pfx">/{it.cmd.slice(0, it.cmd.length - it.key.length)}</span><b>{it.key}</b></span>
              <small className="wk-composer-cmd-desc">{it.line}</small>
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
          <span className="wk-composer-cmd"><span className="wk-composer-cmd-pfx">/</span><b>{it.command.cmd}</b></span>
          <small className="wk-composer-cmd-desc">{it.refused ?? it.command.line}</small>
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
          title={it.line}
          onMouseDown={(e) => { e.preventDefault(); onPickAt?.(it); }}
          className={`wk-composer-menu-item${i === active ? ' wk-composer-menu-item--on' : ''}`}
        >
          <span className="wk-composer-cmd"><span className="wk-composer-cmd-pfx">@</span><b>{it.label}</b></span>
          <small className="wk-composer-cmd-desc">{it.line}</small>
        </button>
      ))}
    </div>
  );
}
