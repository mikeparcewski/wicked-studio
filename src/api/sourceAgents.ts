/**
 * A live source's agent switches and its agent-read record (DES-KNOWLEDGE-DATA-001 §7.1, §7.9; crew api-types
 * 0.183.0/0.184.0, mirrored in `sourceAgents-wire.ts`): the calls the source sheet's Agents box and a job's gate
 * cards make, and the defensive readers for their answers.
 *
 * - `setAgentAccess` is the switches' own call: `AgentAccess` is its only caller (`tests/sourceAgentsHumanOnly.test.ts`
 *   pins that), so no URL, palette verb, plugin request or chat path can reach it. crew refuses it to anything but a
 *   human operator, too (403 `agents_switch_human_only`).
 * - `agentQueries` and `runDataUse` only read crew's agent-read record: never the SQL, never a value.
 * - The shapes are not published yet, so every answer goes through a reader here rather than trusting the type: the
 *   switches read as `null` (no box) unless they are crew's whole shape; a recent-query or data-use record that is
 *   not crew's whole answer reads as UNKNOWN, never as a shorter list or "none". Only the project picker drops entries.
 */

import { apiFetch } from './client.js';
import { ApiError, isRouteAbsent } from './errors.js';
import type {
  RunDataUseResponse,
  SourceAgentAccess,
  SourceAgentAccessBody,
  SourceAgentQuery,
  SourceDataUse,
} from './sourceAgents-wire.js';

export type { RunDataUseResponse, SourceAgentAccess, SourceAgentAccessBody, SourceAgentQuery, SourceDataUse } from './sourceAgents-wire.js';

const at = (name: string, rest: string): string => `/sources/${encodeURIComponent(name)}/${rest}`;

export const sourceAgentsApi = {
  /** The agent switches and projects. Human operator only (crew answers 403 to anything else). */
  setAgentAccess: (name: string, body: SourceAgentAccessBody) =>
    apiFetch<unknown>(at(name, 'agents'), { method: 'PUT', body: JSON.stringify(body) }),
  /** The source's recent agent reads (crew answers its last 20, newest first; studio shows them in crew's order). */
  agentQueries: (name: string) => apiFetch<unknown>(at(name, 'agent-queries')),
  /** The data sources a job's agents read. */
  runDataUse: (runId: string) => apiFetch<unknown>(`/runs/${encodeURIComponent(runId)}/data-use`),
  /** The active projects, for the projects a source's agents may use (id and name only). */
  projects: () => apiFetch<unknown>('/projects?status=active'),
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === 'string' && v !== '';
/** A whole, non-negative count, as crew's record keeps them. */
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
/** crew's outcome codes (`ok`, `not_select`, `query_off`, `deadline`, …): a code, never free text. */
const isCode = (v: unknown): v is string => typeof v === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(v);

/** At most this many projects per source (crew's `AGENT_PROJECTS_MAX`). */
export const AGENT_PROJECTS_MAX = 64;

/**
 * A data source's agent switches from its registry record (`McpServer.agents`), or `null` when the record carries
 * none, or none crew could have sent: then the sheet shows no Agents box at all (a crew before api-types 0.183.0
 * sends no field). crew fills every default in and never lets query outlive see, so anything short of four
 * well-typed fields, or query on with see off, is not crew's answer and is never shown as a switch.
 */
export function agentAccessOf(server: { agents?: unknown } | null | undefined): SourceAgentAccess | null {
  const a = server?.agents;
  if (!isObj(a) || typeof a.see !== 'boolean' || typeof a.query !== 'boolean' || typeof a.everyProject !== 'boolean') return null;
  if (!Array.isArray(a.projects) || !a.projects.every(isText) || a.projects.length > AGENT_PROJECTS_MAX) return null;
  if (a.query && !a.see) return null;
  return { see: a.see, query: a.query, projects: [...new Set(a.projects as string[])], everyProject: a.everyProject };
}

/** The switches a `PUT /sources/:name/agents` answered for `name`, or `null` when the answer is not that. */
export function agentAccessAnswer(r: unknown, name: string): SourceAgentAccess | null {
  if (!isObj(r) || r.name !== name) return null;
  return agentAccessOf({ agents: r.agents });
}

/**
 * A source's recent agent reads (only the fields studio shows), or `'unknown'` when crew could not read its record,
 * answered for another source, or sent any entry that is not crew's (an entry for another source included): a record
 * studio can't read whole is never shown as a shorter history, nor as "none".
 */
export function agentQueriesOf(r: unknown, name: string): SourceAgentQuery[] | 'unknown' {
  if (!isObj(r) || r.name !== name || r.known !== true || !Array.isArray(r.queries)) return 'unknown';
  const out: SourceAgentQuery[] = [];
  for (const q of r.queries as unknown[]) {
    // Every field crew's record writes (B2 `knowledge/gate/record.ts`), each well typed, for THIS source.
    if (!isObj(q) || q.source !== name || !isText(q.callId) || !isText(q.at) || !isText(q.runId) || !isInt(q.unit) || !isInt(q.attempt)
      || typeof q.seat !== 'string' || typeof q.sourceId !== 'string' || typeof q.sqlHash !== 'string' || !isCode(q.outcome)
      || !isInt(q.rows) || typeof q.truncated !== 'boolean' || !isInt(q.ms) || typeof q.released !== 'boolean') return 'unknown';
    out.push({
      callId: q.callId, at: q.at, runId: q.runId, unit: q.unit, attempt: q.attempt, seat: q.seat, source: name, sourceId: q.sourceId,
      // Never kept: studio shows no SQL, and no hash of it either.
      sqlHash: '', outcome: q.outcome, rows: q.rows, truncated: q.truncated, ms: q.ms, released: q.released,
    });
  }
  return out;
}

/**
 * A job's data use for `runId` (only the fields studio shows). Anything that is not crew's whole answer for THIS run
 * (another run's, an entry with a field missing or mistyped, or counts crew's record can't produce: no query, more
 * releases than queries, rows or a cap with nothing released) reads as UNKNOWN (`known: false`), never as "none" or as
 * a shorter list.
 */
export function runDataUseOf(r: unknown, runId: string): RunDataUseResponse {
  const unknown: RunDataUseResponse = { runId, known: false, sources: [] };
  if (!isObj(r) || r.runId !== runId || typeof r.known !== 'boolean' || !Array.isArray(r.sources)) return unknown;
  if (!r.known) return unknown;
  const sources: SourceDataUse[] = [];
  for (const s of r.sources as unknown[]) {
    if (!isObj(s) || !isText(s.source) || !isInt(s.queries) || !isInt(s.released) || !isInt(s.rows) || typeof s.truncated !== 'boolean' || !isText(s.lastAt)) return unknown;
    if (s.queries < 1 || s.released > s.queries || (s.released === 0 && (s.rows > 0 || s.truncated))) return unknown;
    sources.push({ source: s.source, queries: s.queries, released: s.released, rows: s.rows, truncated: s.truncated, lastAt: s.lastAt });
  }
  return { runId, known: true, sources };
}

/** The active projects a source's agents may be given, without crew's synthesized "Unfiled" (`default`). */
export function projectsOf(r: unknown): Array<{ id: string; name: string }> {
  if (!isObj(r) || !Array.isArray(r.projects)) return [];
  return (r.projects as unknown[])
    .filter((p): p is { id: string; name: string } => isObj(p) && isText(p.id) && typeof p.name === 'string')
    // "Unfiled" is no project a job is filed into: "Every project" covers jobs and chats in none.
    .filter((p) => p.id !== 'default')
    .map((p) => ({ id: p.id, name: p.name }));
}

/** One line for a job's data use: "support-pg · 3 queries · 12 rows". */
export function dataUseWords(u: SourceDataUse): string {
  return `${u.source} · ${u.queries} quer${u.queries === 1 ? 'y' : 'ies'} · ${u.rows} row${u.rows === 1 ? '' : 's'}${u.truncated ? ' (cut at the cap)' : ''}`;
}

/** crew's refusal code, when the error is a refusal that names one. */
export function refusalCode(e: unknown): string | null {
  const c = e instanceof ApiError && isObj(e.body) ? e.body.code : undefined;
  return typeof c === 'string' ? c : null;
}

/**
 * What a refused switch change says, in plain words. Only crew's own named refusals (`knowledge/gate/routes.ts`:
 * 403 `agents_switch_human_only`, 409 `see_off`, 404 `unknown_server`, 400 `not_a_source`/`bad_request`, 503
 * `registry_unavailable`/`registry_corrupt`) say "Nothing changed": crew answers them before it writes. Anything else
 * (a gateway's 502/504, a dropped connection, an unnamed status) may have landed, so it says so; the page reads
 * crew's switches again after every write either way.
 */
export function agentSwitchRefusal(e: unknown): string {
  // A crew that sends the switches but has no route to change them (B1 without B2): nothing ran.
  if (isRouteAbsent(e)) return 'This crew can’t change agent switches yet: update crew. Nothing changed.';
  const code = refusalCode(e);
  if (code === 'agents_switch_human_only') return 'Only a person signed in as an operator can change what agents may do with a source. Nothing changed.';
  if (code === 'see_off') return 'Agents can query only a source whose structure they can see. Turn on “Agents can see this structure” first. Nothing changed.';
  if (code === 'unknown_server') return 'This source is no longer registered with crew. Nothing changed.';
  if (code === 'not_a_source') return 'crew doesn’t offer this source to agents, so it has no agent switches. Nothing changed.';
  if (code === 'bad_request') return `crew didn’t take that change: a source names at most ${AGENT_PROJECTS_MAX} projects, by their ids. Nothing changed.`;
  if (code === 'registry_unavailable' || code === 'registry_corrupt') return 'crew couldn’t read its source registry just now, so nothing changed. Try again in a moment.';
  return 'crew’s answer didn’t say whether the change was made, so the switches below are read again from crew.';
}

/**
 * THE SEQUENCE GUARD for the agent switches (DES-KNOWLEDGE-DATA-001 §19 B5: a late answer never undoes a newer
 * switch). Per source, the newest write this tab sent. A write's answer is applied only while it is still the newest
 * for its source; an older one (a sheet closed and opened again while its write ran, then switched again) is dropped.
 * Every write that settles, newest or not, answered or refused, tells every subscriber (the Sources page that is
 * mounted NOW, not the one that sent it), which reads crew's switches again: so whatever order crew applied
 * overlapping writes in, the shown switches are crew's after one re-read. Module state, shared by every instance.
 */
const newestWrite = new Map<string, number>();
const settledListeners = new Set<(source: string) => void>();
let writeClock = 0;
export const agentSwitchWrites = {
  /** The ticket of a write about to be sent for `source`: from now on, the newest. */
  take(source: string): number {
    writeClock += 1;
    newestWrite.set(source, writeClock);
    return writeClock;
  },
  /** Whether the write holding `ticket` is still the newest for `source`. */
  isNewest(source: string, ticket: number): boolean {
    return newestWrite.get(source) === ticket;
  },
  /** A write for `source` settled: crew's switches may differ from what any page shows. */
  settled(source: string): void {
    for (const fn of [...settledListeners]) fn(source);
  },
  /** Hear every settled write; returns the unsubscribe. */
  subscribe(fn: (source: string) => void): () => void {
    settledListeners.add(fn);
    return () => { settledListeners.delete(fn); };
  },
};
