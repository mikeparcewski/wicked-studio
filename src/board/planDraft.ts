import type { LaunchPlan } from '../api/teamPlan.js';
import { stepLabelOf } from './chainModel.js';
import { DELIVER_STEP, planFromSelection } from './planModel.js';

/**
 * PLAN DRAFTS (DES-STUDIO-REBUILD-001 §5.7, slice S7): every plan edit a `/` command makes is a
 * draft first, never a direct POST.
 *
 *  - With a `plan_approval` gate open, `POST /runs/:id/plan` IS the gate's answer. So the draft is
 *    shown on the gate card ("Approve with these changes") and only the card's explicit approve
 *    sends it (through the gate decision path and its undo window). The composer never POSTs then.
 *  - Mid-run (no gate), the edit is queued for 10 s with Undo, then POSTed once with its
 *    `requestId`. The plan only grows (DES-TEAMING-002 §8.7), so once sent it reads "Added …" with
 *    no Undo: the engine cannot remove it.
 *  - A command the engine cannot take is refused in the menu, with the reason, before anything is
 *    queued.
 *
 * A question ("should we just plan it?") is never a command: only a leading `/` picks one, so
 * typing never reshapes the chain.
 */

/** One `/` command: the step it adds, as the catalog names it. */
export interface SlashCommand {
  /** What is typed after `/`. */
  cmd: string;
  /** The step's word on the chain (`chainModel` STEP_WORD vocabulary). */
  word: string;
  /** One plain line on what the step does. */
  line: string;
  /** The catalog id the step instantiates; `null` = never added mid-run (said in `refuse`). */
  catalog: string | null;
  /** Why the command is refused whatever the run's state (`null` = it can be added). */
  refuse: string | null;
}

export const SLASH_COMMANDS: readonly SlashCommand[] = [
  { cmd: 'test', word: 'Test', line: 'checks and their results', catalog: 'test', refuse: null },
  { cmd: 'review', word: 'Review', line: 'a different helper reviews the work', catalog: 'review', refuse: null },
  { cmd: 'walkthrough', word: 'Walkthrough', line: 'a recorded run-through, checked underneath, by a different helper', catalog: 'walkthrough_review', refuse: null },
  { cmd: 'research', word: 'Research', line: 'find out what’s true first', catalog: 'understand', refuse: null },
  { cmd: 'security', word: 'Security review', line: 'a security pass over the change', catalog: 'security_review', refuse: null },
  {
    cmd: 'plan', word: 'Plan', line: 'stop at a plan you can edit', catalog: null,
    refuse: 'A running plan only grows: steps after the plan cannot be taken off. Ask in words and a helper proposes it.',
  },
  {
    cmd: 'deliver', word: 'Deliver', line: 'hand it over — always asks you first', catalog: DELIVER_STEP,
    refuse: 'Handing over is chosen when the work starts, and it always asks you at the end.',
  },
];

/** What the composer's session can take a step on. */
export type DraftTarget =
  | { kind: 'gate-amend'; runId: string; seed: readonly string[] }
  | { kind: 'mid-run'; runId: string }
  | { kind: 'none'; reason: string };

/** The run a `/` command acts on, in what state — from the caller's reads. */
export interface DraftRunState {
  runId: string;
  status: string;
  /** A preset or user plan (`run_identity`): only a planned run takes plan edits. */
  planned: boolean;
  /** The open gate is a `plan_approval` gate (and its held plan, by catalog). */
  planGate: { seed: readonly string[] } | null;
  /** The open gate's kind is not known yet (fail closed). */
  gatePending: boolean;
}

const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

/**
 * Where a `/` command lands for a session: its newest run that is still going. Before any run
 * (the Desk, or a session that only talked) there is no chain to add to, and the reason says so.
 */
export function draftTarget(runs: readonly DraftRunState[]): DraftTarget {
  const live = [...runs].reverse().find((r) => !TERMINAL.has(r.status));
  if (live === undefined) {
    return { kind: 'none', reason: runs.length === 0 ? 'Nothing has started here yet: say what to do, and the steps come with it.' : 'This work has finished: a new step needs new work.' };
  }
  if (!live.planned) return { kind: 'none', reason: 'This run follows a fixed workflow: its steps cannot be changed.' };
  if (live.status === 'awaiting_human') {
    if (live.gatePending) return { kind: 'none', reason: 'Reading the open question first…' };
    if (live.planGate !== null) return { kind: 'gate-amend', runId: live.runId, seed: live.planGate.seed };
    return { kind: 'none', reason: 'The run is waiting on you: answer it first, then add steps.' };
  }
  return { kind: 'mid-run', runId: live.runId };
}

/** One menu row: the command, and why it cannot be picked right now (`null` = pickable). */
export interface SlashItem {
  command: SlashCommand;
  refused: string | null;
}

/**
 * The `/` menu for a query: commands whose name or word starts with it, each with its refusal (the
 * command's own, the target's, or "not in this engine's catalog").
 */
export function slashItems(query: string, target: DraftTarget, catalog: readonly string[] | null): SlashItem[] {
  const q = query.toLowerCase();
  return SLASH_COMMANDS
    .filter((c) => c.cmd.startsWith(q) || c.word.toLowerCase().startsWith(q))
    .map((command) => ({
      command,
      refused: command.refuse
        ?? (target.kind === 'none' ? target.reason : null)
        ?? (catalog !== null && command.catalog !== null && !catalog.includes(command.catalog)
          ? `This engine has no ${command.word} step.`
          : null),
    }));
}

/** One authored step as the operator has it: the catalog, whether it was added at this gate, and an
 *  id given once that follows it through moves (`<catalog>#<n>` for the n-th seed occurrence,
 *  `+<catalog>#<n>` for the n-th added one) — so a repeated step keeps its own row. */
export interface DraftStep { id: string; catalog: string; added: boolean }

function withIds(catalogs: readonly string[], added: boolean): DraftStep[] {
  const seen = new Map<string, number>();
  return catalogs.map((catalog) => {
    const n = (seen.get(catalog) ?? 0) + 1;
    seen.set(catalog, n);
    return { id: `${added ? '+' : ''}${catalog}#${n}`, catalog, added };
  });
}

/** The id the next added `catalog` gets (its occurrence among the added ones). */
export function addedStep(added: readonly string[], catalog: string): DraftStep {
  return { id: `+${catalog}#${added.filter((c) => c === catalog).length + 1}`, catalog, added: true };
}

/** A gate-amend draft: the held plan's authored steps plus the ones added — in the operator's order (S10). */
export interface GateDraft {
  runId: string;
  /** The gate instance the draft was made on (`ord:receivedAt`): a new gate drops it. */
  gateKey: string;
  /** The held plan's authored steps, in the engine's order. */
  seed: string[];
  /** What was added at this gate, in order of adding (a `/` command, the editor's Add). */
  added: string[];
  /** The authored plan in the operator's order (S10: every seed step, maybe moved, and every added
   *  one); `null` until a move — the seed, then the added steps. */
  order: DraftStep[] | null;
}

/** The authored steps as the draft has them: `order` when one was made, else seed then added. */
export function draftSteps(d: Pick<GateDraft, 'seed' | 'added' | 'order'>): DraftStep[] {
  return d.order ?? [...withIds(d.seed, false), ...withIds(d.added, true)];
}

/** Whether the order the card sends differs from the engine's with the added steps at the end — a
 *  moved seed step, or an added step placed anywhere but last (codex r1: that is an order too). */
export function orderChanged(d: Pick<GateDraft, 'seed' | 'added' | 'order'>): boolean {
  if (d.order === null) return false;
  const plain = draftSteps({ ...d, order: null });
  return d.order.length !== plain.length || d.order.some((s, i) => s.id !== plain[i]!.id);
}

/** A draft that changes something: a step added, or the order. */
export function draftChanges(d: Pick<GateDraft, 'seed' | 'added' | 'order'>): boolean {
  return d.added.length > 0 || orderChanged(d);
}

/** The plan a gate-amend draft sends with the card's approve: the authored steps in the draft's order. */
export function gateDraftPlan(d: Pick<GateDraft, 'seed' | 'added' | 'order'>): LaunchPlan {
  return planFromSelection(draftSteps(d).map(({ catalog }) => ({ catalog })), []);
}

/** The plan a mid-run edit POSTs: the added steps only (the engine appends them). */
export function midRunPlan(catalog: string): LaunchPlan {
  return planFromSelection([{ catalog }], []);
}

/** "The steps change: + Test, + Review." — the gate card's line for a draft; with a new order (S10),
 *  "The order changes: Research → Review → Build." — the whole authored order, in the chain's words,
 *  so nothing about what is sent is left to guess. */
export function draftLine(d: Pick<GateDraft, 'seed' | 'added' | 'order'>, words?: ReadonlyMap<string, string>): string {
  const parts: string[] = [];
  if (d.added.length > 0) parts.push(`The steps change: ${d.added.map((c) => `+ ${wordOf(c)}`).join(', ')}.`);
  // studio#574: a seed step goes by the plan's word for it (`planOrder.ts` planStepWords) when the
  // caller has the plan — the same word the editor's row and the chain use; else its catalog's.
  if (orderChanged(d)) parts.push(`The order changes: ${draftSteps(d).map((s) => words?.get(s.id) ?? stepLabelOf(s.catalog)).join(' → ')}.`);
  return parts.join(' ');
}

/** A catalog id's word (the command's, else the id itself). */
export function wordOf(catalog: string): string {
  return SLASH_COMMANDS.find((c) => c.catalog === catalog)?.word ?? catalog;
}

/** The trailing `/x` or `@x` token being typed at the caret, if any. */
export function menuToken(text: string, caret: number): { trigger: '/' | '@'; query: string; start: number } | null {
  const before = text.slice(0, caret);
  const m = /(^|\s)([/@])([\w-]*)$/.exec(before);
  if (m === null) return null;
  return { trigger: m[2] as '/' | '@', query: m[3] ?? '', start: before.length - (m[3] ?? '').length - 1 };
}

/** The text with the token at `start..caret` taken out (the pick replaces it). */
export function dropToken(text: string, start: number, caret: number): string {
  return `${text.slice(0, start)}${text.slice(caret)}`.replace(/[ \t]+$/, '');
}
