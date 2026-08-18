import { useRef, useState } from 'react';
import {
  getDemoSpec, getLatestRecording, getVersions, interactiveUrl, listDemos,
} from '../api/interactive.js';
import type { DemoRecording, DemoStep, DocSummary } from '../api/interactive.js';
import { recordFromThread, recordingSubject, submitStepFeedback, type StepComment } from '../interactive/demoWire.js';
import { modePath, type Navigate } from '../hooks/useRoute.js';
import { statusLine } from '../store/narration.js';
import { threadKey, useDocThreadStore, type DocMsg } from '../store/docThread.js';
import { Failed, Loading, PANEL, S, useLoad, type Failure } from './SurfaceState.js';

// Video mode's surface (DES-MERGE-001 §1.3, §4.5, §6.4 slice 13): storyboard + player.
//
// The split ADR-0018 draws is preserved exactly — the agent authors the spec, the
// model-free service executes and records it — so this surface only ever READS the spec
// and the recording the service produced. Two consequences it is built around:
//
//   1. Chapters are derived from SPEC STEP BOUNDARIES, never scraped off the video.
//      Playwright owns viewport, DPR and frame pacing (§4.5), so the spec is the only
//      authority on where chapter N begins; clicking one seeks the player there.
//   2. ffmpeg post-processing is BEST-EFFORT (§4.5): a missing ffmpeg must not abort the
//      version landing, so it must not blank this surface either. The storyboard renders
//      from the spec regardless, and the player states what is missing with the install
//      command the service named, verbatim (§3.3 actionable).
//
// Everything resolves through the slice-2 client — no second origin, no port literal.

/** ffmpeg is the service's dependency, so the service names the fix. This is only what
 *  we say when it reported the absence WITHOUT a hint: still a command, never "sorry". */
const FFMPEG_FALLBACK_HINT =
  'install ffmpeg (macOS: `brew install ffmpeg`, Debian/Ubuntu: `sudo apt install ffmpeg`), '
  + 'then record again — the demo itself is unaffected.';

/** `0:07`, `1:04` — chapter offsets are seconds, and the storyboard shows them as time. */
export function mmss(seconds: number): string {
  const t = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

/**
 * Where a chapter click puts the playhead. The step's own timestamp, clamped to the
 * recording's duration when one is known: a spec re-authored against an older recording
 * (slice 14's whole flow) has steps past its end, and seeking past the end is a NaN
 * playhead in every browser. A negative or non-numeric timestamp is a spec defect, not a
 * reason to break the player — it lands at the start.
 */
export function chapterSeek(step: DemoStep, duration?: number): number {
  const t = Number(step.timestamp);
  const at = Number.isFinite(t) && t > 0 ? t : 0;
  return Number.isFinite(duration) && (duration as number) > 0
    ? Math.min(at, duration as number)
    : at;
}

/** What the player can actually show — one kind, decided once, so no branch renders blank. */
export type PlayerState =
  | { kind: 'video'; src: string; poster?: string | undefined }
  | { kind: 'gif'; src: string }
  | { kind: 'missing'; ffmpeg: boolean; hint?: string | undefined };

/**
 * The recording, reduced to a player state (§3.3: every branch names its subject or its
 * action). `failure` is folded in rather than thrown: a recording that cannot be read
 * must still leave the storyboard standing, and the bridge reports a missing ffmpeg two
 * ways — a `{ffmpeg_absent, ffmpeg_hint}` body on the happy path, and an error carrying
 * the same word when the post-process itself failed.
 */
export function playerState(
  projectId: string, rec: DemoRecording | null, failure: Failure | null,
): PlayerState {
  if (rec?.ffmpeg_absent) return { kind: 'missing', ffmpeg: true, hint: rec.ffmpeg_hint || FFMPEG_FALLBACK_HINT };
  if (rec?.video_url) {
    return {
      kind: 'video',
      src: interactiveUrl(projectId, rec.video_url),
      poster: rec.poster_url ? interactiveUrl(projectId, rec.poster_url) : undefined,
    };
  }
  if (rec?.gif_url) return { kind: 'gif', src: interactiveUrl(projectId, rec.gif_url) };
  if (failure) {
    const ffmpeg = /ffmpeg/i.test(failure.message) || /ffmpeg/i.test(failure.hint ?? '');
    return { kind: 'missing', ffmpeg, hint: failure.hint || (ffmpeg ? failure.message : undefined) };
  }
  return { kind: 'missing', ffmpeg: false };
}

/** Stable identity for "this thread has said nothing", so the selector never re-renders. */
const NO_MESSAGES: DocMsg[] = [];

const ACTION: React.CSSProperties = {
  border: 'none', borderRadius: '6px', cursor: 'pointer', flexShrink: 0,
  fontSize: '11px', fontWeight: 600, padding: '5px 11px',
};

const BAR: React.CSSProperties = {
  alignItems: 'center', background: '#0f1419', borderTop: `1px solid ${S.border}`,
  display: 'flex', flexShrink: 0, gap: '8px', padding: '8px 12px',
};

// ── Demo picker — the mode with no `:demoId` in the route ────────────────────

/** Most-recent first, same rule as the slice-8 doc picker. A null `updated_at` sinks. */
function byRecency(a: DocSummary, b: DocSummary): number {
  return (b.updated_at ?? '').localeCompare(a.updated_at ?? '');
}

function DemoPicker({ projectId, navigate }: { projectId: string; navigate: Navigate }): React.ReactElement {
  const [demos, failure, retry] = useLoad(() => listDemos(projectId), [projectId]);

  if (failure) return <Failed surface="video" subject="this project's demos" failure={failure} onRetry={retry} />;
  if (demos === null) return <Loading surface="video" subject="this project's demos" />;

  // An empty region renders an invitation, never a blank (§1.4). Authoring a demo is the
  // agent's job, so the invitation points at the thread — recording from it is slice 14.
  if (demos.length === 0) {
    return (
      <div data-testid="demo-picker-empty" style={{ padding: '32px' }}>
        <div style={PANEL}>
          <h2 style={{ fontSize: '15px', fontWeight: 700, color: S.ink, margin: '0 0 8px' }}>
            No demos in this project yet
          </h2>
          <p style={{ fontSize: '13px', color: S.muted, margin: 0, lineHeight: 1.5 }}>
            A demo is a set of steps the agent authors and the service records. Ask for a
            walkthrough in the thread — “a demo of the checkout flow” — and it appears here as
            a storyboard with its player as soon as the spec exists.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '32px', overflowY: 'auto' }}>
      <p style={{
        fontSize: '11px', fontWeight: 600, color: S.label, margin: '0 0 10px',
        textTransform: 'uppercase', letterSpacing: '0.06em',
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
              color: S.ink, cursor: 'pointer', fontSize: '13px', padding: '12px 16px',
            }}
          >
            <span style={{ flex: 1, fontWeight: 500 }}>{demo.name}</span>
            <span style={{ color: S.muted, flexShrink: 0, fontSize: '12px' }}>v{demo.head}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── The missing-recording panel — §3.3 actionable, never a dead end ──────────

function MissingRecording({
  demoId, state, record,
}: {
  demoId: string; record: (ask: string) => Promise<void>;
  state: Extract<PlayerState, { kind: 'missing' }>;
}): React.ReactElement {
  const [queued, setQueued] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await record(`Record “${demoId}”.`);
      setQueued(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-testid="demo-no-recording" data-ffmpeg-absent={String(state.ffmpeg)} style={{ padding: '32px' }}>
      <div style={PANEL}>
        <h2 style={{ fontSize: '15px', fontWeight: 700, color: S.ink, margin: '0 0 8px' }}>
          {state.ffmpeg
            ? `“${demoId}” recorded, but the video could not be converted`
            : `“${demoId}” has no recording yet`}
        </h2>
        {/* The hint is the SERVICE's command and is rendered verbatim — paraphrasing it
            would be paraphrasing something the user has to type (§3.3). */}
        {state.hint ? (
          <p
            data-testid="demo-ffmpeg-hint"
            style={{
              fontSize: '13px', color: S.ink, margin: '0 0 14px', lineHeight: 1.5,
              borderLeft: `2px solid ${S.accent}`, paddingLeft: '10px',
            }}
          >
            <strong>To fix:</strong> {state.hint}
          </p>
        ) : (
          <p style={{ fontSize: '13px', color: S.muted, margin: '0 0 14px', lineHeight: 1.5 }}>
            The steps below are the spec the agent authored. Recording runs them in a real
            browser and captures the result.
          </p>
        )}
        <button
          type="button"
          data-testid="demo-record"
          disabled={busy || queued}
          onClick={() => void go()}
          style={{
            background: 'transparent', border: `1px solid ${S.border}`, borderRadius: '6px',
            color: queued ? S.muted : S.ink, cursor: busy || queued ? 'default' : 'pointer',
            fontSize: '12px', padding: '6px 12px',
          }}
        >
          {queued ? 'Recording queued' : busy ? `Asking the recorder to run “${demoId}”…` : 'Record this demo'}
        </button>
        {queued ? (
          <p data-testid="demo-record-queued" style={{ fontSize: '12px', color: S.muted, margin: '10px 0 0' }}>
            The recorder is running “{demoId}” — the player appears here when the version lands.
          </p>
        ) : null}
        {error !== null ? (
          <p data-testid="demo-record-error" style={{ fontSize: '12px', color: S.ink, margin: '10px 0 0' }}>
            Could not queue the recording: {error}. Try again, or ask in the thread.
          </p>
        ) : null}
      </div>
    </div>
  );
}

// ── Player + storyboard — the demo surface itself ────────────────────────────

function DemoSurface({ projectId, demoId }: { projectId: string; demoId: string }): React.ReactElement {
  const key = threadKey(projectId, demoId);
  // A re-authored spec is a NEW VERSION of the same demo (§7.10's continuation), so the
  // surface re-reads the service when one lands rather than showing the steps it was fed
  // at mount. `reloads` is the same read on the near side of the stream: a submitted
  // batch asks for a re-authoring now, and the frame confirming it may be seconds behind.
  const landed = useDocThreadStore((s) => s.landed[key]);
  const recording = useDocThreadStore((s) => s.genState[key]) === 'generating';
  const messages = useDocThreadStore((s) => s.messages[key] ?? NO_MESSAGES);
  const [reloads, setReloads] = useState(0);
  const nonce = `${landed ?? 0}:${reloads}`;

  // Three INDEPENDENT loads on purpose: the spec is what makes the storyboard, and a
  // recording that 404s, errors, or reports a missing ffmpeg must leave the chapters
  // standing (§4.5 — degradation is required behaviour, not a nicety).
  const [spec, specFailure, retrySpec] = useLoad(() => getDemoSpec(projectId, demoId), [projectId, demoId, nonce]);
  const [rec, recFailure] = useLoad(() => getLatestRecording(projectId, demoId), [projectId, demoId, nonce]);
  const [manifest] = useLoad(() => getVersions(projectId, demoId), [projectId, demoId, nonce]);
  const [chapter, setChapter] = useState(0);
  const [at, setAt] = useState(0);
  const [draft, setDraft] = useState<StepComment | null>(null);
  const [items, setItems] = useState<StepComment[]>([]);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement>(null);

  const subject = `“${demoId}”`;
  if (specFailure) return <Failed surface="video" subject={subject} failure={specFailure} onRetry={retrySpec} />;
  if (spec === null) return <Loading surface="video" subject={subject} />;

  // Ordered by the step's own declared position, not by however the JSON happened to
  // arrive: `index` IS the chapter number the user sees, so the two cannot disagree.
  const steps = [...(spec.steps ?? [])].sort((a, b) => a.index - b.index);
  const player = playerState(projectId, rec, recFailure);
  const version = manifest?.head ?? rec?.version ?? null;

  /** §3.4's two altitudes, one stream: the thread keeps the transcript, this keeps the
   *  headline. Rule 1 (a real streamed line) wins; rule 3 — the demo and its first step —
   *  is why a bare `Working…` is never needed and never rendered here. */
  const status = statusLine(
    messages.filter((m): m is Extract<DocMsg, { kind: 'narration' }> => m.kind === 'narration').map((m) => m.text),
    recordingSubject(demoId, steps.length, steps[0]?.title),
  );

  /** Both record paths are the same wire (§2.3): the ask lands in the thread first. */
  async function record(ask: string): Promise<void> {
    setSent(false);
    await recordFromThread({ projectId, demoId, ask, steps: steps.length, first: steps[0]?.title });
  }

  /** Clicking chapter N seeks the player there; with no seekable recording it puts the
   *  step itself in focus instead, so the click always resolves to something visible. */
  function onChapter(step: DemoStep, card: HTMLElement | null): void {
    setChapter(step.index);
    const el = video.current;
    const seconds = chapterSeek(step, el?.duration);
    setAt(seconds);
    if (el) el.currentTime = seconds;
    else card?.scrollIntoView?.({ block: 'nearest', inline: 'center' });
  }

  /** One comment queued against one step. Batched, never sent per comment (§4.3). */
  function commit(): void {
    if (draft === null || draft.text.trim() === '') return;
    setItems((prev) => [...prev, { index: draft.index, text: draft.text.trim() }]);
    setDraft(null);
  }

  /** §4.3's batch, aimed at the spec: N step comments → one message, one re-authoring. */
  async function send(): Promise<void> {
    if (items.length === 0 || version === null || busy) return;
    setBusy(true);
    setError(null);
    try {
      await submitStepFeedback(projectId, demoId, version, items);
      setItems([]);
      setDraft(null);
      setSent(true);
      setReloads((n) => n + 1);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', flex: 1, flexDirection: 'column', overflow: 'hidden' }}>
      <div
        data-testid="demo-player"
        data-chapter={String(chapter)}
        data-position={String(at)}
        data-player-kind={player.kind}
        style={{ flex: 1, overflow: 'auto', background: '#0d1117' }}
      >
        {player.kind === 'video' ? (
          <video
            ref={video}
            data-testid="demo-video"
            src={player.src}
            poster={player.poster}
            controls
            onTimeUpdate={(e) => setAt(e.currentTarget.currentTime)}
            style={{ display: 'block', height: '100%', width: '100%' }}
          />
        ) : player.kind === 'gif' ? (
          // A GIF has no timeline to scrub, so the chapter is stated in words instead of
          // pretending the playhead moved (§3.3: informative, with its subject).
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '16px' }}>
            <img data-testid="demo-gif" src={player.src} alt={`Recording of ${demoId}`} style={{ maxWidth: '100%' }} />
            <p data-testid="demo-position" style={{ fontSize: '12px', color: S.muted, margin: 0 }}>
              {steps.length > 0
                ? `Chapter ${chapter + 1} of ${steps.length}, at ${mmss(at)} — this recording is a `
                  + 'looping GIF with no timeline, so the chapter is shown rather than played to.'
                : 'This recording is a looping GIF of the whole demo.'}
            </p>
          </div>
        ) : (
          <MissingRecording demoId={demoId} state={player} record={record} />
        )}
      </div>

      {/* The storyboard: one card per SPEC STEP, in spec order (§4.5). */}
      <div
        data-testid="demo-storyboard"
        data-steps={String(steps.length)}
        style={{
          display: 'flex', flexShrink: 0, gap: '8px', overflowX: 'auto', padding: '10px 12px',
          background: '#0f1419', borderTop: `1px solid ${S.border}`,
        }}
      >
        {steps.length === 0 ? (
          <p data-testid="demo-storyboard-empty" style={{ fontSize: '12px', color: S.muted, margin: 0 }}>
            {subject} has no steps yet — the agent is still authoring the spec.
          </p>
        ) : steps.map((step) => (
          <button
            key={step.index}
            type="button"
            data-testid="chapter-card"
            data-index={String(step.index)}
            data-timestamp={String(step.timestamp)}
            data-selected={String(step.index === chapter)}
            data-comments={String(items.filter((i) => i.index === step.index).length)}
            title={`Chapter ${step.index + 1}: ${step.title} — ${player.kind === 'video' ? 'seeks to' : 'starts at'} ${mmss(step.timestamp)}`}
            onClick={(e) => onChapter(step, e.currentTarget)}
            style={{
              background: step.index === chapter ? 'rgba(255,218,25,0.1)' : 'transparent',
              border: `1px solid ${step.index === chapter || items.some((i) => i.index === step.index) ? S.accent : S.border}`,
              borderRadius: '8px', color: S.ink, cursor: 'pointer', flexShrink: 0,
              padding: '8px', textAlign: 'left', width: '160px',
            }}
          >
            {step.thumbnail ? (
              <img
                data-testid="chapter-thumbnail"
                src={interactiveUrl(projectId, step.thumbnail)}
                alt=""
                style={{ display: 'block', borderRadius: '4px', marginBottom: '6px', width: '100%' }}
              />
            ) : null}
            <span style={{ display: 'block', fontSize: '12px', fontWeight: 600 }}>
              {step.index + 1}. {step.title}
            </span>
            <span style={{ display: 'block', color: S.muted, fontSize: '11px' }}>{mmss(step.timestamp)}</span>
          </button>
        ))}
      </div>

      {/*
        The one action bar under the storyboard. It is one bar and not four because the
        four things it says are the same thing at different moments of one loop — what
        the recorder is doing, what you are commenting on, what is queued, and what to do
        with the version that came back — and §3.3 wants each of them stated WITH its
        control rather than scattered around the surface.

        Commenting targets the SELECTED chapter, which is the chapter the player is
        already parked on: a step is picked by clicking it, exactly as a document element
        is picked by clicking it (§4.3), and the click keeps its existing meaning.
      */}
      {steps.length > 0 && (
        <div data-testid="demo-actions" style={BAR}>
          {recording ? (
            <span data-testid="demo-record-status" style={{ color: S.ink, fontSize: '12px' }}>{status}</span>
          ) : draft !== null ? (
            <>
              <span style={{ color: S.muted, fontFamily: 'monospace', fontSize: '10px', flexShrink: 0 }}>
                step {draft.index + 1}
              </span>
              <textarea
                data-testid="step-comment-input"
                autoFocus
                rows={1}
                value={draft.text}
                placeholder={`What should “${steps.find((s) => s.index === draft.index)?.title ?? ''}” do instead?`}
                onChange={(e) => setDraft({ index: draft.index, text: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit(); }
                  if (e.key === 'Escape') setDraft(null);
                }}
                style={{
                  background: 'transparent', border: `1px solid ${S.border}`, borderRadius: '6px',
                  color: S.ink, flex: 1, fontFamily: 'inherit', fontSize: '12px', padding: '5px 7px', resize: 'none',
                }}
              />
              <button type="button" data-testid="step-comment-add" onClick={commit}
                      disabled={draft.text.trim() === ''}
                      style={{ ...ACTION, background: S.accent, color: '#0d1117' }}>
                Add to batch
              </button>
              <button type="button" data-testid="step-comment-cancel" onClick={() => setDraft(null)}
                      style={{ ...ACTION, background: 'transparent', border: `1px solid ${S.border}`, color: S.muted }}>
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                data-testid="step-comment-open"
                data-index={String(chapter)}
                onClick={() => { setDraft({ index: chapter, text: '' }); setSent(false); }}
                style={{ ...ACTION, background: 'transparent', border: `1px solid ${S.border}`, color: S.ink }}
              >
                Comment on step {chapter + 1}
              </button>
              {sent && (
                <>
                  <span style={{ color: S.ink, fontSize: '12px' }}>
                    “{demoId}” was re-authored from your comments — record it again to see the change.
                  </span>
                  <button
                    type="button"
                    data-testid="demo-rerecord"
                    onClick={() => void record(`Re-record “${demoId}” with the updated steps.`)}
                    style={{ ...ACTION, background: S.accent, color: '#0d1117' }}
                  >
                    Re-record
                  </button>
                </>
              )}
              {items.length > 0 && (
                <button
                  type="button"
                  data-testid="step-feedback-submit"
                  data-count={String(items.length)}
                  disabled={busy || version === null}
                  title={version === null ? 'This demo has no version to comment on yet.' : 'One message, one re-authoring'}
                  onClick={() => void send()}
                  style={{ ...ACTION, background: S.accent, color: '#0d1117', marginLeft: 'auto' }}
                >
                  {busy ? 'Sending…' : `Send ${items.length} comment${items.length === 1 ? '' : 's'}`}
                </button>
              )}
            </>
          )}
          {error !== null && (
            <span data-testid="step-feedback-error" style={{ color: '#f85149', fontFamily: 'monospace', fontSize: '11px' }}>
              {error} — nothing was sent; try again.
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export interface VideoStoryboardProps {
  projectId: string;
  /** `null` on `/p/:projectId/video` — no demo chosen yet, so the picker shows. */
  demoId: string | null;
  navigate: Navigate;
}

export function VideoStoryboard({ projectId, demoId, navigate }: VideoStoryboardProps): React.ReactElement {
  return (
    <div style={{ display: 'flex', flex: 1, flexDirection: 'column', overflow: 'hidden' }}>
      {demoId === null
        ? <DemoPicker projectId={projectId} navigate={navigate} />
        : <DemoSurface key={`${projectId}/${demoId}`} projectId={projectId} demoId={demoId} />}
    </div>
  );
}
