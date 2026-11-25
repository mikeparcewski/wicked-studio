import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * crew#1814 / studio#1140 (a): a chat changes the demo video open in it. Crew resolves the `cut` card (its ops, its words
 * for each change, the video and the version it changes); studio draws it, Go answers it, and the version Go made plays
 * in the video's editor. The records are the ones crew itself wrote (tests/fixtures/chat-cut, `_source`).
 */
vi.mock('../src/hooks/useEventStream.js', () => ({ useEventStream: () => undefined }));

const { SessionPage } = await import('../src/components/session/SessionView.js');
const { useCapabilities } = await import('../src/store/capabilities.js');
const { useAskThreadStore } = await import('../src/store/askThread.js');
const { useTeamPlanStore } = await import('../src/store/teamPlan.js');
const { useGateStore } = await import('../src/store/gates.js');
const { useSheets } = await import('../src/store/sheets.js');
const { makeUnit, makeView } = await import('./factories.js');
const { setCachedRoster } = await import('../src/store/rosterCache.js');
const { api } = await import('../src/api/client.js');
const { DemoCutAdapter } = await import('../src/editors/demoCutAdapter.js');
const { demoCut4 } = await import('../src/editors/fixtures/demoCut4.js');
const { onCutLanded, noteCutLanded, resetCutLanded } = await import('../src/store/chatCutLanded.js');
const { foldChatProposals, proposalAsk, changeRoute, proposalRecordLine, proposalResultWords, proposalStarting, resetSettledProposals, isArtifactProposal, isProposalRecord, isProposalView } = await import('../src/board/artifactProposal.js');
const { undoneLine, notUndoneLine } = await import('../src/board/artifactMorph.js');
const { ArtifactProposalCard } = await import('../src/components/chat/ArtifactProposalCard.js');
const { artifactRefOf } = await import('../src/api/chatArtifacts-wire.js');
type Proposal = import('../src/api/chatArtifacts-wire.js').ArtifactProposal;
type Fixture = { records: Array<Record<string, unknown>>; decide: { view?: Record<string, unknown>; code?: string; error?: string } };

const fixture = (name: string): Fixture => JSON.parse(readFileSync(resolve(process.cwd(), `tests/fixtures/chat-cut/${name}.json`), 'utf8')) as Fixture;
const GO = fixture('go');
const MOVED = fixture('moved');
const CARD = (GO.records[0]!['proposal'] as Proposal);
const PID = CARD.pid;
const T0 = 1_700_000_000_000;
const RUN = 'r-ask';
const CHAT = CARD.chatId;

const ASK_RUN = makeView({ id: RUN, status: 'awaiting_human', problem: 'the video', unit_ix: 1, chat_id: CHAT, created_at: T0 / 1000 } as never, [
  makeUnit({ id: `${RUN}:u1`, session_id: RUN, ord: 1, status: 'done', assigned_cli: 'claude', description: 'answer-1' }),
]);
const TURN = [
  { at: T0, turnId: 't1', kind: 'user', seats: ['claude'], text: 'drop the setup chapter and open on sign in' },
  { at: T0 + 1000, turnId: 't1', kind: 'seat', cliKey: 'claude', ok: true, usage: null, text: 'Here is the change.' },
];

let chatBody: Record<string, unknown> = {};
const posts: Array<{ path: string; body: unknown }> = [];
let decideAnswer: () => Response = () => new Response('{}', { status: 500 });

function ok(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  posts.length = 0;
  localStorage.clear();
  resetSettledProposals();
  resetCutLanded();
  chatBody = { chatId: CHAT, seats: ['claude'], scope: { kind: 'none' }, messages: [...TURN, { ...GO.records[0], at: T0 + 1500 }], path: { runId: RUN, pa: 'claude', selection: 'random', reviewer: null, helpers: [], stepId: 'answer-1' } };
  useCapabilities.setState({ loaded: true, runChatId: true, askPath: true, chatProposals: true, chatArtifactsStub: false, chatList: true, chatCut: true });
  useAskThreadStore.setState({ turns: {}, runByChat: {}, runs: new Set(), creatorAccepted: {}, chatClosed: {}, turnGates: {}, replySeq: {}, paByChat: {}, retiredByChat: {}, answerOrds: { [RUN]: [1] } });
  useAskThreadStore.getState().recordTurnGate(RUN, 1);
  useTeamPlanStore.setState({ byRun: {}, refs: {} });
  useGateStore.setState({ gates: {}, approaching: {} });
  useSheets.setState({ open: null, pointed: null, stopping: {} });
  setCachedRoster([{ key: 'claude', display_name: 'Claude Code', binary: 'claude', enabled_for_council: true } as never]);
  // The decided view crew answered, decided now (a decision of minutes ago plays in the editor).
  decideAnswer = () => ok({ view: { ...GO.decide.view, decidedAt: Date.now() } });
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    const path = new URL(url, 'http://x').pathname.replace(/^\/api\/v1/, '');
    if (init?.method === 'POST') {
      posts.push({ path, body: JSON.parse(String(init.body)) });
      return Promise.resolve(path.includes('/proposals/') ? decideAnswer() : ok({}));
    }
    if (path.includes('/considered')) return Promise.resolve(new Response('{}', { status: 404 }));
    if (path.startsWith('/chats/') && path.endsWith('/messages')) return Promise.resolve(new Response('{}', { status: 404 }));
    if (path.startsWith('/chats/')) return Promise.resolve(ok(chatBody));
    if (path.endsWith('/team')) return Promise.resolve(new Response('{}', { status: 404 }));
    if (path.endsWith('/events')) return Promise.resolve(ok({ events: [] }));
    return Promise.resolve(ok({}));
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); useCapabilities.setState({ chatCut: false }); });

function page() {
  return render(<SessionPage sessionId={CHAT} runs={[ASK_RUN]} runsLoaded needRows={[]} navigate={() => {}} onAsk={() => {}} />);
}
const text = (id: string): string => screen.getByTestId(id).textContent?.replace(/\s+/g, ' ').trim() ?? '';

describe('the cut card model', () => {
  it('draws the card crew wrote; a half one is never drawn; its words; what Go did', () => {
    expect(isArtifactProposal(CARD)).toBe(true);
    expect(isArtifactProposal({ ...CARD, cut: undefined })).toBe(false);
    expect(isArtifactProposal({ ...CARD, target: undefined })).toBe(false);
    expect(isArtifactProposal({ ...CARD, cut: { ...CARD.cut!, changes: CARD.cut!.changes.slice(1) } })).toBe(false);
    expect(isArtifactProposal({ ...CARD, cut: { ops: [{ op: 'chapter-explode', chapter: 'x' }], changes: ['x'] } })).toBe(false);
    const [e] = foldChatProposals(GO.records.slice(0, 1));
    expect(proposalAsk(e!, { stub: false }).options?.map((o) => [o.label, o.sub])).toStrictEqual([
      ['Change the video', 'Makes a new version; the old one stays in Versions'],
      ['Change something', 'Say it in the chat'],
      ['Not now', 'The video stays as it is'],
    ]);
    expect(changeRoute('cut')).toMatchObject({ kind: 'stub', note: expect.stringMatching(/say so in the chat/) });
    const [accepting] = foldChatProposals(GO.records.slice(0, 2));
    expect(proposalRecordLine(accepting!, true)).toBe('Making the new version…');
    expect(proposalRecordLine(accepting!, false)).toBe('Interrupted before the new version was recorded. Go again checks whether it was made.');
    const [done] = foldChatProposals(GO.records);
    expect(proposalRecordLine(done!)).toBe('You chose: Change the video');
    expect(proposalResultWords(done!)).toBe('Changed · version 2');
  });

  it('an op missing what its kind needs, a blank change or chapter, or a version that is no version, is never drawn (review r1)', () => {
    const one = (op: Record<string, unknown>, change = 'x') => isArtifactProposal({ ...CARD, cut: { ops: [op], changes: [change] } });
    expect(one({ op: 'chapter-drop', chapter: 's2' })).toBe(true);
    expect(one({ op: 'chapter-drop', chapter: 's2' }, '')).toBe(false);
    expect(one({ op: 'chapter-drop', chapter: '' })).toBe(false);
    expect(one({ op: 'chapter-rename', chapter: 's2' })).toBe(false);
    expect(one({ op: 'chapter-rename', chapter: 's2', title: 'Sign in' })).toBe(true);
    expect(one({ op: 'chapter-move', chapter: 's2' })).toBe(false);
    expect(one({ op: 'chapter-move', chapter: 's2', after: null })).toBe(true);
    expect(one({ op: 'chapter-move', chapter: 's2', after: '' })).toBe(false);
    expect(one({ op: 'chapter-trim', chapter: 's2', inSec: 0 })).toBe(false);
    expect(one({ op: 'chapter-trim', chapter: 's2', inSec: 0, outSec: 2.5 })).toBe(true);
    expect(one({ op: 'chapter-say', chapter: 's2' })).toBe(false);
    expect(one({ op: 'chapter-say', chapter: 's2', say: '' })).toBe(true);
    const decided = GO.records[2]!;
    expect(isProposalRecord(decided)).toBe(true);
    for (const version of [{ toString: null }, '2', 0, -1, 1.5]) {
      expect(isProposalRecord({ ...decided, result: { ...(decided['result'] as object), version } })).toBe(false);
      expect(isProposalView({ ...GO.decide.view, result: { ...(GO.decide.view!['result'] as object), version } })).toBe(false);
    }
  });

  it('crew\'s card names the video by the same ref the editor registers for it', () => {
    expect(artifactRefOf('mikes', 'demo-8e0ffbece431')).toBe(CARD.target!.ref);
  });
});

describe('a cut card in the chat', () => {
  it('shows the video, the version it changes and each change in crew\'s words; Go answers it and the new version is told to the editor', async () => {
    const heard: number[] = [];
    const off = onCutLanded(CARD.target!.ref, async (l) => { heard.push(l.version); return true; });
    page();
    await waitFor(() => expect(screen.getByTestId('artifact-proposal')).toBeTruthy());
    expect(text('artifact-proposal-what')).toBe('Change the video · Demo of http://127.0.0.1:5173/');
    expect(text('artifact-proposal-target')).toBe('VideoDemo of http://127.0.0.1:5173/ · from version 1');
    expect(screen.getAllByTestId('artifact-proposal-cut-change').map((li) => li.textContent)).toStrictEqual(CARD.cut!.changes);
    expect(CARD.cut!.changes[0]).toBe('Drop “Setup” (Undo brings it back)');
    expect(screen.getByTestId('artifact-proposal').textContent).toContain('Video change from Claude Code · nothing changes until you choose');
    fireEvent.click(screen.getByRole('button', { name: /Change the video/ }));
    await waitFor(() => expect(posts.some((p) => p.path === `/chats/${CHAT}/proposals/${encodeURIComponent(PID)}`)).toBe(true));
    expect(posts.find((p) => p.path.includes('/proposals/'))!.body).toStrictEqual({ decision: 'go' });
    await waitFor(() => expect(heard).toStrictEqual([2]));
    off();
  });

  it('a decision read back without its date, or on a crew that draws no cut cards, plays nothing (review r1)', async () => {
    const heard: number[] = [];
    const off = onCutLanded(CARD.target!.ref, async (l) => { heard.push(l.version); return true; });
    const view: Record<string, unknown> = { ...GO.decide.view };
    delete view['decidedAt'];
    decideAnswer = () => ok({ view });
    page();
    await waitFor(() => expect(screen.getByTestId('artifact-proposal')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Change the video/ }));
    await waitFor(() => expect(screen.getByTestId('artifact-proposal').textContent).toContain('Changed · version 2'));
    await Promise.resolve();
    expect(heard).toStrictEqual([]);
    off();
  });

  it.each([[true, [2]], [false, []]] as const)('a fresh decision read back from the chat plays where crew draws cut cards (chatCut %s) (review r1 delta)', async (cut, want) => {
    useCapabilities.setState({ chatCut: cut });
    const heard: number[] = [];
    const off = onCutLanded(CARD.target!.ref, async (l) => { heard.push(l.version); return true; });
    chatBody = { ...chatBody, messages: [...TURN, ...GO.records.map((r) => ({ ...r, at: Date.now() }))] };
    page();
    await waitFor(() => expect(screen.getByTestId('artifact-proposal').textContent).toContain('Changed · version 2'));
    await vi.waitFor(() => expect(heard).toStrictEqual(want));
    off();
  });

  it('on a crew without chatArtifacts.cut, a cut card kept in the chat says why it can\'t go (review r1)', async () => {
    useCapabilities.setState({ chatCut: false });
    page();
    await waitFor(() => expect(screen.getByTestId('artifact-proposal')).toBeTruthy());
    const go = screen.getByTestId('artifact-proposal').querySelector<HTMLButtonElement>('[data-ask-option="go"]');
    expect(go?.disabled).toBe(true);
    expect(screen.queryByRole('button', { name: /^Change the video$/ })).toBeNull();
    expect(screen.getByTestId('artifact-proposal').textContent).toContain('This studio can’t change videos from a chat yet. Change it by hand in its editor.');
    // Only Go is refused: Change something (say it in the chat) and Not now still answer.
    const change = screen.getByTestId('artifact-proposal').querySelector<HTMLButtonElement>('[data-ask-option="change"]');
    expect(change?.disabled).toBe(false);
  });

  it('a card crew blocked says why in crew\'s own sentence (no "Nothing was started" tacked on)', async () => {
    chatBody = { ...chatBody, messages: [...TURN, ...MOVED.records.map((r, i) => ({ ...r, at: T0 + 1500 + i }))] };
    page();
    await waitFor(() => expect(screen.getByTestId('artifact-proposal-blocked')).toBeTruthy());
    expect(text('artifact-proposal-blocked')).toBe('Can’t change the video. The video changed since this was proposed (now version 2). Ask again to change the new version.');
  });
});

describe('the video a chat changed', () => {
  it('each version is dealt with once, never an older one, and one no editor took waits for the next', async () => {
    const heard: number[] = [];
    const off = onCutLanded('mikes/demo', async (l) => { heard.push(l.version); return true; });
    noteCutLanded({ ref: 'mikes/demo', version: 3, base: 2 });
    await vi.waitFor(() => expect(heard).toStrictEqual([3]));
    noteCutLanded({ ref: 'mikes/demo', version: 3, base: 2 });
    noteCutLanded({ ref: 'mikes/demo', version: 2, base: 1 });
    noteCutLanded({ ref: 'mikes/other', version: 9, base: 8 });
    noteCutLanded({ ref: 'mikes/demo', version: 4, base: 3 });
    await vi.waitFor(() => expect(heard).toStrictEqual([3, 4]));
    off();
    // No editor of the video is open: the landing waits for the next one to mount.
    noteCutLanded({ ref: 'mikes/demo', version: 5, base: 4 });
    await Promise.resolve();
    expect(heard).toStrictEqual([3, 4]);
    const later: number[] = [];
    const off2 = onCutLanded('mikes/demo', async (l) => { later.push(l.version); return true; });
    await vi.waitFor(() => expect(later).toStrictEqual([5]));
    off2();
  });

  it('an editor that couldn\'t deal with a landing (its re-read failed) gets it again on the next note (review r1)', async () => {
    const tries: number[] = [];
    let fail = true;
    const off = onCutLanded('mikes/demo', async (l) => {
      tries.push(l.version);
      if (fail) throw new Error('offline');
      return true;
    });
    noteCutLanded({ ref: 'mikes/demo', version: 2, base: 1 });
    await vi.waitFor(() => expect(tries).toStrictEqual([2]));
    fail = false;
    noteCutLanded({ ref: 'mikes/demo', version: 2, base: 1 });
    await vi.waitFor(() => expect(tries).toStrictEqual([2, 2]));
    noteCutLanded({ ref: 'mikes/demo', version: 2, base: 1 });
    await Promise.resolve();
    expect(tries).toStrictEqual([2, 2]);
    off();
  });

  it('the editor never goes back to an older version when a slower read answers after a newer one (S3)', async () => {
    const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'Content-Type': 'application/json' } });
    let answerOld: (r: Response) => void = () => undefined;
    vi.stubGlobal('fetch', vi.fn()
      .mockImplementationOnce(() => new Promise<Response>((r) => { answerOld = r; }))
      .mockResolvedValueOnce(json({ ...demoCut4, rev: 4, version: 8 })));
    const a = new DemoCutAdapter('p', 'team demo', 'Team demo');
    const slow = a.refresh();
    await a.refresh();
    expect(a.artifact().head).toBe(8);
    answerOld(json({ ...demoCut4, rev: 3, version: 7 }));
    await slow;
    expect(a.artifact().head).toBe(8);
  });

  it('a slow read that answers after an Undo or Restore (which drops the cached cut) reads again, never going back (review r1)', async () => {
    const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'Content-Type': 'application/json' } });
    let answerOld: (r: Response) => void = () => undefined;
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(json({ ...demoCut4, rev: 1, version: 8 }))          // the first read
      .mockImplementationOnce(() => new Promise<Response>((r) => { answerOld = r; })) // the idle re-read, slow
      .mockResolvedValueOnce(json({ ...demoCut4, rev: 1, version: 8 }))          // the restore's own read
      .mockResolvedValueOnce(json({ rev: 2, version: 9 }))                        // POST restore: version 9
      .mockResolvedValueOnce(json({ ...demoCut4, rev: 2, version: 9 })));        // the read again
    const a = new DemoCutAdapter('p', 'team demo', 'Team demo');
    await a.refresh();
    const slow = a.refresh();
    expect(await a.restoreVersion(7)).toStrictEqual({ version: 9 });
    expect(a.artifact().head).toBe(9);
    answerOld(json({ ...demoCut4, rev: 1, version: 8 }));
    await slow;
    expect(a.artifact().head).toBe(9);
    expect(a.artifact().read).toBe(true);
  });
});

describe('accepts: ["cut"]', () => {
  it('is declared only where crew advertises chatArtifacts.cut', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
      return Promise.resolve(new Response(JSON.stringify({ chatId: 'c1', seats: [], turnId: 't1' }), { status: 201, headers: { 'content-type': 'application/json' } }));
    }));
    useCapabilities.setState({ chatJobProposals: true, chatOnboard: false, chatCut: true });
    await api.sendChatMessage('c1', 'drop the setup chapter');
    useCapabilities.setState({ chatCut: false });
    await api.sendChatMessage('c1', 'drop the setup chapter');
    expect(bodies.map((b) => b['accepts'])).toStrictEqual([['job', 'cut'], ['job']]);
    useCapabilities.setState({ chatJobProposals: false });
  });

  it('the capability is read from crew\'s health (chatArtifacts.cut)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ status: 'ok', capabilities: { chatArtifacts: { context: true, proposals: true, create: true, refine: true, theme: true, demo: false, onboard: true, cutInView: true, cut: true } } }), { status: 200, headers: { 'content-type': 'application/json' } }))));
    useCapabilities.setState({ loaded: false, chatCut: false });
    await useCapabilities.getState().load();
    expect(useCapabilities.getState().chatCut).toBe(true);
  });
});

describe('round-2 words (coord R2 on studio#1409)', () => {
  it('LOOK: a cut card has no "Filed in" row, and its result is just the version it made', async () => {
    page();
    await waitFor(() => expect(screen.getByTestId('artifact-proposal')).toBeTruthy());
    expect(screen.queryByTestId('artifact-proposal-filed')).toBeNull();
    const [done] = foldChatProposals(GO.records);
    expect(proposalResultWords(done!)).toBe('Changed · version 2');
  });

  it('F1: a Go crew refused because the video moved says crew\'s sentence once', async () => {
    decideAnswer = () => ok(MOVED.decide, 409);
    page();
    await waitFor(() => expect(screen.getByTestId('artifact-proposal')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /^Change the video$/ }));
    const said = MOVED.decide.error!;
    await waitFor(() => expect(screen.getByTestId('artifact-proposal-blocked')).toBeTruthy());
    const all = screen.getByTestId('artifact-proposal').textContent ?? '';
    expect(all.split(said).length - 1).toBe(1);
  });

  it('F2: an interrupted cut reads "Making the new version…" for as long as a render can take, and a Go again crew answers cut_pending says it is still being made', async () => {
    const [accepting] = foldChatProposals(GO.records.slice(0, 2));
    const at = accepting!.acceptingAt!;
    expect(proposalStarting(accepting!, at + 5 * 60_000, false)).toBe(true);
    expect(proposalStarting(accepting!, at + 16 * 60_000, false)).toBe(false);
    expect(proposalRecordLine(accepting!, false, true)).toBe('Still making the new version. Go again shows it here once it’s made.');
    // A reload long after the Go: the card offers Go again; crew answers that the render is still going.
    chatBody = { ...chatBody, messages: [...TURN, ...GO.records.slice(0, 2).map((r, i) => ({ ...r, at: T0 + 1500 + i }))] };
    // crew chat-proposals.ts (cut_pending on Go again): the words, the accepting record this Go wrote, the view.
    decideAnswer = () => ok({ code: 'cut_pending', error: 'Still making the new version. It shows here when it is done.', acceptingAt: Date.now(), view: { ...GO.decide.view, state: 'accepting', decision: undefined, result: undefined } }, 409);
    page();
    await waitFor(() => expect(screen.getByTestId('artifact-proposal-go-again')).toBeTruthy());
    fireEvent.click(screen.getByTestId('artifact-proposal-go-again'));
    await waitFor(() => expect(screen.getByTestId('artifact-proposal').textContent).toContain('Still making the new version. Go again shows it here once it’s made.'));
    expect(screen.getByTestId('artifact-proposal').textContent).not.toContain('Interrupted');
    expect(screen.queryByTestId('artifact-proposal-error')).toBeNull();
  });

  it('F2 (round 1): a Go again crew answers cut_pending right after an interrupted Go says "still making" and keeps Go again, for that record only', async () => {
    const accepting = { ...GO.decide.view, state: 'accepting', decision: undefined, result: undefined };
    const first = Date.now();
    // crew chat-proposals.ts: launch_failed names the accepting record its Go wrote (`acceptingAt`); a Go again that finds
    // the render still going answers cut_pending before writing one (:1649, no `acceptingAt`). The parent's entry stays
    // the open card here (its re-read hasn't come), so only the card's own view knows the record.
    const answers = [
      () => ok({ code: 'launch_failed', error: 'I lost track of the new version while it was being made (socket hang up). Go again checks whether it finished.', acceptingAt: first, view: accepting }, 502),
      () => ok({ code: 'cut_pending', error: 'Still making the new version. It shows here when it is done.', view: accepting }, 409),
      () => new Response('', { status: 503 }),
    ];
    decideAnswer = () => answers.shift()!();
    const [open] = foldChatProposals(GO.records.slice(0, 1));
    const card = (e: typeof open) => <ArtifactProposalCard chatId={CHAT} entry={e!} seatName="Claude Code" stub={false} onChanged={() => {}} />;
    const { rerender } = render(card(open));
    fireEvent.click(screen.getByRole('button', { name: /^Change the video$/ }));
    await waitFor(() => expect(screen.getByTestId('artifact-proposal-go-again')).toBeTruthy());
    fireEvent.click(screen.getByTestId('artifact-proposal-go-again'));
    await waitFor(() => expect(text('artifact-proposal-record')).toBe('Still making the new version. Go again shows it here once it’s made.'));
    expect(screen.getByTestId('artifact-proposal-go-again')).toBeTruthy();
    expect(screen.queryByTestId('artifact-proposal-error')).toBeNull();
    // studio#1417: still being made is in progress, never the finished check.
    expect(screen.getByTestId('ask-record-row')).toHaveAttribute('data-state', 'progress');
    expect(screen.getByTestId('ask-record-row').querySelector('.wk-ask-record-ok')).toBeNull();
    // A Go again that never reached crew says nothing new about the render: still making, Go again still there.
    fireEvent.click(screen.getByTestId('artifact-proposal-go-again'));
    await waitFor(() => expect(screen.getByTestId('artifact-proposal-error')).toBeTruthy());
    expect(text('artifact-proposal-record')).toBe('Still making the new version. Go again shows it here once it’s made.');
    expect(screen.getByTestId('artifact-proposal-go-again')).toBeTruthy();
    // Another tab's newer Go: its own record, which this tab's "still making" says nothing about.
    const newer = foldChatProposals([GO.records[0]!, { ...GO.records[1]!, at: first + 5000 }])[0];
    rerender(card(newer));
    await waitFor(() => expect(text('artifact-proposal-record')).toBe('Making the new version…'));
    // The video tool made it: the decided record ends the card on the version, nothing of "still making" left.
    rerender(card(foldChatProposals(GO.records.map((r, i) => (i === 0 ? r : { ...r, at: first + 6000 + i })))[0]));
    await waitFor(() => expect(screen.getByTestId('artifact-proposal').textContent).toContain('Changed · version 2'));
    expect(screen.getByTestId('artifact-proposal').textContent).not.toMatch(/making the new version/iu);
  });

  it('F3: the Undo lines on a video say "video" and never claim the change stays when it may already be undone', () => {
    expect(undoneLine(3, 'video')).toBe('Undone — version 3 is the video before that change.');
    expect(notUndoneLine(4, 'video')).toBe('Not undone — the video changed since (now version 4), in another editor or tab. Versions has every version if you want an earlier one.');
    expect(undoneLine(3)).toBe('Undone — version 3 is the page before your change.');
  });

  it('F5: while studio is still reading what crew can do, a cut card\'s Go is not refused', async () => {
    page();
    await waitFor(() => expect(screen.getByTestId('artifact-proposal')).toBeTruthy());
    // The page waits for capabilities; a card drawn elsewhere (a session's chat) may not. Unknown is not "can't".
    act(() => useCapabilities.setState({ loaded: false, chatCut: false }));
    expect(screen.queryByText(/can’t change videos/)).toBeNull();
    const go = screen.getByTestId('artifact-proposal').querySelector<HTMLButtonElement>('[data-ask-option="go"]');
    expect(go?.disabled).toBe(false);
  });
});
