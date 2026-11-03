/**
 * Data sources as live knowledge for agents (DES-APPS-001 rev 12 §5.4; crew api-types 0.181.0): the calls
 * the source sheet's "Agents" box and a job's gate cards make.
 *
 * - `setAgentAccess` is the agent switches' own call: `AgentAccess` is its only caller
 *   (`tests/sourcesHumanOnly.test.ts` pins that), so no URL, palette verb, plugin request or chat path can
 *   reach it. crew refuses it to anything but a human operator, too.
 * - `agentQueries` and `runDataUse` only read crew's agent-query record: never the SQL, never a value.
 *
 * The shapes are mirrored from `wicked-crew-api-types` 0.181.0 until studio pins it (then this mirror goes).
 */

import { apiFetch } from './client.js';

/** (api-types 0.181.0) Which agents may use a `sql`/`graphql` source. */
export interface SourceAgentAccess {
  /** "Agents can see this structure": on for a new source. */
  see: boolean;
  /** "Agents can query this source": off for a new source; SQL sources only; needs `see`. */
  query: boolean;
  /** The projects whose runs and chats may use it. None on a new source. */
  projects: string[];
  /** Every project on this daemon (and runs or chats in none): an explicit choice. */
  everyProject: boolean;
}

export interface SourceAgentAccessBody {
  see?: boolean;
  query?: boolean;
  projects?: string[];
  everyProject?: boolean;
}

export interface SourceAgentAccessResponse {
  name: string;
  agents: SourceAgentAccess;
}

export interface SourceAgentQuery {
  callId: string;
  at: string;
  runId: string;
  unit: number;
  attempt: number;
  seat: string;
  source: string;
  sqlHash: string;
  /** `ok` = rows reached the agent; otherwise crew's refusal code. */
  outcome: string;
  rows: number;
  truncated: boolean;
  ms: number;
  released: boolean;
  sqlstate?: string;
}

export interface SourceAgentQueriesResponse {
  name: string;
  /** false = crew's record could not be read (unknown, not "none"). */
  known: boolean;
  queries: SourceAgentQuery[];
}

export interface SourceDataUse {
  source: string;
  queries: number;
  released: number;
  rows: number;
  truncated: boolean;
  lastAt: string;
}

export interface RunDataUseResponse {
  runId: string;
  known: boolean;
  sources: SourceDataUse[];
}

/** What a source without the field (a crew before 0.181.0) reads as: nothing reaches an agent. */
export const AGENTS_NONE: SourceAgentAccess = { see: true, query: false, projects: [], everyProject: false };

const at = (name: string, rest: string): string => `/sources/${encodeURIComponent(name)}/${rest}`;

export const sourceAgentsApi = {
  /** The agent switches and projects. Human operator only (crew answers 403 to anything else). */
  setAgentAccess: (name: string, body: SourceAgentAccessBody) =>
    apiFetch<SourceAgentAccessResponse>(at(name, 'agents'), { method: 'PUT', body: JSON.stringify(body) }),
  /** The source's last 20 agent queries, newest first. */
  agentQueries: (name: string) => apiFetch<SourceAgentQueriesResponse>(at(name, 'agent-queries')),
  /** The data sources a job's agents queried. */
  runDataUse: (runId: string) => apiFetch<RunDataUseResponse>(`/runs/${encodeURIComponent(runId)}/data-use`),
  /** The active projects, for the projects a source's agents may use (id and name only). */
  projects: () => apiFetch<{ projects: Array<{ id: string; name: string }> }>('/projects?status=active'),
};

/** A source's agent controls from its registry view (`McpServer.agents`, api-types 0.181.0), or the defaults. */
export function agentAccessOf(server: { agents?: unknown } | null | undefined): SourceAgentAccess {
  const a = (server?.agents ?? null) as Partial<SourceAgentAccess> | null;
  if (a === null || typeof a !== 'object') return AGENTS_NONE;
  const see = a.see !== false;
  return {
    see,
    query: see && a.query === true,
    projects: Array.isArray(a.projects) ? a.projects.filter((p): p is string => typeof p === 'string') : [],
    everyProject: a.everyProject === true,
  };
}

/** One line for a job's data use: "support-pg · 3 queries · 12 rows". */
export function dataUseWords(u: SourceDataUse): string {
  return `${u.source} · ${u.queries} quer${u.queries === 1 ? 'y' : 'ies'} · ${u.rows} row${u.rows === 1 ? '' : 's'}${u.truncated ? ' (cut at the cap)' : ''}`;
}
