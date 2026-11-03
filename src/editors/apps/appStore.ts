import { apiFetch } from '../../api/client.js';
import { ApiError } from '../../api/errors.js';
import type { AppCheckFinding, AppDetail, AppDetailResponse, AppErrorBody, AppLandedResponse, AppReceipt, AppSpec, AppVersion } from '../../api/types.js';

/**
 * Where an app's versions live (DES-APPS-001 §6.4, §7.6; slice K4). Two stores answer the same three calls:
 *
 *  - {@link CrewAppStore}: crew's app store, `GET /apps/:app`, `POST /apps/:app/edits | undo | redo` (K2a, crew main).
 *    crew keeps the undo pointer, so every tab agrees, and refuses a stale base with `409 stale_base`.
 *  - {@link SampleAppStore}: an in-memory store with the SAME rules, for the editor test page on a daemon that has
 *    no app store (it stands where the sample page stands for the page editor). It never reaches a source; tabs of
 *    the same browser share it through `localStorage`, so they disagree exactly as crew's would refuse them.
 */

export type StoreRefusal = { ok: false; code: AppErrorBody['code'] | 'unavailable'; message: string; head?: number; findings?: AppCheckFinding[] };
export type StoreResult = { ok: true; app: AppDetail; landed: AppVersion } | StoreRefusal;

export interface AppStorePort {
  readonly slug: string;
  /** `crew` = crew's store; `sample` = the in-memory sample (shown as such by the host). */
  readonly kind: 'crew' | 'sample';
  detail(): Promise<AppDetail>;
  /** One version from `spec`, plus the text of each query in `texts` (crew's `query-text` op), on `base`. */
  edit(base: number, spec: AppSpec, summary: string, texts?: Readonly<Record<string, string>>): Promise<StoreResult>;
  move(direction: 'undo' | 'redo', base: number): Promise<StoreResult>;
}

function refusalOf(e: unknown): StoreRefusal {
  if (e instanceof ApiError) {
    const b = (typeof e.body === 'object' && e.body !== null ? e.body : {}) as Partial<AppErrorBody>;
    const code = typeof b.code === 'string' ? b.code : 'unavailable';
    return {
      ok: false, code, message: typeof b.error === 'string' && b.error !== '' ? b.error : e.message,
      ...(typeof b.head === 'number' ? { head: b.head } : {}),
      ...(Array.isArray(b.findings) ? { findings: b.findings.slice(0, 10) } : {}),
    };
  }
  return { ok: false, code: 'unavailable', message: e instanceof Error ? e.message : String(e) };
}

export class CrewAppStore implements AppStorePort {
  readonly kind = 'crew' as const;
  constructor(readonly slug: string) {}
  private path(tail = ''): string { return `/apps/${encodeURIComponent(this.slug)}${tail}`; }
  async detail(): Promise<AppDetail> {
    return (await apiFetch<AppDetailResponse>(this.path())).app;
  }
  async edit(base: number, spec: AppSpec, summary: string, texts: Readonly<Record<string, string>> = {}): Promise<StoreResult> {
    const ops = [{ op: 'spec', spec }, ...Object.entries(texts).map(([query, text]) => ({ op: 'query-text', query, text }))];
    try {
      const r = await apiFetch<AppLandedResponse>(this.path('/edits'), { method: 'POST', body: JSON.stringify({ base, ops, summary }) });
      return { ok: true, app: r.app, landed: r.landed };
    } catch (e) { return refusalOf(e); }
  }
  async move(direction: 'undo' | 'redo', base: number): Promise<StoreResult> {
    try {
      const r = await apiFetch<AppLandedResponse>(this.path(`/${direction}`), { method: 'POST', body: JSON.stringify({ base }) });
      return { ok: true, app: r.app, landed: r.landed };
    } catch (e) { return refusalOf(e); }
  }
}

// ── the sample store ────────────────────────────────────────────────────────────────────────

/** A short stable digest of a spec, standing in for a git tree id in the sample (never shown as one). */
export function sampleTree(spec: AppSpec): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  const s = JSON.stringify(spec);
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x85ebca6b) >>> 0;
  }
  return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}

interface SampleState { detail: AppDetail; specs: Record<number, AppSpec>; texts?: Record<number, Record<string, string>> }

/** A sample query's stand-in text (the samples hold no SQL): it says what it is, and no source ever sees it. */
export function sampleTexts(spec: AppSpec): Record<string, string> {
  const out: Record<string, string> = {};
  for (const q of spec.queries) out[q.id] = `-- A sample query: this app's rows are made up, and nothing reaches ${q.source}.\nSELECT ${q.output.map((o) => o.name).join(', ')}\nFROM sample.${q.id}`;
  return out;
}
/** The texts of the queries `spec` declares: a text whose query is gone goes with it (crew does the same). */
function declaredTexts(spec: AppSpec, texts: Readonly<Record<string, string>>): Record<string, string> {
  const ids = new Set(spec.queries.map((q) => q.id));
  return Object.fromEntries(Object.entries(texts).filter(([id]) => ids.has(id)));
}

const ACCEPTED: ReadonlySet<string> = new Set(['you', 'reviewed', 'restored']);
const SAMPLE_ACTOR = { id: 'you', kind: 'human', trust: 'operator' } as unknown as AppReceipt['actor'];

/** The sample's first state: one `reviewed` version holding the given spec, as if a turn had built it. */
export function sampleDetail(slug: string, spec: AppSpec, now = Date.now()): SampleState {
  const tree = sampleTree(spec);
  const receipt: AppReceipt = { kind: 'reviewed', tree, version: 1, at: now, actor: SAMPLE_ACTOR, review: { runId: 'sample', builder: 'sample', reviewer: 'sample' } };
  const v1: AppVersion = { version: 1, commit: tree, tree, base: null, at: now, author: { kind: 'seat', id: 'sample' }, receipt, summary: 'The sample app', check: { level: 'full', checked: [] } };
  const texts = sampleTexts(spec);
  return {
    specs: { 1: spec },
    texts: { 1: texts },
    detail: {
      slug, name: spec.name, projectId: 'sample', repoId: slug, createdAt: now, head: { version: 1, tree, receipt: 'reviewed' }, turn: null,
      spec, lock: { schema: 'wicked.apps.lock/v1', sources: {}, queries: {}, actions: {}, uploads: {} }, queryText: texts,
      versions: [v1], history: { states: [1], pointer: 0, canUndo: false, canRedo: false },
    },
  };
}

/** The Web Locks the sample's cross-tab transaction takes (every supported browser has `navigator.locks`). */
export interface SampleLocks { request<T>(name: string, cb: () => Promise<T>): Promise<T> }
const browserLocks = (): SampleLocks | null => {
  const l = typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: SampleLocks }).locks : undefined;
  return l !== undefined && typeof l.request === 'function' ? l : null;
};

export class SampleAppStore implements AppStorePort {
  readonly kind = 'sample' as const;
  private mem: SampleState;
  private readonly key: string;
  constructor(readonly slug: string, spec: AppSpec, private readonly storage: Storage | null = typeof localStorage !== 'undefined' ? localStorage : null, private readonly now: () => number = Date.now, private readonly locks: SampleLocks | null = browserLocks()) {
    this.key = `wicked-apps-sample:${slug}`;
    this.mem = this.load() ?? sampleDetail(slug, spec, now());
    // First use writes the sample's first state, under the same lock as every change, and only if no tab has
    // written one meanwhile: a tab opening late never puts an older state back (codex r2).
    this.ready = this.tx(() => { if (this.load() === null) this.save(); else this.sync(); });
  }
  private readonly ready: Promise<void>;
  private load(): SampleState | null {
    try {
      const raw = this.storage?.getItem(this.key);
      if (raw == null) return null;
      const s = JSON.parse(raw) as SampleState;
      return typeof s?.detail?.head?.version === 'number' ? s : null;
    } catch { return null; }
  }
  private save(): void { try { this.storage?.setItem(this.key, JSON.stringify(this.mem)); } catch { /* a full or absent storage keeps the tab's own copy */ } }
  /** Another tab's write, if any, before every call: the same race crew's CAS settles. */
  private sync(): void { this.mem = this.load() ?? this.mem; }
  /** Read, check the base and write as ONE transaction across this browser's tabs (a Web Lock named for the app):
   *  two tabs can never both land on the same head. Without Web Locks (a test host) the tab's own call is atomic. */
  private tx<T>(fn: () => T): Promise<T> {
    return this.locks === null ? Promise.resolve().then(fn) : this.locks.request(this.key, async () => fn());
  }
  /** Put the sample back as it started (the test page's "Start the sample again"). */
  async reset(spec: AppSpec): Promise<void> { await this.ready; await this.tx(() => { this.mem = sampleDetail(this.slug, spec, this.now()); this.save(); }); }

  async detail(): Promise<AppDetail> { await this.ready; this.sync(); return structuredClone(this.mem.detail); }

  private land(spec: AppSpec, texts: Record<string, string>, summary: string, receipt: (v: number, tree: string, at: number) => AppReceipt, history: (v: number) => void): StoreResult {
    const d = this.mem.detail;
    const version = d.head.version + 1;
    const tree = sampleTree(spec);
    const at = this.now();
    const r = receipt(version, tree, at);
    const v: AppVersion = { version, commit: tree, tree, base: d.head.version, at, author: { kind: 'human', id: 'you' }, receipt: r, summary: summary.slice(0, 200), check: { level: 'spec', checked: [] } };
    d.versions.push(v);
    this.mem.specs[version] = structuredClone(spec);
    this.mem.texts = { ...(this.mem.texts ?? {}), [version]: structuredClone(texts) };
    d.queryText = structuredClone(texts);
    d.spec = structuredClone(spec);
    d.name = spec.name;
    d.head = { version, tree, receipt: r.kind };
    history(version);
    const { states, pointer } = d.history;
    d.history = { states, pointer, canUndo: pointer > 0, canRedo: pointer >= 0 && pointer < states.length - 1 };
    this.save();
    return { ok: true, app: structuredClone(d), landed: structuredClone(v) };
  }

  private stale(base: number, what: string): StoreRefusal | null {
    const h = this.mem.detail.head.version;
    return base === h ? null : { ok: false, code: 'stale_base', message: `${what} was made on v${base}, but ${this.slug} is at v${h}; reload and try again`, head: h };
  }

  async edit(base: number, spec: AppSpec, summary: string, texts: Readonly<Record<string, string>> = {}): Promise<StoreResult> {
    await this.ready;
    return this.tx(() => this.editNow(base, spec, summary, texts));
  }

  private editNow(base: number, spec: AppSpec, summary: string, texts: Readonly<Record<string, string>>): StoreResult {
    this.sync();
    const stale = this.stale(base, 'this edit');
    if (stale !== null) return stale;
    const next = declaredTexts(spec, { ...(this.mem.detail.queryText ?? {}), ...texts });
    return this.land(spec, next, summary, (version, tree, at) => ({ kind: 'you', tree, version, at, actor: SAMPLE_ACTOR }), (version) => {
      const h = this.mem.detail.history;
      h.states = [...h.states.slice(0, h.pointer + 1), version];
      h.pointer = h.states.length - 1;
    });
  }

  async move(direction: 'undo' | 'redo', base: number): Promise<StoreResult> {
    await this.ready;
    return this.tx(() => this.moveNow(direction, base));
  }

  private moveNow(direction: 'undo' | 'redo', base: number): StoreResult {
    this.sync();
    const stale = this.stale(base, direction === 'undo' ? 'this undo' : 'this redo');
    if (stale !== null) return stale;
    const { states, pointer } = this.mem.detail.history;
    const to = direction === 'undo' ? pointer - 1 : pointer + 1;
    if (to < 0 || to >= states.length) {
      return { ok: false, code: direction === 'undo' ? 'nothing_to_undo' : 'nothing_to_redo', message: direction === 'undo' ? 'there is no earlier accepted version to go back to' : 'there is nothing to redo' };
    }
    const target = this.mem.detail.versions[states[to]! - 1]!;
    if (target.receipt === null || !ACCEPTED.has(target.receipt.kind)) return { ok: false, code: 'not_accepted', message: `v${target.version} holds no accepted receipt` };
    const spec = this.mem.specs[target.version]!;
    const texts = this.mem.texts?.[target.version] ?? declaredTexts(spec, this.mem.detail.queryText ?? {});
    const origin = target.receipt.restoredFrom ?? { version: target.version, originKind: target.receipt.kind === 'reviewed' ? 'reviewed' as const : 'you' as const, originVersion: target.version };
    return this.land(spec, texts, `${direction === 'undo' ? 'Undo' : 'Redo'} to v${target.version}`, (version, tree, at) => ({
      kind: 'restored', tree, version, at, actor: SAMPLE_ACTOR, restoredFrom: { version: target.version, originKind: origin.originKind, originVersion: origin.originVersion },
    }), () => { this.mem.detail.history.pointer = to; });
  }
}
