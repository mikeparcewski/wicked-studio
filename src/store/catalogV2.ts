import { useEffect, useState } from 'react';
import type { ShapeGuess, WorkflowCatalogV2Response } from 'wicked-crew-api-types';
import { apiFetch } from '../api/client.js';
import { WORKFLOW_CATALOG_PATH } from '../api/client.js';
import { useCapabilities } from './capabilities.js';

/**
 * The v2 catalog (DES-CATALOG-002 §4.1, `GET /workflows/catalog?v=2[&projectId=]`) for the `/` command list, and the
 * words-only reading of free words for its Looks like row (`POST /workflows/catalog/detect {seat:false}`).
 *
 * Read only where the daemon takes job proposals from a chat AND serves the v2 catalog ({@link commandsOn}); anywhere
 * else the list is ux-tonight's v1 list, unchanged (§8.6 "older daemons"). One answer per project, shown from the cache
 * while a fresh read is out; a newer read wins; a failed read keeps a catalog already read.
 */
export type CatalogV2Load =
  | { state: 'loading' }
  | { state: 'ready'; view: WorkflowCatalogV2Response }
  | { state: 'error' };

/** The daemon posts job proposals from a chat and lists the v2 catalog: the `/` list is the command list. */
export function commandsOn(caps: { chatJobProposals: boolean; workflowCatalogV2: boolean }): boolean {
  return caps.chatJobProposals && caps.workflowCatalogV2;
}

/** The capability, read now (outside React). */
export function commandsOnNow(): boolean {
  const c = useCapabilities.getState();
  return c.loaded && commandsOn(c);
}

const cache = new Map<string, CatalogV2Load>();
const asked = new Map<string, number>();
const listeners = new Set<() => void>();
let epoch = 0;
const keyOf = (projectId: string | null): string => projectId ?? '';
const notify = (): void => { for (const fn of [...listeners]) fn(); };

function isV2(body: unknown): body is WorkflowCatalogV2Response {
  const b = body as Partial<WorkflowCatalogV2Response> | null;
  return b !== null && typeof b === 'object' && b.version === 2 && Array.isArray(b.cards) && Array.isArray(b.categories);
}

/** Reads out, by project: a caller that needs the answer waits for the newest one (codex r1: two readers race). */
const inflight = new Map<string, Promise<CatalogV2Load | null>>();

/** Read one project's v2 catalog (a GET). The answer lands only if no newer read was asked since. */
export function readCatalogV2(projectId: string | null): Promise<CatalogV2Load | null> {
  const key = keyOf(projectId);
  const p = readOnce(projectId).finally(() => { if (inflight.get(key) === p) inflight.delete(key); });
  inflight.set(key, p);
  return p;
}

async function readOnce(projectId: string | null): Promise<CatalogV2Load | null> {
  const key = keyOf(projectId);
  const gen = (asked.get(key) ?? 0) + 1;
  asked.set(key, gen);
  const atEpoch = epoch;
  let view: WorkflowCatalogV2Response | null = null;
  try {
    const body = await apiFetch<unknown>(`${WORKFLOW_CATALOG_PATH}?v=2${projectId !== null ? `&projectId=${encodeURIComponent(projectId)}` : ''}`);
    view = isV2(body) ? body : null;
  } catch { view = null; }
  if (atEpoch !== epoch || asked.get(key) !== gen) return null;
  const prev = cache.get(key);
  const load: CatalogV2Load = view !== null ? { state: 'ready', view } : prev?.state === 'ready' ? prev : { state: 'error' };
  cache.set(key, load);
  notify();
  return load;
}

/** The v2 catalog for a project as of now: the cached one, else the newest read's answer (a superseded read waits for
 *  the read that replaced it). `error` = it could not be read, which is not "no such card". */
export async function catalogV2Now(projectId: string | null): Promise<CatalogV2Load> {
  const key = keyOf(projectId);
  for (let i = 0; i < 3; i += 1) {
    const have = cache.get(key);
    if (have?.state === 'ready') return have;
    const out = inflight.get(key);
    const load = await (out ?? readCatalogV2(projectId));
    if (load !== null) return load;
  }
  return cache.get(key) ?? { state: 'error' };
}

const LOADING: CatalogV2Load = { state: 'loading' };

/** One project's v2 catalog, read when `enabled` turns on (each time a `/` line starts) and shown from the cache. */
export function useCatalogV2(projectId: string | null, on: boolean, enabled: boolean): CatalogV2Load {
  const key = keyOf(projectId);
  const [, setTick] = useState(0);
  useEffect(() => {
    const fn = (): void => setTick((n) => n + 1);
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, []);
  useEffect(() => {
    if (!on) return;
    if (enabled || !cache.has(key)) void readCatalogV2(projectId);
  }, [on, projectId, key, enabled]);
  return cache.get(key) ?? LOADING;
}

/** Test hook. */
export function resetCatalogV2(): void {
  cache.clear();
  asked.clear();
  inflight.clear();
  epoch += 1;
  notify();
}

// ── Looks like: crew's words layer over free words (§8.4), never a seat ──────────────────────────────────────────────

/** How long the list waits after the last key before it asks crew (the rows never wait for it). */
export const LOOKS_DEBOUNCE_MS = 300;

const looksCache = new Map<string, ShapeGuess | null>();

/** crew's words-only reading of `text` (`seat: false`: instant, no seat). null when it reads nothing or fails. */
export async function looksLike(text: string, projectId: string | null): Promise<ShapeGuess | null> {
  const key = `${projectId ?? ''}\u0000${text}`;
  if (looksCache.has(key)) return looksCache.get(key) ?? null;
  try {
    const g = await apiFetch<ShapeGuess>('/workflows/catalog/detect', {
      method: 'POST',
      body: JSON.stringify({ text, seat: false, ...(projectId !== null ? { projectId } : {}) }),
    });
    const out = g !== null && typeof g === 'object' && typeof g.card === 'string' ? g : null;
    looksCache.set(key, out);
    return out;
  } catch {
    // A failure (a newer reading superseded this one included) is never cached and shows nothing.
    return null;
  }
}

/** Test hook. */
export function resetLooksLike(): void {
  looksCache.clear();
}
