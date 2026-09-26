import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The needs-you queue's app-level REST source (src/store/needsSources.ts): one reader per wire,
 * shared in-flight reads, a freshness window instead of per-mount re-reads, zero-request
 * deposits, and failure tolerance.
 */

const listChats = vi.fn();
const listRepos = vi.fn();
const listProposals = vi.fn();
const listCampaigns = vi.fn();

vi.mock('../src/api/client.js', () => ({ api: { listChats, listRepos } }));
vi.mock('../src/api/proposals.js', () => ({ listProposals }));
vi.mock('../src/api/campaigns.js', () => ({ listCampaigns }));

const { HOME_FRESH_MS, resetNeedsSourcesForTest, useNeedsSources } = await import('../src/store/needsSources.js');

const proposal = { id: 'p1', kind_type: 'memory', payload: {}, facets: {}, provenance: {}, state: 'pending', created_at: 1 };

beforeEach(() => {
  resetNeedsSourcesForTest();
  vi.useRealTimers();
  listChats.mockReset().mockResolvedValue({ chats: [{ chatId: 'c1', seats: ['claude'], idleSecs: 3 }] });
  listRepos.mockReset().mockResolvedValue({ repos: [{ id: 'r1', name: 'repo-one' }] });
  listProposals.mockReset().mockResolvedValue([proposal]);
  listCampaigns.mockReset().mockResolvedValue({ campaigns: [], groups: [], testSets: null, malformedTestSets: 0 });
});

describe('needsSources', () => {
  it('load() reads each wire once; concurrent callers share the in-flight read', async () => {
    const s = useNeedsSources.getState();
    await Promise.all([s.load(), s.load(HOME_FRESH_MS), s.loadRepos(HOME_FRESH_MS)]);
    expect(listChats).toHaveBeenCalledTimes(1);
    expect(listRepos).toHaveBeenCalledTimes(1);
    expect(listProposals).toHaveBeenCalledTimes(1);
    expect(listProposals).toHaveBeenCalledWith({ state: 'pending' });
    expect(listCampaigns).toHaveBeenCalledTimes(1);
    const st = useNeedsSources.getState();
    expect(st.chats?.map((c) => c.chatId)).toEqual(['c1']);
    expect(st.repos?.map((r) => r.id)).toEqual(['r1']);
    expect(st.proposals?.map((p) => p.id)).toEqual(['p1']);
  });

  it('a fresh wire is not re-read; a stale one is (the Home freshness window)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_000_000);
    await useNeedsSources.getState().load();
    vi.setSystemTime(1_000_000 + HOME_FRESH_MS - 1);
    await useNeedsSources.getState().load(HOME_FRESH_MS);
    expect(listChats).toHaveBeenCalledTimes(1);
    // The shell's startup call never re-reads, however old.
    vi.setSystemTime(1_000_000 + 10 * HOME_FRESH_MS);
    await useNeedsSources.getState().load();
    expect(listChats).toHaveBeenCalledTimes(1);
    await useNeedsSources.getState().load(HOME_FRESH_MS);
    expect(listChats).toHaveBeenCalledTimes(2);
    expect(listRepos).toHaveBeenCalledTimes(2);
  });

  it('a failed read keeps the last answer and counts as a read (no retry storm)', async () => {
    await useNeedsSources.getState().load();
    listChats.mockRejectedValue(new Error('404'));
    listProposals.mockImplementation(() => { throw new Error('route absent'); });
    await useNeedsSources.getState().load(0);
    const st = useNeedsSources.getState();
    expect(st.chats?.map((c) => c.chatId)).toEqual(['c1']);
    expect(st.proposals?.map((p) => p.id)).toEqual(['p1']);
    expect(st.readAt.chats).toBeTypeOf('number');
    await useNeedsSources.getState().load(HOME_FRESH_MS);
    expect(listChats).toHaveBeenCalledTimes(2);
  });

  it('a never-answered wire stays null, and loadRepos resolves [] rather than throwing', async () => {
    listRepos.mockRejectedValue(new Error('down'));
    await expect(useNeedsSources.getState().loadRepos()).resolves.toEqual([]);
    expect(useNeedsSources.getState().repos).toBeNull();
  });

  it('deposits are store writes of already-read data: fresh, and zero requests', async () => {
    useNeedsSources.getState().depositProposals([]);
    useNeedsSources.getState().depositChats([]);
    useNeedsSources.getState().depositRepos([]);
    await useNeedsSources.getState().load(HOME_FRESH_MS);
    expect(listProposals).not.toHaveBeenCalled();
    expect(listChats).not.toHaveBeenCalled();
    expect(listRepos).not.toHaveBeenCalled();
    expect(listCampaigns).toHaveBeenCalledTimes(1);
    expect(useNeedsSources.getState().proposals).toEqual([]);
  });
});
