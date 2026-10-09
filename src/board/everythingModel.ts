import type { DocSummary } from '../api/interactive.js';
import { isDemoRun } from '../api/demo.js';
import type { SessionView } from '../api/types.js';
import { deliveryOf, resolveDelivery } from '../components/delivery.js';
import { humanTitle } from '../components/runIdentity.js';
import type { RailGroup } from './deskModel.js';
import { endedAtMs } from './needsYou.js';
import { sessionIdOf, type SessionState } from './sessionModel.js';

/**
 * "SEE EVERYTHING" (`/everything`, DES-STUDIO-REBUILD-001 §5.4, slice S15c) — the model. Pure folds
 * over what studio already reads; `components/everything/EverythingPage.tsx` renders them.
 *
 * Five tabs, one page: Sessions (what `/work`, `/chats`, `/execute` and the project
 * chronicle listed, as sessions — a chat and the runs launched from it), Everything made (the
 * documents, pages, decks and videos across every project — what `/vibe` and `/demo` showed),
 * Helpers (the roster and each seat's sign-in), Handed over (the runs whose work left this machine
 * as a pull request or a pushed branch), and Projects (the project register). The tab, the Sessions filter, the project scope and the
 * Made kind all ride the query string, so every view is an address: deep-linkable, Back-correct, and
 * the target of the §5.4 moves (`hooks/useMovedRoutes.ts`).
 */

export const EVERYTHING_TABS = ['sessions', 'made', 'helpers', 'handed', 'projects'] as const;
export type EverythingTab = (typeof EVERYTHING_TABS)[number];

export const TAB_LABEL: Readonly<Record<EverythingTab, string>> = {
  sessions: 'Sessions',
  made: 'Everything made',
  helpers: 'Helpers',
  handed: 'Handed over',
  projects: 'Projects',
};

export function isEverythingTab(v: unknown): v is EverythingTab {
  return typeof v === 'string' && (EVERYTHING_TABS as readonly string[]).includes(v);
}

// ── The Sessions filter: the old `/work?filter=` words, kept, plus `waiting` ─────────────────

/** `all` · `active` (working or waiting) · `waiting` (on you) · `completed` · `failed` · `cancelled`. */
export const SESSION_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Working' },
  { id: 'waiting', label: 'Waiting on you' },
  { id: 'completed', label: 'Done' },
  { id: 'failed', label: 'Blocked' },
  { id: 'cancelled', label: 'Stopped' },
  // The old Work page's "show archived" toggle, as a lens: the archived runs (`GET /runs?archived`),
  // each with Unarchive — read only when picked.
  { id: 'archived', label: 'Archived' },
] as const;
export type SessionFilter = (typeof SESSION_FILTERS)[number]['id'];

export function isSessionFilter(v: unknown): v is SessionFilter {
  return typeof v === 'string' && SESSION_FILTERS.some((f) => f.id === v);
}

// ── The Sessions view: grouped (sessions) or every run (S17b) ─────────────────────────────────

/** `grouped` — one row per session (the default, what §5.3 lists); `runs` — one row per RUN, the
 *  sortable/filterable/paged "Every run" table (`?view=runs`). Carried like a filter: a lens, not a page. */
export const EVERYTHING_VIEWS = ['grouped', 'runs'] as const;
export type EverythingView = (typeof EVERYTHING_VIEWS)[number];

export function isEverythingView(v: unknown): v is EverythingView {
  return typeof v === 'string' && (EVERYTHING_VIEWS as readonly string[]).includes(v);
}

/** Whether a session in `state` shows under `filter` — `active` is live work, waiting on you included. */
export function matchesSessionFilter(state: SessionState, filter: SessionFilter): boolean {
  switch (filter) {
    case 'all': return true;
    case 'active': return state === 'working' || state === 'waiting';
    case 'waiting': return state === 'waiting';
    case 'completed': return state === 'done';
    case 'failed': return state === 'blocked';
    case 'cancelled': return state === 'quiet';
    case 'archived': return false; // archived runs are a separate read, never in the live groups
  }
}

/** The groups the Sessions tab shows: one project's, or every project's; then the state filter. Empty groups go. */
export function filterGroups(groups: readonly RailGroup[], filter: SessionFilter, project: string | null): RailGroup[] {
  return groups
    .filter((g) => project === null || g.projectId === project)
    .map((g) => ({ ...g, sessions: g.sessions.filter((s) => matchesSessionFilter(s.state, filter)) }))
    .filter((g) => g.sessions.length > 0);
}

/**
 * The Sessions search (S18b, the retired Work page's search box): the sessions whose title — or, when
 * the caller passes it, the problem of any of their runs — holds every word of `query`, across every
 * group. Case-insensitive; a blank query returns the groups as they are; empty groups go. The page
 * hands it the project-scoped groups BEFORE the state filter: a non-empty search lifts the filter.
 */
export function searchGroups(
  groups: readonly RailGroup[],
  query: string,
  problemOf: (runId: string) => string | undefined = () => undefined,
): RailGroup[] {
  const words = query.toLowerCase().split(/\s+/).filter((w) => w !== '');
  if (words.length === 0) return groups.map((g) => ({ ...g }));
  const hit = (s: RailGroup['sessions'][number]): boolean => {
    const hay = [s.title, ...s.runIds.map((r) => problemOf(r) ?? '')].join('\n').toLowerCase();
    return words.every((w) => hay.includes(w));
  };
  return groups
    .map((g) => ({ ...g, sessions: g.sessions.filter(hit) }))
    .filter((g) => g.sessions.length > 0);
}

// ── Everything made: documents · pages · decks · videos ──────────────────────────────────────

export const MADE_KINDS = [
  { id: 'all', label: 'All' },
  { id: 'documents', label: 'Documents' },
  { id: 'pages', label: 'Pages' },
  { id: 'decks', label: 'Decks' },
  { id: 'videos', label: 'Videos' },
] as const;
export type MadeKind = (typeof MADE_KINDS)[number]['id'];
export type MadeThing = Exclude<MadeKind, 'all'>;

export function isMadeKind(v: unknown): v is MadeKind {
  return typeof v === 'string' && MADE_KINDS.some((k) => k.id === v);
}

export const MADE_WORD: Readonly<Record<MadeThing, string>> = {
  documents: 'document', pages: 'page', decks: 'deck', videos: 'video',
};

/** What a registry row is: a demo is a video; the recorded style says page (`web`) or deck (`ppt`); else a document. */
export function madeKindOf(doc: Pick<DocSummary, 'kind' | 'style'>): MadeThing {
  if (doc.kind === 'demo') return 'videos';
  if (doc.style === 'web') return 'pages';
  if (doc.style === 'ppt') return 'decks';
  return 'documents';
}

export interface MadeRow {
  key: string;
  kind: MadeThing;
  title: string;
  projectId: string | null;
  /** Unix ms, or null when the wire carries no clock. */
  updatedAt: number | null;
  /** A registry document (opened on its document route). */
  doc?: { name: string; kind: DocSummary['kind']; grounding?: DocSummary['grounding'] };
  /** A demo run's video (opened on the run). */
  runId?: string;
  /** The demo run's status, for a video row (`completed`, `executing`, …). */
  runStatus?: string;
}

function isoMs(s: string | null): number | null {
  if (s === null) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

function launchedMs(v: SessionView): number {
  const c = (v.session as unknown as { created_at?: unknown }).created_at;
  return typeof c === 'number' && Number.isFinite(c) ? c * 1000 : 0;
}

function projectOf(v: SessionView, projectIdByRun: Readonly<Record<string, string | undefined>>): string | null {
  const p = (v.session as unknown as { project_id?: unknown }).project_id;
  if (typeof p === 'string' && p !== '') return p;
  return projectIdByRun[v.session.id] ?? null;
}

/**
 * Everything made, newest first: every document in the docs cache (what the daemon's index listed,
 * or what the projects opened this session listed) plus every demo run's video. Filtered by `kind`
 * and, when one is named, by `project`.
 */
export function madeRows(
  byProject: Readonly<Record<string, readonly DocSummary[]>>,
  runs: readonly SessionView[],
  projectIdByRun: Readonly<Record<string, string | undefined>>,
  kind: MadeKind = 'all',
  /** One project's rows (`?project=`), else every project's. */
  project: string | null = null,
): MadeRow[] {
  const out: MadeRow[] = [];
  for (const [pid, docs] of Object.entries(byProject)) {
    for (const d of docs) {
      out.push({ key: `doc:${pid}:${d.name}`, kind: madeKindOf(d), title: d.name, projectId: pid, updatedAt: isoMs(d.updated_at), doc: { name: d.name, kind: d.kind, ...(d.grounding !== undefined ? { grounding: d.grounding } : {}) } });
    }
  }
  for (const v of runs) {
    if (!isDemoRun(v) || v.session.archived_at != null) continue;
    const ended = endedAtMs(v);
    out.push({
      key: `run:${v.session.id}`,
      kind: 'videos',
      title: humanTitle(v.session.problem || v.session.id),
      projectId: projectOf(v, projectIdByRun),
      updatedAt: ended ?? (launchedMs(v) || null),
      runId: v.session.id,
      runStatus: v.session.status,
    });
  }
  return out
    .filter((r) => (kind === 'all' || r.kind === kind) && (project === null || r.projectId === project))
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0) || a.title.localeCompare(b.title));
}

// ── Handed over: the runs whose work left this machine ───────────────────────────────────────

export type HandedClaim = 'pr-open' | 'delivered' | 'pushed';

export interface HandedRow {
  runId: string;
  /** The session it belongs to (`/s/:id`). */
  sessionId: string;
  title: string;
  projectId: string | null;
  /** When it ended, else when it launched (unix ms). */
  when: number;
  claim: HandedClaim;
  /** The pull request, when one is in hand (the one thing that licenses the PR claim). */
  href: string | null;
  /** The branch a push-only delivery landed on, when the wire named it. */
  branch: string | null;
}

/**
 * The delivered runs, newest first. A run counts when the wire says its work was handed over
 * (`delivered`, with or without a PR url in hand, or `pushed` to a branch) — or when this session's
 * post-hoc Deliver just landed it (`deliveredNow`), before the run list catches up. Stranded and
 * failed deliveries are needs-you items, not hand-overs, and are not here.
 */
export function handedRows(
  runs: readonly SessionView[],
  deliveredNow: ReadonlySet<string>,
  runChatId: boolean,
  projectIdByRun: Readonly<Record<string, string | undefined>>,
): HandedRow[] {
  const out: HandedRow[] = [];
  for (const v of runs) {
    if (v.session.archived_at != null) continue;
    const d = resolveDelivery(deliveryOf(v));
    const justNow = deliveredNow.has(v.session.id);
    if (d.claim !== 'pr-open' && d.claim !== 'delivered' && d.claim !== 'pushed' && !justNow) continue;
    const claim: HandedClaim = d.claim === 'pr-open' || d.claim === 'pushed' ? d.claim : 'delivered';
    out.push({
      runId: v.session.id,
      sessionId: sessionIdOf(v, runChatId),
      title: humanTitle(v.session.problem || v.session.id),
      projectId: projectOf(v, projectIdByRun),
      when: endedAtMs(v) ?? launchedMs(v),
      claim,
      href: d.href,
      branch: d.pushed?.branch ?? null,
    });
  }
  return out.sort((a, b) => b.when - a.when || a.title.localeCompare(b.title));
}

// ── The address ──────────────────────────────────────────────────────────────────────────────

export interface EverythingQuery {
  tab: EverythingTab;
  filter: SessionFilter;
  /** One project's sessions (`?project=`), else every project's. */
  project: string | null;
  kind: MadeKind;
  /** The Sessions view (`?view=`): grouped by session (default) or every run as a table. */
  view: EverythingView;
  /** S16a-4c: on the Made tab, a document no run is bound to, opened at full size (`?open=<doc>`). */
  open?: string | null;
}

/** `?tab=` · `?filter=` · `?project=` · `?kind=` off a `location.search`; anything unknown takes the default. */
export function readEverythingQuery(search: string): EverythingQuery {
  const q = new URLSearchParams(search);
  const tab = q.get('tab');
  const filter = q.get('filter');
  const project = q.get('project');
  const kind = q.get('kind');
  const view = q.get('view');
  return {
    tab: isEverythingTab(tab) ? tab : 'sessions',
    filter: isSessionFilter(filter) ? filter : 'all',
    project: project !== null && project !== '' ? project : null,
    kind: isMadeKind(kind) ? kind : 'all',
    view: isEverythingView(view) ? view : 'grouped',
    open: q.get('open') !== null && q.get('open') !== '' ? q.get('open') : null,
  };
}

/**
 * The one spelling of a "See everything" address. Only what the caller names is written: `/everything`
 * is the Sessions tab; `everythingPath({ tab: 'sessions' })` says so in the address (the moves carry
 * the tab they land on); defaults (`filter: 'all'`, `kind: 'all'`) are never written.
 */
export function everythingPath(q: Partial<EverythingQuery> = {}): string {
  const p = new URLSearchParams();
  if (q.tab !== undefined) p.set('tab', q.tab);
  if (q.filter !== undefined && q.filter !== 'all') p.set('filter', q.filter);
  if (q.project !== undefined && q.project !== null && q.project !== '') p.set('project', q.project);
  if (q.kind !== undefined && q.kind !== 'all') p.set('kind', q.kind);
  if (q.view !== undefined && q.view !== 'grouped') p.set('view', q.view);
  if (q.open !== undefined && q.open !== null && q.open !== '') p.set('open', q.open);
  const s = p.toString();
  return s === '' ? '/everything' : `/everything?${s}`;
}
