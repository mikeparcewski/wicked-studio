import type { AppDetail, AppSpec } from '../../api/types.js';
import { applyOps, inventoryOf, opsSummary, type AppInventory, type SpecOp } from './appOps.js';
import type { AppStorePort, StoreRefusal } from './appStore.js';

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
 *  - Undo and redo land the burst first, then move crew's pointer from the head.
 */

export type SessionEvent =
  | { kind: 'head'; app: AppDetail; by: 'this-session' | 'elsewhere' }
  | { kind: 'pending'; count: number }
  | { kind: 'failed'; message: string; app: AppDetail | null };

export type EditResult =
  | { ok: true; spec: AppSpec; added: string[]; pending: number }
  | { ok: false; code: 'head_moved' | 'refused' | 'bad_request'; message: string; head?: number };

export const BURST_MS = 1_000;

function words(r: StoreRefusal, what: 'saved' | 'undone' | 'redone' = 'saved'): string {
  const not = `Not ${what}`;
  if (r.code === 'stale_base') return `${not}: the app changed in another tab or window; this is its newest version`;
  if (r.code === 'turn_in_flight') return `${not}: a chat turn is changing the app; it is read-only until the turn ends`;
  if (r.code === 'check_failed') return `${not}: ${r.findings?.[0]?.message ?? r.message}`;
  if (r.code === 'source_check_unavailable') return `${not}: ${r.message}`;
  if (r.code === 'nothing_to_undo') return 'Nothing to undo';
  if (r.code === 'nothing_to_redo') return 'Nothing to redo';
  if (r.code === 'unavailable') return `Whether it was ${what} is not known: ${r.message}`;
  return `${not}: ${r.message}`;
}

export class AppSession {
  private app: AppDetail | null = null;
  /** The working spec: the head's spec with the burst applied (what the runtime is shown). */
  private working: AppSpec | null = null;
  private burst: SpecOp[] = [];
  private burstBefore: AppSpec | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private landing: Promise<void> | null = null;
  private listeners = new Set<(e: SessionEvent) => void>();
  private readonly burstMs: number;

  constructor(readonly store: AppStorePort, opts: { burstMs?: number } = {}) {
    this.burstMs = opts.burstMs ?? BURST_MS;
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
  get readonly(): boolean { return this.app?.turn != null; }
  inventory(): AppInventory | null { return this.working === null ? null : inventoryOf(this.working); }

  async load(): Promise<AppDetail> {
    const app = await this.store.detail();
    this.adopt(app);
    return app;
  }

  private adopt(app: AppDetail): void {
    this.app = app;
    this.working = structuredClone(app.spec);
    this.burst = [];
    this.burstBefore = null;
  }

  /** Read crew's head again (focus, visibility, a timer). A head that moved under an open burst drops the burst. */
  async refresh(): Promise<void> {
    if (this.landing !== null) return;
    let app: AppDetail;
    try { app = await this.store.detail(); } catch { return; }
    if (this.landing !== null || this.app === null) return;
    const moved = app.head.version !== this.app.head.version;
    const turnChanged = (app.turn?.runId ?? null) !== (this.app.turn?.runId ?? null);
    if (!moved && !turnChanged) return;
    if (moved) {
      const hadBurst = this.burst.length > 0;
      this.clearTimer();
      this.adopt(app);
      if (hadBurst) this.emit({ kind: 'failed', message: 'Not saved: the app changed in another tab or window', app });
    } else {
      this.app = app; // only the turn state changed: the burst (if any) stays on the same head
    }
    this.emit({ kind: 'head', app, by: 'elsewhere' });
  }

  /** The runtime's ops, on the version it named. Synchronous: checked against the working spec, then queued. */
  edit(base: number, ops: readonly unknown[]): EditResult {
    if (this.app === null || this.working === null) return { ok: false, code: 'refused', message: 'the app is not loaded yet' };
    if (this.readonly) return { ok: false, code: 'refused', message: 'a chat turn is changing the app; it is read-only until the turn ends' };
    if (base !== this.app.head.version) return { ok: false, code: 'head_moved', message: 'the app changed since', head: this.app.head.version };
    const r = applyOps(this.working, ops);
    if (!r.ok) return { ok: false, code: r.code, message: r.message };
    if (this.burst.length === 0) this.burstBefore = this.working;
    this.working = r.spec;
    this.burst.push(...(ops as SpecOp[]));
    this.clearTimer();
    this.timer = setTimeout(() => { void this.flush(); }, this.burstMs);
    this.emit({ kind: 'pending', count: this.burst.length });
    return { ok: true, spec: r.spec, added: r.added, pending: this.burst.length };
  }

  private clearTimer(): void { if (this.timer !== null) { clearTimeout(this.timer); this.timer = null; } }

  /** Land the burst now as one version (the burst timer, or before an undo). Resolves when nothing is pending. */
  async flush(): Promise<void> {
    this.clearTimer();
    while (this.landing !== null) await this.landing;
    if (this.burst.length === 0 || this.app === null || this.working === null) return;
    const base = this.app.head.version;
    const spec = this.working;
    const ops = this.burst;
    const summary = opsSummary(this.burstBefore ?? this.app.spec, spec, ops);
    const landedOps = ops.length;
    this.landing = (async () => {
      const r = await this.store.edit(base, spec, summary);
      if (r.ok) {
        // Ops that arrived while this landed were made on top of it: they stay in the burst, on the new head.
        const later = this.burst.slice(landedOps);
        const laterSpec = this.working;
        this.app = r.app;
        this.burst = later;
        this.working = later.length > 0 && laterSpec !== null ? laterSpec : structuredClone(r.app.spec);
        this.burstBefore = later.length > 0 ? structuredClone(r.app.spec) : null;
        this.emit({ kind: 'head', app: r.app, by: 'this-session' });
        if (later.length > 0) this.timer = setTimeout(() => { void this.flush(); }, this.burstMs);
        this.emit({ kind: 'pending', count: this.burst.length });
        return;
      }
      await this.recover(r);
    })().finally(() => { this.landing = null; });
    await this.landing;
  }

  /** A refused landing or move: drop the burst, read crew's head, say why. */
  private async recover(r: StoreRefusal, what: 'saved' | 'undone' | 'redone' = 'saved'): Promise<void> {
    this.clearTimer();
    let app: AppDetail | null = null;
    try { app = await this.store.detail(); } catch { app = this.app; }
    if (app !== null) this.adopt(app);
    this.emit({ kind: 'failed', message: words(r, what), app });
    if (app !== null) this.emit({ kind: 'head', app, by: 'elsewhere' });
    this.emit({ kind: 'pending', count: 0 });
  }

  /** Undo or redo within crew's accepted history, from the version the caller saw (`base`). */
  async move(direction: 'undo' | 'redo', base: number): Promise<{ ok: true; version: number } | { ok: false; code: string; message: string; head?: number }> {
    if (this.app === null) return { ok: false, code: 'refused', message: 'the app is not loaded yet' };
    if (this.readonly) return { ok: false, code: 'refused', message: 'a chat turn is changing the app; it is read-only until the turn ends' };
    if (base !== this.app.head.version) return { ok: false, code: 'head_moved', message: 'the app changed since', head: this.app.head.version };
    await this.flush();
    while (this.landing !== null) await this.landing;
    const from = this.app.head.version;
    let out: { ok: true; version: number } | { ok: false; code: string; message: string; head?: number } = { ok: false, code: 'refused', message: 'not moved' };
    this.landing = (async () => {
      const r = await this.store.move(direction, from);
      if (r.ok) {
        this.adopt(r.app);
        this.emit({ kind: 'head', app: r.app, by: 'this-session' });
        out = { ok: true, version: r.landed.version };
        return;
      }
      await this.recover(r, direction === 'undo' ? 'undone' : 'redone');
      out = { ok: false, code: r.code, message: words(r, direction === 'undo' ? 'undone' : 'redone'), ...(this.app !== null ? { head: this.app.head.version } : {}) };
    })().finally(() => { this.landing = null; });
    await this.landing;
    return out;
  }

  dispose(): void { this.clearTimer(); this.listeners.clear(); }
}
