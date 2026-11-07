import type { WorkflowDef } from '../api/types.js';
import type { Preset } from '../api/teamPlan.js';
import type { CatalogLoad } from '../store/workflowCatalog.js';
import { DEMO_VIDEO_LINE } from './demoLaunch.js';
import { isDocFormat } from './everythingModel.js';
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
export type LaunchKind = 'run' | 'demo' | 'compose' | 'document' | 'chat' | 'app' | 'repo' | 'none';

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

/** The input kinds WIRE v1 defines; any other kind is an input studio cannot ask for. */
const INPUT_KINDS: readonly string[] = ['text', 'repo', 'project', 'url', 'requirements', 'seats'];

/** The form, or null when it is missing or any input in it cannot be read (then the words stay required):
 *  no id, or a kind studio does not know (codex r3: a required unknown kind must not relax the words). */
function inputsOf(v: unknown): CatalogInput[] | null {
  if (!Array.isArray(v)) return null;
  const out = v.flatMap((x) => {
    const r = rec(x);
    const key = str(r?.['id']);
    const kind = str(r?.['kind']);
    if (r === null || key === null || kind === null || !INPUT_KINDS.includes(kind)) return [];
    // Fail closed: only an explicit `required: false` makes an input optional.
    return [{ key, label: str(r['label']) ?? key, kind, required: r['required'] !== false }];
  });
  return out.length === v.length ? out : null;
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
    case 'document': {
      // A document card names a format New document makes; a missing or unknown one is not offered (codex r4).
      const style = str(r?.['style']);
      if (!isDocFormat(style)) return { launchKind: 'none', launchId: `none:${id}`, docStyle: null };
      return { launchKind: 'document', launchId: `document:${id}`, docStyle: style };
    }
    case 'chat': return { launchKind: 'chat', launchId: `chat:${id}`, docStyle: null };
    // ux-tonight (api-types 0.187.0): a new app by chat (DES-APPS-001 §6.2), and Add a repository (registering onboards).
    case 'app': return { launchKind: 'app', launchId: `app:${id}`, docStyle: null };
    case 'repo': return { launchKind: 'repo', launchId: `repo:${id}`, docStyle: null };
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
    const form = inputsOf(r['inputs']);
    const status = launch.launchKind === 'none' && statusOf(r['status']) === 'ready' ? 'unavailable' : statusOf(r['status']);
    const median = num(u?.['medianMinutes']) > 0 ? Math.max(1, Math.round(num(u?.['medianMinutes']))) : null;
    entries.push({
      id,
      ...launch,
      title: str(r['title']) ?? String(workflowLabel(launch.launchKind === 'run' ? launch.launchId : id)),
      category: cat !== null && known.has(cat) ? cat : MORE_CATEGORY.id,
      subcategory: cat !== null && sub !== null ? subTitle.get(`${cat}/${sub}`) ?? null : null,
      gets: str(r['outcome']) ?? str(r['summary']) ?? String(workflowPurpose(launch.launchKind === 'run' ? launch.launchId : id, '')),
      summary,
      // Fail closed: a missing or malformed `needs` (not a list, or any item not a word) needs a repository.
      needs: Array.isArray(r['needs']) && strs(r['needs']).length === r['needs'].length
        ? [...new Set(strs(r['needs']).filter((n) => n !== 'nothing'))] : ['repo'],
      inputs: form ?? [],
      form: form !== null,
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

/** Whether a pick starts this entry: it is ready and studio knows how to launch it (New job's cards
 *  and the `/` rows alike). */
export function entryOffered(e: Pick<CatalogEntry, 'status' | 'launchKind'>): boolean {
  return e.status === 'ready' && e.launchKind !== 'none';
}

/** Studio's own kinds, when the catalog does not list them (demo and draft epics are launched by studio). */
export function withStudioKinds(view: CatalogView, extras: readonly CatalogEntry[]): CatalogView {
  // slash-catalog (the brief's rule): a daemon whose catalog lists nothing says so; studio's own kinds
  // bridge a catalog that predates them, never stand in for an empty one.
  if (view.source === 'catalog' && view.entries.length === 0) return view;
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

/** "Draft epics" (operator 2026-10-12): a project's requirements become epics, features and stories. */
export const DRAFT_EPICS_LINE = 'Turn requirements into epics and stories';
/** Studio's own kinds in the catalog (launched through their own routes). */
const studioEntry = (e: Pick<CatalogEntry, 'id' | 'title' | 'category' | 'gets' | 'needs' | 'status' | 'tags' | 'launchKind' | 'delivers'>): CatalogEntry => ({
  launchId: e.id, docStyle: null, subcategory: null, summary: '', inputs: [], form: false, time: null, cost: null, synonyms: [], statusNote: null,
  order: 0, artKey: e.id, launches: 0, lastUsedAt: null, medianMinutes: null, ...e,
});
/** Studio's own kinds, added when the catalog does not list them (an older daemon never does). */
export const STUDIO_KINDS: readonly CatalogEntry[] = [
  studioEntry({ id: STUDIO_KIND_DEMO, launchKind: 'demo', title: 'Demo video', category: 'create', gets: DEMO_VIDEO_LINE, needs: ['running_app'], status: 'ready', delivers: 'video', tags: ['demo', 'video', 'recording', 'walkthrough'] }),
  studioEntry({ id: STUDIO_KIND_DRAFT_EPICS, launchKind: 'compose', title: 'Draft epics', category: 'more', gets: DRAFT_EPICS_LINE, needs: ['project', 'requirements'], status: 'ready', delivers: null, tags: ['epics', 'stories', 'backlog', 'requirements', 'planning'] }),
];

/**
 * THE ONE LIST OF KINDS OF JOB (slash-catalog, operator 2026-11-04: "the slash commands in the chatbox
 * don't match the list of workflows when I see the new job modal"). New job's catalog step and every
 * box's `/` menu read this view, so they list the same entries under the same titles and categories:
 * crew's catalog with studio's own kinds added; on an older daemon (no catalog route), today's list.
 * null while the catalog is read, and when a daemon that serves one failed to answer: today's list
 * never stands in for its catalog.
 */
export function jobCatalogView(load: CatalogLoad, defs: readonly WorkflowDef[] | null, presets: readonly Preset[] | null): CatalogView | null {
  if (load.state === 'ready') return withStudioKinds(load.view, STUDIO_KINDS);
  if (load.state === 'loading' || load.state === 'error') return null;
  // An older daemon: today's list. Its defs may never come (no `/workflows`, or the read failed and the
  // cache keeps "not known"), so studio's own kinds show at once and the daemon's join when they land.
  return withStudioKinds(catalogFromDefs(defs ?? [], presets), STUDIO_KINDS);
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
  /** Show the workflows that cannot start here (unavailable on this daemon, or marked coming soon by its catalog); on by default. */
  showSoon: boolean;
}
export const NO_FILTERS: CatalogFilters = { category: null, repo: 'any', showSoon: true };

export function needsRepo(e: Pick<CatalogEntry, 'needs'>): boolean {
  return e.needs.includes('repo');
}

/** An entry a pick starts in the chat it is made in (ux-tonight, operator 2026-11-04: "clicking on a workflow opens a
 *  modal rather than starting an inline chat"): a workflow run, or a new app by chat. The composer holds it and its
 *  next Enter starts it; what it still needs is asked there. */
export function startsInline(e: Pick<CatalogEntry, 'launchKind'>): boolean {
  return e.launchKind === 'run' || e.launchKind === 'app';
}

/** What an entry asks for its words (New job's rule): its form's first text input, optional only when the catalog's
 *  form says every text input is (a run; crew still needs a problem, so a launch with none sends the summary). */
export function entryWords(e: Pick<CatalogEntry, 'inputs' | 'form' | 'launchKind'>): { label: string; optional: boolean } {
  const texts = e.inputs.filter((i) => i.kind === 'text');
  const optional = e.launchKind === 'run' && e.form && texts.every((i) => !i.required);
  return { label: texts[0]?.label ?? (optional ? 'Anything to focus on?' : 'What do you want done?'), optional };
}

/** Whether an entry must have a project to start: a run whose card needs one, and a new app (an app belongs to one). */
export function needsProject(e: Pick<CatalogEntry, 'needs' | 'launchKind'>): boolean {
  return e.launchKind === 'app' || (e.launchKind === 'run' && e.needs.includes('project'));
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
  // Stemmed too: "needs" stems to the stop word "need", which `tokens` drops (xreview r2).
  return last === '' || STOP.has(last) || STOP.has(stem(last)) ? null : last;
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
