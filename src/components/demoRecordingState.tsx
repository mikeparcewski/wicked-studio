// A demo's recording outcome, as the bridge reports it (studio#278, the studio half of crew#501).
//
// `GET /d/:doc/api/demo/status` carries the recorder's last TERMINAL state: `state: "failed"`
// plus the typed RecorderError (`error: {code, error, remedy, step?, request?, retryable}`).
// Since wicked-interactive 0.9.4 that state is written beside the doc, so it survives a bridge
// restart as well as a page reload. The storyboard and both pickers read it here. Before this,
// the only surface for a failed recording was the thread's live error line, which a reload drops.
//
// The studio's `DemoStatus` type predates the failure fields and spells `step` as a number
// (the bridge sends `{index, label}`), so the wire is read defensively.
import { useEffect, useState } from 'react';
import { getDemoStatus } from '../api/interactive.js';
import type { DemoStatus } from '../api/interactive.js';

/** A step of the authored click-path, as the recorder names it. */
export interface RecordingStep {
  index: number;
  label: string;
}

/** What a failed recording tells the user: where it broke, why, and what to do. */
export interface RecordingFailure {
  code: string;
  reason: string;
  remedy: string | null;
  step: RecordingStep | null;
  /** The write the read-only recorder blocked (`side_effect_blocked`), when that was the cause. */
  request: { method: string; url: string } | null;
}

const rec = (v: unknown): Record<string, unknown> | null =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null;
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);

function stepFrom(raw: unknown, label?: unknown): RecordingStep | null {
  if (typeof raw === 'number' && Number.isInteger(raw)) return { index: raw, label: str(label) ?? '' };
  const o = rec(raw);
  if (o !== null && typeof o['index'] === 'number') return { index: o['index'], label: str(o['label']) ?? '' };
  return null;
}

/** The step the recorder is on (or failed at), whichever shape the bridge sent. */
export function recordingStep(status: DemoStatus | null): RecordingStep | null {
  const o = rec(status);
  return o === null ? null : stepFrom(o['step'], o['label']);
}

/** The recording's failure, or `null` when the last outcome was not a failure (or is unknown). */
export function recordingFailure(status: DemoStatus | null): RecordingFailure | null {
  const o = rec(status);
  if (o === null || o['state'] !== 'failed' || o['in_flight'] === true) return null;
  const err = rec(o['error']);
  const request = rec(err?.['request']);
  return {
    code: str(err?.['code']) ?? 'recording_failed',
    reason: str(err?.['error']) ?? str(err?.['cause']) ?? 'the recorder did not say why',
    remedy: str(err?.['remedy']),
    step: stepFrom(err?.['step']) ?? recordingStep(status),
    request: request !== null && str(request['method']) !== null && str(request['url']) !== null
      ? { method: String(request['method']), url: String(request['url']) }
      : null,
  };
}

/** "recording failed at step 2 (Launch a run)", for a row or a heading. */
export function recordingFailureLine(f: RecordingFailure): string {
  if (f.step === null) return 'recording failed';
  return `recording failed at step ${f.step.index}${f.step.label !== '' ? ` (${f.step.label})` : ''}`;
}

/** The demo's recording failure, read once per mount (a list row's badge). */
export function useRecordingFailure(projectId: string, demoId: string): RecordingFailure | null {
  const [failure, setFailure] = useState<RecordingFailure | null>(null);
  useEffect(() => {
    let cancelled = false;
    setFailure(null); // a row reused for another demo never shows the previous one's failure
    getDemoStatus(projectId, demoId)
      .then((s) => { if (!cancelled) setFailure(recordingFailure(s)); })
      .catch(() => { /* bridge down or route absent — a row without a badge, never a wrong one */ });
    return () => { cancelled = true; };
  }, [projectId, demoId]);
  return failure;
}

/** A picker row's "· recording failed at step N" badge; renders nothing unless the demo failed. */
export function RecordingFailedBadge({ projectId, demoId }: { projectId: string; demoId: string }): React.ReactElement | null {
  const failure = useRecordingFailure(projectId, demoId);
  if (failure === null) return null;
  return (
    <span
      data-testid="demo-row-failed"
      data-code={failure.code}
      title={`${failure.reason}${failure.remedy !== null ? ` — ${failure.remedy}` : ''}`}
      style={{ color: 'var(--status-fail)', flexShrink: 0, fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}
    >
      · {recordingFailureLine(failure)}
    </span>
  );
}
