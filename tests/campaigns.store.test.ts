import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CoreEvent } from '../src/api/types.js';

/**
 * The campaign store (TH-14): the §1.5 support probe's three states and the Campaign* frame
 * fold — written against core-ts's serialized shapes (camelCase tagged JSON, `event_to_json`:
 * campaignLaunched / campaignNode{Ready,Started,AwaitingHuman,Completed,Failed,Blocked} /
 * campaign{Paused,Completed,Failed,Cancelled}), the wire TH-9's daemon passthrough relays
 * verbatim. Frames are MOCKED here — the fold must be demo-able with no daemon at all.
 */

const listCampaigns = vi.fn();

vi.mock('../src/api/campaigns.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/api/campaigns.js')>()),
  listCampaigns: () => listCampaigns() as Promise<unknown>,
}));

const { useCampaignsStore } = await import('../src/store/campaigns.js');
const { ApiError } = await import('../src/api/errors.js');

const frame = (type: string, fields: Record<string, unknown> = {}): CoreEvent =>
  ({ type, ...fields }) as CoreEvent;

beforeEach(() => {
  listCampaigns.mockReset();
  useCampaignsStore.setState({ support: 'unknown', campaigns: [], groups: [], live: {} });
});
afterEach(() => vi.restoreAllMocks());

describe('the §1.5 support probe — three states, never a boolean', () => {
  it('starts unknown ("not probed yet" must never render as "not supported")', () => {
    expect(useCampaignsStore.getState().support).toBe('unknown');
  });

  it('200 with empty lists is SUPPORTED — the "no campaigns yet" answer, never a 404', async () => {
    listCampaigns.mockResolvedValue({ campaigns: [], groups: [] });
    await useCampaignsStore.getState().refresh();
    expect(useCampaignsStore.getState().support).toBe('supported');
    expect(useCampaignsStore.getState().campaigns).toEqual([]);
    expect(useCampaignsStore.getState().groups).toEqual([]);
  });

  it('404 = this daemon predates campaigns → unsupported', async () => {
    listCampaigns.mockRejectedValue(new ApiError(404, 'Not Found'));
    await useCampaignsStore.getState().refresh();
    expect(useCampaignsStore.getState().support).toBe('unsupported');
  });
});

describe('the Campaign* frame fold', () => {
  const ingest = (e: CoreEvent): void => useCampaignsStore.getState().ingest(e);

  it('node frames build the ladder in first-seen order, newest status per node winning', () => {
    ingest(frame('campaignNodeReady', { campaign: 'C1', node: 'n-api' }));
    ingest(frame('campaignNodeReady', { campaign: 'C1', node: 'n-ui' }));
    ingest(frame('campaignNodeStarted', { campaign: 'C1', node: 'n-api', runId: 'run-1' }));
    ingest(frame('campaignNodeCompleted', { campaign: 'C1', node: 'n-api' }));

    const live = useCampaignsStore.getState().live['C1']!;
    expect(live.nodeOrder).toEqual(['n-api', 'n-ui']);
    expect(live.nodes['n-api']).toEqual({ status: 'completed', runId: 'run-1', prompt: null });
    expect(live.nodes['n-ui']).toEqual({ status: 'ready', runId: null, prompt: null });
  });

  it('the runId a started frame carried SURVIVES later frames for the node (the ladder join key)', () => {
    ingest(frame('campaignNodeStarted', { campaign: 'C1', node: 'n1', runId: 'run-9' }));
    ingest(frame('campaignNodeFailed', { campaign: 'C1', node: 'n1' }));
    expect(useCampaignsStore.getState().live['C1']!.nodes['n1']!.runId).toBe('run-9');
  });

  it('awaitingHuman carries the prompt; a later status clears it', () => {
    ingest(frame('campaignNodeAwaitingHuman', { campaign: 'C1', node: 'n1', runId: 'r', prompt: 'approve AC-3?' }));
    expect(useCampaignsStore.getState().live['C1']!.nodes['n1']!.prompt).toBe('approve AC-3?');
    ingest(frame('campaignNodeCompleted', { campaign: 'C1', node: 'n1' }));
    expect(useCampaignsStore.getState().live['C1']!.nodes['n1']!.prompt).toBeNull();
  });

  it('campaign-level frames set the campaign status; blocked is a node fact, not a campaign one', () => {
    ingest(frame('campaignNodeBlocked', { campaign: 'C1', node: 'n1' }));
    expect(useCampaignsStore.getState().live['C1']!.status).toBeNull();
    expect(useCampaignsStore.getState().live['C1']!.nodes['n1']!.status).toBe('blocked');
    for (const [type, want] of [
      ['campaignPaused', 'paused'],
      ['campaignCompleted', 'completed'],
      ['campaignFailed', 'failed'],
      ['campaignCancelled', 'cancelled'],
    ] as const) {
      ingest(frame(type, { campaign: 'C1' }));
      expect(useCampaignsStore.getState().live['C1']!.status).toBe(want);
    }
  });

  it('campaignLaunched RESETS the fold — a resumed campaign replays its truth in new frames', () => {
    ingest(frame('campaignNodeStarted', { campaign: 'C1', node: 'n1', runId: 'r1' }));
    ingest(frame('campaignFailed', { campaign: 'C1' }));
    ingest(frame('campaignLaunched', { campaign: 'C1' }));
    expect(useCampaignsStore.getState().live['C1']).toEqual({ status: null, nodes: {}, nodeOrder: [] });
  });

  it('campaigns fold independently; non-campaign frames are a no-op', () => {
    ingest(frame('campaignNodeStarted', { campaign: 'C1', node: 'n1', runId: 'r1' }));
    ingest(frame('campaignNodeStarted', { campaign: 'C2', node: 'n1', runId: 'r2' }));
    ingest(frame('sessionCompleted', { session: 'r1' }));
    ingest(frame('unitOutputDelta', { session: 'r1', chunk: 'x' }));
    const live = useCampaignsStore.getState().live;
    expect(Object.keys(live).sort()).toEqual(['C1', 'C2']);
    expect(live['C1']!.nodes['n1']!.runId).toBe('r1');
    expect(live['C2']!.nodes['n1']!.runId).toBe('r2');
  });
});
