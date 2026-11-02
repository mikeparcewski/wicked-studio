/**
 * The domain-graph modal says the REAL-requirements share (domain-real WIRE 2026-11-01), read off the requirements
 * read. The domain graph's own `coverage` counts placeholders as covered (wicked-crew: 0.9953 while 54% are real), so
 * it is never shown.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../src/api/errors.js';

const getRepoGraph = vi.fn();
const getRepoDomainGraph = vi.fn();
const listRequirements = vi.fn();
vi.mock('../src/api/client.js', () => ({ api: { getRepoGraph, getRepoDomainGraph, listRequirements } }));
vi.mock('../src/components/CytoGraph.js', () => ({ CytoGraph: () => null }));

const { RepoGraphModal } = await import('../src/components/RepoGraphModal.js');

const LIVE = { realPct: 54, minPct: 80, behaviorBearing: 5786, real: 3182, placeholders: 2577, unmapped: 27, notProduct: 2380 };
const OLD_DOMAIN_COVERAGE = { total: 49430, behavior_bearing: 5786, resolved: 3182, risk_flagged: 2577, unaccounted: 27, coverage: 0.9953 };
const GRAPH = { domains: { billing: { description: 'billing', entities: {}, requirements: { 'REQ-001': { title: 'Charge a card' } } } } };
const repo = { id: 'wicked-crew', name: 'wicked-crew' } as never;

async function openDomainTab(): Promise<void> {
  render(<RepoGraphModal repo={repo} onClose={() => {}} />);
  // The tab pills remount on every render: click once the code view has settled, not a button from the loading frame.
  await screen.findByText(/Code graph not yet available/);
  fireEvent.click(screen.getByRole('button', { name: 'Domain' }));
}

describe('the domain-graph modal: real requirements, never placeholders as progress', () => {
  beforeEach(() => {
    getRepoGraph.mockReset().mockResolvedValue({ graph: { nodes: [], edges: [], stats: { nodeCount: 0, edgeCount: 0, fileCount: 0 } } });
    listRequirements.mockReset();
    getRepoDomainGraph.mockReset();
  });

  it('above a built graph: the real share and its breakdown, not the domain graph\'s 99.5%', async () => {
    getRepoDomainGraph.mockResolvedValue({ graph: GRAPH, coverage: OLD_DOMAIN_COVERAGE });
    listRequirements.mockResolvedValue({ total: 1, corpus: 1, offset: 0, limit: 1, items: [], coverage: LIVE });
    await openDomainTab();
    const cov = await screen.findByTestId('domain-graph-coverage');
    expect(listRequirements).toHaveBeenCalledWith('wicked-crew', { limit: 1 });
    expect(screen.getByTestId('domain-graph-coverage-headline')).toHaveTextContent('54% real requirements · minimum 80%');
    expect(screen.getByTestId('domain-graph-coverage-breakdown')).toHaveTextContent('3,182 real · 2,577 placeholders (unconfirmed) · 27 unmapped · 2,380 not product code');
    expect(document.body).not.toHaveTextContent(/99\.5|Annotation coverage|resolved/);
    expect(cov.querySelector('[data-part="placeholders"]')).toHaveAttribute('data-unconfirmed', 'true');
  });

  it('no graph yet: the share from crew\'s notGenerated answer, the bar filling the real share only', async () => {
    getRepoDomainGraph.mockResolvedValue({ graph: null, coverage: OLD_DOMAIN_COVERAGE });
    listRequirements.mockRejectedValue(new ApiError(404, 'x', { code: 'notGenerated', workflow: 'domain-extraction', coverage: LIVE }));
    await openDomainTab();
    const cov = await screen.findByTestId('domain-graph-coverage');
    expect(cov.querySelector<HTMLElement>('.wk-reqcov-fill')!.style.width).toBe('54%');
    expect(document.body).not.toHaveTextContent(/99\.5|Annotation coverage/);
  });

  it('an older daemon (no real fields) says nothing rather than a placeholder-inflated share', async () => {
    getRepoDomainGraph.mockResolvedValue({ graph: GRAPH, coverage: OLD_DOMAIN_COVERAGE });
    listRequirements.mockResolvedValue({ total: 1, corpus: 1, offset: 0, limit: 1, items: [],
      coverage: { mappedPct: 99, minPct: 80, behaviorBearing: 5786, mapped: 5759, resolved: 3182, unmapped: 27 } });
    await openDomainTab();
    await screen.findByText(/1 domains/);
    expect(screen.queryByTestId('domain-graph-coverage')).not.toBeInTheDocument();
  });
});
