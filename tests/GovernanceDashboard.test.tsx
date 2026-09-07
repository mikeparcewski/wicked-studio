import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * The governed-knowledge dashboard (`/steering/dashboard`) — the review-forward Steering home that
 * UN-BURIES the propose→promote queue. Three parts: a KPI band (Needs review = pending memory +
 * policy proposals, the store size, active-rule count + severity), the consolidated REVIEW inbox
 * (both kinds side by side, reusing ProposalsSection), and a BROWSE of the store + rule corpus,
 * each with the facet typeahead.
 */

const apiFetch = vi.fn();
vi.mock('../src/api/client.js', () => ({
  apiFetch: (...a: unknown[]) => apiFetch(...a),
  api: { listConformanceRules: () => apiFetch('/governance/rules') },
}));

const { GovernanceDashboard } = await import('../src/components/GovernanceDashboard.js');
const { ApiError } = await import('../src/api/errors.js');
type Proposal = import('../src/api/proposals.js').Proposal;
type MemoryItem = import('../src/api/memory.js').MemoryItem;
type SteeringRule = import('../src/api/steering.js').SteeringRule;

const MEM_PROP: Proposal = {
  id: 'p-mem', kind_type: 'memory',
  payload: { content: 'Remember the gh account flip', tier: 'session' },
  facets: { project: 'wicked' }, provenance: { run_id: 'run-1' }, state: 'pending', created_at: 1,
};
const POL_PROP: Proposal = {
  id: 'p-pol', kind_type: 'policy:security',
  payload: { rule: 'Never log secrets', severity: 'critical' },
  facets: { project: 'wicked' }, provenance: { run_id: 'run-2' }, state: 'pending', created_at: 2,
};

const MEMS: MemoryItem[] = [
  { id: 'm1', content: 'push 403 on account flip', tier: 'project', scope: 'brain:wicked/doc:ops', facets: { project: 'wicked', domain: 'ops' } },
  { id: 'm2', content: 'codesign after copy', tier: 'global', scope: 'brain:wicked/doc:macos', facets: { project: 'wicked', domain: 'macos' } },
];

const RULES: SteeringRule[] = [
  { id: 'POL-001', rule_type: 'policy', statement: 'No secrets in logs', severity: 'critical', confidence: 0.9, targets: {}, provenance: { source: 'ui', source_kinds: ['doc'] }, steering_type: 'security', applies_to: ['api'] },
  { id: 'PAT-001', rule_type: 'pattern', statement: 'Prefer async handlers', severity: 'warn', confidence: 0.9, targets: { language: 'ts' }, provenance: { source: 'ui', source_kinds: ['doc'] }, steering_type: 'development' },
  { id: 'PAT-002', rule_type: 'pattern', statement: 'Retired rule', severity: 'error', confidence: 0.9, targets: {}, provenance: { source: 'ui', source_kinds: ['doc'] }, steering_type: 'architecture', retired: true },
];

function wire(over: { proposals?: Proposal[]; coverage?: unknown; rules?: SteeringRule[]; memories?: MemoryItem[] } = {}): void {
  const proposals = over.proposals ?? [MEM_PROP, POL_PROP];
  const coverage = over.coverage ?? { total: 42 };
  const rules = over.rules ?? RULES;
  const memories = over.memories ?? MEMS;
  apiFetch.mockImplementation((path: unknown) => {
    const s = String(path);
    if (s.startsWith('/proposals')) return Promise.resolve({ proposals });
    if (s === '/memory/coverage') return Promise.resolve(coverage);
    if (s === '/governance/rules') return Promise.resolve({ rules });
    if (s.startsWith('/memory')) return Promise.resolve({ memories });
    // Any other path (incl. a stray teardown call) resolves benignly — never an unhandled reject.
    return Promise.resolve({});
  });
}

beforeEach(() => apiFetch.mockReset());

describe('GovernanceDashboard — the KPI band (part 1)', () => {
  it('Needs review counts pending memory + policy proposals, split in the context line', async () => {
    wire();
    render(<GovernanceDashboard navigate={vi.fn()} />);
    const tile = await screen.findByTestId('gk-stat-needs-review');
    await waitFor(() => expect(tile).toHaveAttribute('data-value', '2'));
    expect(tile).toHaveTextContent('1 memory · 1 policy');
  });

  it('Memories reads the coverage total; Active rules counts the un-retired rules with a severity split', async () => {
    wire();
    render(<GovernanceDashboard navigate={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('gk-stat-memories')).toHaveAttribute('data-value', '42'));
    const rulesTile = screen.getByTestId('gk-stat-rules');
    // Two active rules (PAT-002 is retired), and the severity breakdown counts them.
    expect(rulesTile).toHaveAttribute('data-value', '2');
    expect(rulesTile).toHaveTextContent('crit 1');
    expect(rulesTile).toHaveTextContent('warn 1');
  });

  it('a daemon that predates the proposal queue shows an honest "—", never a lying zero', async () => {
    apiFetch.mockImplementation((path: unknown) => {
      const s = String(path);
      // The daemon predates the proposal queue — only the proposals wire 404s (folded to
      // "unsupported"); every other read answers, so the rest of the dashboard still renders.
      if (s.startsWith('/proposals')) return Promise.reject(new ApiError(404, 'Not Found'));
      if (s === '/memory/coverage') return Promise.resolve({ total: 5 });
      if (s === '/governance/rules') return Promise.resolve({ rules: [] });
      if (s.startsWith('/memory')) return Promise.resolve({ memories: [] });
      return Promise.resolve({});
    });
    render(<GovernanceDashboard navigate={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('gk-stat-needs-review')).toHaveAttribute('data-value', '—'));
  });
});

describe('GovernanceDashboard — the consolidated review inbox (part 2)', () => {
  it('renders BOTH kinds under one Review heading (memory + policy side by side)', async () => {
    wire();
    render(<GovernanceDashboard navigate={vi.fn()} />);

    // Two reused ProposalsSections — one per kind — inside the one review inbox.
    await waitFor(() => expect(screen.getAllByTestId('proposals-section')).toHaveLength(2));
    const kinds = screen.getAllByTestId('proposals-section').map((s) => s.getAttribute('data-kind'));
    expect(kinds.sort()).toEqual(['memory', 'policy']);

    const inbox = screen.getByTestId('governance-review-inbox');
    const cards = await within(inbox).findAllByTestId('proposal-card');
    expect(cards.map((c) => c.getAttribute('data-proposal-id')).sort()).toEqual(['p-mem', 'p-pol']);
  });
});

describe('GovernanceDashboard — browse (part 3)', () => {
  it('lists the memory store and the rule corpus, each with a facet typeahead', async () => {
    wire();
    render(<GovernanceDashboard navigate={vi.fn()} />);

    const memRows = await within(await screen.findByTestId('gk-browse-memories')).findAllByTestId('gk-memory-row');
    expect(memRows.map((r) => r.getAttribute('data-memory-id'))).toEqual(['m1', 'm2']);
    expect(screen.getByTestId('gk-memories-facet-input')).toBeInTheDocument();

    const ruleRows = within(screen.getByTestId('gk-browse-rules')).getAllByTestId('gk-rule-row');
    // Only the two ACTIVE rules appear (the retired PAT-002 is filtered out).
    expect(ruleRows.map((r) => r.getAttribute('data-rule-id')).sort()).toEqual(['PAT-001', 'POL-001']);
    expect(screen.getByTestId('gk-rules-facet-input')).toBeInTheDocument();
  });

  it('the rules facet typeahead narrows the corpus (severity=warn → the one warn rule)', async () => {
    wire();
    render(<GovernanceDashboard navigate={vi.fn()} />);
    const user = userEvent.setup();

    await within(await screen.findByTestId('gk-browse-rules')).findAllByTestId('gk-rule-row');
    const input = screen.getByTestId('gk-rules-facet-input');
    await user.click(input);
    await user.type(input, 'severity=warn');
    await user.click(screen.getByTestId('gk-rules-facet-option'));

    const rows = within(screen.getByTestId('gk-browse-rules')).getAllByTestId('gk-rule-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveAttribute('data-rule-id', 'PAT-001');
  });
});
