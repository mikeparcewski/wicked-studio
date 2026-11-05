import { describe, expect, it } from 'vitest';
import { readKnowledgeMap } from '../src/api/knowledgeShapes.js';
import { edgeWords, withoutPm } from '../src/components/desk/KnowledgeView.js';

/**
 * DES-PM-001 §3.4 (api-types 0.187.0): the Knowledge map draws `tracker` and `project` nodes and the `tracked_in` links
 * between a tracker and the projects and repos it is tracked in. An older studio reader dropped both kinds, and with them
 * every `tracked_in` edge (an edge needs both ends).
 */
const MAP = {
  nodes: [
    { key: 'source:trk_bill', kind: 'tracker', label: 'BILL · Billing', tracker: { source: 'acme-jira', key: 'BILL' } },
    { key: 'project:proj_billing', kind: 'project', label: 'Billing' },
    { key: 'repo:billing-api', kind: 'repo', label: 'billing-api' },
    { key: 'source:trk_ops', kind: 'tracker', label: 'OPS · Operations', tracker: { source: 'acme-jira' } },
    { key: 'knowledge:issue_ref BILL-142', kind: 'issue', label: 'BILL-142' },
    { key: 'control:run:r1', kind: 'run', label: 'job r1' },
    { key: 'control:pr:billing-api#318', kind: 'pr', label: 'PR #318' },
  ],
  edges: [
    { rel: 'tracked_in', from: 'source:trk_bill', to: 'project:proj_billing', confidence: null, evidence: null, owner: 'doc' },
    { rel: 'tracked_in', from: 'source:trk_ops', to: 'repo:billing-api', confidence: null, evidence: null, owner: 'doc' },
    { rel: 'addresses', from: 'control:run:r1', to: 'knowledge:issue_ref BILL-142', confidence: null, evidence: null, owner: 'doc' },
    { rel: 'closes', from: 'control:pr:billing-api#318', to: 'knowledge:issue_ref BILL-142', confidence: null, evidence: null, owner: 'doc' },
  ],
  sources: [], shapes: 0, skipped: 0, truncated: false, notes: [],
};

describe('the Knowledge map reads trackers and projects', () => {
  it('keeps both kinds, a whole tracker field, and their tracked_in edges', () => {
    const m = readKnowledgeMap(MAP);
    expect(m.nodes.map((n) => n.kind)).toEqual(['tracker', 'project', 'repo', 'tracker', 'issue', 'run', 'pr']);
    expect(m.nodes[0]!.tracker).toEqual({ source: 'acme-jira', key: 'BILL' });
    // A tracker field crew's shape doesn't hold whole is dropped, not half-kept.
    expect(m.nodes[3]!.tracker).toBeUndefined();
    expect(m.edges.map((e) => `${e.from} ${e.rel} ${e.to}`)).toEqual(['source:trk_bill tracked_in project:proj_billing', 'source:trk_ops tracked_in repo:billing-api', 'control:run:r1 addresses knowledge:issue_ref BILL-142', 'control:pr:billing-api#318 closes knowledge:issue_ref BILL-142']);
    const byKey = new Map(m.nodes.map((n) => [n.key, n]));
    expect(edgeWords(m.edges[0]!, byKey)).toBe('BILL · Billing tracked in Billing');
  });
});

describe('NC1: the Knowledge map draws no PM node on a crew without tracker links', () => {
  it('drops trackers, projects and the trail, and every edge that touched them', () => {
    const m = withoutPm(readKnowledgeMap(MAP));
    expect(m.nodes.map((n) => n.kind)).toEqual(['repo']);
    expect(m.edges).toEqual([]);
  });
});
