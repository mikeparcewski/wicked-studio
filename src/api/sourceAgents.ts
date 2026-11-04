/**
 * A live source's agent switches and its agent-read record (DES-KNOWLEDGE-DATA-001 §7.1, §7.9; crew api-types
 * 0.183.0/0.184.0, mirrored in `sourceAgents-wire.ts`): the calls the source sheet's Agents box and a job's gate
 * cards make, and the defensive readers for their answers.
 *
 * - `setAgentAccess` is the switches' own call: `AgentAccess` is its only caller (`tests/sourceAgentsHumanOnly.test.ts`
 *   pins that), so no URL, palette verb, plugin request or chat path can reach it. crew refuses it to anything but a
 *   human operator, too (403 `agents_switch_human_only`).
 * - `agentQueries` and `runDataUse` only read crew's agent-read record: never the SQL, never a value.
 * - The shapes are not published yet, so every answer goes through a reader here that returns `null` (or drops an
 *   entry) for anything that is not crew's shape, rather than trusting the type.
 */

import { apiFetch } from './client.js';
import { ApiError } from './errors.js';
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
  /** The source's last 20 agent reads, newest first. */
  agentQueries: (name: string) => apiFetch<unknown>(at(name, 'agent-queries')),
  /** The data sources a job's agents read. */
  runDataUse: (runId: string) => apiFetch<unknown>(`/runs/${encodeURIComponent(runId)}/data-use`),
  /** The active projects, for the projects a source's agents may use (id and name only). */
  projects: () => apiFetch<unknown>('/projects?status=active'),
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/**
 * A data source's agent switches from its registry record (`McpServer.agents`), or `null` when the record carries
 * none, or none crew could have sent: then the sheet shows no Agents box at all (a crew before api-types 0.183.0
 * sends no field). crew fills every default in, so `see` and `query` must both be booleans. Query never outlives see.
 */
export function agentAccessOf(server: { agents?: unknown } | null | undefined): SourceAgentAccess | null {
  const a = server?.agents;
  if (!isObj(a) || typeof a.see !== 'boolean' || typeof a.query !== 'boolean') return null;
  return {
    see: a.see,
    query: a.see && a.query,
    projects: Array.isArray(a.projects) ? [...new Set(a.projects.filter((p): p is string => typeof p === 'string' && p !== ''))] : [],
    everyProject: a.everyProject === true,
  };
}

/** The switches a `PUT /sources/:name/agents` answered for `name`, or `null` when the answer is not that. */
export function agentAccessAnswer(r: unknown, name: string): SourceAgentAccess | null {
  if (!isObj(r) || r.name !== name) return null;
  return agentAccessOf({ agents: r.agents });
}

/** A source's recent agent reads, or `'unknown'` when crew could not read its record (or answered for another source). */
export function agentQueriesOf(r: unknown, name: string): SourceAgentQuery[] | 'unknown' {
  if (!isObj(r) || r.name !== name || r.known !== true || !Array.isArray(r.queries)) return 'unknown';
  return (r.queries as unknown[]).filter((q): q is SourceAgentQuery =>
    isObj(q) && typeof q.callId === 'string' && typeof q.at === 'string' && typeof q.runId === 'string' && typeof q.seat === 'string'
    && typeof q.outcome === 'string' && isCount(q.rows) && typeof q.released === 'boolean');
}

/** A job's data use for `runId`, or `null` when the answer is not crew's for that run (then nothing shows). */
export function runDataUseOf(r: unknown, runId: string): RunDataUseResponse | null {
  if (!isObj(r) || r.runId !== runId || typeof r.known !== 'boolean' || !Array.isArray(r.sources)) return null;
  const sources = (r.sources as unknown[]).filter((s): s is SourceDataUse =>
    isObj(s) && typeof s.source === 'string' && isCount(s.queries) && isCount(s.released) && isCount(s.rows));
  return { runId, known: r.known, sources: sources.map((s) => ({ ...s, truncated: s.truncated === true })) };
}

/** The active projects a source's agents may be given, without crew's synthesized "Unfiled" (`default`). */
export function projectsOf(r: unknown): Array<{ id: string; name: string }> {
  if (!isObj(r) || !Array.isArray(r.projects)) return [];
  return (r.projects as unknown[])
    .filter((p): p is { id: string; name: string } => isObj(p) && typeof p.id === 'string' && typeof p.name === 'string')
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
 * What a refused switch change says, in plain words. Every refusal changed nothing at crew, so each says so; the
 * codes are crew's (`knowledge/gate/routes.ts`): 403 `agents_switch_human_only`, 409 `see_off`, 404
 * `unknown_server`, 400 `not_a_source`/`bad_request`, 503 `registry_unavailable`/`registry_corrupt`.
 */
export function agentSwitchRefusal(e: unknown): string {
  const code = refusalCode(e);
  const status = e instanceof ApiError ? e.status : null;
  if (code === 'agents_switch_human_only' || (status === 403 && code === null)) {
    return 'Only a person signed in as an operator can change what agents may do with a source. Nothing changed.';
  }
  if (code === 'see_off') return 'Agents can query only a source whose structure they can see. Turn on “Agents can see this structure” first. Nothing changed.';
  if (code === 'unknown_server') return 'This source is no longer registered with crew. Nothing changed.';
  if (code === 'not_a_source') return 'crew doesn’t offer this source to agents, so it has no agent switches. Nothing changed.';
  if (code === 'registry_unavailable' || code === 'registry_corrupt' || status === 503) {
    return 'crew couldn’t read its source registry just now, so nothing changed. Try again in a moment.';
  }
  if (e instanceof ApiError) return `${e.message.charAt(0).toUpperCase()}${e.message.slice(1)}. Nothing changed.`;
  return 'crew didn’t answer, so the change may or may not have been made: the switches are read again from crew.';
}

/** Whether a refused change means the shown switches are older than crew's (so the page reads them again). */
export function agentSwitchRereads(e: unknown): boolean {
  if (!(e instanceof ApiError)) return true; // no answer: crew may have made the change
  const code = refusalCode(e);
  return code === 'see_off' || code === 'unknown_server' || code === 'not_a_source';
}

/**
 * THE SEQUENCE GUARD for the agent switches (DES-KNOWLEDGE-DATA-001 §19 B5: a late answer never undoes a newer
 * switch). Per source, the newest write this tab sent. A write's answer is applied only while it is still the newest
 * for its source; an older one (a sheet closed and opened again while its write ran, then switched again) is dropped,
 * and the page reads crew's state afresh instead. Module state, so every sheet instance shares it.
 */
const newestWrite = new Map<string, number>();
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
};
