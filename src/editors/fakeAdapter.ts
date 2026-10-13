import { topSlideElements } from '../board/deck.js';
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

/** A DECK's own HTML (P-D1), the way interactive instruments one: top-level slides with a stable
 *  `data-slide-id`, positional `section-{i}` / `slide-{i}-…` anchors, speaker notes in a hidden aside. */
// eslint-disable-next-line no-restricted-syntax
export const SAMPLE_DECK = `<!doctype html><html><head><style>body{margin:0;font-family:Georgia,serif;background:#f4f1ea;color:#1b1b1b}
.wi-slide{box-sizing:border-box;width:1280px;height:720px;padding:96px 112px;background:#fffdf7;border-bottom:1px solid #ddd6c4}
h1{font-size:64px;margin:0 0 28px}h2{font-size:52px;margin:0 0 28px}p,li{font-size:30px;line-height:1.4;color:#4a463c}</style></head><body data-wi-kind="deck">
<section class="wi-slide" data-wid="section-0" data-slide-id="s-intro"><h1 data-wid="slide-0-heading-1">Library room booking</h1><p data-wid="slide-0-paragraph-1">A study room in two taps.</p><aside class="notes" data-notes-for="s-intro" hidden data-wi-no-anchor>Open with the waiting-list numbers.</aside></section>
<section class="wi-slide" data-wid="section-1" data-slide-id="s-first"><h2 data-wid="slide-1-heading-1">Residents first</h2><ul data-wid="slide-1-list-1"><li data-wid="slide-1-item-1">Free rooms come first</li><li data-wid="slide-1-item-2">Nobody scrolls past full ones</li></ul></section>
<section class="wi-slide" data-wid="section-2" data-slide-id="s-staff"><h2 data-wid="slide-2-heading-1">Staff stay in control</h2><p data-wid="slide-2-paragraph-1">The whole day at a glance, per branch.</p></section>
<section class="wi-slide" data-wid="section-3" data-slide-id="s-pilot"><h2 data-wid="slide-3-heading-1">The pilot</h2><p data-wid="slide-3-paragraph-1">Central branch, eight weeks, then every branch.</p></section>
</body></html>`;

interface Version { version: number; parent: number | null; html: string; createdAt: string }

let freshId = 0;
/** Fresh anchors for a copied slide, as the engine's re-instrumenting gives one. */
function freshen(el: Element): void {
  freshId += 1;
  const tag = `n${freshId}`;
  el.setAttribute('data-slide-id', `s-${tag}`);
  for (const a of [el, ...Array.from(el.querySelectorAll('[data-wid]'))]) if (a.hasAttribute('data-wid')) a.setAttribute('data-wid', `${a.getAttribute('data-wid')}-${tag}`);
}

export class FakeDocAdapter implements HostAdapter {
  private versionsList: Version[];
  readonly writes: { base: number; items: WireItem[]; summary: string }[] = [];
  reads = 0;
  readonly: boolean;

  private readonly kind: string;

  constructor(html: string = SAMPLE_PAGE, private readonly title = 'Library room booking', opts: { readonly?: boolean; kind?: string } = {}) {
    this.versionsList = [{ version: 1, parent: null, html, createdAt: new Date(0).toISOString() }];
    this.readonly = opts.readonly ?? false;
    this.kind = opts.kind ?? 'page';
  }

  private get head(): Version { return this.versionsList[this.versionsList.length - 1]!; }

  artifact(): ArtifactRef {
    return { kind: this.kind, title: this.title, version: this.head.version, head: this.head.version, readonly: this.readonly, lockedParts: [] };
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
      if (it.type === 'deck') {
        // The engine's deck ops (interactive core/deck.js), in memory: one op, one version.
        const slides = topSlideElements(doc);
        const byId = (id: string | null | undefined): Element | null => (id == null ? null : slides.find((x) => x.getAttribute('data-slide-id') === id) ?? null);
        const target = byId(it.op.slide);
        if (target === null) return { error: 'refused', message: 'Not changed: that slide is not in this version.' };
        const place = (node: Element, after: string | null | undefined): void => {
          const a = byId(after);
          if (a !== null) a.after(node);
          else if (slides[0] !== undefined && slides[0] !== node) slides[0].before(node);
          else target.parentElement?.prepend(node);
        };
        if (it.op.type === 'slide-move') {
          if (it.op.after === it.op.slide) return { error: 'refused', message: 'Not changed: a slide cannot go after itself.' };
          // Already there (the engine's no-op): nothing is touched (codex r1 — removing the first slide to
          // place it "first" lost it).
          const at = slides.indexOf(target);
          if ((it.op.after == null || it.op.after === '') ? at === 0 : slides[at - 1]?.getAttribute('data-slide-id') === it.op.after) {
            return { error: 'refused', message: 'Nothing changed: the slide is already there.' };
          }
          target.remove();
          place(target, it.op.after);
        } else if (it.op.type === 'slide-duplicate') {
          const copy = target.cloneNode(true) as Element;
          freshen(copy);
          target.after(copy);
        } else if (it.op.type === 'slide-insert') {
          const copy = target.cloneNode(true) as Element;
          for (const n of Array.from(copy.querySelectorAll('aside[data-notes-for]'))) n.remove();
          const walk = (n: Node): void => { for (const c of Array.from(n.childNodes)) { if (c.nodeType === 3) c.textContent = ''; else walk(c); } };
          walk(copy);
          freshen(copy);
          place(copy, it.op.after);
        } else {
          for (const n of Array.from(target.querySelectorAll('aside[data-notes-for]'))) n.remove();
          if ((it.op.text ?? '').trim() !== '') {
            const aside = doc.createElement('aside');
            aside.className = 'notes';
            aside.setAttribute('data-notes-for', it.op.slide);
            aside.setAttribute('hidden', '');
            aside.setAttribute('data-wi-no-anchor', '');
            aside.textContent = it.op.text ?? '';
            target.append(aside);
          }
        }
        continue;
      }
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
