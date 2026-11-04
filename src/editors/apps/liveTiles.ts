import { apiFetch } from '../../api/client.js';
import { ApiError } from '../../api/errors.js';
import type { AppSpec } from '../../api/types.js';

/**
 * LIVE NUMBERS ON THE APPS DASHBOARD (operator 2026-11-04: "dashboard should show real time information").
 *
 * Each card runs its app's headline KPI queries (the KPI components on the app's first page, at most three) through
 * crew's query route, the same path the app itself uses (`POST /apps/:app/query`: the viewer's identity, the read
 * policy, deadlines and caps, an accepted version only). The rules that protect the sources:
 *
 *  - **Only while seen.** A card runs only while it is on screen (an `IntersectionObserver`) AND the tab is visible
 *    (`document.hidden`): an off-screen card or a hidden tab sends nothing. Coming back runs what is due.
 *  - **Refresh**: every 30 s, or faster when the app's own KPI queries ask for it (`refresh: every N s`, never under
 *    10 s); a query that refreshes on load only keeps the 30 s default.
 *  - **At most 3 card queries at once**, for the whole dashboard, and the cards are staggered (one card started every
 *    400 ms), so a dashboard of many apps is a trickle, not a burst.
 *  - **Shared results**: crew's executor caches each answer per (version, query, parameters) for its window — 5 s for
 *    an on-load query, half the period for a timed one (crew `apps/exec/cache.ts`) — so cards, the open app and other
 *    viewers inside that window share one read. A card never starts more reads than the app does on open: its KPI
 *    queries are a subset of the first page's.
 *  - **Honest numbers**: a refresh that fails shows the card without numbers and crew's reason code; a number is
 *    never shown stale as if it were live. "updated Ns ago" is the time of the answer shown.
 */

export const TILE_EVERY_MS = 30_000;
export const TILE_MIN_EVERY_MS = 10_000;
export const TILE_MAX_CONCURRENT = 3;
export const TILE_STAGGER_MS = 400;
export const TILE_TICK_MS = 1_000;

/** One headline number a card shows: the KPI's title, and the query and column it reads. */
export interface TileKpiDef { title: string; query: string; column: string; format?: unknown }

/** The KPI components on the app's first page (up to three), in order. */
export function tileKpis(spec: AppSpec): TileKpiDef[] {
  const out: TileKpiDef[] = [];
  for (const c of spec.pages[0]?.components ?? []) {
    if (c.type !== 'kpi' || out.length >= 3) continue;
    const k = c as unknown as { title?: string; value: string; data: { query: string }; format?: unknown };
    out.push({ title: (k.title ?? k.value).slice(0, 60), query: k.data.query, column: k.value, ...(k.format !== undefined ? { format: k.format } : {}) });
  }
  return out;
}

/** How often a card refreshes: 30 s, or faster when the app's own KPI queries say so (never under 10 s). */
export function tileEveryMs(spec: AppSpec, kpis: readonly TileKpiDef[]): number {
  let every = TILE_EVERY_MS;
  for (const k of kpis) {
    const q = spec.queries.find((x) => x.id === k.query) as { refresh?: { mode?: string; seconds?: number } } | undefined;
    if (q?.refresh?.mode === 'every' && typeof q.refresh.seconds === 'number') every = Math.min(every, Math.max(TILE_MIN_EVERY_MS, q.refresh.seconds * 1000));
  }
  return every;
}

export interface QueryAnswer { columns: Array<{ name: string }>; rows: unknown[][]; cachedAt?: number | null }
export type QueryOutcome = { ok: true; answer: QueryAnswer } | { ok: false; code: string };

/** crew's query route, keeping crew's reason code on a refusal. */
export async function crewQuery(slug: string, version: number, query: string): Promise<QueryOutcome> {
  try {
    const answer = await apiFetch<QueryAnswer>(`/apps/${encodeURIComponent(slug)}/query`, { method: 'POST', body: JSON.stringify({ version, query, params: {} }) });
    if (!Array.isArray(answer?.columns) || !Array.isArray(answer.rows)) return { ok: false, code: 'bad_answer' };
    return { ok: true, answer };
  } catch (e) {
    if (e instanceof ApiError) {
      const b = (typeof e.body === 'object' && e.body !== null ? e.body : {}) as { code?: unknown };
      return { ok: false, code: typeof b.code === 'string' ? b.code.slice(0, 40) : `http_${e.status}` };
    }
    return { ok: false, code: 'unreachable' };
  }
}

/** A card's numbers as the dashboard shows them. */
export interface TileState {
  /** One per KPI, in order: the raw cell (formatted by the card), or null with no number. */
  values: Array<{ cell: unknown; ok: boolean }>;
  /** When the numbers shown were read (unix millis), or null before any. */
  at: number | null;
  /** crew's reason code when the last refresh failed (the card then shows no numbers). */
  code: string | null;
  /** Bumped every time a value changed (the preview redraws on it). */
  changes: number;
}

interface Card {
  slug: string;
  version: number;
  kpis: TileKpiDef[];
  every: number;
  seen: boolean;
  next: number;
  running: boolean;
  state: TileState;
  listener: (s: TileState) => void;
}

export interface TileSchedulerOptions {
  query?: (slug: string, version: number, query: string) => Promise<QueryOutcome>;
  now?: () => number;
  hidden?: () => boolean;
  maxConcurrent?: number;
  staggerMs?: number;
}

/**
 * The dashboard's one scheduler: cards register, say when they are on screen, and get their numbers. A global queue
 * runs at most {@link TILE_MAX_CONCURRENT} queries at once; a tick (driven by the page) starts due, seen cards, one per
 * stagger step. Also the limiter the previews' reads go through ({@link TileScheduler.limit}).
 */
export class TileScheduler {
  private readonly cards = new Map<string, Card>();
  private readonly queue: Array<() => Promise<void>> = [];
  private active = 0;
  private lastStart = Number.NEGATIVE_INFINITY;
  private readonly q: (slug: string, version: number, query: string) => Promise<QueryOutcome>;
  private readonly now: () => number;
  private readonly hidden: () => boolean;
  readonly max: number;
  private readonly stagger: number;
  /** TESTS: the most queries that were ever in flight together. */
  peak = 0;

  constructor(o: TileSchedulerOptions = {}) {
    this.q = o.query ?? crewQuery;
    this.now = o.now ?? Date.now;
    this.hidden = o.hidden ?? (() => typeof document !== 'undefined' && document.hidden);
    this.max = o.maxConcurrent ?? TILE_MAX_CONCURRENT;
    this.stagger = o.staggerMs ?? TILE_STAGGER_MS;
  }

  register(key: string, input: { slug: string; version: number; spec: AppSpec }, listener: (s: TileState) => void): { seen: (on: boolean) => void; dispose: () => void } {
    const kpis = tileKpis(input.spec);
    const card: Card = {
      slug: input.slug, version: input.version, kpis, every: tileEveryMs(input.spec, kpis), seen: false, next: 0, running: false,
      state: { values: kpis.map(() => ({ cell: null, ok: false })), at: null, code: null, changes: 0 }, listener,
    };
    this.cards.set(key, card);
    return {
      seen: (on) => { card.seen = on; if (on) this.tick(); },
      dispose: () => { if (this.cards.get(key) === card) this.cards.delete(key); },
    };
  }

  /** Run `fn` as one of the dashboard's queries: it waits for a free slot (at most {@link max} at once). */
  limit<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push(async () => {
        try { resolve(await fn()); } catch (e) { reject(e); }
      });
      this.pump();
    });
  }

  private pump(): void {
    while (this.active < this.max && this.queue.length > 0) {
      const job = this.queue.shift()!;
      this.active += 1;
      this.peak = Math.max(this.peak, this.active);
      void job().finally(() => { this.active -= 1; this.pump(); });
    }
  }

  /** Start what is due: only seen cards, only while the tab is visible, one card per stagger step. */
  tick(): void {
    if (this.hidden()) return;
    const t = this.now();
    for (const card of this.cards.values()) {
      if (!card.seen || card.running || card.kpis.length === 0 || t < card.next) continue;
      if (t - this.lastStart < this.stagger) return; // the next tick starts the next card
      this.lastStart = t;
      void this.refresh(card);
    }
  }

  private async refresh(card: Card): Promise<void> {
    card.running = true;
    try {
      const queries = [...new Set(card.kpis.map((k) => k.query))];
      const got = new Map<string, QueryOutcome>();
      await Promise.all(queries.map((q) => this.limit(async () => {
        // A tab hidden or a card scrolled away while it waited for a slot sends nothing.
        if (this.hidden() || !card.seen) { got.set(q, { ok: false, code: 'skipped' }); return; }
        got.set(q, await this.q(card.slug, card.version, q));
      })));
      if ([...got.values()].some((o) => !o.ok && o.code === 'skipped')) { card.next = 0; return; }
      const failed = [...got.values()].find((o): o is { ok: false; code: string } => !o.ok);
      const before = JSON.stringify(card.state.values);
      if (failed !== undefined) {
        // Never a stale number dressed as live: a failed refresh shows no numbers, and says why.
        card.state = { values: card.kpis.map(() => ({ cell: null, ok: false })), at: this.now(), code: failed.code, changes: card.state.changes + (before === JSON.stringify(card.kpis.map(() => ({ cell: null, ok: false }))) ? 0 : 1) };
      } else {
        const values = card.kpis.map((k) => {
          const o = got.get(k.query);
          if (o === undefined || !o.ok) return { cell: null, ok: false };
          const i = o.answer.columns.findIndex((c) => c.name === k.column);
          const row = o.answer.rows[0];
          return i < 0 || row === undefined ? { cell: null, ok: false } : { cell: row[i] ?? null, ok: true };
        });
        card.state = { values, at: this.now(), code: values.every((v) => v.ok) ? null : 'no_value', changes: card.state.changes + (JSON.stringify(values) === before ? 0 : 1) };
      }
      card.listener(card.state);
      card.next = this.now() + card.every;
    } finally {
      card.running = false;
    }
  }
}
