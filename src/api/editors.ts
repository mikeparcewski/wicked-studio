import { apiFetch } from './client.js';
import { isRouteUnsupported } from './errors.js';
import { PROTOCOL_VERSION } from '../editors/protocol.js';

import type { EditorGrantsResponse, EditorView, ListEditorsResponse } from 'wicked-crew-api-types';
export type { EditorGrantsResponse, EditorView, ListEditorsResponse };

/** Additive CS7 fields, until the published wire package carries them. Read as unknown at the boundary. */
export interface RunPluginView extends EditorView {
  inline?: unknown;
  observe?: unknown;
  granted_topics?: unknown;
  run_panels?: unknown;
}

type RegistryChange = { editors: EditorView[]; none?: true } | { id: string; enabled: boolean } | { removed: string };
const registryListeners = new Set<(change: RegistryChange) => void>();
export function subscribeEditorRegistry(on: (change: RegistryChange) => void): () => void {
  registryListeners.add(on);
  return () => { registryListeners.delete(on); };
}
function publish(change: RegistryChange): void { for (const on of registryListeners) on(change); }

const SHA = /^[0-9a-f]{64}$/;

/**
 * Bumped when a switch or a removal starts and when it ends: a list read that overlapped one may hold the registry
 * from before it, so it does not publish (it would put back a plugin just switched off or removed). The next read does.
 */
let mutations = 0;

/** When the registry was last read (ms): the run-plugin refresh skips a read while this one is still fresh. */
let lastRead = Number.NEGATIVE_INFINITY;
export function lastEditorsRead(): number { return lastRead; }

function isEditorView(v: unknown): v is EditorView {
  if (typeof v !== 'object' || v === null) return false;
  const e = v as Record<string, unknown>;
  return typeof e['id'] === 'string' && typeof e['title'] === 'string' && typeof e['version'] === 'string'
    && Array.isArray(e['protocol']) && Array.isArray(e['kinds']) && Array.isArray(e['sizes'])
    && typeof e['sha256'] === 'string' && SHA.test(e['sha256']) && typeof e['enabled'] === 'boolean' && typeof e['first_party'] === 'boolean';
}

/** The registry, or `null` when this daemon has no editors route (an older crew): nothing is hosted then. */
/** One registry read at a time: callers that ask while a read is in flight share it (the shell reads once per tab). */
let inflight: Promise<EditorView[] | null> | null = null;
export function listEditors(): Promise<EditorView[] | null> {
  if (inflight !== null) return inflight;
  const read = readEditors().finally(() => { if (inflight === read) inflight = null; });
  inflight = read;
  return read;
}

async function readEditors(): Promise<EditorView[] | null> {
  try {
    const seen = mutations;
    const r = await apiFetch<ListEditorsResponse>('/editors');
    lastRead = Date.now();
    const editors = Array.isArray(r.editors) ? r.editors.filter(isEditorView) : [];
    if (seen === mutations) publish({ editors });
    return editors;
  } catch (e) {
    if (isRouteUnsupported(e)) { publish({ editors: [], none: true }); return null; }
    throw e;
  }
}

/**
 * Every editor that can open `kind` here: enabled, speaking this host's protocol, claiming the kind and the size.
 * First-party first, then the id's order (the default pick leads).
 * `size`: the size the host shows it at (the MCP inspector page hosts a `pane`; a session, `inline`).
 */
export function editorsFor(editors: readonly EditorView[], kind: string, size: 'inline' | 'pane' | 'full' = 'inline'): EditorView[] {
  return editors
    .filter((e) => e.enabled && e.protocol.includes(PROTOCOL_VERSION) && e.kinds.includes(kind) && e.sizes.includes(size))
    .sort((a, b) => Number(b.first_party) - Number(a.first_party) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * The editor that opens `kind` here: the person's pick for the kind when it still fits (artifact-runs-fix: an
 * installed pack that declares a kind a first-party editor also opens was never chosen), else the first of
 * {@link editorsFor} — a first-party editor over a third-party one; among equals, the id's order.
 * `null` = no plugin claims the kind (the host falls back to its own component, or a read-only view).
 */
export function editorFor(editors: readonly EditorView[], kind: string, size: 'inline' | 'pane' | 'full' = 'inline', preferred: string | null = null): EditorView | null {
  const fit = editorsFor(editors, kind, size);
  return (preferred !== null ? fit.find((e) => e.id === preferred) : undefined) ?? fit[0] ?? null;
}

/** Whether an editor can save what it changes: it declares `artifact.write`. One without it only views. */
export function editorSaves(e: EditorView): boolean {
  return Array.isArray(e.permissions) && e.permissions.some((p) => p.id === 'artifact.write');
}

/** The kind an MCP inspector plugin claims (DES-MCP-INSPECTOR-001 §5). */
export const MCP_SERVER_KIND = 'mcp-server';

/** `POST /editors/:id/enabled` (human-only): switch an editor on or off. Answers the editor as it is now. */
export async function setEditorEnabled(id: string, enabled: boolean): Promise<EditorView> {
  mutations += 1;
  try {
    const row = await apiFetch<EditorView>(`/editors/${encodeURIComponent(id)}/enabled`, { method: 'POST', body: JSON.stringify({ enabled }) });
    publish({ id, enabled: typeof row?.enabled === 'boolean' ? row.enabled : enabled });
    return row;
  } finally {
    mutations += 1;
  }
}

/**
 * `DELETE /editors/:id` (human-only; crew `editors/routes.ts`): uninstall an editor you installed. crew withdraws its
 * install grant first, then removes it. A built-in editor is refused (409: switch it off instead); a withdrawal that
 * fails is a 503 and the editor stays installed, so the press can be repeated.
 */
export async function removeEditor(id: string): Promise<{ removed: true; id: string }> {
  mutations += 1;
  try {
    const removed = await apiFetch<{ removed: true; id: string }>(`/editors/${encodeURIComponent(id)}`, { method: 'DELETE' });
    publish({ removed: id });
    return removed;
  } finally {
    mutations += 1;
  }
}

/**
 * `GET /editors/:id/grants` (crew EP-C1): the engine's decided set for this editor's build, for every project (no
 * project scope: the ledger allow is per build). `null` = this daemon has no grants route (an older crew).
 */
export async function readEditorGrants(id: string): Promise<EditorGrantsResponse | null> {
  try {
    return await apiFetch<EditorGrantsResponse>(`/editors/${encodeURIComponent(id)}/grants`);
  } catch (e) {
    if (isRouteUnsupported(e)) return null;
    throw e;
  }
}

/**
 * `POST /editors/:id/grants {permission, allow, version, sha256}` (HUMAN-only, crew F37; api-types
 * `SetEditorGrantBody`): the person allows or revokes one permission the editor asks for, for the build they were
 * shown (`shown` = the decided set's version and hash; crew answers 409 `build_changed` when the editor was updated
 * meanwhile). crew builds the token from its own record and answers the decided set after the write, so a rule that
 * denies it still reads as denied.
 */
export async function setEditorGrant(id: string, permission: string, allow: boolean, shown: { version: string; sha256: string }): Promise<EditorGrantsResponse> {
  return apiFetch<EditorGrantsResponse>(`/editors/${encodeURIComponent(id)}/grants`, {
    method: 'POST',
    body: JSON.stringify({ permission, allow, version: shown.version, sha256: shown.sha256 }),
  });
}

/** Where a host note's "Allow it" goes: the editor's details on the Plugins page, at that permission's switch. */
export function allowHref(editorId: string, permission: string): string {
  return `/plugins?${new URLSearchParams({ editor: editorId, allow: permission }).toString()}`;
}
