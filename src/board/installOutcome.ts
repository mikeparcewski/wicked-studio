import type { SessionView } from '../api/types.js';

/**
 * WHAT AN MCP-SERVER INSTALL DID (studio#1367). The mcp-server job's `install` step runs garden's
 * `scripts/mcp/install.py --from-run --target <choice> --json`, which prints ONE JSON record and exits 0 even when the
 * server was staged but not registered (a token the daemon can't resolve, no daemon to register with) or the CLI
 * configurations were skipped (garden install.py: `register()` returns `registered: false` with `missing`/`remedy`;
 * `do_install` keeps the exit code 0 and sets `clis` to a "skipped: …"/"failed: …" sentence or the installer's rows, and
 * `operatorClis` the same for the person's own CLIs when the target is `operator`; main() prints `{"ok": …, **out}`, or
 * `{"ok": false, "error": …}` when it failed). The run then ends "Finished" whatever happened. This module reads that
 * record off the step's stored output and says what it holds, so a job that registered nothing never reads as a plain Done.
 */

/** One CLI row of the installer's envelope (`wicked-installer mcp upsert --json` → `clis[]`). */
export interface InstallCliRow {
  cli: string;
  result: string;
  detail: string | null;
}

/** The parts of the install record the job's outcome says. */
export interface InstallRecord {
  ok: boolean;
  key: string | null;
  /** `true` saved, `'updated'` saved over the same key, `false` staged but not registered. */
  registered: boolean | 'updated';
  /** How many tools the registry recorded (`registry.tools`), when it registered. */
  tools: number | null;
  /** The token variables the daemon could not resolve (`missing`), when registration is pending on one. */
  missing: string[];
  /** Why it did not register when no token is missing (`reason`, e.g. "no daemon at …"). */
  reason: string | null;
  /** The failure in garden's words (`error`), when the install failed. */
  error: string | null;
  /** `pending_credential` when the smoke could not run the server without its token. */
  smoke: string | null;
  /** The worker CLIs' rows, or the one sentence ("skipped: …", "failed: …"), or null when not said. */
  clis: InstallCliRow[] | string | null;
  /** The person's own CLIs (`--target operator`, "Also install into my CLIs"): the same shape, or null. */
  operatorClis: InstallCliRow[] | string | null;
}

/** The step that installs (not the dry-run plan): its command runs garden's MCP install script. */
export function installUnitOf(view: SessionView): SessionView['units'][number] | null {
  const units = view.units.filter((u) => {
    const cmd = (u.tool_cmd ?? []).join(' ');
    return /scripts\/mcp\/install\.py/.test(cmd) && !/--dry-run\b/.test(cmd) && !/--uninstall\b/.test(cmd);
  });
  return units.at(-1) ?? null;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

function clisOf(raw: unknown): InstallCliRow[] | string | null {
  if (typeof raw === 'string') return raw;
  if (!Array.isArray(raw)) return null;
  return raw.flatMap((row): InstallCliRow[] => {
    const x = row as Record<string, unknown> | null;
    if (x === null || typeof x !== 'object' || typeof x['cli'] !== 'string' || typeof x['result'] !== 'string') return [];
    return [{ cli: x['cli'], result: x['result'], detail: str(x['detail']) }];
  });
}

/** One JSON object as the install record, or null when it is not one: `ok` is a boolean, and either it succeeded with a
 *  key and a registration of `true`/`false`/`'updated'`, or it failed with garden's error. */
function asRecord(r: Record<string, unknown>): InstallRecord | null {
  if (typeof r['ok'] !== 'boolean') return null;
  const reg = r['registered'];
  if (r['ok'] === true && (str(r['key']) === null || !(reg === true || reg === false || reg === 'updated'))) return null;
  if (r['ok'] === false && str(r['error']) === null) return null;
  const registry = r['registry'] !== null && typeof r['registry'] === 'object' ? (r['registry'] as Record<string, unknown>) : null;
  return {
    ok: r['ok'],
    key: str(r['key']),
    registered: reg === 'updated' ? 'updated' : reg === true,
    tools: registry !== null && typeof registry['tools'] === 'number' ? registry['tools'] : null,
    missing: Array.isArray(r['missing']) ? r['missing'].filter((m): m is string => typeof m === 'string' && m !== '') : [],
    reason: str(r['reason']),
    error: str(r['error']),
    smoke: str(r['smoke']),
    clis: clisOf(r['clis']),
    operatorClis: clisOf(r['operatorClis']),
  };
}

/** The record in the step's output: its last line that is the install's JSON record; null when there is none. */
export function installRecordOf(output: string | null | undefined): InstallRecord | null {
  const lines = (output ?? '').split('\n').map((l) => l.trim()).filter((l) => l.startsWith('{') && l.endsWith('}'));
  for (let i = lines.length - 1; i >= 0; i--) {
    let o: unknown;
    try { o = JSON.parse(lines[i]!); } catch { continue; }
    if (o === null || typeof o !== 'object' || Array.isArray(o)) continue;
    const rec = asRecord(o as Record<string, unknown>);
    if (rec !== null) return rec;
  }
  return null;
}

const CLI_NAMES: Readonly<Record<string, string>> = {
  claude: 'Claude Code', codex: 'Codex', opencode: 'OpenCode', antigravity: 'Antigravity', gemini: 'Antigravity', pi: 'Pi',
};
const cliName = (k: string): string => CLI_NAMES[k] ?? k;
const list = (xs: readonly string[]): string => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)!}`);
/** A sentence ends with one stop, whatever the quoted words ended with. */
const sentence = (s: string): string => (/[.!?]$/.test(s) ? s : `${s}.`);
/** Results that mean the CLI's configuration holds the server now. */
const ADDED = new Set(['written', 'unchanged', 'updated', 'ok']);

/** What the install says, in plain words: the headline, the registration, and the CLI configurations. */
export interface InstallWords {
  /** Whether the server is usable from MCP tools now (registered or updated). */
  registered: boolean;
  /** "Installed and registered in MCP tools: 2 tools." / "Installed, but not registered in MCP tools: …". */
  line: string;
  /** What to do next, when something is left for the person (a token to add, the install to run again). */
  todo: string | null;
  /** What happened to the helpers' CLI configurations (and the person's own, when chosen), when the record says. */
  clis: string[];
  /** The installer's own words behind a CLI sentence, for Technical details. */
  detail: string[];
}

export function installWords(r: InstallRecord): InstallWords {
  const tools = r.tools !== null ? `${r.tools} ${r.tools === 1 ? 'tool' : 'tools'}` : null;
  let line: string;
  let todo: string | null = null;
  const registered = r.ok && r.registered !== false;
  if (!r.ok) {
    line = sentence(`The install failed${r.error !== null ? `: ${r.error}` : ''}`);
    todo = 'Fix what it names, then run the job again.';
  } else if (r.registered === 'updated') {
    line = `Installed and updated in MCP tools${tools !== null ? `: ${tools}` : ''}.`;
  } else if (r.registered === true) {
    line = `Installed and registered in MCP tools${tools !== null ? `: ${tools}` : ''}.`;
  } else if (r.missing.length > 0) {
    line = `Installed, but not registered in MCP tools: it needs ${list(r.missing)}, which the daemon can’t find.`;
    todo = `Add the server in MCP tools with Add existing and give it the token (it is kept in your keychain), or set ${list(r.missing)} in the daemon’s environment and run the install again.`;
  } else {
    line = sentence(`Installed, but not registered in MCP tools${r.reason !== null ? ` (${r.reason.replace(/[.]$/, '')})` : ''}`);
    todo = r.reason !== null && /^no daemon\b/i.test(r.reason)
      ? 'Start the daemon, then run the install again, or add the server in MCP tools with Add existing.'
      : 'Run the install again, or add the server in MCP tools with Add existing.';
  }
  if (r.ok && r.smoke === 'pending_credential') todo = `It couldn’t be tried without its token. ${todo ?? ''}`.trim();
  const worker = clisWords(r.clis, 'the helpers’');
  const own = clisWords(r.operatorClis, 'your own');
  return {
    registered, line, todo,
    clis: [worker, own].flatMap((w) => (w === null ? [] : [w.line])),
    detail: [worker, own].flatMap((w) => (w?.detail == null ? [] : [w.detail])),
  };
}

/** "Added to Claude Code and Codex. Not added to Pi (no MCP target)." / "… CLI configurations were not updated …". */
export function clisWords(clis: InstallRecord['clis'], whose = 'the helpers’'): { line: string; detail: string | null } | null {
  if (clis === null) return null;
  const Whose = whose.charAt(0).toUpperCase() + whose.slice(1);
  if (typeof clis === 'string') {
    const raw = clis.trim();
    if (/^skipped:\s*--cli none$/i.test(raw)) return null;
    const why = raw.replace(/^(skipped|failed):\s*/i, '');
    const update = /wicked-installer/i.test(why) ? ' Update wicked-installer, then run the install again.' : ' Run the install again.';
    return { line: `${Whose} CLI configurations were not updated, so those CLIs can’t use it yet.${update}`, detail: why !== '' ? why : null };
  }
  const added = [...new Set(clis.filter((c) => ADDED.has(c.result)).map((c) => cliName(c.cli)))];
  const left = clis.filter((c) => !ADDED.has(c.result));
  const parts: string[] = [];
  if (added.length > 0) parts.push(`Added to ${whose === 'the helpers’' ? '' : 'your own '}${list(added)}.`);
  if (left.length > 0) {
    const why = (c: InstallCliRow): string => (c.detail ?? c.result).replace(/^(unsupported|skipped|failed):\s*/i, '').replace(/[.]$/, '');
    parts.push(`Not added to ${whose === 'the helpers’' ? '' : 'your own '}${list(left.map((c) => `${cliName(c.cli)} (${why(c)})`))}.`);
  }
  return parts.length > 0 ? { line: parts.join(' '), detail: null } : null;
}

/**
 * studio#1364: the run was ended by a Decline at a consent gate (a `consent_before` step that had not run: the
 * MCP-server install, which asks after the pull request is delivered). The engine cancels the run on any gate's reject,
 * so it reads "Cancelled"; this says what really happened: the step was declined and did not run. `install` when the
 * declined step is the MCP install. Null for any other end (a Stop, another gate's reject, a reject after the step ran),
 * or when the audit names no gate.
 */
export function consentDeclineOf(
  view: SessionView,
  story: { rejected?: { ord: number | null } | null; stop: { reason: string | null; byPerson: boolean } | null } | null,
): { install: boolean; ord: number } | null {
  if (view.session.status !== 'cancelled' || story === null) return null;
  const ord = story.rejected?.ord ?? null;
  if (ord === null) return null;
  if (story.stop !== null && (story.stop.byPerson || story.stop.reason !== null)) return null;
  const unit = view.units.find((u) => u.ord === ord);
  if (unit === undefined || unit.gate !== 'consent_before') return null;
  // A consent gate opens BEFORE its step runs; a step that ran (done, or refused by its checks) was answered at another
  // gate on the same step, after the consent.
  if (unit.status === 'done' || unit.status === 'rejected') return null;
  return { install: installUnitOf(view)?.ord === ord, ord };
}
