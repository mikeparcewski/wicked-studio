/**
 * VOICE MODE, PHASE 1 (program DES-VOICE §2a; mockup learn-and-panels state g; operator-approved 2026-10-31).
 *
 *  1. The modal: the mic in a composer (or ⌥V) opens a centred modal with a live waveform that asks, aloud and on
 *     screen, "Do you want to enter voice mode?". A question about voice is answered, then asked again. No (said,
 *     tapped or Esc) closes it; Yes opens full screen.
 *  2. Full screen: the transcript in the middle, the live system dashboard around it, and the second question:
 *     streaming, or space bar (push-to-talk).
 *  3. Speech to text on this machine (crew's whisper.cpp), read-aloud by the browser's speechSynthesis; captions
 *     are always on.
 *  4. Questions go to the system chat. A steer is proposed with Send / Not that. A gate answer by voice ALWAYS stops
 *     at an on-screen Confirm, then the usual 10 s undo, and carries `input: "voice"`.
 *
 * Privacy: the mic is on only while voice mode is open (the header and the browser both say so); samples live in
 * page memory, go to crew once and are dropped; nothing is written to disk.
 *
 * This module is the behaviour; `store/voice.ts` is the state; components render it. Every edge (mic, speech to
 * text, speaker, chat, gate, steer) is injectable, so the journeys run with a fake audio stream and a stub STT.
 */

import type { Ask, AskAnswer } from '../api/ask.js';
import { api } from '../api/client.js';
import { ApiError, apiStatus } from '../api/errors.js';
import { ensureWorkingDoc, getWorkingDoc, proposeWorkingDoc, type WorkingDocSectionId } from '../api/workingDoc.js';
import { powerApi, powerOf } from '../api/power.js';
import type { UnitInspection } from '../api/inspect.js';
import { jobTitle } from '../board/deskWords.js';
import { stopRun } from '../store/sheets.js';
import { actionWords, CLASSIFY_PROMPT, nextRigor, otherJob, parseJobWords, readClass, resolveJob, type JobAction, type JobRef, type Rigor } from './jobs.js';
import type { RosterSeat } from '../api/types.js';
import { downloadVoiceModel, getVoiceStatus, isVoiceUnsupported, voiceErrorCode, type VoiceStatus } from '../api/voice.js';
import { defaultSelection } from '../board/chatOpen.js';
import { commitGateDecision, gateLabel, type GateAnswer } from '../board/gateActions.js';
import { plainGateQuestion } from '../board/deskWords.js';
import { useAskThreadStore } from '../store/askThread.js';
import { useGateStore, type OpenGate } from '../store/gates.js';
import { getCachedRoster, setCachedRoster } from '../store/rosterCache.js';
import { useSystemStore } from '../store/systemSnapshot.js';
import type { SystemSnapshot } from '../api/system.js';
import { loadDashboard, readDashboardData, useDashStore } from './dashboardStore.js';
import { INITIAL_VOICE, lineId, useVoiceStore, type ListenMode, type VoiceAskContext, type VoiceLine } from '../store/voice.js';
import { isLeave, parseConfirm, parseEntry, parseGateAnswer, parseMode } from './intent.js';
import { BrowserMic, BrowserSpeaker, crewStt, type MicSource, type Speaker, type SttEngine } from './io.js';
import { Vad } from './vad.js';

// ── The edges ─────────────────────────────────────────────────────────────────────────────────

export interface VoiceDeps {
  mic: () => MicSource;
  stt: SttEngine;
  speaker: Speaker;
  /** Ask the system chat one question; resolves with the reply's words. */
  ask: (question: string) => Promise<string>;
  /** Send a steer note to a running job (said by voice: `input: "voice"`). */
  steer: (runId: string, text: string) => Promise<void>;
  /** Add to a job's working document (Constraints or Next), as the person, said by voice. */
  editDoc: (runId: string, section: 'constraints' | 'next', text: string) => Promise<void>;
  /** Stop a job through the ordinary Stop (10 s undo), with the reason. */
  stop: (runId: string, title: string, reason: string | null) => void;
  /** The job's rigor now, or `power: false` when it runs phased (no rigor to raise). */
  rigorOf: (runId: string) => Promise<{ power: boolean; rigor: Rigor | null; why: string | null }>;
  raiseRigor: (runId: string, to: Rigor, reason: string) => Promise<void>;
  /** Check on the job's current step (crew's in-flight analyzer); resolves once the check is done. */
  inspect: (runId: string) => Promise<UnitInspection>;
  /** One cheap classification of words that matched nothing (the system chat, asked for one word). */
  classify: (words: string, title: string) => Promise<string>;
  /** Recent jobs (finished ones too), for "show me the … job". */
  recent: () => Promise<JobRef[]>;
  /** Answer a gate (through the undo window). */
  decide: (runId: string, decision: GateAnswer, receipt: string) => Promise<string>;
  /** End the voice session's chat (history kept). */
  endChat: () => void;
  now: () => number;
}

let chatId: string | null = null;
let chatOpening: Promise<string> | null = null;

async function chatSeats(): Promise<string[]> {
  let roster: RosterSeat[] | null = getCachedRoster();
  if (roster === null) {
    const { roster: fetched } = await api.getRoster();
    setCachedRoster(fetched);
    roster = fetched;
  }
  return defaultSelection(roster, false).slice(0, 1);
}

async function openVoiceChat(): Promise<string> {
  if (chatId !== null) return chatId;
  chatOpening ??= (async () => {
    const clis = await chatSeats();
    if (clis.length === 0) throw new Error('No agent is signed in and able to chat, so nothing can answer.');
    const id = crypto.randomUUID();
    const opened = await api.openChat({ chatId: id, scopeKind: 'system', clis });
    if (!opened.seats.some((s) => s.ok)) throw new Error('No agent came up to answer.');
    chatId = id;
    return id;
  })().finally(() => { chatOpening = null; });
  return chatOpening;
}

/** The system chat, kept open for the voice session: one question in, the reply's words out. */
async function askSystemChat(question: string): Promise<string> {
  const id = await openVoiceChat();
  const sent = await api.sendChatMessage(id, question);
  const turnId = sent.turnId;
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => { unsub(); reject(new Error('No answer after 3 minutes.')); }, 180_000);
    const read = (): void => {
      const turns = useAskThreadStore.getState().turns[id] ?? [];
      const reply = [...turns].reverse().find((t) => t.who !== 'you' && (turnId === undefined || t.turnId === turnId));
      if (reply === undefined || reply.pending) return;
      clearTimeout(timer);
      unsub();
      if (reply.ok === false) reject(new Error(reply.text.trim() !== '' ? reply.text : 'The agent could not answer.'));
      else resolve(reply.text);
    };
    const unsub = useAskThreadStore.subscribe(read);
    read();
  });
}

/** The step a job is on now: the system read's, else the run's own cursor. */
async function currentOrd(runId: string): Promise<number | null> {
  const raw = useDashStore.getState().raw.system as { runs?: Array<{ runId?: unknown; unitOrd?: unknown }> } | null;
  const ord = raw?.runs?.find((r) => r.runId === runId)?.unitOrd;
  if (typeof ord === 'number') return ord;
  const { run } = await api.getRun(runId);
  const live = run.units.find((u) => u.status === 'distributed');
  return live?.ord ?? run.units[run.session.unit_ix]?.ord ?? null;
}

/** Ask crew to check on the job's current step and wait (at most ~5 min) for the answer. */
async function inspectNow(runId: string): Promise<UnitInspection> {
  const ord = await currentOrd(runId);
  if (ord === null) throw new Error('It is not working on a step right now, so there is nothing to check.');
  let rec = (await api.inspectUnit(runId, ord)).inspection;
  for (let i = 0; i < 60 && rec.state !== 'done'; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const mine = (await api.getInspections(runId, ord)).inspections.find((x) => x.id === rec.id);
    if (mine !== undefined) rec = mine;
  }
  if (rec.state !== 'done') throw new Error('The check is still running; its answer will show on the job’s page.');
  return rec;
}

const defaults = (): VoiceDeps => ({
  mic: () => new BrowserMic(),
  stt: crewStt,
  speaker: new BrowserSpeaker(),
  ask: askSystemChat,
  steer: async (runId, text) => {
    try {
      await api.injectMessage(runId, text, 'all', { input: 'voice' });
    } catch (e) {
      // A crew older than api-types 0.161.0 refuses the unknown field (400): the note still goes, unlabelled.
      if (apiStatus(e) !== 400) throw e;
      await api.injectMessage(runId, text, 'all');
    }
  },
  editDoc: async (runId, section, text) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      let view = await getWorkingDoc(runId);
      if (view === null) throw new Error('This version of studio’s service has no working documents.');
      if (view.doc === null) view = await ensureWorkingDoc(runId);
      if (view.doc === null || view.sections === null) throw new Error('The job’s working document could not be made.');
      const now = view.sections[section as WorkingDocSectionId].trim();
      try {
        await proposeWorkingDoc(runId, { base: view.doc.head, author: 'operator', input: 'voice', sections: { [section]: now === '' ? text : `${now}\n${text}` } });
        return;
      } catch (e) {
        // Someone else edited it meanwhile: read it again and add to what is there now, once.
        if (apiStatus(e) !== 409 || attempt === 1) throw e;
      }
    }
  },
  stop: (runId, title, reason) => { stopRun([runId], `“${title}”`, reason !== null ? { reason, input: 'voice' } : { input: 'voice' }); },
  rigorOf: async (runId) => {
    const { run } = await api.getRun(runId);
    const p = powerOf(run.session);
    if (p === null || !p.on) return { power: false, rigor: null, why: p?.refusedReason ?? null };
    return { power: true, rigor: p.rigor, why: null };
  },
  raiseRigor: async (runId, to, reason) => { await powerApi.raise(runId, to, reason); },
  inspect: inspectNow,
  classify: async (words, title) => askSystemChat(CLASSIFY_PROMPT(words, title)),
  recent: async () => {
    const { runs } = await api.listRuns();
    return runs
      .filter((r) => ['completed', 'failed', 'cancelled'].includes(String(r.session.status)))
      .slice(0, 20)
      .map((r) => ({ runId: r.session.id, title: jobTitle(r.session), running: false }));
  },
  decide: async (runId, decision, receipt) => commitGateDecision(runId, decision, { receipt: { kind: 'row', chosenLabel: receipt } }),
  endChat: () => {
    const id = chatId;
    chatId = null;
    if (id !== null) void api.endChat(id).catch(() => api.closeChat(id).catch(() => undefined));
  },
  now: () => Date.now(),
});

let deps: VoiceDeps = defaults();

/** Tests: swap any edge (a fake mic, a stub STT, a silent speaker, a recording chat). */
export function setVoiceDeps(d: Partial<VoiceDeps>): void { deps = { ...deps, ...d }; }
export function resetVoiceDeps(): void { deps = defaults(); }

// ── Session state outside React ───────────────────────────────────────────────────────────────

let mic: MicSource | null = null;
const vad = new Vad();
let partialTimer: ReturnType<typeof setInterval> | null = null;
let partialBusy = false;
let gateUnsub: (() => void) | null = null;
let generation = 0;

const S = useVoiceStore;
/** The newest system read: voice's own poll, else the Nerve Center's. */
const snapshotNow = (): SystemSnapshot | null => useDashStore.getState().system ?? useSystemStore.getState().snapshot;
const set = (p: Partial<ReturnType<typeof S.getState>>): void => S.setState(p);
const READ_ALOUD_KEY = 'studio.voice.readAloud';

function savedReadAloud(): boolean {
  try { return localStorage.getItem(READ_ALOUD_KEY) !== 'off'; } catch { return true; }
}

export function setReadAloud(on: boolean): void {
  set({ readAloud: on });
  try { localStorage.setItem(READ_ALOUD_KEY, on ? 'on' : 'off'); } catch { /* private mode */ }
  if (!on) deps.speaker.cancel();
}

// ── Asks (drawn by the guided-ask renderer) ───────────────────────────────────────────────────

/** "Do you want to enter voice mode?" (the modal draws it). */
export const ENTRY_ASK: Ask = {
  id: 'voice-entry', host: 'chat', from: { kind: 'studio', id: 'voice', label: 'Voice' },
  prompt: 'Do you want to enter voice mode?', kind: 'confirm', answeredBy: 'person', record: 'You said: {label}',
  options: [
    { id: 'yes', label: 'Yes, go to voice', token: 'yes', tone: 'primary', recommended: true },
    { id: 'no', label: 'No', token: 'no', tone: 'neutral' },
  ],
};

const MODE_ASK: Ask = {
  id: 'voice-mode', host: 'chat', from: { kind: 'studio', id: 'voice', label: 'Voice' },
  prompt: 'How should I listen?', kind: 'choose', answeredBy: 'person', record: 'Listening: {label}',
  options: [
    { id: 'stream', label: 'Streaming', sub: 'always listening while voice is on', token: 'stream', consequence: 'The mic stays on; I answer when you pause. The red dot shows I’m listening. Best when your hands are busy.' },
    { id: 'space', label: 'Space bar', sub: 'hold Space to talk', token: 'space', recommended: true, consequence: 'I only hear you while you hold Space (or the mic button). Nothing between. Best in a shared room.' },
  ],
};

function pushLine(l: Omit<VoiceLine, 'id'>): number {
  const id = lineId();
  S.setState((s) => ({ lines: [...s.lines, { id, ...l }] }));
  return id;
}

function patchLine(id: number, p: Partial<VoiceLine>): void {
  S.setState((s) => ({ lines: s.lines.map((l) => (l.id === id ? { ...l, ...p } : l)) }));
}

function openAsk(ask: Ask, context: VoiceAskContext, text = ''): number {
  const id = pushLine({ who: 'it', text, ask: { ask, context } });
  set({ openAsk: id });
  return id;
}

/** Say it (captions are the transcript line; read aloud unless turned off). */
async function say(text: string): Promise<void> {
  if (!S.getState().readAloud || text.trim() === '') return;
  set({ speaking: 'it' });
  try { await deps.speaker.say(text); } finally { if (S.getState().speaking === 'it') set({ speaking: 'idle' }); }
}

async function itSays(text: string): Promise<void> {
  pushLine({ who: 'it', text });
  await say(text);
}

// ── Listening ─────────────────────────────────────────────────────────────────────────────────

/** Streaming listens by pauses: the modal, the mode question, and streaming mode. Space bar listens while held. */
function listensByPause(): boolean {
  const s = S.getState();
  if (s.phase === 'ask') return true;
  return s.phase === 'full' && s.mode !== 'space';
}

function onFrame(level: number, bars: number[]): void {
  const s = S.getState();
  // Never hear ourselves: the detector rests while the reply is read aloud.
  const listening = s.speaking !== 'it' && s.status?.ready === true && (listensByPause() || s.holding);
  if (!listening) { set({ bars }); vad.reset(); return; }
  set({ bars, speaking: level > 0.02 ? 'you' : s.speaking === 'you' ? 'idle' : s.speaking });
  if (!listensByPause()) return;
  const ev = vad.feed(level, deps.now());
  if (ev === 'start') { mic?.record(); startPartials(); }
  if (ev === 'end') { stopPartials(); void finishTurn(); }
}

function startPartials(): void {
  stopPartials();
  if (S.getState().phase !== 'full') return;
  partialTimer = setInterval(() => { void partial(); }, 1500);
}

function stopPartials(): void {
  if (partialTimer !== null) clearInterval(partialTimer);
  partialTimer = null;
}

/** A streaming partial: the turn so far, shown as a muted line with a caret. A busy engine just skips a beat. */
async function partial(): Promise<void> {
  if (partialBusy || mic === null) return;
  const wav = mic.peek();
  if (wav === null) return;
  partialBusy = true;
  const gen = generation;
  try {
    const text = (await deps.stt.transcribe(wav)).trim();
    if (gen !== generation || text === '') return;
    const s = S.getState();
    const last = s.lines.at(-1);
    if (last?.who === 'you' && last.partial === true) patchLine(last.id, { text });
    else pushLine({ who: 'you', text, partial: true, spoken: true });
  } catch { /* a skipped partial says nothing; the final transcription reports */ } finally { partialBusy = false; }
}

/** The turn ended (a pause, or Space released): transcribe it and act on it. */
async function finishTurn(): Promise<void> {
  const wav = mic?.take() ?? null;
  if (wav === null) return;
  const gen = generation;
  set({ transcribing: true });
  let text = '';
  try {
    text = (await deps.stt.transcribe(wav)).trim();
  } catch (e) {
    if (gen !== generation) return;
    set({ transcribing: false });
    dropPartial();
    const code = voiceErrorCode(e);
    if (code === 'voice_busy') return;
    await sayError(`I couldn’t turn that into text: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }
  if (gen !== generation) return;
  set({ transcribing: false });
  await hear(text);
}

function dropPartial(): void {
  S.setState((s) => ({ lines: s.lines.filter((l) => !(l.who === 'you' && l.partial === true)) }));
}

async function sayError(text: string): Promise<void> {
  set({ error: text });
  if (S.getState().phase === 'ask') { set({ heard: text }); await say(text); return; }
  await itSays(text);
}

// ── Hearing: what the words do ────────────────────────────────────────────────────────────────

/** Words heard (spoken, or typed in the "type instead" box): the one entry for both. */
export async function hear(raw: string, how: 'spoken' | 'typed' = 'spoken'): Promise<void> {
  const text = raw.trim();
  const s = S.getState();
  if (s.phase === 'off') return;
  if (s.phase === 'ask') { await hearInModal(text); return; }
  // The full screen: settle the partial line into the final words.
  const last = s.lines.at(-1);
  if (text === '') { dropPartial(); return; }
  if (last?.who === 'you' && last.partial === true) patchLine(last.id, { text, partial: false });
  else pushLine({ who: 'you', text, spoken: how === 'spoken' });

  if (isLeave(text)) { closeVoice(); return; }

  const open = s.openAsk !== null ? s.lines.find((l) => l.id === s.openAsk) : undefined;
  if (open?.ask !== undefined && open.record === undefined) {
    const ctx = open.ask.context;
    if (ctx.kind === 'mode') {
      const m = parseMode(text);
      if (m !== null) { answerAsk(open.id, { askId: open.ask.ask.id, option: m }); return; }
      await itSays('Say “streaming” or “space bar”, or tap one.');
      return;
    }
    if (ctx.kind === 'gate' || ctx.kind === 'steer' || ctx.kind === 'job') {
      const c = parseConfirm(text);
      if (c !== null) { answerAsk(open.id, { askId: open.ask.ask.id, option: c === 'confirm' ? 'yes' : 'no' }); return; }
      // A new instruction while a confirm is open replaces it (nothing was sent); anything else is asked again.
      if (parseJobWords(text) === null) {
        await itSays(ctx.kind === 'gate' ? 'Say “confirm” or “not that”, or tap one. Nothing is sent until you confirm.' : 'Say “confirm” or “not that”, or tap one. Nothing is sent until you confirm.');
        return;
      }
      patchLine(open.id, { record: 'Not sent · you said something else' });
      set({ openAsk: null });
    }
    if (ctx.kind === 'pickJob') {
      const runIds = ctx.runIds;
      const picked = pickFrom(text, runIds);
      if (picked !== null) { answerAsk(open.id, { askId: open.ask.ask.id, option: picked }); return; }
      if (parseConfirm(text) === 'cancel') { answerAsk(open.id, { askId: open.ask.ask.id, option: 'none' }); return; }
      await itSays('Say its name, or “the first one”, “the second one”, or tap one.');
      return;
    }
    if (ctx.kind === 'stopReason') {
      answerAsk(open.id, { askId: open.ask.ask.id, option: 'reason', text });
      return;
    }
  }

  if (await hearJobWords(text)) return;

  // A decision read out, or the only one waiting: a spoken answer proposes it, never sends it.
  const gates = Object.values(useGateStore.getState().gates);
  const target = s.awaitingGate !== null ? gates.find((g) => g.runId === s.awaitingGate) : gates.length === 1 ? gates[0] : undefined;
  const words = parseGateAnswer(text);
  if (words !== null && target !== undefined) { await proposeGate(target, text, words); return; }
  if (words !== null && gates.length > 1) { await itSays(`${gates.length} decisions are waiting. Open one and say your answer there, or tell me which job.`); return; }

  // Words that matched nothing, said while a job is in view: one cheap classification, then the same confirm.
  const shown = S.getState().preview;
  if (shown !== null && !QUESTION_WORDS.test(text.trim().toLowerCase())) {
    const job = jobRefs().find((j) => j.runId === shown.runId) ?? { runId: shown.runId, title: titleOf(shown.runId), running: true };
    let kind: ReturnType<typeof readClass> = null;
    try { kind = readClass(await deps.classify(text, job.title)); } catch { kind = null; }
    if (kind === 'steer') { await proposeJobAction(job, { kind: 'steer', note: capFirst(text) }, text); return; }
    if (kind === 'stop') { await proposeJobAction(job, { kind: 'stop', reason: null }, text); return; }
    if (kind === 'rigor') { await proposeJobAction(job, { kind: 'rigor', to: null }, text); return; }
    if (kind === 'check') { await proposeJobAction(job, { kind: 'check' }, text); return; }
  }

  await askChat(text);
}

const QUESTION_WORDS = /\?$|^(what|how|is|are|does|do|can|could|will|why|where|who|when|which|tell me about)\b/;
const capFirst = (t: string): string => { const x = t.trim().replace(/[.!]+$/, ''); return x.charAt(0).toUpperCase() + x.slice(1); };

// ── Jobs: "show me this job", "tell it …" ───────────────────────────────────────────────────────

let recentCache: { at: number; jobs: JobRef[] } | null = null;

/** Running jobs (the system read) and the recent ones last read; a job in both is running. */
function jobRefs(): JobRef[] {
  const running = (snapshotNow()?.runs ?? []).map((r) => ({ runId: r.runId, title: r.title, running: true }));
  const ids = new Set(running.map((j) => j.runId));
  return [...running, ...(recentCache?.jobs ?? []).filter((j) => !ids.has(j.runId))];
}

async function jobsForNaming(): Promise<JobRef[]> {
  if (recentCache === null || deps.now() - recentCache.at > 60_000) {
    try { recentCache = { at: deps.now(), jobs: await deps.recent() }; } catch { recentCache ??= { at: deps.now(), jobs: [] }; }
  }
  return jobRefs();
}

function titleOf(runId: string): string {
  return jobRefs().find((j) => j.runId === runId)?.title ?? gateLabel(runId);
}

const focused = (): string | null => S.getState().preview?.runId ?? S.getState().pageFocus;

const ORDINALS: Record<string, number> = { first: 0, one: 0, '1': 0, second: 1, two: 1, '2': 1, third: 2, three: 2, '3': 2, fourth: 3, four: 3, '4': 3, last: -1 };

/** A spoken pick among offered jobs: "the second one", "two", or (part of) its name. */
function pickFrom(text: string, runIds: readonly string[]): string | null {
  const t = text.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const m = /^(?:the\s+)?(first|second|third|fourth|last|[1-4])(?:\s+(?:one|job|run))?$/.exec(t) ?? /^(?:number\s+)?(one|two|three|four)$/.exec(t);
  if (m !== null) {
    const i = ORDINALS[m[1]!]!;
    const id = i === -1 ? runIds.at(-1) : runIds[i];
    if (id !== undefined) return id;
  }
  const offered = runIds.map((id) => jobRefs().find((j) => j.runId === id) ?? { runId: id, title: titleOf(id), running: true });
  const r = resolveJob(text, offered, null);
  return r.kind === 'one' && r.how === 'named' ? r.job.runId : null;
}

const PIN_KEY = 'studio.voice.pinnedJob';

function savePin(runId: string | null): void {
  try { if (runId === null) localStorage.removeItem(PIN_KEY); else localStorage.setItem(PIN_KEY, runId); } catch { /* private mode */ }
}

function savedPin(): string | null {
  try { return localStorage.getItem(PIN_KEY); } catch { return null; }
}

/** One line about a job, for the spoken "here it is". */
function describeJob(runId: string): string {
  const r = snapshotNow()?.runs.find((x) => x.runId === runId);
  const gate = useGateStore.getState().gates[runId];
  if (r === undefined) return 'It isn’t running now; this is its last state.';
  const state = r.liveness === 'waiting_on_you' ? 'waiting on you' : r.liveness === 'stalled' ? 'stalled' : r.liveness === 'held' ? 'held' : r.liveness === 'quiet' ? 'quiet' : 'working';
  return `${r.phase !== null ? `${r.phase.charAt(0).toUpperCase()}${r.phase.slice(1)} phase, ` : ''}${state}${gate !== undefined ? ', with a decision waiting' : ''}.`;
}

/** Open (or swap) the live preview. */
export function showJob(runId: string, opts: { quiet?: boolean; pinned?: boolean } = {}): void {
  const cur = S.getState().preview;
  const pinned = opts.pinned ?? (cur?.runId === runId ? cur.pinned : false);
  set({ preview: { runId, pinned } });
  if (pinned) savePin(runId);
  else if (savedPin() === runId || cur?.pinned === true) savePin(null);
  if (opts.quiet !== true) void itSays(`Here’s “${titleOf(runId)}”. ${describeJob(runId)} You can say “tell it …”, “stop it”, “check on it”, or “close it”.`);
}

export function closeJob(): void {
  const cur = S.getState().preview;
  if (cur === null) return;
  if (cur.pinned) savePin(null);
  set({ preview: null });
}

export function pinJob(on: boolean): void {
  const cur = S.getState().preview;
  if (cur === null) return;
  set({ preview: { ...cur, pinned: on } });
  savePin(on ? cur.runId : null);
}

/** "show me …", "the other one", "close it", "pin it", "tell it …": true when the words were about a job. */
async function hearJobWords(text: string): Promise<boolean> {
  const w = parseJobWords(text);
  if (w === null) return false;
  if (w.kind === 'close') {
    if (S.getState().preview === null) await itSays('No job is open.');
    else { const t = titleOf(S.getState().preview!.runId); closeJob(); await itSays(`Closed “${t}”.`); }
    return true;
  }
  if (w.kind === 'pin') {
    if (S.getState().preview === null) { await itSays('No job is open to pin. Say “show me” and its name first.'); return true; }
    pinJob(w.on);
    await itSays(w.on ? 'Pinned. It stays here, even when another job needs you.' : 'Unpinned.');
    return true;
  }
  const jobs = await jobsForNaming();
  if (w.kind === 'other') {
    const next = otherJob(S.getState().preview?.runId ?? null, S.getState().lastChoice, jobs);
    if (next === null) { await itSays(jobs.some((j) => j.running) ? 'There’s no other running job.' : 'No job is running.'); return true; }
    showJob(next.runId);
    return true;
  }
  // A gate answer that names no job, with no job in view, is the waiting decision's (the gate logic after this).
  if (w.kind === 'act' && w.action.kind === 'gate' && w.job === '' && S.getState().preview === null) return false;
  const r = resolveJob(w.job, jobs, focused());
  if (r.kind === 'none') { await itSays(r.why); return true; }
  if (r.kind === 'choose') {
    const then = w.kind === 'show' ? { kind: 'show' as const } : { kind: 'act' as const, action: w.action };
    openPick(r.jobs, r.why, then, text);
    return true;
  }
  if (w.kind === 'show') { showJob(r.job.runId); return true; }
  await proposeJobAction(r.job, w.action, text);
  return true;
}

function openPick(jobs: readonly JobRef[], why: string, then: { kind: 'show' } | { kind: 'act'; action: JobAction }, heard: string): void {
  set({ lastChoice: jobs.map((j) => j.runId) });
  const ask: Ask = {
    id: `voice-pick-${lineId()}`, host: 'chat',
    from: { kind: 'studio', id: 'voice', label: `Which job? · heard by voice · “${heard}”` },
    prompt: why, kind: 'choose', answeredBy: 'person', record: 'You chose: {label}',
    options: [
      ...jobs.map((j, i) => ({ id: j.runId, label: j.title, sub: j.running ? (snapshotNow()?.runs.find((r) => r.runId === j.runId)?.phase ?? 'running') : 'finished', token: j.runId, ...(i === 0 ? { recommended: true } : {}) })),
      { id: 'none', label: 'None of these', token: 'none', tone: 'neutral' as const },
    ],
  };
  openAsk(ask, { kind: 'pickJob', runIds: jobs.map((j) => j.runId), then, heard });
  void say(`${why} ${jobs.map((j, i) => `${['First', 'Second', 'Third', 'Fourth'][i]}: ${j.title}.`).join(' ')}`);
}

/** One action on one job → an on-screen confirm (always). Rigor and stop may ask first. */
async function proposeJobAction(job: JobRef, action: JobAction, heard: string): Promise<void> {
  if (action.kind === 'gate') {
    const gate = useGateStore.getState().gates[job.runId];
    if (gate === undefined) { await itSays(`“${job.title}” has no decision waiting.`); return; }
    if (S.getState().preview?.runId !== job.runId) showJob(job.runId, { quiet: true });
    await proposeGate(gate, heard, action.words);
    return;
  }
  if (!job.running && action.kind !== 'check') {
    await itSays(`“${job.title}” has finished, so there’s nothing to ${action.kind === 'stop' ? 'stop' : 'steer'}.`);
    return;
  }
  if (action.kind === 'check' && !job.running) { await itSays(`“${job.title}” has finished, so there’s nothing to check on.`); return; }
  if (S.getState().preview?.runId !== job.runId) showJob(job.runId, { quiet: true });
  if (action.kind === 'stop' && action.reason === null) {
    const ask: Ask = {
      id: `voice-stopwhy-${lineId()}`, host: 'chat',
      from: { kind: 'studio', id: 'voice', label: `Stop · heard by voice · ${job.title}` },
      prompt: `Why stop “${job.title}”? Say the reason, or tap Stop without a reason.`,
      kind: 'choose', answeredBy: 'person', record: 'Reason: {label}',
      options: [
        { id: 'none', label: 'Stop without a reason', token: 'none', tone: 'neutral' },
        { id: 'cancel', label: 'Don’t stop it', token: 'cancel', tone: 'neutral' },
      ],
    };
    openAsk(ask, { kind: 'stopReason', runId: job.runId, title: job.title });
    await say(`Why stop ${job.title}? Say the reason, or say no reason.`);
    return;
  }
  let rigorNow: Rigor | null = null;
  if (action.kind === 'rigor') {
    let r: Awaited<ReturnType<VoiceDeps['rigorOf']>>;
    try { r = await deps.rigorOf(job.runId); } catch (e) { await itSays(`I couldn’t read its rigor: ${e instanceof Error ? e.message : String(e)}`); return; }
    if (!r.power) { await itSays(`“${job.title}” runs phased, so it has no rigor to raise. You can steer it, stop it, or check on it.`); return; }
    rigorNow = r.rigor;
    const to = action.to ?? nextRigor(r.rigor);
    if (to === null) { await itSays(`“${job.title}” is already at the highest rigor.`); return; }
    if (r.rigor !== null && ['light', 'standard', 'high', 'highest'].indexOf(to) <= ['light', 'standard', 'high', 'highest'].indexOf(r.rigor)) {
      await itSays(`“${job.title}” is already at ${r.rigor}. Rigor can only go up.`);
      return;
    }
    action = { kind: 'rigor', to };
  }
  const w = actionWords(action, job.title, { rigor: rigorNow });
  const tone = action.kind === 'stop' ? 'danger' as const : 'primary' as const;
  const ask: Ask = {
    id: `voice-job-${job.runId}-${lineId()}`, host: 'chat',
    from: { kind: 'studio', id: 'voice', label: `${ACTION_LABEL[action.kind]} · heard by voice · ${job.title}` },
    prompt: w.prompt, detail: `${w.detail} Nothing is sent until you confirm.`,
    kind: 'confirm', answeredBy: 'person', record: w.record,
    options: [
      { id: 'yes', label: w.confirm, token: 'confirm', tone, recommended: true },
      { id: 'no', label: 'Not that', token: 'cancel', tone: 'neutral' },
    ],
  };
  openAsk(ask, { kind: 'job', runId: job.runId, title: job.title, action, heard });
  await say(`${w.prompt} Say confirm, or not that.`);
}

const ACTION_LABEL: Record<JobAction['kind'], string> = { steer: 'Steer', doc: 'Working document', stop: 'Stop', rigor: 'Rigor', gate: 'Decision', check: 'Check on it' };

/** A confirmed job action, sent. Resolves with the record line. */
async function runJobAction(lineIdOf: number, ctx: Extract<VoiceAskContext, { kind: 'job' }>): Promise<void> {
  const { runId, title, action } = ctx;
  const done = (record: string): void => patchLine(lineIdOf, { record });
  const fail = (e: unknown): void => done(`Not sent: ${e instanceof Error ? e.message : String(e)}`);
  switch (action.kind) {
    case 'steer':
      done(`Sending to ${title}…`);
      try { await deps.steer(runId, action.note); done(`Sent to ${title} · by voice`); void say('Sent.'); } catch (e) { fail(e); }
      return;
    case 'doc':
      done(`Adding to ${title}’s working document…`);
      try { await deps.editDoc(runId, action.section, action.text); done(actionWords(action, title).record); void say('Added.'); } catch (e) { fail(e); }
      return;
    case 'stop':
      deps.stop(runId, title, action.reason === null || action.reason.trim() === '' ? null : action.reason);
      done(`Stopping ${title} in 10 s · by voice, confirmed (Undo below)`);
      void say('Confirmed. It stops in 10 seconds unless you undo it.');
      return;
    case 'rigor':
      if (action.to === null) return;
      done(`Raising ${title}’s rigor…`);
      try { await deps.raiseRigor(runId, action.to, `Asked by voice: “${ctx.heard}”`); done(actionWords(action, title).record); void say(`Rigor raised to ${action.to}.`); } catch (e) { fail(e); }
      return;
    case 'check': {
      done(`Checking on ${title}…`);
      const gen = generation;
      let rec: UnitInspection;
      try { rec = await deps.inspect(runId); } catch (e) { if (gen === generation) done(`Not checked: ${e instanceof Error ? e.message : String(e)}`); return; }
      if (gen !== generation) return;
      done(`Checked ${title} · by voice`);
      const verdict = rec.verdict === null ? 'It could not tell' : { progressing: 'It’s progressing', looping: 'It looks like it’s looping', stuck: 'It looks stuck', wasteful: 'It’s wasting tokens' }[rec.verdict];
      const words = `${verdict}.${rec.doing !== null ? ` ${rec.doing}` : ''}${rec.progress !== null ? ` ${rec.progress}` : ''}`;
      await itSays(words);
      // The check's recommended move is offered, never taken: the same confirm.
      const job = { runId, title, running: true };
      if (rec.action === 'steer' && rec.note !== null && rec.note.trim() !== '') await proposeJobAction(job, { kind: 'steer', note: rec.note.trim() }, 'the check’s suggestion');
      else if (rec.action === 'stop') await proposeJobAction(job, { kind: 'stop', reason: rec.why ?? `The check found it ${rec.verdict ?? 'not progressing'}` }, 'the check’s suggestion');
      return;
    }
    case 'gate':
      return;
  }
}

async function hearInModal(text: string): Promise<void> {
  if (text === '') return;
  set({ heard: `Heard: “${text}”` });
  const r = parseEntry(text);
  if (r.kind === 'yes') { enterFull(); return; }
  if (r.kind === 'no') { closeVoice(); return; }
  if (r.kind === 'question') {
    S.setState((st) => ({ modal: [...st.modal, { id: lineId(), who: 'you', text, spoken: true }, { id: lineId(), who: 'it', text: r.answer }] }));
    await say(r.answer);
    await say('Do you want to enter voice mode?');
    return;
  }
  await say('Say yes or no, or ask me about voice mode.');
}

/** A spoken answer to a decision → an on-screen Confirm (always). */
async function proposeGate(gate: OpenGate, heard: string, words: NonNullable<ReturnType<typeof parseGateAnswer>>): Promise<void> {
  if (gate.choices !== undefined) {
    await itSays('That decision has its own choices. Answer it on screen; voice can only approve, send back or reject a plain decision.');
    return;
  }
  if (words.action === 'request_changes' && words.note === '') {
    await itSays('What should change? Say “send it back with a note”, then the note.');
    return;
  }
  const title = snapshotNow()?.runs.find((r) => r.runId === gate.runId)?.title;
  const label = title !== undefined ? `“${title}”` : gateLabel(gate.runId);
  const deliver = gate.gateKind === 'deliver';
  const q = words.action === 'approve' ? (deliver ? 'Approve and deliver?' : 'Approve?')
    : words.action === 'reject' ? 'Reject it? This cancels the job.'
      : `Send it back: “${words.note}”?`;
  const confirmLabel = words.action === 'approve' ? (deliver ? 'Confirm: approve and deliver' : 'Confirm: approve')
    : words.action === 'reject' ? 'Confirm: reject' : 'Confirm: send it back';
  const record = words.action === 'approve' ? 'Approved by you · by voice, confirmed'
    : words.action === 'reject' ? 'Rejected by you · by voice, confirmed' : 'Sent back by you · by voice, confirmed';
  const decision = words.action === 'approve' ? { approve: true }
    : words.action === 'reject' ? { approve: false, action: 'reject' as const }
      : { approve: false, action: 'request_changes' as const, amend: words.note };
  const ask: Ask = {
    id: `voice-gate-${gate.runId}-${gate.ord}`, host: 'gate',
    from: { kind: 'studio', id: 'voice', label: `${deliver ? 'Deliver' : 'Decision'} · heard by voice · ${label}` },
    prompt: `Heard “${heard}”: ${q}`,
    detail: 'A spoken answer to a decision always waits for this. Tap, or say “confirm”. Then you have 10 s to undo.',
    kind: 'confirm', answeredBy: 'person', record,
    options: [
      { id: 'yes', label: confirmLabel, token: 'confirm', tone: words.action === 'reject' ? 'danger' : 'primary', recommended: true },
      { id: 'no', label: 'Not that', token: 'cancel', tone: 'neutral' },
    ],
  };
  openAsk(ask, { kind: 'gate', runId: gate.runId, heard, decision, record });
  await say(`${q} Say confirm, or not that.`);
}

async function askChat(question: string): Promise<void> {
  const id = pushLine({ who: 'it', text: '…', partial: true });
  const gen = generation;
  try {
    const reply = await deps.ask(question);
    if (gen !== generation) return;
    patchLine(id, { text: reply, partial: false });
    await say(reply);
  } catch (e) {
    if (gen !== generation) return;
    const why = e instanceof Error ? e.message : String(e);
    patchLine(id, { text: `I couldn’t get an answer: ${why}`, partial: false });
    await say(`I couldn’t get an answer. ${why}`);
  }
}

/** An ask in the transcript was answered (tapped, or said). */
export function answerAsk(lineIdOf: number, answer: AskAnswer): void {
  const s = S.getState();
  const line = s.lines.find((l) => l.id === lineIdOf);
  if (line?.ask === undefined || line.record !== undefined) return;
  const { ask, context } = line.ask;
  const opt = (ask.options ?? []).find((o) => o.id === answer.option);
  if (s.openAsk === lineIdOf) set({ openAsk: null });
  if (context.kind === 'mode') {
    const mode: ListenMode = answer.option === 'stream' ? 'stream' : 'space';
    patchLine(lineIdOf, { record: `Listening: ${opt?.label ?? mode}` });
    chooseMode(mode);
    return;
  }
  if (context.kind === 'gate') {
    if (answer.option !== 'yes') { patchLine(lineIdOf, { record: 'Not sent · you said not that' }); void say('Okay, nothing was sent.'); return; }
    patchLine(lineIdOf, { record: `${context.record} · sending in 10 s (Undo below)` });
    set({ awaitingGate: null });
    const decision = { ...context.decision, input: 'voice' } as GateAnswer;
    void deps.decide(context.runId, decision, context.record).then(
      (outcome) => patchLine(lineIdOf, { record: outcome === 'sent' ? context.record : outcome === 'undone' ? 'Undone · nothing was sent' : `Not sent (${outcome})` }),
      (e: unknown) => patchLine(lineIdOf, { record: `Not sent: ${e instanceof Error ? e.message : String(e)}` }),
    );
    void say('Confirmed. It sends in 10 seconds unless you undo it.');
    return;
  }
  if (context.kind === 'pickJob') {
    const pick = answer.option ?? 'none';
    if (pick === 'none' || !context.runIds.includes(pick)) { patchLine(lineIdOf, { record: 'None of these' }); void say('Okay. Say its name when you know it.'); return; }
    const job = jobRefs().find((j) => j.runId === pick) ?? { runId: pick, title: titleOf(pick), running: true };
    patchLine(lineIdOf, { record: `You chose: ${job.title}` });
    if (context.then.kind === 'show') showJob(pick);
    else void proposeJobAction(job, context.then.action, context.heard);
    return;
  }
  if (context.kind === 'stopReason') {
    if (answer.option === 'cancel' || (answer.option === 'reason' && parseConfirm(answer.text ?? '') === 'cancel' && !/^no reason\b/i.test(answer.text ?? ''))) {
      patchLine(lineIdOf, { record: 'Not stopped · you said not that' });
      return;
    }
    const said = answer.option === 'reason' ? (answer.text ?? '').trim().replace(/^(?:because|since|the reason is)\s+/i, '') : '';
    const reason = said === '' || /^(?:no reason|none|nothing|no|skip|without a reason)\b/i.test(said) ? null : capFirst(said);
    patchLine(lineIdOf, { record: reason !== null ? `Reason: ${reason}` : 'No reason given' });
    const job = { runId: context.runId, title: context.title, running: true };
    void proposeJobAction(job, { kind: 'stop', reason: reason ?? '' }, said);
    return;
  }
  if (context.kind === 'job') {
    if (answer.option !== 'yes') { patchLine(lineIdOf, { record: 'Not sent · you said not that' }); void say('Okay, nothing was sent.'); return; }
    void runJobAction(lineIdOf, context);
    return;
  }
  if (context.kind === 'steer') {
    if (answer.option !== 'yes') { patchLine(lineIdOf, { record: 'Not sent · you said not that' }); return; }
    patchLine(lineIdOf, { record: `Sending to ${context.title}…` });
    void deps.steer(context.runId, context.message).then(
      () => { patchLine(lineIdOf, { record: `Sent to ${context.title} · by voice` }); void say('Sent.'); },
      (e: unknown) => patchLine(lineIdOf, { record: `Not sent: ${e instanceof ApiError ? e.message : String(e)}` }),
    );
  }
}

// ── Gates arriving while voice mode is open ────────────────────────────────────────────────────

function watchGates(): void {
  gateUnsub?.();
  gateUnsub = useGateStore.subscribe((st, prev) => {
    if (S.getState().phase !== 'full' || st.gates === prev.gates) return;
    // The decision read out was answered elsewhere (or left): a spoken answer no longer goes to it.
    const awaiting = S.getState().awaitingGate;
    if (awaiting !== null && st.gates[awaiting] === undefined) set({ awaitingGate: null });
    for (const g of Object.values(st.gates)) {
      const before = prev.gates[g.runId];
      if (before !== undefined && before.ord === g.ord && before.receivedAt === g.receivedAt) continue;
      const title = snapshotNow()?.runs.find((r) => r.runId === g.runId)?.title ?? 'A job';
      const question = plainGateQuestion(g.prompt, g.gateKind);
      set({ awaitingGate: g.runId });
      // The job that needs you comes into view, unless the person pinned another one there.
      const shown = S.getState().preview;
      if (shown === null || (!shown.pinned && shown.runId !== g.runId)) showJob(g.runId, { quiet: true });
      void itSays(`${title} is waiting on you: ${question} You can say approve, or send it back with a note.`);
    }
  });
}

// ── Open, enter, choose, leave ─────────────────────────────────────────────────────────────────

/** The run page a composer is on ("this job" before anything is previewed): set while it is mounted. */
let pageRun: string | null = null;
export function setVoicePageFocus(runId: string | null): void { pageRun = runId; }

/** Open the modal (the composer's mic, or ⌥V). `focus`: the job the mic was pressed on. */
export async function openVoice(opts: { focus?: string | null } = {}): Promise<void> {
  if (S.getState().phase !== 'off') return;
  generation += 1;
  recentCache = null;
  set({ ...INITIAL_VOICE, phase: 'ask', readAloud: savedReadAloud(), heard: null, pageFocus: opts.focus ?? pageRun });
  // The dashboard's first read starts now, so full screen opens on the live system (and says what it sees).
  void loadDashboard().then(() => readDashboardData());
  await refreshStatus();
  await startMic();
  if (S.getState().phase === 'ask') await say('Do you want to enter voice mode?');
}

export async function refreshStatus(): Promise<VoiceStatus | null> {
  try {
    const status = await getVoiceStatus();
    set({ status, statusError: null });
    return status;
  } catch (e) {
    set({ status: null, statusError: isVoiceUnsupported(e) ? 'This crew has no voice service yet. Upgrade wicked-crew to use voice.' : e instanceof Error ? e.message : String(e) });
    return null;
  }
}

/** The person said yes to fetching the speech model. Polls until it lands or fails. */
export async function consentToModel(): Promise<void> {
  try {
    set({ status: await downloadVoiceModel(), statusError: null });
  } catch (e) {
    set({ statusError: e instanceof Error ? e.message : String(e) });
    return;
  }
  const gen = generation;
  for (let i = 0; i < 900 && gen === generation; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const st = await refreshStatus();
    if (st === null || st.model.present || st.model.download?.state === 'failed') break;
  }
}

async function startMic(): Promise<void> {
  if (mic !== null) return;
  const m = deps.mic();
  mic = m;
  try {
    await m.start((f) => onFrame(f.level, f.bars));
    set({ micOn: true, micError: null });
  } catch (e) {
    mic = null;
    const name = (e as { name?: string } | null)?.name;
    set({ micOn: false, micError: name === 'NotAllowedError' ? 'The browser was not allowed to use the microphone. You can still tap and type.' : name === 'NotFoundError' ? 'No microphone was found. You can still tap and type.' : `The microphone could not start: ${e instanceof Error ? e.message : String(e)}` });
  }
}

/** Answer the modal's question (tapped, or said). */
export function answerEntry(yes: boolean): void {
  if (yes) enterFull(); else closeVoice();
}

function describeNow(): string {
  const snap = snapshotNow();
  const gates = Object.keys(useGateStore.getState().gates).length;
  if (snap === null) return 'You’re in voice mode. Around us is the live system.';
  const working = snap.runs.filter((r) => r.liveness === 'working' || r.liveness === 'quiet').length;
  const load = snap.infra.find((i) => i.key === 'load');
  const busy = load?.state === 'down' ? 'the machine very busy' : load?.state === 'degraded' ? 'the machine a bit busy' : 'the machine calm';
  const jobs = working === 0 ? 'no jobs running' : working === 1 ? 'one job running' : `${working} jobs running`;
  const wait = gates === 0 ? 'nothing waiting on you' : gates === 1 ? 'one decision waiting on you' : `${gates} decisions waiting on you`;
  return `You’re in voice mode. Around us is what’s happening now: ${jobs}, ${wait}, ${busy}.`;
}

function enterFull(): void {
  if (S.getState().phase !== 'ask') return;
  deps.speaker.cancel();
  set({ phase: 'full', heard: null, lines: [], openAsk: null });
  watchGates();
  // A job pinned last time is shown again while it is still running.
  const pinned = savedPin();
  if (pinned !== null) {
    const snap = snapshotNow();
    if (snap === null || snap.runs.some((r) => r.runId === pinned)) set({ preview: { runId: pinned, pinned: true } });
    else savePin(null);
  }
  pushLine({ who: 'it', text: describeNow() });
  openAsk(MODE_ASK, { kind: 'mode' });
  void say(`${describeNow()} How should I listen? Streaming, or space bar?`);
}

export function chooseMode(mode: ListenMode): void {
  set({ mode });
  vad.reset();
  const words = mode === 'stream'
    ? 'Streaming. I’m listening; I answer when you pause. Say “stop listening” or press Esc to leave.'
    : 'Space bar. Hold Space, or the mic button, while you talk. Press Esc to leave.';
  void itSays(words);
}

/** Space (or the mic button) pressed or released, in space-bar mode. */
export function holdToTalk(down: boolean): void {
  const s = S.getState();
  if (s.phase !== 'full' || s.mode !== 'space' || mic === null) return;
  if (down) {
    if (s.holding) return;
    deps.speaker.cancel();
    set({ holding: true, speaking: 'you' });
    mic.record();
    return;
  }
  if (!s.holding) return;
  set({ holding: false, speaking: 'idle' });
  void finishTurn();
}

/** Leave voice mode (No, Esc, "leave voice", the button). The mic is released and nothing is kept. */
export function closeVoice(): void {
  generation += 1;
  stopPartials();
  vad.reset();
  mic?.stop();
  mic = null;
  gateUnsub?.();
  gateUnsub = null;
  deps.speaker.cancel();
  deps.endChat();
  set({ ...INITIAL_VOICE, readAloud: S.getState().readAloud });
}

/** Tests. */
export function resetVoice(): void {
  closeVoice();
  useVoiceStore.setState({ ...INITIAL_VOICE });
  chatId = null;
}

