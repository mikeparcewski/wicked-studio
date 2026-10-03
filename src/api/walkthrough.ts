/**
 * The walkthrough's wire (DES-WALKTHROUGH-PROOF-001 §4.10, crew slices WT-W1..W3; api-types
 * 0.74.0 / 0.75.0 / 0.82.0): a recorded, chaptered walk through the real app by an evaluator seat,
 * with a check under every chapter — the proof the acceptance gate reads, and the demo you send.
 *
 *   GET /runs/:id/walkthrough?step=            → WalkthroughView (200 for every known run; the newest pair by default)
 *   GET /runs/:id/walkthrough/file?step=&path= → one proof-root file (mp4, png, jpg, json, md), Range-served
 *   PUT /runs/:id/walkthrough/storyline?step=  → "Edit the check" — accepted only while that pair's escalation gate is open (409 otherwise)
 *   POST /runs/:id/demo/export {format, atSec?} → a demo run's GIF or poster (EP-C3; `demo-video` kind only)
 *
 * The gate actions are the run's own gate (`POST /runs/:id/gate`): "Ask helpers to fix" is a
 * `request_changes`, "Edit the check" is the storyline PUT then an approve.
 *
 * ── INTEGRATION POINT ─────────────────────────────────────────────────────────────────────────
 * Hand-mirrored from crew api-types because studio's installed `wicked-crew-api-types` predates
 * them — delete these declarations and re-export from the contract package when studio bumps
 * (the `./demo.ts` precedent).
 */

import { apiBase, apiFetch } from './client.js';
import type { DemoChapter, DemoMarker } from './demo.js';
import { isRouteUnsupported } from './errors.js';

export type WalkthroughState = 'authoring' | 'linting' | 'starting_app' | 'recording' | 'judging' | 'passed' | 'failed' | 'inconclusive';
export type WalkthroughVerdict = 'PASS' | 'FAIL' | 'INCONCLUSIVE';
/** The seven check kinds (§4.5). */
export type WalkthroughCheckKind = 'on_screen' | 'saved_state' | 'events' | 'side_effects' | 'output' | 'must_not_happen' | 'cross_check';

export interface WalkthroughCheck {
  id: string;
  kind: WalkthroughCheckKind | string;
  /** The plain sentence the check proves. */
  sentence: string;
  /** `null` when the check never ran. */
  passed: boolean | null;
  /** Seconds into the CHAPTER when it was captured; `null` when it never ran. */
  atSec: number | null;
  /** Proof-root-relative paths. */
  evidence: string[];
  vaultEntry: string | null;
  detail: string | null;
}

export interface WalkthroughLeg {
  leg: string;
  claim_level: string;
  reason: string;
}

export interface WalkthroughChapter extends DemoChapter {
  index: number;
  total: number;
  verdict: WalkthroughVerdict | null;
  takes: number;
  failedAtSec: number | null;
  failedFrame: string | null;
  proves: string[];
  legs: WalkthroughLeg[];
  checks: WalkthroughCheck[];
}

export type WalkthroughCheckState = 'checked' | 'failed' | 'claimed' | 'owned_by_you';

export interface WalkthroughStepState {
  stepId: string;
  checkState: WalkthroughCheckState;
  provedBy: Array<{ chapter: string; atSec: number | null }>;
}

export interface WalkthroughView {
  runId: string;
  /** The `walkthrough_review` step id; `null` when the run has no walkthrough step. */
  stepId: string | null;
  planStepId: string | null;
  state: WalkthroughState;
  cause: string | null;
  seat: { evaluator: string | null; builders: string[] };
  tree: string | null;
  stale: false;
  sealed: boolean;
  video: { mp4: string | null; poster: string | null; markers: DemoMarker[] };
  chapters: WalkthroughChapter[];
  steps: WalkthroughStepState[];
}

/** `PUT /runs/:id/walkthrough/storyline` → 200: crew wrote the author's `storyline.mjs`, marked `edited_by: human`. */
export interface PutStorylineResponse {
  runId: string;
  planStepId: string;
  sha256: string;
  edited_by: 'human';
  /** ISO-8601. */
  at: string;
}

export type DemoExportFormat = 'gif' | 'poster';

export interface DemoExportResponse {
  format: DemoExportFormat;
  path: string;
  bytes: number;
}

const enc = encodeURIComponent;

export const walkthroughApi = {
  view: (runId: string, step?: string | null) =>
    apiFetch<WalkthroughView>(`/runs/${enc(runId)}/walkthrough${step != null ? `?step=${enc(step)}` : ''}`),
  /** The body is crew's `PutStorylineBody`: `{storyline}` — the whole storyline module text. */
  putStoryline: (runId: string, step: string, storyline: string) =>
    apiFetch<PutStorylineResponse>(`/runs/${enc(runId)}/walkthrough/storyline?step=${enc(step)}`, { method: 'PUT', body: JSON.stringify({ storyline }) }),
  demoExport: (runId: string, format: DemoExportFormat, atSec?: number) =>
    apiFetch<DemoExportResponse>(`/runs/${enc(runId)}/demo/export`, { method: 'POST', body: JSON.stringify(atSec === undefined ? { format } : { format, atSec }) }),
};

/** The contained file route of one proof-root file (a frame, the stitched take, a check's evidence). */
export function walkthroughFileUrl(runId: string, step: string | null, path: string): string {
  const q = new URLSearchParams();
  if (step !== null) q.set('step', step);
  q.set('path', path);
  return `${apiBase()}/runs/${enc(runId)}/walkthrough/file?${q.toString()}`;
}

/** A daemon before WT-W1 has no `/walkthrough` route: the artifact is simply absent. */
export function isWalkthroughUnsupported(e: unknown): boolean {
  return isRouteUnsupported(e);
}
