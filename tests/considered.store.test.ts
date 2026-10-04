import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The considered store (DC-S8): one read per key at a time — but a read asked for WHILE one is in
 * flight (a reply landed between the request and its answer) is not dropped: the store reads again
 * once the first lands, so the line never shows a Consideration older than the turn it sits under.
 */

const apiFetch = vi.fn();
vi.mock('../src/api/client.js', () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }));

const { useConsideredStore, resetConsideredStoreForTest } = await import('../src/store/considered.js');
type Consideration = import('../src/api/considered.js').Consideration;

function c(cited: Consideration['cited']): Consideration {
  return {
    subject: { kind: 'chat', chat_id: 'chat-pay', turn_id: 'd2' }, key: 'considered:chat-pay:d2', project_id: 'upload-endpoint',
    considered: [{ id: 'proposal:pr-auto', statement: 'Always check the payment provider’s records', severity: 'warn' }],
    set_aside: [], cited, source: 'considerRules',
  };
}

beforeEach(() => {
  apiFetch.mockReset();
  resetConsideredStoreForTest();
});

describe('considered store — a read asked for while one is in flight', () => {
  it('reads again once the first lands, so the reply that arrived meanwhile is not missed', async () => {
    let answerFirst!: (v: Consideration) => void;
    apiFetch.mockImplementationOnce(() => new Promise<Consideration>((res) => { answerFirst = res; }));
    apiFetch.mockImplementationOnce(() => Promise.resolve(c([{ id: 'proposal:pr-auto', by: 'codex', status: 'unchecked', label: 'l' }])));
    const s = useConsideredStore.getState();
    const p1 = s.loadTurn('chat-pay', 'd2');
    const p2 = s.loadTurn('chat-pay', 'd2'); // the turn gained a reply while the first read was pending
    expect(apiFetch).toHaveBeenCalledTimes(1);
    answerFirst(c([]));
    await Promise.all([p1, p2]);
    expect(apiFetch).toHaveBeenCalledTimes(2);
    expect(useConsideredStore.getState().byKey['considered:chat-pay:d2']?.cited).toHaveLength(1);
  });

  it('with no second ask, one read; a settled key asked again reads afresh', async () => {
    apiFetch.mockResolvedValue(c([]));
    const s = useConsideredStore.getState();
    await Promise.all([s.loadTurn('chat-pay', 'd2')]);
    expect(apiFetch).toHaveBeenCalledTimes(1);
    await s.loadTurn('chat-pay', 'd2');
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });
});
