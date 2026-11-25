// studio#1400 (privacy): in "Space bar" (push-to-talk) mode nothing is kept, transcribed or sent unless Space (or the
// mic button) is held, and a held turn carries only the audio heard while it was held. The fake mic here keeps real
// "samples" (one tag per frame) the way BrowserMic does, so a test can see exactly which frames a sent recording holds.

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VoiceRoot } from '../src/components/voice/VoiceRoot.js';
import type { MicFrame, MicSource } from '../src/voice/io.js';
import { hear, openVoice, resetVoice, resetVoiceDeps, setVoiceDeps } from '../src/voice/controller.js';
import { resetDashStore } from '../src/voice/dashboardStore.js';
import { useVoiceStore } from '../src/store/voice.js';
import { useGateStore } from '../src/store/gates.js';

/** The frame tags each recording handed out holds (jsdom's Blob has no text()). */
const held = new WeakMap<Blob, string[]>();
const wavOf = (tags: string[]): Blob => { const b = new Blob(['wav']); held.set(b, [...tags]); return b; };
const tagsOf = (wav: Blob): string[] => held.get(wav) ?? ['?'];

/** A mic that keeps a tag per frame while recording, as BrowserMic keeps sample chunks. */
class SampleMic implements MicSource {
  onFrame: ((f: MicFrame) => void) | null = null;
  kept: string[] | null = null;
  live = false;
  async start(cb: (f: MicFrame) => void): Promise<void> { this.onFrame = cb; this.live = true; }
  record(): void { this.kept = []; }
  peek(): Blob | null { return this.kept !== null && this.kept.length > 0 ? wavOf(this.kept) : null; }
  take(): Blob | null { const k = this.kept; this.kept = null; return k !== null && k.length > 0 ? wavOf(k) : null; }
  stop(): void { this.live = false; this.kept = null; }
  /** One audio frame: kept when recording (the mic does this before it reports the level), then reported. */
  frame(tag: string, level: number): void {
    if (this.kept !== null) this.kept.push(tag);
    this.onFrame?.({ level, bars: [level] });
  }
}

const STATUS = { local: true, ready: true, engine: { name: 'whisper.cpp', found: true, path: '/x/whisper-cli', install: null }, model: { name: 'base.en', present: true, bytes: 1, approxBytes: 1, source: 'x', download: null } };

let clock = 0;
let mic: SampleMic;
/** Every recording sent to speech-to-text, as the frame tags it held. */
let sent: string[][];
let reply: (tags: string[]) => string;

function respond(url: string): Response {
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
  if (url.endsWith('/voice/status')) return json(STATUS);
  if (url.endsWith('/voice/dashboard')) return json({ layout: null, widgets: [], updatedAt: null });
  return json({ error: 'Not Found' }, 404);
}

beforeEach(() => {
  clock = 0; sent = [];
  reply = () => '';
  mic = new SampleMic();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => respond(url)));
  setVoiceDeps({
    mic: () => mic,
    stt: { transcribe: async (wav) => { const tags = tagsOf(wav); sent.push(tags); return reply(tags); } },
    speaker: { available: true, say: async () => undefined, cancel: () => undefined },
    ask: async () => 'ok',
    endChat: () => undefined,
    now: () => clock,
  });
  useGateStore.setState({ gates: {} });
  resetDashStore();
});

afterEach(() => {
  vi.useRealTimers();
  resetVoice();
  resetVoiceDeps();
  cleanup();
  vi.unstubAllGlobals();
});

async function enterFull(): Promise<void> {
  render(<VoiceRoot />);
  await act(async () => { await openVoice(); });
  await act(async () => { await hear('yes', 'typed'); });
  await waitFor(() => expect(screen.getByTestId('voice-full')).toBeTruthy());
}

/** Room sound for `ms`, in 100 ms frames, with the partial timer advanced alongside. */
async function room(ms: number, tag = 'room'): Promise<void> {
  for (let t = 0; t < ms; t += 100) {
    await act(async () => { clock += 100; mic.frame(tag, 0.3); vi.advanceTimersByTime(100); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
}

/** Let pending promises (a transcription, its words acted on) settle; setTimeout is real in these tests. */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

/** Tap a listening mode on the mode question: pick its card, then the card's confirm button. */
async function tapMode(label: string): Promise<void> {
  const card = screen.getByTestId('voice-ask-mode');
  await act(async () => { fireEvent.click(within(card).getAllByText(label)[0]!.closest('button')!); });
  await act(async () => { fireEvent.click(within(card).getByTestId('ask-confirm')); });
}

const youLines = (): unknown[] => useVoiceStore.getState().lines.filter((l) => l.who === 'you');

describe('push-to-talk keeps nothing unless Space is held (studio#1400)', () => {
  it('Space bar tapped while the room talks: nothing is kept or transcribed until Space is held, and the held turn has only held audio', async () => {
    await enterFull();
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    // The room talks while the mode question listens: a recording and its partials start.
    await room(600);
    // Space bar is tapped mid-sentence.
    await tapMode('Space bar');
    expect(useVoiceStore.getState().mode).toBe('space');
    sent = [];
    const linesBefore = youLines().length;
    // 40 s of room talk with nothing held.
    await room(40_000);
    expect(sent).toEqual([]);
    expect(mic.kept).toBeNull();
    expect(youLines().length).toBeLessThanOrEqual(linesBefore);
    expect(youLines().some((l) => (l as { partial?: boolean }).partial === true)).toBe(false);
    expect(screen.getByTestId('voice-mode').textContent).toBe('Hold Space to talk');
    // Space held for 3 s, then released: the turn sent is the held audio only.
    reply = () => 'what is running';
    const full = screen.getByTestId('voice-full');
    await act(async () => { fireEvent.keyDown(full, { key: ' ' }); });
    expect(screen.getByTestId('voice-mode').textContent).toBe('● Listening');
    await room(3000, 'held');
    await act(async () => { fireEvent.keyUp(full, { key: ' ' }); });
    await settle();
    expect(sent.length).toBe(1);
    expect(sent[0]!.length).toBe(30);
    expect(new Set(sent[0])).toEqual(new Set(['held']));
    // Released: nothing is kept again.
    await room(5000);
    expect(sent.length).toBe(1);
    expect(mic.kept).toBeNull();
  });

  it('Space bar said while the room keeps talking: a recording begun before the answer landed is dropped, not sent', async () => {
    await enterFull();
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    // "Space bar" said, then a pause (the turn ends), but its transcription is still on the way when the room starts
    // talking again and a new recording begins.
    let land!: (t: string) => void;
    const answer = new Promise<string>((r) => { land = r; });
    setVoiceDeps({ stt: { transcribe: async (wav) => { const tags = tagsOf(wav); sent.push(tags); return tags.includes('me') ? answer : reply(tags); } } });
    await room(600, 'me');
    for (let t = 0; t < 1000; t += 100) await act(async () => { clock += 100; mic.frame('quiet', 0.001); });
    await room(600);
    expect(mic.kept).not.toBeNull();
    await act(async () => { land('space bar'); await answer; });
    await settle();
    expect(useVoiceStore.getState().mode).toBe('space');
    expect(mic.kept).toBeNull();
    const after = sent.length;
    await room(10_000);
    expect(sent.length).toBe(after);
    expect(sent.flat()).not.toContain('room');
  });

  it('the mic button held: only its own audio, never what came before the press', async () => {
    await enterFull();
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    await room(600);
    await tapMode('Space bar');
    await room(2000);
    sent = [];
    const hold = screen.getByTestId('voice-hold');
    await act(async () => { fireEvent.pointerDown(hold); });
    await room(1000, 'held');
    await act(async () => { fireEvent.pointerUp(hold); });
    await settle();
    expect(sent.length).toBe(1);
    expect(new Set(sent[0])).toEqual(new Set(['held']));
  });
});
