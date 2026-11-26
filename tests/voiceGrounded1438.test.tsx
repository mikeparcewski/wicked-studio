/**
 * studio#1438 (train-14 cert, sitrep row 39): in voice mode the panel said "one job running, 2 things need you", yet
 * "what needs me right now?" went to the system chat as bare words, and the helper answered that the chat had no live
 * view. A voice question now carries what voice mode itself shows: the running jobs, what needs the person (crew's
 * ranked list, else the app's needs rows) and the machine, read when the question is asked.
 */
import { act, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../src/api/client.js';
import { normalizeSnapshot, type SystemSnapshot } from '../src/api/system.js';
import { PACK_JOIN, PACK_OPENING } from '../src/board/askPack.js';
import { needsYouRows, type NeedsYouInputs } from '../src/board/needsYou.js';
import { useAskThreadStore } from '../src/store/askThread.js';
import { useCapabilities } from '../src/store/capabilities.js';
import { useConnectionStore } from '../src/store/connection.js';
import { useGateStore } from '../src/store/gates.js';
import { useNeedsCount } from '../src/store/needsCount.js';
import { setCachedRoster } from '../src/store/rosterCache.js';
import { useSystemStore } from '../src/store/systemSnapshot.js';
import { useVoiceStore } from '../src/store/voice.js';
import { hear, resetVoice, resetVoiceDeps, setVoiceDeps } from '../src/voice/controller.js';
import { resetDashStore, useDashStore } from '../src/voice/dashboardStore.js';
import cert from './fixtures/system-t14-cert.crew.json';
import { makeUnit, makeView } from './factories.js';

/** The cert's own GET /system (crew 0.18.22): four ranked `prevents` items, no runs. */
const CERT = normalizeSnapshot(cert.body);
const CERT_TITLES = (cert.body.attention as Array<{ title: string }>).map((a) => a.title);
/** One working job, in crew's /system run shape (as tests/voice.flow.test.tsx's SYSTEM). */
const WORKING = { runId: 'r-dark', title: 'Dark mode for settings', status: 'executing', liveness: 'working', reason: '', phase: 'build', unitOrd: 2, seat: 'claude', lastEventAt: null, evidence: null, quietForMs: null, quietAfterMs: 1, stallAfterMs: 1, createdAt: null };
const QUESTION = 'What needs me right now?';

const said: string[] = [];
let asked: Array<[string, unknown]> = [];

function crewSays(snap: SystemSnapshot, count: number): void {
  const now = Date.now();
  useSystemStore.setState({ mode: 'system', healthAt: now, healthError: null, snapshot: snap, snapshotAt: now, snapshotError: null } as never);
  useDashStore.setState({ system: snap, readAt: now, readError: null });
  useConnectionStore.setState({ status: 'connected' } as never);
  useNeedsCount.setState({ phase: 'complete', count });
}

/** Say it in voice mode. The reply is not awaited: a real chat's answer arrives later, over the socket. */
async function askByVoice(words = QUESTION): Promise<void> {
  useVoiceStore.setState({ phase: 'full', mode: 'hold', openAsk: null, lines: [] } as never);
  await act(async () => { void hear(words, 'spoken'); await new Promise((r) => setTimeout(r, 0)); });
}

beforeEach(() => {
  resetVoice();
  resetDashStore();
  said.length = 0;
  asked = [];
  useGateStore.setState({ gates: {} });
  setVoiceDeps({
    speaker: { available: true, say: async (t) => { said.push(t); }, cancel: () => undefined },
    ask: async (...args: unknown[]) => { asked.push([args[0] as string, args[1]]); return 'answered'; },
    endChat: () => undefined,
  });
});
afterEach(() => { resetVoice(); resetVoiceDeps(); vi.restoreAllMocks(); });

describe('a voice question carries what voice mode shows', () => {
  it('names every item on crew\'s ranked list, as the cert\'s /system answered it', async () => {
    crewSays(CERT, 4);
    await askByVoice();
    await waitFor(() => expect(asked).toHaveLength(1));
    const [q, ground] = asked[0]!;
    expect(q).toBe(QUESTION);
    expect(typeof ground).toBe('string');
    const pack = ground as string;
    expect(pack.startsWith(PACK_OPENING)).toBe(true);
    expect(pack).toMatch(/needs you: 4/);
    for (const t of CERT_TITLES) expect(pack).toContain(t);
    expect(pack).toMatch(/jobs running: none/);
  });

  it('names the running job by its title and step', async () => {
    crewSays(normalizeSnapshot({ ...cert.body, runs: [WORKING] }), 4);
    await askByVoice();
    await waitFor(() => expect(asked).toHaveLength(1));
    const pack = asked[0]![1] as string;
    expect(pack).toMatch(/jobs running: 1/);
    expect(pack).toContain('Dark mode for settings · on build');
  });

  it('is read when the question is asked, not when voice mode opened', async () => {
    crewSays(CERT, 4);
    await askByVoice();
    await waitFor(() => expect(asked).toHaveLength(1));
    crewSays(normalizeSnapshot({ ...cert.body, attention: [], runs: [WORKING] }), 0);
    await askByVoice('What is running right now?');
    await waitFor(() => expect(asked).toHaveLength(2));
    const pack = asked[1]![1] as string;
    expect(pack).toMatch(/needs you: nothing/);
    for (const t of CERT_TITLES) expect(pack).not.toContain(t);
    expect(pack).toContain('Dark mode for settings');
  });

  it('on a crew without /system, names the app\'s own needs rows', async () => {
    const base = { failedAt: {}, attachedAt: {}, projectIds: {}, chats: [], repos: [], campaigns: [], now: Date.now(), deliveryAttempted: new Set<string>(), deliveredNow: new Set<string>() } as unknown as Omit<NeedsYouInputs, 'runs' | 'gates'>;
    const waiting = makeView({ id: 'r-ship', status: 'awaiting_human', problem: 'Ship the billing export', unit_ix: 1 } as never, [makeUnit({ id: 'r-ship:u1', session_id: 'r-ship', ord: 1, status: 'done' })]);
    const rows = needsYouRows({ ...base, runs: [waiting], gates: {} });
    expect(rows.length).toBeGreaterThan(0);
    useSystemStore.setState({ mode: 'fallback', healthAt: Date.now(), healthError: null, snapshot: null } as never);
    useNeedsCount.setState({ phase: 'complete', count: 1, rows } as never);
    await askByVoice();
    await waitFor(() => expect(asked).toHaveLength(1));
    expect(asked[0]![1] as string).toContain('Ship the billing export');
  });
});

describe('round 1 (codex): never an all-clear or a "now" it has not read', () => {
  const base = { failedAt: {}, attachedAt: {}, projectIds: {}, chats: [], repos: [], campaigns: [], now: Date.now(), deliveryAttempted: new Set<string>(), deliveredNow: new Set<string>() } as unknown as Omit<NeedsYouInputs, 'runs' | 'gates'>;

  it('P1: on a crew without /system, a needs count still loading is "not read yet", not "nothing"', async () => {
    useSystemStore.setState({ mode: 'fallback', healthAt: Date.now(), healthError: null, snapshot: null } as never);
    useNeedsCount.setState({ phase: 'loading', count: null, rows: [] } as never);
    await askByVoice();
    await waitFor(() => expect(asked).toHaveLength(1));
    const pack = asked[0]![1] as string;
    expect(pack).toMatch(/needs you: not read yet/);
    expect(pack).not.toMatch(/needs you: nothing/);
  });

  it('P2: a system read older than the Nerve Center trusts is not described as now', async () => {
    crewSays(normalizeSnapshot({ ...cert.body, runs: [WORKING] }), 4);
    const old = Date.now() - 10 * 60_000;
    useDashStore.setState({ readAt: old });
    useSystemStore.setState({ snapshotAt: old, healthAt: Date.now() } as never);
    await askByVoice();
    await waitFor(() => expect(asked).toHaveLength(1));
    const pack = asked[0]![1] as string;
    expect(pack).toMatch(/jobs running: not read yet/);
    expect(pack).not.toContain('Dark mode for settings');
  });

  it('P2: a gate is named by the question the Desk shows, not the engine\'s narration', async () => {
    const waiting = makeView({ id: 'r-plan', status: 'awaiting_human', problem: 'Add rate limiting', unit_ix: 1 } as never, [makeUnit({ id: 'r-plan:u1', session_id: 'r-plan', ord: 1, status: 'done' })]);
    const gate = { runId: 'r-plan', ord: 1, prompt: 'Approve plan rev 2 before unit 1 runs.', lifecycle: 'open', receivedAt: 1, gateKind: 'plan' };
    const rows = needsYouRows({ ...base, runs: [waiting], gates: { 'r-plan': gate } as never });
    const row = rows.find((r) => r.kind === 'gate')!;
    expect(row.question).toBeTruthy();
    expect(row.question).not.toBe(row.text);
    useSystemStore.setState({ mode: 'fallback', healthAt: Date.now(), healthError: null, snapshot: null } as never);
    useNeedsCount.setState({ phase: 'complete', count: 1, rows } as never);
    await askByVoice();
    await waitFor(() => expect(asked).toHaveLength(1));
    const pack = asked[0]![1] as string;
    expect(pack).toContain(row.question!);
    expect(pack).not.toContain(row.text);
  });
});

describe('round 1 delta (codex): the number the person sees, and only reads that answered', () => {
  it('P1: a held count with rows that moved on says the held number, never "nothing", and names nobody yet', async () => {
    useSystemStore.setState({ mode: 'fallback', healthAt: Date.now(), healthError: null, snapshot: null } as never);
    useNeedsCount.setState({ phase: 'complete', count: 3, rows: [] } as never);
    await askByVoice();
    await waitFor(() => expect(asked).toHaveLength(1));
    const pack = asked[0]![1] as string;
    expect(pack).toMatch(/needs you: 3\b/);
    expect(pack).not.toMatch(/needs you: nothing/);
  });

  it('P1 (delta 2, P3): a held count of 3 beside one current row names nobody', async () => {
    const base = { failedAt: {}, attachedAt: {}, projectIds: {}, chats: [], repos: [], campaigns: [], now: Date.now(), deliveryAttempted: new Set<string>(), deliveredNow: new Set<string>() } as unknown as Omit<NeedsYouInputs, 'runs' | 'gates'>;
    const waiting = makeView({ id: 'r-plan', status: 'awaiting_human', problem: 'Add rate limiting', unit_ix: 1 } as never, [makeUnit({ id: 'r-plan:u1', session_id: 'r-plan', ord: 1, status: 'done' })]);
    const gate = { runId: 'r-plan', ord: 1, prompt: 'Approve plan rev 2 before unit 1 runs.', lifecycle: 'open', receivedAt: 1, gateKind: 'plan' };
    const rows = needsYouRows({ ...base, runs: [waiting], gates: { 'r-plan': gate } as never });
    const row = rows.find((r) => r.kind === 'gate')!;
    useSystemStore.setState({ mode: 'fallback', healthAt: Date.now(), healthError: null, snapshot: null } as never);
    useNeedsCount.setState({ phase: 'complete', count: 3, rows: [row] } as never);
    await askByVoice();
    await waitFor(() => expect(asked).toHaveLength(1));
    const pack = asked[0]![1] as string;
    expect(pack).toMatch(/needs you: 3\b/);
    expect(pack).not.toContain(row.subject);
    expect(pack).not.toContain(row.question!);
  });

  it('P2: a system read whose latest poll failed is not described as now', async () => {
    crewSays(normalizeSnapshot({ ...cert.body, runs: [WORKING] }), 4);
    useDashStore.setState({ readError: 'crew did not answer' });
    useSystemStore.setState({ snapshotError: 'crew did not answer' } as never);
    await askByVoice();
    await waitFor(() => expect(asked).toHaveLength(1));
    const pack = asked[0]![1] as string;
    expect(pack).toMatch(/jobs running: not read yet/);
    expect(pack).not.toContain('Dark mode for settings');
  });
});

describe('the voice chat sends it (the default ask)', () => {
  let sent: unknown[][] = [];
  beforeEach(() => {
    resetVoiceDeps();
    setVoiceDeps({ speaker: { available: true, say: async () => undefined, cancel: () => undefined }, endChat: () => undefined });
    sent = [];
    setCachedRoster([{ key: 'claude', display_name: 'Claude Code', binary: 'claude', enabled_for_council: true, council_eligible: true, work_eligible: true, health: { status: 'active', since: '2026-11-25T00:00:00Z' }, signed_in: true, auth: 'signed_in' } as never]);
    vi.spyOn(api, 'openChat').mockResolvedValue({ seats: [{ cli: 'claude', ok: true }] } as never);
    vi.spyOn(api, 'sendChatMessage').mockImplementation(async (...args: unknown[]) => { sent.push(args); return { turnId: 't1' } as never; });
    useAskThreadStore.setState({ turns: {} } as never);
    crewSays(CERT, 4);
  });

  it('as context.page beside the words, when crew takes a message context', async () => {
    useCapabilities.setState({ loaded: true, chatContext: true } as never);
    await askByVoice();
    await waitFor(() => expect(sent).toHaveLength(1));
    const [, text, , , context] = sent[0]!;
    expect(text).toBe(QUESTION);
    const page = (context as { page?: string } | undefined)?.page ?? '';
    expect(page.startsWith(PACK_OPENING)).toBe(true);
    for (const t of CERT_TITLES) expect(page).toContain(t);
  });

  it('joined after the words, as Ask does, when crew does not', async () => {
    useCapabilities.setState({ loaded: true, chatContext: false } as never);
    await askByVoice();
    await waitFor(() => expect(sent).toHaveLength(1));
    const text = sent[0]![1] as string;
    expect(text.startsWith(`${QUESTION}${PACK_JOIN}${PACK_OPENING}`)).toBe(true);
    for (const t of CERT_TITLES) expect(text).toContain(t);
  });
});
