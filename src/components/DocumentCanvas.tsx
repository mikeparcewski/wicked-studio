import { useEffect, useMemo, useRef, useState } from 'react';
import { getConversation, getVersions, interactiveDocUrl, listDocs } from '../api/interactive.js';
import { readAnchors, readExports, readSendStates } from '../interactive/threadStopgap.js';
import { useDocsCache } from '../store/docsCache.js';
import { anyModalOpen, useLayerStore } from '../store/layers.js';
import type { DocSummary, ForkResult, VersionManifest } from '../api/interactive.js';
import { useGlobalShortcuts, type ShortcutEntry } from '../hooks/useGlobalShortcuts.js';
import { modePath, versionPath, type Navigate } from '../hooks/useRoute.js';
import { threadKey, useDocThreadStore } from '../store/docThread.js';
import { FeedbackOverlay } from './FeedbackOverlay.js';
import { StripSensor, ThreadDrawer, ThreadToggle, useStripAutoHide } from './ThreadDrawer.js';
import { Failed, Loading, PANEL, S, useLoad } from './SurfaceState.js';
import { VersionStrip } from './VersionStrip.js';

// The Document-mode canvas (DES-MERGE-001 §1.3, §6.3 slice 8, tightened by slices 11+12).
// With a doc in the route we frame it, without one we let the user pick.
//
// The frame carries the RENDERED DOCUMENT, never the interactive app (§5.3) — its src
// is built by the slice-2 client from `apiBase()`, so it resolves onto the page's own
// origin through crew's project-scoped proxy (§7.2).
//
// §5.5, closed: agent-authored HTML is influenced by untrusted input (attached sources,
// scraped pages), so the frame is FULLY sandboxed — `allow-scripts` and nothing else. It
// cannot read `localStorage`, cannot call `/api/v1` with the user's ambient authority,
// and the parent cannot read `contentDocument` back. Everything the overlay needs comes
// over the instrument bridge instead (§7.3: the overlay never shipped without it).
//
// DES-FEEDBACK-001 §7.3 (canvas-first): THE CANVAS OWNS THE VIEWPORT. The thread the
// caller passes as `children` is a right-side DRAWER — closed by default when a doc is
// open, open by default on the picker (its empty state points at the thread) — and the
// version strip floats INSIDE the canvas container, auto-hiding after 3s of idleness
// and waking on bottom-edge proximity. The doc→canvas→thread relationship (tags,
// cross-links, one conversation) is unchanged; only the geometry gave the document
// back its pixels — the operator's round-2 words verbatim.

// ── Doc picker — the mode with no `:docId` in the route ──────────────────────

/** Most-recent first (§6.3). The bridge already sorts; a null `updated_at` sinks. */
function byRecency(a: DocSummary, b: DocSummary): number {
  return (b.updated_at ?? '').localeCompare(a.updated_at ?? '');
}

function DocPicker({ projectId, navigate }: { projectId: string; navigate: Navigate }): React.ReactElement {
  const [docs, failure, retry] = useLoad(
    // The landed list feeds the session doc cache too (slice O §4.2.2).
    () => listDocs(projectId).then((d) => { useDocsCache.getState().deposit(projectId, d); return d; }),
    [projectId],
  );

  if (failure) return <Failed surface="doc" subject="this project's documents" failure={failure} onRetry={retry} />;
  if (docs === null) return <Loading surface="doc" subject="this project's documents" />;

  // §1.4's rule, applied to a surface: an empty region renders an invitation, never a
  // blank. Creation itself is slice 10, so the invitation points at the thread.
  // §2.8's two faces: the invitation and doc names are prose (sans); the
  // kind · version pair on each row is data (mono).
  if (docs.length === 0) {
    return (
      <div data-testid="doc-picker-empty" style={{ padding: '32px', fontFamily: 'var(--font-sans)' }}>
        <div style={PANEL}>
          <h2 style={{ fontSize: 'var(--text-md)', fontWeight: 700, color: S.ink, margin: '0 0 8px' }}>
            No documents in this project yet
          </h2>
          <p style={{ fontSize: 'var(--text-sm)', color: S.muted, margin: 0, lineHeight: 1.5 }}>
            Ask for one in the thread — “make me a deck for the Q3 review”, “write this up as a
            report” — and it appears here, with its versions, as soon as it exists.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '32px', overflowY: 'auto', fontFamily: 'var(--font-sans)' }}>
      <p style={{
        fontSize: 'var(--text-xs)', fontWeight: 600, color: S.label, margin: '0 0 10px',
        textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: 'var(--font-mono)',
      }}>
        Documents
      </p>
      <div data-testid="doc-picker" style={{ ...PANEL, padding: 0, overflow: 'hidden' }}>
        {[...docs].sort(byRecency).map((doc, i, sorted) => (
          <button
            key={doc.name}
            type="button"
            data-testid="doc-picker-row"
            data-doc-id={doc.name}
            onClick={() => navigate(modePath(projectId, 'document', doc.name))}
            style={{
              display: 'flex', alignItems: 'center', gap: '12px', width: '100%', textAlign: 'left',
              background: 'transparent', border: 'none',
              borderBottom: i < sorted.length - 1 ? `1px solid ${S.border}` : 'none',
              color: S.ink, cursor: 'pointer', fontSize: 'var(--text-sm)',
              fontFamily: 'var(--font-sans)', padding: '12px 16px',
            }}
          >
            <span style={{ flex: 1, fontWeight: 500 }}>{doc.name}</span>
            <span style={{ color: S.muted, flexShrink: 0, fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)' }}>
              {doc.kind} · v{doc.head}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Doc frame — the canvas itself ───────────────────────────────────────────

/** The version the route asks for, narrowed to one the manifest actually has (§4.2:
 *  the manifest is authoritative). An unknown `?v` — a stale bookmark, a doc rebuilt
 *  elsewhere — resolves to the head rather than framing a 404. */
function resolveVersion(manifest: VersionManifest, routed: number | null): number {
  return routed !== null && manifest.versions.some((v) => v.version === routed)
    ? routed
    : manifest.head;
}

// ── Version compare (DES-FEEDBACK-002 §7, slice K) ───────────────────────────
//
// Compare is a LENS, not an address (§7.2): the LEFT pane stays the `?v=N`
// navigation exactly as today; the comparand is ephemeral component state, reset
// on exit, never a history entry — so the back button after entering compare
// exits to the prior ROUTE, and deep links never carry a comparand. Both panes
// are two instances of the already-real version URL (`interactiveDocUrl` —
// wire verdict EXISTS, §7.1): zero new routes, zero new requests beyond the
// second pane's own document load.
//
// EC18 as amended (§12.1 + DES-FEEDBACK-003 §8.6): the two panes TOGETHER are
// the canvas — they render inside the same canvas REGION the single iframe
// owned (which ends above the fixed bottom bar), so the >80%-width measurement
// holds for the pane pair, each pane narrower by the operator's explicit trade.

/**
 * §7.2's default comparand: the selected version's PARENT — the manifest's
 * lineage pointer, because "v(N) vs v(N−1)" is lineage-parent, not
 * ordinal-minus-one, and for forked documents those differ. With no usable
 * parent (v1, or a parent the manifest no longer lists) the nearest OTHER
 * version stands in — closest below first, else closest above. Null only when
 * there is nothing else to compare against (§7.5: the v1-only disabled case).
 */
export function defaultComparand(manifest: VersionManifest, selected: number): number | null {
  const entry = manifest.versions.find((v) => v.version === selected);
  const parent = entry?.parent ?? null;
  if (parent !== null && parent !== selected
      && manifest.versions.some((v) => v.version === parent)) {
    return parent;
  }
  const others = manifest.versions.map((v) => v.version).filter((v) => v !== selected);
  if (others.length === 0) return null;
  const below = others.filter((v) => v < selected);
  return below.length > 0 ? Math.max(...below) : Math.min(...others);
}

/** Pane-header dress (§7.4): --text-2xs --font-mono; the selected version's dot
 *  is --accent (the strip's addressed-version grammar), the comparand's muted. */
function PaneHeader({ label, accent }: { label: string; accent: boolean }): React.ReactElement {
  return (
    <span style={{
      alignItems: 'center', color: accent ? 'var(--ink-high)' : 'var(--ink-muted)',
      display: 'inline-flex', flexShrink: 0, gap: '5px',
      fontFamily: 'var(--font-mono)', fontSize: 'var(--text-2xs)', padding: '4px 8px',
    }}>
      <span style={{
        background: accent ? 'var(--accent)' : 'var(--ink-muted)',
        borderRadius: 'var(--radius-full)', display: 'inline-block',
        flexShrink: 0, height: '6px', width: '6px',
      }} />
      {label}
    </span>
  );
}

function DocFrame({
  projectId, docId, version, navigate, threadOpen, onToggleThread, children,
}: {
  projectId: string; docId: string; version: number | null; navigate: Navigate;
  threadOpen: boolean; onToggleThread: () => void;
  children?: React.ReactNode;
}): React.ReactElement {
  // §2.6 rule 3: a landing version re-reads the manifest, so the strip advances and the
  // canvas swaps the moment the stream lands one — the newcomer watches a message produce
  // a version produce a canvas change, left to right, without a reload. (VideoStoryboard
  // already keys its own re-read to the same `landed` fact.)
  const landed = useDocThreadStore((s) => s.landed[threadKey(projectId, docId)]);
  const [fresh, failure, retry] = useLoad(
    () => getVersions(projectId, docId), [projectId, docId, landed],
  );
  // The last good manifest carries the surface through a re-read: `useLoad` nulls its
  // value per run, and a strip that unmounted on every landed version would visibly
  // blink. A doc change REMOUNTS DocFrame (it is keyed on `projectId/docId`), so the
  // ref can never leak one document's lineage into another's.
  const lastManifest = useRef<VersionManifest | null>(null);
  if (fresh !== null) lastManifest.current = fresh;
  const manifest = fresh ?? lastManifest.current;
  const [loaded, setLoaded] = useState(false);
  // The overlay's instrumentation handshake is keyed to LOADS, not to renders: every
  // swapped version is a different document with a different inventory (§4.3 / INV-1
  // guarantees a wid survives WITHIN a document's lineage, not that rects do).
  const [frameEl, setFrameEl] = useState<HTMLIFrameElement | null>(null);
  const [loadNonce, setLoadNonce] = useState(0);
  // The RESOLVED version, computed before the hooks so the loading overlay is
  // keyed to what the frame actually shows. Keying on the routed `version` prop
  // missed every head-follow swap (routed null, head advanced on a landing): the
  // remounted iframe painted blank with no named loading state — and the reverse
  // race left a stale "Loading" overlay over an already-loaded frame.
  const resolvedShown = manifest === null ? null : resolveVersion(manifest, version);
  useEffect(() => { setLoaded(false); }, [projectId, docId, resolvedShown]);
  // §7.3's strip presence: visible now, gone after 3s of idleness, back on proximity.
  // `hold` (J3): a strip control holding an un-acted answer pins it visible.
  const { hidden, wake, hold } = useStripAutoHide();

  // ── Compare state (DES-FEEDBACK-002 §7, slice K) — the lens, not an address ──
  // `cmp` is the comparand version; null = solo canvas. The overlay refinement
  // and its opacity are sub-state, reset with it on exit (§7.2).
  const [cmp, setCmp] = useState<number | null>(null);
  const [overlayOn, setOverlayOn] = useState(false);
  const [overlayPct, setOverlayPct] = useState(50);
  const cmpRef = useRef<number | null>(null);
  cmpRef.current = cmp;
  const exitCompare = (): void => {
    setCmp(null);
    setOverlayOn(false);
    setOverlayPct(50);
  };
  // §7.2 exit paths: ✕ / the strip cluster — and Escape, registered through the
  // ONE shortcut registry (EC21: no stray key listeners; the shared typing-context
  // guard keeps the doc thread's composer keys untouched). The guard yields
  // silently while not comparing, so later Escape entries (the runs sheet) still
  // see the key.
  const compareShortcuts = useMemo<ShortcutEntry[]>(() => [{
    id: 'doc-compare-exit',
    chord: { key: 'escape' },
    group: 'panels',
    description: 'Exit the version compare lens',
    // §7.7 chain: the '?' overlay and any modal close before the compare lens.
    guard: () =>
      cmpRef.current !== null &&
      !useLayerStore.getState().shortcutOverlayOpen &&
      !anyModalOpen(),
    handler: () => {
      setCmp(null);
      setOverlayOn(false);
      setOverlayPct(50);
    },
  }], []);
  useGlobalShortcuts(compareShortcuts);

  const subject = `“${docId}”`;
  // Failure / loading occupy the CANVAS pane only — the thread beside them stays up
  // (§1.2: the one conversation is always present), and with no manifest there is no
  // strip, because a spine with nothing to connect would be decoration.
  if (manifest === null) {
    return (
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <div style={{ display: 'flex', flex: 1, flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
          {failure
            ? <Failed surface="doc" subject={subject} failure={failure} onRetry={retry} />
            : <Loading surface="doc" subject={subject} />}
          {/* No manifest means no strip, so the toggle floats — the conversation must
              stay reachable even (especially) while the bridge is down (§1.2). */}
          {threadOpen ? null : (
            <div style={{ position: 'absolute', right: '14px', top: '14px' }}>
              <ThreadToggle open={false} onToggle={onToggleThread} />
            </div>
          )}
        </div>
        <ThreadDrawer open={threadOpen} onClose={onToggleThread}>{children}</ThreadDrawer>
      </div>
    );
  }

  const shown = resolveVersion(manifest, version);
  // Version-addressed: the VersionStrip swaps this number through the route, nothing else.
  const src = interactiveDocUrl(projectId, docId, shown);

  // The comparand the panes actually use, DERIVED each render: clicking a strip
  // entry while comparing re-points the LEFT pane and keeps the comparand
  // (§7.2) — unless the navigation lands ON the comparand (or a manifest
  // re-read dropped it), where the default (lineage parent) stands in rather
  // than comparing a version with itself.
  const comparand = cmp === null
    ? null
    : cmp !== shown && manifest.versions.some((v) => v.version === cmp)
      ? cmp
      : defaultComparand(manifest, shown);
  const comparing = comparand !== null;
  // §7.5's disabled-with-reason: a v1-only document has nothing to compare.
  const compareDisabledReason =
    manifest.versions.length < 2 ? 'only one version exists' : null;
  const parentOfShown = manifest.versions.find((v) => v.version === shown)?.parent ?? null;

  // A fork is committed by the service, so the strip re-reads the manifest (`retry`
  // is that same one load) and routes to the version the service reports — the UI
  // never invents the new version number or its parent.
  const onForked = (result: ForkResult): void => {
    retry();
    navigate(versionPath(projectId, docId, result.version));
  };

  return (
    <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
      {/* §5.5 token usage kept; §7.3 geometry: the canvas container is the WHOLE
          surface — the strip floats over its bottom edge instead of taking a row,
          so the document, not the chrome, owns the viewport (EC18). */}
      <div
        data-testid="document-canvas"
        style={{
          flex: 1, position: 'relative', overflow: 'hidden',
          border: '1px solid var(--surface-raised)', borderRadius: 'var(--radius-lg)',
          margin: '10px', background: 'var(--surface-base)',
        }}
      >
      {comparing ? (
        // §7.2 the compare lens: the two panes TOGETHER are the canvas (EC18 as
        // amended — same region, same >80% width the single iframe had). Split
        // is the primary; overlay stacks the same two iframes. Both srcs are the
        // already-real version URL — the §7.1 EXISTS verdict, zero new wires.
        <div
          data-testid={overlayOn ? 'compare-overlay' : 'compare-split'}
          style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}
        >
          {overlayOn ? (
            <>
              {/* One header row: which version is on top, and the opacity slider
                  (§7.2: the slider states which version is on top). Slider tokens
                  (§7.4): thumb --accent via accentColor, track --surface-raised. */}
              <div style={{
                alignItems: 'center', display: 'flex', flexShrink: 0, gap: '10px',
                justifyContent: 'center', padding: '0 8px',
              }}>
                <PaneHeader label={`v${shown} (selected, under)`} accent />
                <PaneHeader
                  label={`v${comparand} (${comparand === parentOfShown ? 'parent' : 'vs'}, on top)`}
                  accent={false}
                />
                <input
                  type="range"
                  data-testid="overlay-slider"
                  min={0}
                  max={100}
                  value={overlayPct}
                  onChange={(e) => setOverlayPct(Number(e.target.value))}
                  title={`v${comparand} opacity: ${overlayPct}%`}
                  style={{ accentColor: 'var(--accent)', background: 'var(--surface-raised)', width: '160px' }}
                />
              </div>
              <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
                {/* The under iframe takes no pointer events — they go to the top
                    iframe only (§7.2). Keyed on version: a re-point REPLACES the
                    element, never mutates src (the history rule the solo frame pins). */}
                <iframe
                  key={`under-${shown}`}
                  data-testid="compare-pane"
                  data-version={shown}
                  data-layer="under"
                  src={interactiveDocUrl(projectId, docId, shown)}
                  title={`Document ${docId}, version ${shown}`}
                  sandbox="allow-scripts"
                  style={{ border: 'none', height: '100%', inset: 0, pointerEvents: 'none',
                           position: 'absolute', width: '100%' }}
                />
                <iframe
                  key={`top-${comparand}`}
                  data-testid="compare-pane"
                  data-version={comparand}
                  data-layer="top"
                  src={interactiveDocUrl(projectId, docId, comparand)}
                  title={`Document ${docId}, version ${comparand}`}
                  sandbox="allow-scripts"
                  style={{ border: 'none', height: '100%', inset: 0, opacity: overlayPct / 100,
                           position: 'absolute', width: '100%' }}
                />
              </div>
            </>
          ) : (
            <div data-testid="compare-panes" style={{ display: 'flex', flex: 1, minHeight: 0 }}>
              <div style={{ display: 'flex', flex: 1, flexDirection: 'column', minWidth: 0 }}>
                <PaneHeader label={`v${shown} (selected)`} accent />
                <iframe
                  key={`left-${shown}`}
                  data-testid="compare-pane"
                  data-version={shown}
                  src={interactiveDocUrl(projectId, docId, shown)}
                  title={`Document ${docId}, version ${shown}`}
                  sandbox="allow-scripts"
                  style={{ border: 'none', display: 'block', flex: 1, width: '100%' }}
                />
              </div>
              {/* §7.4 divider between the panes. */}
              <div style={{ background: 'var(--surface-raised)', flexShrink: 0, width: '1px' }} />
              <div style={{ display: 'flex', flex: 1, flexDirection: 'column', minWidth: 0 }}>
                <PaneHeader
                  label={`v${comparand} (${comparand === parentOfShown ? 'parent' : 'vs'})`}
                  accent={false}
                />
                <iframe
                  key={`right-${comparand}`}
                  data-testid="compare-pane"
                  data-version={comparand}
                  src={interactiveDocUrl(projectId, docId, comparand)}
                  title={`Document ${docId}, version ${comparand}`}
                  sandbox="allow-scripts"
                  style={{ border: 'none', display: 'block', flex: 1, width: '100%' }}
                />
              </div>
            </div>
          )}
        </div>
      ) : (
        <>
          <iframe
            // Keyed on the VERSION so a swap REPLACES the element instead of mutating its
            // src. Mutating it navigates the frame, and a frame navigation lands in the
            // joint session history — so Back undid the frame's move rather than the route's
            // (§4.2: the version lives in the URL, and Back must rewind it in one press).
            // A freshly created frame's first load replaces its own entry instead.
            key={shown}
            ref={setFrameEl}
            data-testid="doc-canvas"
            data-doc-id={docId}
            data-version={shown}
            src={src}
            title={`Document ${docId}, version ${shown}`}
            onLoad={() => { setLoaded(true); setLoadNonce((n) => n + 1); }}
            // §5.5, §7.3: `allow-scripts` because documents ARE interactive HTML, and NOTHING
            // else. `allow-same-origin` is not "not yet" here — it is gone, and the overlay
            // below is what made removing it possible. Pinned by a regression test.
            sandbox="allow-scripts"
            style={{ border: 'none', display: 'block', height: '100%', width: '100%' }}
          />
          {/* The frame is in the DOM while it loads, so the named status sits over it. */}
          {loaded ? null : (
            <div style={{ background: 'var(--surface-base)', inset: 0, position: 'absolute' }}>
              <Loading surface="doc" subject={subject} />
            </div>
          )}
          {/* Point-and-comment (§4.3). A document whose bridge never answers leaves this
              disabled-with-a-reason; the canvas above is unaffected either way. */}
          <FeedbackOverlay
            frame={frameEl}
            loadNonce={loadNonce}
            projectId={projectId}
            docId={docId}
            version={shown}
          />
        </>
      )}
      {/* §7.3: while the strip is away, the bottom band listens for the mouse. */}
      <StripSensor hidden={hidden} wake={wake} />
      {/* pointerEvents none on the WRAPPER: the strip re-enables itself while visible;
          while dimmed the box must not shadow the z-1 sensor, or nothing can wake it. */}
      <div style={{ bottom: 0, left: 0, pointerEvents: 'none', position: 'absolute', right: 0, zIndex: 3 }}>
        <VersionStrip
          projectId={projectId}
          docId={docId}
          manifest={manifest}
          selected={shown}
          navigate={navigate}
          onForked={onForked}
          dimmed={hidden}
          onWake={wake}
          onHold={hold}
          trailing={<ThreadToggle open={threadOpen} onToggle={onToggleThread} />}
          // §7 (slice K): the strip WEARS the compare state this frame owns. The
          // strip's auto-hide/wake and the thread drawer are untouched by compare
          // — the panes live inside the same canvas container the sensor guards.
          compare={{
            active: comparing,
            comparand,
            disabledReason: compareDisabledReason,
            overlay: overlayOn,
            onToggle: () => {
              if (comparing) { exitCompare(); return; }
              const def = defaultComparand(manifest, shown);
              if (def !== null) setCmp(def);
            },
            onComparand: setCmp,
            onOverlay: setOverlayOn,
            onExit: exitCompare,
          }}
        />
      </div>
      </div>
      {/* §7.3: the thread is a DRAWER — a flex sibling, so opening it reflows the
          canvas rather than covering it. Closed by default: the canvas is full-width
          on first visit, and the conversation is one click away, never lost. */}
      <ThreadDrawer open={threadOpen} onClose={onToggleThread}>{children}</ThreadDrawer>
    </div>
  );
}

export interface DocumentCanvasProps {
  projectId: string;
  /** `null` on `/p/:projectId/document` — no doc chosen yet, so the picker shows. */
  docId: string | null;
  /** The routed `?v=N` (slice 9); `null` addresses the manifest head. */
  version?: number | null;
  navigate: Navigate;
  /** The thread pane (DES-UXFIX-001 §2.6): rendered in the top row beside the canvas so
   *  the version strip spans beneath both. Canvas and thread stay visual siblings — this
   *  slot exists only so ONE component owns where the spine sits relative to the panes. */
  children?: React.ReactNode;
}

export function DocumentCanvas({
  projectId, docId, version = null, navigate, children,
}: DocumentCanvasProps): React.ReactElement {
  // §6.3 rehydration (DES-UX-001 slice T, BRIDGE-UX-1 probe 2): opening a doc reads
  // its announce history from `GET /d/:doc/api/conversation` — the ONE sanctioned
  // doc-open fetch this slice adds — so the thread's TEXT survives a reload from the
  // wire, not from tab memory. It fires on DOC OPEN (here, not in the thread pane):
  // the drawer mounts/unmounts on toggle, and toggling must stay a zero-request
  // gesture. Guarded once per thread per session; a projection that already holds
  // live messages is kept verbatim (`hydrate` only fills an empty thread). A bridge
  // without the route — or a dead one — degrades to the live-only projection.
  useEffect(() => {
    if (docId === null) return;
    const key = threadKey(projectId, docId);
    const store = useDocThreadStore.getState();
    if (store.hydrated[key] === true) return;
    let cancelled = false;
    getConversation(projectId, docId)
      .then((entries) => {
        if (!cancelled) {
          // Anchors, unresolved sends and export entries all ride the same
          // session stopgap (round-3 J3 finding 4 + the export-persistence minor).
          useDocThreadStore.getState().hydrate(
            key, entries, readAnchors(key), readSendStates(key), readExports(key));
        }
      })
      .catch(() => {
        if (!cancelled) {
          useDocThreadStore.getState().hydrate(key, [], [], readSendStates(key), readExports(key));
        }
      });
    return () => { cancelled = true; };
  }, [projectId, docId]);

  // §7.3: the drawer's state lives on the Document surface. Default CLOSED when a doc
  // is open (the canvas is full-width on first visit); default OPEN on the picker,
  // whose empty state points at the thread — a pointer at a hidden pane would be a
  // dead end. The state survives picker→doc navigation, so a conversation that just
  // created a document stays on screen while its first version lands (W3).
  const [threadOpen, setThreadOpen] = useState(docId === null);
  const toggleThread = (): void => { setThreadOpen((v) => !v); };
  return (
    <div style={{ display: 'flex', flex: 1, flexDirection: 'column', overflow: 'hidden' }}>
      {docId === null
        ? (
          // No doc means no versions, so there is no spine row — the picker's empty
          // state points at the thread instead (§2.6 rule 5, W3 step 2).
          <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
            <div style={{ display: 'flex', flex: 1, flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
              <DocPicker projectId={projectId} navigate={navigate} />
              {/* The picker has no strip to host the toggle, so a closed drawer gets
                  its reopen affordance here — same testid, never both mounted. */}
              {threadOpen ? null : (
                <div style={{ position: 'absolute', right: '14px', top: '14px' }}>
                  <ThreadToggle open={false} onToggle={toggleThread} />
                </div>
              )}
            </div>
            <ThreadDrawer open={threadOpen} onClose={toggleThread}>{children}</ThreadDrawer>
          </div>
        )
        : (
          <DocFrame
            key={`${projectId}/${docId}`}
            projectId={projectId}
            docId={docId}
            version={version}
            navigate={navigate}
            threadOpen={threadOpen}
            onToggleThread={toggleThread}
          >
            {children}
          </DocFrame>
        )}
    </div>
  );
}
