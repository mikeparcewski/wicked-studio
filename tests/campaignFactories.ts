import type {
  AttachedRunView,
  Campaign,
  CampaignNodeDelivery,
  CampaignNodeStatus,
  RunGroup,
} from '../src/api/campaigns.js';
import type { SessionStatus } from '../src/api/types.js';

/**
 * Wire-shape factories for the campaign surface tests — the ENGINE `Campaign` (+ the
 * daemon-joined api-types 0.19.0 fields) and the ad-hoc `RunGroup`, exactly as
 * `GET /campaigns` serves them. One spelling for every suite, so a fixture cannot drift
 * from the contract in one file and silently keep passing in another.
 */

export interface NodeFixture {
  /** node_id; defaults to `n<i>`. */
  id?: string;
  status?: CampaignNodeStatus;
  /** The dispatched run id — absent = the node has not dispatched yet. */
  runId?: string;
  /** The daemon-joined per-node delivery (0.19.0). Setting it on ANY node marks the
   *  campaign as a 0.19 payload (`node_delivery` present). */
  delivery?: CampaignNodeDelivery;
  problem?: string;
}

export function makeCampaign(
  id: string,
  nodes: NodeFixture[],
  over: Partial<Campaign> = {},
): Campaign {
  const node_status: Record<string, CampaignNodeStatus> = {};
  const node_run_id: Record<string, string> = {};
  const node_delivery: Record<string, CampaignNodeDelivery> = {};
  let anyDelivery = false;
  const defNodes = nodes.map((n, i) => {
    const nid = n.id ?? `n${i}`;
    if (n.status !== undefined) node_status[nid] = n.status;
    if (n.runId !== undefined) node_run_id[nid] = n.runId;
    if (n.delivery !== undefined) {
      node_delivery[nid] = n.delivery;
      anyDelivery = true;
    }
    return { node_id: nid, run_spec: { problem: n.problem ?? `problem of ${nid}` } };
  });
  return {
    id,
    def_id: id,
    status: 'running',
    def: { id, name: id, nodes: defNodes },
    node_status,
    node_run_id,
    ...(anyDelivery ? { node_delivery } : {}),
    ...over,
  };
}

export function attachedRun(runId: string, over: Partial<AttachedRunView> = {}): AttachedRunView {
  return { runId, status: 'completed' as SessionStatus, delivery: 'none', ...over };
}

export function makeGroup(label: string, runs: AttachedRunView[]): RunGroup {
  return { label, runs };
}
