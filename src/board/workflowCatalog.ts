import type { WorkflowDef } from '../api/types.js';
import type { Preset } from '../api/teamPlan.js';
import { workflowItems } from './workflowCommand.js';
import { workflowLabel } from './workflowNames.js';
import { workflowPurpose } from './workflowPurpose.js';

/**
 * THE WORKFLOW CATALOG (operator 2026-11-01: "categorized, searchable and filterable; 'your top' …
 * then broken down by categories … help them shape the work"). New job's first step reads ONE view
 * model, whichever daemon answers:
 *
 *  - a daemon with crew's catalog (`GET /workflows/catalog`): its categories, each workflow's
 *    metadata (what you get, what it needs, time, cost, tags, status) and this operator's usage;
 *  - an older daemon: today's list (`GET /workflows` + the scope's presets), uncategorised, with the
 *    def's own `title`/`summary`/`use_when` where it has them — still searchable, no "Your top".
 *
 * Pure: the wire is read as `unknown` (every field optional, an unknown one ignored), and search,
 * filters and the top section are plain functions over the view model.
 */

export type CatalogStatus = 'ready' | 'beta' | 'soon';

export interface CatalogInput {
  key: string;
  label: string;
  help: string | null;
  required: boolean;
}

export interface CatalogCategory {
  id: string;
  title: string;
  blurb: string | null;
}

export interface CatalogEntry {
  /** The catalog's id for the workflow. */
  id: string;
  /** What the wizard sets as the draft's workflow (`demo` launches through studio's Demo video). */
  launchId: string;
  title: string;
  /** null = uncategorised (an older daemon, or a category the catalog did not list: "More"). */
  category: string | null;
  /** What you get, in one line. */
  gets: string;
  /** What it does (the def's summary), when it says more than `gets`. */
  summary: string;
  /** What it needs before it can start: `repo`, `documents`, `runs`, `url`, `project`, … */
  needs: readonly string[];
  inputs: readonly CatalogInput[];
  time: string | null;
  cost: string | null;
  tags: readonly string[];
  synonyms: readonly string[];
  status: CatalogStatus;
  /** Catalog order (ties in ranking fall back to it). */
  order: number;
  /** The drawing key (`WorkflowArt`). */
  artKey: string;
  launches: number;
  lastUsedAt: string | null;
}

export interface CatalogView {
  source: 'catalog' | 'fallback';
  categories: readonly CatalogCategory[];
  entries: readonly CatalogEntry[];
}

/** The "More" bucket: extras, and any entry whose category the catalog did not list. */
export const MORE_CATEGORY: CatalogCategory = { id: 'more', title: 'More', blurb: 'Everything else' };

/** Studio's own kinds of job (the wizard launches them through their own routes). */
export const STUDIO_KIND_DEMO = 'demo-video';
export const STUDIO_KIND_DRAFT_EPICS = 'draft-epics';
/** Catalog ids that studio launches through its own kind (crew's `demo` preset is a system flow). */
const LAUNCH_ALIAS: Readonly<Record<string, string>> = { demo: STUDIO_KIND_DEMO, 'demo-video': STUDIO_KIND_DEMO };

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.flatMap((x) => (typeof x === 'string' && x.trim() !== '' ? [x.trim()] : [])) : []);
const rec = (v: unknown): Record<string, unknown> | null => (v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

function statusOf(v: unknown): CatalogStatus {
  const s = typeof v === 'string' ? v.toLowerCase() : '';
  if (s === 'soon' || s === 'coming-soon' || s === 'coming_soon' || s === 'planned') return 'soon';
  if (s === 'beta' || s === 'preview' || s === 'experimental') return 'beta';
  return 'ready';
}

/** A needs token in one spelling (`repository` and `repo` are one need). */
function needOf(raw: string): string {
  const n = raw.toLowerCase();
  if (n === 'repository' || n === 'repositories' || n === 'repos' || n === 'code') return 'repo';
  if (n === 'docs' || n === 'document') return 'documents';
  if (n === 'run') return 'runs';
  return n;
}

function inputsOf(v: unknown): CatalogInput[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((x) => {
    const r = rec(x);
    const key = str(r?.['key']) ?? str(r?.['id']);
    if (r === null || key === null) return [];
    return [{ key, label: str(r['label']) ?? str(r['title']) ?? key, help: str(r['help']) ?? str(r['description']), required: r['required'] === true }];
  });
}

/**
 * The catalog wire as one view model, or null when the body is not a catalog (an older daemon's
 * 404 page, a malformed answer): the caller then falls back to today's list.
 */
export function catalogFromWire(body: unknown): CatalogView | null {
  const root = rec(body);
  const rawWorkflows = root?.['workflows'];
  if (root === null || !Array.isArray(rawWorkflows)) return null;
  const categories: CatalogCategory[] = [];
  const catOrder: { c: CatalogCategory; o: number }[] = [];
  (Array.isArray(root['categories']) ? root['categories'] : []).forEach((x, i) => {
    const r = rec(x);
    const id = str(r?.['id']);
    if (r === null || id === null || catOrder.some((c) => c.c.id === id)) return;
    catOrder.push({ c: { id, title: str(r['title']) ?? str(r['name']) ?? workflowLabel(id), blurb: str(r['blurb']) ?? str(r['description']) }, o: typeof r['order'] === 'number' ? r['order'] : i });
  });
  catOrder.sort((a, b) => a.o - b.o).forEach(({ c }) => categories.push(c));
  const known = new Set(categories.map((c) => c.id));

  const usage = new Map<string, { launches: number; lastUsedAt: string | null }>();
  for (const x of Array.isArray(root['usage']) ? root['usage'] : []) {
    const r = rec(x);
    const id = str(r?.['workflowId']) ?? str(r?.['workflow']) ?? str(r?.['id']);
    if (r === null || id === null) continue;
    usage.set(id, { launches: num(r['launches'] ?? r['count']), lastUsedAt: str(r['lastUsedAt']) ?? str(r['lastUsed']) ?? str(r['last_used_at']) });
  }

  const entries: CatalogEntry[] = [];
  const seen = new Set<string>();
  rawWorkflows.forEach((x, i) => {
    const r = rec(x);
    const id = str(r?.['id']);
    if (r === null || id === null || seen.has(id)) return;
    seen.add(id);
    const cat = str(r['category']);
    // Usage may also ride on the workflow itself.
    const u = usage.get(id) ?? (rec(r['usage']) !== null ? { launches: num(rec(r['usage'])!['launches']), lastUsedAt: str(rec(r['usage'])!['lastUsedAt']) } : null);
    const summary = str(r['summary']) ?? str(r['description']) ?? '';
    const launchId = LAUNCH_ALIAS[id] ?? id;
    entries.push({
      id,
      launchId,
      title: str(r['title']) ?? workflowLabel(id),
      category: cat !== null && known.has(cat) ? cat : null,
      gets: str(r['gets']) ?? str(r['whatYouGet']) ?? str(r['output']) ?? (summary !== '' ? summary : workflowPurpose(id, '')),
      summary,
      needs: [...new Set(strs(r['needs']).map(needOf))],
      inputs: inputsOf(r['inputs']),
      time: str(r['time']) ?? str(r['duration']),
      cost: str(r['cost']),
      tags: strs(r['tags']),
      synonyms: strs(r['synonyms']),
      status: statusOf(r['status']),
      order: i,
      artKey: launchId,
      launches: u?.launches ?? 0,
      lastUsedAt: u?.lastUsedAt ?? null,
    });
  });
  // An entry whose category the catalog did not list sits under More; More is listed only if used.
  if (entries.some((e) => e.category === null) && !known.has(MORE_CATEGORY.id)) categories.push(MORE_CATEGORY);
  for (const e of entries) if (e.category === null) e.category = MORE_CATEGORY.id;
  return { source: 'catalog', categories, entries };
}

/** Studio's own kinds, when the catalog does not list them (demo and draft epics are launched by studio). */
export function withStudioKinds(view: CatalogView, extras: readonly CatalogEntry[]): CatalogView {
  const have = new Set(view.entries.map((e) => e.launchId));
  const add = extras.filter((e) => !have.has(e.launchId)).map((e, i) => ({
    ...e,
    order: view.entries.length + i,
    category: view.source === 'fallback' ? null : (e.category !== null && view.categories.some((c) => c.id === e.category) ? e.category : MORE_CATEGORY.id),
  }));
  if (add.length === 0) return view;
  const needMore = view.source === 'catalog' && add.some((e) => e.category === MORE_CATEGORY.id) && !view.categories.some((c) => c.id === MORE_CATEGORY.id);
  return { ...view, categories: needMore ? [...view.categories, MORE_CATEGORY] : view.categories, entries: [...view.entries, ...add] };
}

/**
 * An older daemon: today's list as the view model, uncategorised. A daemon workflow is taken to need
 * a repository (today's rule: the wizard always asked for one).
 */
export function catalogFromDefs(defs: readonly WorkflowDef[] | null, presets: readonly Preset[] | null): CatalogView {
  const rows = workflowItems('', defs, presets, Number.POSITIVE_INFINITY);
  const entries = rows.map((r, i): CatalogEntry => {
    const def = (defs ?? []).find((d) => d.id === r.workflowId) as (WorkflowDef & { use_when?: unknown }) | undefined;
    const summary = str(def?.summary) ?? '';
    const useWhen = str(def?.use_when);
    return {
      id: r.workflowId,
      launchId: r.workflowId,
      title: str(def?.title) ?? workflowLabel(r.key),
      category: null,
      gets: workflowPurpose(r.key, summary !== '' ? summary : r.line),
      summary: [summary, useWhen].filter((s): s is string => s !== null && s !== '').join(' '),
      needs: ['repo'],
      inputs: [],
      time: null,
      cost: null,
      tags: [],
      synonyms: [],
      status: 'ready',
      order: i,
      artKey: r.key,
      launches: 0,
      lastUsedAt: null,
    };
  });
  return { source: 'fallback', categories: [], entries };
}

// ── The top section ────────────────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;
/** Half-weight after this many days without a launch (launches / (1 + days / HALF_DAYS)). */
export const TOP_HALF_DAYS = 14;
export const TOP_MAX = 4;

/** The recency-weighted use score: launches, discounted by days since the last one. */
export function usageScore(e: Pick<CatalogEntry, 'launches' | 'lastUsedAt'>, now: number): number {
  if (e.launches <= 0) return 0;
  const t = e.lastUsedAt === null ? Number.NaN : Date.parse(e.lastUsedAt);
  const days = Number.isFinite(t) ? Math.max(0, (now - t) / DAY_MS) : 365;
  return e.launches / (1 + days / TOP_HALF_DAYS);
}

/** "Your top": what this operator launches most, recency-weighted; empty for a new user. */
export function topEntries(entries: readonly CatalogEntry[], now: number, max = TOP_MAX): CatalogEntry[] {
  return entries
    .filter((e) => e.launches > 0 && e.status !== 'soon')
    .map((e) => ({ e, s: usageScore(e, now) }))
    .sort((a, b) => b.s - a.s || a.e.order - b.e.order)
    .slice(0, max)
    .map((x) => x.e);
}

// ── Filters ────────────────────────────────────────────────────────────────────────────────────

export type RepoFilter = 'any' | 'needs' | 'without';
export interface CatalogFilters {
  /** null = every category. */
  category: string | null;
  repo: RepoFilter;
  /** Show the workflows that are coming soon (on by default: the operator sees what is coming). */
  showSoon: boolean;
}
export const NO_FILTERS: CatalogFilters = { category: null, repo: 'any', showSoon: true };

export function needsRepo(e: Pick<CatalogEntry, 'needs'>): boolean {
  return e.needs.includes('repo');
}

export function filtersActive(f: CatalogFilters): boolean {
  return f.category !== null || f.repo !== 'any' || !f.showSoon;
}

export function applyFilters(entries: readonly CatalogEntry[], f: CatalogFilters): CatalogEntry[] {
  return entries.filter((e) =>
    (f.category === null || e.category === f.category)
    && (f.repo === 'any' || (f.repo === 'needs') === needsRepo(e))
    && (f.showSoon || e.status !== 'soon'));
}

// ── Search ─────────────────────────────────────────────────────────────────────────────────────

const STOP = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'for', 'to', 'in', 'on', 'at', 'by', 'with', 'from', 'into', 'about',
  'my', 'our', 'your', 'me', 'we', 'i', 'it', 'its', 'this', 'that', 'these', 'those', 'is', 'are', 'was', 'were',
  'be', 'do', 'does', 'did', 'can', 'could', 'should', 'would', 'please', 'want', 'need', 'some', 'new', 'x',
]);

/**
 * Words people type for what a workflow does, said as the words the catalog uses. A query token
 * expands to itself plus these; the catalog's own `synonyms` and `tags` add more per workflow.
 */
const LEXICON: Readonly<Record<string, readonly string[]>> = {
  doc: ['documentation', 'docs', 'document'],
  docs: ['documentation', 'doc', 'document'],
  document: ['documentation', 'docs'],
  documentation: ['docs', 'document'],
  readme: ['documentation', 'docs'],
  guide: ['documentation', 'walkthrough'],
  write: ['author', 'documentation'],
  explain: ['documentation', 'walkthrough', 'learn'],
  learn: ['walkthrough', 'research'],
  slide: ['presentation', 'deck'],
  deck: ['presentation', 'slide'],
  pitch: ['presentation'],
  video: ['demo', 'recording'],
  record: ['demo', 'video'],
  screencast: ['demo', 'video'],
  bug: ['issue', 'fix'],
  issue: ['bug', 'fix'],
  fix: ['issue', 'bug', 'resolve'],
  broken: ['issue', 'bug', 'fail'],
  break: ['issue', 'bug', 'fail'],
  crash: ['issue', 'bug', 'fail'],
  error: ['issue', 'bug', 'fail'],
  fail: ['failure', 'review', 'issue'],
  failure: ['fail', 'review'],
  why: ['review', 'analyze'],
  went: ['review'],
  happen: ['review'],
  run: ['runs', 'review'],
  job: ['runs', 'review'],
  upgrade: ['migrate', 'migration'],
  migrate: ['migration', 'upgrade', 'port'],
  port: ['migrate', 'migration'],
  move: ['migrate', 'migration'],
  test: ['tests', 'testing', 'qe'],
  coverage: ['test', 'tests', 'analysis'],
  plan: ['planning'],
  automate: ['automation'],
  domain: ['extraction', 'model'],
  business: ['domain'],
  plugin: ['plugins', 'extension'],
  extension: ['plugin'],
  editor: ['plugin'],
  tool: ['mcp', 'tools'],
  mcp: ['tool', 'server'],
  build: ['feature', 'create'],
  add: ['feature'],
  feature: ['build'],
  app: ['vibe', 'builder', 'dashboard'],
  dashboard: ['vibe', 'app'],
  validate: ['validation', 'check', 'verify'],
  check: ['validate', 'review'],
  verify: ['validate'],
  review: ['analyze', 'check'],
};

/** Lowercase, split on anything not a letter or digit, plain English stemming. */
export function stem(w: string): string {
  let s = w.toLowerCase();
  if (s.length > 5 && s.endsWith('ing')) s = s.slice(0, -3);
  else if (s.length > 4 && s.endsWith('ed')) s = s.slice(0, -2);
  else if (s.length > 4 && s.endsWith('ies')) s = `${s.slice(0, -3)}y`;
  else if (s.length > 3 && s.endsWith('es') && /(ss|sh|ch|x)es$/.test(s)) s = s.slice(0, -2);
  else if (s.length > 3 && s.endsWith('s') && !s.endsWith('ss')) s = s.slice(0, -1);
  return s;
}

export function tokens(text: string): string[] {
  return text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t !== '' && !STOP.has(t)).map(stem).filter((t) => t !== '' && !STOP.has(t));
}

const FIELD_WEIGHT = { title: 6, words: 4, gets: 2, other: 1 } as const;
const EXPANSION_FACTOR = 0.5;

function fieldTokens(e: CatalogEntry, categoryTitle: string): { t: Set<string>; w: number }[] {
  return [
    { t: new Set([...tokens(e.title), ...tokens(e.id)]), w: FIELD_WEIGHT.title },
    { t: new Set([...e.tags, ...e.synonyms].flatMap(tokens)), w: FIELD_WEIGHT.words },
    { t: new Set([...tokens(e.gets), ...tokens(e.summary)]), w: FIELD_WEIGHT.gets },
    { t: new Set([...e.needs.flatMap(tokens), ...tokens(categoryTitle), ...e.inputs.flatMap((i) => tokens(i.label))]), w: FIELD_WEIGHT.other },
  ];
}

function tokenScore(q: string, fields: readonly { t: Set<string>; w: number }[]): number {
  let best = 0;
  for (const f of fields) {
    if (f.t.has(q)) best = Math.max(best, f.w);
    else if (q.length >= 3) {
      for (const t of f.t) if (t.startsWith(q) || (t.length >= 4 && q.startsWith(t))) { best = Math.max(best, f.w / 2); break; }
    }
  }
  return best;
}

/** How well one entry answers a query (0 = not at all). */
export function scoreEntry(e: CatalogEntry, query: string, categoryTitle = ''): number {
  const qs = tokens(query);
  if (qs.length === 0) return 0;
  const fields = fieldTokens(e, categoryTitle);
  let score = 0;
  for (const q of qs) {
    const direct = tokenScore(q, fields);
    let expanded = 0;
    for (const x of LEXICON[q] ?? []) expanded = Math.max(expanded, tokenScore(stem(x), fields) * EXPANSION_FACTOR);
    score += Math.max(direct, expanded);
  }
  const title = e.title.toLowerCase();
  const whole = query.trim().toLowerCase();
  if (whole.length >= 2 && (title.startsWith(whole) || e.id.toLowerCase().startsWith(whole))) score += 4;
  return score;
}

/** The entries a query matches, best first (ties: what this operator uses more, then catalog order). */
export function searchCatalog(view: CatalogView, query: string, now: number): CatalogEntry[] {
  const title = new Map(view.categories.map((c) => [c.id, c.title] as const));
  return view.entries
    .map((e) => ({ e, s: scoreEntry(e, query, title.get(e.category ?? '') ?? '') }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || usageScore(b.e, now) - usageScore(a.e, now) || a.e.order - b.e.order)
    .map((x) => x.e);
}

/** The words a card's meta line shows: what it needs, then time and cost. */
const NEED_WORDS: Readonly<Record<string, string>> = {
  repo: 'a repository',
  documents: 'documents',
  runs: 'runs to review',
  url: 'a running app',
  project: 'a project',
  requirements: 'requirements',
  issue: 'an issue',
};
export function needWord(n: string): string {
  return NEED_WORDS[n] ?? n.replace(/[-_]+/g, ' ');
}
export function needsLine(e: Pick<CatalogEntry, 'needs'>): string {
  if (e.needs.length === 0) return 'Works without a repository';
  const words = e.needs.map(needWord);
  return `Needs ${words.length === 1 ? words[0] : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`}`;
}
