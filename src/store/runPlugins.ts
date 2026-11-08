import { useEffect } from 'react';
import { create } from 'zustand';
import { apiBase } from '../api/client.js';
import { lastEditorsRead, listEditors, type RunPluginView } from '../api/editors.js';
import { parsePanels } from '../board/runPluginPanels.js';
import { bundleUrl } from '../editors/model.js';
import { validPattern } from '../editors/runEvents.js';
import { RUN_PLUGINS, type ObserveGrant, type RunPlugin } from '../plugins/runPlugins.js';
import { parseVisuals } from '../plugins/visuals.js';
import { useEditors } from './editors.js';

/** Run plugins only: a malformed or non-run pattern grants nothing. */
export function runPattern(value: unknown): value is string {
  return validPattern(value) && value.startsWith('wicked.run.') && value.split('.').length >= 3;
}

export function installedRunPlugin(row: RunPluginView): RunPlugin | null {
  const e = row as RunPluginView & { description?: unknown; visuals?: unknown };
  if (e.inline !== 'run-thread' || !e.protocol.includes(3)) return null;
  // Each asked topic once (the first reason wins); a malformed one is dropped whole.
  const asked = new Set<string>();
  const observe: ObserveGrant[] = Array.isArray(e.observe) ? e.observe.flatMap((o: unknown) => {
    if (typeof o !== 'object' || o === null) return [];
    const v = o as Record<string, unknown>;
    const topic = v['topic'];
    if (!runPattern(topic) || asked.has(topic) || typeof v['why'] !== 'string' || v['why'].trim() === '') return [];
    asked.add(topic);
    return [{ topic, why: v['why'].slice(0, 200) }];
  }) : [];
  // Use crew's same bundle route as artifact editors, which verifies the pin on every serve.
  // Refuse an unexpected entry route rather than framing an arbitrary URL from the registry.
  const expected = bundleUrl(apiBase(), e.id, e.version, e.sha256);
  const base = new URL(apiBase() || '/api/v1', window.location.origin);
  let entry: URL | null = null;
  try { if (typeof e.entry_url === 'string') entry = new URL(e.entry_url, base); } catch { return null; }
  const pinned = new URL(expected, window.location.origin);
  if (entry === null || entry.origin !== pinned.origin || entry.pathname !== pinned.pathname || !/^[0-9a-f]{64}$/u.test(e.sha256)) return null;
  return {
    id: e.id, title: e.title, version: e.version, protocol: e.protocol, inline: 'run-thread',
    panels: parsePanels(e.run_panels).filter((p) => p.slot === 'run.details'),
    description: typeof e.description === 'string' ? e.description.slice(0, 160) : '',
    visuals: { ...parseVisuals(e.visuals), live: false }, observe,
    // Granted = what crew's engine decided allow AND the plugin asked for with a reason: a grant the Plugins page
    // could not show (no valid `observe` entry) is never delivered.
    granted: Array.isArray(e.granted_topics) ? [...new Set(e.granted_topics.filter((t): t is string => runPattern(t) && asked.has(t)))] : [],
    grantedBy: 'install', firstParty: false, permissions: [], html: '', sha256: e.sha256,
    entryUrl: expected, enabled: e.enabled,
  };
}

/** Disabled installs remain in the catalog; only enabled ones register sections. Built-ins own their ids. */
export function mergeRunPlugins(editors: readonly RunPluginView[]): RunPlugin[] {
  const ids = new Set(RUN_PLUGINS.map((p) => p.id));
  return [...RUN_PLUGINS, ...editors.flatMap((e) => {
    if (ids.has(e.id)) return [];
    const p = installedRunPlugin(e);
    if (p === null) return [];
    ids.add(p.id);
    return [p];
  })];
}

const initial = mergeRunPlugins(useEditors.getState().editors);
export const useRunPluginStore = create<{ catalog: RunPlugin[]; active: RunPlugin[] }>(() => ({ catalog: initial, active: initial.filter((p) => p.enabled !== false) }));
useEditors.subscribe((state, before) => {
  if (state.editors === before.editors) return;
  const catalog = mergeRunPlugins(state.editors);
  useRunPluginStore.setState({ catalog, active: catalog.filter((p) => p.enabled !== false) });
});

/** One refresh loop for all mounted panels, not one per phase or thread row. */
let readers = 0;
let timer: number | undefined;
let pending = false;
/** How long a registry read stays fresh: the shell reads it once per tab, and an open job re-reads it no oftener. */
export const REGISTRY_FRESH_MS = 15_000;
const refresh = (): void => {
  if (pending || Date.now() - lastEditorsRead() < REGISTRY_FRESH_MS) return;
  pending = true;
  void listEditors().catch(() => undefined).finally(() => { pending = false; });
};

/** Keep a job open across installs made by a run or another tab, even without a registry event. */
export function useRunPlugins(catalog = false): RunPlugin[] {
  const plugins = useRunPluginStore((s) => catalog ? s.catalog : s.active);
  useEffect(() => {
    readers += 1;
    if (readers === 1) {
      refresh();
      timer = window.setInterval(refresh, REGISTRY_FRESH_MS);
      window.addEventListener('focus', refresh);
    }
    return () => {
      readers -= 1;
      if (readers === 0) { window.clearInterval(timer); window.removeEventListener('focus', refresh); }
    };
  }, []);
  return plugins;
}
