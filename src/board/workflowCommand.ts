import type { WorkflowDef } from '../api/types.js';
import type { Preset } from '../api/teamPlan.js';

/**
 * THE WORKFLOW COMMAND (DES-STUDIO-REBUILD-001 §5.5/§5.7, slice S19a): a workflow is named with a
 * `/workflow-<key>` FIRST token in the composer, and Enter launches it. The rest of the line is the
 * intent the workflow runs on.
 *
 * The catalog is the daemon's OWN (`GET /workflows` + the scope's `GET /presets`), read through the
 * caches the surfaces already warm — studio keeps no list of its own. `is_system` entries are the
 * machine-owned flows (`chat`, `onboarding`, …): they have dedicated entry points and are never
 * offered here (the same classification the workflow menu and the delivery surfaces share).
 *
 * Pure: parsing, the menu's rows, and the one line each row shows, all read off the daemon's shapes.
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

/** "5 phases: recon → author → verify → review" — the def's first four phases, and the count. */
/** The first four ids in order, then "…" when there are more (DES-slash-workflows §2). */
function headOf(ids: readonly string[]): string {
  const head = ids.slice(0, 4).join(' → ');
  return ids.length > 4 ? `${head} → …` : head;
}

export function commandLine(def: WorkflowDef): string {
  const ids = def.phases.map((p) => p.id);
  if (ids.length === 0) return 'no phases listed';
  const word = ids.length === 1 ? 'phase' : 'phases';
  return `${ids.length} ${word}: ${headOf(ids)}`;
}

/** "preset · 3 steps: understand → build → deliver" — a preset's steps, in order. */
export function presetCommandLine(preset: Preset): string {
  const ids = preset.steps.map((s) => s.catalog ?? s.id);
  if (ids.length === 0) return `preset · ${preset.name}`;
  const word = ids.length === 1 ? 'step' : 'steps';
  return `preset · ${ids.length} ${word}: ${headOf(ids)}`;
}

/** The line the menu shows while the daemon's workflow list is still being read. */
export const WORKFLOWS_LOADING_LINE = "Reading the daemon's workflows…";
/** The line the menu shows when the daemon answered with no workflows to start. */
export const WORKFLOWS_EMPTY_LINE = 'This daemon lists no workflows.';

/** How many rows the "Start work" group offers at once. */
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
    .slice(0, WORKFLOW_ROWS_MAX);
}
