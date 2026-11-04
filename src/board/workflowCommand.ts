import { stepNoun } from './deskWords.js';
import type { WorkflowDef } from '../api/types.js';
import type { Preset } from '../api/teamPlan.js';

/**
 * THE `/` MENU'S "START WORK" ROWS (DES-STUDIO-REBUILD-001 §5.5/§5.7, slices S19a/S19b; slash-catalog,
 * operator 2026-11-04: "the slash commands in the chatbox don't match the list of workflows when I see
 * the new job modal"). The rows are New job's catalog (`jobCatalogView`: crew's `GET /workflows/catalog`
 * with studio's own kinds; today's list on an older daemon) — the same entries, titles and categories,
 * "Your top" first (`catalogRows`, ./slashCatalog.ts) — and a pick starts what New job's card starts
 * (`startCatalogEntry`). Studio keeps
 * no list of its own: what crew's catalog leaves out (the machine-owned flows, `distill-learnings`) is
 * never offered here. (An older daemon has no catalog: there, as in New job, the list is today's.)
 *
 * `/workflow-<key>` typed whole as the FIRST token still names a workflow entry (back-compat): the rest
 * of the line is the intent it runs on.
 *
 * Pure: parsing, the menu's rows and what each row says, all read off the catalog view.
 */

/** A parsed `/workflow-<key> [intent]` line. `rest` is the intent after the key (trimmed). */
export interface WorkflowCommand {
  key: string;
  rest: string;
}

const WORKFLOW_COMMAND = /^\/workflow-([\w-]+)(?:\s+([\s\S]*))?$/;

/**
 * The workflow a line names, or `null`. The command must be the FIRST token: `fix /workflow-bug
 * later` is a sentence about a command, never a launch (§5.5 — only a leading `/` picks one).
 */
export function parseWorkflowCommand(text: string): WorkflowCommand | null {
  const m = WORKFLOW_COMMAND.exec(text.trim());
  if (m === null) return null;
  const key = m[1];
  if (key === undefined || key === '') return null;
  return { key, rest: (m[2] ?? '').trim() };
}

/** One row in the composer's "Start work" group. */
export interface WorkflowRow {
  key: string;
  /** The command typed after `/` (`workflow-<key>`). */
  cmd: string;
  /** The workflow's id as the launch body carries it. */
  workflowId: string;
  /** One plain line: the phases a def runs, or a preset's steps. */
  line: string;
  source: 'workflow' | 'preset';
}

/** The first four ids in order, then "…" when there are more (DES-slash-workflows §2). */
function headOf(ids: readonly string[]): string {
  const head = ids.slice(0, 4).join(' → ');
  return ids.length > 4 ? `${head} → …` : head;
}

// studio#726: the line names each step in plain words ("adversarial-review" → "review", "recon" →
// "research"), never the def's phase ids, and calls them steps — the word every other surface uses.
export function commandLine(def: WorkflowDef): string {
  const ids = def.phases.map((p) => p.id);
  if (ids.length === 0) return 'no steps listed';
  const word = ids.length === 1 ? 'step' : 'steps';
  return `${ids.length} ${word}: ${headOf(ids.map(stepNoun))}`;
}

/** "3 steps: understand → build → delivery" — a preset's steps, in order, in plain words. */
export function presetCommandLine(preset: Preset): string {
  const ids = preset.steps.map((s) => s.catalog ?? s.id);
  if (ids.length === 0) return preset.name.replace(/[_-]+/g, ' ');
  const word = ids.length === 1 ? 'step' : 'steps';
  return `${ids.length} ${word}: ${headOf(ids.map(stepNoun))}`;
}

/** The line the menu shows while the catalog is still being read (New job's words). */
export const WORKFLOWS_LOADING_LINE = 'Reading the workflows…';
/** The line the menu shows when the daemon answered with nothing to start (New job's words). */
export const WORKFLOWS_EMPTY_LINE = 'This daemon lists no workflows.';
/** The line the menu shows when a daemon that serves a catalog failed to answer: never another list. */
export const WORKFLOWS_FAILED_LINE = 'Couldn’t read the workflows. Type / again to try again.';

/** How many rows today's list (`workflowItems`) returns by default. The `/` menu lists New job's whole
 *  catalog (`catalogRows`, no cap: the menu scrolls). */
export const WORKFLOW_ROWS_MAX = 8;

/**
 * The "Start work" rows for a query: the daemon's ordinary workflows (defs first, then presets),
 * never a `system` entry, narrowed by what is typed. A def and a preset of the same name are one row
 * (the def wins — it is what the launch names).
 */
export function workflowItems(
  query: string,
  defs: readonly WorkflowDef[] | null,
  presets: readonly Preset[] | null,
  max: number = WORKFLOW_ROWS_MAX,
): WorkflowRow[] {
  const q = query.toLowerCase();
  const rows: WorkflowRow[] = [];
  const seen = new Set<string>();
  for (const def of defs ?? []) {
    if (def.is_system === true || seen.has(def.id)) continue;
    seen.add(def.id);
    rows.push({ key: def.id, cmd: `workflow-${def.id}`, workflowId: def.id, line: commandLine(def), source: 'workflow' });
  }
  for (const preset of presets ?? []) {
    if (preset.system === true || seen.has(preset.name)) continue;
    seen.add(preset.name);
    rows.push({ key: preset.name, cmd: `workflow-${preset.name}`, workflowId: preset.name, line: presetCommandLine(preset), source: 'preset' });
  }
  return rows
    .filter((r) => q === '' || r.cmd.toLowerCase().startsWith(q) || r.key.toLowerCase().startsWith(q))
    .slice(0, max);
}
