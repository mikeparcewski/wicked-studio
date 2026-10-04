/**
 * LOOK UNDERNEATH (DES-STUDIO-REBUILD-001 §5.5 "Sheets", slice S11; DESIGN-simple §4-§5;
 * DESIGN-interaction rule 9): every object you can point at — a step, a helper, a session, the
 * Desk — has one sheet with its depth in tabs and ONE primary action on it; every other action
 * lives in ⌘K for that object. This file is the model: the objects, their tabs, their actions,
 * and where each raw control of the old dense mode now lives. Pure: no React, no store.
 */

export type ObjectRef =
  | { kind: 'step'; runId: string; ord: number }
  | { kind: 'helper'; runId: string; cli: string }
  | { kind: 'session'; sessionId: string }
  | { kind: 'desk' };

export type ObjectKind = ObjectRef['kind'];

/** One tab of a sheet. `section` marks a run section the rail's accordion also renders. */
export interface SheetTab {
  id: string;
  label: string;
}

/** One action on an object. */
export interface ObjectAction {
  id: string;
  label: string;
  /** The one action the sheet itself shows; the rest are ⌘K for the object. */
  primary?: true;
  /** Waits 10 s with Undo before anything is sent (rule 4). */
  undoable?: true;
  /** Opens a tab rather than doing something (a ⌘K row may still name it). */
  tab?: string;
}

/** The run sections the rail's accordion renders (RightPanel `ACCORDIONS`), as session tabs. */
export const RUN_SECTION_TABS: readonly SheetTab[] = [
  { id: 'whatwhere', label: 'What and where' },
  { id: 'plan', label: 'Plan' },
  { id: 'decisions', label: 'Decisions' },
  { id: 'governance', label: 'Governance' },
  { id: 'burn', label: 'Spend' },
  { id: 'data', label: 'Data used' },
  { id: 'steering', label: 'Steering' },
  { id: 'assumptions', label: 'Assumptions' },
  { id: 'files', label: 'Files referenced' },
  { id: 'delivery', label: 'Delivery' },
];

export const SHEET_TABS: Readonly<Record<ObjectKind, readonly SheetTab[]>> = {
  step: [
    { id: 'happening', label: 'What’s happening' },
    { id: 'events', label: 'Live events' },
    { id: 'did', label: 'What it did' },
    { id: 'changes', label: 'Changes' },
  ],
  helper: [
    { id: 'terminal', label: 'Terminal' },
    { id: 'did', label: 'What it did' },
    { id: 'signin', label: 'Sign-in and allowance' },
  ],
  session: [
    { id: 'goal', label: 'Goal' },
    // S15d (Amendment 5 item 1): the old run page's depth, in plain words — every step and what it
    // did, the changes, the evidence bundle — under the session, never on a page of its own.
    { id: 'steps', label: 'Steps' },
    { id: 'helpers', label: 'Helpers' },
    { id: 'changes', label: 'Changes' },
    { id: 'evidence', label: 'Evidence' },
    { id: 'activity', label: 'Activity' },
    { id: 'signins', label: 'Sign-ins' },
    ...RUN_SECTION_TABS,
  ],
  desk: [
    { id: 'studio', label: 'Studio itself' },
    { id: 'computer', label: 'This computer' },
    { id: 'signins', label: 'Sign-ins' },
    { id: 'helpers', label: 'All helpers' },
    { id: 'hold', label: 'Hold deliveries' },
  ],
};

export const OBJECT_ACTIONS: Readonly<Record<ObjectKind, readonly ObjectAction[]>> = {
  step: [
    { id: 'message', label: 'Message it', primary: true },
    { id: 'rerun', label: 'Re-run from here' },
    { id: 'changes', label: 'See its changes', tab: 'changes' },
    { id: 'record', label: 'Full record' },
    { id: 'stop', label: 'Stop it', undoable: true },
  ],
  helper: [
    { id: 'message', label: 'Message it', primary: true },
    { id: 'terminal', label: 'Open its terminal', tab: 'terminal' },
    { id: 'signin', label: 'Sign-in and allowance', tab: 'signin' },
    { id: 'stop', label: 'Stop it', undoable: true },
  ],
  session: [
    { id: 'record', label: 'Full record', primary: true },
    { id: 'steps', label: 'Steps and what each did', tab: 'steps' },
    { id: 'changes', label: 'Changes', tab: 'changes' },
    { id: 'evidence', label: 'Evidence', tab: 'evidence' },
    { id: 'activity', label: 'Activity', tab: 'activity' },
    { id: 'helpers', label: 'Helpers', tab: 'helpers' },
    { id: 'stop', label: 'Stop this session', undoable: true },
  ],
  desk: [
    { id: 'everything', label: 'See everything', primary: true },
    { id: 'helpers', label: 'All helpers', tab: 'helpers' },
    { id: 'hold', label: 'Hold deliveries', tab: 'hold' },
    { id: 'settings', label: 'Settings' },
  ],
};

/** The one primary action of an object (the sheet's only button). */
export function primaryAction(kind: ObjectKind): ObjectAction {
  const a = OBJECT_ACTIONS[kind].find((x) => x.primary === true);
  if (a === undefined) throw new Error(`no primary action for ${kind}`);
  return a;
}

/** The object a `data-object` attribute names (`step:<run>:<ord>`, `helper:<run>:<cli>`, `session:<id>`, `desk`). */
export function parseObject(attr: string | null | undefined): ObjectRef | null {
  if (attr === null || attr === undefined || attr === '') return null;
  if (attr === 'desk') return { kind: 'desk' };
  const [kind, ...rest] = attr.split(':');
  if (kind === 'session' && rest.length > 0) return { kind: 'session', sessionId: rest.join(':') };
  if ((kind === 'step' || kind === 'helper') && rest.length >= 2) {
    const last = rest[rest.length - 1]!;
    const runId = rest.slice(0, -1).join(':');
    if (kind === 'helper') return { kind: 'helper', runId, cli: last };
    const ord = Number(last);
    return Number.isInteger(ord) && ord >= 0 ? { kind: 'step', runId, ord } : null;
  }
  return null;
}

/** The `data-object` attribute for an object (the inverse of {@link parseObject}). */
export function objectAttr(ref: ObjectRef): string {
  switch (ref.kind) {
    case 'desk': return 'desk';
    case 'session': return `session:${ref.sessionId}`;
    case 'step': return `step:${ref.runId}:${ref.ord}`;
    case 'helper': return `helper:${ref.runId}:${ref.cli}`;
  }
}

/** Where a raw control of the old dense mode lives now (DESIGN-simple §5). */
export type RawHome =
  | { on: ObjectKind; tab: string }
  | { on: ObjectKind; action: string }
  /** A surface of its own, reached from the rail or the Desk (its testid is in the inventory). */
  | { surface: string; testid: string };

/**
 * DESIGN-simple §5, row by row: each raw control and its homes. `tests/sheets.s11.test.tsx`
 * enumerates this table — every sheet home must exist (a tab or an action of that object), and each
 * is at most two clicks from its object (open the sheet, pick the tab).
 */
export const RAW_CONTROLS: ReadonlyArray<{ control: string; homes: readonly RawHome[] }> = [
  { control: 'Fleet (id, lane, seat, worktree, age, last line)', homes: [{ on: 'session', tab: 'helpers' }, { on: 'desk', tab: 'helpers' }, { on: 'helper', action: 'message' }, { on: 'step', action: 'stop' }, { on: 'step', action: 'rerun' }] },
  { control: 'Term (live PTY; take input)', homes: [{ on: 'helper', tab: 'terminal' }] },
  { control: 'Events (CoreEvent tail)', homes: [{ on: 'step', tab: 'events' }, { on: 'session', tab: 'activity' }, { surface: 'Watchtower', testid: 'watchtower' }] },
  { control: 'Transcript', homes: [{ on: 'step', tab: 'did' }, { on: 'helper', tab: 'did' }] },
  { control: 'Diff', homes: [{ on: 'step', tab: 'changes' }, { on: 'session', tab: 'changes' }, { surface: 'See everything', testid: 'desk-see-everything' }] },
  // S15d: what the retired run page carried (RunTimeline's rows and failure details, the evidence download).
  { control: 'Timeline (steps in order, what each did, where it failed)', homes: [{ on: 'session', tab: 'steps' }, { on: 'step', tab: 'did' }] },
  { control: 'Evidence bundle (download)', homes: [{ on: 'session', tab: 'evidence' }] },
  { control: 'Seats (auth, limit, reset, re-auth, route elsewhere)', homes: [{ on: 'helper', tab: 'signin' }, { on: 'session', tab: 'signins' }, { on: 'desk', tab: 'signins' }] },
  { control: 'Host (disk, stores)', homes: [{ on: 'desk', tab: 'computer' }] },
  { control: 'Policy ledger, detector, thresholds, conflicts', homes: [{ on: 'session', tab: 'governance' }, { on: 'session', tab: 'steering' }, { surface: 'Rules', testid: 'desk-rail-rules' }] },
  { control: 'Daemon (version, uptime, stores, outbox, freeze)', homes: [{ on: 'desk', tab: 'studio' }, { on: 'desk', tab: 'hold' }] },
  { control: 'Produced index', homes: [{ surface: 'See everything', testid: 'desk-see-everything' }] },
  { control: 'Hover chips on ids', homes: [{ surface: 'Peek card', testid: 'peek-card' }] },
  { control: 'Status bar (working · need you · next · seat · disk)', homes: [{ surface: 'Rail badges', testid: 'desk-rail-badge' }, { surface: 'Desk sentence', testid: 'desk-headline' }, { surface: 'Session status', testid: 'session-status' }] },
  { control: 'Queue column with option grids', homes: [{ surface: 'Needs you rows', testid: 'need-row' }] },
  { control: 'Masthead DoD bar, rule counters', homes: [{ surface: 'Session status sentence', testid: 'session-status-sentence' }] },
  { control: 'Run sections (What/Where … Delivery)', homes: RUN_SECTION_TABS.map((t) => ({ on: 'session' as const, tab: t.id })) },
  { control: 'Mode tags', homes: [{ surface: 'Start something', testid: 'desk-start-row' }] },
  { control: 'Keycaps and chord hints', homes: [{ surface: 'Shortcuts sheet', testid: 'shortcut-overlay' }] },
];

/** How many clicks a sheet home is from its object: 1 to open the sheet (an action is in it or in
 *  ⌘K), 2 when a tab has to be picked — and 1 when that tab is the sheet's first (open lands on it). */
export function clicksTo(home: Exclude<RawHome, { surface: string }>): number {
  if ('action' in home) return 1;
  return SHEET_TABS[home.on][0]?.id === home.tab ? 1 : 2;
}
