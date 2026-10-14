import { demoFileUrl, getDemo } from '../../api/demo.js';
import { walkthroughApi, walkthroughFileUrl } from '../../api/walkthrough.js';
import { recordingOf, recordingOfDemo, type Recording } from '../../board/walkthroughModel.js';
import { DemoCutAdapter } from '../demoCutAdapter.js';
import { defaultVideoStyle, type DemoChapter, type DemoCut } from '../demoCutModel.js';
import type { AdapterResult, ArtifactRef } from '../host.js';
import { registerAdapter, type AdapterCapability, type ArtifactBinding, type ExportOption, type StatusPill, type SurfaceAdapter } from '../hostApi.js';
import type { MediaRef } from '../protocol.js';

/**
 * The video data planes (HOST-API §3, slice H6), so `wicked-video` edits what `WalkthroughEditor` showed:
 *
 *  - `demo` with a document id: the demo's interactive cut (E1: chapters, takes, re-cut, style), through
 *    {@link DemoCutAdapter} — every chapter edit and style change is a new rendered version, Undo from the host.
 *  - `demo` without one, and `walkthrough`: the run's own recording, read-only (crew's `GET /runs/:id/demo` and
 *    `/walkthrough`). The plugin shows its chapters and plays it; edits are refused `refused` in the host's words.
 *    Re-record and "Ask helpers to fix" stay the run's gate controls, never the plugin's.
 */

const RECORDING_EXPORTS: readonly ExportOption[] = [{ format: 'mp4', label: 'Video' }, { format: 'gif', label: 'GIF' }];

/** A run's recording as the cut shape the plugin reads (no takes: a recording is one take). */
export function cutOfRecording(rec: Recording, title: string): DemoCut {
  const starts = rec.chapters.map((c) => c.startSec ?? 0);
  const chapters: DemoChapter[] = rec.chapters.map((c, i) => {
    const startSec = starts[i] ?? 0;
    const next = starts[i + 1];
    const durationSec = next !== undefined && next > startSec ? next - startSec : 0;
    return { id: c.key, title: c.title, say: c.blurb ?? '', take: '', inSec: 0, outSec: durationSec, durationSec, startSec };
  });
  const style = defaultVideoStyle(title);
  style.theme.titleCard.on = false;
  style.theme.endCard.on = false;
  return { type: 'demo-cut', title, rev: 1, version: 1, chapters, takes: {}, style };
}

export class RecordingSurfaceAdapter implements SurfaceAdapter {
  readonly source: 'demo' | 'walkthrough';
  private rec: Recording | null = null;
  private readonly listeners = new Set<() => void>();
  constructor(private readonly binding: ArtifactBinding, source: 'demo' | 'walkthrough') { this.source = source; }

  capabilities(): readonly AdapterCapability[] { return ['read', 'media', 'versions']; }
  exports(): readonly ExportOption[] { return this.rec?.exportable === true ? RECORDING_EXPORTS : []; }
  pills(): readonly StatusPill[] {
    if (this.rec === null) return [{ id: 'state', text: 'Reading…', tone: 'neutral' }];
    return [{ id: 'state', text: `${this.rec.chapters.length} chapter${this.rec.chapters.length === 1 ? '' : 's'}`, tone: 'neutral' }];
  }
  subscribe(onChange: () => void): () => void { this.listeners.add(onChange); return () => { this.listeners.delete(onChange); }; }

  artifact(): ArtifactRef {
    return { kind: this.binding.kind, title: this.binding.title, version: 1, head: 1, readonly: true, lockedParts: [] };
  }

  private async load(): Promise<Recording> {
    const runId = this.binding.runId ?? '';
    const rec = this.source === 'demo' ? recordingOfDemo(await getDemo(runId)) : recordingOf(await walkthroughApi.view(runId, null));
    this.rec = rec;
    for (const l of this.listeners) l();
    return rec;
  }

  async read(): Promise<AdapterResult<{ version: number; content: Record<string, unknown> }>> {
    try {
      const rec = await this.load();
      return { version: 1, content: { ...cutOfRecording(rec, this.binding.title), readonly: true } };
    } catch (e: unknown) {
      return { error: 'unavailable', message: e instanceof Error ? e.message : String(e) };
    }
  }

  async versions(): Promise<AdapterResult<{ versions: { version: number; parent: number | null; createdAt: string }[]; head: number }>> {
    return { versions: [{ version: 1, parent: null, createdAt: new Date(0).toISOString() }], head: 1 };
  }

  async media(ref: MediaRef): Promise<AdapterResult<{ type: string; blob: Blob }>> {
    const rec = this.rec ?? await this.load().catch(() => null);
    if (rec === null) return { error: 'unavailable', message: 'the recording could not be read' };
    const path = ref === 'video' ? rec.video : ref === 'poster' ? rec.poster : null;
    if (path === null) return { error: 'unsupported', message: ref === 'video' || ref === 'poster' ? 'no file for that yet' : 'a recording is one take' };
    const url = rec.kind === 'demo-video' ? demoFileUrl(rec.runId, path) : walkthroughFileUrl(rec.runId, rec.step, path);
    const res = await fetch(url);
    if (!res.ok) return { error: 'unavailable', message: `the file could not be read (${res.status})` };
    const blob = await res.blob();
    return { type: blob.type || (ref === 'poster' ? 'image/png' : 'video/mp4'), blob };
  }

  write(): Promise<AdapterResult<{ version: number }>> { return Promise.resolve({ error: 'refused', message: 'this recording is shown as it was recorded; re-cut it from its demo document' }); }
  undo(): Promise<AdapterResult<{ undone: true }>> { return Promise.resolve({ error: 'unsupported', message: 'nothing to undo on a recording' }); }
  fork(): Promise<AdapterResult<{ version: number }>> { return Promise.resolve({ error: 'unsupported', message: 'a recording has one version' }); }
}

/** E1's cut, as a surface adapter: chapters are its parts, the style is its theme. */
export class DemoCutSurfaceAdapter extends DemoCutAdapter implements SurfaceAdapter {
  readonly source = 'demo' as const;
  constructor(binding: ArtifactBinding) { super(binding.projectId, binding.docId ?? '', binding.title, binding.kind); }
  capabilities(): readonly AdapterCapability[] { return ['read', 'write', 'versions', 'media', 'theme', 'export']; }
  exports(): readonly ExportOption[] { return RECORDING_EXPORTS; }
}

registerAdapter('demo', (b) => (b.docId !== undefined && b.docId !== '' ? new DemoCutSurfaceAdapter(b) : new RecordingSurfaceAdapter(b, 'demo')));
registerAdapter('walkthrough', (b) => new RecordingSurfaceAdapter(b, 'walkthrough'));
