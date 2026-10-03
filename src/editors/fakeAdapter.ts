import type { AdapterResult, ArtifactRef, HostAdapter } from './host.js';
import type { WireItem } from './ops.js';

/**
 * A scripted, in-memory `interactive-doc` adapter for the editor dev page and the conformance host
 * (DES-EDITOR-PLUGINS-001 §12.1, EP-P1). It applies the deterministic wire items the way interactive's
 * engine does (`content-edit` as TEXT with the text `before` stale check — interactive #250 —, `style-edit`,
 * `remove`), so a plugin's edits become real versions here — and a `<img onerror>` sent as text lands as `&lt;img`.
 * The real adapter (crew's interactive proxy, versions, fork with `expect_head`) is EP-P2's.
 */

// The sample is a DOCUMENT's own HTML (an agent-authored page with a learned-theme token), not studio
// styling, so its colour is data.
// eslint-disable-next-line no-restricted-syntax
export const SAMPLE_PAGE = `<!doctype html><html><head><style>:root{--wi-accent:#224a5e}</style></head><body>
<section data-wid="section-0"><h1 data-wid="hero-title">Book a study room in under a minute</h1>
<p data-wid="hero-lede">From your phone, without calling the front desk.</p>
<button data-wid="cta">Book a room</button></section>
<section data-wid="section-1"><h2 data-wid="price-title">One fixed fee</h2>
<p data-wid="price-body">Support is included, with answers within one working day.</p></section>
</body></html>`;

interface Version { version: number; parent: number | null; html: string; createdAt: string }

export class FakeDocAdapter implements HostAdapter {
  private versionsList: Version[];
  readonly writes: { base: number; items: WireItem[]; summary: string }[] = [];
  reads = 0;
  readonly: boolean;

  constructor(html: string = SAMPLE_PAGE, private readonly title = 'Library room booking', opts: { readonly?: boolean } = {}) {
    this.versionsList = [{ version: 1, parent: null, html, createdAt: new Date(0).toISOString() }];
    this.readonly = opts.readonly ?? false;
  }

  private get head(): Version { return this.versionsList[this.versionsList.length - 1]!; }

  artifact(): ArtifactRef {
    return { kind: 'page', title: this.title, version: this.head.version, head: this.head.version, readonly: this.readonly, lockedParts: [] };
  }

  async read(version?: number): Promise<AdapterResult<{ version: number; content: { type: 'html'; html: string } }>> {
    this.reads += 1;
    const v = version === undefined ? this.head : this.versionsList.find((x) => x.version === version);
    if (v === undefined) return { error: 'bad_request', message: `no version ${version}` };
    return { version: v.version, content: { type: 'html', html: v.html } };
  }

  async versions(): Promise<AdapterResult<{ versions: { version: number; parent: number | null; createdAt: string }[]; head: number }>> {
    return { versions: this.versionsList.map(({ version, parent, createdAt }) => ({ version, parent, createdAt })), head: this.head.version };
  }

  async write(base: number, items: WireItem[], summary: string): Promise<AdapterResult<{ version: number }>> {
    this.writes.push({ base, items, summary });
    const doc = new DOMParser().parseFromString(this.head.html, 'text/html');
    for (const it of items) {
      const el = doc.querySelector(`[data-wid="${it.selector}"]`); // the wire names the data-wid
      if (el === null) return { error: 'stale', message: 'Not changed: it moved while you typed' };
      if (it.type === 'content-edit') {
        if ((el.textContent ?? '').trim() !== it.before.trim()) return { error: 'stale', message: 'Not changed: it moved while you typed' };
        el.textContent = it.value; // the engine lands a content-edit as TEXT (interactive #250): `<img` stays `&lt;img`
      } else if (it.type === 'style-edit') {
        for (const [k, v] of Object.entries(it.style)) (el as HTMLElement).style.setProperty(k, v);
      } else {
        el.remove();
      }
    }
    const html = `<!doctype html>${doc.documentElement.outerHTML}`;
    if (html === this.head.html) return { error: 'refused', message: 'Nothing changed' };
    const version = this.head.version + 1;
    this.versionsList.push({ version, parent: this.head.version, html, createdAt: new Date().toISOString() });
    return { version };
  }

  async undo(version: number): Promise<AdapterResult<{ undone: true }>> {
    if (this.head.version !== version) return { error: 'head_moved', message: `Not undone: it changed since — version ${this.head.version}`, head: this.head.version };
    const v = this.versionsList.find((x) => x.version === version);
    const parent = v?.parent == null ? undefined : this.versionsList.find((x) => x.version === v.parent);
    if (parent === undefined) return { error: 'refused', message: 'nothing to undo' };
    this.versionsList.push({ version: this.head.version + 1, parent: version, html: parent.html, createdAt: new Date().toISOString() });
    return { undone: true };
  }

  async fork(from: number): Promise<AdapterResult<{ version: number }>> {
    const v = this.versionsList.find((x) => x.version === from);
    if (v === undefined) return { error: 'bad_request', message: `no version ${from}` };
    const version = this.head.version + 1;
    this.versionsList.push({ version, parent: from, html: v.html, createdAt: new Date().toISOString() });
    return { version };
  }

  /** An agent's version landing (for `artifact.changed` with `by: 'agent'`). */
  agentEdit(): number {
    const version = this.head.version + 1;
    this.versionsList.push({ version, parent: this.head.version, html: this.head.html.replace('One fixed fee', 'One fixed fee, then a yearly licence'), createdAt: new Date().toISOString() });
    return version;
  }

  headHtml(): string { return this.head.html; }
}
