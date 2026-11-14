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
 * Read-aloud (text to speech), piper on this machine (wicked-crew#1548, api-types 0.209.0):
 *
 *   GET    /voice/tts            the python/engine/voice state on this machine → {@link VoiceTtsStatus}
 *   POST   /voice/tts           {consent: true, voices: [ids]}: install piper + the voices (202)
 *   DELETE /voice/tts           remove the engine and voices
 *   POST   /voice/speak         {text, voice} → audio/wav; spoken on this machine, nothing stored
 *   GET    /voice/tts/sample/:v  a short sample of one installed voice → audio/wav
 *
 * ── INTEGRATION POINT ──────────────────────────────────────────────────────────────────────────
 * The whisper shapes mirror `wicked-crew-api-types` 0.156.0 field for field (`VoiceStatus`,
 * `VoiceTranscribeResponse`, `VoiceDashboard`, `VoiceWidgetManifest`); the piper read-aloud shapes
 * (`VoiceTtsStatus`, `PostVoiceTtsBody`, `PostVoiceSpeakBody`) are imported from `wicked-crew-api-types` 0.209.0
 * and re-exported here. A crew without the routes answers 404: {@link isVoiceUnsupported}.
 */

import type { VoiceTtsStatus, PostVoiceTtsBody, PostVoiceSpeakBody } from 'wicked-crew-api-types';
import { apiBase, apiFetch, errorFromResponse } from './client.js';
import { ApiError, isRouteAbsent } from './errors.js';

export type { VoiceTtsStatus, PostVoiceTtsBody, PostVoiceSpeakBody };
/** One offered read-aloud voice — the inline shape of {@link VoiceTtsStatus.voices} (api-types 0.209.0 has no
 *  named per-voice type). An alias, not a copy. */
export type VoiceTtsVoice = VoiceTtsStatus['voices'][string];

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

// ── Read-aloud (piper text to speech) ────────────────────────────────────────────────────────

export function getVoiceTts(): Promise<VoiceTtsStatus> {
  return apiFetch<VoiceTtsStatus>('/voice/tts');
}

/** The person said yes to installing piper and these voices. Exactly `{consent: true, voices}` on the wire. */
export function installVoiceTts(voices: string[]): Promise<VoiceTtsStatus> {
  const body: PostVoiceTtsBody = { consent: true, voices };
  return apiFetch<VoiceTtsStatus>('/voice/tts', { method: 'POST', body: JSON.stringify(body) });
}

export function removeVoiceTts(): Promise<VoiceTtsStatus> {
  return apiFetch<VoiceTtsStatus>('/voice/tts', { method: 'DELETE' });
}

/**
 * A raw audio/wav fetch against the crew surface, for the two read-aloud routes `apiFetch` can't carry (it parses
 * JSON). It reuses the same base URL and the same error mapping as `apiFetch` so a refusal reads identically
 * (`voiceErrorCode`, `isVoiceUnsupported`), and returns the WAV bytes as an `ArrayBuffer` for Web Audio to decode.
 */
async function voiceWavFetch(path: string, init?: RequestInit): Promise<ArrayBuffer> {
  const headers = init?.body !== undefined && init?.body !== null ? { 'Content-Type': 'application/json', ...init?.headers } : { ...init?.headers };
  const res = await fetch(`${apiBase()}${path}`, { ...init, headers });
  // One shared parse (`errorFromResponse`), so a read-aloud refusal reads identically to every other
  // route (`voiceErrorCode`, `isVoiceUnsupported`).
  if (!res.ok) throw await errorFromResponse(res);
  return res.arrayBuffer();
}

/** Speak one piece of text on this machine with the chosen voice (POST /voice/speak → audio/wav). `signal` lets the
 *  speaker abort a pending fetch when the person barges in. */
export function speakVoiceText(text: string, voice: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  const body: PostVoiceSpeakBody = { text, voice };
  return voiceWavFetch('/voice/speak', { method: 'POST', body: JSON.stringify(body), ...(signal !== undefined ? { signal } : {}) });
}

/** A short sample of one installed voice (GET /voice/tts/sample/:voice → audio/wav). */
export function voiceSampleBuffer(voice: string): Promise<ArrayBuffer> {
  return voiceWavFetch(`/voice/tts/sample/${encodeURIComponent(voice)}`);
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
