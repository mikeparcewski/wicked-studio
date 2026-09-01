import { useEffect, useMemo, useRef, useState } from 'react';
import { getConversation, getVersions, interactiveDocUrl, interactiveUrl, listDemos } from '../api/interactive.js';
import type { DocSummary, ForkResult, VersionManifest } from '../api/interactive.js';
import { recordFromThread } from '../interactive/demoWire.js';
import { instrumentDemoHtml, subjectsFromBrief } from '../interactive/demoHtml.js';
import { readAnchors, readExports, readSendStates } from '../interactive/threadStopgap.js';
import { modePath, versionPath, type Navigate } from '../hooks/useRoute.js';
import { threadKey, useDocThreadStore, type DocMsg } from '../store/docThread.js';
import { DeleteDocButton } from './DocDelete.js';
import { defaultComparand } from './DocumentCanvas.js';
import { DocPanel, type DocPanelTab } from './DocPanel.js';
import { StripSensor, useStripAutoHide } from './ThreadDrawer.js';
import { Failed, Loading, PANEL, S, useLoad } from './SurfaceState.js';
import { VersionStrip } from './VersionStrip.js';

// Video mode's surface — REWIRED by DES-FEEDBACK-001 §7.2/§7.4, brought up to the
// Document-surface overhaul by the VIDEO-FB round (the cold-operator findings):
//
//   1. PLAYBACK: the bridge's own storyboard HTML (demo.js `storyboard()`) writes
//      its recording/thumbnail URLs ROOT-ABSOLUTE (`/d/<slug>/api/demo/...`) — on
//      the app's origin those fall through to the SPA fallback and answer HTML
//      (MediaError 4). The frame now renders via `srcdoc` with the URLs re-homed
//      onto the project mount (instrumentDemoHtml — the #116 fetch-adjust-srcdoc
//      pattern, minus the click-preempting bridge a player must not have).
//   2. RECORD is a REAL control on the surface, wired to `requestRecord`
//      (`wicked.interactive.demo.requested` — the wire the bridge's workspace
//      materializes), answering AT the click site (EC37) with honest copy: it
//      re-records the authored steps; it does not change them.
//   3. PARITY with the Document surface: the tabbed right panel (Chat | Compare |
//      Theme | Versions) with its own expand/collapse, the slim versions-only
//      band, thread rehydration on reload (the same conversation read Document
//      mode does), and the compare lens.
//
// The corrected §7.4 architecture is unchanged underneath: the storyboard IS the
// demo's VERSION HTML at `GET /d/:demoId/doc/:version`, addressed by the same
// version strip, one thread per artifact.

// ── Demo picker — the mode with no `:demoId` in the route ────────────────────

/** Most-recent first, same rule as the slice-8 doc picker. A null `updated_at` sinks. */
function byRecency(a: DocSummary, b: DocSummary): number {
  return (b.updated_at ?? '').localeCompare(a.updated_at ?? '');
}

function DemoPicker({ projectId, navigate }: { projectId: string; navigate: Navigate }): React.ReactElement {
  const [demos, failure, retry] = useLoad(() => listDemos(projectId), [projectId]);

  if (failure) return <Failed surface="video" subject="this project's demos" failure={failure} onRetry={retry} />;
  if (demos === null) return <Loading surface="video" subject="this project's demos" />;

  // An empty region renders an invitation, never a blank (§1.4). Authoring a demo is
  // the governed run's job (CREW-UX-9), so the invitation points at the thread.
  if (demos.length === 0) {
    return (
      <div data-testid="demo-picker-empty" style={{ padding: '32px', fontFamily: 'var(--font-sans)' }}>
        <div style={PANEL}>
          <h2 style={{ fontSize: 'var(--text-md)', fontWeight: 700, color: S.ink, margin: '0 0 8px' }}>
            No demos in this project yet
          </h2>
          <p style={{ fontSize: 'var(--text-sm)', color: S.muted, margin: 0, lineHeight: 1.5 }}>
            A demo is a set of steps authored into a spec and recorded by the service in a
            real browser. Describe one in the thread — “a demo of the checkout flow” — and
            it appears here as a storyboard with its player as soon as the spec exists.
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
        Demos
      </p>
      <div data-testid="demo-picker" style={{ ...PANEL, padding: 0, overflow: 'hidden' }}>
        {[...demos].sort(byRecency).map((demo, i, sorted) => (
          // Wrapper row, same shape as the doc picker (studio#119): the nav
          // button keeps its testid; the confirm-gated delete sits at the end.
          <div
            key={demo.name}
            style={{
              alignItems: 'center', display: 'flex',
              borderBottom: i < sorted.length - 1 ? `1px solid ${S.border}` : 'none',
            }}
          >
            <button
              type="button"
              data-testid="demo-picker-row"
              data-demo-id={demo.name}
              onClick={() => navigate(modePath(projectId, 'video', demo.name))}
              style={{
                display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0,
                textAlign: 'left', background: 'transparent', border: 'none',
                color: S.ink, cursor: 'pointer', fontSize: 'var(--text-sm)',
                fontFamily: 'var(--font-sans)', padding: '12px 16px',
              }}
            >
              <span style={{ flex: 1, fontWeight: 500 }}>{demo.name}</span>
              <span style={{ color: S.muted, flexShrink: 0, fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)' }}>
                v{demo.head}
              </span>
            </button>
            <DeleteDocButton
              projectId={projectId}
              docId={demo.name}
              subject="demo"
              variant="row"
              onDeleted={retry}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Storyboard preparation (VIDEO-FB finding 1) ───────────────────────────────

const EMPTY_MSGS: DocMsg[] = [];

/** The AUTHORED step subjects, from the thread's newest spec-shaped message —
 *  what stands in for junk chapter labels (`repairChapterLabels`). */
function useStepSubjects(projectId: string, demoId: string): string[] {
  const msgs = useDocThreadStore((s) => s.messages[threadKey(projectId, demoId)] ?? EMPTY_MSGS);
  return useMemo(() => {
    for (let i = msgs.length - 1; i >= 0; i -= 1) {
      const m = msgs[i];
      if (m !== undefined && m.kind === 'user') {
        const subjects = subjectsFromBrief(m.text);
        if (subjects.length > 0) return subjects;
      }
    }
    return [];
  }, [msgs]);
}

/**
 * Fetch one storyboard version's HTML (same origin, same bytes the iframe was
 * about to load) so it can be re-homed for the sandboxed frame. `html: null`
 * means the fetch failed — the caller degrades to the plain `src` path, the
 * pre-restore posture (broken media, but a named, retryable surface above it).
 */
function useStoryboardHtml(
  projectId: string, demoId: string, version: number | null,
): { version: number; html: string | null } | null {
  const [fetched, setFetched] = useState<{ version: number; html: string | null } | null>(null);
  useEffect(() => {
    if (version === null) return undefined;
    let cancelled = false;
    setFetched(null);
    const url = interactiveDocUrl(projectId, demoId, version);
    fetch(url)
      .then((res) => (res.ok ? res.text() : Promise.reject(new Error(String(res.status)))))
      .then((html) => { if (!cancelled) setFetched({ version, html }); })
      .catch(() => { if (!cancelled) setFetched({ version, html: null }); })
      ;
    return () => { cancelled = true; };
  }, [projectId, demoId, version]);
  return fetched;
}

/** One prepared storyboard pane — the compare lens reuses it for both sides. */
function DemoPane({
  projectId, demoId, version, subjects, layer, style,
}: {
  projectId: string; demoId: string; version: number; subjects: string[];
  layer?: string; style: React.CSSProperties;
}): React.ReactElement {
  const fetched = useStoryboardHtml(projectId, demoId, version);
  const src = interactiveDocUrl(projectId, demoId, version);
  const srcDoc = useMemo(() => {
    if (fetched === null || fetched.version !== version || fetched.html === null) return null;
    return instrumentDemoHtml(
      fetched.html,
      new URL(src, window.location.href).href,
      interactiveUrl(projectId, '/').replace(/\/+$/, ''),
      subjects,
    );
  }, [fetched, version, src, projectId, subjects]);
  if (fetched === null) return <div data-testid="compare-pane-loading" style={style} />;
  return (
    <iframe
      key={`${layer ?? 'pane'}-${version}`}
      data-testid="compare-pane"
      data-version={version}
      {...(layer === undefined ? {} : { 'data-layer': layer })}
      src={src}
      {...(srcDoc === null ? {} : { srcDoc })}
      title={`Demo ${demoId}, version ${version}`}
      sandbox="allow-scripts"
      style={style}
    />
  );
}

// ── The demo surface: storyboard HTML in an iframe, same shape as Document ───

/** The routed `?v`, narrowed to one the manifest actually has — else the head. */
function resolveVersion(manifest: VersionManifest, routed: number | null): number {
  return routed !== null && manifest.versions.some((v) => v.version === routed)
    ? routed
    : manifest.head;
}

/** The right panel's lifted state — owned by VideoStoryboard so it survives
 *  picker→demo navigation AND a DemoSurface remount on demo change. */
interface PanelState {
  open: boolean;
  tab: DocPanelTab;
  onExpand: (tab?: DocPanelTab) => void;
  onCollapse: () => void;
  onTab: (tab: DocPanelTab) => void;
}

/** Pane-header dress — the Document compare lens's, verbatim (§7.4). */
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

function DemoSurface({
  projectId, demoId, version, navigate, panel, children,
}: {
  projectId: string; demoId: string; version: number | null; navigate: Navigate;
  panel: PanelState;
  children?: React.ReactNode;
}): React.ReactElement {
  // A landed version (a re-record, a re-authored spec) re-reads the manifest, so the
  // strip advances and the frame swaps the moment the stream lands one — same rule as
  // Document mode's canvas.
  const key = threadKey(projectId, demoId);
  const landed = useDocThreadStore((s) => s.landed[key]);
  const genState = useDocThreadStore((s) => s.genState[key] ?? 'terminal');
  const [fresh, failure, retry] = useLoad(
    () => getVersions(projectId, demoId), [projectId, demoId, landed],
  );
  // The last good manifest carries the surface through a re-read (the strip must not
  // blink on every landed version). A demo change REMOUNTS DemoSurface (keyed).
  const lastManifest = useRef<VersionManifest | null>(null);
  if (fresh !== null) lastManifest.current = fresh;
  const manifest = fresh ?? lastManifest.current;
  const [loaded, setLoaded] = useState(false);
  const { hidden, wake } = useStripAutoHide();

  const resolvedShown = manifest === null ? null : resolveVersion(manifest, version);
  useEffect(() => { setLoaded(false); }, [projectId, demoId, resolvedShown]);

  // ── VIDEO-FB finding 1: the storyboard, re-homed for the sandboxed frame ────
  const subjects = useStepSubjects(projectId, demoId);
  const fetched = useStoryboardHtml(projectId, demoId, resolvedShown);
  const srcForShown = resolvedShown === null
    ? null : interactiveDocUrl(projectId, demoId, resolvedShown);
  const prepared = useMemo(() => {
    if (fetched === null || srcForShown === null) return null;
    return {
      version: fetched.version,
      srcDoc: fetched.html === null
        ? null
        : instrumentDemoHtml(
            fetched.html,
            new URL(srcForShown, window.location.href).href,
            interactiveUrl(projectId, '/').replace(/\/+$/, ''),
            subjects,
          ),
    };
  }, [fetched, srcForShown, projectId, subjects]);

  // ── The recording download (VIDEO-FB finding 3): offered only when PROVEN ───
  // The shown version's webm is probed with a 1-byte Range GET — `HEAD` would
  // false-positive on any HTML fallback, and offering a download on faith is a
  // dead anchor. Re-probed when a landing advances the manifest.
  const [recording, setRecording] = useState<{ version: number; href: string } | null>(null);
  useEffect(() => {
    if (resolvedShown === null) return undefined;
    const href = interactiveUrl(
      projectId, `/d/${encodeURIComponent(demoId)}/api/demo/recording/_v${resolvedShown}.webm`);
    let cancelled = false;
    setRecording(null);
    fetch(href, { headers: { Range: 'bytes=0-0' } })
      .then((res) => {
        // The probe wants the HEADERS, never the bytes. crew's proxy honours the
        // Range (206, content-length 1), but a server that IGNORES it answers 200
        // with the whole recording — cancelling the stream means a long demo is
        // never silently downloaded just to light up a download button.
        void res.body?.cancel().catch(() => {});
        const type = res.headers.get('content-type') ?? '';
        if (!cancelled && res.ok && type.startsWith('video/')) {
          setRecording({ version: resolvedShown, href });
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [projectId, demoId, resolvedShown, landed]);

  // ── VIDEO-FB finding 2: Record, a REAL control answering at the click site ──
  // `recBusy` is the HTTP round-trip; `recWaiting` holds until the thread's
  // fold sees the run resolve (a landing, a completion, or the honesty budget's
  // own machinery downstream). EC37: the button IS the pending surface.
  const [recBusy, setRecBusy] = useState(false);
  const [recWaiting, setRecWaiting] = useState(false);
  const [recError, setRecError] = useState<string | null>(null);
  useEffect(() => {
    if (recWaiting && genState !== 'generating') setRecWaiting(false);
  }, [recWaiting, genState]);
  function record(): void {
    if (recBusy || recWaiting) return;
    setRecBusy(true);
    setRecError(null);
    void recordFromThread({ projectId, demoId, ask: `Record “${demoId}”.` })
      .then(() => { setRecWaiting(true); })
      .catch((e: unknown) => { setRecError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { setRecBusy(false); });
  }

  // ── Compare lens (Document's §7 grammar, on the storyboard) ─────────────────
  const [cmp, setCmp] = useState<number | null>(null);
  const [overlayOn, setOverlayOn] = useState(false);
  const [overlayPct, setOverlayPct] = useState(50);
  const exitCompare = (): void => {
    setCmp(null);
    setOverlayOn(false);
    setOverlayPct(50);
  };

  const subject = `“${demoId}”`;
  if (manifest === null) {
    return (
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <div style={{ display: 'flex', flex: 1, flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
          {failure
            ? <Failed surface="video" subject={subject} failure={failure} onRetry={retry} />
            : <Loading surface="video" subject={subject} />}
        </div>
        {/* The panel (its collapsed rail included) is ALWAYS on screen, so the
            conversation stays reachable even — especially — while the bridge is
            down (§1.2). Demo-scoped tabs disable themselves without a manifest. */}
        <DocPanel {...panel} doc={null} subject="demo">{children}</DocPanel>
      </div>
    );
  }

  const shown = resolveVersion(manifest, version);
  const src = interactiveDocUrl(projectId, demoId, shown);

  const comparand = cmp === null
    ? null
    : cmp !== shown && manifest.versions.some((v) => v.version === cmp)
      ? cmp
      : defaultComparand(manifest, shown);
  const comparing = comparand !== null;
  const compareDisabledReason =
    manifest.versions.length < 2 ? 'only one version exists' : null;
  const parentOfShown = manifest.versions.find((v) => v.version === shown)?.parent ?? null;

  const onForked = (result: ForkResult): void => {
    retry();
    navigate(versionPath(projectId, demoId, result.version, 'video'));
  };

  const paneStyle: React.CSSProperties = {
    border: 'none', display: 'block', flex: 1, width: '100%',
  };

  return (
    <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
      <div
        data-testid="video-canvas"
        // §5.6: the player container wears the same framing as Document's canvas.
        style={{
          flex: 1, position: 'relative', overflow: 'hidden',
          border: '1px solid var(--surface-raised)', borderRadius: 'var(--radius-lg)',
          margin: '10px', background: 'var(--surface-base)',
        }}
      >
        {comparing ? (
          <div
            data-testid={overlayOn ? 'compare-overlay' : 'compare-split'}
            style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}
          >
            {overlayOn ? (
              <>
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
                  <DemoPane
                    projectId={projectId} demoId={demoId} version={shown} subjects={subjects}
                    layer="under"
                    style={{ border: 'none', height: '100%', inset: 0, pointerEvents: 'none',
                             position: 'absolute', width: '100%' }}
                  />
                  <DemoPane
                    projectId={projectId} demoId={demoId} version={comparand} subjects={subjects}
                    layer="top"
                    style={{ border: 'none', height: '100%', inset: 0, opacity: overlayPct / 100,
                             position: 'absolute', width: '100%' }}
                  />
                </div>
              </>
            ) : (
              <div data-testid="compare-panes" style={{ display: 'flex', flex: 1, minHeight: 0 }}>
                <div style={{ display: 'flex', flex: 1, flexDirection: 'column', minWidth: 0 }}>
                  <PaneHeader label={`v${shown} (selected)`} accent />
                  <DemoPane projectId={projectId} demoId={demoId} version={shown}
                            subjects={subjects} style={paneStyle} />
                </div>
                <div style={{ background: 'var(--surface-raised)', flexShrink: 0, width: '1px' }} />
                <div style={{ display: 'flex', flex: 1, flexDirection: 'column', minWidth: 0 }}>
                  <PaneHeader
                    label={`v${comparand} (${comparand === parentOfShown ? 'parent' : 'vs'})`}
                    accent={false}
                  />
                  <DemoPane projectId={projectId} demoId={demoId} version={comparand}
                            subjects={subjects} style={paneStyle} />
                </div>
              </div>
            )}
          </div>
        ) : (
          <>
            {prepared !== null && prepared.version === shown && (
              <iframe
                // Keyed on the VERSION so a swap replaces the element — same Back-button
                // reasoning as Document mode's frame. `src` is ALWAYS the version's
                // address (what tests and copy-link gestures read); `srcDoc` carries the
                // same bytes with the bridge-root URLs re-homed, and the browser renders
                // THAT. A failed fetch degrades to the plain src path.
                key={shown}
                data-testid="demo-player"
                data-demo-id={demoId}
                data-version={shown}
                src={src}
                {...(prepared.srcDoc === null ? {} : { srcDoc: prepared.srcDoc })}
                title={`Demo ${demoId}, version ${shown}`}
                onLoad={() => { setLoaded(true); }}
                // Storyboard HTML is agent-authored content: same full sandbox as
                // Document. No instrument bridge here — chapter clicks must SEEK.
                sandbox="allow-scripts"
                style={{ border: 'none', display: 'block', height: '100%', width: '100%' }}
              />
            )}
            {loaded && prepared !== null ? null : (
              <div style={{ background: 'var(--surface-base)', inset: 0, position: 'absolute' }}>
                <Loading surface="video" subject={subject} />
              </div>
            )}
          </>
        )}
        {/* VIDEO-FB finding 2: the record affordance lives ON the surface it acts
            on, answers at the click site (EC37), and says honestly what it does. */}
        <div style={{
          alignItems: 'flex-end', display: 'flex', flexDirection: 'column', gap: '4px',
          position: 'absolute', right: '14px', top: '14px', zIndex: 4,
        }}>
          <button
            type="button"
            data-testid="video-record"
            data-state={recBusy ? 'queuing' : recWaiting ? 'recording' : 'idle'}
            disabled={recBusy || recWaiting}
            onClick={record}
            title={`Runs “${demoId}”’s authored steps in a real browser and lands the result as a new version — it re-records, it does not change the steps`}
            style={{
              background: recBusy || recWaiting ? 'var(--surface-raised)' : 'var(--accent)',
              border: '1px solid var(--accent-subtle)', borderRadius: 'var(--radius-full)',
              color: recBusy || recWaiting ? 'var(--ink-high)' : 'var(--accent-fg)',
              cursor: recBusy || recWaiting ? 'default' : 'pointer',
              fontFamily: 'var(--font-sans)', fontSize: 'var(--text-xs)', fontWeight: 600,
              padding: '4px 12px',
            }}
          >
            {recBusy
              ? 'Queuing the recording…'
              : recWaiting
                ? 'Recording — running the authored steps…'
                : '⏺ Re-record'}
          </button>
          {recError !== null && (
            <span
              data-testid="video-record-error"
              style={{
                background: 'var(--status-fail-dim)', border: '1px solid var(--status-fail-dim)',
                borderRadius: 'var(--radius-sm)', color: 'var(--status-fail)',
                fontFamily: 'var(--font-mono)', fontSize: 'var(--text-2xs)',
                maxWidth: '340px', padding: '2px 8px',
              }}
            >
              {recError} — nothing was queued; try again.
            </span>
          )}
        </div>
        {/* §7.3: while the strip is away, the bottom band listens for the mouse. */}
        <StripSensor hidden={hidden} wake={wake} />
        {/* pointerEvents none on the WRAPPER: the strip re-enables itself while visible;
            while dimmed the box must not shadow the z-1 sensor, or nothing can wake it. */}
        <div style={{ bottom: 0, left: 0, pointerEvents: 'none', position: 'absolute', right: 0, zIndex: 3 }}>
          {/* Operator feedback (VIDEO-FB parity): the band is VERSIONS ONLY — the
              slim variant, exactly the Document surface's. Fork / in-thread live
              in the panel's Versions tab; export in the Chat tab. */}
          <VersionStrip
            projectId={projectId}
            docId={demoId}
            manifest={manifest}
            selected={shown}
            navigate={navigate}
            onForked={onForked}
            variant="slim"
            mode="video"
            dimmed={hidden}
            onWake={wake}
          />
        </div>
      </div>
      {/* The right panel (VIDEO-FB parity): one tabbed column — Chat | Compare |
          Theme | Versions — with its OWN expand/collapse (the rail). A flex
          sibling, so opening it reflows the canvas rather than covering it. */}
      <DocPanel
        {...panel}
        subject="demo"
        doc={{
          projectId,
          docId: demoId,
          manifest,
          selected: shown,
          navigate,
          onForked,
          recording: recording !== null && recording.version === shown
            ? { href: recording.href, file: `${demoId}-v${shown}.webm` }
            : null,
          compare: {
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
          },
        }}
      >
        {children}
      </DocPanel>
    </div>
  );
}

export interface VideoStoryboardProps {
  projectId: string;
  /** `null` on `/p/:projectId/video` — no demo chosen yet, so the picker shows. */
  demoId: string | null;
  /** The routed `?v=N`; `null` addresses the manifest head. */
  version?: number | null;
  navigate: Navigate;
  /** The thread pane (§7.3): the panel's Chat tab body — the same DocumentThread
   *  instance the caller has always supplied. */
  children?: React.ReactNode;
}

export function VideoStoryboard({
  projectId, demoId, version = null, navigate, children,
}: VideoStoryboardProps): React.ReactElement {
  // §6.3 rehydration, VIDEO-FB parity: opening a demo reads its announce history
  // from `GET /d/:doc/api/conversation` — the SAME artifact restores the SAME
  // read in Document mode, so the video thread survives a reload from the wire
  // too (this was doc-mode-only before, the cold operator's empty-thread reload).
  // Guarded once per thread per session; live projections are kept verbatim.
  useEffect(() => {
    if (demoId === null) return;
    const key = threadKey(projectId, demoId);
    const store = useDocThreadStore.getState();
    if (store.hydrated[key] === true) return;
    let cancelled = false;
    getConversation(projectId, demoId)
      .then((entries) => {
        if (!cancelled) {
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
  }, [projectId, demoId]);

  // The right panel's state lives on the Video surface (VIDEO-FB parity with
  // Document): default OPEN on the picker — its empty state and the demo wizard
  // live in the thread — collapsed to the rail once a demo owns the canvas.
  const [panelOpen, setPanelOpen] = useState(demoId === null);
  const [panelTab, setPanelTab] = useState<DocPanelTab>('chat');
  const panel: PanelState = {
    open: panelOpen,
    tab: panelTab,
    onExpand: (tab?: DocPanelTab): void => {
      setPanelOpen(true);
      if (tab !== undefined) setPanelTab(tab);
    },
    onCollapse: (): void => { setPanelOpen(false); },
    onTab: setPanelTab,
  };
  return (
    <div style={{ display: 'flex', flex: 1, flexDirection: 'column', overflow: 'hidden' }}>
      {demoId === null
        ? (
          <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
            <div style={{ display: 'flex', flex: 1, flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
              <DemoPicker projectId={projectId} navigate={navigate} />
            </div>
            <DocPanel {...panel} doc={null} subject="demo">{children}</DocPanel>
          </div>
        )
        : (
          <DemoSurface
            key={`${projectId}/${demoId}`}
            projectId={projectId}
            demoId={demoId}
            version={version}
            navigate={navigate}
            panel={panel}
          >
            {children}
          </DemoSurface>
        )}
    </div>
  );
}
