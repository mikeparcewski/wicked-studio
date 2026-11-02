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

export type CatalogStatus = 'ready' | 'soon' | 'unavailable';

/** How studio starts an entry (wf-catalog WIRE v1 `launch.kind`). */
export type LaunchKind = 'run' | 'demo' | 'compose' | 'document' | 'chat' | 'none';

export interface CatalogInput {
  key: string;
  label: string;
  /** `text` inputs are said in words; `repo`, `project`, `url`, `requirements`, `seats` have their own fields. */
  kind: string;
  required: boolean;
}

export interface CatalogCategory {
  id: string;
  title: string;
  blurb: string | null;
}

export interface CatalogEntry {
  /** The catalog's card id. */
  id: string;
  /** What the wizard sets as the draft's workflow: the run's workflow, or studio's own kind
   *  (`demo-video`, `draft-epics`); for a document or chat entry, a key no draft ever carries. */
  launchId: string;
  launchKind: LaunchKind;
  /** A document entry's style (`web`, `doc`, `ppt`, `brochure`); null otherwise. */
  docStyle: string | null;
  title: string;
  /** null = uncategorised (an older daemon). */
  category: string | null;
  /** The subcategory's title (searchable), or null. */
  subcategory: string | null;
  /** What you get, in one line (WIRE `outcome`). */
  gets: string;
  /** What it does, and when to use it (searchable). */
  summary: string;
  /** What it needs before it can start: `repo`, `project`, `running_app`, `requirements`, `document`, `runs`. */
  needs: readonly string[];
  inputs: readonly CatalogInput[];
  /** True when the catalog sent a form (`inputs` was a list, even an empty one): only then may it make
   *  the words optional. An older daemon's list, or a malformed form, keeps the words required. */
  form: boolean;
  time: string | null;
  cost: string | null;
  /** What it ends with: `pr`, `document`, `video`, `report`, `answer`, `none`; null = not said. */
  delivers: string | null;
  tags: readonly string[];
  synonyms: readonly string[];
  status: CatalogStatus;
  /** Why it is coming soon or unavailable. */
  statusNote: string | null;
  /** Catalog order (ties in ranking fall back to it). */
  order: number;
  /** The drawing key (`WorkflowArt`). */
  artKey: string;
  launches: number;
  lastUsedAt: string | null;
  /** The median minutes of this operator's completed runs of it, or null. */
  medianMinutes: number | null;
}

export interface CatalogView {
  source: 'catalog' | 'fallback';
  categories: readonly CatalogCategory[];
  entries: readonly CatalogEntry[];
}

/** The "More" bucket (crew's own id; studio puts its own kinds here when the catalog has none of them). */
export const MORE_CATEGORY: CatalogCategory = { id: 'more', title: 'More', blurb: 'Everything else' };

/** Studio's own kinds of job (the wizard launches them through their own routes). */
export const STUDIO_KIND_DEMO = 'demo-video';
export const STUDIO_KIND_DRAFT_EPICS = 'draft-epics';

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.flatMap((x) => (typeof x === 'string' && x.trim() !== '' ? [x.trim()] : [])) : []);
const rec = (v: unknown): Record<string, unknown> | null => (v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
/** A dictionary's OWN value for a key from the wire or the search box ("constructor" is not a word we know). */
export function own<T>(map: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined;
}

/** Fail closed: only `available` is offered; `coming_soon` is shown as coming; anything else (missing,
 *  unknown, `unavailable`) is shown as not available. */
function statusOf(v: unknown): CatalogStatus {
  if (v === 'available') return 'ready';
  if (v === 'coming_soon') return 'soon';
  return 'unavailable';
}

/** "10–30 min", "45 min–2 h", "1–3 h" from a [low, high] in minutes. */
export function minutesLabel(v: unknown): string | null {
  if (!Array.isArray(v) || v.length !== 2) return null;
  const [lo, hi] = v.map(num) as [number, number];
  if (lo <= 0 || hi < lo) return null;
  const h = (m: number): string => `${Math.round((m / 60) * 10) / 10}`;
  if (hi < 90) return lo === hi ? `${lo} min` : `${lo}–${hi} min`;
  if (lo < 60) return `${lo} min–${h(hi)} h`;
  return lo === hi ? `${h(lo)} h` : `${h(lo)}–${h(hi)} h`;
}

/** "25 min", "4.7 h": a median run time, in the unit that reads. */
export function aboutMinutes(m: number): string {
  return m < 90 ? `${Math.round(m)} min` : `${Math.round((m / 60) * 10) / 10} h`;
}

const COST: Readonly<Record<string, string>> = { low: 'low cost', medium: 'medium cost', high: 'high cost' };

function inputsOf(v: unknown): CatalogInput[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((x) => {
    const r = rec(x);
    const key = str(r?.['id']);
    if (r === null || key === null) return [];
    return [{ key, label: str(r['label']) ?? key, kind: str(r['kind']) ?? 'text', required: r['required'] === true }];
  });
}

/** How an entry launches, and the id the wizard's draft carries for it. */
function launchOf(id: string, v: unknown): { launchKind: LaunchKind; launchId: string; docStyle: string | null } {
  const r = rec(v);
  const kind = str(r?.['kind']);
  switch (kind) {
    case 'run': {
      // Launch by `launch.workflow`, never the card id (which may be `run:<name>`). A run without one, or
      // one named like studio's own kinds (the wizard would take it for Demo video / Draft epics), is not offered.
      const wf = str(r?.['workflow']);
      if (wf === null || wf === STUDIO_KIND_DEMO || wf === STUDIO_KIND_DRAFT_EPICS) return { launchKind: 'none', launchId: `none:${id}`, docStyle: null };
      return { launchKind: 'run', launchId: wf, docStyle: null };
    }
    case 'demo': return { launchKind: 'demo', launchId: STUDIO_KIND_DEMO, docStyle: null };
    case 'compose': return { launchKind: 'compose', launchId: STUDIO_KIND_DRAFT_EPICS, docStyle: null };
    case 'document': return { launchKind: 'document', launchId: `document:${id}`, docStyle: str(r?.['style']) };
    case 'chat': return { launchKind: 'chat', launchId: `chat:${id}`, docStyle: null };
    // `none`, or a kind this studio does not know: shown, never launched.
    default: return { launchKind: 'none', launchId: `none:${id}`, docStyle: null };
  }
}

/**
 * The catalog wire (wf-catalog WIRE v1, `GET /workflows/catalog`) as one view model, or null when
 * the body is not a catalog (an older daemon's 404, a malformed answer): the caller then falls back
 * to today's list. Every field is read as optional; an entry of a launch kind studio does not know
 * is shown as not available rather than offered.
 */
export function catalogFromWire(body: unknown): CatalogView | null {
  const root = rec(body);
  const rawEntries = root?.['entries'];
  if (root === null || !Array.isArray(rawEntries)) return null;
  const categories: CatalogCategory[] = [];
  const subTitle = new Map<string, string>();
  for (const x of Array.isArray(root['categories']) ? root['categories'] : []) {
    const r = rec(x);
    const id = str(r?.['id']);
    if (r === null || id === null || categories.some((c) => c.id === id)) continue;
    categories.push({ id, title: str(r['title']) ?? String(workflowLabel(id)), blurb: str(r['summary']) });
    for (const sx of Array.isArray(r['subcategories']) ? r['subcategories'] : []) {
      const sr = rec(sx);
      const sid = str(sr?.['id']);
      if (sid !== null) subTitle.set(`${id}/${sid}`, str(sr?.['title']) ?? workflowLabel(sid));
    }
  }
  const known = new Set(categories.map((c) => c.id));

  const entries: CatalogEntry[] = [];
  const seen = new Set<string>();
  rawEntries.forEach((x, i) => {
    const r = rec(x);
    const id = str(r?.['id']);
    if (r === null || id === null || seen.has(id)) return;
    seen.add(id);
    const cat = str(r['category']);
    const sub = str(r['subcategory']);
    const u = rec(r['usage']);
    const summary = [str(r['summary']), ...strs(r['useWhen'])].filter((t): t is string => t !== null).join('. ');
    const launch = launchOf(id, r['launch']);
    const status = launch.launchKind === 'none' && statusOf(r['status']) === 'ready' ? 'unavailable' : statusOf(r['status']);
    const median = typeof u?.['medianMinutes'] === 'number' && u['medianMinutes'] > 0 ? Math.round(u['medianMinutes']) : null;
    entries.push({
      id,
      ...launch,
      title: str(r['title']) ?? String(workflowLabel(launch.launchKind === 'run' ? launch.launchId : id)),
      category: cat !== null && known.has(cat) ? cat : MORE_CATEGORY.id,
      subcategory: cat !== null && sub !== null ? subTitle.get(`${cat}/${sub}`) ?? null : null,
      gets: str(r['outcome']) ?? str(r['summary']) ?? String(workflowPurpose(launch.launchKind === 'run' ? launch.launchId : id, '')),
      summary,
      // Fail closed: a missing or malformed `needs` is taken to need a repository (today's rule).
      needs: Array.isArray(r['needs']) ? [...new Set(strs(r['needs']).filter((n) => n !== 'nothing'))] : ['repo'],
      inputs: inputsOf(r['inputs']),
      form: Array.isArray(r['inputs']),
      time: minutesLabel(r['typicalMinutes']),
      cost: own(COST, str(r['cost']) ?? '') ?? null,
      delivers: str(r['delivers']),
      tags: strs(r['tags']),
      synonyms: strs(r['synonyms']),
      status,
      statusNote: str(r['statusNote']),
      order: i,
      artKey: launch.launchKind === 'run' ? launch.launchId : launch.launchKind === 'demo' || launch.launchKind === 'compose' ? launch.launchId : id,
      launches: num(u?.['launches']),
      lastUsedAt: str(u?.['lastUsedAt']),
      medianMinutes: median,
    });
  });
  // An entry whose category the catalog did not list sits under More; More is listed only if used.
  if (entries.some((e) => e.category === MORE_CATEGORY.id) && !known.has(MORE_CATEGORY.id)) categories.push(MORE_CATEGORY);
  return { source: 'catalog', categories, entries };
}

/** Studio's own kinds, when the catalog does not list them (demo and draft epics are launched by studio). */
export function withStudioKinds(view: CatalogView, extras: readonly CatalogEntry[]): CatalogView {
  // A kind the catalog lists in ANY state (by its card id or its launch target) is the catalog's: a
  // coming-soon or unavailable Demo video is never shadowed by studio's own ready one.
  const have = new Set(view.entries.flatMap((e) => [e.id, e.launchId]));
  const add = extras.filter((e) => !have.has(e.id) && !have.has(e.launchId)).map((e, i) => ({
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
    const useWhen = Array.isArray(def?.use_when) ? strs(def?.use_when).join('. ') : str(def?.use_when);
    return {
      id: r.workflowId,
      launchId: r.workflowId,
      launchKind: 'run',
      docStyle: null,
      title: str(def?.title) ?? workflowLabel(r.key),
      category: null,
      subcategory: null,
      gets: workflowPurpose(r.key, summary !== '' ? summary : r.line),
      summary: [summary, useWhen].filter((s): s is string => s !== null && s !== '').join(' '),
      needs: ['repo'],
      inputs: [],
      form: false,
      time: null,
      cost: null,
      delivers: null,
      tags: [],
      synonyms: [],
      status: 'ready',
      statusNote: null,
      order: i,
      artKey: r.key,
      launches: 0,
      lastUsedAt: null,
      medianMinutes: null,
    };
  });
  return { source: 'fallback', categories: [], entries };
}

// ── The top section ────────────────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;
/** Half-weight after this many days without a launch (launches / (1 + days / HALF_DAYS)). */
export const TOP_HALF_DAYS = 14;
/** One row of cards at the desktop width (three across). */
export const TOP_MAX = 3;

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
    .filter((e) => e.launches > 0 && e.status === 'ready')
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
  /** Show the workflows that are coming soon or unavailable (on by default: the operator sees what is coming). */
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
    && (f.showSoon || e.status === 'ready'));
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

/** The word still being typed: the query's last word when it does not end in a space or punctuation
 *  and is not a stop word ("auth for" is typing "for", which matches nothing). */
export function typingWord(query: string): string | null {
  if (!/[\p{L}\p{N}]$/u.test(query)) return null;
  const last = query.toLowerCase().split(/[^\p{L}\p{N}]+/u).pop() ?? '';
  return last === '' || STOP.has(last) ? null : last;
}

export function tokens(text: string): string[] {
  return text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t !== '' && !STOP.has(t)).map(stem).filter((t) => t !== '' && !STOP.has(t));
}

const FIELD_WEIGHT = { title: 6, words: 4, gets: 2, other: 1 } as const;
const EXPANSION_FACTOR = 0.5;

function fieldTokens(e: CatalogEntry, categoryTitle: string): { t: Set<string>; w: number }[] {
  return [
    // A run card is named by its workflow, not its card id (`run:<name>` would make every one match "run").
    { t: new Set([...tokens(e.title), ...tokens(e.launchKind === 'run' ? e.launchId : e.id)]), w: FIELD_WEIGHT.title },
    { t: new Set([...e.tags, ...e.synonyms].flatMap(tokens)), w: FIELD_WEIGHT.words },
    { t: new Set([...tokens(e.gets), ...tokens(e.summary)]), w: FIELD_WEIGHT.gets },
    { t: new Set([...e.needs.flatMap(tokens), ...tokens(categoryTitle), ...tokens(e.subcategory ?? ''), ...e.inputs.flatMap((i) => tokens(i.label))]), w: FIELD_WEIGHT.other },
  ];
}

/** A token's best field match. `typing` (the last word of the query, still being typed) also
 *  matches by prefix; a whole earlier word must match whole ("auth" is not "author"). */
function tokenScore(q: string, fields: readonly { t: Set<string>; w: number }[], typing: boolean): number {
  let best = 0;
  for (const f of fields) {
    if (f.t.has(q)) best = Math.max(best, f.w);
    else if (typing && q.length >= 3) {
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
  let matched = 0;
  // The last word is still being typed only when the query does not end in a space or punctuation.
  const typingLast = typingWord(query) !== null;
  for (const [i, q] of qs.entries()) {
    const direct = tokenScore(q, fields, typingLast && i === qs.length - 1);
    let expanded = 0;
    for (const x of own(LEXICON, q) ?? []) expanded = Math.max(expanded, tokenScore(stem(x), fields, false) * EXPANSION_FACTOR);
    const best = Math.max(direct, expanded);
    if (best > 0) matched += 1;
    score += best;
  }
  // Weighted toward workflows that answer more of the sentence (a weighting, not a guarantee: a strong
  // title match on one word can still lead).
  score *= 0.5 + (0.5 * matched) / qs.length;
  const title = e.title.toLowerCase();
  const whole = query.trim().toLowerCase();
  // The whole-query prefix bonus is for a query still being typed ("auth " and "auth for" are not "Author").
  const target = (e.launchKind === 'run' ? e.launchId : e.id).toLowerCase();
  if (typingLast && whole.length >= 2 && (title.startsWith(whole) || target.startsWith(whole))) score += 4;
  return score;
}

/** The entries a query matches, best first (ties: what this operator uses more, then catalog order). */
export function searchCatalog(view: CatalogView, query: string, now: number): CatalogEntry[] {
  const title = new Map(view.categories.map((c) => [c.id, c.title] as const));
  return view.entries
    .map((e) => ({ e, s: scoreEntry(e, query, title.get(e.category ?? '') ?? '') }))
    .filter((x) => x.s > 0)
    // What can start now ranks above what cannot (coming soon, unavailable), then by score.
    .sort((a, b) => Number(b.e.status === 'ready') - Number(a.e.status === 'ready') || b.s - a.s || usageScore(b.e, now) - usageScore(a.e, now) || a.e.order - b.e.order)
    .map((x) => x.e);
}

/** What an entry ends with, in plain words. */
const DELIVERS_WORDS: Readonly<Record<string, string>> = {
  pr: 'a pull request', document: 'a document', video: 'a video', report: 'a report', answer: 'an answer', none: 'nothing to deliver',
};
export function deliversWord(d: string | null): string | null {
  return d === null ? null : own(DELIVERS_WORDS, d) ?? null;
}

/** The words a card's meta line shows: what it needs, then time and cost. */
const NEED_WORDS: Readonly<Record<string, string>> = {
  repo: 'a repository',
  project: 'a project',
  running_app: 'a running app',
  requirements: 'requirements',
  document: 'a document',
  runs: 'runs to review',
};
export function needWord(n: string): string {
  return own(NEED_WORDS, n) ?? n.replace(/[-_]+/g, ' ');
}
export function needsLine(e: Pick<CatalogEntry, 'needs'>): string {
  if (e.needs.length === 0) return 'Works without a repository';
  const words = e.needs.map(needWord);
  return `Needs ${words.length === 1 ? words[0] : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`}`;
}
