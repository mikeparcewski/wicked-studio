import { interactiveUrl, type ExportFormat } from '../../api/interactive.js';
import { exportReadyText, runExport } from '../../interactive/exportWire.js';
import { registerAdapter, type AdapterCapability, type ArtifactBinding, type ArtifactPart, type ExportOption, type ExportOutcome, type StatusPill, type SurfaceAdapter } from '../hostApi.js';
import { InteractiveDocAdapter } from '../interactiveDocAdapter.js';
import { inventoryOf } from '../ops.js';

/** The formats interactive renders, per artifact kind (what ArtifactMorph's EXPORTS table said). */
const FORMATS: Readonly<Record<string, readonly ExportOption[]>> = {
  deck: [{ format: 'pptx', label: 'PowerPoint' }, { format: 'pdf', label: 'PDF' }],
  document: [{ format: 'pdf', label: 'PDF' }, { format: 'html', label: 'Web page' }],
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
  pills(): readonly StatusPill[] { return this.head >= 1 ? [{ id: 'version', text: `Version ${this.head}`, tone: 'neutral' }] : [{ id: 'version', text: 'Building…', tone: 'warn' }]; }
  async exportFile(format: string, version: number): Promise<ExportOutcome> {
    const label = this.exports().find((x) => x.format === format)?.label ?? format;
    const out = await runExport({ projectId: this.binding.projectId, docId: this.binding.docId ?? '', version, format: format as ExportFormat });
    if (out.ok) return { ok: true, text: exportReadyText(format as ExportFormat, out.file, out.report), href: interactiveUrl(this.binding.projectId, out.result.download), file: out.file };
    return { ok: false, text: `The ${label} was not made — ${out.hint}` };
  }
  subscribe(onChange: () => void): () => void { this.listeners.add(onChange); return () => { this.listeners.delete(onChange); }; }
}

registerAdapter('interactive-doc', (b) => new InteractiveDocSurfaceAdapter(b));
