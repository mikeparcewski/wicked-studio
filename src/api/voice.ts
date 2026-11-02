/**
 * Voice mode's wire (program DES-VOICE; crew `feat/voice-mode`, api-types 0.156.0; engine version 0.158.0):
 *
 *   GET    /voice/status       the engine (whisper.cpp) and the model on this machine
 *   POST   /voice/model        {consent: true}: fetch the model (202)
 *   DELETE /voice/model        remove it
 *   POST   /voice/transcribe   audio/wav → {text, ms, model}; the audio is never stored
 *   GET    /voice/dashboard    this person's dashboard: layout + the widgets they made
 *   PUT    /voice/dashboard    {layout, widgets}
 *
 * ── INTEGRATION POINT ──────────────────────────────────────────────────────────────────────────
 * The shapes mirror `wicked-crew-api-types` 0.156.0 field for field (`VoiceStatus`, `VoiceTranscribeResponse`,
 * `VoiceDashboard`, `VoiceWidgetManifest`); studio pins an older contract, so swap these for the contract's on the
 * next pin. A crew without the routes answers 404: {@link isVoiceUnsupported}.
 */

import { apiFetch } from './client.js';
import { ApiError, isRouteAbsent } from './errors.js';

export interface VoiceStatus {
  local: true;
  ready: boolean;
  /** `version` / `supported` (api-types 0.158.0): an engine too old to keep stdin output off disk is refused; absent
   *  on crew 0.156.0 (read as supported when found). */
  engine: { name: 'whisper.cpp'; found: boolean; path: string | null; install: string | null; version?: string | null; supported?: boolean };
  model: {
    name: string;
    present: boolean;
    bytes: number | null;
    approxBytes: number;
    source: string;
    download: { state: 'running' | 'failed'; receivedBytes: number; totalBytes: number | null; startedAt: string; error: string | null } | null;
  };
}

export interface VoiceTranscribeResponse { text: string; ms: number; model: string }

export interface VoicePanelDecl { slot: 'voice-dashboard'; id: string; title: string; order: number }

export interface VoiceWidgetManifest {
  id: string;
  title: string;
  version: 1;
  kind: 'metric';
  panels: [VoicePanelDecl];
  metric: { source: 'system' | 'diagnostics'; path: string; display: 'number' | 'chart'; unit?: string };
  createdAt?: string;
}

export interface VoiceDashboard { layout: string[] | null; widgets: VoiceWidgetManifest[]; updatedAt: string | null }

export function getVoiceStatus(): Promise<VoiceStatus> {
  return apiFetch<VoiceStatus>('/voice/status');
}

/** The person said yes to fetching the model. */
export function downloadVoiceModel(): Promise<VoiceStatus> {
  return apiFetch<VoiceStatus>('/voice/model', { method: 'POST', body: JSON.stringify({ consent: true }) });
}

export function removeVoiceModel(): Promise<VoiceStatus> {
  return apiFetch<VoiceStatus>('/voice/model', { method: 'DELETE' });
}

/** Send one recording (a 16 kHz mono WAV) to be transcribed on this machine. */
export function transcribeWav(wav: Blob): Promise<VoiceTranscribeResponse> {
  return apiFetch<VoiceTranscribeResponse>('/voice/transcribe', { method: 'POST', body: wav, headers: { 'Content-Type': 'audio/wav' } });
}

export function getVoiceDashboard(): Promise<VoiceDashboard> {
  return apiFetch<VoiceDashboard>('/voice/dashboard');
}

export function putVoiceDashboard(body: { layout: string[]; widgets: VoiceWidgetManifest[] }): Promise<VoiceDashboard> {
  return apiFetch<VoiceDashboard>('/voice/dashboard', { method: 'PUT', body: JSON.stringify(body) });
}

/** A crew without voice's routes (a bare 404 / unknown route). */
export function isVoiceUnsupported(e: unknown): boolean {
  return isRouteAbsent(e);
}

/** The refusal code crew put on a voice error (`voice_busy`, `voice_model_missing`, …), when it has one. */
export function voiceErrorCode(e: unknown): string | null {
  if (!(e instanceof ApiError)) return null;
  const code = (e.body as { code?: unknown } | null | undefined)?.code;
  return typeof code === 'string' ? code : null;
}
