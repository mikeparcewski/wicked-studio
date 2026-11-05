import type { KnowledgeSummary } from '../../api/knowledgeSummary.js';

/**
 * KNOWLEDGE SUGGESTIONS (DES-KNOWLEDGE-DATA-001 §9.1): apps and dashboards can be built on what a project KNOWS, not
 * only on a data source's rows, and the suggestions say so. Each suggestion is a fixed sentence, offered only when the
 * project's knowledge summary (crew's `GET /knowledge/summary`, the same summary the builder gets) shows that
 * knowledge exists, and filled only with a registry NAME (crew's name grammar, already checked by the reader). So a
 * suggestion never names knowledge the project does not have, and each one is something the builder can build with a
 * `recall` query:
 *
 *  - memories   -> `from: memories` (what this project remembers);
 *  - steering   -> `from: steering`, grouped by kind (the rules that apply, by type);
 *  - a source whose structure is in the knowledge plane -> `from: tables` (its tables, with shapes and joins when a
 *    person approved some);
 *  - a described source -> also `from: knowledge` with a search box (documents, source structure, shapes, with citations).
 */

/** At most this many knowledge suggestions. */
export const KNOWLEDGE_SEEDS_MAX = 3;

const has = (s: KnowledgeSummary | null): { memories: boolean; steering: boolean; described: KnowledgeSummary['sources'] } => ({
  memories: s?.memories != null && s.memories.project + s.memories.shared > 0,
  steering: s?.steering != null && s.steering.total > 0,
  described: (s?.sources ?? []).filter((x) => x.described),
});

/** A new app's suggestions over the project's knowledge (the module doc), best first; `[]` when it has none. */
export function knowledgeSeeds(summary: KnowledgeSummary | null): string[] {
  if (summary === null) return [];
  const k = has(summary);
  const out: string[] = [];
  const shaped = k.described.find((x) => (x.shapes ?? 0) > 0) ?? null;
  const first = shaped ?? k.described[0] ?? null;
  if (first !== null) out.push((first.shapes ?? 0) > 0 ? `What we know about ${first.name}: its tables, their data shapes and joins` : `What we know about ${first.name}: its tables and their columns`);
  if (k.steering) out.push('Steering rules for this project by type as a bar chart, with the rules in a table');
  if (k.memories) out.push('A searchable table of what this project remembers: decisions and lessons, with where each came from');
  // The search reads the knowledge store (documents, structure, shapes), not memories: offered only when structure is there.
  if (k.described.length > 0) out.push("Search this project's knowledge: documents, data shapes and source structure, with citations");
  return out.slice(0, KNOWLEDGE_SEEDS_MAX);
}

/** For an app that reads no knowledge yet: one suggestion that ADDS knowledge beside what it shows (or `null`). */
export function knowledgeAddition(summary: KnowledgeSummary | null): string | null {
  if (summary === null) return null;
  const k = has(summary);
  if (k.steering) return "Add a bar chart of this project's steering rules by type";
  if (k.memories) return 'Add a table of what this project remembers about this, with where each came from';
  const first = k.described.find((x) => (x.shapes ?? 0) > 0) ?? k.described[0];
  if (first !== undefined) return `Add a table of what we know about ${first.name}'s tables`;
  return null;
}

/**
 * The data suggestions to offer beside `knowledge`: none when the project is known to have no source an app query
 * can read (`readable === false`) and knowledge suggestions are on offer, since a data ask could not be built (ak-fix
 * review: codex). Unknown (`null`, an older crew or an unread registry) keeps them, as before.
 */
export function dataSeedsBeside(knowledge: readonly string[], data: readonly string[], readable: boolean | null): readonly string[] {
  return readable === false && knowledge.length > 0 ? [] : data;
}

/** Knowledge first, then data, alternating: both kinds of app are on offer (the Apps page and Report's Build sheet). */
export function mixSeeds(knowledge: readonly string[], data: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < Math.max(knowledge.length, data.length); i++) {
    if (knowledge[i] !== undefined) out.push(knowledge[i]!);
    if (data[i] !== undefined) out.push(data[i]!);
  }
  return out;
}

/** The registry name of the system's knowledge in an app spec (crew reserves it): not a data source to suggest. */
export const KNOWLEDGE_SOURCE = 'estate';
