import { apiFetch } from './client.js';
import { isRouteUnsupported } from './errors.js';
import { PROTOCOL_VERSION } from '../editors/protocol.js';

import type { EditorView, ListEditorsResponse } from 'wicked-crew-api-types';
export type { EditorView, ListEditorsResponse };

const SHA = /^[0-9a-f]{64}$/;

function isEditorView(v: unknown): v is EditorView {
  if (typeof v !== 'object' || v === null) return false;
  const e = v as Record<string, unknown>;
  return typeof e['id'] === 'string' && typeof e['title'] === 'string' && typeof e['version'] === 'string'
    && Array.isArray(e['protocol']) && Array.isArray(e['kinds']) && Array.isArray(e['sizes'])
    && typeof e['sha256'] === 'string' && SHA.test(e['sha256']) && typeof e['enabled'] === 'boolean' && typeof e['first_party'] === 'boolean';
}

/** The registry, or `null` when this daemon has no editors route (an older crew): nothing is hosted then. */
export async function listEditors(): Promise<EditorView[] | null> {
  try {
    const r = await apiFetch<ListEditorsResponse>('/editors');
    return Array.isArray(r.editors) ? r.editors.filter(isEditorView) : [];
  } catch (e) {
    if (isRouteUnsupported(e)) return null;
    throw e;
  }
}

/**
 * The editor that opens `kind` here: enabled, speaking this host's protocol, claiming the kind and
 * an inline size. A first-party editor wins over a third-party one; among equals, the id's order.
 * `null` = no plugin claims the kind (the host falls back to its own component, or a read-only view).
 */
export function editorFor(editors: readonly EditorView[], kind: string): EditorView | null {
  const fit = editors
    .filter((e) => e.enabled && e.protocol.includes(PROTOCOL_VERSION) && e.kinds.includes(kind) && e.sizes.includes('inline'))
    .sort((a, b) => Number(b.first_party) - Number(a.first_party) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return fit[0] ?? null;
}
