import { create } from 'zustand';
import { ApiError, isRouteUnsupported } from '../api/errors.js';
import {
  teamPlanApi,
  type CatalogEntry,
  type PlanPreviewBody,
  type PlanPreviewResponse,
  type Preset,
} from '../api/teamPlan.js';

/**
 * The phase catalog, the presets, and launch previews (DES-TEAMING-002 T9) — the behaviour the
 * composer's phase picker and launch preview render. One `GET /catalog` per app (the engine's
 * catalog changes only with the engine); presets per project scope; previews cached by body.
 *
 * `unsupported` is a daemon without the route (404) or whose engine lacks it (501): the picker
 * then says so instead of offering a hardcoded list.
 */

export type LoadState = 'idle' | 'loading' | 'ready' | 'unsupported' | 'error';

export type PreviewState =
  | { status: 'loading' }
  | { status: 'ready'; preview: PlanPreviewResponse }
  | { status: 'unsupported' }
  | { status: 'error'; error: string };

interface PlanCatalogStore {
  catalog: LoadState;
  entries: CatalogEntry[];
  catalogError: string | null;
  /** Presets by project scope key (`''` = global). */
  presets: Record<string, Preset[] | 'unsupported' | 'loading'>;
  /** Previews by request key ({@link previewKey}). */
  previews: Record<string, PreviewState>;
}

export const usePlanCatalog = create<PlanCatalogStore>(() => ({
  catalog: 'idle',
  entries: [],
  catalogError: null,
  presets: {},
  previews: {},
}));

/** Tests reset between cases. */
export function resetPlanCatalog(): void {
  usePlanCatalog.setState({ catalog: 'idle', entries: [], catalogError: null, presets: {}, previews: {} });
  inflight.clear();
}

/** Load the catalog once (a failed load may be retried by calling again). */
export function loadCatalog(): void {
  const s = usePlanCatalog.getState().catalog;
  if (s === 'loading' || s === 'ready' || s === 'unsupported') return;
  usePlanCatalog.setState({ catalog: 'loading', catalogError: null });
  teamPlanApi.catalog().then(
    (r) => usePlanCatalog.setState({ catalog: 'ready', entries: Array.isArray(r.entries) ? r.entries : [] }),
    (e: unknown) =>
      usePlanCatalog.setState(
        isRouteUnsupported(e)
          ? { catalog: 'unsupported' }
          : { catalog: 'error', catalogError: e instanceof Error ? e.message : String(e) },
      ),
  );
}

/** Load the presets a launch in `projectId` sees (once per scope). */
export function loadPresets(projectId: string | null): void {
  const key = projectId ?? '';
  if (usePlanCatalog.getState().presets[key] !== undefined) return;
  setPresets(key, 'loading');
  teamPlanApi.presets(projectId).then(
    (r) => setPresets(key, Array.isArray(r.presets) ? r.presets : []),
    // Any failure: no preset is known, so no preset launch gets a preview. Never a guess.
    () => setPresets(key, 'unsupported'),
  );
}

function setPresets(key: string, v: Preset[] | 'unsupported' | 'loading'): void {
  usePlanCatalog.setState((s) => ({ presets: { ...s.presets, [key]: v } }));
}

/** The preset a workflow name launches in this scope, when the list is loaded and names it. */
export function presetFor(
  presets: PlanCatalogStore['presets'],
  projectId: string | null,
  name: string,
): Preset | null {
  const list = presets[projectId ?? ''];
  if (!Array.isArray(list) || name === '') return null;
  return list.find((p) => p.name === name) ?? null;
}

/** A stable key for a preview body. */
export function previewKey(body: PlanPreviewBody): string {
  return JSON.stringify(body);
}

const inflight = new Map<string, Promise<PreviewState>>();

/**
 * Preview `body`, once per distinct body: a repeated call answers from the cache (or joins the
 * request in flight). Resolves with the settled state — the composer awaits it at Send so the
 * `before:N` it sends always counts the preview's own steps.
 */
export function requestPreview(body: PlanPreviewBody): Promise<PreviewState> {
  const key = previewKey(body);
  const cached = usePlanCatalog.getState().previews[key];
  if (cached !== undefined && cached.status !== 'loading') return Promise.resolve(cached);
  const running = inflight.get(key);
  if (running !== undefined) return running;
  setPreview(key, { status: 'loading' });
  const p = teamPlanApi.previewPlan(body).then(
    (preview): PreviewState => ({ status: 'ready', preview }),
    (e: unknown): PreviewState =>
      isRouteUnsupported(e)
        ? { status: 'unsupported' }
        : { status: 'error', error: e instanceof ApiError ? e.message : String(e) },
  ).then((st) => {
    inflight.delete(key);
    setPreview(key, st);
    return st;
  });
  inflight.set(key, p);
  return p;
}

function setPreview(key: string, st: PreviewState): void {
  usePlanCatalog.setState((s) => ({ previews: { ...s.previews, [key]: st } }));
}
