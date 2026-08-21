import { useRef, useState } from 'react';
import { getVersions, interactiveDocUrl, listDemos } from '../api/interactive.js';
import type { DocSummary, ForkResult, VersionManifest } from '../api/interactive.js';
import { modePath, versionPath, type Navigate } from '../hooks/useRoute.js';
import { threadKey, useDocThreadStore } from '../store/docThread.js';
import { StripSensor, ThreadDrawer, ThreadToggle, useStripAutoHide } from './ThreadDrawer.js';
import { Failed, Loading, PANEL, S, useLoad } from './SurfaceState.js';
import { VersionStrip } from './VersionStrip.js';

// Video mode's surface — REWIRED by DES-FEEDBACK-001 §7.2/§7.4.
//
// Slice 13 invented a client-side player: it read `GET /d/:id/api/demo/spec` and
// `GET /d/:id/api/demo/recordings`, neither of which the bridge serves (verified
// against wicked-interactive's server.js — its real demo surface is gif export,
// recording streaming, and the standalone player page). The spec call always 404'd
// in production and the surface was BROKEN; the slice-13 fixture had implemented the
// invented route, so the rig confirmed a wire that never existed. The contract-check
// leg (e2e/interactive_wire_contract_test.py) now pins every URL this file builds
// against the REAL bridge, so a fixture cannot self-confirm again.
//
// The corrected architecture is Document mode's, verbatim: the storyboard —
// chapters, embedded player, navigation — is the demo's VERSION HTML, built by the
// bridge's own `storyboard()` (demo.js) and served at `GET /d/:demoId/doc/:version`.
// This surface frames that HTML and addresses versions through the same strip.
// The thread is the same right-side drawer as Document's (§7.3); recording still
// goes through the thread (`recordFromThread` → the `wicked.interactive.demo.requested`
// bus command), and step feedback still rides the one batch contract.

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
  // the agent's job, so the invitation points at the thread.
  if (demos.length === 0) {
    return (
      <div data-testid="demo-picker-empty" style={{ padding: '32px', fontFamily: 'var(--font-sans)' }}>
        <div style={PANEL}>
          <h2 style={{ fontSize: 'var(--text-md)', fontWeight: 700, color: S.ink, margin: '0 0 8px' }}>
            No demos in this project yet
          </h2>
          <p style={{ fontSize: 'var(--text-sm)', color: S.muted, margin: 0, lineHeight: 1.5 }}>
            A demo is a set of steps the agent authors and the service records. Ask for a
            walkthrough in the thread — “a demo of the checkout flow” — and it appears here as
            a storyboard with its player as soon as the spec exists.
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
          <button
            key={demo.name}
            type="button"
            data-testid="demo-picker-row"
            data-demo-id={demo.name}
            onClick={() => navigate(modePath(projectId, 'video', demo.name))}
            style={{
              display: 'flex', alignItems: 'center', gap: '12px', width: '100%', textAlign: 'left',
              background: 'transparent', border: 'none',
              borderBottom: i < sorted.length - 1 ? `1px solid ${S.border}` : 'none',
              color: S.ink, cursor: 'pointer', fontSize: 'var(--text-sm)',
              fontFamily: 'var(--font-sans)', padding: '12px 16px',
            }}
          >
            <span style={{ flex: 1, fontWeight: 500 }}>{demo.name}</span>
            <span style={{ color: S.muted, flexShrink: 0, fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)' }}>
              v{demo.head}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── The demo surface: storyboard HTML in an iframe, same as Document ─────────

/** The routed `?v`, narrowed to one the manifest actually has — else the head. */
function resolveVersion(manifest: VersionManifest, routed: number | null): number {
  return routed !== null && manifest.versions.some((v) => v.version === routed)
    ? routed
    : manifest.head;
}

function DemoSurface({
  projectId, demoId, version, navigate, threadOpen, onToggleThread, children,
}: {
  projectId: string; demoId: string; version: number | null; navigate: Navigate;
  threadOpen: boolean; onToggleThread: () => void; children?: React.ReactNode;
}): React.ReactElement {
  // A landed version (a re-record, a re-authored spec) re-reads the manifest, so the
  // strip advances and the frame swaps the moment the stream lands one — same rule as
  // Document mode's canvas.
  const landed = useDocThreadStore((s) => s.landed[threadKey(projectId, demoId)]);
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

  const subject = `“${demoId}”`;
  if (manifest === null) {
    return (
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <div style={{ display: 'flex', flex: 1, flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
          {failure
            ? <Failed surface="video" subject={subject} failure={failure} onRetry={retry} />
            : <Loading surface="video" subject={subject} />}
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
  // §7.4: the storyboard HTML is the demo's version HTML — the bridge's own
  // `GET /d/:demoId/doc/:version`, on the app's origin through crew's proxy.
  const src = interactiveDocUrl(projectId, demoId, shown);

  const onForked = (result: ForkResult): void => {
    retry();
    navigate(versionPath(projectId, demoId, result.version, 'video'));
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
        <iframe
          // Keyed on the VERSION so a swap replaces the element — same Back-button
          // reasoning as Document mode's frame.
          key={shown}
          data-testid="demo-player"
          data-demo-id={demoId}
          data-version={shown}
          src={src}
          title={`Demo ${demoId}, version ${shown}`}
          onLoad={() => { setLoaded(true); }}
          // Storyboard HTML is agent-authored content: same full sandbox as Document.
          // Its embedded player page (`/api/demo/player/:v`) is a nested frame and
          // inherits the sandbox; video playback needs no further grants.
          sandbox="allow-scripts"
          style={{ border: 'none', display: 'block', height: '100%', width: '100%' }}
        />
        {loaded ? null : (
          <div style={{ background: 'var(--surface-base)', inset: 0, position: 'absolute' }}>
            <Loading surface="video" subject={subject} />
          </div>
        )}
        <StripSensor hidden={hidden} wake={wake} />
        <div style={{ bottom: 0, left: 0, position: 'absolute', right: 0, zIndex: 3 }}>
          <VersionStrip
            projectId={projectId}
            docId={demoId}
            manifest={manifest}
            selected={shown}
            navigate={navigate}
            onForked={onForked}
            mode="video"
            dimmed={hidden}
            onWake={wake}
            trailing={<ThreadToggle open={threadOpen} onToggle={onToggleThread} />}
          />
        </div>
      </div>
      <ThreadDrawer open={threadOpen} onClose={onToggleThread}>{children}</ThreadDrawer>
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
  /** The thread pane (§7.3): rendered as the right-side drawer this surface owns —
   *  the same DocumentThread instance the caller has always supplied. */
  children?: React.ReactNode;
}

export function VideoStoryboard({
  projectId, demoId, version = null, navigate, children,
}: VideoStoryboardProps): React.ReactElement {
  // Same drawer defaults as Document (§7.3/§7.4): open on the picker — its empty
  // state and the demo wizard live in the thread — closed once a demo owns the canvas.
  const [threadOpen, setThreadOpen] = useState(demoId === null);
  const toggleThread = (): void => { setThreadOpen((v) => !v); };
  return (
    <div style={{ display: 'flex', flex: 1, flexDirection: 'column', overflow: 'hidden' }}>
      {demoId === null
        ? (
          <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
            <div style={{ display: 'flex', flex: 1, flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
              <DemoPicker projectId={projectId} navigate={navigate} />
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
          <DemoSurface
            key={`${projectId}/${demoId}`}
            projectId={projectId}
            demoId={demoId}
            version={version}
            navigate={navigate}
            threadOpen={threadOpen}
            onToggleThread={toggleThread}
          >
            {children}
          </DemoSurface>
        )}
    </div>
  );
}
