// "Show me this job", then "tell it …" in the page (lane voice-jobs), with a FAKE MIC and a STUB speech-to-text: the
// spoken reference resolves to a job (focused, only running, fuzzy, ambiguous → choose-one), a live preview tile
// opens on the dashboard (phase, rigor, checks, newest line, decision waiting), and "tell it …" maps to one action
// that is confirmed on screen before anything is sent.

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VoiceRoot } from '../src/components/voice/VoiceRoot.js';
import { normalizeSnapshot } from '../src/api/system.js';
import type { MicFrame, MicSource } from '../src/voice/io.js';
import { hear, openVoice, resetVoice, resetVoiceDeps, setVoiceDeps } from '../src/voice/controller.js';
import { resetDashStore, useDashStore } from '../src/voice/dashboardStore.js';
import { useVoiceStore } from '../src/store/voice.js';
import { useGateStore } from '../src/store/gates.js';
import { useRuntimeStore } from '../src/store/runtime.js';
import type { UnitInspection } from '../src/api/inspect.js';
import type { Rigor } from '../src/voice/jobs.js';

class FakeMic implements MicSource {
  onFrame: ((f: MicFrame) => void) | null = null;
  recording = false;
  live = false;
  async start(cb: (f: MicFrame) => void): Promise<void> { this.onFrame = cb; this.live = true; }
  record(): void { this.recording = true; }
  peek(): Blob | null { return null; }
  take(): Blob | null { const r = this.recording; this.recording = false; return r ? new Blob(['turn'], { type: 'audio/wav' }) : null; }
  stop(): void { this.recording = false; this.live = false; }
}

let mic: FakeMic;
let heard: string[];
const said: string[] = [];
const sent: Array<[string, ...unknown[]]> = [];
const classified: string[] = [];
let rigor: { power: boolean; rigor: Rigor | null; why: string | null } = { power: false, rigor: null, why: null };
let inspection: Partial<UnitInspection> = {};
let classifyReply = 'steer';

const STATUS = { local: true, ready: true, engine: { name: 'whisper.cpp', found: true, path: '/x/whisper-cli', install: null }, model: { name: 'base.en', present: true, bytes: 1, approxBytes: 1, source: 'x', download: null } };
const run = (runId: string, title: string, liveness: string, phase: string, unitOrd: number) => ({ runId, title, status: 'executing', liveness, reason: '', phase, unitOrd, seat: 'claude', lastEventAt: null, evidence: null, quietForMs: null, quietAfterMs: 1, stallAfterMs: 1, createdAt: null });
const SYSTEM = {
  checkedAt: '2026-10-31T10:00:00Z', budgetMs: 1, tookMs: 1, level: 'green', attention: [], clis: [], infra: [], governance: [],
  runs: [run('r-dark', 'Dark mode for settings', 'working', 'build', 2), run('r-hook', 'Retry failed webhook sends', 'working', 'build', 3)],
};
const VIEW = (id: string) => ({ run: { session: { id, status: 'executing', unit_ix: 1, problem: id, power: null }, units: [{ ord: 2, status: 'distributed', phase_ref: 'build', stage: 'build' }, { ord: 3, status: 'distributed', phase_ref: 'build', stage: 'build' }] } });
const EVENTS = { runId: 'r-hook', total: 1, returned: 1, events: [
  { type: 'repoChecksEvaluated', session: 'r-hook', passed: false, criterion: 'x', checks: [
    { name: 'lint', argv: [], source: 'x', exitCode: 0, timedOut: false, spawnError: null, durationMs: 1 },
    { name: 'test', argv: [], source: 'x', exitCode: 1, timedOut: false, spawnError: null, durationMs: 1 },
  ], seq: 1, ts: 1 },
] };

function respond(url: string): Response {
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
  if (url.endsWith('/voice/status')) return json(STATUS);
  if (url.endsWith('/voice/dashboard')) return json({ layout: null, widgets: [], updatedAt: null });
  if (url.endsWith('/system')) return json(SYSTEM);
  const ev = /\/runs\/([^/?]+)\/events/.exec(url);
  if (ev !== null) return json({ ...EVENTS, runId: ev[1], events: ev[1] === 'r-hook' ? EVENTS.events : [] });
  const one = /\/runs\/([^/?]+)$/.exec(url);
  if (one !== null) return json(VIEW(decodeURIComponent(one[1]!)));
  return json({ error: 'Not Found' }, 404);
}

/** Space bar: hold, the stub hears `words`, release. */
async function say(words: string): Promise<void> {
  heard.push(words);
  const full = screen.getByTestId('voice-full');
  await act(async () => { fireEvent.keyDown(full, { key: ' ' }); });
  await act(async () => { fireEvent.keyUp(full, { key: ' ' }); await new Promise((r) => setTimeout(r, 0)); });
}

beforeEach(() => {
  heard = []; said.length = 0; sent.length = 0; classified.length = 0;
  rigor = { power: false, rigor: null, why: null }; inspection = {}; classifyReply = 'steer';
  mic = new FakeMic();
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => respond(url)));
  setVoiceDeps({
    mic: () => mic,
    stt: { transcribe: async () => heard.shift() ?? '' },
    speaker: { available: true, say: async (t) => { said.push(t); }, cancel: () => undefined },
    ask: async () => 'An answer.',
    steer: async (runId, text) => { sent.push(['steer', runId, text]); },
    editDoc: async (runId, section, text) => { sent.push(['doc', runId, section, text]); },
    stop: (runId, title, reason) => { sent.push(['stop', runId, reason]); },
    rigorOf: async () => rigor,
    raiseRigor: async (runId, to, reason) => { sent.push(['rigor', runId, to, reason]); },
    inspect: async (runId) => { sent.push(['inspect', runId]); return { id: 'i1', runId, ord: 3, attempt: 0, state: 'done', verdict: 'looping', doing: 'It keeps rerunning the same failing test.', progress: null, evidence: [], action: 'steer', note: 'Fix the fixture path first', why: null, ...inspection } as UnitInspection; },
    classify: async (words) => { classified.push(words); return classifyReply; },
    recent: async () => [{ runId: 'r-hookdocs', title: 'Document the webhook payloads', running: false }],
    decide: async (runId, d) => { sent.push(['gate', runId, d]); return 'sent'; },
    endChat: () => undefined,
    now: () => 0,
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

async function enterFull(focus: string | null = null): Promise<void> {
  render(<VoiceRoot />);
  await act(async () => { await openVoice({ focus }); });
  fireEvent.click(within(screen.getByTestId('voice-entry-ask')).getByText('Yes, go to voice'));
  await waitFor(() => expect(screen.getByTestId('voice-full')).toBeTruthy());
  await act(async () => { await hear('space bar', 'typed'); });
  expect(useVoiceStore.getState().mode).toBe('space');
  await act(async () => { useDashStore.setState({ system: normalizeSnapshot(SYSTEM), raw: { system: SYSTEM, diagnostics: null } }); });
}

describe('show me this job', () => {
  it('a name opens the live preview: phase, rigor, checks, newest line, a decision waiting; then pin, other, close', async () => {
    await enterFull();
    await act(async () => { useRuntimeStore.setState((s) => ({ outputs: { ...s.outputs, 'r-hook:u3': 'Reading the retry queue\nAdding a backoff to sendWebhook()' } })); });
    await act(async () => { useGateStore.setState({ gates: {} }); });
    await say('show me the webhook retries job');
    const tile = await screen.findByTestId('voice-job');
    expect(tile.getAttribute('data-run')).toBe('r-hook');
    expect(within(tile).getByTestId('voice-job-title').textContent).toMatch(/Retry failed webhook sends/);
    expect(within(tile).getByTestId('voice-job-phase').textContent).toBe('build');
    await waitFor(() => expect(within(tile).getByTestId('voice-job-rigor').textContent).toBe('phased run'));
    await waitFor(() => expect(within(tile).getByTestId('voice-job-checks').textContent).toBe('1 of 2 passed · test failed'));
    expect(within(tile).getByTestId('voice-job-said').textContent).toMatch(/Adding a backoff to sendWebhook\(\)/);
    expect(within(tile).getByTestId('voice-job-gates').textContent).toBe('nothing on you');
    expect(said.some((s) => /Here’s “Retry failed webhook sends”\. Build phase, working\./.test(s))).toBe(true);
    // A decision arriving shows on the tile.
    await act(async () => { useGateStore.setState({ gates: { 'r-hook': { runId: 'r-hook', ord: 3, prompt: 'Approve the review', lifecycle: 'open', receivedAt: 1 } } }); });
    expect(within(screen.getByTestId('voice-job')).getByTestId('voice-job-gates').textContent).toMatch(/a decision/);
    await say('pin it');
    expect(screen.getByTestId('voice-job').getAttribute('data-pinned')).toBe('true');
    expect(localStorage.getItem('studio.voice.pinnedJob')).toBe('r-hook');
    await say('show me the other one');
    await waitFor(() => expect(screen.getByTestId('voice-job').getAttribute('data-run')).toBe('r-dark'));
    await say('close it');
    expect(screen.queryByTestId('voice-job')).toBeNull();
    expect(sent).toEqual([]);
  });

  it('"this job" is the page voice was opened from; with no focus, the only running job', async () => {
    await enterFull('r-dark');
    await say('show me this job');
    await waitFor(() => expect(screen.getByTestId('voice-job').getAttribute('data-run')).toBe('r-dark'));
  });

  it('several matches ask which, with a guided choose-one; "the second one" picks', async () => {
    await enterFull();
    await say('show me the webhook job');
    const pick = await screen.findByTestId('voice-ask-pickJob');
    expect(within(pick).getAllByText('Retry failed webhook sends').length).toBeGreaterThan(0);
    expect(within(pick).getAllByText('Document the webhook payloads').length).toBeGreaterThan(0);
    expect(screen.queryByTestId('voice-job')).toBeNull();
    await say('the second one');
    await waitFor(() => expect(screen.getByTestId('voice-job').getAttribute('data-run')).toBe('r-hookdocs'));
  });

  it('a job it cannot find says what is running', async () => {
    await enterFull();
    await say('show me the database migration job');
    await waitFor(() => expect(said.some((s) => /couldn’t find a job called “database migration”.*Running now/.test(s))).toBe(true));
    expect(screen.queryByTestId('voice-job')).toBeNull();
  });
});

describe('tell it …', () => {
  it('a steer is confirmed on screen first; nothing is sent until Confirm', async () => {
    await enterFull();
    await say('show me the webhook retries job');
    await screen.findByTestId('voice-job');
    await say('tell it to keep the old URL working');
    const ask = await screen.findByTestId('voice-ask-steer');
    expect(within(ask).getByText('Send to “Retry failed webhook sends”: “Keep the old URL working”?')).toBeTruthy();
    expect(sent).toEqual([]);
    await say('hmm');
    expect(sent).toEqual([]);
    await say('confirm');
    await waitFor(() => expect(sent).toEqual([['steer', 'r-hook', 'Keep the old URL working']]));
    await waitFor(() => expect(screen.getAllByTestId('voice-ask-record').at(-1)?.textContent).toBe('Sent to Retry failed webhook sends · by voice'));
  });

  it('"not that" sends nothing', async () => {
    await enterFull('r-dark');
    await say('tell it to use CSS variables');
    await screen.findByTestId('voice-ask-steer');
    await say('not that');
    await waitFor(() => expect(screen.getAllByTestId('voice-ask-record').at(-1)?.textContent).toMatch(/Not sent/));
    expect(sent).toEqual([]);
  });

  it('stop asks for a reason when none was said, then confirms; the stop goes through the ordinary Stop', async () => {
    await enterFull('r-hook');
    await say('stop it');
    await screen.findByTestId('voice-ask-stopReason');
    expect(sent).toEqual([]);
    await say('because it is pointed at the wrong repo');
    const ask = await screen.findByTestId('voice-ask-stop');
    expect(within(ask).getByText('Stop “Retry failed webhook sends” because “It is pointed at the wrong repo”?')).toBeTruthy();
    expect(sent).toEqual([]);
    fireEvent.click(within(ask).getByText('Stop it'));
    await waitFor(() => expect(sent).toEqual([['stop', 'r-hook', 'It is pointed at the wrong repo']]));
  });

  it('raise rigor: a phased job says it has none; a power job is raised one level after Confirm', async () => {
    await enterFull('r-hook');
    await say('raise the rigor');
    await waitFor(() => expect(said.some((s) => /runs phased, so it has no rigor to raise/.test(s))).toBe(true));
    rigor = { power: true, rigor: 'standard', why: null };
    await say('raise the rigor');
    const ask = await screen.findByTestId('voice-ask-rigor');
    expect(within(ask).getByText('Raise “Retry failed webhook sends”’s rigor from standard to high?')).toBeTruthy();
    await say('confirm');
    await waitFor(() => expect(sent).toEqual([['rigor', 'r-hook', 'high', 'Asked by voice: “raise the rigor”']]));
  });

  it('check on it: confirmed, then the verdict is said and its suggested steer offered, never sent on its own', async () => {
    await enterFull('r-hook');
    await say('check on it');
    await screen.findByTestId('voice-ask-check');
    expect(sent).toEqual([]);
    await say('confirm');
    await waitFor(() => expect(said.some((s) => /looks like it’s looping\. It keeps rerunning the same failing test\./.test(s))).toBe(true));
    const offer = await screen.findByTestId('voice-ask-steer');
    expect(within(offer).getByText('Send to “Retry failed webhook sends”: “Fix the fixture path first”?')).toBeTruthy();
    expect(sent).toEqual([['inspect', 'r-hook']]);
  });

  it('a constraint goes to the working document after Confirm', async () => {
    await enterFull('r-hook');
    await say('add a constraint: keep /v1/hooks working');
    const ask = await screen.findByTestId('voice-ask-doc');
    fireEvent.click(within(ask).getByText('Add the constraint'));
    await waitFor(() => expect(sent).toEqual([['doc', 'r-hook', 'constraints', 'Keep /v1/hooks working']]));
  });

  it('words that match nothing, with a job in view, get one classification, then the same confirm', async () => {
    await enterFull();
    await say('show me the dark mode job');
    await screen.findByTestId('voice-job');
    await say('make the toggle remember its state');
    await screen.findByTestId('voice-ask-steer');
    expect(classified).toEqual(['make the toggle remember its state']);
    expect(sent).toEqual([]);
    // A question is not classified: it goes to the system chat.
    await say('what is it working on?');
    expect(classified).toHaveLength(1);
  });

  it('a decision on the job in view is answered through the gate confirm, with input voice', async () => {
    await enterFull('r-dark');
    await act(async () => { useGateStore.setState({ gates: { 'r-hook': { runId: 'r-hook', ord: 3, prompt: 'Approve the review', lifecycle: 'open', receivedAt: 1 } } }); });
    // The job that needs you comes into view.
    await waitFor(() => expect(screen.getByTestId('voice-job').getAttribute('data-run')).toBe('r-hook'));
    await say('approve it');
    await screen.findByTestId('voice-ask-gate');
    expect(sent).toEqual([]);
    await say('confirm');
    await waitFor(() => expect(sent).toEqual([['gate', 'r-hook', { approve: true, input: 'voice' }]]));
  });

  it('a finished job cannot be steered', async () => {
    await enterFull();
    await say('tell the webhook payloads job to add an example');
    await waitFor(() => expect(said.some((s) => /has finished, so there’s nothing to steer/.test(s))).toBe(true));
    expect(sent).toEqual([]);
  });
});
