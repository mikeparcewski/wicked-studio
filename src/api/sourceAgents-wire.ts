/**
 * A live source's agent switches and its agent-read record (DES-KNOWLEDGE-DATA-001 §7.1, §7.9): the wire of
 * `PUT /sources/:name/agents`, `GET /sources/:name/agent-queries` and `GET /runs/:id/data-use`, and the
 * `agents` field a data source carries in `GET /mcp/servers` (the full, human view).
 *
 * Imported from `wicked-crew-api-types` (pin 0.186.0; the blocks arrived in 0.183.0 and 0.184.0) and re-exported
 * here, so `./sourceAgents.ts` keeps its names. The verbatim mirror that lived here while the pin lagged is gone:
 * the package IS the contract now. `./sourceAgents.ts` still reads every answer defensively.
 */
import type {
  McpSourceAgents,
  SourceAgentAccess,
  SourceAgentAccessBody,
  SourceAgentAccessResponse,
  SourceAgentQuery,
  SourceAgentQueriesResponse,
  SourceDataUse,
  RunDataUseResponse,
} from 'wicked-crew-api-types';

export type {
  McpSourceAgents,
  SourceAgentAccess,
  SourceAgentAccessBody,
  SourceAgentAccessResponse,
  SourceAgentQuery,
  SourceAgentQueriesResponse,
  SourceDataUse,
  RunDataUseResponse,
};
