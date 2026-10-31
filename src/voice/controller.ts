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
import { ApiError } from '../api/errors.js';
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
import { isLeave, matchJob, parseConfirm, parseEntry, parseGateAnswer, parseMode, parseSteer } from './intent.js';
import { BrowserMic, BrowserSpeaker, crewStt, type MicSource, type Speaker, type SttEngine } from './io.js';
import { Vad } from './vad.js';

// ── The edges ─────────────────────────────────────────────────────────────────────────────────

export interface VoiceDeps {
  mic: () => MicSource;
  stt: SttEngine;
  speaker: Speaker;
  /** Ask the system chat one question; resolves with the reply's words. */
  ask: (question: string) => Promise<string>;
  /** Send a steer note to a running job. */
  steer: (runId: string, text: string) => Promise<void>;
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

const defaults = (): VoiceDeps => ({
  mic: () => new BrowserMic(),
  stt: crewStt,
  speaker: new BrowserSpeaker(),
  ask: askSystemChat,
  steer: async (runId, text) => { await api.injectMessage(runId, text, 'all'); },
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
    if (ctx.kind === 'gate' || ctx.kind === 'steer') {
      const c = parseConfirm(text);
      if (c !== null) { answerAsk(open.id, { askId: open.ask.ask.id, option: c === 'confirm' ? 'yes' : 'no' }); return; }
      await itSays(ctx.kind === 'gate' ? 'Say “confirm” or “not that”, or tap one. Nothing is sent until you confirm.' : 'Say “send” or “not that”, or tap one.');
      return;
    }
  }

  // A decision read out, or the only one waiting: a spoken answer proposes it, never sends it.
  const gates = Object.values(useGateStore.getState().gates);
  const target = s.awaitingGate !== null ? gates.find((g) => g.runId === s.awaitingGate) : gates.length === 1 ? gates[0] : undefined;
  const words = parseGateAnswer(text);
  if (words !== null && target !== undefined) { await proposeGate(target, text, words); return; }
  if (words !== null && gates.length > 1) { await itSays(`${gates.length} decisions are waiting. Open one and say your answer there, or tell me which job.`); return; }

  const steer = parseSteer(text);
  if (steer !== null) { await proposeSteer(steer.job, steer.message); return; }

  await askChat(text);
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

async function proposeSteer(jobWords: string, message: string): Promise<void> {
  const runs = (snapshotNow()?.runs ?? []).filter((r) => r.liveness !== 'held');
  const job = matchJob(jobWords, runs);
  if (job === null) {
    const names = runs.map((r) => r.title).slice(0, 4).join('; ');
    await itSays(runs.length === 0 ? 'No job is running, so there is nothing to steer.' : `I couldn’t tell which job you mean. Running now: ${names}.`);
    return;
  }
  const ask: Ask = {
    id: `voice-steer-${job.runId}-${lineId()}`, host: 'chat',
    from: { kind: 'studio', id: 'voice', label: `Steer · heard by voice · ${job.title}` },
    prompt: `Send to “${job.title}”: “${message}”?`,
    detail: 'It lands at the job’s next checkpoint, like a typed note.',
    kind: 'confirm', answeredBy: 'person', record: `Sent to ${job.title} · by voice`,
    options: [
      { id: 'yes', label: 'Send', token: 'send', tone: 'primary', recommended: true },
      { id: 'no', label: 'Not that', token: 'cancel', tone: 'neutral' },
    ],
  };
  openAsk(ask, { kind: 'steer', runId: job.runId, title: job.title, message });
  await say(`Send that to ${job.title}? Say send, or not that.`);
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
      void itSays(`${title} is waiting on you: ${question} You can say approve, or send it back with a note.`);
    }
  });
}

// ── Open, enter, choose, leave ─────────────────────────────────────────────────────────────────

/** Open the modal (the composer's mic, or ⌥V). */
export async function openVoice(): Promise<void> {
  if (S.getState().phase !== 'off') return;
  generation += 1;
  set({ ...INITIAL_VOICE, phase: 'ask', readAloud: savedReadAloud(), heard: null });
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

