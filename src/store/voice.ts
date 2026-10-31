import { create } from 'zustand';
import type { Ask } from '../api/ask.js';
import type { VoiceStatus } from '../api/voice.js';
import type { JobAction } from '../voice/jobs.js';

/**
 * Voice mode's state (DES-VOICE §2a; mockup learn-and-panels state g). The behaviour lives in
 * `voice/controller.ts`; components only render this.
 */

export type VoicePhase = 'off' | 'ask' | 'full';
export type ListenMode = 'stream' | 'space';

/** What an open ask is about, so a spoken answer goes to the right place. */
export type VoiceAskContext =
  | { kind: 'entry' }
  | { kind: 'mode' }
  | { kind: 'gate'; runId: string; heard: string; decision: { approve: boolean; action?: 'request_changes' | 'reject'; amend?: string }; record: string }
  | { kind: 'steer'; runId: string; title: string; message: string }
  /** "show me …" / "tell … to …" named several jobs: pick one, then `then` happens to it. */
  | { kind: 'pickJob'; runIds: string[]; then: { kind: 'show' } | { kind: 'act'; action: JobAction }; heard: string }
  /** "stop it" with no reason: the next words are the reason ("no reason" is fine). */
  | { kind: 'stopReason'; runId: string; title: string }
  /** "tell it …": one action on one job, confirmed before it is sent. */
  | { kind: 'job'; runId: string; title: string; action: JobAction; heard: string };

export interface VoiceLine {
  id: number;
  who: 'you' | 'it';
  text: string;
  /** Still being spoken (streaming) or still being answered. */
  partial?: boolean;
  /** An ask in the transcript (the guided-ask renderer draws it). */
  ask?: { ask: Ask; context: VoiceAskContext };
  /** Once answered: the record line ("Approved by you · by voice, confirmed"). */
  record?: string;
  /** Said by voice (a you-line), so the thread can say "You (by voice)". */
  spoken?: boolean;
}

export interface VoiceState {
  phase: VoicePhase;
  mode: ListenMode | null;
  /** The modal's own little exchange (asked a question about voice first). */
  modal: VoiceLine[];
  /** The full-screen transcript. */
  lines: VoiceLine[];
  /** The modal's "Heard: …" line. */
  heard: string | null;
  status: VoiceStatus | null;
  statusError: string | null;
  /** The browser said no to the mic (or it has none). */
  micError: string | null;
  micOn: boolean;
  /** Waveform bars (0..1). */
  bars: number[];
  /** Who the waveform shows. */
  speaking: 'you' | 'it' | 'idle';
  /** Space (or the mic button) is held. */
  holding: boolean;
  /** A recording is being transcribed. */
  transcribing: boolean;
  /** Replies are read aloud (captions are always on). */
  readAloud: boolean;
  /** The ask a spoken answer goes to, by line id (null = none open). */
  openAsk: number | null;
  /** A gate was read out and waits for a spoken answer. */
  awaitingGate: string | null;
  /** The last error said to the person (also a transcript line). */
  error: string | null;
  /** The job shown in the dashboard's live preview ("show me this job"); `pinned` keeps it when a gate arrives elsewhere,
   *  and across voice sessions. */
  preview: { runId: string; pinned: boolean } | null;
  /** The jobs the last choose-one offered, for "the other one". */
  lastChoice: string[];
  /** The run page voice was opened from: "this job" before anything is previewed. */
  pageFocus: string | null;
}

export const INITIAL_VOICE: VoiceState = {
  phase: 'off', mode: null, modal: [], lines: [], heard: null, status: null, statusError: null, micError: null,
  micOn: false, bars: [], speaking: 'idle', holding: false, transcribing: false, readAloud: true, openAsk: null,
  awaitingGate: null, error: null, preview: null, lastChoice: [], pageFocus: null,
};

export const useVoiceStore = create<VoiceState>(() => ({ ...INITIAL_VOICE }));

let nextLine = 1;
export function lineId(): number { return nextLine++; }

/** Everything but the waveform's per-frame fields (`bars`, `speaking`): a surface that selects this with `useShallow`
 *  re-renders when the conversation changes, not ~20 times a second while someone talks. */
export function withoutWave(s: VoiceState): Omit<VoiceState, 'bars' | 'speaking'> {
  const rest: Partial<VoiceState> = { ...s };
  delete rest.bars;
  delete rest.speaking;
  return rest as Omit<VoiceState, 'bars' | 'speaking'>;
}
