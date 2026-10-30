import type { CoreEvent } from '../api/types.js';
import { arrivedAt } from '../store/events.js';

/**
 * LIVE ACTIVITY (operator 2026-10-30: "while a step runs, show what it's doing, like Claude Code or Codex do"): what the
 * seat working on a step is doing now — reading a file, running a command or the tests, editing a file — from the
 * frames that say so, newest last, collapsing to one summary line when the step (or the orchestrator's turn) ends.
 *
 * Sources, best first:
 *  - `toolActivity` — one frame per tool call from the seat's stream, started and finished (asked of the engine lane;
 *    read here as soon as it exists): the tool, what it touched, whether it worked;
 *  - `powerActivity` — power mode's edits and commits, read off git about once a minute;
 *  - `governanceHookFired` — every tool call the gate judged (today these land together when the step ends: they feed
 *    the summary, and the live list too if an engine sends them live);
 *  - the step's own words streaming in (`unitOutputDelta`): its newest line, as what it says it is doing.
 */

export type ActivityKind = 'read' | 'search' | 'run' | 'test' | 'edit' | 'write' | 'commit' | 'skill' | 'task' | 'other';

export interface LiveRow {
  key: string;
  at: number | null;
  kind: ActivityKind;
  /** "Reading src/lib/money.ts", "Running `npm test -- invoices`", "Edited src/routes/invoices.ts +9 −2". */
  text: string;
  /** Still going (a started tool call with no finish yet). */
  running: boolean;
  ok: boolean | null;
}

type Ev = CoreEvent & Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const timeOf = (e: Ev): number | null => num(e.ts) ?? arrivedAt(e) ?? num(e.at);

/** A target in one short line: a path as it is, a command in backticks, never more than 90 characters. */
function short(s: string, max = 90): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

const TOOL_KIND: Record<string, ActivityKind> = {
  read: 'read', view: 'read', open: 'read', cat: 'read',
  grep: 'search', glob: 'search', search: 'search', find: 'search', ls: 'search', websearch: 'search', webfetch: 'read',
  bash: 'run', shell: 'run', exec: 'run', run: 'run', terminal: 'run',
  edit: 'edit', multiedit: 'edit', apply_patch: 'edit', patch: 'edit', notebookedit: 'edit',
  write: 'write', create: 'write',
  skill: 'skill', task: 'task', agent: 'task',
};

/** A tool's kind from its name ("Read", "Bash", "apply_patch"), or `other`. */
export function toolKind(tool: string | null): ActivityKind {
  if (tool === null) return 'other';
  return TOOL_KIND[tool.toLowerCase()] ?? 'other';
}

function looksLikeTests(cmd: string): boolean {
  return /\b(test|tests|vitest|jest|pytest|cargo\s+(?:nextest|test)|go\s+test|npm\s+(?:run\s+)?test|mocha|rspec)\b/i.test(cmd);
}

function rowWords(kind: ActivityKind, target: string | null, running: boolean, ok: boolean | null, tool: string | null): string {
  const t = target !== null ? short(target) : null;
  switch (kind) {
    case 'read': return t !== null ? `${running ? 'Reading' : 'Read'} ${t}` : running ? 'Reading a file' : 'Read a file';
    case 'search': return t !== null ? `${running ? 'Searching' : 'Searched'} ${t}` : running ? 'Searching the code' : 'Searched the code';
    case 'test': return running ? `Running the tests${t !== null ? ` \`${t}\`` : ''}` : `${ok === false ? 'Tests failed' : 'Tests passed'}${t !== null ? ` · \`${t}\`` : ''}`;
    case 'run': return t !== null ? `${running ? 'Running' : ok === false ? 'Failed:' : 'Ran'} \`${t}\`` : running ? 'Running a command' : 'Ran a command';
    case 'edit': return t !== null ? `${running ? 'Editing' : 'Edited'} ${t}` : running ? 'Editing a file' : 'Edited a file';
    case 'write': return t !== null ? `${running ? 'Writing' : 'Wrote'} ${t}` : running ? 'Writing a file' : 'Wrote a file';
    case 'skill': return `${running ? 'Using' : 'Used'} ${t !== null ? `the ${t} skill` : 'a skill'}`;
    case 'task': return running ? 'Asking a helper' : 'Asked a helper';
    case 'commit': return t !== null ? `Committed ${t}` : 'Committed';
    default: return `${running ? 'Using' : 'Used'} ${tool ?? 'a tool'}`;
  }
}

/** The frames of one step's newest attempt (from its last dispatch), or of one orchestrator turn when `turn` is set. */
function scoped(events: readonly CoreEvent[], ord: number, turn: number | null): Ev[] {
  const list = events as readonly Ev[];
  let from = 0;
  let to = list.length;
  for (let i = 0; i < list.length; i++) {
    const e = list[i]!;
    if (e.ord !== ord) continue;
    if (turn === null && e.type === 'unitDispatched') from = i;
    if (turn !== null && e.type === 'powerTurnStarted' && e.turn === turn) from = i;
    if (turn !== null && e.type === 'powerTurnCompleted' && e.turn === turn) { to = i + 1; break; }
  }
  return list.slice(from, to).filter((e) => e.ord === ord);
}

/** The activity rows of a step (or a turn), oldest first: a started tool call and its finish are one row. */
export function activityRows(events: readonly CoreEvent[] | null | undefined, ord: number, turn: number | null = null): LiveRow[] {
  const out: LiveRow[] = [];
  const byCall = new Map<string, number>();
  let n = 0;
  for (const e of scoped(events ?? [], ord, turn)) {
    n += 1;
    if (e.type === 'toolActivity') {
      const tool = str(e.tool);
      const target = str(e.target);
      let kind = (typeof e.kind === 'string' ? e.kind : toolKind(tool)) as ActivityKind;
      if (kind === 'run' && target !== null && looksLikeTests(target)) kind = 'test';
      const running = e.state === 'started';
      const ok = typeof e.ok === 'boolean' ? e.ok : null;
      const id = str(e.id);
      const row: LiveRow = { key: id !== null ? `t:${id}` : `t#${n}`, at: timeOf(e), kind, text: rowWords(kind, target, running, ok, tool), running, ok };
      const at = id !== null ? byCall.get(id) : undefined;
      if (at !== undefined) out[at] = { ...row, at: out[at]!.at };
      else { if (id !== null) byCall.set(id, out.length); out.push(row); }
    } else if (e.type === 'powerActivity') {
      const k = e.kind === 'commit' ? 'commit' : e.kind === 'edit' ? 'edit' : null;
      if (k === null) continue;
      const added = num(e.added);
      const removed = num(e.removed);
      const sha = str(e.sha);
      const text = k === 'commit'
        ? `Committed ${sha !== null ? sha.slice(0, 7) : ''}${str(e.subject) !== null ? ` · ${short(str(e.subject)!, 70)}` : ''}`.trim()
        : `Edited ${str(e.path) ?? 'a file'}${added !== null ? ` +${added}` : ''}${removed !== null ? ` −${removed}` : ''}`;
      out.push({ key: `p#${n}`, at: timeOf(e), kind: k, text, running: false, ok: null });
    }
  }
  return out;
}

/** The tool calls the gate judged for a step (or turn): what the summary counts when no `toolActivity` came. */
function judgedTools(events: readonly CoreEvent[] | null | undefined, ord: number, turn: number | null): ActivityKind[] {
  return scoped(events ?? [], ord, turn).filter((e) => e.type === 'governanceHookFired' && e.decision !== 'deny').map((e) => toolKind(str(e.toolName)));
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/**
 * One line for a finished step or turn: "Read 4 files · ran 7 commands · ran the tests twice · edited 3 files · 2
 * commits". Null when nothing was recorded.
 */
export function activitySummary(events: readonly CoreEvent[] | null | undefined, ord: number, turn: number | null = null): string | null {
  const rows = activityRows(events, ord, turn);
  const tools = rows.some((r) => r.key.startsWith('t')) ? rows.filter((r) => r.key.startsWith('t')).map((r) => r.kind) : judgedTools(events, ord, turn);
  const count = (k: ActivityKind): number => tools.filter((x) => x === k).length;
  const edited = new Set(rows.filter((r) => r.kind === 'edit' || r.kind === 'write').map((r) => r.text.replace(/ [+−].*$/, '').replace(/^(Edited|Wrote) /, '')));
  const editsFromTools = count('edit') + count('write');
  const commits = rows.filter((r) => r.kind === 'commit').length;
  const parts = [
    count('read') > 0 ? `read ${plural(count('read'), 'file')}` : null,
    count('search') > 0 ? `searched ${count('search') === 1 ? 'once' : `${count('search')} times`}` : null,
    count('run') > 0 ? `ran ${plural(count('run'), 'command')}` : null,
    count('test') > 0 ? `ran the tests ${count('test') === 1 ? 'once' : count('test') === 2 ? 'twice' : `${count('test')} times`}` : null,
    edited.size > 0 ? `edited ${plural(edited.size, 'file')}` : editsFromTools > 0 ? `made ${plural(editsFromTools, 'edit')}` : null,
    count('skill') > 0 ? `used ${plural(count('skill'), 'skill')}` : null,
    count('task') > 0 ? `asked ${plural(count('task'), 'helper')}` : null,
    commits > 0 ? plural(commits, 'commit') : null,
    count('other') > 0 ? `${plural(count('other'), 'other tool call')}` : null,
  ].filter((x): x is string => x !== null);
  if (parts.length === 0) return null;
  const line = parts.join(' · ');
  return line[0]!.toUpperCase() + line.slice(1);
}

/** What the step says it is doing: the newest line of its streamed words, plain (no markdown marks), or null. */
export function narration(output: string | undefined): string | null {
  if (output === undefined || output.trim() === '') return null;
  const lines = output.replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/[*_#>`]+/g, '').replace(/\s+/g, ' ').trim()).filter((l) => l !== '' && !/^[-=|]+$/.test(l));
  const last = lines.at(-1);
  return last === undefined ? null : short(last, 140);
}
