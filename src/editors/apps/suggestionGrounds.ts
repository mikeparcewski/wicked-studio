import { fetchKnowledgeSummary, type KnowledgeSummary } from '../../api/knowledgeSummary.js';
import { mcpApi } from '../../api/mcp.js';
import { dataSourcesFor, sourcesForProject } from './appSeeds.js';

/**
 * What a project's app suggestions are made from (DES-KNOWLEDGE-DATA-001 §9.1), read together so no suggestion shows
 * before both answers are in: the project's knowledge summary (what the builder is given) and crew's registry (whether
 * an app query can read a source). `data` = the sources a data suggestion may name ({@link dataSourcesFor});
 * `readable` = whether the project has ANY source an app query can read (a GraphQL or REST source is never in the
 * summary, so a generic data suggestion still fits it), `null` when the registry could not be read.
 *
 * `servers` is `{ failed }` when the registry could not be read (Report's Build sheet says so); the suggestions then
 * name no source. A summary crew does not have (an older crew, a refusal) is `null`: no knowledge suggestion, and no
 * named data suggestion.
 */
export interface SuggestionGrounds {
  projectId: string;
  summary: KnowledgeSummary | null;
  data: string[];
  readable: boolean | null;
  servers: { failed: string } | null;
}

export async function readSuggestionGrounds(projectId: string): Promise<SuggestionGrounds> {
  const [summary, servers] = await Promise.all([
    fetchKnowledgeSummary(projectId),
    mcpApi.servers().then((r): { ok: unknown } => ({ ok: r }), (e: unknown) => ({ failed: (e instanceof Error ? e.message : String(e)).slice(0, 160) })),
  ]);
  if ('failed' in servers) return { projectId, summary, data: [], readable: null, servers: { failed: servers.failed } };
  const readable = sourcesForProject(servers.ok, projectId, Number.POSITIVE_INFINITY).length > 0;
  return { projectId, summary, data: dataSourcesFor(summary, servers.ok, projectId), readable, servers: null };
}
