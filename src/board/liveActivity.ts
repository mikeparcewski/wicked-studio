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
  /** When it finished (unix ms), null while it runs: a finished call stays in view for a while after its turn. */
  doneAt: number | null;
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

/**
 * What a shell command does, from the command itself (retime 0.16.11: `sed -n 266,278p tests/x.test.ts`, `sed -i …` and a
 * python heredoc that rewrites a file were labelled "Tests passed" because the text mentions `tests/`). The command is
 * split into its parts (`&&`, `||`, `;`, `|`); each part's program decides:
 *  - an EDIT: `sed -i`, `perl -i`, a python/node script that writes or rewrites a file (`.write(`, `.replace(`: the
 *    frame's command is cut at 160 characters, so the write itself is often not in it), `tee`, `cat > file`,
 *    `git apply`, `patch`;
 *  - the TESTS: a test runner as the program (`vitest`, `npx jest`, `npm test`, `npm run test:…`, `cargo test`,
 *    `go test`, `pytest`, `python -m pytest`, `make test`, …).
 * An edit anywhere makes the command an edit ("edits are edits"); else a test runner makes it the tests; else it is a
 * plain command (`null`: the tool's kind stands). A mention of `tests/` or `*.test.ts` in an argument is not a test run.
 */
export function commandKind(cmd: string): 'edit' | 'test' | null {
  // (A quoted `|` splits too; a stray fragment is never a runner or an editor in practice.)
  const parts = cmd.split(/&&|\|\||;|\|/u).map((p) => p.trim()).filter((p) => p !== '');
  let tests = false;
  for (const part of parts) {
    const words = part.split(/\s+/u).filter((w) => !/^[A-Za-z_][A-Za-z0-9_]*=/u.test(w));
    while (words.length > 0 && /^(?:env|time|timeout|nice|command|exec|sudo|\d+[smh]?)$/u.test(words[0]!)) words.shift();
    const prog = (words[0] ?? '').replace(/^.*\//u, '');
    const rest = words.slice(1);
    if (prog === 'cd' || prog === '') continue;
    if (prog === 'sed' && rest.some((w) => /^-[a-zA-Z]*i/u.test(w) || w === '--in-place' || w.startsWith('--in-place='))) return 'edit';
    if (prog === 'perl' && rest.some((w) => /^-[a-zA-Z]*i/u.test(w))) return 'edit';
    if (prog === 'tee' || prog === 'patch' || prog === 'apply_patch' || (prog === 'git' && rest[0] === 'apply')) return 'edit';
    // A script's body may hold a `;` or a `|`: read it from its program to the end.
    if (/^(?:python[0-9.]*|node|ruby|deno|bun)$/u.test(prog) && /\.write(?:_text|FileSync|File)?\(|writeFileSync|open\([^)]*,\s*['"][wa]|\.replace\(/u.test(cmd.slice(Math.max(0, cmd.indexOf(part))))) return 'edit';
    if (/(?:^|\s)>>?\s*(?!\/dev\/null|&)\S/u.test(part) && /^(?:cat|echo|printf)$/u.test(prog)) return 'edit';
    const sub = rest[0] ?? '';
    const runner = /^(?:vitest|jest|mocha|pytest|rspec|ava|tap|nextest|playwright)$/u.test(prog)
      || (/^(?:npx|pnpx|bunx)$/u.test(prog) && /^(?:vitest|jest|mocha|pytest|playwright|ava|tap)$/u.test(sub))
      || (/^(?:npm|pnpm|yarn|bun)$/u.test(prog) && (sub === 'test' || sub === 't' || (sub === 'run' && /^test(?::|$)/u.test(rest[1] ?? '')) || /^test:/u.test(sub)))
      || (prog === 'cargo' && (sub === 'test' || sub === 'nextest'))
      || (prog === 'go' && sub === 'test')
      || (/^python[0-9.]*$/u.test(prog) && sub === '-m' && /^(?:pytest|unittest)$/u.test(rest[1] ?? ''))
      || (prog === 'make' && /^test/u.test(sub));
    if (runner) tests = true;
  }
  return tests ? 'test' : null;
}

/** The file a shell edit names, when it does: a script's `p='src/x.ts'` or `open('src/x.ts')`, `sed -i`'s last word. */
export function editedPath(cmd: string): string | null {
  const named = /\b(?:p|path|f|file)\s*=\s*['"]([^'"\s]+\.[A-Za-z0-9]+)['"]/u.exec(cmd) ?? /open\(\s*['"]([^'"\s]+)['"]/u.exec(cmd);
  if (named !== null) return named[1]!;
  const sed = /\bsed\s+(?:-[a-zA-Z]*i\S*|--in-place\S*)\s.*?\s([^\s'"|;&<>]+\.[A-Za-z0-9]+)\s*(?:$|&&|;|\|)/u.exec(cmd);
  return sed !== null ? sed[1]! : null;
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

/**
 * One orchestrator turn. A turn's number restarts at 1 on every attempt of the build (a retry after a failed floor or a
 * review sent back is attempt 1, 2, …), so a turn is its number AND its attempt (retime 0.16.11: retry turn a2's live
 * list was empty because attempt 0's turn 1 had ended, and turn a1's summary was a copy of a0's). `attempt: null` (an
 * engine that sends none) means the newest turn with that number.
 */
export interface TurnRef { turn: number; attempt: number | null }

const refOf = (t: number | TurnRef | null): TurnRef | null => (t === null ? null : typeof t === 'number' ? { turn: t, attempt: null } : t);
const sameTurn = (e: Ev, t: TurnRef): boolean => e.turn === t.turn && (t.attempt === null || e.attempt === undefined || e.attempt === t.attempt);

/** Where one turn's frames are in the log: from its (newest) start to its end, `end` null while it runs. */
function turnSpan(list: readonly Ev[], ord: number, t: TurnRef): { from: number; end: number | null } | null {
  let from = -1;
  for (let i = list.length - 1; i >= 0; i--) {
    const e = list[i]!;
    if (e.ord === ord && e.type === 'powerTurnStarted' && sameTurn(e, t)) { from = i; break; }
  }
  if (from < 0) return null;
  for (let i = from + 1; i < list.length; i++) {
    const e = list[i]!;
    if (e.ord === ord && e.type === 'powerTurnCompleted' && sameTurn(e, t)) return { from, end: i };
  }
  return { from, end: null };
}

/** The frames of one step's newest attempt (from its last dispatch), or of one orchestrator turn when `turn` is set. */
function scoped(events: readonly CoreEvent[], ord: number, turn: TurnRef | null): Ev[] {
  const list = events as readonly Ev[];
  let from = 0;
  let to = list.length;
  if (turn === null) {
    for (let i = 0; i < list.length; i++) if (list[i]!.ord === ord && list[i]!.type === 'unitDispatched') from = i;
  } else {
    const span = turnSpan(list, ord, turn);
    if (span === null) return [];
    from = span.from;
    if (span.end !== null) to = span.end + 1;
  }
  return list.slice(from, to).filter((e) => e.ord === ord);
}

/** The activity rows of a step (or a turn), oldest first: a started tool call and its finish are one row. */
export function activityRows(events: readonly CoreEvent[] | null | undefined, ord: number, turn: number | TurnRef | null = null): LiveRow[] {
  const out: LiveRow[] = [];
  const byCall = new Map<string, number>();
  let n = 0;
  for (const e of scoped(events ?? [], ord, refOf(turn))) {
    n += 1;
    if (e.type === 'toolActivity') {
      const tool = str(e.tool);
      const target = str(e.target);
      let kind = (typeof e.kind === 'string' ? e.kind : toolKind(tool)) as ActivityKind;
      // A shell command is what it does: classified from the command itself, whatever kind the frame guessed.
      let shown = target;
      if ((kind === 'run' || kind === 'test') && target !== null) {
        kind = commandKind(target) ?? 'run';
        // A shell edit says the file it edits when the command names it, else the command.
        if (kind === 'edit') shown = editedPath(target) ?? `\`${short(target, 80)}\``;
      }
      const running = e.state === 'started';
      const ok = typeof e.ok === 'boolean' ? e.ok : null;
      const id = str(e.id);
      const row: LiveRow = { key: id !== null ? `t:${id}` : `t#${n}`, at: timeOf(e), kind, text: rowWords(kind, shown, running, ok, tool), running, ok, doneAt: running ? null : timeOf(e) };
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
      out.push({ key: `p#${n}`, at: timeOf(e), kind: k, text, running: false, ok: null, doneAt: timeOf(e) });
    }
  }
  return out;
}

/** The orchestrator's turn running now at this unit (the newest started turn), or null for a step with no turns: the
 *  live list of a power build shows that turn's activity, not the whole build's. */
export function currentTurn(events: readonly CoreEvent[] | null | undefined, ord: number): TurnRef | null {
  const list = (events ?? []) as readonly Ev[];
  for (let i = list.length - 1; i >= 0; i--) {
    const e = list[i]!;
    if (e.ord === ord && e.type === 'unitDispatched') return null;
    if (e.ord === ord && e.type === 'powerTurnStarted' && typeof e.turn === 'number') return { turn: e.turn, attempt: typeof e.attempt === 'number' ? e.attempt : null };
  }
  return null;
}

/** When the turn ended (its message carries the summary line), or null while it runs. */
export function turnEndedAt(events: readonly CoreEvent[] | null | undefined, ord: number, turn: number | TurnRef): number | null {
  const list = (events ?? []) as readonly Ev[];
  const span = turnSpan(list, ord, refOf(turn)!);
  if (span === null || span.end === null) return null;
  return timeOf(list[span.end]!) ?? 0;
}

/** The turn has ended. */
export function turnEnded(events: readonly CoreEvent[] | null | undefined, ord: number, turn: number | TurnRef): boolean {
  return turnEndedAt(events, ord, turn) !== null;
}

/** How long a finished call stays in the live list after its turn ended (retime 0.16.11: a 39 s call fell between two
 *  looks 15 s apart). */
export const KEEP_FINISHED_MS = 60_000;

/** The rows the live list shows: all of a running turn's (the list keeps its newest few), and once the turn ended the
 *  calls that finished in the last {@link KEEP_FINISHED_MS}, until none is left. */
export function visibleRows(rows: readonly LiveRow[], endedAt: number | null, now: number): LiveRow[] {
  if (endedAt === null) return [...rows];
  return rows.filter((r) => now - (r.doneAt ?? endedAt) < KEEP_FINISHED_MS);
}

/** The tool calls the gate judged for a step (or turn): what the summary counts when no `toolActivity` came. */
function judgedTools(events: readonly CoreEvent[] | null | undefined, ord: number, turn: number | TurnRef | null): ActivityKind[] {
  return scoped(events ?? [], ord, refOf(turn)).filter((e) => e.type === 'governanceHookFired' && e.decision !== 'deny').map((e) => toolKind(str(e.toolName)));
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/**
 * One line for a finished step or turn: "Read 4 files · ran 7 commands · ran the tests twice · edited 3 files · 2
 * commits". Null when nothing was recorded.
 */
export function activitySummary(events: readonly CoreEvent[] | null | undefined, ord: number, turn: number | TurnRef | null = null): string | null {
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
