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
 * note as `amend` — at the plan gate the planner runs again; at the review gate the run goes back to
 * the plan too, and the engine records a whole new take of the plan you approve next
 * (DES-DEMO-RECORD-001 §3.6). There is no one-chapter re-record.
 *
 *   POST /runs/:id/demo/document   make (once) the run's editable cut: an interactive document of its segments
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
import type { DemoLaunchBody, DemoLaunchResponse, DemoStage, DemoChapter, DemoMarker, DemoFinding, DemoView, DemoDocumentResponse } from 'wicked-crew-api-types';
export type { DemoLaunchBody, DemoLaunchResponse, DemoStage, DemoChapter, DemoMarker, DemoFinding, DemoView, DemoDocumentResponse };

export const DEMO_PRESET = 'demo';
/** (wicked-core#1249) The preset for an app whose data stays out of model context: no model review step, the person
 *  reviews the take at the record step's own gate. */
export const DEMO_HUMAN_REVIEW_PRESET = 'demo-human-review';
const DEMO_PRESETS: readonly unknown[] = [DEMO_PRESET, DEMO_HUMAN_REVIEW_PRESET];

/** A demo run: launched from a demo preset. Read structurally — studio's api-types predates `team_plan`. */
export function isDemoRun(view: Pick<SessionView, 'session'>): boolean {
  const plan = (view.session as { team_plan?: { preset?: unknown } }).team_plan;
  return DEMO_PRESETS.includes(plan?.preset);
}

/** (wicked-core#1249) Who recorded a demo: the engine on this machine, in its jail (crew's `DemoView.producer`, read
 *  structurally until studio's api-types has it). `null` from a daemon before that field, or before `record`. */
export function demoProducer(view: DemoView): { kind: 'engine'; jail: string | null } | { kind: 'seat' } | null {
  const p = (view as { producer?: { kind?: unknown; jail?: unknown } | null }).producer;
  if (p?.kind === 'engine') return { kind: 'engine', jail: typeof p.jail === 'string' ? p.jail : null };
  if (p?.kind === 'seat') return { kind: 'seat' };
  return null;
}

/** One step of the approved storyline, in words (refs/storyline-json.md's closed list). */
export interface StorylineChapter {
  key: string;
  title: string;
  steps: string[];
}

function targetWords(t: unknown): string {
  if (t === null || typeof t !== 'object') return 'something';
  const o = t as Record<string, unknown>;
  const where = o.in === 'content' ? ' in the app' : '';
  if (typeof o.role === 'string') return `the ${o.role}${typeof o.name === 'string' ? ` “${o.name}”` : ''}${where}`;
  for (const k of ['text', 'button', 'section', 'testId', 'css'] as const) {
    if (typeof o[k] === 'string') return `${k === 'text' ? '' : `${k === 'testId' ? 'test id' : k} `}“${o[k] as string}”${where}`;
  }
  return 'something';
}

function stepWords(step: unknown): string[] {
  if (step === null || typeof step !== 'object') return [];
  const [verb, raw] = Object.entries(step as Record<string, unknown>)[0] ?? [];
  const a = (raw ?? {}) as Record<string, unknown>;
  const str = (v: unknown): string => (typeof v === 'string' ? v : '');
  switch (verb) {
    case 'go': return [`Open ${str(a.path)}`];
    case 'caption': return [`Caption: ${str(a.title)}`];
    case 'point': return [`Point at ${targetWords(a.target)}${str(a.label) !== '' ? ` (“${str(a.label)}”)` : ''}`];
    case 'unpoint': return [];
    case 'click': return [`Click ${targetWords(a.target)}`];
    case 'type': return [`Type “${str(a.text)}” into ${targetWords(a.target)}`];
    case 'hold': return [];
    case 'card': return [`Card: ${str(a.title)}`];
    case 'waitVisible': return [`Wait for ${targetWords(a.target)}`];
    case 'waitForPath': return [`Wait for ${str(a.path)}`];
    case 'fast': return [`Time-lapse: ${str(a.label)}`];
    case 'time': return Array.isArray(a.steps) ? (a.steps as unknown[]).flatMap(stepWords) : [];
    default: return [];
  }
}

/** The approved storyline (crew's `DemoView.storyline`) as chapters of plain-language steps; [] when there is none. */
export function storylineChapters(view: DemoView): StorylineChapter[] {
  const s = (view as { storyline?: unknown }).storyline;
  const segs = s !== null && typeof s === 'object' ? (s as { segments?: unknown }).segments : undefined;
  if (!Array.isArray(segs)) return [];
  return segs.flatMap((g) => {
    if (g === null || typeof g !== 'object') return [];
    const o = g as Record<string, unknown>;
    if (typeof o.key !== 'string') return [];
    return [{ key: o.key, title: typeof o.title === 'string' ? o.title : o.key, steps: Array.isArray(o.steps) ? (o.steps as unknown[]).flatMap(stepWords) : [] }];
  });
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

/** Make (once) the run's editable cut (crew imports the recorded segments into an interactive document; only once
 *  the run has completed or was cancelled). Idempotent: `created:false` when it was made before. */
export function makeDemoDocument(runId: string): Promise<DemoDocumentResponse> {
  return apiFetch<DemoDocumentResponse>(`/runs/${encodeURIComponent(runId)}/demo/document`, { method: 'POST', body: '{}' });
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

/** Send the run back with a note: at either gate the planner runs again, and the engine records a new whole take of
 *  the plan approved next. */
export function sendBackDemo(runId: string, note: string): Promise<DecisionOutcome> {
  return decideDemoGate(runId, { approve: false, action: 'request_changes', amend: note });
}

/**
 * The note "Record it again" sends back to the planner (the review gate's one re-record verb, operator ruling D3): the
 * engine records every chapter again, from the plan approved next. With a chapter, it names what to change there.
 * `private` (the app's rows stay out of model context, DES-DEMO-RECORD-001 §3.7): the finding's words are left out;
 * the note carries the chapter's key, title and time only.
 */
export function rerecordNote(chapter?: Pick<DemoChapter, 'key' | 'title'>, finding?: DemoFinding, opts: { private?: boolean } = {}): string {
  const at = finding !== undefined && finding.at !== '' ? ` (at ${finding.at})` : '';
  const why = finding !== undefined && opts.private !== true ? ` The review found: ${finding.issue}${at}.` : at !== '' ? ` See the take${at}.` : '';
  const where = chapter !== undefined ? ` Change the plan for chapter ${chapter.key} ("${chapter.title}").${why}` : why;
  return `Record the demo again as a new take.${where} Every chapter is recorded again from the plan you approve next.`;
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
  review_gate: 'The take is ready to review. Accept it, or record it again.',
  done: 'The demo is ready to watch and share.',
  failed: 'The demo run stopped. Its files so far are below.',
};
