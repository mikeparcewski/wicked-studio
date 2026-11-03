import { apiFetch } from '../../api/client.js';
import type { AppDetail, AppDetailResponse, AppSpec, AppsListResponse } from '../../api/types.js';
import { cellText } from '../../plugins/wicked-apps/runtime/format.js';
import { sampleAppData, type SampleData } from './appData.js';
import type { AppStorePort, StoreResult } from './appStore.js';
import { SampleAppStore } from './appStore.js';
import { SAMPLE_APPS } from './samples.js';

/**
 * The Apps page's data (slice K4, operator 2026-11-03: "a dashboard of the available apps"): one tile per app, from
 * crew's app store when it serves one (`GET /apps`, then each app's `GET /apps/:app`: store reads, never a source
 * read), else the two sample apps, labelled samples. A tile's numbers come only from what is already at hand: the
 * sample's own rows in this browser; with crew, none (a tile never starts a query).
 */

/**
 * A published copy of an app (lane K6 builds the signed-in app server; its address is the share link). PROPOSED
 * shape, read from `AppDetail.published` until K6 publishes it in api-types (ledger, 2026-11-03): studio shows a
 * share link only when crew reports one, and never makes one up.
 */
export interface AppPublished {
  /** The signed-in site's address: the link people are sent. */
  url: string;
  /** Who can open it, in the deployer's words ("signed-in members of support-ops"). */
  audience: string;
  /** The address an iframe may load, when the publish allowed embedding; null = no embedding. */
  embedUrl: string | null;
  /** The version published, and when. */
  version: number;
  at: number;
}

const httpUrl = (v: unknown): string | null => {
  if (typeof v !== 'string' || v.length > 2_048) return null;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch { return null; }
};

/** crew's published record, read field by field; anything missing or malformed means "not published". */
export function publishedOf(detail: unknown): AppPublished | null {
  const p = typeof detail === 'object' && detail !== null ? (detail as { published?: unknown }).published : undefined;
  if (typeof p !== 'object' || p === null) return null;
  const r = p as Record<string, unknown>;
  const url = httpUrl(r['url']);
  if (url === null || typeof r['audience'] !== 'string' || r['audience'] === '' || !Number.isInteger(r['version']) || typeof r['at'] !== 'number') return null;
  return { url, audience: r['audience'].slice(0, 300), embedUrl: r['embedUrl'] == null ? null : httpUrl(r['embedUrl']), version: r['version'] as number, at: r['at'] };
}

export interface TileKpi { title: string; value: string | null }

export interface AppTileData {
  slug: string;
  name: string;
  description: string;
  sample: boolean;
  /** The sample's key (`?sample=`), for a sample tile. */
  sampleKey: string | null;
  detail: AppDetail;
  /** `v14 · reviewed`. */
  version: string;
  changedAt: number;
  sources: string[];
  kpis: TileKpi[];
  published: AppPublished | null;
}

export type AppsDirectory = { source: 'crew' | 'sample'; apps: AppTileData[] } | { source: 'error'; message: string };

export function receiptWords(app: AppDetail): string {
  const v = app.versions.find((x) => x.version === app.head.version);
  const r = v?.receipt;
  if (r == null) return 'not accepted';
  if (r.kind === 'restored') return `restored from v${r.restoredFrom?.version ?? '?'}`;
  return r.kind;
}

function sourcesOf(spec: AppSpec): string[] {
  return [...new Set([...spec.queries.map((q) => q.source), ...spec.actions.map((a) => a.source)])].slice(0, 6);
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

async function tileOf(detail: AppDetail, sample: { key: string; data: SampleData } | null): Promise<AppTileData> {
  const head = detail.versions.find((v) => v.version === detail.head.version);
  return {
    slug: detail.slug,
    name: detail.name,
    description: (detail.spec.description ?? '').slice(0, 300),
    sample: sample !== null,
    sampleKey: sample?.key ?? null,
    detail,
    version: `v${detail.head.version} · ${receiptWords(detail)}`,
    changedAt: head?.at ?? detail.createdAt,
    sources: sourcesOf(detail.spec),
    kpis: await kpisOf(detail.spec, sample?.data ?? null),
    published: publishedOf(detail),
  };
}

/** Load the dashboard. `hasStore`: crew's health advertises `capabilities.apps`. */
export async function loadAppsDirectory(hasStore: boolean): Promise<AppsDirectory> {
  if (!hasStore) {
    const apps: AppTileData[] = [];
    for (const [key, s] of Object.entries(SAMPLE_APPS)) {
      const detail = await new SampleAppStore(s.slug, s.spec).detail();
      apps.push(await tileOf(detail, { key, data: s.data }));
    }
    return { source: 'sample', apps };
  }
  try {
    const list = await apiFetch<AppsListResponse>('/apps');
    const details = await Promise.all(list.apps.slice(0, 100).map((a) => apiFetch<AppDetailResponse>(`/apps/${encodeURIComponent(a.slug)}`).then((r) => r.app).catch(() => null)));
    const apps: AppTileData[] = [];
    for (const d of details) if (d !== null) apps.push(await tileOf(d, null));
    return { source: 'crew', apps };
  } catch (e) {
    return { source: 'error', message: e instanceof Error ? e.message : String(e) };
  }
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
}
