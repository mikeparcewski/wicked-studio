import { ApiError } from '../api/errors.js';
import { getVersions, interactiveUrl } from '../api/interactive.js';
import { applyChapterOp, effectiveVideoStyle, timedCut, type DemoCut, type VideoStyle } from './demoCutModel.js';
import type { AdapterResult, ArtifactRef, HostAdapter } from './host.js';
import { chapterInventoryOf, checkOps, type WireItem } from './ops.js';
import type { MediaRef } from './protocol.js';

/** E1, through crew's per-document interactive proxy. Cut rev and render version are distinct. */
export class DemoCutAdapter implements HostAdapter {
  head = 0;
  private announcedHead: number | null = null;
  private readonly listeners = new Set<() => void>();
  private cut: DemoCut | null = null;
  private snapshots = new Map<number, DemoCut>();
  private parents = new Map<number, number>();
  constructor(private projectId: string, private docId: string, private title: string, private kind = 'demo-video') {}
  subscribe(onChange: () => void): () => void { this.listeners.add(onChange); return () => { this.listeners.delete(onChange); }; }
  private setHead(head: number): void {
    const changed = this.head !== head;
    this.head = head;
    if (this.announcedHead === null) this.announcedHead = head;
    if (changed) for (const l of this.listeners) l();
  }
  async refresh(): Promise<{ head: number; kind: 'generated' } | null> {
    await this.load();
    if (this.head === this.announcedHead) return null;
    this.announcedHead = this.head;
    return { head: this.head, kind: 'generated' };
  }
  artifact(): ArtifactRef { return { kind: this.kind, title: this.title, version: this.head, head: this.head, readonly: false, lockedParts: [] }; }
  private url(path: string): string { return interactiveUrl(this.projectId, `/d/${encodeURIComponent(this.docId)}/api/demo/${path}`); }
  /** Same body/header/error convention as interactive.ts's private iFetch. */
  private async json<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const res = await fetch(this.url(path), { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
    if (!res.ok) {
      const text = await res.text();
      let data: { error?: string } | undefined;
      try { data = JSON.parse(text) as { error?: string }; } catch { /* older engine: plain 404 */ }
      throw new ApiError(res.status, data?.error ?? text, data);
    }
    return res.json() as Promise<T>;
  }
  private async load(): Promise<DemoCut> {
    const raw = await this.json<DemoCut>('cut');
    // Preserve E1's resolvedTheme alongside the stored style: skin colours are resolved by crew per render.
    const cut = timedCut({ ...raw, type: 'demo-cut', title: this.title, style: effectiveVideoStyle(this.title, raw.style) });
    this.cut = cut; this.snapshots.set(cut.version, cut); this.setHead(cut.version);
    return cut;
  }
  private async failure(e: unknown): Promise<{ error: 'head_moved' | 'unsupported' | 'bad_request' | 'unavailable'; message: string; head?: number; moved?: { head: number; kind: 'generated' } }> {
    if (e instanceof ApiError && e.status === 409 && (e.body as { error?: unknown } | undefined)?.error === 'rev_moved') {
      // The 409 names a REV, never a rendered version: read the cut to learn the head.
      await this.load().catch(() => { this.cut = null; });
      return { error: 'head_moved', message: 'The cut changed; read it again before editing.', ...(this.cut === null ? {} : { head: this.head, moved: { head: this.head, kind: 'generated' as const } }) };
    }
    return { error: e instanceof ApiError && e.status === 404 ? 'unsupported' : e instanceof ApiError && e.status === 400 ? 'bad_request' : 'unavailable', message: e instanceof Error ? e.message : 'The cut is unavailable.' };
  }
  async read(version?: number): Promise<AdapterResult<{ version: number; content: DemoCut & Record<string, unknown> }>> {
    try {
      const cut = await this.load();
      const content = version === undefined || version === cut.version || version === 0 ? cut : this.snapshots.get(version);
      if (content === undefined) return { error: 'unsupported', message: 'This engine only exposes the current cut.' };
      return { version: content.version, content: { ...content } };
    } catch (e) { return this.failure(e); }
  }
  async versions(): Promise<AdapterResult<{ versions: { version: number; parent: number | null; createdAt: string }[]; head: number }>> {
    try {
      const m = await getVersions(this.projectId, this.docId);
      this.setHead(m.head);
      return { head: m.head, versions: m.versions.map(v => ({ version: v.version, parent: v.parent, createdAt: v.created_at })) };
    } catch (e) { return this.failure(e); }
  }
  private stale(base: number): AdapterResult<{ version: number }> | null {
    return base === this.head ? null : { error: 'head_moved', message: 'The cut changed since.', head: this.head };
  }
  private async save(base: number, next: DemoCut, styleOnly = false): Promise<AdapterResult<{ version: number }>> {
    const stale = this.stale(base); if (stale !== null) return stale;
    const chapters = next.chapters.map(({ id, title, take, inSec, outSec }) => ({ id, title, take, inSec, outSec }));
    const result = await this.json<{ rev: number; version: number }>(styleOnly ? 'style' : 'recut', styleOnly ? 'PUT' : 'POST', styleOnly ? { rev: this.cut!.rev, style: next.style } : { rev: this.cut!.rev, chapters, ...(next.style === this.cut!.style ? {} : { style: next.style }) });
    this.parents.set(result.version, base);
    this.cut = timedCut({ ...next, ...result });
    this.snapshots.set(result.version, this.cut);
    this.setHead(result.version);
    return { version: result.version };
  }
  async write(base: number, items: WireItem[]): Promise<AdapterResult<{ version: number }>> {
    try {
      const cut = await this.load(); const stale = this.stale(base); if (stale !== null) return stale;
      if (items.length !== 1 || items[0]?.type !== 'chapter') return { error: 'bad_request', message: 'One chapter edit per cut.' };
      const checked = checkOps([items[0].op], chapterInventoryOf(cut));
      if (!checked.ok) return { error: checked.code, message: checked.message };
      return await this.save(base, applyChapterOp(cut, items[0].op));
    } catch (e) { return this.failure(e); }
  }
  async theme(base: number, tokens: Record<string, unknown>): Promise<AdapterResult<{ version: number }>> {
    try {
      const cut = await this.load();
      if (tokens['kind'] !== 'video-style' || typeof tokens['style'] !== 'object' || tokens['style'] === null) return { error: 'bad_request', message: 'Expected a video style.' };
      return await this.save(base, { ...cut, style: tokens['style'] as VideoStyle }, true);
    } catch (e) { return this.failure(e); }
  }
  async media(ref: MediaRef): Promise<AdapterResult<{ type: string; blob: Blob }>> {
    try {
      const cut = await this.load();
      let file: string;
      if (ref === 'video') file = `_v${cut.version}.mp4`;
      else if (typeof ref === 'object' && 'chapter' in ref) {
        const chapter = cut.chapters.find(c => c.id === ref.chapter);
        if (chapter === undefined) return { error: 'bad_request', message: 'Chapter not in this cut.' };
        file = chapter.take;
      } else return { error: 'unsupported', message: 'No media for that reference.' };
      const res = await fetch(this.url(`recording/${encodeURIComponent(file)}`));
      if (!res.ok) return { error: res.status === 404 ? 'unsupported' : 'unavailable', message: 'The video is not available here.' };
      const blob = await res.blob();
      return { type: blob.type || (file.endsWith('.mp4') ? 'video/mp4' : 'video/webm'), blob };
    } catch (e) { return this.failure(e); }
  }
  /** Called exclusively by the host's Re-record button. */
  async retake(chapter: string): Promise<AdapterResult<{ version: number }>> {
    try {
      const cut = await this.load();
      if (!cut.chapters.some(c => c.id === chapter)) return { error: 'bad_request', message: 'Chapter not in this cut.' };
      const r = await this.json<{ rev: number; version: number }>('takes', 'POST', { chapter });
      this.cut = null; this.setHead(r.version);
      return { version: r.version };
    } catch (e) { return this.failure(e); }
  }
  async undo(version: number): Promise<AdapterResult<{ undone: true }>> {
    const parent = this.parents.get(version);
    const snapshot = parent === undefined ? undefined : this.snapshots.get(parent);
    if (snapshot === undefined) return { error: 'unsupported', message: 'The previous cut is not available in this session.' };
    try {
      await this.load();
      const r = await this.save(version, snapshot);
      return 'error' in r ? r : { undone: true, moved: { head: r.version, kind: 'fork' } };
    } catch (e) { return this.failure(e); }
  }
  async fork(from: number): Promise<AdapterResult<{ version: number }>> {
    const snapshot = this.snapshots.get(from);
    if (snapshot === undefined) return { error: 'unsupported', message: 'That cut is not available in this session.' };
    try { await this.load(); return await this.save(this.head, snapshot); } catch (e) { return this.failure(e); }
  }
  async exportAs(format: string): Promise<AdapterResult<{ started: true }>> {
    if (format !== 'mp4') return { error: 'unsupported', message: 'This cut exports as MP4.' };
    const media = await this.media('video');
    if ('error' in media) return media;
    const url = URL.createObjectURL(media.blob);
    const link = document.createElement('a'); link.href = url; link.download = `${this.docId}.mp4`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return { started: true };
  }
}
