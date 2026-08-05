import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CoverageView } from '../src/components/CoverageView.js';
import * as client from '../src/api/client.js';
import type { CoverageReport } from '../src/api/types.js';

const BASE_REPORT: CoverageReport = {
  total: 120,
  behavior_bearing: 80,
  resolved: 60,
  risk_flagged: 5,
  unaccounted: 15,
  coverage: 0.75,
  resolved_rate: 0.75,
  mean_confidence: 0.82,
  resolve_threshold: 0.70,
  per_app: [
    { app: 'wicked-core', behavior_bearing: 50, resolved: 40, risk_flagged: 3, unaccounted: 7, coverage: 0.80 },
  ],
  unaccounted_nodes: [
    { symbol_id: 'sym1', name: 'foo', kind: 'function', file: 'src/foo.rs', app: 'wicked-core' },
    { symbol_id: 'sym2', name: 'bar', kind: 'struct', file: 'src/bar.rs', app: 'wicked-core' },
    { symbol_id: 'sym3', kind: 'trait', file: 'src/baz.rs', app: 'wicked-core' },
  ],
};

describe('CoverageView', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders loading state initially', () => {
    vi.spyOn(client.api, 'getCoverageReport').mockReturnValue(new Promise(() => {}));
    render(<CoverageView />);
    expect(screen.getByRole('button', { name: /loading/i })).toBeDisabled();
  });

  // Renamed and re-asserted for FINDING-009. This used to expect GATE PASS on BASE_REPORT, which
  // has `unaccounted: 15` — it only passed because the badge compared `coverage >= resolve_threshold`
  // (0.75 >= 0.70). The engine gates on `unaccounted == 0`, so this fixture is a FAIL. The old
  // assertion did not merely miss the defect, it pinned it in place.
  it('renders the ledger, and GATE FAIL while nodes are still unaccounted', async () => {
    vi.spyOn(client.api, 'getCoverageReport').mockResolvedValue({ report: BASE_REPORT });
    render(<CoverageView />);
    await waitFor(() => expect(screen.getByText('GATE FAIL')).toBeInTheDocument());
    expect(screen.getAllByText('75.0%').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Total nodes')).toBeInTheDocument();
  });

  it('renders GATE PASS only when nothing is unaccounted', async () => {
    vi.spyOn(client.api, 'getCoverageReport').mockResolvedValue({
      report: { ...BASE_REPORT, resolved: 75, risk_flagged: 5, unaccounted: 0, coverage: 1 },
    });
    render(<CoverageView />);
    await waitFor(() => expect(screen.getByText('GATE PASS')).toBeInTheDocument());
  });

  it('renders GATE FAIL when coverage is below full', async () => {
    vi.spyOn(client.api, 'getCoverageReport').mockResolvedValue({
      report: { ...BASE_REPORT, coverage: 0.50, resolve_threshold: 0.75 },
    });
    render(<CoverageView />);
    await waitFor(() => expect(screen.getByText('GATE FAIL')).toBeInTheDocument());
  });

  it('renders empty state when report is null', async () => {
    vi.spyOn(client.api, 'getCoverageReport').mockResolvedValue({ report: null });
    render(<CoverageView />);
    await waitFor(() => expect(screen.getByText(/no coverage data/i)).toBeInTheDocument());
  });

  it('renders error message when fetch fails', async () => {
    vi.spyOn(client.api, 'getCoverageReport').mockRejectedValue(new Error('fetch failed'));
    render(<CoverageView />);
    await waitFor(() => expect(screen.getByText(/fetch failed/i)).toBeInTheDocument());
  });

  it('renders unaccounted nodes list with search and filter controls', async () => {
    vi.spyOn(client.api, 'getCoverageReport').mockResolvedValue({ report: BASE_REPORT });
    render(<CoverageView />);
    // Keyed off a stable ledger label, not the gate badge: these cases are about the node
    // list and refresh, and coupling them to gate semantics is what made them break when the
    // badge's rule was corrected (FINDING-009).
    await waitFor(() => expect(screen.getByText('Total nodes')).toBeInTheDocument());
    expect(screen.getByRole('textbox', { name: /search/i })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /filter by kind/i })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /filter by app/i })).toBeInTheDocument();
    expect(screen.getByText('foo')).toBeInTheDocument();
    expect(screen.getByText('bar')).toBeInTheDocument();
  });

  it('filters unaccounted nodes by search query', async () => {
    const user = userEvent.setup();
    vi.spyOn(client.api, 'getCoverageReport').mockResolvedValue({ report: BASE_REPORT });
    render(<CoverageView />);
    await waitFor(() => expect(screen.getByText('foo')).toBeInTheDocument());
    await user.type(screen.getByRole('textbox', { name: /search/i }), 'foo');
    expect(screen.queryByText('bar')).not.toBeInTheDocument();
    expect(screen.getByText('foo')).toBeInTheDocument();
  });

  it('sorts by name falling back to symbol_id for unnamed nodes', async () => {
    vi.spyOn(client.api, 'getCoverageReport').mockResolvedValue({ report: BASE_REPORT });
    render(<CoverageView />);
    // Keyed off a stable ledger label, not the gate badge: these cases are about the node
    // list and refresh, and coupling them to gate semantics is what made them break when the
    // badge's rule was corrected (FINDING-009).
    await waitFor(() => expect(screen.getByText('Total nodes')).toBeInTheDocument());
    // sym3 has no name → should display symbol_id
    expect(screen.getByText('sym3')).toBeInTheDocument();
  });

  it('Refresh button reloads data', async () => {
    const user = userEvent.setup();
    const spy = vi.spyOn(client.api, 'getCoverageReport').mockResolvedValue({ report: BASE_REPORT });
    render(<CoverageView />);
    // Keyed off a stable ledger label, not the gate badge: these cases are about the node
    // list and refresh, and coupling them to gate semantics is what made them break when the
    // badge's rule was corrected (FINDING-009).
    await waitFor(() => expect(screen.getByText('Total nodes')).toBeInTheDocument());
    expect(spy).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: /refresh/i }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
  });
});
