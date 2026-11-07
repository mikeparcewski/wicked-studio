/**
 * The crew web source (CS9): what its install puts on this computer, read BEFORE the person consents, and the
 * consented install. crew answers `GET /sources/web/setup` and `POST /sources/web/install` (human operator only).
 *
 * The wire types are crew's api-types hunk (`WebSourceSetupResponse`, `WebSourceInstallBody`), mirrored here until
 * that hunk is published; every answer goes through {@link webSetupOf}, so an older or different crew reads as
 * "not offered", never as a half-read sheet.
 */

import { apiFetch } from './client.js';
import { isRouteAbsent } from './errors.js';
import type { SourceAgentAccess } from './sourceAgents.js';
import { agentAccessOf } from './sourceAgents.js';

export const WEB_SOURCE_NAME = 'web';

export interface WebSourcePackage {
  name: string;
  version: string;
  markers: string | null;
  sha256: string[];
}

export interface WebSourceSetup {
  installed: boolean;
  registered: boolean;
  installing: boolean;
  lock: { sha256: string; packages: WebSourcePackage[] };
  reader: { name: string; version: string; license: string; sha256: string[]; installed: boolean };
  image: { ref: string; version: string; digest: string; license: string; revision: string; source: string; note: string; present: boolean };
  search: { ready: boolean; engine: 'docker' | 'podman' | 'nerdctl' | null; reason: string | null };
  python: { found: boolean; version: string | null; reason: string | null };
  agents: SourceAgentAccess | null;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === 'string';
const strOrNull = (v: unknown): v is string | null => v === null || typeof v === 'string';
const hashes = (v: unknown): v is string[] => Array.isArray(v) && v.every((h) => str(h) && /^[0-9a-f]{64}$/.test(h));

/** crew's whole answer, or `null` (an answer this studio can't read in full is not shown in part). */
export function webSetupOf(v: unknown): WebSourceSetup | null {
  if (!isObj(v)) return null;
  const { lock, reader, image, search, python } = v;
  if (typeof v['installed'] !== 'boolean' || typeof v['registered'] !== 'boolean' || typeof v['installing'] !== 'boolean') return null;
  if (!isObj(lock) || !str(lock['sha256']) || !Array.isArray(lock['packages'])) return null;
  const packages: WebSourcePackage[] = [];
  for (const p of lock['packages'] as unknown[]) {
    if (!isObj(p) || !str(p['name']) || !str(p['version']) || !strOrNull(p['markers']) || !hashes(p['sha256'])) return null;
    packages.push({ name: p['name'], version: p['version'], markers: p['markers'], sha256: p['sha256'] });
  }
  if (!isObj(reader) || !str(reader['name']) || !str(reader['version']) || !str(reader['license']) || !hashes(reader['sha256']) || typeof reader['installed'] !== 'boolean') return null;
  if (!isObj(image) || !['ref', 'version', 'digest', 'license', 'revision', 'source', 'note'].every((k) => str(image[k])) || typeof image['present'] !== 'boolean') return null;
  if (!isObj(search) || typeof search['ready'] !== 'boolean' || !strOrNull(search['reason']) || !(search['engine'] === null || ['docker', 'podman', 'nerdctl'].includes(String(search['engine'])))) return null;
  if (!isObj(python) || typeof python['found'] !== 'boolean' || !strOrNull(python['version']) || !strOrNull(python['reason'])) return null;
  const agents = v['agents'] === null ? null : agentAccessOf({ agents: v['agents'] });
  if (v['agents'] !== null && agents === null) return null;
  return {
    installed: v['installed'],
    registered: v['registered'],
    installing: v['installing'],
    lock: { sha256: lock['sha256'], packages },
    reader: { name: reader['name'], version: reader['version'], license: reader['license'], sha256: reader['sha256'], installed: reader['installed'] },
    image: { ref: image['ref'] as string, version: image['version'] as string, digest: image['digest'] as string, license: image['license'] as string, revision: image['revision'] as string, source: image['source'] as string, note: image['note'] as string, present: image['present'] },
    search: { ready: search['ready'], engine: search['engine'] as WebSourceSetup['search']['engine'], reason: search['reason'] },
    python: { found: python['found'], version: python['version'], reason: python['reason'] },
    agents,
  };
}

/** `null` = this crew has no web source (an older crew: the route is absent). */
export async function readWebSetup(): Promise<WebSourceSetup | null | 'unreadable'> {
  try {
    const v = await apiFetch<unknown>(`/sources/${WEB_SOURCE_NAME}/setup`);
    return webSetupOf(v) ?? 'unreadable';
  } catch (e) {
    if (isRouteAbsent(e)) return null;
    throw e;
  }
}

/** The consented install: the lock and image the person was shown, echoed. Human operator only at crew. */
export async function installWebSource(consent: { lock: string; image: string }): Promise<WebSourceSetup | 'unreadable'> {
  const v = await apiFetch<unknown>(`/sources/${WEB_SOURCE_NAME}/install`, { method: 'POST', body: JSON.stringify({ consent }) });
  return (isObj(v) ? webSetupOf(v['setup']) : null) ?? 'unreadable';
}
