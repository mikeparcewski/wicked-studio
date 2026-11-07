import { apiFetch } from '../../api/client.js';
import { ApiError } from '../../api/errors.js';
import type { AppDetail, AppDetailResponse, AppSpec, AppsListResponse } from '../../api/types.js';
import { cellText } from '../../plugins/wicked-apps/runtime/format.js';
import type { AppHostPort } from './appAdapter.js';
import { sampleAppData, type AppDataPort, type SampleData } from './appData.js';
import type { AppSession } from './appSession.js';
import type { AppStorePort, StoreResult, VersionReadResult } from './appStore.js';
import { SampleAppStore, archivedOf } from './appStore.js';

export { archivedOf } from './appStore.js';
import { SAMPLE_APPS } from './samples.js';

/**
 * The Apps page's data (slice K4, operator 2026-11-03: "a dashboard of the available apps"): one tile per app, from
 * crew's app store when it serves one (`GET /apps`, then each app's `GET /apps/:app`: store reads, never a source
 * read), else the two sample apps, labelled samples. A tile's numbers come only from what is already at hand: the
 * sample's own rows in this browser; with crew, none (a tile never starts a query).
 */

/**
 * A published copy of an app (lane K6 builds the signed-in app server; its address is the share link), as K6 proposed
 * it for api-types (ledger 2026-11-03T18:26Z: `AppDetail.published: AppPublished | null`). Studio reads only the fields
 * the Share sheet shows, field by field, and shows a share link only when crew reports one: it never makes one up.
 */
export interface AppPublished {
  /** The site's address (its origin and `/`): what people are sent, and what Copy copies. */
  shareUrl: string;
  /** Who can open it, in one line ("people in group support-ops who sign in at dex.apps.test"). */
  audience: string;
  /** The `<iframe>` snippet, when the publish allows embedding (public apps); shown and copied exactly as crew wrote it. */
  snippet: string | null;
  /** The version published, and when (Unix millis). */
  version: number;
  at: number;
}

/** An app's address segment: crew's slug grammar (api-types `AppSummary.slug`), never `check` or `uploads`. */
export function isAppSlug(v: unknown): boolean {
  return typeof v === 'string' && v.length <= 48 && /^[a-z][a-z0-9]*(-[a-z0-9]+){0,3}$/u.test(v) && v !== 'check' && v !== 'uploads';
}

const httpUrl = (v: unknown): string | null => {
  if (typeof v !== 'string' || v.length > 2_048) return null;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch { return null; }
};
const line = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim().slice(0, max) : null);
const isTime = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0 && !Number.isNaN(new Date(v).getTime());

/** The attributes an embed snippet may carry, each at most once (anything else, `srcdoc` or `on*` included, refuses it).
 *  `style` only as K6 writes it (`border:0`). */
const SNIPPET_ATTRS = new Set(['src', 'title', 'width', 'height', 'style', 'loading', 'allow', 'referrerpolicy', 'sandbox', 'allowfullscreen']);

/**
 * crew's embed snippet, only when it is exactly ONE `<iframe …></iframe>` of the published site, in the shape K6's
 * publish writes (crew `apps/publish/service.ts`): double-quoted attributes from {@link SNIPPET_ATTRS}; no `<`, `>` or
 * quote inside a value, and `&` only as `&#N;` or `&amp;` (K6 escapes a name that way), never in `src`; a `src` on the
 * share link's own origin; nothing before or after it; and no CR (a text area would show a different string than Copy
 * copies). The person pastes it into their own pages, so anything else (another element, a handler, `srcdoc`, a
 * lookalike host, a style other than `border:0`) is not shown at all (codex/pi r10, r11).
 */
export function snippetOf(v: unknown, shareUrl: string): string | null {
  if (typeof v !== 'string' || v.length > 2_000 || v.includes('\r')) return null;
  const m = /^<iframe((?:[ \t\n]+[a-z]+(?:="(?:[^"<>&]|&#[0-9]{1,7};|&amp;)*")?)*)[ \t\n]*><\/iframe>$/u.exec(v);
  if (m === null) return null;
  const seen = new Set<string>();
  let src: string | null = null;
  for (const a of m[1]!.matchAll(/([a-z]+)(?:="([^"]*)")?/gu)) {
    const name = a[1]!;
    if (!SNIPPET_ATTRS.has(name) || seen.has(name)) return null;
    seen.add(name);
    if (name === 'src') { if ((a[2] ?? '').includes('&')) return null; src = a[2] ?? null; }
    if (name === 'style' && a[2] !== 'border:0') return null;
  }
  const at = httpUrl(src);
  return at !== null && new URL(at).origin === new URL(shareUrl).origin ? v : null;
}

/** crew's published record, read field by field; anything missing or malformed means "not published". */
export function publishedOf(detail: unknown): AppPublished | null {
  const p = typeof detail === 'object' && detail !== null ? (detail as { published?: unknown }).published : undefined;
  if (typeof p !== 'object' || p === null) return null;
  const r = p as Record<string, unknown>;
  const shareUrl = httpUrl(r['shareUrl']);
  const audience = line(r['audience'], 300);
  const version = r['version'];
  if (shareUrl === null || audience === null || typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1 || !isTime(r['at'])) return null;
  return { shareUrl, audience, snippet: snippetOf(r['snippet'], shareUrl), version, at: r['at'] };
}

export interface TileKpi { title: string; value: string | null }

export interface AppTileData {
  slug: string;
  name: string;
  description: string;
  sample: boolean;
  /** The sample's key (`?sample=`), for a sample tile. */
  sampleKey: string | null;
  /** The app's detail, read for its preview; null when the card is drawn from crew's list alone (see `note`). */
  detail: AppDetail | null;
  /** Why the card has no detail ("its details could not be read: …"), or null. */
  note: string | null;
  /** `v14 · reviewed`. */
  version: string;
  /** When it last changed (or was made, from the list alone); null when crew's record has no time. */
  changedAt: number | null;
  sources: string[];
  kpis: TileKpi[];
  published: AppPublished | null;
  /** The app's project, as crew records it (crew's apps only). */
  projectId?: string;
  /** (G16) crew's archived state: `{at, by}`, `null` (active), or `undefined` (crew does not archive: no Archive offered). */
  archived?: { at: number; by: string } | null;
}

export type AppsDirectory =
  | {
    source: 'crew' | 'sample'; apps: AppTileData[]; /** Listed apps whose address is not an app slug: not shown. */ skipped: number;
    /** (G16) crew archives: its records carry `archived` (read from the whole list, so it holds when every app is archived). */
    archives?: boolean;
  }
  | { source: 'error'; message: string };

/** Crew's apps get a preview (one detail read each) up to this many; the rest show from the list alone. */
export const PREVIEW_LIMIT = 24;

export function receiptWords(app: AppDetail): string {
  const v = app.versions.find((x) => x.version === app.head.version);
  const r = v?.receipt;
  if (r == null) return 'not accepted';
  if (r.kind === 'restored') return `restored from v${r.restoredFrom?.version ?? '?'}`;
  return r.kind;
}

function sourcesOf(spec: AppSpec): string[] {
  const named = [...spec.queries, ...spec.actions].map((x) => (x as { source?: unknown }).source).filter((v): v is string => typeof v === 'string' && v !== '');
  return [...new Set(named)].slice(0, 6).map((v) => v.slice(0, 60));
}

/** The first page's KPI components (up to three): their titles, and their values when the rows are at hand. */
async function kpisOf(spec: AppSpec, data: SampleData | null): Promise<TileKpi[]> {
  const page = spec.pages[0];
  const kpis = (page?.components ?? []).filter((c) => c.type === 'kpi').slice(0, 3);
  const port = data === null ? null : sampleAppData(() => spec, data);
  const out: TileKpi[] = [];
  for (const k of kpis) {
    if (k.type !== 'kpi') continue;
    const title = (k.title ?? k.value).slice(0, 60);
    if (port === null) { out.push({ title, value: null }); continue; }
    const r = await port.query(0, k.data.query, {});
    const i = 'error' in r ? -1 : r.columns.findIndex((c) => c.name === k.value);
    const first = 'error' in r ? undefined : r.rows[0];
    out.push({ title, value: first === undefined || i < 0 ? null : cellText(first[i], k.format, typeof navigator !== 'undefined' ? navigator.language : 'en') });
  }
  return out;
}

/** Whether crew's detail has the shape a card reads (crew's records are data: one malformed record is one card's). */
function detailOk(d: unknown, slug: string): d is AppDetail {
  if (typeof d !== 'object' || d === null) return false;
  const a = d as Record<string, unknown>;
  const spec = a['spec'] as Record<string, unknown> | null | undefined;
  const head = a['head'] as Record<string, unknown> | null | undefined;
  return a['slug'] === slug && typeof a['name'] === 'string' && Array.isArray(a['versions']) && typeof head === 'object' && head !== null
    && Number.isSafeInteger(head['version']) && typeof spec === 'object' && spec !== null && Array.isArray(spec['pages'])
    && Array.isArray(spec['queries']) && Array.isArray(spec['actions']) && (spec['description'] === undefined || typeof spec['description'] === 'string');
}

async function tileOf(detail: AppDetail, sample: { key: string; data: SampleData } | null): Promise<AppTileData> {
  const head = detail.versions.find((v) => v.version === detail.head.version);
  return {
    slug: detail.slug,
    name: detail.name.slice(0, 120),
    description: (detail.spec.description ?? '').slice(0, 300),
    sample: sample !== null,
    sampleKey: sample?.key ?? null,
    detail,
    note: null,
    version: `v${detail.head.version} · ${receiptWords(detail)}`,
    changedAt: isTime(head?.at) ? head.at : isTime(detail.createdAt) ? detail.createdAt : null,
    sources: sourcesOf(detail.spec),
    kpis: await kpisOf(detail.spec, sample?.data ?? null),
    published: publishedOf(detail),
    ...(sample === null && typeof detail.projectId === 'string' ? { projectId: detail.projectId } : {}),
    ...(sample === null && archivedOf(detail) !== undefined ? { archived: archivedOf(detail)! } : {}),
  };
}

/** A card from crew's list entry alone: its name, version and receipt, no preview, no numbers, no share state. */
function summaryTile(a: Record<string, unknown>, slug: string, note: string | null): AppTileData {
  const head = typeof a['head'] === 'object' && a['head'] !== null ? a['head'] as Record<string, unknown> : {};
  const v = Number.isSafeInteger(head['version']) ? `v${head['version'] as number}` : 'v?';
  const receipt = typeof head['receipt'] === 'string' ? head['receipt'] : 'not accepted';
  return {
    slug, name: line(a['name'], 120) ?? slug, description: '', sample: false, sampleKey: null, detail: null, note,
    version: `${v} · ${receipt}`, changedAt: isTime(a['createdAt']) ? a['createdAt'] : null, sources: [], kpis: [], published: null,
    ...(typeof a['projectId'] === 'string' ? { projectId: a['projectId'] } : {}),
    ...(archivedOf(a) !== undefined ? { archived: archivedOf(a)! } : {}),
  };
}

/** What a Report card of an archived app says. */
export const ARCHIVED_NOTE = 'Archived: restore it from Apps › Archived to change it.';

const why = (e: unknown): string => (e instanceof Error ? e.message : String(e)).slice(0, 200);

/**
 * One crew app's card from its list entry: its detail read for the preview, or the list alone saying why not.
 * `missing`: crew answered 404 for the detail (the app went between the list and its read).
 */
async function crewTile(a: Record<string, unknown>, slug: string): Promise<{ tile: AppTileData; missing: boolean }> {
  try {
    const d = (await apiFetch<AppDetailResponse>(`/apps/${slug}`))?.app;
    if (!detailOk(d, slug)) return { tile: summaryTile(a, slug, 'Its details could not be read.'), missing: false };
    return { tile: await tileOf(d, null), missing: false };
  } catch (e) {
    return { tile: summaryTile(a, slug, `Its details could not be read: ${why(e)}`), missing: e instanceof ApiError && e.status === 404 };
  }
}

/** (G16) Which of crew's apps a list reads: the active ones (crew's default), the archived ones, or all of them. */
export type AppsScope = 'active' | 'archived' | 'all';

/**
 * crew's list of apps (`GET /apps`, or one project's: `?project=`), its entries with an app slug, and how many were not.
 * (G16, crew#1396) The list is read whole (`?archived=all`) and kept to `scope` here by each entry's own `archived`
 * field: whether crew archives at all is then known even when every app is archived (codex/pi r1), and an older daemon,
 * which ignores the parameter and has no such field, lists no app as archived. `archives`: some entry carries the field.
 */
async function crewList(project: string | null, scope: AppsScope = 'active'): Promise<{ listed: Array<Record<string, unknown>>; skipped: number; archives: boolean } | { error: string }> {
  let list: AppsListResponse;
  const q = new URLSearchParams();
  if (project !== null) q.set('project', project);
  q.set('archived', 'all');
  const qs = q.toString();
  try {
    list = await apiFetch<AppsListResponse>(qs === '' ? '/apps' : `/apps?${qs}`);
  } catch (e) {
    return { error: why(e) };
  }
  // crew's answer is data too: a list that is not a list is an error to retry, never an empty store.
  if (typeof list !== 'object' || list === null || !Array.isArray((list as { apps?: unknown }).apps)) return { error: 'crew’s list of apps was not a list' };
  const all = list.apps as unknown[];
  const archives = all.some((a) => archivedOf(a) !== undefined);
  const entries = all.filter((a) => inScope(scope, archivedOf(a)));
  const listed = entries.filter((a): a is Record<string, unknown> => typeof a === 'object' && a !== null && isAppSlug((a as Record<string, unknown>)['slug']));
  return { listed, skipped: entries.length - listed.length, archives };
}

/** Whether an app whose archived state is `archived` belongs in `scope` (unknown = active: an older daemon's). */
function inScope(scope: AppsScope, archived: { at: number; by: string } | null | undefined): boolean {
  return scope === 'all' || (scope === 'archived') === (archived != null);
}

/**
 * Load the dashboard. `hasStore`: crew's health advertises `capabilities.apps`. Every app crew lists gets a card: the
 * first {@link PREVIEW_LIMIT} read their detail for a preview, and a detail that fails or is malformed leaves that card
 * drawn from the list alone, saying so. Only a failed LIST is an error. `project` lists one project's apps only.
 */
export async function loadAppsDirectory(hasStore: boolean, project: string | null = null, scope: Exclude<AppsScope, 'all'> = 'active'): Promise<AppsDirectory> {
  if (!hasStore) {
    const apps: AppTileData[] = [];
    for (const [key, s] of Object.entries(SAMPLE_APPS)) {
      const detail = await new SampleAppStore(s.slug, s.spec).detail();
      apps.push(await tileOf(detail, { key, data: s.data }));
    }
    return { source: 'sample', apps, skipped: 0 };
  }
  const l = await crewList(project, scope);
  if ('error' in l) return { source: 'error', message: l.error };
  const read = await Promise.all(l.listed.map(async (a, i): Promise<AppTileData> => {
    const slug = a['slug'] as string;
    if (i >= PREVIEW_LIMIT) return summaryTile(a, slug, null);
    return (await crewTile(a, slug)).tile;
  }));
  // An app archived or restored (in another tab) between the list and its detail read is in the other list now: the
  // detail is newer, so it decides (codex r1).
  const apps = read.filter((t) => inScope(scope, t.archived));
  return { source: 'crew', apps, skipped: l.skipped, archives: l.archives };
}

/** One app Report shows: its card, or `null` when crew no longer has it (gone); its project from crew's record. */
export interface ShownTile { slug: string; tile: AppTileData | null; projectId: string | null }

/**
 * (DES-REPORT-DASHBOARDS-001 §2, "Loading") The cards for the apps named in `slugs`, in that order, through the same
 * shaping as the dashboard's: crew's list (for each app's project, and whether it is gone), then each named app's
 * detail. No preview limit applies (an app far down crew's list is read like the first), and nothing else is read.
 */
export async function loadAppTiles(slugs: readonly string[]): Promise<{ ok: true; tiles: ShownTile[] } | { ok: false; message: string }> {
  if (slugs.length === 0) return { ok: true, tiles: [] };
  // An archived app is not gone: its card shows, saying it is archived (G16).
  const l = await crewList(null, 'all');
  if ('error' in l) return { ok: false, message: l.error };
  const bySlug = new Map(l.listed.map((a) => [a['slug'] as string, a]));
  const tiles = await Promise.all(slugs.map(async (slug): Promise<ShownTile> => {
    const a = bySlug.get(slug);
    if (a === undefined) return { slug, tile: null, projectId: null };
    const projectId = typeof a['projectId'] === 'string' ? a['projectId'] : null;
    const { tile, missing } = await crewTile(a, slug);
    // Removed between the list and its read: gone, as if it was never listed.
    if (missing) return { slug, tile: null, projectId: null };
    return { slug, tile: tile.archived != null ? { ...tile, note: ARCHIVED_NOTE } : tile, projectId };
  }));
  return { ok: true, tiles };
}

/**
 * A dashboard tile's host port: the app's first page, read-only. It is drawn in Preview and asks nothing: a frame in a
 * tile (honest or not) gets no edit (Preview, and its store changes nothing), no history, no action (never confirmed),
 * no link, and rows only from what is already in this browser: a sample's own data, or (K5) the snapshot of the crew
 * app's last real render in this tab (`previewSnapshots.ts`). A crew tile never sends a query.
 */
export function tileHostPort(session: AppSession, tile: AppTileData, live: AppDataPort | null = null): AppHostPort {
  const sample = tile.sampleKey !== null ? SAMPLE_APPS[tile.sampleKey] ?? null : null;
  const spec = (): AppSpec => session.landedSpec ?? tile.detail!.spec;
  // (K5) A crew tile's rows: the last real render's snapshot, when there is one (no request either way).
  const data: AppDataPort = sample !== null ? sampleAppData(spec, sample.data) : live !== null ? live : {
    kind: { queries: 'crew', actions: 'crew' },
    query: async () => ({ error: 'unavailable', message: 'a tile reads nothing' }),
    prepare: async () => ({ error: 'refused', message: 'a tile runs nothing' }),
    run: async () => ({ state: 'failed', reason: 'a tile runs nothing', sample: false }),
    viewer: () => ({ email: null, sample: false }),
  };
  return {
    session, data, framed: () => false, mode: () => 'preview', editing: () => false, viewer: () => 'you',
    confirm: async () => false, openLink: async () => false, tile: { rows: sample !== null || live !== null },
  };
}

/** The sample key a slug names (`escalations`, `refund-approvals`), or null. */
export function sampleKeyOf(slug: string): string | null {
  return Object.entries(SAMPLE_APPS).find(([, s]) => s.slug === slug)?.[0] ?? null;
}

/** A store that answers with one detail already read and changes nothing (a dashboard tile). */
export class FixedAppStore implements AppStorePort {
  constructor(readonly slug: string, private readonly app: AppDetail, readonly kind: 'crew' | 'sample') {}
  async detail(): Promise<AppDetail> { return structuredClone(this.app); }
  async edit(): Promise<StoreResult> { return { ok: false, code: 'bad_request', message: 'a tile changes nothing' }; }
  async move(): Promise<StoreResult> { return { ok: false, code: 'bad_request', message: 'a tile changes nothing' }; }
  async restore(): Promise<StoreResult> { return { ok: false, code: 'bad_request', message: 'a tile changes nothing' }; }
  async readVersion(): Promise<VersionReadResult> { return { ok: false, code: 'bad_request', message: 'a tile reads no other version' }; }
}

/**
 * (G16, operator ruling D5) Archive an app (hide it from Apps and close it to changes) or restore it from Archived
 * (`POST /apps/:app/archive | unarchive`, a person only). Nothing is deleted either way. Answers crew's detail after it,
 * or crew's words for why not.
 */
export async function setArchived(slug: string, archived: boolean): Promise<{ ok: true; app: AppDetail } | { ok: false; message: string }> {
  if (!isAppSlug(slug)) return { ok: false, message: `“${slug}” is not an app’s address` };
  try {
    const r = await apiFetch<AppDetailResponse>(`/apps/${slug}/${archived ? 'archive' : 'unarchive'}`, { method: 'POST', body: '{}' });
    return { ok: true, app: r.app };
  } catch (e) {
    const b = e instanceof ApiError && typeof e.body === 'object' && e.body !== null ? e.body as { code?: unknown; error?: unknown } : {};
    if (b.code === 'turn_in_flight') return { ok: false, message: 'A chat turn is changing the app: archive it after the turn ends.' };
    return { ok: false, message: typeof b.error === 'string' && b.error !== '' ? b.error.slice(0, 300) : why(e) };
  }
}
