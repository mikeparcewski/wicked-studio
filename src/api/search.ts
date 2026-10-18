/**
 * Global search — crew's `GET /search` (wicked-crew-api-types 0.127.0).
 *
 * The wire block below mirrors the contract package's "Global search" block VERBATIM in shape: the
 * package version that carries it is not the one studio pins yet (0.120.0). When the pin reaches
 * 0.127.0, delete these declarations and re-export them from `./types.js` instead.
 */

// ── The wire (mirror of wicked-crew-api-types 0.127.0 "Global search") ───────────────────────────

export type SearchType = 'run' | 'project' | 'repo' | 'transcript' | 'rule' | 'memory' | 'doc';
export type SearchSpan = [number, number];
export type SearchTarget =
  | { kind: 'run'; run_id: string; chat_id: string | null }
  | { kind: 'project'; project_id: string }
  | { kind: 'repo'; repo_id: string }
  | { kind: 'chat'; chat_id: string }
  | { kind: 'unit'; run_id: string; ord: number; chat_id: string | null }
  | { kind: 'rule'; rule_id: string; steering_type: string | null }
  | { kind: 'memory'; memory_id: string; scope: string }
  | { kind: 'doc'; project_id: string; doc: string };
export interface SearchHit {
  type: SearchType;
  id: string;
  title: string;
  title_spans: SearchSpan[];
  snippet: string | null;
  snippet_spans: SearchSpan[];
  score: number;
  updated_at: number | null;
  project_id: string | null;
  status: string | null;
  target: SearchTarget;
}
export interface SearchGroup {
  type: SearchType;
  total: number;
  hits: SearchHit[];
  next_cursor: string | null;
}
export interface SearchSourceState {
  type: SearchType;
  state: 'ready' | 'indexing' | 'unavailable';
  indexed: number;
  note: string | null;
}
export interface SearchResponse {
  query: string;
  groups: SearchGroup[];
  sources: SearchSourceState[];
  partial: boolean;
  took_ms: number;
}

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
