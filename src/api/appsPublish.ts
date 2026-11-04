/**
 * Publish an app (DES-APPS-001 §9.3, lane K6): `POST /apps/:app/publish` launches one governed `apps-publish` run bound
 * to the head version and these settings (check → QE acceptance → your consent → the image). When it finishes, crew's
 * app record carries `published`: the share link (the site address the deployer runs it at), the iframe snippet for a
 * public app, and the Teams package.
 *
 * The wire is api-types 0.182.0 (crew K6); studio mirrors the parts it sends and reads until that release is pinned.
 */

import { apiFetch } from './client.js';
import { ApiError } from './errors.js';

export type PublishTarget = 'studio' | 'site' | 'embed' | 'teams';

export type PublishAudience =
  | { kind: 'public' }
  | { kind: 'oidc-groups'; groups: string[] }
  | { kind: 'oidc-email-domain'; domains: string[] }
  | { kind: 'entra-roles'; roles: string[] }
  | { kind: 'entra-groups'; groups: string[] };

export interface PublishIdentity {
  profile: 'oidc' | 'entra';
  issuer: string;
  clientId: string;
  tenantId?: string;
}

export interface PublishBody {
  base: number;
  targets: PublishTarget[];
  site: { origin: string };
  identity: PublishIdentity | null;
  audience: PublishAudience;
  embedOrigins?: string[];
}

export interface PublishFinding {
  code: string;
  message: string;
}

export type PublishStart =
  | { ok: true; runId: string; manifestDigest: string }
  | { ok: false; message: string; code: string | null; findings: PublishFinding[]; head?: number };

/** Launch the publish. A refusal (the check's findings, a stale version, one already running) comes back as data. */
export async function startPublish(slug: string, body: PublishBody): Promise<PublishStart> {
  try {
    const r = await apiFetch<{ runId: string; manifestDigest: string }>(`/apps/${encodeURIComponent(slug)}/publish`, { method: 'POST', body: JSON.stringify(body) });
    if (typeof r.runId !== 'string' || typeof r.manifestDigest !== 'string') return { ok: false, message: 'crew answered without the publish run', code: null, findings: [] };
    return { ok: true, runId: r.runId, manifestDigest: r.manifestDigest };
  } catch (e) {
    if (!(e instanceof ApiError)) return { ok: false, message: e instanceof Error ? e.message : String(e), code: null, findings: [] };
    const b = (typeof e.body === 'object' && e.body !== null ? e.body : {}) as { code?: unknown; findings?: unknown; head?: unknown };
    const findings = Array.isArray(b.findings)
      ? b.findings.flatMap((f): PublishFinding[] => (typeof f === 'object' && f !== null && typeof (f as PublishFinding).message === 'string' ? [{ code: String((f as PublishFinding).code ?? ''), message: (f as PublishFinding).message.slice(0, 400) }] : []))
      : [];
    return { ok: false, message: e.message, code: typeof b.code === 'string' ? b.code : null, findings, ...(typeof b.head === 'number' ? { head: b.head } : {}) };
  }
}

/** The bare origin a person typed for the site (`https://host[:port]`, or `http://localhost:port` for a local run), or why not. */
export function siteOriginProblem(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return 'Type the address people will open, like https://escalations.example.com';
  }
  if (u.username !== '' || u.password !== '') return 'The address carries no name or password';
  if (u.pathname !== '/' || u.search !== '' || u.hash !== '') return 'Just the site: no path, query or #';
  if (u.protocol === 'https:') return null;
  if (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')) return null;
  return 'Use https:// (http:// only for localhost)';
}

/** The environment name crew gives a source's secret in the image (crew `publish/layout.ts` secretEnvName). */
export function secretEnvName(name: string, kind: 'sql' | 'other'): string {
  const base = name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return `APPS_SRC_${base}_${kind === 'sql' ? 'PASSWORD' : 'TOKEN'}`;
}

/** The published run's extras studio shows beside the share link: the Teams package and the local image (crew's record). */
export interface PublishedExtras {
  runId: string | null;
  image: { tag: string; id: string } | null;
  teamsUrl: string | null;
  env: string[];
  volume: string | null;
  port: number;
}

/** Read the parts of crew's published record the Publish sheet shows after the run; anything malformed is left out. */
export function publishedExtrasOf(detail: unknown): PublishedExtras | null {
  const p = typeof detail === 'object' && detail !== null ? (detail as { published?: unknown }).published : undefined;
  if (typeof p !== 'object' || p === null) return null;
  const r = p as Record<string, unknown>;
  const img = typeof r['image'] === 'object' && r['image'] !== null ? (r['image'] as Record<string, unknown>) : null;
  const teams = typeof r['teamsPackage'] === 'object' && r['teamsPackage'] !== null ? (r['teamsPackage'] as Record<string, unknown>) : null;
  const run = typeof r['run'] === 'object' && r['run'] !== null ? (r['run'] as Record<string, unknown>) : {};
  const teamsUrl = teams !== null && typeof teams['url'] === 'string' && /^\/api\/v1\/apps\/[a-z0-9-]{1,48}\/published\/teams\.zip$/.test(teams['url']) ? teams['url'] : null;
  return {
    runId: typeof r['runId'] === 'string' ? r['runId'] : null,
    image: img !== null && typeof img['tag'] === 'string' && typeof img['id'] === 'string' ? { tag: img['tag'], id: img['id'] } : null,
    teamsUrl,
    env: Array.isArray(run['env']) ? run['env'].filter((e): e is string => typeof e === 'string' && /^[A-Z0-9_]{1,80}$/.test(e)).slice(0, 30) : [],
    volume: run['volume'] === '/data' ? '/data' : null,
    port: typeof run['port'] === 'number' && Number.isInteger(run['port']) ? run['port'] : 8080,
  };
}
