import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { grow, shrink, type ArtifactSize, type EditorKind } from '../../board/artifactMorph.js';
import { artifactSizeOf, artifactSizeWrites, registerArtifact, setArtifactSize, topmostArtifact, useArtifactSizes } from '../../store/artifactSizes.js';
import { useArtifactAddress } from './ArtifactAddress.js';
import { ArtifactVersions, lensVersion, useVersionList, VersionLens } from './ArtifactVersions.js';
import { NoEditorPage, PluginArtifact } from './PluginArtifact.js';
import { useEditorFor, useEditors } from '../../store/editors.js';
import { PluginCard } from '../editorHost/PluginCard.js';
import { hasAdapter, type AdapterSource } from '../../editors/hostApi.js';
// The adapters register on import; the routing above asks which exist.
import '../../editors/adapters/index.js';

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
 * Since protocol 2 this section is only the fallback, the same for every kind: a protocol-1 plugin that claims the
 * kind ({@link PluginArtifact}), a slot body no plugin claims yet, or the artifact as served, read-only, when no
 * editor claims it (DES-EDITOR-PLUGINS-001 §3.1). The per-kind code is gone (the document editor, its coverage
 * column, the deck review rail, the Demo video button, the per-kind Export table): those live in wicked-doc,
 * wicked-deck and the host's review capability, and Export is the adapter's.
 */


type ArtifactMorphProps = {
  artifactKey: string;
  title: string;
  projectId: string;
  docId: string;
  composerKey: string;
  kind?: EditorKind;
  repoId?: string | null;
  slot?: ArtifactSlot;
  /** Who produced the version shown (H3 passes the seat), for the card's turn line. */
  producedBy?: string | null;
};

/**
 * H2 (DES-EDITOR-PLUGIN-CONTRACT-001 §7; HOST-API §2): an artifact whose kind an installed editor plugin claims is
 * rendered by the host from the plugin's declaration — {@link PluginCard} (card, Options group, full screen) — when
 * the plugin speaks protocol 2. A protocol-1 plugin renders exactly as today. Only a kind no plugin claims yet (a `document` until `wicked-doc`, H4b)
 * and the slot bodies (walkthrough, demo video, plan, until H6) keep the morphing section below.
 */
/** The data plane a slot body lives in (HOST-API §2): a walkthrough's recording, a demo video's cut. */
const SLOT_SOURCE: Readonly<Record<ArtifactSlot['kind'], AdapterSource | null>> = { walkthrough: 'walkthrough', 'demo-video': 'demo', plan: null };

export function ArtifactMorph(props: ArtifactMorphProps): React.ReactElement {
  // A slot (walkthrough, demo video) is claimed by its slot kind; anything else by the document's kind.
  const kind: string = props.slot?.kind ?? props.kind ?? 'page';
  const source: AdapterSource | null = props.slot === undefined ? 'interactive-doc' : SLOT_SOURCE[props.slot.kind];
  const editor = useEditorFor(kind);
  // A protocol-1 plugin keeps rendering exactly as today (DES §7.1, codex h2a-r1 P2); a plugin that speaks 2 is drawn
  // from its declaration (and falls back to the v1 mapping inside the card if its declaration is refused).
  // While the registry is read, nothing that registers or sizes the artifact mounts: the legacy section would take a
  // deep link's size and, on unmounting, fold it back (a ?size=full address then never opened full; desk_artifact_address).
  if (source !== null && hasAdapter(source) && editor === undefined) {
    return <section data-testid="artifact-loading" aria-busy="true" aria-label={props.title} className="wk-pcard wk-pcard--opening" />;
  }
  if (source !== null && hasAdapter(source) && editor !== null && editor !== undefined && editor.protocol.includes(2)) {
    // The run is the key's own prefix (`artifactKey(projectId, docId, runId)` = `<runId>:<projectId>/<docId>`).
    const runId = props.artifactKey.includes(':') ? props.artifactKey.slice(0, props.artifactKey.indexOf(':')) : undefined;
    return (
      <PluginCard
        binding={{ artifactKey: props.artifactKey, title: props.title, kind, source, projectId: props.projectId, docId: props.docId, ...(runId !== undefined ? { runId } : {}), composerKey: props.composerKey, repoId: props.repoId ?? null, producedBy: props.producedBy ?? null }}
        editor={editor}
      />
    );
  }
  return <MorphingArtifact {...props} />;
}

function MorphingArtifact({ artifactKey, title, projectId, docId, composerKey, kind = 'page', slot }: {
  artifactKey: string;
  title: string;
  projectId: string;
  docId: string;
  composerKey: string;
  /** Which editor the document opens in (S9) — from the style it was created with. */
  kind?: EditorKind;
  /** WT-U1: what the slot hosts instead of the page editor (see {@link ArtifactSlot}). */
  slot?: ArtifactSlot;
}): React.ReactElement {
  const size = useArtifactSizes((s) => artifactSizeOf(s, artifactKey));
  const topmost = useArtifactSizes((s) => topmostArtifact(s) === artifactKey);
  const [head, setHead] = useState<number | null>(null);
  // The protocol-1 plugin that claims this kind, if any (`undefined` while the registry is read; `null` = none).
  const v1Editor = useEditorFor(kind);
  const noEditorReason = useEditors((s) => s.reason);
  const shrinkBtn = useRef<HTMLButtonElement | null>(null);
  const growBtn = useRef<HTMLButtonElement | null>(null);



  // S16a-4a: the morph writes the address too (grow pushes, shrink goes Back or replaces) — Esc and
  // the buttons share this one path.
  const address = useArtifactAddress();
  const writeAddress = address?.write ?? null;
  useEffect(() => registerArtifact(artifactKey), [artifactKey]);
  const morph = useCallback((to: ArtifactSize): void => {
    const from = artifactSizeOf(useArtifactSizes.getState(), artifactKey);
    if (from === to) return;
    // A view transition runs its callback on a later frame: if any size write lands first (the
    // address writing this same step, or a Back already shrinking it), this apply is stale.
    const writes = artifactSizeWrites();
    const apply = (): void => {
      if (artifactSizeWrites() !== writes) return;
      flushSync(() => setArtifactSize(artifactKey, to));
    };
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    type Transition = { ready?: Promise<unknown>; finished?: Promise<unknown>; updateCallbackDone?: Promise<unknown> };
    const vt = (document as Document & { startViewTransition?: (cb: () => void) => Transition | undefined }).startViewTransition;
    if (!reduced && typeof vt === 'function') {
      // A step that lands while the previous morph is still animating SKIPS that transition (the
      // browser rejects its promises with "Transition was skipped"): expected, never a page error.
      const t = vt.call(document, apply);
      for (const p of [t?.ready, t?.finished, t?.updateCallbackDone]) p?.catch(() => undefined);
    } else apply();
    writeAddress?.(artifactKey, from, to);
  }, [artifactKey, writeAddress]);

  // S16a-4b: at full size a page / document / deck lists its versions; `?v=N` on the address is a
  // read-only lens on one (touch-editing is off while it is shown).
  const editorKind = slot === undefined;
  const versionsOn = editorKind && size === 'full';
  const versions = useVersionList(projectId, docId, head, versionsOn);
  // With no address to write (a document opened on the Made list, `MadeOpen`), the lens is this
  // artifact's own state, so picking a version still shows it (codex r1, editors-document).
  const [localLens, setLocalLens] = useState<number | null>(null);
  const pinned = address === null ? localLens : address.routeKey === artifactKey ? address.routeVersion : null;
  const lens = versionsOn ? lensVersion(pinned, head, versions) : null;
  const look = (v: number | null): void => { if (address === null) setLocalLens(v); else address.pickVersion(artifactKey, v, 'push'); };

  // Esc shrinks one step (rule 1) — the topmost open artifact only, and not while something inside
  // it is consuming it (a pick, an edit field), which stops the event before it reaches the document.
  // Known limit: a key pressed with focus INSIDE the sandboxed frame stays there; the ⤡ / × buttons
  // and a pick (which moves focus out) are the way back.
  // studio#509: the native `<video controls>` with the PLAYER focused is not such a limit — the
  // artifact also listens in the capture phase on its own element and shrinks on Esc from it; the
  // browser's own fullscreen is left alone (Esc leaves it first). With the focus on one of the
  // controls' own buttons (Tab into them) Chromium delivers no key to the page at all — the player's
  // `focusPlayerOnEntry` keeps a keyboard entry on the player itself for that reason.
  const section = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (size === 'inline' || !topmost) return undefined;
    const wants = (e: KeyboardEvent): boolean => {
      if (e.key !== 'Escape' || e.defaultPrevented) return false;
      const t = e.target as HTMLElement | null;
      if (t !== null && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return false;
      return true;
    };
    // A key on THIS artifact's own player (another artifact's player is the document's to answer).
    const fromMyPlayer = (e: KeyboardEvent): boolean => {
      const t = e.target as HTMLElement | null;
      return t !== null && typeof t.closest === 'function' && t.closest('video, audio') !== null
        && section.current !== null && section.current.contains(t);
    };
    // The document (bubble): every key that gets there — except from this artifact's player, which
    // the capture listener below already answered.
    const onKey = (e: KeyboardEvent): void => {
      if (!wants(e) || fromMyPlayer(e)) return;
      morph(shrink(size));
    };
    // The artifact (capture): a key on its player, before the player's controls take it.
    const onPlayerKey = (e: KeyboardEvent): void => {
      if (!wants(e) || !fromMyPlayer(e)) return;
      if (document.fullscreenElement) return;
      e.preventDefault();
      morph(shrink(size));
    };
    const el = section.current;
    document.addEventListener('keydown', onKey);
    el?.addEventListener('keydown', onPlayerKey, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      el?.removeEventListener('keydown', onPlayerKey, true);
    };
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
      ref={section}
      data-testid="artifact"
      data-object={`artifact:${artifactKey}`}
      data-size={size}
      data-doc={docId}
      data-kind={slot?.kind ?? kind}
      aria-label={`${title} — ${size === 'inline' ? 'preview' : size === 'pane' ? 'open beside the thread' : 'full screen'}`}
      className={`wk-artifact wk-artifact--${size}${versionsOn ? ' wk-artifact--versions' : ''}`}
      style={{ viewTransitionName: `artifact-${slug}` } as React.CSSProperties}
    >
      <header data-testid="artifact-head" className="wk-artifact-head">
        <span className="wk-artifact-title">{title}</span>
        <span data-testid="artifact-version">{lens !== null ? `looking at version ${lens}` : head === null ? '' : versionsOn ? `version ${head} (working)` : `version ${head}`}</span>
        {size !== 'full' && (
          <button ref={growBtn} type="button" data-testid="artifact-grow" aria-label={size === 'inline' ? 'Open beside the thread' : 'Full screen'} title={size === 'inline' ? 'Open' : 'Full screen'} onClick={() => morph(grow(size))} className="wk-artifact-btn">⤢</button>
        )}
        {size !== 'inline' && (
          <button ref={shrinkBtn} type="button" data-testid="artifact-shrink" aria-label={size === 'full' ? 'Back to the pane' : 'Back to the thread'} title="Esc" onClick={() => morph(shrink(size))} className="wk-artifact-btn">{size === 'full' ? '⤡' : '×'}</button>
        )}
      </header>
      {lens !== null
        ? <VersionLens projectId={projectId} docId={docId} version={lens} onBack={() => look(null)} />
        : slot !== undefined
        ? slot.body(size, morph)
        : v1Editor === undefined
          ? <div className="wk-artifact-body" data-testid="artifact-opening" />
          : v1Editor === null
            // No plugin claims the kind: the artifact as served, read-only, and the sentence says so (EP §3.1).
            ? <NoEditorPage projectId={projectId} docId={docId} size={size} reason={noEditorReason} onHead={setHead} what={`${kind}s`} />
            : <PluginArtifact projectId={projectId} docId={docId} title={title} composerKey={composerKey} size={size} morph={morph} editor={v1Editor} onHead={setHead} kind={kind} />}
      {versionsOn && (
        <ArtifactVersions
          projectId={projectId}
          docId={docId}
          head={head}
          list={versions}
          lens={lens}
          onLook={look}
          onRestored={(newHead) => { setHead(newHead); if (address === null) setLocalLens(null); else if (address.routeKey === artifactKey) address.pickVersion(artifactKey, null, 'replace'); }}
        />
      )}
      {size === 'inline' && (
        <button type="button" data-testid="artifact-open" aria-label={`Open ${title}`} className="wk-artifact-catch" onClick={() => morph('pane')} />
      )}
    </section>
  );
}
