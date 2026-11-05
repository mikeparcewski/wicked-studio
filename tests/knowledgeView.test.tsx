import { StrictMode } from 'react';
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
  KnowledgeGraph: ({ nodes, edges, onSelect }: { nodes: Array<{ key: string; label: string }>; edges: Array<{ rel: string; from: string; to: string }>; onSelect?: (n: unknown) => void }) => (
    <div data-testid="knowledge-graph-stub" data-nodes={nodes.map((n) => n.label).join('|')} data-rels={edges.map((e) => e.rel).join('|')} data-edges={edges.map((e) => `${e.rel}:${e.from}->${e.to}`).join('|')}>
      {nodes.map((n) => <button key={n.key} type="button" data-testid="graph-stub-node" data-key={n.key} onClick={() => onSelect?.(n)}>{n.label}</button>)}
    </div>
  ),
}));

const { KnowledgeView, edgeWords } = await import('../src/components/desk/KnowledgeView.js');
const { ProfileBox, profileRefusal, profileWords } = await import('../src/components/sources/ProfileBox.js');
const { readKnowledgeMap, readSourceProfile, knowledgePayload, KNOWLEDGE_VIEW_PATH, ProfileWireError } = await import('../src/api/knowledgeShapes.js');
const { ProposalsList } = await import('../src/components/ProposalsList.js');
const { proposalConsequence, proposalConsequenceLine } = await import('../src/board/proposalTriage.js');
const { proposalKind } = await import('../src/api/proposals.js');
const { ApiError } = await import('../src/api/errors.js');
const { useCapabilities } = await import('../src/store/capabilities.js');
type Proposal = import('../src/api/proposals.js').Proposal;

const SID = '3f0c9a1e-0000-4000-8000-00000000b4a1';
const T = `knowledge:kdoc synthetic source:${SID}/support.tickets:`;
const R = `knowledge:kdoc synthetic source:${SID}/support.regions:`;
const A = `knowledge:kdoc synthetic source:${SID}/support.assignments:`;
const SHAPE_OK = 'knowledge:kconcept synthetic proposal:p-ok:';
const SHAPE_A = 'knowledge:kconcept synthetic proposal:p-pend:';
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

  it('with more than one source, a connection says which source each table is in', () => {
    const byKey = new Map([
      ['a', { key: 'a', kind: 'table' as const, label: 'public.customers', source: 'eu-pg' }],
      ['b', { key: 'b', kind: 'table' as const, label: 'public.addresses', source: 'eu-pg' }],
    ]);
    const e = { rel: 'joins', from: 'a', to: 'b', confidence: 1, evidence: null, owner: null };
    expect(edgeWords(e, byKey, true)).toBe('public.customers in eu-pg joins public.addresses in eu-pg');
    expect(edgeWords(e, byKey)).toBe('public.customers joins public.addresses');
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
    // It holds every knowledge proposal (data shapes and agents' notes), so its heading names neither alone.
    expect(within(review).getByRole('heading').textContent).toContain('Knowledge to review');
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

  it('NEGATIVE CONTROL: a pending or declined shape is never drawn (no node, no edge, no line); approved, it is', async () => {
    const user = userEvent.setup();
    render(<KnowledgeView />);
    await screen.findByTestId('knowledge-graph-stub');
    // p-pend (pending) is about support.assignments -> support.tickets: the map has no such shape or edge.
    const drawn = (): string => {
      const stub = screen.getByTestId('knowledge-graph-stub');
      return [...screen.getAllByTestId('knowledge-connection').map((c) => c.textContent ?? ''), stub.getAttribute('data-nodes') ?? '', stub.getAttribute('data-edges') ?? ''].join('\n');
    };
    expect(drawn()).not.toContain('support.assignments joins');
    expect(screen.getByTestId('knowledge-graph-stub').getAttribute('data-edges')).not.toContain(`->${A}`);
    expect(screen.getByTestId('knowledge-graph-stub').getAttribute('data-edges')).not.toContain(`${A}->`);
    expect(drawn()).not.toContain('support.assignments shape');
    // Decline it: it leaves the review, and still nothing draws it.
    await user.click(within(await screen.findByTestId('proposal-card')).getByTestId('proposal-reject'));
    await waitFor(() => expect(screen.queryByTestId('proposal-card')).toBeNull());
    await waitFor(() => expect(calls.filter((c) => c === 'GET /knowledge/map')).toHaveLength(2));
    expect(drawn()).not.toContain('support.assignments joins');
    expect(screen.getByTestId('knowledge-graph-stub').getAttribute('data-edges')).not.toContain(`${A}->`);
    expect(calls).toContain('POST /proposals/p-pend/reject');
  });

  it('approving a shape reads the map again and draws what crew now answers', async () => {
    const user = userEvent.setup();
    let approved = false;
    const after = structuredClone(MAP);
    after.nodes.push({ key: SHAPE_A, kind: 'shape', label: 'support.assignments shape', proposalId: 'p-pend', summary: 's' } as never);
    after.edges.push({ rel: 'joins', from: A, to: T, confidence: 0.75, evidence: { basis: 'name_type', on: [{ columns: ['ticket_id'], references: ['id'], basis: 'name_type' }] }, owner: 'kconcept synthetic proposal:p-pend:' } as never);
    apiFetch.mockImplementation((path: unknown) => {
      const s = String(path);
      if (s === '/knowledge/map') return Promise.resolve(structuredClone(approved ? after : MAP));
      if (s.endsWith('/approve')) {
        approved = true;
        queue = queue.filter((p) => p.id !== 'p-pend');
        return Promise.resolve({ outcome: 'promoted', active_id: 'kconcept synthetic proposal:p-pend:' });
      }
      return Promise.resolve({ proposals: queue });
    });
    render(<KnowledgeView />);
    await user.click(within(await screen.findByTestId('proposal-card')).getByTestId('proposal-approve'));
    await waitFor(() => expect(screen.getByTestId('knowledge-graph-stub').getAttribute('data-edges')).toContain(`joins:${A}->${T}`));
    expect(screen.getAllByTestId('knowledge-connection').map((c) => c.textContent)).toContain('support.assignments joins support.tickets on ticket_id = id (matching name and type)');
  });

  it('only the newest map read is shown; a selection the map no longer holds is cleared', async () => {
    const user = userEvent.setup();
    const pending: Array<(v: unknown) => void> = [];
    apiFetch.mockImplementation((path: unknown) => (String(path) === '/knowledge/map' ? new Promise((r) => pending.push(r)) : Promise.resolve({ proposals: [] })));
    render(<KnowledgeView />);
    await waitFor(() => expect(pending).toHaveLength(1));
    pending[0]!(structuredClone(MAP));
    await user.click((await screen.findAllByTestId('graph-stub-node')).find((b) => b.getAttribute('data-key') === SHAPE_OK)!);
    expect(screen.getByTestId('knowledge-selected').textContent).toContain('support.tickets shape');
    // Two refreshes: the older answers last, and must not win; the newer one no longer holds the shape.
    await user.click(screen.getByTestId('knowledge-map-refresh'));
    await user.click(screen.getByTestId('knowledge-map-refresh'));
    const without = structuredClone(MAP);
    without.nodes = without.nodes.filter((n) => n.key !== SHAPE_OK);
    pending[2]!(without);
    await waitFor(() => expect(screen.queryByTestId('knowledge-selected')).toBeNull());
    pending[1]!(structuredClone(MAP));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByTestId('knowledge-graph-stub').getAttribute('data-nodes')).not.toContain('support.tickets shape');
  });

  it('says what crew noted even when the map is empty, and how many approved shapes it could not draw', async () => {
    apiFetch.mockImplementation((path: unknown) => (String(path) === '/knowledge/map' ? Promise.resolve({ nodes: [], edges: [], sources: [], shapes: 0, skipped: 2, truncated: true, notes: ["pg's tables could not be read from estate just now"] }) : Promise.resolve({ proposals: [] })));
    render(<KnowledgeView />);
    expect((await screen.findByTestId('knowledge-map-note')).textContent).toContain('could not be read');
    expect(screen.getByTestId('knowledge-map-skipped').textContent).toContain('2 approved shapes are not drawn');
  });

  it('holds the whole map as a list: every node the map draws, each selectable from the keyboard', async () => {
    const user = userEvent.setup();
    const odd = structuredClone(MAP);
    odd.nodes.push({ key: 'knowledge:ksection x', kind: 'knowledge', label: 'a section' } as never);
    apiFetch.mockImplementation((path: unknown) => (String(path) === '/knowledge/map' ? Promise.resolve(odd) : Promise.resolve({ proposals: [] })));
    render(<KnowledgeView />);
    const inv = await screen.findByTestId('knowledge-inventory');
    const listed = new Set([
      ...within(inv).getAllByTestId('knowledge-inventory-node').map((x) => x.getAttribute('data-key')),
      ...within(inv).getAllByTestId('knowledge-inventory-group').map((g) => g.textContent),
    ]);
    const keysListed = within(inv).getAllByTestId('knowledge-inventory-node').map((x) => x.getAttribute('data-key'));
    const drawn = readKnowledgeMap(odd).nodes.filter((n) => n.kind !== 'shape' && n.kind !== 'source' && n.kind !== 'repo').map((n) => n.key);
    expect(keysListed.sort()).toEqual([...drawn].sort());
    expect(listed.size).toBeGreaterThan(0);
    expect(within(inv).getAllByTestId('knowledge-inventory-shape')).toHaveLength(1);
    // Selecting from the list shows the node's detail (no pointer on the canvas needed).
    await user.click(within(inv).getByRole('button', { name: 'Ticket' }));
    expect(screen.getByTestId('knowledge-selected').textContent).toContain('In repository escalations');
  });

  it('under Strict Mode too, an older read answering last never replaces the newest', async () => {
    const pending: Array<{ ok: (v: unknown) => void; fail: (e: unknown) => void }> = [];
    apiFetch.mockImplementation((path: unknown) => (String(path) === '/knowledge/map' ? new Promise((ok, fail) => pending.push({ ok, fail })) : Promise.resolve({ proposals: [] })));
    render(<StrictMode><KnowledgeView /></StrictMode>);
    await waitFor(() => expect(pending.length).toBeGreaterThanOrEqual(2));
    const last = pending.length - 1;
    pending[last]!.ok(structuredClone(MAP));
    await screen.findByTestId('knowledge-graph-stub');
    for (let i = 0; i < last; i++) pending[i]!.fail(new Error('old read failed'));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId('knowledge-map-error')).toBeNull();
    expect(screen.getByTestId('knowledge-graph-stub')).toBeTruthy();
  });

  it('a profile field of the wrong type is narrowed, never coerced', () => {
    const p = readSourceProfile({ name: 'pg', relations: [{ key: 's.t', rows: '1-99', columns: [{ name: 'c', cardinality: ['unique'] }, { name: 'd', cardinality: { toString: null } }] }], proposed: [], joins: [{ from: 's.t', to: 's.u', overlap: ['all'] }, { from: 's.t', to: 's.v', overlap: { toString: null } }] });
    expect(p.relations[0]!.columns.map((c) => c.cardinality)).toEqual(['unknown', 'unknown']);
    expect(p.joins.map((j) => j.overlap)).toEqual([null, null]);
  });

  // Journey 2026-11-04 (apps-k5-chat, shot 8-knowledge-before): all 30 cards in Understand's review said "Data shape",
  // though 24 were knowledge notes agents filed about repositories (one a "__PROBE__ test"). Payloads as :7721 held them.
  it('labels each knowledge proposal by what it is: only one that links something is a data shape', () => {
    const note = (id: string, content: string, source: string, rev: string, agent: string): Proposal => ({
      id, kind_type: 'knowledge', payload: { content, class: 'concept', source, source_rev: rev },
      facets: { project: 'wicked-core', repo: 'wicked-core' }, provenance: { run_agent: agent, run_id: 'r-1' }, state: 'pending', created_at: 1_700_000_000,
    });
    const gardenShape: Proposal = {
      id: 'p-garden', kind_type: 'knowledge', facets: {}, provenance: { run_agent: 'claude', run_id: 'r-2' }, state: 'pending', created_at: 1_700_000_000,
      // Only `relate_code` (review r2: each link key on its own makes a shape).
      payload: { content: 'support.tickets: one row per ticket.', source: 'garden:data-shapes/support-pg/support.tickets', class: 'concept', scope: `source:${SID}`, capture: 'shapes', relate_code: [{ rel: 'describes', code_id: 'x', repo: 'escalations' }] },
    };
    const cards = [
      note('p-probe', '__PROBE__ test', 'wicked-core:src/actor.rs', 'probe', 'pi'),
      note('p-note', 'src/actor.rs single-writer model: one thread owns the writable store.', 'wicked-core:src/actor.rs', 'a340826', 'pi'),
      shapeProposal('p-shape', 'support.assignments', 'support.tickets'),
      gardenShape,
    ];
    render(<ProposalsList proposals={cards} loading={false} error={null} decidingIds={new Set()} onApprove={() => undefined} onReject={() => undefined} />);
    const shown = screen.getAllByTestId('proposal-card').map((c) => [c.getAttribute('data-proposal-id'), within(c).getByTestId('proposal-kind-chip').textContent]);
    expect(shown).toEqual([['p-probe', 'Knowledge note'], ['p-note', 'Knowledge note'], ['p-shape', 'Data shape'], ['p-garden', 'Data shape']]);
    // A note is never promised a place on the map; a shape is.
    const effect = (id: string): string => within(screen.getAllByTestId('proposal-card').find((c) => c.getAttribute('data-proposal-id') === id)!).getByTestId('proposal-knowledge-effect').textContent ?? '';
    expect(effect('p-note')).toContain('the Knowledge map does not draw it');
    expect(effect('p-shape')).toContain('Approving adds it to the Knowledge map');
    // The needs-you line says the same.
    expect(proposalConsequenceLine(cards[1]!)).toBe('Adds a knowledge note agents recall; no rule changes');
    expect(proposalConsequenceLine(cards[3]!)).toBe('Adds a data shape to the Knowledge map; no rule changes');
  });

  it('a data shape takes no memory or policy path: its consequence is its own, and it is reviewed in the Knowledge map', () => {
    const k = shapeProposal('p1', 'support.t', 'support.u');
    expect(proposalConsequence(k)).toBe('unknown');
    expect(proposalConsequenceLine(k)).toBe('Adds a data shape to the Knowledge map; no rule changes');
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
    expect(out.textContent).toContain('Profiled 1 table, found 1 join. 2 data shapes are waiting for your review. 1 table could not be read.');
    expect(within(out).getByTestId('source-profile-rows').textContent).toBe('support.tickets: 100-9,999 rows · key id · joins support.regionssupport.audit_log: not read (timeout)');
    expect(within(out).getByTestId('source-profile-review').getAttribute('href')).toBe(KNOWLEDGE_VIEW_PATH);
    expect(screen.getByTestId('source-profile-run').textContent).toBe('Profile again');
  });

  it('reads a profile defensively: a malformed answer is an error the box says, never a crash', async () => {
    expect(() => readSourceProfile({ name: 'support-pg' })).toThrow(ProfileWireError);
    const p = readSourceProfile({ name: 'pg', relations: [{ key: 's.t', rows: 'lots', columns: [{ name: 'c', cardinality: 'weird' }, 7] }, 'x'], proposed: [{ id: 'p1' }, null], joins: [{ from: 's.t' }], alreadyProposed: 'x' });
    expect(p.relations).toEqual([{ key: 's.t', rows: null, error: 'unreadable', columns: [{ name: 'c', type: '', nullPct: null, hasNulls: false, cardinality: 'unknown', keyCandidate: false }] }]);
    expect(p.joins).toEqual([]);
    expect(p.alreadyProposed).toBe(0);
    const user = userEvent.setup();
    apiFetch.mockImplementation(() => Promise.resolve({ name: 'support-pg' }));
    render(<ProfileBox source="support-pg" />);
    await user.click(screen.getByTestId('source-profile-run'));
    expect((await screen.findByTestId('source-profile-error')).textContent).toContain('does not read');
  });

  it('says what a profile did: filed, already queued, unread, left out', () => {
    const base = PROFILE as unknown as import('../src/api/knowledgeShapes.js').SourceProfileResponse;
    expect(profileWords({ ...base, proposed: [], alreadyProposed: 2 })).toContain('2 shapes were already in the review queue, unchanged.');
    const none = profileWords({ ...base, proposed: [], alreadyProposed: 0, notInKnowledge: 3, catalogTruncated: true });
    expect(none).toContain('No data shape was filed.');
    expect(none).toContain('3 tables that knowledge holds are not in crew');
    expect(none).toContain('more tables than one profile reads');
    expect(profileWords(base)).toContain('Profiled 1 table, found 1 join. 2 data shapes are waiting for your review. 1 table could not be read.');
  });

  it('never throws on a payload whose fields are not strings', () => {
    const odd = shapeProposal('p9', 'support.x', 'support.y');
    (odd.payload as { shape: { joins: unknown[]; describes: unknown[] } }).shape.joins = [{ to: { toString: null }, columns: [{ toString: null }] }];
    (odd.payload as { shape: { joins: unknown[]; describes: unknown[] } }).shape.describes = [{ name: { toString: null } }];
    expect(() => knowledgePayload(odd)).not.toThrow();
    const m = readKnowledgeMap(MAP);
    const byKey = new Map(m.nodes.map((n) => [n.key, n]));
    expect(() => edgeWords({ ...m.edges[2]!, evidence: { on: [{ columns: [{ toString: null }], references: ['id'] }] } }, byKey)).not.toThrow();
  });

  it('calls a shape crew\'s profiler only when no run or agent filed it', () => {
    const run = { ...shapeProposal('p1', 'support.t', 'support.u'), provenance: { run_id: 'r1', run_agent: 'worker' } };
    const mine = shapeProposal('p2', 'support.t', 'support.u');
    render(<ProposalsList proposals={[run, mine]} loading={false} error={null} decidingIds={new Set()} onApprove={() => undefined} onReject={() => undefined} />);
    const [a, b] = screen.getAllByTestId('proposal-provenance');
    expect(a!.textContent).toContain('worker');
    expect(a!.textContent).not.toContain('profiler');
    expect(b!.textContent).toContain('crew’s profiler');
  });

  it('says why a profile did not run', () => {
    expect(profileRefusal(new ApiError(409, 'x', { code: 'not_in_knowledge', error: 'x' }))).toContain('Test its connection again');
    expect(profileRefusal(new ApiError(404, 'Not Found'))).toContain('does not profile sources yet');
    expect(profileRefusal(new ApiError(403, 'x', { code: 'profile_human_only' }))).toContain('operator');
  });
});

describe('DES-PM-001: trackers and projects on the map', () => {
  const PM_MAP = {
    ...MAP,
    nodes: [...MAP.nodes, { key: 'source:trk_bill', kind: 'tracker', label: 'BILL · Jira', tracker: { source: 'acme-jira', key: 'BILL' } }, { key: 'control:project:proj_b', kind: 'project', label: 'Billing' }],
    edges: [...MAP.edges, { rel: 'tracked_in', from: 'source:trk_bill', to: 'control:project:proj_b', confidence: null, evidence: null, owner: 'd' }],
  };
  afterEach(() => useCapabilities.setState({ trackerLinks: false }));
  const renderWith = async (on: boolean): Promise<void> => {
    useCapabilities.setState({ loaded: true, trackerLinks: on });
    apiFetch.mockImplementation((path: unknown) => {
      const s = String(path);
      if (s === '/knowledge/map') return Promise.resolve(structuredClone(PM_MAP));
      if (s.startsWith('/proposals')) return Promise.resolve({ proposals: [] });
      return Promise.reject(new Error(`unexpected ${s}`));
    });
    render(<KnowledgeView />);
    await screen.findByTestId('knowledge-graph-stub');
  };
  it('with tracker links: drawn, counted and listed in words', async () => {
    await renderWith(true);
    expect(screen.getByTestId('knowledge-graph-stub').dataset.nodes).toContain('BILL · Jira');
    expect(screen.getByTestId('knowledge-map-trackers')).toHaveTextContent('1 tracker in 1 project');
    expect(screen.getAllByTestId('knowledge-connection').map((c) => c.textContent)).toContain('BILL · Jira tracked in Billing');
  });
  it('NC1: without them, none of it is drawn, counted or listed', async () => {
    await renderWith(false);
    expect(screen.getByTestId('knowledge-graph-stub').dataset.nodes).not.toContain('BILL · Jira');
    expect(screen.getByTestId('knowledge-graph-stub').dataset.rels).not.toContain('tracked_in');
    expect(screen.queryByTestId('knowledge-map-trackers')).toBeNull();
    expect(screen.getAllByTestId('knowledge-connection').map((c) => c.textContent)).not.toContain('BILL · Jira tracked in Billing');
  });
});
