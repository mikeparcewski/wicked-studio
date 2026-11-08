import type { AppDetail, AppSpec } from '../../api/types.js';
import { applyOps, inventoryOf, opsSummary, type AppInventory, type SpecOp } from './appOps.js';
import { archivedOf, type AppStorePort, type StoreRefusal } from './appStore.js';

/**
 * One app open in the host (DES-APPS-001 §6.2, §6.4; slice K4): the head crew answered, the edit burst on top of it,
 * and the one landing in flight.
 *
 *  - Every op the runtime sends carries the version it was made on (`base`). Only the head this session knows is
 *    accepted; anything else is `head_moved` with the head, so the runtime re-reads.
 *  - Ops that pass the host's inventory join the BURST: the runtime is shown the working spec at once, and the burst
 *    lands as ONE version after `burstMs` without another op (a drag that sent a hundred moves is still one version).
 *  - The landing names the head it was made on; crew's `409 stale_base` (another tab, or an undo elsewhere) drops the
 *    burst and re-reads, so two tabs never both step from the same version.
 *  - Undo, redo and (G16) restoring an earlier version land the burst first, then change crew's head from it. One of
 *    them at a time: while one lands, an edit and another are refused, never re-based onto its result.
 *  - An archived app (G16) is read-only here as crew holds it: no new edit, move or restore is taken, and a burst still
 *    waiting when the archive is seen is dropped, saying so (crew would refuse it), until it is restored from Archived.
 */

export type SessionEvent =
  | { kind: 'head'; app: AppDetail; by: 'this-session' | 'elsewhere' }
  | { kind: 'pending'; count: number }
  | { kind: 'failed'; message: string; app: AppDetail | null };

export type EditResult =
  | { ok: true; spec: AppSpec; added: string[]; pending: number }
  | { ok: false; code: 'head_moved' | 'refused' | 'bad_request'; message: string; head?: number };

export const BURST_MS = 1_000;
/** The most ops one burst holds before it lands without waiting; while that landing is in flight, more are refused. */
export const BURST_MAX_OPS = 200;
/** A burst lands at most this long after its first op, however often ops keep coming (no debounce starvation). */
export const BURST_MAX_AGE_MS = 5_000;

type What = 'saved' | 'undone' | 'redone' | 'restored';

const ARCHIVED_WHY = 'the app is archived; restore it from Archived to change it';

function words(r: StoreRefusal, what: What = 'saved'): string {
  const not = `Not ${what}`;
  if (r.code === 'stale_base') return `${not}: the app changed in another tab or window; this is its newest version`;
  if (r.code === 'turn_in_flight') return `${not}: a chat turn is changing the app; it is read-only until the turn ends`;
  if (r.code === 'app_archived') return `${not}: ${ARCHIVED_WHY}`;
  if (r.code === 'not_accepted') return `${not}: that version was never accepted, so it cannot come back`;
  if (r.code === 'check_failed') return `${not}: ${r.findings?.[0]?.message ?? r.message}`;
  if (r.code === 'source_check_unavailable') return `${not}: ${r.message}`;
  if (r.code === 'nothing_to_undo') return 'Nothing to undo';
  if (r.code === 'nothing_to_redo') return 'Nothing to redo';
  if (r.code === 'unavailable') return `Whether it was ${what} is not known: ${r.message}`;
  return `${not}: ${r.message}`;
}

/** What the chat shows of crew's turn log, as one comparable mark (how many, and the newest one's run and state). */
function turnLogMark(app: AppDetail): string {
  const t = (app as unknown as { turns?: unknown }).turns;
  if (!Array.isArray(t)) return '';
  const last = t[t.length - 1] as { runId?: unknown; state?: unknown } | undefined;
  return `${t.length}:${String(last?.runId ?? '')}:${String(last?.state ?? '')}`;
}

export type MoveResult = { ok: true; version: number } | { ok: false; code: string; message: string; head?: number };

export class AppSession {
  private app: AppDetail | null = null;
  /** The working spec: the head's spec with the burst applied (what the runtime is shown). */
  private working: AppSpec | null = null;
  private burst: SpecOp[] = [];
  private burstBefore: AppSpec | null = null;
  private burstStarted = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private landing: Promise<boolean> | null = null;
  /** How many of the burst's first ops the landing in flight carries (the rest arrived after it began). */
  private inFlight = 0;
  /** An undo or a redo in flight (its burst landing first included): edits and a second move wait for it. */
  private moving = false;
  /** (G16) Resolves when the undo, redo or restore in flight has settled (a chat send waits for it: it names the head). */
  private moveDone: Promise<void> | null = null;
  /** Bumped whenever the head this session holds changes: an answer begun under an older generation is dropped. */
  private gen = 0;
  private listeners = new Set<(e: SessionEvent) => void>();
  private readonly burstMs: number;
  private readonly now: () => number;

  constructor(readonly store: AppStorePort, opts: { burstMs?: number; now?: () => number } = {}) {
    this.burstMs = opts.burstMs ?? BURST_MS;
    this.now = opts.now ?? Date.now;
  }

  on(fn: (e: SessionEvent) => void): () => void { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private emit(e: SessionEvent): void { for (const fn of [...this.listeners]) fn(e); }

  get detail(): AppDetail | null { return this.app; }
  get head(): number { return this.app?.head.version ?? 0; }
  /** The spec the runtime is shown: the head with the burst on top. */
  get spec(): AppSpec | null { return this.working; }
  /** The landed head's spec: queries and actions run only on a landed version (§7.2 step 1). */
  get landedSpec(): AppSpec | null { return this.app?.spec ?? null; }
  get pending(): number { return this.burst.length; }
  /** A turn in flight, or (G16) an archived app: nothing changes from here until it ends or the app is restored. */
  get readonly(): boolean { return this.app?.turn != null || this.archived; }
  /** (G16) crew says the app is archived. */
  get archived(): boolean { return archivedOf(this.app) != null; }
  /** Why an edit, a move or a restore is refused before anything is sent, or null. */
  private readonlyWhy(): string {
    return this.app?.turn != null ? 'a chat turn is changing the app; it is read-only until the turn ends' : ARCHIVED_WHY;
  }
  inventory(): AppInventory | null { return this.working === null ? null : inventoryOf(this.working); }

  async load(): Promise<AppDetail> {
    const app = await this.store.detail();
    this.adopt(app);
    return app;
  }

  /** Take `app` as the head, dropping any burst (said: the pending count goes to 0). */
  private adopt(app: AppDetail): void {
    const had = this.burst.length > 0;
    this.app = app;
    this.gen += 1;
    this.working = structuredClone(app.spec);
    this.burst = [];
    this.burstBefore = null;
    this.clearTimer();
    if (had) this.emit({ kind: 'pending', count: 0 });
  }

  /** Read crew's head again (focus, visibility, a timer). A head that moved under an open burst drops the burst. */
  async refresh(): Promise<void> {
    if (this.landing !== null || this.moving) return;
    const gen = this.gen;
    let app: AppDetail;
    try { app = await this.store.detail(); } catch { return; }
    // Anything that changed the head meanwhile (a landing, a move, another refresh) makes this answer obsolete, and
    // versions only grow: an answer older than the head held is never adopted.
    if (this.landing !== null || this.moving || this.app === null || gen !== this.gen) return;
    if (app.head.version < this.app.head.version) return;
    const moved = app.head.version > this.app.head.version;
    const turnChanged = (app.turn?.runId ?? null) !== (this.app.turn?.runId ?? null);
    // (K5) The chat reads crew's turn log: a turn that started and ended between two reads changed nothing else.
    const turnsChanged = turnLogMark(app) !== turnLogMark(this.app);
    // (G16) Archived or restored in another tab: the head is the same, the app's state is not.
    const archivedChanged = archivedOf(app) != null !== this.archived;
    const publishedChanged = JSON.stringify(app.published) !== JSON.stringify(this.app.published);
    if (!moved && !turnChanged && !turnsChanged && !archivedChanged && !publishedChanged) return;
    // Archived meanwhile, with a burst waiting: it is dropped NOW, saying so, so it can never save later (an unarchive
    // seen before its timer would otherwise land it; codex r2).
    if (!moved && archivedChanged && archivedOf(app) != null && this.burst.length > 0) {
      this.adopt(app);
      this.emit({ kind: 'failed', message: `Not saved: ${ARCHIVED_WHY}`, app });
      this.emit({ kind: 'head', app, by: 'elsewhere' });
      return;
    }
    if (moved) {
      const hadBurst = this.burst.length > 0;
      this.adopt(app);
      if (hadBurst) this.emit({ kind: 'failed', message: 'Not saved: the app changed in another tab or window; this is its newest version', app });
    } else {
      this.app = app; // only the turn state changed: the burst (if any) stays on the same head
      this.gen += 1;
    }
    this.emit({ kind: 'head', app, by: 'elsewhere' });
  }

  /**
   * (G16) crew's answer to a change made outside the session (archive, unarchive): taken as the session's own state, so
   * the next read compares against it and every view draws from one place (codex r2: a re-archive in another tab was
   * otherwise never seen). An answer older than the head held is ignored.
   */
  take(app: AppDetail): void {
    if (this.app === null || app.head.version < this.app.head.version) return;
    if (app.head.version > this.app.head.version) this.adopt(app);
    else { this.app = app; this.gen += 1; }
    this.emit({ kind: 'head', app, by: 'elsewhere' });
  }

  /** The runtime's ops, on the version it named. Synchronous: checked against the working spec, then queued. */
  edit(base: number, ops: readonly unknown[]): EditResult {
    if (this.app === null || this.working === null) return { ok: false, code: 'refused', message: 'the app is not loaded yet' };
    if (this.readonly) return { ok: false, code: 'refused', message: this.readonlyWhy() };
    if (this.moving) return { ok: false, code: 'refused', message: 'an undo or redo, or a restore, is landing; try again in a moment' };
    if (base !== this.app.head.version) return { ok: false, code: 'head_moved', message: 'the app changed since', head: this.app.head.version };
    // At most BURST_MAX_OPS per version: a batch that would take the burst past it lands the burst so far first, and
    // while that landing is in flight a further full burst waits (codex r2: a 50-op batch at 199 made 249).
    const queued = this.burst.length - this.inFlight;
    if (queued > 0 && queued + ops.length > BURST_MAX_OPS) {
      if (this.landing !== null) return { ok: false, code: 'refused', message: 'still saving the last changes; try again in a moment' };
      void this.flush(); // takes the burst as it is now, synchronously; these ops follow it
    }
    const r = applyOps(this.working, ops);
    if (!r.ok) return { ok: false, code: r.code, message: r.message };
    if (this.burst.length === 0) { this.burstBefore = this.working; this.burstStarted = this.now(); }
    this.working = r.spec;
    this.burst.push(...(ops as SpecOp[]));
    this.clearTimer();
    // A burst is a person's gesture or two: it lands 1 s after the last op, but never later than its maximum age and
    // never larger than its maximum size, however a runtime keeps sending.
    const age = this.now() - this.burstStarted;
    if (this.burst.length - this.inFlight >= BURST_MAX_OPS || age >= BURST_MAX_AGE_MS) void this.flush();
    else this.timer = setTimeout(() => { void this.flush(); }, Math.min(this.burstMs, BURST_MAX_AGE_MS - age));
    this.emit({ kind: 'pending', count: this.burst.length });
    return { ok: true, spec: r.spec, added: r.added, pending: this.burst.length };
  }

  private clearTimer(): void { if (this.timer !== null) { clearTimeout(this.timer); this.timer = null; } }

  /** Land the burst now as one version. True when nothing is left pending because it landed (or there was nothing);
   *  false when crew refused it or the answer was lost (the burst is dropped and the head re-read). */
  async flush(): Promise<boolean> {
    this.clearTimer();
    // A landing already in flight is part of what this flush stands for: if crew refused it, so does this (codex r2).
    while (this.landing !== null) if (!(await this.landing)) return false;
    if (this.burst.length === 0 || this.app === null || this.working === null) return true;
    // Archived meanwhile (another tab): crew refuses every change, so the burst is dropped here and the person told.
    if (this.archived) {
      this.adopt(this.app);
      this.emit({ kind: 'failed', message: `Not saved: ${ARCHIVED_WHY}`, app: this.app });
      return false;
    }
    const base = this.app.head.version;
    const spec = this.working;
    const landedOps = this.burst.length;
    const summary = opsSummary(this.burstBefore ?? this.app.spec, spec, this.burst);
    this.inFlight = landedOps;
    const job = (async (): Promise<boolean> => {
      const r = await this.store.edit(base, spec, summary).finally(() => { this.inFlight = 0; });
      if (r.ok) {
        // Ops that arrived while this landed were made on top of it: they stay in the burst, on the new head.
        const later = this.burst.slice(landedOps);
        const laterSpec = this.working;
        this.app = r.app;
        this.gen += 1;
        this.burst = later;
        this.working = later.length > 0 && laterSpec !== null ? laterSpec : structuredClone(r.app.spec);
        this.burstBefore = later.length > 0 ? structuredClone(r.app.spec) : null;
        this.burstStarted = this.now();
        this.emit({ kind: 'head', app: r.app, by: 'this-session' });
        if (later.length > 0) this.timer = setTimeout(() => { void this.flush(); }, this.burstMs);
        this.emit({ kind: 'pending', count: this.burst.length });
        return true;
      }
      await this.recover(r);
      return false;
    })();
    this.landing = job.finally(() => { this.landing = null; });
    return this.landing;
  }

  /** A refused landing or move: drop the burst, read crew's head, say why. */
  private async recover(r: StoreRefusal, what: What = 'saved'): Promise<void> {
    this.clearTimer();
    let app: AppDetail | null = null;
    try { app = await this.store.detail(); } catch { app = this.app; }
    if (app !== null) this.adopt(app);
    this.emit({ kind: 'failed', message: words(r, what), app });
    if (app !== null) this.emit({ kind: 'head', app, by: 'elsewhere' });
    this.emit({ kind: 'pending', count: 0 });
  }

  /**
   * Undo or redo within crew's accepted history, from the version the caller saw (`base`). One at a time: a second
   * move while one is in flight is refused (never silently re-based onto the first's result), and so is an edit. The
   * caller's own burst lands first; if crew refuses it, nothing is undone.
   */
  async move(direction: 'undo' | 'redo', base: number): Promise<MoveResult> {
    return this.change(direction === 'undo' ? 'undone' : 'redone', base, (from) => this.store.move(direction, from));
  }

  /**
   * (G16, operator ruling D5) Restore an earlier accepted version, from the version the caller saw (`base`). It goes
   * through exactly the serialisation undo and redo do: one change of the head at a time, never during a turn or on an
   * archived app, the caller's own burst landed first (if crew refuses it, nothing is restored), then crew's CAS on the
   * head that burst made. The version lands as a new head; the one it replaces stays in the history.
   */
  async restore(version: number, base: number): Promise<MoveResult> {
    return this.change('restored', base, (from) => this.store.restore(from, version));
  }

  private async change(what: 'undone' | 'redone' | 'restored', base: number, send: (from: number) => ReturnType<AppStorePort['move']>): Promise<MoveResult> {
    if (this.app === null) return { ok: false, code: 'refused', message: 'the app is not loaded yet' };
    if (this.readonly) return { ok: false, code: 'refused', message: this.readonlyWhy() };
    if (this.moving) return { ok: false, code: 'refused', message: 'an undo or redo, or a restore, is already landing' };
    if (base !== this.app.head.version) return { ok: false, code: 'head_moved', message: 'the app changed since', head: this.app.head.version };
    this.moving = true;
    let done!: () => void;
    this.moveDone = new Promise<void>((res) => { done = res; });
    try {
      if (!(await this.flush())) return { ok: false, code: 'refused', message: `Not ${what}: your last change did not land`, ...(this.app !== null ? { head: this.app.head.version } : {}) };
      while (this.landing !== null) if (!(await this.landing)) return { ok: false, code: 'refused', message: `Not ${what}: your last change did not land` };
      const from = this.app.head.version;
      const r = await send(from);
      if (r.ok) {
        this.adopt(r.app);
        this.emit({ kind: 'head', app: r.app, by: 'this-session' });
        return { ok: true, version: r.landed.version };
      }
      await this.recover(r, what);
      return { ok: false, code: r.code, message: words(r, what), ...(this.app !== null ? { head: this.app.head.version } : {}) };
    } finally {
      this.moving = false;
      this.moveDone = null;
      done();
    }
  }

  /** (G16) Wait for an undo, redo or restore in flight to settle (at once when there is none). */
  async settled(): Promise<void> {
    while (this.moveDone !== null) await this.moveDone;
  }

  /** The view closes: a burst the runtime was told is pending still lands (it is not dropped); nothing is heard after. */
  dispose(): void {
    this.listeners.clear();
    if (this.burst.length > 0) void this.flush();
    else this.clearTimer();
  }
}

/**
 * (K5) Before a chat message is sent: land every pending edit, those made while one landed included, and answer the
 * head they made; null when an edit could not be saved or edits keep arriving (the message then waits).
 */
export async function drainForSend(s: { readonly pending: number; readonly head: number; flush(): Promise<boolean>; settled?: () => Promise<void> }, rounds = 6): Promise<number | null> {
  // (G16) An undo, redo or restore in flight lands first: the turn is sent on the head it made, never on the one before.
  await s.settled?.();
  for (let i = 0; i < rounds && s.pending > 0; i += 1) if (!(await s.flush())) return null;
  return s.pending > 0 ? null : s.head;
}
