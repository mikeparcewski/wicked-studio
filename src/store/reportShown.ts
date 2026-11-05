import { create } from 'zustand';
import { api, apiFetch } from '../api/client.js';
import { ApiError } from '../api/errors.js';
import type { AppsListResponse } from '../api/types.js';
import { isAppSlug } from '../editors/apps/appsDirectory.js';

/**
 * WHAT SHOWS ON REPORT (DES-REPORT-DASHBOARDS-001 §2, "Show on Report" and "One pin writer"; operator 2026-11-04: "a
 * show as report option in apps so it can show up there without showing all applications").
 *
 * The list is crew's settings key `studio.report` = `{shown: [slug…]}`: at most {@link REPORT_MAX} app slugs, in the
 * order they were turned on, for the whole daemon (an app shows on its own project's Report and on Insight → Report).
 * Nothing is added to the app's spec: it is a display preference, not the app's content.
 *
 * Every change goes through ONE writer, {@link ReportShownState.setShown}: a serialized queue of intents. Each intent,
 * when its turn comes (never earlier), reads crew's list afresh, re-checks membership and the cap there (gone
 * apps count), writes that list with this one change, waits for crew's answer (one retry), and judges the write by the
 * value crew echoes back. What is shown changes only once a write is confirmed; a load answer older than a confirmed
 * write never replaces it. No write happens before a successful load, in a framed studio, or after crew said only an
 * admin may write (403).
 */

export const REPORT_KEY = 'studio.report';
/** How many apps Report shows, across the daemon (§6 Q6). */
export const REPORT_MAX = 4;
/** The pause before a failed write's one retry. */
export const RETRY_MS = 500;

export const FRAMED_WHY = 'This page is inside another page, so what shows on Report can’t be changed here: open studio on its own.';
export const ADMIN_WHY = 'Only an admin can change what shows on Report on this crew.';
export const UNREAD_WHY = 'Report’s dashboards couldn’t be read';

/** Read state of the list: `empty` = nothing stored (or an empty list), `malformed` = stored but not studio's shape. */
export type ShownLoad = 'idle' | 'loading' | 'ok' | 'empty' | 'malformed' | 'failed';

export type ShownVerdict =
  /** Confirmed (or nothing to write: the slug was already in, or already out). */
  | { kind: 'ok'; shown: readonly string[] }
  /** An add that no longer fits: nothing was written. `shown` is the list as it is. */
  | { kind: 'full'; shown: readonly string[] }
  /** crew answered 200 with another value: the change did not land. */
  | { kind: 'dropped'; reason: string }
  /** No answer, an error, or no write was allowed (not read yet, framed). */
  | { kind: 'failed'; reason: string }
  /** 403: only an admin writes; every switch is read-only for the rest of the session. */
  | { kind: 'refused'; reason: string };

/** A stored `studio.report` value: absent is empty; anything but `{shown: [distinct slugs, at most 4]}` is malformed. */
export function readShown(raw: unknown): { state: 'ok' | 'empty' | 'malformed'; shown: string[] } {
  if (raw === undefined || raw === null) return { state: 'empty', shown: [] };
  if (typeof raw !== 'object' || Array.isArray(raw)) return { state: 'malformed', shown: [] };
  const list = (raw as { shown?: unknown }).shown;
  if (!Array.isArray(list) || list.length > REPORT_MAX || !list.every(isAppSlug) || new Set(list).size !== list.length) return { state: 'malformed', shown: [] };
  return list.length === 0 ? { state: 'empty', shown: [] } : { state: 'ok', shown: [...list as string[]] };
}

const same = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);
const why = (e: unknown): string => (e instanceof Error ? e.message : String(e)).slice(0, 200);
const sleep = (ms: number): Promise<void> => new Promise((r) => { setTimeout(r, ms); });

/** Whether this studio is inside another page (S8: a framed studio changes nothing). One seam, so tests can frame it. */
export const framing = {
  framed: (): boolean => { try { return window.top !== window.self; } catch { return true; } },
};

/** An app's name and project as crew's list says (for the full-cap names and "gone"). */
export interface ShownAppRef { name: string; projectId: string }

export interface ReportShownState {
  load: ShownLoad;
  /** The last load that ended succeeded: the writer may write (a read again in flight keeps it; a failed one clears it). */
  readOk: boolean;
  /** Why the last load failed. */
  loadError: string | null;
  /** The confirmed list, in order. */
  shown: readonly string[];
  /** Only an admin writes here (a 403 seen, or `whoami` said so): every switch is read-only. */
  refused: boolean;
  /** Sign-in is on: the list is shared by everyone on this crew. */
  shared: boolean;
  /** crew's list of apps, for names ("gone" when an app is not in it). */
  apps: { state: 'idle' | 'loading' | 'ok' | 'failed'; bySlug: Readonly<Record<string, ShownAppRef>> };
  /** Read the list (once; `force` reads it again: Try again). */
  loadShown: (force?: boolean) => Promise<void>;
  /** Read crew's list of apps (once; `force` reads it again). */
  loadApps: (force?: boolean) => Promise<void>;
  /** THE writer: turn `slug` on or off Report. */
  setShown: (slug: string, on: boolean) => Promise<ShownVerdict>;
}

/**
 * ONE order for everything that learns crew's list (xreview r2): every read takes a number when it STARTS, and a
 * confirmed write takes a new one when it lands. `applied` is the newest applied. A read that started before what is
 * already applied is older than it: a load then keeps what is shown, and an intent reads again.
 */
let seq = 0;
let applied = 0;
/** What the newest applied list was read as (a malformed list stays said as malformed when an older load settles). */
let appliedState: 'ok' | 'empty' | 'malformed' = 'empty';
/** How many times an intent reads again when newer state keeps overtaking its read, before it gives up. */
const READ_TRIES = 3;
let loading: Promise<void> | null = null;
let appsLoading: Promise<void> | null = null;
/** The writer's queue: each intent starts when the one before it has settled. */
let chain: Promise<unknown> = Promise.resolve();

export const useReportShown = create<ReportShownState>((set, get) => ({
  load: 'idle',
  readOk: false,
  loadError: null,
  shown: [],
  refused: false,
  shared: false,
  apps: { state: 'idle', bySlug: {} },

  loadShown: (force = false) => {
    if (loading !== null) return loading;
    const s = get();
    if (!force && s.load !== 'idle' && s.load !== 'failed') return Promise.resolve();
    const at = ++seq;
    set({ load: 'loading', loadError: null });
    loading = (async () => {
      // Who this studio acts as: a non-admin actor reads every switch as read-only up front (crew's 403 says it
      // anyway), and sign-in on says the list is shared. Optional: a crew that does not answer leaves both to the 403.
      const who = apiFetch<{ actor?: { trust?: unknown }; authMode?: unknown }>('/whoami').catch(() => null);
      try {
        const { settings } = await api.getAppearanceSettings();
        const read = readShown((settings as Record<string, unknown> | undefined)?.[REPORT_KEY]);
        const w = await who;
        const refused = get().refused || (typeof w?.actor?.trust === 'string' && w.actor.trust !== 'admin');
        const shared = w?.authMode === 'required';
        // Something newer (a confirmed write, a later read) was applied while this read was in flight: keep it.
        if (at < applied) set({ load: appliedState, readOk: true, loadError: null, refused, shared });
        else { applied = at; appliedState = read.state; set({ load: read.state, readOk: true, loadError: null, shown: read.shown, refused, shared }); }
      } catch (e) {
        // A failure is a read in the same order (xreview r4): one older than what is applied changes nothing; a newer
        // one stands until a later read or write.
        if (at < applied) set({ load: appliedState, readOk: true, loadError: null });
        else { applied = at; set({ load: 'failed', readOk: false, loadError: why(e) }); }
      } finally {
        loading = null;
      }
    })();
    return loading;
  },

  loadApps: (force = false) => {
    if (appsLoading !== null) return appsLoading;
    if (!force && get().apps.state === 'ok') return Promise.resolve();
    set({ apps: { ...get().apps, state: 'loading' } });
    appsLoading = (async () => {
      try {
        const list = await apiFetch<AppsListResponse>('/apps');
        const bySlug: Record<string, ShownAppRef> = {};
        for (const a of Array.isArray(list?.apps) ? list.apps as unknown[] : []) {
          const r = a as Record<string, unknown>;
          if (typeof r !== 'object' || r === null || !isAppSlug(r['slug'])) continue;
          bySlug[r['slug'] as string] = { name: typeof r['name'] === 'string' && r['name'].trim() !== '' ? r['name'].slice(0, 120) : r['slug'] as string, projectId: typeof r['projectId'] === 'string' ? r['projectId'] : '' };
        }
        set({ apps: { state: 'ok', bySlug } });
      } catch {
        set({ apps: { state: 'failed', bySlug: get().apps.bySlug } });
      } finally {
        appsLoading = null;
      }
    })();
    return appsLoading;
  },

  setShown: (slug, on) => {
    // The payload is computed HERE, when the intent's turn comes, from the list as it is confirmed then: never from a
    // snapshot taken when the person clicked (a retry is the intent again, against the state as it is at its turn).
    /**
     * One ordered read, applied only if nothing newer landed meanwhile. If it fails, the write's own landed echo is
     * shown (xreview r5): never an older list left looking confirmed after crew said this write landed.
     */
    const reconcile = async (landed: readonly string[] | null): Promise<void> => {
      const my = ++seq;
      try {
        const { settings } = await api.getAppearanceSettings();
        const read = readShown((settings as Record<string, unknown> | undefined)?.[REPORT_KEY]);
        if (my < applied) return;
        applied = my;
        appliedState = read.state;
        set({ shown: read.shown, load: read.state, readOk: true, loadError: null });
      } catch {
        if (landed === null) return;
        applied = ++seq;
        appliedState = landed.length === 0 ? 'empty' : 'ok';
        set({ shown: landed, load: appliedState, readOk: true, loadError: null });
      }
    };
    const run = async (): Promise<ShownVerdict> => {
      if (framing.framed()) return { kind: 'failed', reason: FRAMED_WHY };
      const s = get();
      if (s.refused) return { kind: 'refused', reason: ADMIN_WHY };
      if (!s.readOk) return { kind: 'failed', reason: UNREAD_WHY };
      if (!isAppSlug(slug)) return { kind: 'failed', reason: 'that is not an app’s address' };
      // Every attempt (the first and its one retry) starts from crew's list as it is THEN (xreview r1, r2): another
      // studio's entry, or an earlier attempt of ours that landed although its answer was lost, is kept, and the cap
      // and membership are judged again. The read's place in the one order is checked with nothing awaited between
      // that check and the PUT starting (xreview r3). Only a write landing in the one round trip between this read
      // and the PUT can still be lost (the last write wins, as for every `studio.*` key).
      for (let attempt = 0, rereads = 0; ;) {
        const my = ++seq;
        let read: ReturnType<typeof readShown>;
        try {
          const { settings } = await api.getAppearanceSettings();
          read = readShown((settings as Record<string, unknown> | undefined)?.[REPORT_KEY]);
        } catch (e) {
          return { kind: 'failed', reason: `${UNREAD_WHY} (${why(e)})` };
        }
        if (my < applied) {
          // A newer read or write landed while this one was in flight: read again (bounded).
          rereads += 1;
          if (rereads >= READ_TRIES) return { kind: 'failed', reason: `${UNREAD_WHY} (it kept changing while it was read)` };
          continue;
        }
        applied = my;
        appliedState = read.state;
        // A good read is a good read: it also ends a failed load's "couldn't be read" (xreview r3).
        set({ shown: read.shown, load: read.state, readOk: true, loadError: null });
        const cur = read.shown;
        const has = cur.includes(slug);
        if (on === has) return { kind: 'ok', shown: cur };
        if (on && cur.length >= REPORT_MAX) return { kind: 'full', shown: cur };
        const next = on ? [...cur, slug] : cur.filter((x) => x !== slug);
        // The write takes its place in the order when it STARTS (xreview r4): a list applied while its answer was on
        // the way is newer than what the answer echoes, so the answer never replaces it; one ordered read settles it.
        const mine = ++seq;
        try {
          const r = await api.putReportShown(next);
          const echoed = readShown((r?.settings as Record<string, unknown> | undefined)?.[REPORT_KEY]);
          // Proof is the echoed VALUE, not the key: a crew that kept another list while ignoring this write still
          // answers 200 with the key.
          const landed = echoed.state !== 'malformed' && same(echoed.shown, next);
          if (applied > mine) await reconcile(landed ? next : null);
          else if (echoed.state !== 'malformed') {
            applied = ++seq;
            appliedState = echoed.state;
            set({ shown: echoed.shown, load: echoed.state, readOk: true, loadError: null });
          }
          return landed ? { kind: 'ok', shown: get().shown } : { kind: 'dropped', reason: 'crew answered, but kept another list' };
        } catch (e) {
          if (e instanceof ApiError && e.status === 403) {
            set({ refused: true });
            return { kind: 'refused', reason: ADMIN_WHY };
          }
          if (attempt >= 1) return { kind: 'failed', reason: why(e) };
          attempt += 1;
          await sleep(RETRY_MS);
        }
      }
    };
    const p = chain.then(run, run);
    chain = p.catch(() => undefined);
    return p;
  },
}));

/** An app's name for a line ("Escalations"), "<slug> (gone)" when crew's list no longer has it. */
export function shownName(slug: string, apps: ReportShownState['apps']): string {
  const ref = apps.bySlug[slug];
  if (ref !== undefined) return ref.name;
  return apps.state === 'ok' ? `${slug} (gone)` : slug;
}

/** TESTS: back to a fresh session. */
export function resetReportShown(): void {
  seq = 0;
  applied = 0;
  appliedState = 'empty';
  loading = null;
  appsLoading = null;
  chain = Promise.resolve();
  useReportShown.setState({ load: 'idle', readOk: false, loadError: null, shown: [], refused: false, shared: false, apps: { state: 'idle', bySlug: {} } });
}
