import type { DemoMarker, DemoView } from '../api/demo.js';
import type { WalkthroughCheck, WalkthroughState, WalkthroughVerdict, WalkthroughView } from '../api/walkthrough.js';

/**
 * The walkthrough artifact's words and geometry (DES-WALKTHROUGH-PROOF-001 §3 scenes 18–23 and
 * 41, slice WT-U1), pure. One {@link Recording} shape hosts both kinds the artifact opens:
 *
 *  - `walkthrough`: `GET /runs/:id/walkthrough` — chapters WITH checks, a verdict per chapter, the
 *    failing moment and frame, the evaluator apart from the builders, the gate actions.
 *  - `demo-video`: `GET /runs/:id/demo` (EP-D3) — the same player without checks: play in place,
 *    full screen, chapters as seek points, download mp4 / GIF / poster.
 *
 * Nothing here claims "checked": that word is the acceptance read's (`steps[].checkState`, WT-U2).
 */

export type RecordingKind = 'walkthrough' | 'demo-video';

export interface RecordingCheck extends WalkthroughCheck {
  /** Seconds into the stitched take (the chapter's marker + the check's own offset); `null` when it never ran. */
  atAbsSec: number | null;
}

export interface RecordingChapter {
  key: string;
  title: string;
  blurb: string;
  index: number;
  total: number;
  /** The chapter's start in the stitched take, from its marker; `null` without one. */
  startSec: number | null;
  verdict: WalkthroughVerdict | null;
  /** The chapter's segment is on disk (crew floors `takes` at 1, so `takes` never says this). */
  recorded: boolean;
  takes: number;
  failedAtSec: number | null;
  /** Absolute seconds of the failing moment in the stitched take. */
  failedAbsSec: number | null;
  failedFrame: string | null;
  checks: RecordingCheck[];
  proves: string[];
}

export interface Recording {
  kind: RecordingKind;
  runId: string;
  step: string | null;
  /** The author step (`walkthrough_plan`) whose storyline "Edit the check" rewrites; `null` for a demo. */
  planStep: string | null;
  state: WalkthroughState;
  cause: string | null;
  seat: { evaluator: string | null; builders: string[] };
  sealed: boolean;
  /** Proof-root-relative (walkthrough) or demo-root-relative (demo) path of the stitched take. */
  video: string | null;
  poster: string | null;
  markers: DemoMarker[];
  chapters: RecordingChapter[];
  /** The presenter's script (demo) — a walkthrough's narration is each chapter's blurb. */
  script: string | null;
  /** A demo's GIF / poster can be made now (`POST /demo/export` answers only at the review gate or
   *  once the run has ended); always false for a walkthrough, whose media is what the take wrote. */
  exportable: boolean;
}

/** "0:41" */
export function fmtTime(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Each chapter's marker in the stitched take. The markers are in take order, so they are consumed in
 * order: a chapter takes the next unused marker with its title (two chapters with one title get one
 * each; a chapter that was never stitched gets none). Only when every chapter has a row is a
 * title mismatch read by position — and then all of them are.
 */
function markersFor(markers: readonly DemoMarker[], titles: readonly string[]): Array<DemoMarker | null> {
  let cursor = 0;
  const byTitle = titles.map((title) => {
    const at = markers.findIndex((m, j) => j >= cursor && m.title === title);
    if (at < 0) return null;
    cursor = at + 1;
    return markers[at] ?? null;
  });
  // One reading for the whole take, never a mix (a positional guess could reuse a marker a later
  // title claims): every chapter by its title, or — when a title has no row and the counts agree —
  // every chapter by its position.
  if (byTitle.every((m) => m !== null) || markers.length !== titles.length) return byTitle;
  return titles.map((_, i) => markers[i] ?? null);
}

export function recordingOf(view: WalkthroughView): Recording {
  const markers = view.video.markers;
  const starts = markersFor(markers, view.chapters.map((c) => c.title));
  const chapters: RecordingChapter[] = view.chapters.map((c, i) => {
    const startSec = starts[i]?.sec ?? null;
    const abs = (at: number | null): number | null => (at === null ? null : startSec === null ? at : startSec + at);
    return {
      key: c.key, title: c.title, blurb: c.blurb, index: c.index, total: c.total, startSec,
      verdict: c.verdict, recorded: c.recorded, takes: c.takes,
      failedAtSec: c.failedAtSec, failedAbsSec: abs(c.failedAtSec), failedFrame: c.failedFrame,
      checks: c.checks.map((k) => ({ ...k, atAbsSec: abs(k.atSec) })),
      proves: c.proves,
    };
  });
  return {
    kind: 'walkthrough', runId: view.runId, step: view.stepId, planStep: view.planStepId, state: view.state, cause: view.cause, seat: view.seat,
    sealed: view.sealed, video: view.video.mp4, poster: view.video.poster, markers, chapters, script: null, exportable: false,
  };
}

/** A demo run as the same artifact, without checks (EP-D3): the stages map onto the recording states. */
export function recordingOfDemo(view: DemoView): Recording {
  const state: WalkthroughState = view.stage === 'failed' ? 'failed'
    : view.stage === 'done' ? 'passed'
      : view.stage === 'recording' ? 'recording'
        : view.stage === 'reviewing' || view.stage === 'review_gate' ? 'judging'
          : 'authoring';
  const markers = view.markers;
  const total = view.chapters.length;
  const starts = markersFor(markers, view.chapters.map((c) => c.title));
  const chapters: RecordingChapter[] = view.chapters.map((c, i) => ({
    key: c.key, title: c.title, blurb: c.blurb, index: i + 1, total, startSec: starts[i]?.sec ?? null,
    verdict: null, recorded: c.recorded, takes: c.recorded ? 1 : 0, failedAtSec: null, failedAbsSec: null, failedFrame: null,
    checks: [], proves: [],
  }));
  return {
    kind: 'demo-video', runId: view.runId, step: null, planStep: null, state, cause: null,
    seat: { evaluator: view.seats.reviewer, builders: view.seats.recorder === null ? [] : [view.seats.recorder] },
    sealed: false, video: view.video?.path ?? null, poster: null, markers, chapters, script: view.script,
    exportable: view.stage === 'review_gate' || view.stage === 'done' || view.stage === 'failed',
  };
}

/** The chapter being recorded now: the first one without a take. */
export function currentChapter(r: Recording): RecordingChapter | null {
  return r.chapters.find((c) => !c.recorded) ?? null;
}

/** The first chapter that failed. */
export function failedChapter(r: Recording): RecordingChapter | null {
  return r.chapters.find((c) => c.verdict === 'FAIL') ?? null;
}

/** Scene 18: "● Recording · chapter 4 of 6"; scene 19: "✗ Failed at 0:41"; scene 21: "✓ Passed · 6 chapters". */
export function stateLine(r: Recording, opts: { authorWaiting?: boolean } = {}): { mark: string; text: string; tone: 'live' | 'bad' | 'ok' | 'quiet' } {
  switch (r.state) {
    case 'recording': {
      const c = currentChapter(r);
      return { mark: '●', text: c === null ? 'Recording' : `Recording · chapter ${c.index} of ${c.total}`, tone: 'live' };
    }
    case 'failed': {
      // The moment in the take (the chapter's start + the check's own offset): what the player's
      // clock reads there. Without a marker for the chapter, its own seconds.
      const at = failedChapter(r)?.failedAbsSec ?? null;
      return { mark: '✗', text: at === null ? 'Failed' : `Failed at ${fmtTime(at)}`, tone: 'bad' };
    }
    case 'passed': {
      const n = r.chapters.length;
      return { mark: '✓', text: r.kind === 'demo-video' ? `Ready to watch · ${n} chapter${n === 1 ? '' : 's'}` : `Passed · ${n} chapter${n === 1 ? '' : 's'}`, tone: 'ok' };
    }
    case 'inconclusive':
      return { mark: '?', text: `Inconclusive${r.cause !== null ? ` — ${r.cause}` : ''}`, tone: 'bad' };
    // `authoring` is also the state of a walkthrough whose author has not been reached yet (the work
    // before it is still going, or went back to the helpers): nobody is writing checks then.
    case 'authoring': return { mark: '○', text: r.kind === 'demo-video' ? 'Planning the story' : opts.authorWaiting === true ? 'Not started yet' : 'Writing the checks', tone: 'quiet' };
    case 'linting': return { mark: '○', text: 'Checking the storyline', tone: 'quiet' };
    case 'starting_app': return { mark: '○', text: 'Starting the app', tone: 'quiet' };
    case 'judging': return { mark: '○', text: r.kind === 'demo-video' ? 'Being reviewed' : 'Judging the take', tone: 'quiet' };
    default: return { mark: '○', text: r.state, tone: 'quiet' };
  }
}

/** "Antigravity checks, Codex builds" — the evaluator apart from the creators (evaluator ≠ creator). */
export function seatLine(r: Recording): string | null {
  const ev = r.seat.evaluator;
  const builders = r.seat.builders;
  if (ev === null && builders.length === 0) return null;
  const parts: string[] = [];
  if (ev !== null) parts.push(`${ev} ${r.kind === 'demo-video' ? 'reviews' : 'checks'}`);
  if (builders.length > 0) parts.push(`${builders.join(' and ')} ${r.kind === 'demo-video' ? 'records' : builders.length === 1 ? 'builds' : 'build'}`);
  return parts.join(', ');
}

/** Scene 19's red lines: what happened underneath at the failing moment. */
export function underneathLines(r: Recording): string[] {
  const c = failedChapter(r);
  if (c === null) return [];
  const failed = c.checks.filter((k) => k.passed === false);
  return failed.map((k) => `${k.sentence}${k.detail !== null && k.detail !== '' ? ` — ${k.detail}` : ''}`);
}

/** Every check of the take in time order, for the checks track; its position on the timeline when known. */
export function checksTrack(r: Recording): Array<RecordingCheck & { chapter: RecordingChapter }> {
  const out: Array<RecordingCheck & { chapter: RecordingChapter }> = [];
  for (const c of r.chapters) for (const k of c.checks) out.push({ ...k, chapter: c });
  return out;
}

/** Where the playhead opens: the failing moment when the take failed, else the start. */
export function playheadStart(r: Recording): number {
  return failedChapter(r)?.failedAbsSec ?? 0;
}

/** The marks along the chapter track: one per chapter, with its verdict. */
export function chapterMarks(r: Recording): Array<{ key: string; index: number; title: string; sec: number | null; verdict: WalkthroughVerdict | null; recorded: boolean; current: boolean }> {
  const cur = currentChapter(r);
  return r.chapters.map((c) => ({ key: c.key, index: c.index, title: c.title, sec: c.startSec, verdict: c.verdict, recorded: c.recorded, current: r.state === 'recording' && cur?.key === c.key }));
}

export interface ExportOption {
  format: 'mp4' | 'gif' | 'poster';
  label: string;
  /** On disk already (the take, a walkthrough's poster), or made on request by the daemon (a demo's
   *  GIF and poster, `POST /runs/:id/demo/export`). */
  how: 'download' | 'request';
  /** The root-relative file of a `download`. */
  path?: string;
}

/** Scene 23 / 41: what can leave the machine — only media, never captures (§7). A walkthrough
 *  exports what its take wrote (the video; the poster when the recorder made one); a demo's GIF and
 *  poster are made on request, and only while the daemon will make them ({@link Recording.exportable}). */
export function exportOptions(r: Recording): ExportOption[] {
  if (r.video === null) return [];
  const out: ExportOption[] = [{ format: 'mp4', label: 'Video', how: 'download', path: r.video }];
  if (r.kind === 'demo-video') {
    if (r.exportable) out.push({ format: 'gif', label: 'GIF', how: 'request' }, { format: 'poster', label: 'Poster', how: 'request' });
  } else if (r.poster !== null) {
    out.push({ format: 'poster', label: 'Poster', how: 'download', path: r.poster });
  }
  return out;
}

export type GateVerb = 'watch' | 'fix' | 'edit';

/** One unit of the run, as much as the escalation check reads. */
export interface UnitLike {
  id: string;
  ord: number;
  denial_reason?: string | null;
  status?: string;
}

/** The walkthrough's author step has not been dispatched yet (its unit is still `pending`). */
export function authorWaiting(r: Recording, units: readonly UnitLike[]): boolean {
  if (r.kind !== 'walkthrough' || r.planStep === null) return false;
  return units.some((u) => u.id === `${r.runId}:${r.planStep}` && u.status === 'pending');
}

/**
 * Whether the gate open on the run is THIS walkthrough's escalation — crew's own rule for the
 * storyline PUT (`recording.ts`): the run is parked on a denied unit of the pair, and the open gate
 * is that unit's. Any other open gate (a later deliver gate on a run whose failed walkthrough was
 * waved through) is not the walkthrough's to answer.
 */
export function escalationOpen(r: Recording, gateOrd: number | null, units: readonly UnitLike[]): boolean {
  if (r.kind !== 'walkthrough' || gateOrd === null) return false;
  const ids = [r.step, r.planStep].filter((s): s is string => s !== null).map((s) => `${r.runId}:${s}`);
  return units.some((u) => ids.includes(u.id) && u.ord === gateOrd && u.denial_reason !== null && u.denial_reason !== undefined);
}

/** Scene 19's actions: Watch whenever there is something to watch (a take, or the failing frame);
 *  Ask helpers to fix · Edit the check only while the walkthrough's own escalation gate is open. */
export function gateVerbs(r: Recording, gateOpen: boolean): GateVerb[] {
  if (r.kind !== 'walkthrough' || r.state !== 'failed') return [];
  const out: GateVerb[] = [];
  if (r.video !== null || failedChapter(r)?.failedFrame != null) out.push('watch');
  if (gateOpen) {
    out.push('fix');
    if (r.planStep !== null) out.push('edit');
  }
  return out;
}

export const GATE_VERB_LABEL: Record<GateVerb, string> = { watch: 'Watch', fix: 'Ask helpers to fix', edit: 'Edit the check' };

/** The note "Ask helpers to fix" sends with the request_changes: the failing checks, in words. */
export function fixNote(r: Recording): string {
  const c = failedChapter(r);
  const lines = underneathLines(r);
  const where = c === null ? 'the walkthrough' : `chapter ${c.index} (${c.title})${c.failedAbsSec !== null ? ` at ${fmtTime(c.failedAbsSec)}` : ''}`;
  return `The walkthrough failed at ${where}.${lines.length > 0 ? ` ${lines.join(' ')}` : ''} Fix what it caught, then it records again.`;
}

/**
 * Which take this is, in a string: the state and, per chapter, its verdict, take count, failing
 * moment and each check's outcome. An action drawn from one take (the fix note names ITS failing
 * checks) must not be sent after another take replaced it — the gate may even sit at the same step.
 */
export function takeFingerprint(r: Recording): string {
  const chapters = r.chapters.map((c) => `${c.key}:${c.verdict ?? ''}:${c.takes}:${c.failedAtSec ?? ''}:${c.checks.map((k) => `${k.id}=${k.passed === null ? '' : k.passed ? 1 : 0}`).join(',')}`);
  return `${r.kind}|${r.runId}|${r.step ?? ''}|${r.state}|${chapters.join(';')}`;
}

/** Whether the recording is still moving (poll it) or settled. */
export function isLive(state: WalkthroughState): boolean {
  return state !== 'passed' && state !== 'failed' && state !== 'inconclusive';
}
