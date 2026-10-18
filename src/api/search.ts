/**
 * Global search — crew's `GET /search`. The wire types come from the contract package
 * (`wicked-crew-api-types` ≥ 0.127.0, re-exported through `./types.js`); this module adds studio's side.
 */

import type { SearchType } from './types.js';
export type { SearchType, SearchSpan, SearchTarget, SearchHit, SearchGroup, SearchSourceState, SearchResponse } from './types.js';

// ── Studio's side ───────────────────────────────────────────────────────────────────────────────

/** Every type, in the daemon's order — the modal's tabs after "All". */
export const SEARCH_TYPES: readonly SearchType[] = ['run', 'project', 'repo', 'transcript', 'rule', 'memory', 'doc'];

/** A tab's name (plural) and a hit's kind word (singular). */
export const SEARCH_TYPE_WORDS: Record<SearchType, { tab: string; one: string }> = {
  run: { tab: 'Runs', one: 'run' },
  project: { tab: 'Projects', one: 'project' },
  repo: { tab: 'Repos', one: 'repository' },
  transcript: { tab: 'Transcripts', one: 'transcript' },
  rule: { tab: 'Rules', one: 'rule' },
  memory: { tab: 'Memories', one: 'memory' },
  doc: { tab: 'Docs', one: 'document' },
};

/** The shortest query the daemon searches. */
export const MIN_SEARCH_CHARS = 2;
