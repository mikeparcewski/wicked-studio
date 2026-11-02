import { create } from 'zustand';
import { apiFetch } from '../api/client.js';
import { normalizeSnapshot, type SystemSnapshot } from '../api/system.js';
import { getVoiceDashboard, putVoiceDashboard, type VoiceWidgetManifest } from '../api/voice.js';
import { readMetric } from './widgets.js';

/**
 * The voice dashboard's state: the person's layout and user widgets (crew `GET|PUT /voice/dashboard`, per actor),
 * and the live reads the widgets draw (`GET /system`, and `GET /diagnostics` when a user widget reads it), polled
 * only while voice mode is full screen. Each reading is kept for a short history, so a number can be a chart.
 */

export const DASH_POLL_MS = 15_000;
const HISTORY = 24;
const LOCAL_KEY = 'studio.voice.dashboard';

interface DashState {
  loaded: boolean;
  layout: string[] | null;
  widgets: VoiceWidgetManifest[];
  /** Where the layout is kept: crew (per person), or this browser (a crew without the route). */
  storedIn: 'crew' | 'browser';
  saveError: string | null;
  system: SystemSnapshot | null;
  raw: { system: unknown; diagnostics: unknown };
  /** Recent readings per `source:path` (and `load` for the machine tile), oldest first. */
  history: Record<string, number[]>;
  readAt: number | null;
  readError: string | null;
}

export const useDashStore = create<DashState>(() => ({
  loaded: false, layout: null, widgets: [], storedIn: 'crew', saveError: null,
  system: null, raw: { system: null, diagnostics: null }, history: {}, readAt: null, readError: null,
}));

const S = useDashStore;

function readLocal(): { layout: string[] | null; widgets: VoiceWidgetManifest[] } {
  try {
    const v = JSON.parse(localStorage.getItem(LOCAL_KEY) ?? 'null') as { layout?: unknown; widgets?: unknown } | null;
    return {
      layout: Array.isArray(v?.layout) ? v.layout.filter((x): x is string => typeof x === 'string') : null,
      widgets: Array.isArray(v?.widgets) ? (v.widgets as VoiceWidgetManifest[]) : [],
    };
  } catch { return { layout: null, widgets: [] }; }
}

export async function loadDashboard(): Promise<void> {
  try {
    const d = await getVoiceDashboard();
    S.setState({ loaded: true, layout: d.layout, widgets: d.widgets, storedIn: 'crew', saveError: null });
  } catch {
    // A crew without the route (or without a state home) still gets a dashboard, kept in this browser.
    const local = readLocal();
    S.setState({ loaded: true, ...local, storedIn: 'browser', saveError: null });
  }
}

/** Save the layout (and user widgets). The screen moves at once; a failed save says so and keeps it locally. */
export async function saveDashboard(layout: string[], widgets: VoiceWidgetManifest[] = S.getState().widgets): Promise<void> {
  S.setState({ layout, widgets, saveError: null });
  if (S.getState().storedIn === 'browser') {
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify({ layout, widgets })); } catch { /* private mode */ }
    return;
  }
  try {
    const d = await putVoiceDashboard({ layout, widgets });
    S.setState({ layout: d.layout, widgets: d.widgets });
  } catch (e) {
    S.setState({ saveError: `Not saved: ${e instanceof Error ? e.message : String(e)}` });
  }
}

const push = (h: Record<string, number[]>, key: string, v: number | null): void => {
  if (v === null) return;
  h[key] = [...(h[key] ?? []), v].slice(-HISTORY);
};

/** One read of what the widgets draw. */
export async function readDashboardData(): Promise<void> {
  const { widgets } = S.getState();
  const wantDiag = widgets.some((w) => w.metric.source === 'diagnostics');
  try {
    const [system, diagnostics] = await Promise.all([
      apiFetch<unknown>('/system'),
      wantDiag ? apiFetch<unknown>('/diagnostics').catch(() => null) : Promise.resolve(S.getState().raw.diagnostics),
    ]);
    const snap = normalizeSnapshot(system);
    const history = { ...S.getState().history };
    const load = snap.infra.find((i) => i.key === 'load')?.load?.load1 ?? null;
    push(history, 'load', load);
    for (const w of widgets) {
      const doc = w.metric.source === 'system' ? system : diagnostics;
      push(history, `${w.metric.source}:${w.metric.path}`, readMetric(doc, w.metric.path));
    }
    S.setState({ system: snap, raw: { system, diagnostics }, history, readAt: Date.now(), readError: null });
  } catch (e) {
    S.setState({ readError: e instanceof Error ? e.message : String(e) });
  }
}

/** Tests. */
export function resetDashStore(): void {
  S.setState({ loaded: false, layout: null, widgets: [], storedIn: 'crew', saveError: null, system: null, raw: { system: null, diagnostics: null }, history: {}, readAt: null, readError: null });
}
