import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { grow, shrink, type ArtifactSize } from '../../board/artifactMorph.js';
import { artifactSizeOf, setArtifactSize, topmostArtifact, useArtifactSizes } from '../../store/artifactSizes.js';
import { PageEditor } from './PageEditor.js';

/**
 * S8 — the morphing artifact (DESIGN-interaction rule 1: the object is the control). ONE element
 * that is the page's live preview in the thread, grows to a pane beside it on a click and to full
 * screen on ⤢, and shrinks one step on Esc — never re-parented between sizes (DOC-1 / EP-D2): the
 * same `<section>` changes class, so the frame inside keeps its state and the shared-element morph
 * (View Transitions where the browser has them; nothing animates under reduced motion) is honest.
 *
 * The kind slot: a `doc` artifact hosts the built-in {@link PageEditor}; EP-P2 lets it host a
 * `PluginHost` for the same kind behind the same chrome.
 */
export function ArtifactMorph({ artifactKey, title, projectId, docId, composerKey }: {
  artifactKey: string;
  title: string;
  projectId: string;
  docId: string;
  composerKey: string;
}): React.ReactElement {
  const size = useArtifactSizes((s) => artifactSizeOf(s, artifactKey));
  const topmost = useArtifactSizes((s) => topmostArtifact(s) === artifactKey);
  const [head, setHead] = useState<number | null>(null);
  const shrinkBtn = useRef<HTMLButtonElement | null>(null);
  const growBtn = useRef<HTMLButtonElement | null>(null);

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
      data-kind="doc"
      aria-label={`${title} — ${size === 'inline' ? 'preview' : size === 'pane' ? 'open beside the thread' : 'full screen'}`}
      className={`wk-artifact wk-artifact--${size}`}
      style={{ viewTransitionName: `artifact-${slug}` } as React.CSSProperties}
    >
      <header className="wk-artifact-head">
        <span className="wk-artifact-title">{title}</span>
        <span data-testid="artifact-version">{head === null ? '' : `version ${head}`}</span>
        {size !== 'full' && (
          <button ref={growBtn} type="button" data-testid="artifact-grow" aria-label={size === 'inline' ? 'Open beside the thread' : 'Full screen'} title={size === 'inline' ? 'Open' : 'Full screen'} onClick={() => morph(grow(size))} className="wk-artifact-btn">⤢</button>
        )}
        {size !== 'inline' && (
          <button ref={shrinkBtn} type="button" data-testid="artifact-shrink" aria-label={size === 'full' ? 'Back to the pane' : 'Back to the thread'} title="Esc" onClick={() => morph(shrink(size))} className="wk-artifact-btn">{size === 'full' ? '⤡' : '×'}</button>
        )}
      </header>
      <PageEditor projectId={projectId} docId={docId} composerKey={composerKey} size={size} onHead={setHead} />
      {size === 'inline' && (
        <button type="button" data-testid="artifact-open" aria-label={`Open ${title}`} className="wk-artifact-catch" onClick={() => morph('pane')} />
      )}
    </section>
  );
}
