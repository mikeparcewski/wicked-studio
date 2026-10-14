import { demoFileUrl, getDemo, type DemoView } from '../../api/demo.js';
import { interactiveUrl } from '../../api/interactive.js';
import { walkthroughApi, walkthroughFileUrl } from '../../api/walkthrough.js';
import { checksTrack, exportOptions, failedChapter, recordingOf, recordingOfDemo, takeFingerprint, type Recording } from '../../board/walkthroughModel.js';
import { DemoCutAdapter } from '../demoCutAdapter.js';
import { defaultVideoStyle, type DemoChapter, type DemoCut, type RecordingProof } from '../demoCutModel.js';
import type { AdapterResult, ArtifactRef } from '../host.js';
import { registerAdapter, type AdapterCapability, type ArtifactBinding, type ExportOption, type ExportOutcome, type StatusPill, type SurfaceAdapter } from '../hostApi.js';
import type { MediaRef } from '../protocol.js';
import { publishRecording, withdrawRecording } from '../../store/recordings.js';

/**
 * The video data planes (HOST-API §3, slice H6), so `wicked-video` edits what `WalkthroughEditor` showed:
 *
 *  - `demo` with a document id: the demo's interactive cut (E1: chapters, takes, re-cut, style), through
 *    {@link DemoCutAdapter} — every chapter edit and style change is a new rendered version, Undo from the host.
 *  - `demo` without one, and `walkthrough`: the run's own recording, read-only (crew's `GET /runs/:id/demo` and
 *    `/walkthrough`). The plugin shows its chapters and plays it; edits are refused `refused` in the host's words.
 *    Re-record and "Ask helpers to fix" stay the run's gate controls, never the plugin's.
 */

const CUT_EXPORTS: readonly ExportOption[] = [{ format: 'mp4', label: 'Video' }];

function proofOfRecording(rec: Recording): RecordingProof {
  return {
    verdict: rec.state === 'passed' ? 'PASS' : rec.state === 'failed' ? 'FAIL' : rec.state === 'inconclusive' ? 'INCONCLUSIVE' : null,
    failedAtSec: failedChapter(rec)?.failedAbsSec ?? null,
    checks: checksTrack(rec).map(k => ({
      id: k.id, chapter: k.chapter.key, atSec: k.atAbsSec,
      text: [k.sentence, k.detail, k.evidence.length > 0 ? `Evidence: ${k.evidence.join(', ')}` : null, k.vaultEntry ? `vault ${k.vaultEntry}` : null].filter(Boolean).join(' · '),
      state: k.passed === true ? 'PASS' : k.passed === false ? 'FAIL' : 'PENDING',
    })),
  };
}

/** A run's recording as the cut shape the plugin reads (no takes: a recording is one take). */
export function cutOfRecording(rec: Recording, title: string): DemoCut {
  const starts = rec.chapters.map((c) => c.startSec ?? -1);
  const chapters: DemoChapter[] = rec.chapters.map((c, i) => {
    const startSec = starts[i]!;
    const next = starts.slice(i + 1).find(start => start >= 0) ?? rec.markers.find(m => m.sec > startSec)?.sec ?? rec.durationSec;
    const durationSec = startSec >= 0 && next !== undefined && Number.isFinite(next) && next >= startSec ? next - startSec : -1;
    return { id: c.key, title: c.title, say: c.blurb ?? '', take: '', inSec: 0, outSec: durationSec, durationSec, startSec,
      ...(rec.kind === 'walkthrough' ? { verdict: c.verdict } : {}) };
  });
  const style = defaultVideoStyle(title);
  style.theme.titleCard.on = false;
  style.theme.endCard.on = false;
  return { type: 'demo-cut', title, rev: 1, version: 1, chapters, takes: {}, style, ffmpeg: { ok: false, burnIn: false },
    ...(rec.kind === 'walkthrough' ? { proof: proofOfRecording(rec) } : {}) };
}

export class RecordingSurfaceAdapter implements SurfaceAdapter {
  readonly source: 'demo' | 'walkthrough';
  private rec: Recording | null = null;
  private head = 1;
  private announcedHead: number | null = null;
  private contentSeen: string | null = null;
  private readonly mediaCache = new Map<string, { type: string; blob: Blob }>();
  private readonly listeners = new Set<() => void>();
  constructor(private readonly binding: ArtifactBinding, source: 'demo' | 'walkthrough') { this.source = source; }

  capabilities(): readonly AdapterCapability[] {
    // No 'checks' capability: the host's Checks tab reads an interactive document's checks, which a run's recording
    // is not. The proof is drawn by the plugin (timeline marks, verdicts, Advanced's Checks list) and served by checks().
    // No 'versions' either: a recording is one take, and the host's Versions tab reads an interactive document's
    // history, so it hung on "Reading the versions…" for one (codex final review P2). artifact.versions still answers.
    const caps: AdapterCapability[] = ['read', 'media'];
    if (this.exports().length > 0) caps.push('export');
    return caps;
  }
  exports(): readonly ExportOption[] { return this.rec === null ? [] : exportOptions(this.rec).map(({ format, label }) => ({ format, label })); }
  pills(): readonly StatusPill[] {
    if (this.rec === null) return [{ id: 'state', text: 'Reading…', tone: 'neutral' }];
    return [{ id: 'state', text: `${this.rec.chapters.length} chapter${this.rec.chapters.length === 1 ? '' : 's'}`, tone: 'neutral' }];
  }
  subscribe(onChange: () => void): () => void { this.listeners.add(onChange); return () => { this.listeners.delete(onChange); }; }

  artifact(): ArtifactRef {
    return { kind: this.binding.kind, title: this.binding.title, version: this.head, head: this.head, readonly: true, lockedParts: [] };
  }

  private async load(): Promise<Recording> {
    const runId = this.binding.runId ?? '';
    let demo: DemoView | null;
    let rec: Recording;
    try {
      demo = this.source === 'demo' ? await getDemo(runId) : null;
      rec = demo !== null ? recordingOfDemo(demo) : recordingOf(await walkthroughApi.view(runId, this.binding.docId || null));
      publishRecording(rec);
    } catch (e) {
      if (this.source === 'walkthrough') withdrawRecording(runId);
      throw e;
    }
    const content = JSON.stringify({
      cut: cutOfRecording(rec, this.binding.title), video: rec.video, step: rec.step,
      state: rec.state, chapters: rec.chapters.length,
      // The stills too: a failing frame that appears or changes is a new head (codex h6-r5).
      poster: rec.poster, failedFrame: failedChapter(rec)?.failedFrame ?? null,
      take: demo !== null ? demo.video?.bytes ?? null : takeFingerprint(rec),
    });
    const contentChanged = this.contentSeen !== null && this.contentSeen !== content;
    const changed = contentChanged || JSON.stringify(this.rec) !== JSON.stringify(rec);
    if (contentChanged) {
      this.head++;
      this.mediaCache.clear();
    }
    this.contentSeen = content;
    this.rec = rec;
    if (this.announcedHead === null) this.announcedHead = this.head;
    if (changed) for (const l of this.listeners) l();
    return rec;
  }

  async refresh(): Promise<{ head: number; kind: 'generated' } | null> {
    await this.load();
    if (this.head === this.announcedHead) return null;
    this.announcedHead = this.head;
    return { head: this.head, kind: 'generated' };
  }

  async exportFile(format: string, version: number): Promise<ExportOutcome> {
    if (!['mp4', 'gif', 'poster'].includes(format)) return { ok: false, text: 'That export format is not available for this recording.' };
    try {
      const rec = await this.load();
      if (version !== this.head) return { ok: false, text: 'The recording changed; read it again before exporting.' };
      const option = exportOptions(rec).find(o => o.format === format);
      if (option === undefined) return { ok: false, text: 'That export format is not available for this recording.' };
      let path = option.path;
      if (option.how === 'request' && (option.format === 'gif' || option.format === 'poster')) path = (await walkthroughApi.demoExport(rec.runId, option.format)).path;
      if (path === undefined) return { ok: false, text: 'The export file is not available.' };
      const href = rec.kind === 'demo-video' ? demoFileUrl(rec.runId, path) : walkthroughFileUrl(rec.runId, rec.step, path);
      return { ok: true, text: `${option.label} ready.`, href, file: path.split('/').at(-1) ?? path };
    } catch (e: unknown) { return { ok: false, text: e instanceof Error ? e.message : String(e) }; }
  }

  async read(): Promise<AdapterResult<{ version: number; content: Record<string, unknown> }>> {
    try {
      const rec = await this.load();
      return { version: this.head, content: { ...cutOfRecording(rec, this.binding.title), version: this.head, readonly: true } };
    } catch (e: unknown) {
      return { error: 'unavailable', message: e instanceof Error ? e.message : String(e) };
    }
  }

  async versions(): Promise<AdapterResult<{ versions: { version: number; parent: number | null; createdAt: string }[]; head: number }>> {
    return { versions: [{ version: this.head, parent: null, createdAt: new Date(0).toISOString() }], head: this.head };
  }

  async checks(): Promise<AdapterResult<{ checks: { id: string; text: string }[]; total: number }>> {
    try {
      const rec = this.rec ?? await this.load();
      const checks = proofOfRecording(rec).checks.map(k => ({
        id: `${k.chapter}/${k.id}`,
        text: `${k.state} · ${rec.chapters.find(c => c.key === k.chapter)?.title ?? k.chapter} · ${k.text}`,
      }));
      return { checks, total: checks.length };
    } catch (e: unknown) { return { error: 'unavailable', message: e instanceof Error ? e.message : String(e) }; }
  }

  async media(ref: MediaRef): Promise<AdapterResult<{ type: string; blob: Blob }>> {
    const rec = this.rec ?? await this.load().catch(() => null);
    if (rec === null) return { error: 'unavailable', message: 'the recording could not be read' };
    // A failed walkthrough's still is its failing frame (the poster only when it has none); otherwise the poster.
    const path = ref === 'video' ? rec.video : ref === 'poster' ? (rec.state === 'failed' ? failedChapter(rec)?.failedFrame ?? rec.poster : rec.poster ?? failedChapter(rec)?.failedFrame) ?? null : null;
    if (path === null) return { error: 'unsupported', message: ref === 'video' || ref === 'poster' ? 'no file for that yet' : 'a recording is one take' };
    const url = rec.kind === 'demo-video' ? demoFileUrl(rec.runId, path) : walkthroughFileUrl(rec.runId, rec.step, path);
    const cached = this.mediaCache.get(url);
    if (cached !== undefined) return cached;
    const content = this.contentSeen;
    const res = await fetch(url);
    if (!res.ok) return { error: 'unavailable', message: `the file could not be read (${res.status})` };
    const blob = await res.blob();
    const media = { type: blob.type || (ref === 'poster' ? 'image/png' : 'video/mp4'), blob };
    // An older fetch may finish after refresh replaced the take at this same URL.
    if (this.contentSeen === content) this.mediaCache.set(url, media);
    return media;
  }

  write(): Promise<AdapterResult<{ version: number }>> { return Promise.resolve({ error: 'refused', message: 'this recording is shown as it was recorded; re-cut it from its demo document' }); }
  undo(): Promise<AdapterResult<{ undone: true }>> { return Promise.resolve({ error: 'unsupported', message: 'nothing to undo on a recording' }); }
  fork(): Promise<AdapterResult<{ version: number }>> { return Promise.resolve({ error: 'unsupported', message: 'a recording has one version' }); }
}

/** E1's cut, as a surface adapter: chapters are its parts, the style is its theme. */
export class DemoCutSurfaceAdapter extends DemoCutAdapter implements SurfaceAdapter {
  readonly source = 'demo' as const;
  constructor(private readonly binding: ArtifactBinding) { super(binding.projectId, binding.docId ?? '', binding.title, binding.kind); }
  capabilities(): readonly AdapterCapability[] {
    const caps: AdapterCapability[] = ['read', 'write', 'versions', 'media', 'theme'];
    if (this.exports().length > 0) caps.push('export');
    return caps;
  }
  exports(): readonly ExportOption[] { return this.binding.docId ? CUT_EXPORTS : []; }
  async exportFile(format: string, version: number): Promise<ExportOutcome> {
    if (!this.exports().some(o => o.format === format)) return { ok: false, text: 'This cut exports as MP4.' };
    if (!Number.isInteger(version) || version < 1) return { ok: false, text: 'Choose a rendered version to export.' };
    const file = `_v${version}.mp4`;
    const href = interactiveUrl(this.binding.projectId, `/d/${encodeURIComponent(this.binding.docId ?? '')}/api/demo/recording/${file}`);
    return { ok: true, text: 'Video ready.', href, file };
  }
}

registerAdapter('demo', (b) => (b.docId !== undefined && b.docId !== '' ? new DemoCutSurfaceAdapter(b) : new RecordingSurfaceAdapter(b, 'demo')));
registerAdapter('walkthrough', (b) => new RecordingSurfaceAdapter(b, 'walkthrough'));
