import { executingOrd } from '../../api/run-state.js';
import type { SessionView } from '../../api/types.js';
import { OBJECT_ACTIONS, type ObjectRef } from '../../board/objectActions.js';
import { parseSessionId, runChatIdOf } from '../../board/sessionModel.js';
import { STEP_WORD, unitPhaseId } from '../../board/chainModel.js';
import type { Navigate } from '../../hooks/useRoute.js';
import { openSheet, stopRun } from '../../store/sheets.js';
import { humanTitle } from '../runIdentity.js';

const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

/** One ⌘K row for the pointed object. `disabled`: why it cannot be done now (shown, never hidden). */
export interface ObjectCommand {
  id: string;
  label: string;
  run: () => void;
  disabled: string | null;
}

export interface ObjectCommands {
  title: string;
  rows: ObjectCommand[];
}

/**
 * ⌘K FOR THE POINTED OBJECT (DESIGN-interaction rule 9, slice S11): the object's actions — every one
 * in `OBJECT_ACTIONS`, plus "Look underneath" (its sheet). Stop waits 10 s with Undo
 * (`store/sheets` `stopRun`); a tab action opens the sheet at that tab.
 */
export function objectCommands(ref: ObjectRef, ctx: { runs: readonly SessionView[]; navigate: Navigate; runChatId: boolean }): ObjectCommands {
  const runOf = (id: string): SessionView | undefined => ctx.runs.find((v) => v.session.id === id);
  const go = (path: string) => (): void => ctx.navigate(path);
  const look: ObjectCommand = { id: 'look', label: 'Look underneath', run: () => openSheet(ref), disabled: null };
  const actions = OBJECT_ACTIONS[ref.kind];
  const tabRow = (id: string, label: string, tab: string): ObjectCommand => ({ id, label, run: () => openSheet(ref, tab), disabled: null });

  if (ref.kind === 'step' || ref.kind === 'helper') {
    const v = runOf(ref.runId);
    const runTitle = v !== undefined ? humanTitle(v.session.problem || v.session.id) : ref.runId;
    const working = v !== undefined && ['executing', 'distributing', 'planning'].includes(v.session.status);
    const live = v !== undefined && !TERMINAL.has(v.session.status);
    const unit = ref.kind === 'step' ? v?.units.find((u) => u.ord === ref.ord) : undefined;
    const phase = unit !== undefined ? unitPhaseId(unit) : null;
    const name = ref.kind === 'helper' ? ref.cli
      : unit !== undefined ? (phase !== null ? STEP_WORD[phase.toLowerCase()] : undefined) ?? `step ${ref.ord + 1}` : 'this step';
    const rows = actions.map((a): ObjectCommand => {
      if (a.tab !== undefined) return tabRow(a.id, a.label, a.tab);
      switch (a.id) {
        case 'message':
          return { id: a.id, label: a.label, run: () => openSheet(ref, ref.kind === 'helper' ? 'terminal' : 'happening'), disabled: working ? null : 'It is not working right now.' };
        case 'rerun':
          return { id: a.id, label: `${a.label} (on its run page)`, run: go(`/runs/${encodeURIComponent(ref.runId)}`), disabled: null };
        case 'record':
          return { id: a.id, label: a.label, run: go(`/runs/${encodeURIComponent(ref.runId)}`), disabled: null };
        case 'stop':
          return { id: a.id, label: `${a.label} — 10 s to undo`, run: () => { stopRun([ref.runId], `“${runTitle}”`); }, disabled: live ? null : 'It has already ended.' };
        default:
          return { id: a.id, label: a.label, run: () => openSheet(ref), disabled: null };
      }
    });
    return { title: `${name} on “${runTitle}”`, rows: [look, ...rows] };
  }
  if (ref.kind === 'session') {
    const s = parseSessionId(ref.sessionId);
    const mine = s.kind === 'run' ? ctx.runs.filter((v) => v.session.id === s.runId)
      : ctx.runs.filter((v) => ctx.runChatId && runChatIdOf(v) === s.chatId);
    const live = mine.filter((v) => !TERMINAL.has(v.session.status)).map((v) => v.session.id);
    const newest = mine[mine.length - 1];
    const title = mine[0] !== undefined ? humanTitle(mine[0].session.problem || mine[0].session.id) : 'this session';
    const rows = actions.map((a): ObjectCommand => {
      if (a.tab !== undefined) return tabRow(a.id, a.label, a.tab);
      if (a.id === 'record') return { id: a.id, label: a.label, run: newest !== undefined ? go(`/runs/${encodeURIComponent(newest.session.id)}`) : () => {}, disabled: newest === undefined ? 'Nothing in it is on this daemon.' : null };
      if (a.id === 'stop') return { id: a.id, label: `${a.label} — 10 s to undo`, run: () => { stopRun(live, `“${title}”`); }, disabled: live.length === 0 ? 'Nothing in it is running.' : null };
      return { id: a.id, label: a.label, run: () => openSheet(ref), disabled: null };
    });
    return { title, rows: [look, ...rows] };
  }
  const rows = actions.map((a): ObjectCommand => {
    if (a.tab !== undefined) return tabRow(a.id, a.label, a.tab);
    if (a.id === 'everything') return { id: a.id, label: a.label, run: go('/projects'), disabled: null };
    if (a.id === 'settings') return { id: a.id, label: a.label, run: go('/system'), disabled: null };
    return { id: a.id, label: a.label, run: () => openSheet(ref), disabled: null };
  });
  // The helpers working right now, one row each, so "message codex" is two keystrokes from the Desk.
  for (const v of ctx.runs) {
    const ord = executingOrd(v.session, v.units);
    const u = v.units.find((x) => x.ord === ord);
    if (u?.assigned_cli) {
      const r: ObjectRef = { kind: 'helper', runId: v.session.id, cli: u.assigned_cli };
      rows.push({ id: `helper-${v.session.id}-${u.assigned_cli}`, label: `${u.assigned_cli} on “${humanTitle(v.session.problem || v.session.id)}”`, run: () => openSheet(r), disabled: null });
    }
  }
  return { title: 'the Desk', rows: [look, ...rows] };
}
