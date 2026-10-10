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
  | { status: 'error'; error: string; timedOut?: true };

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
  answers.clear();
  generation.clear();
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
  const born = epoch;
  teamPlanApi.presets(projectId).then(
    (r) => { if (born === epoch) setPresets(key, Array.isArray(r.presets) ? r.presets : []); },
    // Any failure: no preset is known, so no preset launch gets a preview. Never a guess.
    () => { if (born === epoch) setPresets(key, 'unsupported'); },
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

/**
 * A preset's `system` flag by NAME, from whichever scope has loaded a row of that name — the daemon
 * keys the flag by name, so every scope answers alike. `undefined` when no loaded list names it.
 */
export function presetSystemFlag(presets: PlanCatalogStore['presets'], name: string): boolean | undefined {
  if (name === '') return undefined;
  for (const list of Object.values(presets)) {
    if (!Array.isArray(list)) continue;
    const row = list.find((p) => p.name === name);
    if (row !== undefined && typeof row.system === 'boolean') return row.system;
  }
  return undefined;
}

/** A stable key for a preview body. */
export function previewKey(body: PlanPreviewBody): string {
  return JSON.stringify(body);
}

const inflight = new Map<string, Promise<PreviewState>>();
/** The engine's own answer per body, while it is still coming (studio#431: outlives the timeout). */
const answers = new Map<string, Promise<PreviewState>>();
/** Per body, the newest request's number: only its late answer may land (codex r2 on #431). */
const generation = new Map<string, number>();
/** Bumped when the presets change ({@link invalidatePresets}): an answer from before never lands. */
let epoch = 0;

/**
 * The saved presets changed (the workflow builder saved one, X-MIG M11): every loaded preset scope
 * and every preview is dropped, so the composer's `/` menu and the launch preview read the store
 * again rather than the steps from before the save (codex r7 on studio B).
 */
export function invalidatePresets(): void {
  epoch += 1;
  inflight.clear();
  answers.clear();
  usePlanCatalog.setState({ presets: {}, previews: {} });
}

/**
 * The engine's ANSWER for `body`, however long it takes (codex on #431): what places a
 * `before:N` gate must not be the timeout's "didn't answer" — a slow engine is not a failed preview,
 * so the launch waits for the answer instead of refusing.
 */
export async function previewAnswer(body: PlanPreviewBody): Promise<PreviewState> {
  const key = previewKey(body);
  // An answer still coming (the preview timed out on screen) is joined, never asked for again.
  let coming = answers.get(key);
  if (coming === undefined) {
    const st = await requestPreview(body);
    if (!(st.status === 'error' && st.timedOut === true)) return st;
    coming = answers.get(key);
    if (coming === undefined) return st;
  }
  // Bounded (codex r2): an engine that never answers must not hang Send — past the wait, the
  // launch says so, as a failed preview always has.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const giveUp = new Promise<PreviewState>((resolve) => {
    timer = setTimeout(() => resolve({ status: 'error', error: PREVIEW_ANSWER_WAIT_TEXT }), PREVIEW_ANSWER_WAIT_MS);
  });
  const st = await Promise.race([coming, giveUp]);
  if (timer !== undefined) clearTimeout(timer);
  return st;
}

/** How long Send waits on an engine that has not answered the preview yet, past the on-screen timeout. */
export const PREVIEW_ANSWER_WAIT_MS = 60_000;
const PREVIEW_ANSWER_WAIT_TEXT = 'the engine still hasn’t answered the preview — try again';

/** How long a launch preview is waited on before it says the engine has not answered (studio#431). */
export const PREVIEW_TIMEOUT_MS = 10_000;
const PREVIEW_TIMEOUT_TEXT =
  `The engine didn’t answer in ${PREVIEW_TIMEOUT_MS / 1000} s — the summary below is studio’s own reading of this launch.`;

/**
 * Preview `body`, once per distinct body: a repeated call answers from the cache (or joins the
 * request in flight). Resolves with the settled state — the composer awaits it at Send so the
 * `before:N` it sends always counts the preview's own steps.
 */
export function requestPreview(body: PlanPreviewBody): Promise<PreviewState> {
  const key = previewKey(body);
  const cached = usePlanCatalog.getState().previews[key];
  // A failed preview is not served from the cache: the composer's "try again" asks again.
  if (cached !== undefined && cached.status !== 'loading' && cached.status !== 'error') return Promise.resolve(cached);
  const running = inflight.get(key);
  if (running !== undefined) return running;
  setPreview(key, { status: 'loading' });
  const born = epoch;
  const answer = teamPlanApi.previewPlan(body).then(
    (preview): PreviewState => ({ status: 'ready', preview }),
    (e: unknown): PreviewState =>
      isRouteUnsupported(e)
        ? { status: 'unsupported' }
        : { status: 'error', error: e instanceof ApiError ? e.message : String(e) },
  );
  // studio#431: under host load the engine's preview can take far longer than a person waits. Past
  // PREVIEW_TIMEOUT_MS the preview says so (an error — not cached, so asking again re-requests it),
  // and an answer that comes later still lands.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<PreviewState>((resolve) => {
    timer = setTimeout(() => resolve({ status: 'error', error: PREVIEW_TIMEOUT_TEXT, timedOut: true }), PREVIEW_TIMEOUT_MS);
  });
  const p: Promise<PreviewState> = Promise.race([answer, late]).then((st) => {
    if (timer !== undefined) clearTimeout(timer);
    if (inflight.get(key) === p) inflight.delete(key);
    if (born === epoch) setPreview(key, st);
    return st;
  });
  const gen = (generation.get(key) ?? 0) + 1;
  generation.set(key, gen);
  answers.set(key, answer);
  void answer.then((st) => {
    if (answers.get(key) === answer) answers.delete(key);
    // The answer after the timeout: shown only if this is the newest request for the body (codex
    // r2: an older late answer never lands over a newer one) and nothing newer is under way.
    if (born === epoch && generation.get(key) === gen && !inflight.has(key) && usePlanCatalog.getState().previews[key]?.status === 'error') setPreview(key, st);
  });
  inflight.set(key, p);
  return p;
}

function setPreview(key: string, st: PreviewState): void {
  usePlanCatalog.setState((s) => ({ previews: { ...s.previews, [key]: st } }));
}
