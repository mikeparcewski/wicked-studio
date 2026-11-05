import type { KnowledgeSummary } from '../../api/knowledgeSummary.js';
import { agentAccessOf } from '../../api/sourceAgents.js';

/**
 * THE BUILD SHEET'S SUGGESTIONS (DES-REPORT-DASHBOARDS-001 §2, "Seeds come from fixed templates"): each suggestion is a
 * fixed sentence filled with exactly two things, never anything a source or a page says about itself:
 *
 *  - the Report's period, in studio's own words ("the last 7 days", "Oct 20 – Oct 22");
 *  - the registry NAMES of the data sources the chosen project can see, read from crew's full `GET /mcp/servers`
 *    view: enabled, an app-readable kind, the agents switch `see` on, and every project or this one listed. A name is
 *    used only in crew's server-name grammar, so a name can never carry a sentence.
 *
 * The list only filters what is offered: the builder's package stays the authority on what the app may read.
 */

/** crew's registry name grammar (`mcp/classify.ts` `MCP_SERVER_NAME_RE`). */
const SERVER_NAME = /^[a-z0-9][a-z0-9_-]{0,62}$/u;
/** The built-in source crew serves itself (its name is reserved); not a source the person registered. */
const CREW_SOURCE = 'crew';
const APP_READABLE = new Set(['sql', 'graphql', 'rest', 'mcp-http']);
/** At most this many names are offered. */
export const SEED_SOURCES_MAX = 6;

/** The period as a seed says it: "Last 7 days" reads "the last 7 days"; a custom range reads as it is. */
export function periodSeed(words: string): string {
  return /^Last \d+ days?$/u.test(words) ? `the ${words.charAt(0).toLowerCase()}${words.slice(1)}` : words;
}

/**
 * The source names `projectId` can see, in crew's order, from a `GET /mcp/servers` answer (anything else: none). The
 * kind there is crew's read-path projection (`configOf`), the same one an app query's source is resolved by: a native
 * database source reads `sql`, and a Toolbox-runtime one stays `toolbox-source`, which no app query can read in v1.
 */
export function sourcesForProject(answer: unknown, projectId: string, max: number = SEED_SOURCES_MAX): string[] {
  const servers = typeof answer === 'object' && answer !== null ? (answer as { servers?: unknown }).servers : undefined;
  if (!Array.isArray(servers)) return [];
  const out: string[] = [];
  for (const s of servers as unknown[]) {
    if (typeof s !== 'object' || s === null) continue;
    const r = s as { name?: unknown; kind?: unknown; enabled?: unknown; agents?: unknown };
    if (typeof r.name !== 'string' || !SERVER_NAME.test(r.name) || r.name === CREW_SOURCE || out.includes(r.name)) continue;
    if (r.enabled !== true || typeof r.kind !== 'string' || !APP_READABLE.has(r.kind)) continue;
    const a = agentAccessOf(r);
    if (a === null || !a.see || !(a.everyProject || a.projects.includes(projectId))) continue;
    out.push(r.name);
    if (out.length >= max) break;
  }
  return out;
}

/** The kinds crew's app query resolver (`lookupSource` + `queryKindFits`) reads; a `toolbox-source` is not one. */
const APP_QUERY_KINDS = new Set(['sql', 'graphql', 'rest', 'mcp-http', 'mcp-stdio']);

/**
 * Whether `projectId` has ANY registry source an app query could read, from a `GET /mcp/servers` answer (`null`: not
 * one), by crew's rules: enabled and of a kind its resolver reads (`lookupSource`, `queryKindFits`; `mcp-stdio` too,
 * which only publishing refuses); a data source with Agents switches seen by this project; a REST or MCP server (it
 * carries no Agents switches, `isSourceRecord`) with a registered tool, never a PM entry (`appTool`: Apps gets
 * none; a tool's own switch governs agent runs, not Apps). This only decides whether a GENERIC data ask is on offer;
 * it names nothing.
 */
export function anyAppReadable(answer: unknown, projectId: string): boolean | null {
  const servers = typeof answer === 'object' && answer !== null ? (answer as { servers?: unknown }).servers : undefined;
  if (!Array.isArray(servers)) return null;
  return servers.some((s: unknown) => {
    if (typeof s !== 'object' || s === null) return false;
    const r = s as { name?: unknown; kind?: unknown; enabled?: unknown; agents?: unknown; pm?: unknown; tools?: unknown };
    if (typeof r.name !== 'string' || r.name === CREW_SOURCE || r.enabled !== true || typeof r.kind !== 'string' || !APP_QUERY_KINDS.has(r.kind)) return false;
    if (r.kind !== 'sql' && r.kind !== 'graphql') {
      return (r.pm === undefined || r.pm === null) && Array.isArray(r.tools)
        && r.tools.some((t: unknown) => typeof t === 'object' && t !== null && (t as { status?: unknown }).status === 'registered');
    }
    const a = agentAccessOf(r);
    return a !== null && a.see && (a.everyProject || a.projects.includes(projectId));
  });
}

/**
 * (DES-KNOWLEDGE-DATA-001 §9.1) The sources a DATA suggestion may name (Apps page, an app's chat, Report's Build
 * sheet): the ones the project's knowledge summary lists as described (what the builder is given), and that an app
 * query can read: crew's `lookupSource` (`apps/exec/sources.ts`) resolves no Toolbox-runtime source, so one is named
 * by knowledge suggestions only (a `recall` through estate), never in a data ask. No summary: none, never a guess
 * from the registry alone. In the summary's order, at most {@link SEED_SOURCES_MAX}.
 */
export function dataSourcesFor(summary: KnowledgeSummary | null, servers: unknown, projectId: string): string[] {
  if (summary === null || summary.projectId !== projectId) return [];
  const readable = new Set(sourcesForProject(servers, projectId, Number.POSITIVE_INFINITY));
  return summary.sources.filter((x) => x.described && readable.has(x.name)).map((x) => x.name).slice(0, SEED_SOURCES_MAX);
}

/** Up to three suggestions: fixed sentences, filled only with the period and source names. */
export function dashboardSeeds(period: string, sources: readonly string[]): string[] {
  const p = periodSeed(period);
  const [a, b] = sources;
  if (a === undefined) return [`My main numbers over ${p}, with a table of the newest rows`];
  return [
    `KPIs for the main numbers in ${a} over ${p}, with a table of the newest rows`,
    `What changed per day in ${a} over ${p}, as a line chart`,
    b !== undefined ? `A number from ${a} next to one from ${b}, over ${p}` : `The main numbers in ${a} by category next to their trend per day, ${p}`,
  ];
}
