/**
 * A live source's agent switches and its agent-read record (DES-KNOWLEDGE-DATA-001 §7.1, §7.9): the wire of
 * `PUT /sources/:name/agents`, `GET /sources/:name/agent-queries` and `GET /runs/:id/data-use`, and the
 * `agents` field a data source carries in `GET /mcp/servers` (the full, human view).
 *
 * A VERBATIM mirror of the contract blocks in `wicked-crew-api-types` 0.183.0 (`McpSourceAgents`,
 * `McpServer.agents`) and 0.184.0 (`SourceAgentAccessBody`, `SourceAgentAccessResponse`, `SourceAgentQuery`,
 * `SourceAgentQueriesResponse`, `SourceDataUse`, `RunDataUseResponse`) while studio's pin (0.175.0) lags them.
 * Neither is published yet, so `src/api/sourceAgents.ts` reads every answer defensively and never trusts these
 * shapes to hold.
 *
 * TODO(api-types >= 0.184.0): once studio pins `wicked-crew-api-types` 0.184.0 or later, these become
 * re-exports from the package (as `skills-wire.ts` did), and this mirror goes.
 */

/**
 * (0.183.0) A data source's agent switches: `see` (on by default), `query` (off by default; needs `see`),
 * `projects` (none by default) and `everyProject` (an explicit choice). Set by a human operator only.
 */
export interface McpSourceAgents {
  see: boolean;
  query: boolean;
  projects: string[];
  everyProject: boolean;
}

/** (0.184.0) The switches as `PUT /sources/:name/agents` answers them. */
export type SourceAgentAccess = McpSourceAgents;

/** (0.184.0) `PUT /sources/:name/agents` (human operator only; each change audited). At least one field. */
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

/** (0.184.0) One agent read of a source, as crew recorded it: never the SQL, a value or a source's words. */
export interface SourceAgentQuery {
  /** The broker call's id. */
  callId: string;
  at: string;
  runId: string;
  unit: number;
  attempt: number;
  seat: string;
  source: string;
  /** The source's registry id. */
  sourceId: string;
  /** sha256 of the SQL text, hex. */
  sqlHash: string;
  /** `ok` (rows released), or crew's code (a read-policy code, `query_off`, `deadline`, `too_large`, `busy`, `changed_while_running`, …). */
  outcome: string;
  rows: number;
  truncated: boolean;
  ms: number;
  /** Whether rows were released to the agent's answer (it may over-state, never under-state). */
  released: boolean;
  sqlstate?: string;
}

/** (0.184.0) `GET /sources/:name/agent-queries` (observer): the last 20, newest first. `known: false` = unreadable. */
export interface SourceAgentQueriesResponse {
  name: string;
  known: boolean;
  queries: SourceAgentQuery[];
}

/** (0.184.0) One source a run's agents read. */
export interface SourceDataUse {
  source: string;
  /** Calls that reached the read policy. */
  queries: number;
  /** Calls whose rows reached the agent. */
  released: number;
  rows: number;
  truncated: boolean;
  lastAt: string;
}

/** (0.184.0) `GET /runs/:id/data-use` (observer). `known: false` = UNKNOWN, never "none". */
export interface RunDataUseResponse {
  runId: string;
  known: boolean;
  sources: SourceDataUse[];
}
