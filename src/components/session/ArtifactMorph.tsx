import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { interactiveUrl, type ExportFormat } from '../../api/interactive.js';
import { grow, shrink, type ArtifactSize, type EditorKind } from '../../board/artifactMorph.js';
import { exportReadyText, runExport } from '../../interactive/exportWire.js';
import { artifactSizeOf, setArtifactSize, topmostArtifact, useArtifactSizes } from '../../store/artifactSizes.js';
import { DocCoverage } from './DocCoverage.js';
import { PageEditor, type FrameParts } from './PageEditor.js';
import { NoEditorPage, PluginArtifact } from './PluginArtifact.js';
import { SlideStrip } from './SlideStrip.js';
import { useEditorFor, useEditors } from '../../store/editors.js';

/** WT-U1: a body other than the page-editor family — a run's walkthrough, a demo's video (EP-D3) —
 *  behind the same chrome: its kind (the artifact's `data-kind`) and the body drawn at each size.
 *  `morph` lets a control inside it change the size (the walkthrough's Watch opens the pane). */
export interface ArtifactSlot {
  kind: 'walkthrough' | 'demo-video' | 'plan';
  body: (size: ArtifactSize, morph: (to: ArtifactSize) => void) => React.ReactNode;
}

/**
 * S8 — the morphing artifact (DESIGN-interaction rule 1: the object is the control). ONE element
 * that is the page's live preview in the thread, grows to a pane beside it on a click and to full
 * screen on ⤢, and shrinks one step on Esc — never re-parented between sizes (DOC-1 / EP-D2): the
 * same `<section>` changes class, so the frame inside keeps its state and the shared-element morph
 * (View Transitions where the browser has them; nothing animates under reduced motion) is honest.
 *
 * The kind slot: a page is opened by the editor PLUGIN crew's registry names for `page` — the
 * built-in `wicked-page`, hash-pinned in studio's own bundle (EP-P2, {@link PluginArtifact}); with
 * no registry, or none claiming the kind, the page is shown read-only and the sentence says so
 * (DES-EDITOR-PLUGINS-001 §3.1). A written document and a deck (S9) host the studio editor with what
 * stands beside its frame — the document's requirement coverage at full screen, the deck's slide
 * strip — and an Export in the header, until EP-P4 re-hosts them the same way.
 */

/** What each kind exports to, in the order offered (interactive's own formats). */
const EXPORTS: Readonly<Record<EditorKind, ReadonlyArray<{ format: ExportFormat; label: string }>>> = {
  page: [],
  document: [{ format: 'pdf', label: 'PDF' }, { format: 'html', label: 'Web page' }],
  deck: [{ format: 'pptx', label: 'PowerPoint' }, { format: 'pdf', label: 'PDF' }],
};

type ExportLine =
  | { state: 'working'; text: string }
  | { state: 'ready'; text: string; href: string; file: string }
  | { state: 'failed'; text: string };

export function ArtifactMorph({ artifactKey, title, projectId, docId, composerKey, kind = 'page', repoId = null, slot }: {
  artifactKey: string;
  title: string;
  projectId: string;
  docId: string;
  composerKey: string;
  /** Which editor the document opens in (S9) — from the style it was created with. */
  kind?: EditorKind;
  /** The run's repository, when it has one: where a document's requirement coverage is read. */
  repoId?: string | null;
  /** WT-U1: what the slot hosts instead of the page editor (see {@link ArtifactSlot}). */
  slot?: ArtifactSlot;
}): React.ReactElement {
  const size = useArtifactSizes((s) => artifactSizeOf(s, artifactKey));
  const topmost = useArtifactSizes((s) => topmostArtifact(s) === artifactKey);
  const [head, setHead] = useState<number | null>(null);
  // EP-P2: which plugin opens a page here (`undefined` while the registry is read; `null` = none).
  const pageEditor = useEditorFor('page');
  const noEditorReason = useEditors((s) => s.reason);
  const shrinkBtn = useRef<HTMLButtonElement | null>(null);
  const growBtn = useRef<HTMLButtonElement | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exported, setExported] = useState<ExportLine | null>(null);
  const exportBtn = useRef<HTMLButtonElement | null>(null);
  const exportMenu = useRef<HTMLSpanElement | null>(null);
  // The menu is a menu: opened, its first format holds the focus (arrows move, Enter chooses);
  // closed — by Esc or by a choice — the focus is back on Export.
  useEffect(() => {
    if (exportOpen) exportMenu.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
  }, [exportOpen]);
  const closeExport = (): void => { setExportOpen(false); exportBtn.current?.focus(); };
  const onExportKey = (e: React.KeyboardEvent<HTMLSpanElement>): void => {
    if (!exportOpen) return;
    // Esc closes the open menu first; it does not also shrink the artifact.
    if (e.key === 'Escape') { e.stopPropagation(); closeExport(); return; }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = [...(exportMenu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
    if (items.length === 0) return;
    const at = items.findIndex((b) => b === document.activeElement);
    items[(at + (e.key === 'ArrowDown' ? 1 : items.length - 1) + items.length) % items.length]?.focus();
  };
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);

  // What stands beside the frame: a deck's slides whenever it is open, a document's requirements
  // at full screen (the pane has no room for a column) and only for a run that has a repository.
  const side = useCallback((parts: FrameParts | null): React.ReactNode => {
    if (parts === null) return null;
    if (kind === 'deck' && size !== 'inline') return <SlideStrip parts={parts} docId={docId} composerKey={composerKey} />;
    if (kind === 'document' && size === 'full' && repoId !== null) return <DocCoverage parts={parts} repoId={repoId} composerKey={composerKey} />;
    return null;
  }, [kind, size, repoId, docId, composerKey]);

  const exportAs = async (format: ExportFormat, label: string): Promise<void> => {
    if (head === null) return;
    closeExport();
    setExported({ state: 'working', text: `Making the ${label} of version ${head}…` });
    const out = await runExport({ projectId, docId, version: head, format });
    if (!live.current) return;
    if (out.ok) setExported({ state: 'ready', text: exportReadyText(format, out.file, out.report), href: interactiveUrl(projectId, out.result.download), file: out.file });
    else setExported({ state: 'failed', text: `The ${label} was not made — ${out.hint}` });
  };
  const exportsHere = size === 'inline' ? [] : EXPORTS[kind];
  // Folded back to the preview, the menu is gone — it must not be open when the artifact grows again.
  useEffect(() => { if (size === 'inline') setExportOpen(false); }, [size]);

  const morph = useCallback((to: ArtifactSize): void => {
    const apply = (): void => flushSync(() => setArtifactSize(artifactKey, to));
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const vt = (document as Document & { startViewTransition?: (cb: () => void) => unknown }).startViewTransition;
    if (!reduced && typeof vt === 'function') vt.call(document, apply);
    else apply();
  }, [artifactKey]);

  // Esc shrinks one step (rule 1) — the topmost open artifact only, and not while something inside
  // it is consuming it (a pick, an edit field), which stops the event before it reaches the document.
  // Known limit: a key pressed with focus INSIDE the sandboxed frame stays there; the ⤡ / × buttons
  // and a pick (which moves focus out) are the way back.
  useEffect(() => {
    if (size === 'inline' || !topmost) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t !== null && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      morph(shrink(size));
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [size, topmost, morph]);

  // Focus follows the morph: the control that was pressed may be gone at the new size.
  useEffect(() => {
    const el = size === 'full' ? shrinkBtn.current : size === 'pane' ? growBtn.current : null;
    if (el !== null && document.activeElement !== null && document.activeElement !== document.body
      && !el.closest('[data-testid="artifact"]')?.contains(document.activeElement)) return;
    el?.focus();
  }, [size]);

  // An artifact that leaves the page (its document gone from the list) leaves no open size behind:
  // the session would stay narrowed, and Esc would target an artifact with no listener.
  useEffect(() => () => {
    if (artifactSizeOf(useArtifactSizes.getState(), artifactKey) !== 'inline') setArtifactSize(artifactKey, 'inline');
  }, [artifactKey]);

  const slug = artifactKey.replace(/[^a-z0-9]/gi, '-');
  return (
    <section
      data-testid="artifact"
      data-object={`artifact:${artifactKey}`}
      data-size={size}
      data-doc={docId}
      data-kind={slot?.kind ?? kind}
      aria-label={`${title} — ${size === 'inline' ? 'preview' : size === 'pane' ? 'open beside the thread' : 'full screen'}`}
      className={`wk-artifact wk-artifact--${size}`}
      style={{ viewTransitionName: `artifact-${slug}` } as React.CSSProperties}
    >
      <header className="wk-artifact-head">
        <span className="wk-artifact-title">{title}</span>
        <span data-testid="artifact-version">{head === null ? '' : `version ${head}`}</span>
        {exportsHere.length > 0 && head !== null && (
          <span className="wk-artifact-export" onKeyDown={onExportKey}>
            <button ref={exportBtn} type="button" data-testid="artifact-export" aria-haspopup="menu" aria-expanded={exportOpen} onClick={() => setExportOpen((o) => !o)} className="wk-artifact-btn">Export ▾</button>
            {exportOpen && (
              <span ref={exportMenu} role="menu" aria-label="Export as" data-testid="artifact-export-menu" className="wk-artifact-menu">
                {exportsHere.map((x) => (
                  <button key={x.format} type="button" role="menuitem" data-testid="artifact-export-format" data-format={x.format} onClick={() => void exportAs(x.format, x.label)} className="wk-artifact-menu-item">{x.label}</button>
                ))}
              </span>
            )}
          </span>
        )}
        {size !== 'full' && (
          <button ref={growBtn} type="button" data-testid="artifact-grow" aria-label={size === 'inline' ? 'Open beside the thread' : 'Full screen'} title={size === 'inline' ? 'Open' : 'Full screen'} onClick={() => morph(grow(size))} className="wk-artifact-btn">⤢</button>
        )}
        {size !== 'inline' && (
          <button ref={shrinkBtn} type="button" data-testid="artifact-shrink" aria-label={size === 'full' ? 'Back to the pane' : 'Back to the thread'} title="Esc" onClick={() => morph(shrink(size))} className="wk-artifact-btn">{size === 'full' ? '⤡' : '×'}</button>
        )}
      </header>
      {slot !== undefined
        ? slot.body(size, morph)
        : kind === 'page'
          ? (pageEditor === undefined
            ? <div className="wk-artifact-body" data-testid="artifact-opening" />
            : pageEditor === null
              ? <NoEditorPage projectId={projectId} docId={docId} size={size} reason={noEditorReason} onHead={setHead} />
              : <PluginArtifact projectId={projectId} docId={docId} title={title} composerKey={composerKey} size={size} morph={morph} editor={pageEditor} onHead={setHead} />)
          : <PageEditor projectId={projectId} docId={docId} composerKey={composerKey} size={size} kind={kind} side={side} onHead={setHead} />}
      {exported !== null && size !== 'inline' && (
        <p data-testid="artifact-export-line" data-state={exported.state} className={`wk-artifact-line${exported.state === 'failed' ? ' wk-artifact-line--bad' : ''}`}>
          {exported.text}
          {exported.state === 'ready' && (
            <> <a data-testid="artifact-export-download" href={exported.href} download={exported.file} className="wk-since-toggle">Download</a></>
          )}
        </p>
      )}
      {size === 'inline' && (
        <button type="button" data-testid="artifact-open" aria-label={`Open ${title}`} className="wk-artifact-catch" onClick={() => morph('pane')} />
      )}
    </section>
  );
}
