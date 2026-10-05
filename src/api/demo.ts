/**
 * The Demo experience's wire (wicked-studio#373; crew api-types 0.61.0): a demo of a local app,
 * made by a governed run of the built-in `demo` preset — the wicked-garden demo skill's
 * plan → record → review.
 *
 *   POST /projects/:id/demo        launch (the daemon mints the run's demo root and brief)
 *   GET  /runs/:id/demo            what the Demo mode shows, stage by stage
 *   GET  /runs/:id/demo/file       one deliverable (a contact sheet, the MP4 — Range-served)
 *   PUT  /runs/:id/demo/script     the presenter's script edit, at the plan gate only
 *
 * The two gates are the run's own (`POST /runs/:id/gate`): approve, or `request_changes` with the
 * note as `amend` — at the plan gate the planner runs again, at the review gate the recorder does
 * (one chapter).
 *
 * ── CONTRACT ───────────────────────────────────────────────────────────────────────────────────
 * Types come from `wicked-crew-api-types` (pin 0.92.0, ASK-S1); the hand-mirrored copies that lived
 * here while the pin lagged are gone.
 * `DemoStep` below is studio's own reading.
 */

import { apiBase, apiFetch } from './client.js';
import { commitGateDecision, refreshGate, type DecisionOutcome } from '../board/gateActions.js';
import type { SessionView } from './types.js';

/** The preset a demo run is launched from (`team_plan.preset`, api-types 0.46.0). */
import type { DemoLaunchBody, DemoLaunchResponse, DemoStage, DemoChapter, DemoMarker, DemoFinding, DemoView } from 'wicked-crew-api-types';
export type { DemoLaunchBody, DemoLaunchResponse, DemoStage, DemoChapter, DemoMarker, DemoFinding, DemoView };

export const DEMO_PRESET = 'demo';

/** A demo run: launched from the `demo` preset. Read structurally — studio's api-types predates `team_plan`. */
export function isDemoRun(view: Pick<SessionView, 'session'>): boolean {
  const plan = (view.session as { team_plan?: { preset?: unknown } }).team_plan;
  return plan?.preset === DEMO_PRESET;
}

export function launchDemo(projectId: string, body: DemoLaunchBody): Promise<DemoLaunchResponse> {
  return apiFetch<DemoLaunchResponse>(`/projects/${encodeURIComponent(projectId)}/demo`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function getDemo(runId: string): Promise<DemoView> {
  return apiFetch<DemoView>(`/runs/${encodeURIComponent(runId)}/demo`);
}

/** The URL a `<video>` / `<img>` loads a demo deliverable from (the daemon serves it with Range). */
export function demoFileUrl(runId: string, path: string): string {
  return `${apiBase()}/runs/${encodeURIComponent(runId)}/demo/file?path=${encodeURIComponent(path)}`;
}

export function putDemoScript(runId: string, content: string): Promise<{ bytes: number }> {
  return apiFetch<{ bytes: number }>(`/runs/${encodeURIComponent(runId)}/demo/script`, {
    method: 'PUT',
    body: JSON.stringify({ content }),
  });
}

/**
 * A demo gate decision goes through studio's ONE decision path (`commitGateDecision`: the undo
 * window, then the one gate POST, tests/gateWireSingleCaller.test.ts). The open gate is re-read
 * first, so a gate the run re-opened (the review after a re-record) is answerable again and the
 * decision names the gate it was made on.
 */
async function decideDemoGate(runId: string, decision: { approve: boolean; action?: 'request_changes'; amend?: string }): Promise<DecisionOutcome> {
  await refreshGate(runId);
  return commitGateDecision(runId, decision);
}

/** Approve the open gate (the team plan, the plan, or the review). */
export function approveDemoGate(runId: string): Promise<DecisionOutcome> {
  return decideDemoGate(runId, { approve: true });
}

/** Send the run back with a note: the plan gate re-runs the planner, the review gate the recorder. */
export function sendBackDemo(runId: string, note: string): Promise<DecisionOutcome> {
  return decideDemoGate(runId, { approve: false, action: 'request_changes', amend: note });
}

/** The note that asks the recorder to re-record ONE chapter (the review gate's "Re-record"). */
export function rerecordNote(chapter: DemoChapter, finding?: DemoFinding): string {
  const why = finding !== undefined ? ` The review found: ${finding.issue} (at ${finding.at}).` : '';
  return `Re-record only chapter ${chapter.key} ("${chapter.title}").${why} Leave every other segment as it is, restitch, and regenerate the contact sheets.`;
}

/** The step a stage belongs to, for the stepper: plan → record → review → watch. */
export type DemoStep = 'plan' | 'record' | 'review' | 'watch';

export function stepOf(stage: DemoStage): DemoStep {
  switch (stage) {
    case 'preparing':
    case 'team_gate':
    case 'planning':
    case 'plan_gate':
      return 'plan';
    case 'recording':
      return 'record';
    case 'reviewing':
    case 'review_gate':
      return 'review';
    case 'done':
    case 'failed':
      return 'watch';
  }
}

/** What the run is doing, in one line. */
export const STAGE_LINE: Record<DemoStage, string> = {
  preparing: 'The team is scoping the demo before planning starts.',
  team_gate: 'The team has laid out its steps: plan, record, review. Approve them to start planning.',
  planning: 'The planner is framing the story, rehearsing the app and writing the script.',
  plan_gate: 'The plan is ready. Review the script and chapters before anything records.',
  recording: 'The recorder is filming each chapter as its own segment.',
  reviewing: 'A different seat is reviewing the contact sheets.',
  review_gate: 'The review is in. Accept the recording, or re-record a chapter.',
  done: 'The demo is ready to watch and share.',
  failed: 'The demo run stopped. Its files so far are below.',
};
