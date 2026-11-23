import { exportFileUrl, interactiveUrl, listExports, type ExportFormat } from '../../api/interactive.js';
import { exportReadyText, runExport } from '../../interactive/exportWire.js';
import { registerAdapter, type AdapterCapability, type ArtifactAttempt, type ArtifactBinding, type ArtifactPart, type ExportOption, type ExportOutcome, type ExportedFile, type StatusPill, type SurfaceAdapter } from '../hostApi.js';
import { InteractiveDocAdapter } from '../interactiveDocAdapter.js';
import { inventoryOf } from '../ops.js';

/** The formats interactive renders, per artifact kind (what ArtifactMorph's EXPORTS table said). */
const FORMATS: Readonly<Record<string, readonly ExportOption[]>> = {
  deck: [{ format: 'pptx', label: 'PowerPoint' }, { format: 'pdf', label: 'PDF' }],
  document: [{ format: 'pdf', label: 'PDF' }, { format: 'html', label: 'Web page' }],
  // plugins-complete G13 (operator default D8): a page exports as the web page it is, or a PDF.
  page: [{ format: 'html', label: 'Web page' }, { format: 'pdf', label: 'PDF' }],
};

/** `interactive-doc` (HOST-API §3): a page, deck or document in interactive, through crew's proxy. */
export class InteractiveDocSurfaceAdapter extends InteractiveDocAdapter implements SurfaceAdapter {
  readonly source = 'interactive-doc' as const;
  private readonly listeners = new Set<() => void>();
  /** `opts` reach InteractiveDocAdapter as they are: a port re-registers `interactive-doc` with its own (H4b's
   *  `requirements`), e.g. `registerAdapter('interactive-doc', (b) => new InteractiveDocSurfaceAdapter(b, {...}))`. */
  constructor(private readonly binding: ArtifactBinding, opts: ConstructorParameters<typeof InteractiveDocAdapter>[5] = {}) {
    super(binding.projectId, binding.docId ?? '', binding.title, binding.kind, () => { for (const l of this.listeners) l(); void this.parts(); }, opts);
  }
  /** The parts the head has (a deck's slides), counted at the last `parts()` read: no kind branch decides it. */
  private partsSeen = 0;
  private titleSeen: string | undefined;
  docTitle(): string | undefined { return this.titleSeen; }
  /** The first manifest read that finds no version leaves the head at 0, so nothing else says it was read: the card
   *  is told, for its pill (crew#1745), whichever read it was (the card's refresh, or an editor's versions). */
  private toldRead = false;
  private tellRead(): void {
    if (this.toldRead || !this.artifact().read) return;
    this.toldRead = true;
    for (const l of this.listeners) l();
  }
  override async refresh(): ReturnType<InteractiveDocAdapter['refresh']> {
    const moved = await super.refresh();
    this.tellRead();
    return moved;
  }
  override async versions(): ReturnType<InteractiveDocAdapter['versions']> {
    const r = await super.versions();
    this.tellRead();
    return r;
  }
  override async read(version?: number): ReturnType<InteractiveDocAdapter['read']> {
    const result = await super.read(version);
    if (!('error' in result) && result.version === this.head) {
      const title = new DOMParser().parseFromString(result.content.html, 'text/html').head.querySelector('title')?.textContent?.trim() || undefined;
      if (title !== this.titleSeen) {
        this.titleSeen = title;
        for (const l of this.listeners) l();
      }
    }
    return result;
  }
  capabilities(): readonly AdapterCapability[] {
    const caps: AdapterCapability[] = ['read', 'write', 'versions', 'checks'];
    if (this.exports().length > 0) caps.push('export');
    if (typeof (this as { theme?: unknown }).theme === 'function') caps.push('theme');
    if (this.partsSeen > 0) caps.push('parts', 'review');
    return caps;
  }
  async parts(): Promise<readonly ArtifactPart[]> {
    if (this.head < 1) return [];
    const r = await this.read(this.head);
    if ('error' in r) return [];
    const slides = [...inventoryOf(r.content.html).slides.entries()].sort((a, b) => a[1].n - b[1].n);
    const was = this.partsSeen;
    this.partsSeen = slides.length;
    if (was !== this.partsSeen) for (const l of this.listeners) l();
    return slides.map(([id, s]) => ({ id, label: s.title === '' ? `Slide ${s.n}` : s.title, state: 'pending' as const }));
  }
  exports(): readonly ExportOption[] { return FORMATS[this.binding.kind] ?? []; }
  /** crew#1745: before its first version, the card says how the run making it stands: still building, stopped, or not
   *  made with crew's reason (the run's `landing_failed.reason`). A version on disk always wins, so "no version" is
   *  said only once the manifest has been read (a revision's run can fail over a document that has versions). */
  pills(attempt?: ArtifactAttempt): readonly StatusPill[] {
    if (this.head >= 1) return [{ id: 'version', text: `Version ${this.head}`, tone: 'neutral' }];
    const ended = attempt?.state === 'failed' || attempt?.state === 'stopped';
    if (ended && !this.artifact().read) return [{ id: 'version', text: 'Reading…', tone: 'neutral' }];
    if (attempt?.state === 'failed') return [{ id: 'version', text: 'Not made', tone: 'bad', why: `The last attempt ended without a draft: ${attempt.why}.` }];
    if (attempt?.state === 'stopped') return [{ id: 'version', text: 'Stopped', tone: 'bad', why: 'The job stopped before it made a first version.' }];
    return [{ id: 'version', text: 'Building…', tone: 'warn' }];
  }
  async exportFile(format: string, version: number): Promise<ExportOutcome> {
    const label = this.exports().find((x) => x.format === format)?.label ?? format;
    const out = await runExport({ projectId: this.binding.projectId, docId: this.binding.docId ?? '', version, format: format as ExportFormat });
    if (out.ok) return { ok: true, text: exportReadyText(format as ExportFormat, out.file, out.report), href: interactiveUrl(this.binding.projectId, out.result.download), file: out.file };
    return { ok: false, text: `The ${label} was not made — ${out.hint}` };
  }
  /** studio#234: what is on disk for `version`, from the bridge's listing (`GET /d/:doc/api/export`), in the formats
   *  this kind offers. */
  async exported(version: number): Promise<readonly ExportedFile[]> {
    const { projectId } = this.binding;
    const docId = this.binding.docId ?? '';
    if (docId === '' || this.exports().length === 0) return [];
    const rows = await listExports(projectId, docId);
    return (Array.isArray(rows) ? rows : []).flatMap((r) => {
      const offered = r.version === version ? this.exports().find((x) => x.format === r.format) : undefined;
      return offered === undefined ? [] : [{ format: r.format, label: offered.label, name: r.name, href: exportFileUrl(projectId, docId, r.name) }];
    });
  }
  subscribe(onChange: () => void): () => void { this.listeners.add(onChange); return () => { this.listeners.delete(onChange); }; }
}

registerAdapter('interactive-doc', (b) => new InteractiveDocSurfaceAdapter(b));
