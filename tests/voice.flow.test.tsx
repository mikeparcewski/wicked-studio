// Voice mode end to end in the page (DES-VOICE §2a; mockup state g), with a FAKE AUDIO STREAM and a STUB
// speech-to-text: the modal asks, answers a question about voice, then asks again; Yes opens full screen; the
// second question picks the listening mode; a question goes to the system chat; a steer is proposed and sent only
// on Send; a gate answer by voice stops at Confirm and goes out through the undo window with input "voice"; Esc
// leaves and releases the mic. The dashboard's widgets can be removed, added and made.

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VoiceRoot } from '../src/components/voice/VoiceRoot.js';
import { normalizeSnapshot } from '../src/api/system.js';
import type { MicFrame, MicSource } from '../src/voice/io.js';
import { closeVoice, holdToTalk, openVoice, resetVoice, resetVoiceDeps, setVoiceDeps } from '../src/voice/controller.js';
import { resetDashStore, useDashStore } from '../src/voice/dashboardStore.js';
import { useVoiceStore } from '../src/store/voice.js';
import { useGateStore } from '../src/store/gates.js';

/** A fake microphone: the test speaks into it frame by frame; a turn's audio is a stand-in blob. */
class FakeMic implements MicSource {
  onFrame: ((f: MicFrame) => void) | null = null;
  recording = false;
  stops = 0;
  live = false;
  async start(cb: (f: MicFrame) => void): Promise<void> { this.onFrame = cb; this.live = true; }
  record(): void { this.recording = true; }
  peek(): Blob | null { return this.recording ? new Blob(['partial'], { type: 'audio/wav' }) : null; }
  take(): Blob | null { const r = this.recording; this.recording = false; return r ? new Blob(['turn'], { type: 'audio/wav' }) : null; }
  stop(): void { this.stops += 1; this.live = false; this.recording = false; }
}

let clock = 0;
let mic: FakeMic;
let heard: string[];
const said: string[] = [];
const asked: string[] = [];
const steered: Array<[string, string]> = [];
const decided: Array<[string, unknown]> = [];
let ended = 0;
let puts: unknown[] = [];

const STATUS = { local: true, ready: true, engine: { name: 'whisper.cpp', found: true, path: '/x/whisper-cli', install: null }, model: { name: 'base.en', present: true, bytes: 1, approxBytes: 148897792, source: 'huggingface.co/ggerganov/whisper.cpp', download: null } };
const SYSTEM = {
  checkedAt: '2026-10-31T10:00:00Z', budgetMs: 1, tookMs: 1, level: 'green', attention: [], clis: [],
  runs: [
    { runId: 'r-dark', title: 'Dark mode for settings', status: 'executing', liveness: 'working', reason: '', phase: 'build', unitOrd: 2, seat: 'claude', lastEventAt: null, evidence: null, quietForMs: null, quietAfterMs: 1, stallAfterMs: 1, createdAt: null },
    { runId: 'r-hook', title: 'Retry failed webhook sends', status: 'awaiting_human', liveness: 'waiting_on_you', reason: '', phase: 'deliver', unitOrd: 5, seat: null, lastEventAt: null, evidence: null, quietForMs: null, quietAfterMs: 1, stallAfterMs: 1, createdAt: null },
  ],
  infra: [{ key: 'load', label: 'Load', state: 'degraded', reason: 'load 31 on 14 cores', remedy: null, checkedAt: '2026-10-31T10:00:00Z', durationMs: 1, details: { load1: 31, cores: 14 } }],
  governance: [],
};

let status: unknown = STATUS;
const modelPosts: unknown[] = [];

function respond(url: string, init?: RequestInit): Response {
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
  if (url.endsWith('/voice/model') && init?.method === 'POST') { modelPosts.push(JSON.parse(String(init.body))); return json(status, 202); }
  if (url.endsWith('/voice/status')) return json(status);
  if (url.endsWith('/voice/dashboard') && init?.method === 'PUT') { const b = JSON.parse(String(init.body)) as object; puts.push(b); return json({ ...b, updatedAt: 'now' }); }
  if (url.endsWith('/voice/dashboard')) return json({ layout: null, widgets: [], updatedAt: null });
  if (url.endsWith('/system')) return json(SYSTEM);
  if (url.includes('/roster/record')) return json({ seats: [{ cli: 'claude', units: 3, costUsd: 4.2 }], truncated: false });
  return json({ error: 'Not Found' }, 404);
}

/** Speak into the fake mic: a sustained voice, then a pause long enough to end the turn. */
async function speak(words: string): Promise<void> {
  heard.push(words);
  await act(async () => {
    for (let t = 0; t <= 300; t += 50) { clock += 50; mic.onFrame?.({ level: 0.3, bars: [0.6, 0.4] }); }
    for (let t = 0; t <= 1100; t += 100) { clock += 100; mic.onFrame?.({ level: 0.001, bars: [0, 0] }); }
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

/** Space bar: hold, (the stub hears `words`), release. */
async function holdAndSay(words: string): Promise<void> {
  heard.push(words);
  const full = screen.getByTestId('voice-full');
  await act(async () => { fireEvent.keyDown(full, { key: ' ' }); });
  await act(async () => { fireEvent.keyUp(full, { key: ' ' }); await new Promise((r) => setTimeout(r, 0)); });
}

beforeEach(() => {
  status = STATUS; modelPosts.length = 0;
  clock = 0; heard = []; said.length = 0; asked.length = 0; steered.length = 0; decided.length = 0; ended = 0; puts = [];
  mic = new FakeMic();
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => respond(url, init)));
  setVoiceDeps({
    mic: () => mic,
    stt: { transcribe: async () => heard.shift() ?? '' },
    speaker: { available: true, say: async (t) => { said.push(t); }, cancel: () => undefined },
    ask: async (q) => { asked.push(q); return 'Two jobs. Dark mode is on build; the webhook retries wait on you.'; },
    steer: async (runId, text) => { steered.push([runId, text]); },
    decide: async (runId, d) => { decided.push([runId, d]); return 'sent'; },
    endChat: () => { ended += 1; },
    now: () => clock,
  });
  useGateStore.setState({ gates: {} });
  resetDashStore();
});

afterEach(() => {
  resetVoice();
  resetVoiceDeps();
  cleanup();
  vi.unstubAllGlobals();
});

async function enterFull(): Promise<void> {
  render(<VoiceRoot />);
  await act(async () => { await openVoice(); });
  await speak('yes');
  await waitFor(() => expect(screen.getByTestId('voice-full')).toBeTruthy());
}

describe('voice mode', () => {
  it('the modal asks, answers a question about voice and asks again; the mic is on only while it is open', async () => {
    render(<VoiceRoot />);
    await act(async () => { await openVoice(); });
    expect(screen.getByRole('dialog', { name: 'Voice mode' })).toBeTruthy();
    expect(screen.getByTestId('voice-mic-state').textContent).toMatch(/listening only while this is open/);
    expect(screen.getByText('Do you want to enter voice mode?')).toBeTruthy();
    expect(said).toContain('Do you want to enter voice mode?');
    await speak('What happens to my voice? Is it recorded?');
    expect(screen.getByTestId('voice-heard').textContent).toMatch(/what happens to my voice/i);
    expect(within(screen.getByTestId('voice-modal-thread')).getByText(/Nothing is recorded or sent anywhere/)).toBeTruthy();
    expect(said.at(-1)).toBe('Do you want to enter voice mode?');
    // No (said) closes it and releases the mic.
    await speak('no');
    expect(useVoiceStore.getState().phase).toBe('off');
    expect(screen.queryByTestId('voice-modal')).toBeNull();
    expect(mic.stops).toBe(1);
  });

  it('Esc closes the modal; tapping Yes opens full screen with the listening question', async () => {
    render(<VoiceRoot />);
    await act(async () => { await openVoice(); });
    fireEvent.keyDown(screen.getByTestId('voice-modal'), { key: 'Escape' });
    expect(useVoiceStore.getState().phase).toBe('off');
    await act(async () => { await openVoice(); });
    fireEvent.click(within(screen.getByTestId('voice-entry-ask')).getByText('Yes, go to voice'));
    await waitFor(() => expect(screen.getByTestId('voice-full')).toBeTruthy());
    expect(screen.getByTestId('voice-ask-mode')).toBeTruthy();
    expect(screen.getByText('How should I listen?')).toBeTruthy();
    expect(screen.getByTestId('voice-mode').textContent).toBe('Mode not chosen');
  });

  it('streaming: a partial line while you speak, then the question goes to the system chat and the reply is captioned and read aloud', async () => {
    await enterFull();
    await speak('streaming');
    expect(useVoiceStore.getState().mode).toBe('stream');
    expect(screen.getByTestId('voice-mode').textContent).toBe('● Streaming');
    // Speak without pausing yet: a partial transcription shows as a muted line.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      heard.push('what is running');
      await act(async () => { for (let t = 0; t < 4; t++) { clock += 50; mic.onFrame?.({ level: 0.3, bars: [0.5] }); } });
      await act(async () => { vi.advanceTimersByTime(1600); await new Promise((r) => setTimeout(r, 0)); });
      const partial = useVoiceStore.getState().lines.at(-1);
      expect(partial).toMatchObject({ who: 'you', partial: true, text: 'what is running' });
      heard.push('What is running right now?');
      await act(async () => { for (let t = 0; t <= 1100; t += 100) { clock += 100; mic.onFrame?.({ level: 0.001, bars: [0] }); } await new Promise((r) => setTimeout(r, 0)); });
    } finally { vi.useRealTimers(); }
    await waitFor(() => expect(asked).toEqual(['What is running right now?']));
    await waitFor(() => expect(screen.getByText(/Dark mode is on build/)).toBeTruthy());
    expect(useVoiceStore.getState().lines.filter((l) => l.partial === true)).toEqual([]);
    expect(said).toContain('Two jobs. Dark mode is on build; the webhook retries wait on you.');
  });

  it('space bar: it hears only while Space is held; a steer is proposed and sent only on Send', async () => {
    await enterFull();
    await speak('space bar');
    expect(useVoiceStore.getState().mode).toBe('space');
    expect(screen.getByTestId('voice-ask-record').textContent).toMatch(/Listening: Space bar/);
    // A pause without Space held hears nothing.
    heard.push('ignored');
    await act(async () => { for (let t = 0; t < 30; t++) { clock += 100; mic.onFrame?.({ level: t < 5 ? 0.3 : 0.001, bars: [0] }); } });
    expect(heard).toEqual(['ignored']);
    heard.length = 0;
    await act(async () => { useDashStore.setState({ system: normalizeSnapshot(SYSTEM) }); });
    await holdAndSay('tell the dark mode job to use CSS variables');
    await waitFor(() => expect(screen.getByTestId('voice-ask-steer')).toBeTruthy());
    expect(screen.getByText('Send to “Dark mode for settings”: “Use CSS variables”?')).toBeTruthy();
    expect(steered).toEqual([]);
    fireEvent.click(within(screen.getByTestId('voice-ask-steer')).getByText('Send'));
    await waitFor(() => expect(steered).toEqual([['r-dark', 'Use CSS variables']]));
    await waitFor(() => expect(screen.getAllByTestId('voice-ask-record').at(-1)?.textContent).toMatch(/Sent to Dark mode for settings · by voice/));
  });

  it('a gate arriving is read out; a spoken answer stops at Confirm, and only "confirm" sends it, with input voice', async () => {
    await enterFull();
    await speak('space bar');
    await act(async () => { useDashStore.setState({ system: normalizeSnapshot(SYSTEM) }); });
    await act(async () => {
      useGateStore.setState({ gates: { 'r-hook': { runId: 'r-hook', ord: 5, prompt: 'Approve delivery?', lifecycle: 'open', receivedAt: 1, gateKind: 'deliver' } } });
    });
    await waitFor(() => expect(said.some((s) => /Retry failed webhook sends is waiting on you/.test(s))).toBe(true));
    expect(screen.getByTestId('voice-widget-builtin.gates').getAttribute('data-alert')).toBe('true');
    await holdAndSay('approve it and ship it');
    await waitFor(() => expect(screen.getByTestId('voice-ask-gate')).toBeTruthy());
    expect(screen.getByText('Heard “approve it and ship it”: Approve and deliver?')).toBeTruthy();
    expect(decided).toEqual([]);
    await holdAndSay('hmm maybe');
    expect(decided).toEqual([]);
    await holdAndSay('confirm');
    await waitFor(() => expect(decided).toEqual([['r-hook', { approve: true, input: 'voice' }]]));
    await waitFor(() => expect(screen.getAllByTestId('voice-ask-record').at(-1)?.textContent).toBe('Approved by you · by voice, confirmed'));
  });

  it('"not that" sends nothing; a send-back without a note asks for one', async () => {
    await enterFull();
    await speak('space bar');
    await act(async () => { useGateStore.setState({ gates: { 'r-hook': { runId: 'r-hook', ord: 5, prompt: 'Approve the review', lifecycle: 'open', receivedAt: 1 } } }); });
    await holdAndSay('send it back');
    await waitFor(() => expect(said.some((s) => /What should change/.test(s))).toBe(true));
    await holdAndSay('reject it');
    await waitFor(() => expect(screen.getByTestId('voice-ask-gate')).toBeTruthy());
    await holdAndSay('not that');
    await waitFor(() => expect(screen.getAllByTestId('voice-ask-record').at(-1)?.textContent).toMatch(/Not sent/));
    expect(decided).toEqual([]);
  });

  it('Esc leaves full screen: the mic is released and the voice chat ended', async () => {
    await enterFull();
    fireEvent.keyDown(screen.getByTestId('voice-full'), { key: 'Escape' });
    expect(useVoiceStore.getState().phase).toBe('off');
    expect(mic.stops).toBe(1);
    expect(ended).toBe(1);
    expect(mic.live).toBe(false);
  });

  it('typing reaches everything: words typed go where spoken words go', async () => {
    render(<VoiceRoot />);
    await act(async () => { await openVoice(); });
    fireEvent.change(screen.getByTestId('voice-modal-type-input'), { target: { value: 'yes' } });
    await act(async () => { fireEvent.submit(screen.getByTestId('voice-modal-type')); });
    await waitFor(() => expect(screen.getByTestId('voice-full')).toBeTruthy());
    fireEvent.click(within(screen.getByTestId('voice-ask-mode')).getByText('Streaming'));
    fireEvent.click(within(screen.getByTestId('voice-ask-mode')).getByTestId('ask-confirm'));
    fireEvent.change(screen.getByTestId('voice-type-input'), { target: { value: 'how busy is the machine?' } });
    await act(async () => { fireEvent.submit(screen.getByTestId('voice-type')); });
    await waitFor(() => expect(asked).toEqual(['how busy is the machine?']));
    expect(screen.getAllByTestId('voice-line-you').at(-1)?.textContent).toMatch(/^You/);
  });
});

describe('voice setup: what it needs before it can hear', () => {
  it('a missing model is fetched only on Download, with consent; nothing listens until it is here', async () => {
    status = { ...STATUS, ready: false, model: { ...STATUS.model, present: false, bytes: null } };
    render(<VoiceRoot />);
    await act(async () => { await openVoice(); });
    expect(screen.getByTestId('voice-model-consent').textContent).toMatch(/base\.en, about 142 MB, from huggingface\.co\/ggerganov\/whisper\.cpp.*never recorded or sent anywhere/);
    expect(screen.getByTestId('voice-mic-state').textContent).toMatch(/not hearing yet/);
    expect(modelPosts).toEqual([]);
    heard.push('yes');
    await act(async () => { for (let t = 0; t < 20; t++) { clock += 100; mic.onFrame?.({ level: t < 5 ? 0.3 : 0.001, bars: [0] }); } });
    expect(useVoiceStore.getState().phase).toBe('ask');
    expect(heard).toEqual(['yes']);
    await act(async () => { fireEvent.click(screen.getByTestId('voice-model-download')); await new Promise((r) => setTimeout(r, 0)); });
    expect(modelPosts).toEqual([{ consent: true }]);
    closeVoice();
  });

  it('an engine too old (or missing) says how to fix it', async () => {
    status = { ...STATUS, ready: false, engine: { ...STATUS.engine, version: null, supported: false, install: 'whisper.cpp at /x/whisper-cli is too old for voice: it needs 1.8.0 or later. Upgrade it: brew upgrade whisper-cpp.' } };
    render(<VoiceRoot />);
    await act(async () => { await openVoice(); });
    expect(screen.getByTestId('voice-engine-missing').textContent).toMatch(/too old for voice.*brew upgrade whisper-cpp/);
    closeVoice();
  });
});

describe('voice dashboard widgets', () => {
  it('shows the six built-ins, removes one from its header, adds it back from the picker, and saves the layout per person', async () => {
    await enterFull();
    await waitFor(() => expect(screen.getByTestId('voice-widget-builtin.load')).toBeTruthy());
    for (const id of ['load', 'health', 'helpers', 'jobs', 'gates', 'spend']) expect(screen.getByTestId(`voice-widget-builtin.${id}`)).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('voice-widget-builtin.load').textContent).toMatch(/load 31/));
    fireEvent.click(screen.getByTestId('voice-widget-remove-builtin.spend'));
    await waitFor(() => expect(screen.queryByTestId('voice-widget-builtin.spend')).toBeNull());
    expect(puts.at(-1)).toMatchObject({ layout: ['builtin.load', 'builtin.health', 'builtin.helpers', 'builtin.jobs', 'builtin.gates'], widgets: [] });
    fireEvent.click(screen.getByTestId('voice-widget-add'));
    const picker = screen.getByTestId('voice-picker');
    fireEvent.click(within(picker).getByText('Today'));
    fireEvent.click(within(picker).getByTestId('ask-confirm'));
    await waitFor(() => expect(screen.getByTestId('voice-widget-builtin.spend')).toBeTruthy());
    expect((puts.at(-1) as { layout: string[] }).layout.at(-1)).toBe('builtin.spend');
  });

  it('makes a metric widget from a /system field (a user plugin in the voice-dashboard slot)', async () => {
    await enterFull();
    await waitFor(() => expect(useDashStore.getState().raw.system).not.toBeNull());
    fireEvent.click(screen.getByTestId('voice-widget-add'));
    fireEvent.click(screen.getByTestId('voice-make-widget'));
    fireEvent.change(screen.getByTestId('voice-builder-filter'), { target: { value: 'load1' } });
    fireEvent.change(screen.getByTestId('voice-builder-field'), { target: { value: 'infra[key=load].details.load1' } });
    expect((screen.getByTestId('voice-builder-title') as HTMLInputElement).value).toBe('Load1');
    fireEvent.change(screen.getByTestId('voice-builder-title'), { target: { value: 'Load now' } });
    fireEvent.click(screen.getByTestId('voice-builder-chart'));
    expect(screen.getByTestId('voice-builder-preview').textContent).toBe('Load now: 31');
    fireEvent.click(screen.getByTestId('voice-builder-save'));
    await waitFor(() => expect(screen.getByTestId('voice-widget-user.load-now')).toBeTruthy());
    expect(screen.getByTestId('voice-widget-user.load-now').textContent).toMatch(/31/);
    const saved = puts.at(-1) as { layout: string[]; widgets: Array<Record<string, unknown>> };
    expect(saved.layout.at(-1)).toBe('user.load-now');
    expect(saved.widgets[0]).toMatchObject({ id: 'user.load-now', kind: 'metric', panels: [{ slot: 'voice-dashboard' }], metric: { source: 'system', path: 'infra[key=load].details.load1', display: 'chart' } });
    closeVoice();
  });
});

describe('holdToTalk outside space mode', () => {
  it('does nothing', () => {
    holdToTalk(true);
    expect(useVoiceStore.getState().holding).toBe(false);
  });
});
