import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The decisions store (DC-S6): the mode read once from `GET /decisions`; a transcript's `decisions`
 * record and a live `chatDecisions` frame land in the same turn slot (so a reload restores the
 * line); `decisionChanged` applies the state at once and re-reads the view; one action in flight
 * per decision; a refusal is kept in the daemon's words.
 */

const apiFetch = vi.fn();
vi.mock('../src/api/client.js', () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }));

const { useDecisionsStore, resetDecisionsStoreForTest, turnKey } = await import('../src/store/decisions.js');
const { ApiError } = await import('../src/api/errors.js');
type DecisionView = import('../src/api/decisions.js').DecisionView;

function view(over: Partial<DecisionView> = {}): DecisionView {
  return {
    id: 'dec_1', at: 1000, project_id: 'p1', host: 'studio-chat',
    origin: { actor: { id: 'op', kind: 'human', trust: 'operator' }, auth_mode: 'required', chat_id: 'chat-pay', turn_id: 't9', words: 'always x', words_source: 'typed', redacted: false },
    derived: { statement: 'Always x', polarity: 'do', key: 'x', scope: 'project', steering_type: 'development', template: 'T1-always', exclusions: [] },
    route: 'offer', state: 'offered', proposal_id: 'pr-1', ...over,
  };
}

beforeEach(() => {
  apiFetch.mockReset();
  resetDecisionsStoreForTest();
});

describe('load', () => {
  it('reads the mode once; a daemon without /decisions is mode off', async () => {
    apiFetch.mockResolvedValueOnce({ decisions: [view()], mode: 'on' });
    await useDecisionsStore.getState().load();
    await useDecisionsStore.getState().load();
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(String(apiFetch.mock.calls[0]![0])).toMatch(/^\/decisions\?since=\d+$/);
    expect(useDecisionsStore.getState().mode).toBe('on');
    expect(useDecisionsStore.getState().byId['dec_1']).toBeDefined();

    resetDecisionsStoreForTest();
    apiFetch.mockRejectedValueOnce(new ApiError(404, 'Not Found'));
    await useDecisionsStore.getState().load();
    expect(useDecisionsStore.getState().mode).toBe('off');
    expect(useDecisionsStore.getState().loaded).toBe(true);
  });
});

describe('turns', () => {
  it('a transcript record and a live frame land in the same slot, without duplicates', () => {
    const s = useDecisionsStore.getState();
    s.ingestTurn('chat-pay', 't9', [view()]);
    s.ingest({ type: 'chatDecisions', chat: 'chat-pay', turn_id: 't9', items: [view(), view({ id: 'dec_2' })] });
    expect(useDecisionsStore.getState().byTurn[turnKey('chat-pay', 't9')]).toEqual(['dec_1', 'dec_2']);
    s.ingest({ type: 'unitOutputDelta', text: 'noise' });
    expect(Object.keys(useDecisionsStore.getState().byId)).toEqual(['dec_1', 'dec_2']);
  });
  it('a transcript snapshot never steps a held view back; syncChat reads the ledger’s current views once', async () => {
    const s = useDecisionsStore.getState();
    s.ingestTurn('chat-pay', 't9', [view({ state: 'remembered', how: 'chip', rule_id: 'proposal:pr-1' })]);
    // The transcript's record is as old as the turn: still "offered".
    s.ingestTurn('chat-pay', 't9', [view()]);
    expect(useDecisionsStore.getState().byId['dec_1']!.state).toBe('remembered');
    apiFetch.mockResolvedValueOnce({ decisions: [view({ state: 'undone' })], mode: 'on' });
    await s.syncChat('chat-pay');
    await s.syncChat('chat-pay');
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(String(apiFetch.mock.calls[0]![0])).toBe('/decisions?chat=chat-pay');
    expect(useDecisionsStore.getState().byId['dec_1']!.state).toBe('undone');
  });
  it('decisionChanged applies the state at once, then re-reads the view by its chat', async () => {
    useDecisionsStore.getState().ingestTurn('chat-pay', 't9', [view()]);
    apiFetch.mockResolvedValueOnce({ decisions: [view({ state: 'remembered', rule_id: 'proposal:pr-1', how: 'needs-you' })], mode: 'on' });
    useDecisionsStore.getState().ingest({ type: 'decisionChanged', id: 'dec_1', state: 'remembered', rule_id: 'proposal:pr-1', project_id: 'p1' });
    expect(useDecisionsStore.getState().byId['dec_1']!.state).toBe('remembered');
    await vi.waitFor(() => expect(useDecisionsStore.getState().byId['dec_1']!.how).toBe('needs-you'));
    expect(String(apiFetch.mock.calls[0]![0])).toBe('/decisions?chat=chat-pay');
  });
});

describe('late reads', () => {
  it('a sync or refresh that started before an action answered never steps the decision back', async () => {
    useDecisionsStore.getState().ingestTurn('chat-pay', 't9', [view()]);
    // The chat sync starts first and answers LAST, carrying the old "offered" state.
    let releaseSync: () => void = () => {};
    apiFetch.mockImplementationOnce(() => new Promise((r) => { releaseSync = () => r({ decisions: [view()], mode: 'on' }); }));
    const sync = useDecisionsStore.getState().syncChat('chat-pay');
    apiFetch.mockResolvedValueOnce({ rule_id: 'proposal:pr-1', proposal_id: 'pr-1' });
    apiFetch.mockResolvedValueOnce({ decisions: [view({ state: 'remembered', how: 'chip', rule_id: 'proposal:pr-1' })], mode: 'on' });
    await new Promise((r) => setTimeout(r, 2));
    await useDecisionsStore.getState().remember('dec_1');
    expect(useDecisionsStore.getState().byId['dec_1']!.state).toBe('remembered');
    releaseSync();
    await sync;
    expect(useDecisionsStore.getState().byId['dec_1']!.state).toBe('remembered');
  });
});

describe('a decisionChanged frame is authority', () => {
  it('an older sync answering after the frame does not restore the state the frame retired', async () => {
    useDecisionsStore.getState().ingestTurn('chat-pay', 't9', [view({ state: 'remembered', how: 'auto', rule_id: 'proposal:pr-1' })]);
    let releaseSync: () => void = () => {};
    apiFetch.mockImplementationOnce(() => new Promise((r) => { releaseSync = () => r({ decisions: [view({ state: 'remembered', how: 'auto', rule_id: 'proposal:pr-1' })], mode: 'on' }); }));
    const sync = useDecisionsStore.getState().syncChat('chat-pay');
    await new Promise((r) => setTimeout(r, 2));
    apiFetch.mockResolvedValueOnce({ decisions: [view({ state: 'undone' })], mode: 'on' });
    useDecisionsStore.getState().ingest({ type: 'decisionChanged', id: 'dec_1', state: 'undone', project_id: 'p1' });
    expect(useDecisionsStore.getState().byId['dec_1']!.state).toBe('undone');
    releaseSync();
    await sync;
    expect(useDecisionsStore.getState().byId['dec_1']!.state).toBe('undone');
  });
});

describe('actions', () => {
  it('Remember posts once, applies the state, then re-reads; a second press while busy is ignored', async () => {
    useDecisionsStore.getState().ingestTurn('chat-pay', 't9', [view()]);
    let release: () => void = () => {};
    apiFetch.mockImplementationOnce(() => new Promise((r) => { release = () => r({ rule_id: 'proposal:pr-1', proposal_id: 'pr-1' }); }));
    apiFetch.mockResolvedValueOnce({ decisions: [view({ state: 'remembered', how: 'chip', rule_id: 'proposal:pr-1' })], mode: 'on' });
    const first = useDecisionsStore.getState().remember('dec_1');
    const second = useDecisionsStore.getState().remember('dec_1');
    expect(useDecisionsStore.getState().busy['dec_1']).toBe(true);
    release();
    await Promise.all([first, second]);
    const posts = apiFetch.mock.calls.filter((c) => String(c[0]) === '/decisions/dec_1/remember');
    expect(posts).toHaveLength(1);
    expect((posts[0]![1] as RequestInit).method).toBe('POST');
    expect(useDecisionsStore.getState().byId['dec_1']!.state).toBe('remembered');
    expect(useDecisionsStore.getState().busy['dec_1']).toBeUndefined();
  });
  it('Undo, Not a rule, Same and Make it apply everywhere ride their routes with their bodies', async () => {
    useDecisionsStore.getState().ingestTurn('chat-pay', 't9', [view()]);
    apiFetch.mockResolvedValue({ decisions: [view()], mode: 'on', ok: true, rule_id: 'r' });
    await useDecisionsStore.getState().undo('dec_1');
    await useDecisionsStore.getState().dismiss('dec_1', 'not-a-rule');
    await useDecisionsStore.getState().same('dec_1', true);
    await useDecisionsStore.getState().widen('dec_1');
    const posts = apiFetch.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === 'POST').map((c) => [String(c[0]), (c[1] as RequestInit).body ?? null]);
    expect(posts).toEqual([
      ['/decisions/dec_1/undo', null],
      ['/decisions/dec_1/dismiss', JSON.stringify({ reason: 'not-a-rule' })],
      ['/decisions/dec_1/same', JSON.stringify({ same: true })],
      ['/decisions/dec_1/widen', null],
    ]);
  });
  it('a refusal is kept in the daemon’s words and the state is not touched', async () => {
    useDecisionsStore.getState().ingestTurn('chat-pay', 't9', [view()]);
    apiFetch.mockRejectedValueOnce(new ApiError(403, 'only a human may remember a rule'));
    await useDecisionsStore.getState().remember('dec_1');
    expect(useDecisionsStore.getState().error['dec_1']).toContain('only a human may remember a rule');
    expect(useDecisionsStore.getState().byId['dec_1']!.state).toBe('offered');
  });
});
