import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * DES-KNOWLEDGE-DATA-001 §10, §19 B4 in studio: data-shape proposals in the one review (kind `knowledge`), Understand's
 * Knowledge view (the review on top, crew's map below, drawn and listed in words) and the source sheet's Profile box.
 *
 * NEGATIVE CONTROL (studio's half): the view draws ONLY what crew's map answers. A shape still pending, or declined, is
 * in the review queue (or gone from it) but never in the map, so it is never drawn or listed as a connection, even
 * when its payload names joins (crew's half, the map's own read, is crew's knowledge-shapes-estate-live test).
 */

const apiFetch = vi.fn();
vi.mock('../src/api/client.js', () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }));
// The canvas is cytoscape's (it has its own tests in the graph modal); here it shows what it was handed.
vi.mock('../src/components/desk/KnowledgeGraph.js', () => ({
  KnowledgeGraph: ({ nodes, edges }: { nodes: Array<{ key: string; label: string }>; edges: Array<{ rel: string }> }) => (
    <div data-testid="knowledge-graph-stub" data-nodes={nodes.map((n) => n.label).join('|')} data-rels={edges.map((e) => e.rel).join('|')} />
  ),
}));

const { KnowledgeView, edgeWords } = await import('../src/components/desk/KnowledgeView.js');
const { ProfileBox, profileRefusal } = await import('../src/components/sources/ProfileBox.js');
const { readKnowledgeMap, knowledgePayload, KNOWLEDGE_VIEW_PATH } = await import('../src/api/knowledgeShapes.js');
const { proposalKind } = await import('../src/api/proposals.js');
const { ApiError } = await import('../src/api/errors.js');
type Proposal = import('../src/api/proposals.js').Proposal;

const SID = '3f0c9a1e-0000-4000-8000-00000000b4a1';
const T = `knowledge:kdoc synthetic source:${SID}/support.tickets:`;
const R = `knowledge:kdoc synthetic source:${SID}/support.regions:`;
const A = `knowledge:kdoc synthetic source:${SID}/support.assignments:`;
const SHAPE_OK = 'knowledge:kconcept synthetic proposal:p-ok:';
const CODE = 'estate:scip-typescript npm escalations 1.0 src/`ticket.ts`/Ticket#';

function shapeProposal(id: string, relation: string, joinsTo: string, state: Proposal['state'] = 'pending'): Proposal {
  return {
    id,
    kind_type: 'knowledge',
    payload: {
      content: `${relation} in data source support-pg: 100-9,999 rows. It joins ${joinsTo}.`,
      class: 'concept',
      scope: `source:${SID}`,
      capture: 'profile',
      relate: [{ rel: 'derived_from', to: 'x' }],
      relate_code: [],
      shape: { format: 1, sourceId: SID, source: 'support-pg', relation, profile: { key: relation, rows: '100-9,999', columns: [], error: null }, joins: [{ from: relation, columns: ['ticket_id'], to: joinsTo, references: ['id'], basis: 'name_type', overlap: 'all' }], describes: [] },
    },
    facets: {},
    provenance: {},
    state,
    created_at: 1_700_000_000,
  };
}

/** The map crew answers: one approved shape (tickets joins regions, describes Ticket). */
const MAP = {
  nodes: [
    { key: `source:${SID}`, kind: 'source', label: 'support-pg' },
    { key: T, kind: 'table', label: 'support.tickets', source: 'support-pg' },
    { key: R, kind: 'table', label: 'support.regions', source: 'support-pg' },
    { key: A, kind: 'table', label: 'support.assignments', source: 'support-pg' },
    { key: SHAPE_OK, kind: 'shape', label: 'support.tickets shape', proposalId: 'p-ok', summary: 'support.tickets in data source support-pg …' },
    { key: 'repo:escalations', kind: 'repo', label: 'escalations' },
    { key: CODE, kind: 'code', label: 'Ticket', repo: 'escalations' },
    { key: 'bad', kind: 'nonsense', label: 'dropped' },
  ],
  edges: [
    { rel: 'contains', from: `source:${SID}`, to: T, confidence: null, evidence: null, owner: null },
    { rel: 'derived_from', from: SHAPE_OK, to: T, confidence: 1, evidence: null, owner: 'kconcept synthetic proposal:p-ok:' },
    { rel: 'joins', from: T, to: R, confidence: 0.95, evidence: { basis: 'fk', on: [{ columns: ['region_id'], references: ['id'], basis: 'fk', overlap: 'all' }] }, owner: 'kconcept synthetic proposal:p-ok:' },
    { rel: 'describes', from: T, to: CODE, confidence: 0.6, evidence: { basis: 'name' }, owner: 'kconcept synthetic proposal:p-ok:' },
    { rel: 'joins', from: T, to: 'knowledge:nowhere', confidence: 1, evidence: null, owner: null },
  ],
  sources: [{ id: SID, name: 'support-pg', described: true, inKnowledge: true, tables: 3 }],
  shapes: 1,
  skipped: 0,
  truncated: false,
  notes: [],
};

let queue: Proposal[] = [];
const calls: string[] = [];
beforeEach(() => {
  calls.length = 0;
  queue = [shapeProposal('p-pend', 'support.assignments', 'support.tickets'), { ...shapeProposal('p-mem', 'x', 'y'), kind_type: 'memory', payload: { content: 'a memory' } }];
  apiFetch.mockReset();
  apiFetch.mockImplementation((path: unknown, init?: { method?: string }) => {
    const s = String(path);
    calls.push(`${init?.method ?? 'GET'} ${s}`);
    if (s === '/knowledge/map') return Promise.resolve(structuredClone(MAP));
    if (s.endsWith('/approve') || s.endsWith('/reject')) {
      const id = s.split('/')[2];
      queue = queue.filter((p) => p.id !== id);
      return Promise.resolve(s.endsWith('/approve') ? { outcome: 'promoted', active_id: `kconcept synthetic proposal:${id}:` } : { ok: true });
    }
    if (s.startsWith('/proposals')) return Promise.resolve({ proposals: queue });
    if (s.endsWith('/profile')) return Promise.resolve(PROFILE);
    return Promise.reject(new Error(`unexpected ${s}`));
  });
});
afterEach(() => cleanup());

describe('the wire, read defensively', () => {
  it('keeps only well-formed nodes and edges whose both ends are kept', () => {
    const m = readKnowledgeMap(MAP);
    expect(m.nodes.map((n) => n.kind)).toEqual(['source', 'table', 'table', 'table', 'shape', 'repo', 'code']);
    expect(m.edges.map((e) => e.rel)).toEqual(['contains', 'derived_from', 'joins', 'describes']);
    expect(readKnowledgeMap(null)).toEqual({ nodes: [], edges: [], sources: [], shapes: 0, skipped: 0, truncated: false, notes: [] });
  });

  it('folds kind_type knowledge to its own kind, and says a shape\'s links in words', () => {
    const p = shapeProposal('p1', 'support.assignments', 'support.tickets');
    expect(proposalKind(p)).toBe('knowledge');
    expect(knowledgePayload(p)).toMatchObject({ relation: 'support.assignments', source: 'support-pg', links: [{ rel: 'joins', text: 'joins support.tickets on ticket_id = id (matching name and type; every value matches)' }] });
  });

  it('says an edge in words, with its evidence', () => {
    const m = readKnowledgeMap(MAP);
    const byKey = new Map(m.nodes.map((n) => [n.key, n]));
    expect(edgeWords(m.edges[2]!, byKey)).toBe('support.tickets joins support.regions on region_id = id (a foreign key)');
    expect(edgeWords(m.edges[3]!, byKey)).toBe('support.tickets describes Ticket in escalations (named alike)');
    const two = { ...m.edges[2]!, evidence: { basis: 'fk', on: [{ columns: ['reporter_id'], references: ['id'] }, { columns: ['assignee_id'], references: ['id'], cut: true }], more: 2 } };
    expect(edgeWords(two, byKey)).toBe('support.tickets joins support.regions on reporter_id = id; assignee_id = id…, and 2 more (a foreign key)');
  });
});

describe('Understand → Knowledge', () => {
  it('reviews the pending data shapes (only kind knowledge) above the map of what is approved', async () => {
    render(<KnowledgeView />);
    const review = await screen.findByTestId('proposals-section');
    expect(review.getAttribute('data-kind')).toBe('knowledge');
    const cards = await within(review).findAllByTestId('proposal-card');
    expect(cards.map((c) => c.getAttribute('data-proposal-id'))).toEqual(['p-pend']);
    expect(within(cards[0]!).getByTestId('proposal-kind-chip').textContent).toBe('Data shape');
    expect(within(cards[0]!).getByTestId('proposal-knowledge-subject').textContent).toContain('support.assignments');
    expect(within(cards[0]!).getByTestId('proposal-knowledge-links').textContent).toContain('joins support.tickets on ticket_id = id');
    expect(within(cards[0]!).getByTestId('proposal-knowledge-effect').textContent).toContain('Knowledge map');
    expect(within(cards[0]!).getByTestId('proposal-provenance').textContent).toContain('crew’s profiler, when you profiled the source');
    const connections = await screen.findAllByTestId('knowledge-connection');
    expect(connections.map((c) => c.textContent)).toEqual([
      'support.tickets joins support.regions on region_id = id (a foreign key)',
      'support.tickets describes Ticket in escalations (named alike)',
    ]);
    expect(screen.getByTestId('knowledge-map-summary').textContent).toBe('1 data source · 3 tables · 1 approved shape · 2 connections');
  });

  it('NEGATIVE CONTROL: a pending or declined shape is never drawn; approving reads the map again', async () => {
    const user = userEvent.setup();
    render(<KnowledgeView />);
    const stub = await screen.findByTestId('knowledge-graph-stub');
    // p-pend (pending) names support.assignments -> support.tickets: the map has no such edge, so nothing shows it.
    const drawn = () => [...screen.getAllByTestId('knowledge-connection').map((c) => c.textContent ?? ''), stub.getAttribute('data-nodes') ?? ''].join('\n');
    expect(drawn()).not.toContain('support.assignments joins');
    expect(stub.getAttribute('data-nodes')).not.toContain('support.assignments shape');
    // Decline it: it leaves the review, and still nothing draws it.
    await user.click(within(await screen.findByTestId('proposal-card')).getByTestId('proposal-reject'));
    await waitFor(() => expect(screen.queryByTestId('proposal-card')).toBeNull());
    expect(drawn()).not.toContain('support.assignments joins');
    expect(calls).toContain('POST /proposals/p-pend/reject');
    // A decision reads the map again (an approved shape appears once crew answers it).
    await waitFor(() => expect(calls.filter((c) => c === 'GET /knowledge/map')).toHaveLength(2));
  });

  it('says what to do when there is nothing to map, and a failed read with a retry', async () => {
    apiFetch.mockImplementation((path: unknown) => (String(path) === '/knowledge/map' ? Promise.resolve({ nodes: [], edges: [], sources: [], shapes: 0, skipped: 0, truncated: false, notes: [] }) : Promise.resolve({ proposals: [] })));
    render(<KnowledgeView />);
    expect((await screen.findByTestId('knowledge-map-empty')).textContent).toContain('profile it on its sheet');
    cleanup();
    apiFetch.mockImplementation((path: unknown) => (String(path) === '/knowledge/map' ? Promise.reject(new ApiError(502, 'estate could not be read')) : Promise.resolve({ proposals: [] })));
    render(<KnowledgeView />);
    expect(await screen.findByTestId('knowledge-map-error')).toBeTruthy();
  });
});

const PROFILE = {
  name: 'support-pg',
  sourceId: SID,
  profiledAt: '2026-11-04T10:00:00Z',
  relations: [
    { key: 'support.tickets', rows: '100-9,999', error: null, columns: [{ name: 'id', type: 'integer', nullPct: 0, hasNulls: false, cardinality: 'unique', keyCandidate: true }] },
    { key: 'support.audit_log', rows: null, error: 'timeout', columns: [] },
  ],
  joins: [{ from: 'support.tickets', columns: ['region_id'], to: 'support.regions', references: ['id'], basis: 'fk', overlap: 'all' }],
  describes: [],
  proposed: [{ id: 'p1', relation: 'support.tickets' }, { id: 'p2', relation: 'support.audit_log' }],
  alreadyProposed: 0,
  codeSearch: { searched: [], notSearched: [] },
};

describe('the source sheet\'s Profile box', () => {
  it('profiles on a click, says what it found in bands, and links to the review', async () => {
    const user = userEvent.setup();
    render(<ProfileBox source="support-pg" />);
    await user.click(screen.getByTestId('source-profile-run'));
    const out = await screen.findByTestId('source-profile-result');
    expect(calls).toEqual(['POST /sources/support-pg/profile']);
    expect(out.textContent).toContain('Profiled 2 tables, found 1 join. 2 data shapes are waiting for your review.');
    expect(within(out).getByTestId('source-profile-rows').textContent).toBe('support.tickets: 100-9,999 rows · key id · joins support.regionssupport.audit_log: not read (timeout)');
    expect(within(out).getByTestId('source-profile-review').getAttribute('href')).toBe(KNOWLEDGE_VIEW_PATH);
    expect(screen.getByTestId('source-profile-run').textContent).toBe('Profile again');
  });

  it('says why a profile did not run', () => {
    expect(profileRefusal(new ApiError(409, 'x', { code: 'not_in_knowledge', error: 'x' }))).toContain('Test its connection again');
    expect(profileRefusal(new ApiError(404, 'Not Found'))).toContain('does not profile sources yet');
    expect(profileRefusal(new ApiError(403, 'x', { code: 'profile_human_only' }))).toContain('operator');
  });
});
