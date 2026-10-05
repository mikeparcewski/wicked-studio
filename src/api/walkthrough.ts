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
 * ── CONTRACT ───────────────────────────────────────────────────────────────────────────────────
 * Types come from `wicked-crew-api-types` (pin 0.92.0, ASK-S1); the hand-mirrored copies that lived
 * here while the pin lagged are gone.
 * `WalkthroughCheckKind` below is studio's own reading.
 */

import { apiBase, apiFetch } from './client.js';
import { isRouteUnsupported } from './errors.js';
/** The seven check kinds (§4.5). */
import type { WalkthroughState, WalkthroughVerdict, WalkthroughCheck, WalkthroughLeg, WalkthroughChapter, WalkthroughCheckState, WalkthroughStepState, WalkthroughView, PutStorylineResponse, DemoExportFormat, DemoExportResponse } from 'wicked-crew-api-types';
export type { WalkthroughState, WalkthroughVerdict, WalkthroughCheck, WalkthroughLeg, WalkthroughChapter, WalkthroughCheckState, WalkthroughStepState, WalkthroughView, PutStorylineResponse, DemoExportFormat, DemoExportResponse };

export type WalkthroughCheckKind = 'on_screen' | 'saved_state' | 'events' | 'side_effects' | 'output' | 'must_not_happen' | 'cross_check';

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
