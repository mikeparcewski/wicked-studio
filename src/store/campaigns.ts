import { create } from 'zustand';
import { listCampaigns, type Campaign, type RunGroup } from '../api/campaigns.js';
import type { CoreEvent } from '../api/types.js';

/**
 * The campaign store (DES-CAMPAIGN-001 §1.5/§2.4 + TH-14): the support probe, the campaign
 * list, and the LIVE fold of core's Campaign* `/ws` frames.
 *
 * Three states for support, never a boolean, so "not probed yet" cannot render as "not
 * supported" (§1.5): `200` on `GET /campaigns` ⇒ supported (`[]` is the "no campaigns yet"
 * answer); `404` ⇒ this daemon predates campaigns; any other failure ⇒ unsupported, said
 * once, honestly.
 *
 * ── The Campaign* frame fold (TH-9 integration point) ───────────────────────────────────────
 * wicked-core already serializes eleven Campaign* CoreEvents (campaignLaunched,
 * campaignNodeReady|Started|AwaitingHuman|Completed|Failed|Blocked, campaignPaused|
 * Completed|Failed|Cancelled — `crates/wicked-core-ts/src/lib.rs` event_to_json, camelCase
 * tagged JSON); the crew daemon's `/ws` fan-out forwards frames VERBATIM, and studio's
 * `useEventStream` passes unknown variants through by design. TH-9 (extends crew#342) is the
 * lane that makes the daemon EMIT them; this fold is written against core's serialized shape
 * — `{ type, campaign, node?, runId?, prompt? }` — so the scoreboard's node status goes live
 * the moment those frames flow, with no change here. Until then the fold simply never fires
 * and status comes from the run list + detail snapshot.
 *
 * The fold is deliberately NOT a cache of the campaign store's join (§2.4's rule): it holds
 * only what frames carry — per-node live status — and the REST payloads stay the system of
 * record for membership and counts.
 */

export type CampaignSupport = 'unknown' | 'supported' | 'unsupported';

/** A campaign node's live status, exactly as the frame stream last reported it. */
export type CampaignNodeStatus =
  | 'ready'
  | 'started'
  | 'awaiting_human'
  | 'completed'
  | 'failed'
  | 'blocked';

export interface CampaignNodeLive {
  status: CampaignNodeStatus;
  /** The governed run dispatched for this node — carried by started/awaitingHuman frames. */
  runId: string | null;
  /** The pending HITL prompt when status is `awaiting_human`. */
  prompt: string | null;
}

/** A campaign's terminal/paused state off the campaign-level frames; `null` = launched/running. */
export type CampaignLiveStatus = 'paused' | 'completed' | 'failed' | 'cancelled' | null;

export interface CampaignLive {
  status: CampaignLiveStatus;
  /** Node id → live status, in first-seen order (`nodeOrder` preserves the ladder). */
  nodes: Record<string, CampaignNodeLive>;
  nodeOrder: string[];
}

/** The Campaign* frame shapes core-ts serializes (camelCase tagged JSON). */
const NODE_STATUS_BY_TYPE: Record<string, CampaignNodeStatus> = {
  campaignNodeReady: 'ready',
  campaignNodeStarted: 'started',
  campaignNodeAwaitingHuman: 'awaiting_human',
  campaignNodeCompleted: 'completed',
  campaignNodeFailed: 'failed',
  campaignNodeBlocked: 'blocked',
};

const CAMPAIGN_STATUS_BY_TYPE: Record<string, CampaignLiveStatus> = {
  campaignPaused: 'paused',
  campaignCompleted: 'completed',
  campaignFailed: 'failed',
  campaignCancelled: 'cancelled',
};

interface CampaignsStore {
  support: CampaignSupport;
  /** `GET /campaigns` rows, server-ordered. */
  campaigns: Campaign[];
  /** Ad-hoc label groups (api-types 0.19.0) — `[]` on a pre-0.19 daemon (normalized). */
  groups: RunGroup[];
  /** Live frame fold, keyed by campaign id. */
  live: Record<string, CampaignLive>;
  /** Probe + (re)fetch the list. Sets `support` from the answer (§1.5). */
  refresh: () => Promise<void>;
  /** Fold one `/ws` frame; non-campaign frames are a cheap string-prefix miss. */
  ingest: (event: CoreEvent) => void;
}

/** In-flight guard so a burst of refresh calls costs one fetch. */
let inflight: Promise<void> | null = null;

export const useCampaignsStore = create<CampaignsStore>((set) => ({
  support: 'unknown',
  campaigns: [],
  groups: [],
  live: {},

  refresh: () => {
    if (inflight !== null) return inflight;
    inflight = listCampaigns()
      .then(({ campaigns, groups }) => {
        set({ support: 'supported', campaigns, groups });
      })
      .catch(() => {
        // 404/501 = this daemon predates campaigns (§1.5's whole discriminator);
        // anything else (network, 500) also reads as unsupported — said once, not spun on.
        set({ support: 'unsupported', campaigns: [], groups: [] });
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  },

  ingest: (event) => {
    if (!event.type.startsWith('campaign')) return;
    const frame = event as unknown as Record<string, unknown>;
    const campaign = typeof frame['campaign'] === 'string' ? frame['campaign'] : null;
    if (campaign === null) return;

    const nodeStatus = NODE_STATUS_BY_TYPE[event.type];
    const campaignStatus = CAMPAIGN_STATUS_BY_TYPE[event.type];
    const isLaunch = event.type === 'campaignLaunched';
    if (nodeStatus === undefined && campaignStatus === undefined && !isLaunch) return;

    set((s) => {
      const prev: CampaignLive = s.live[campaign] ?? { status: null, nodes: {}, nodeOrder: [] };
      // A (re)launch resets the fold — a resumed campaign replays its truth in new frames.
      if (isLaunch) {
        return { live: { ...s.live, [campaign]: { status: null, nodes: {}, nodeOrder: [] } } };
      }
      if (campaignStatus !== undefined) {
        return { live: { ...s.live, [campaign]: { ...prev, status: campaignStatus } } };
      }
      // Node frame: `node` names the ladder rung; started/awaitingHuman also carry `runId`.
      const node = typeof frame['node'] === 'string' ? frame['node'] : null;
      if (node === null) return s;
      const existing = prev.nodes[node];
      const runId = typeof frame['runId'] === 'string' ? frame['runId'] : (existing?.runId ?? null);
      const prompt =
        nodeStatus === 'awaiting_human' && typeof frame['prompt'] === 'string'
          ? frame['prompt']
          : null;
      return {
        live: {
          ...s.live,
          [campaign]: {
            ...prev,
            nodes: { ...prev.nodes, [node]: { status: nodeStatus!, runId, prompt } },
            nodeOrder: existing !== undefined ? prev.nodeOrder : [...prev.nodeOrder, node],
          },
        },
      };
    });
  },
}));
