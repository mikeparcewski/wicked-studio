import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../src/api/errors.js';

/**
 * studio#157 — the Product view: one project's requirements across its repositories (crew#371's
 * fold), chosen requirements drafted into epics by crew's governed compose run (crew#372), which
 * then opens in its session. An unread repo is named with crew's reason; an older daemon says so.
 */

const apiFetch = vi.fn();
vi.mock('../src/api/client.js', () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a), apiBase: () => '/api/v1', api: { listProjects: () => Promise.resolve({ projects: [] }) } }));

const { ProductPage, COMPOSE_MAX } = await import('../src/components/product/ProductPage.js');
const { useProjectsStore } = await import('../src/store/projects.js');

const NOW = 1;
const project = (id: string, name: string, status = 'active') => ({ id, name, description: null, status, scope: `project:${id}`, created_at: NOW, updated_at: NOW });
const req = (n: number, extra: Record<string, unknown> = {}) => ({ key: `k${n}`, domain: 'billing', reqId: `REQ-${n}`, title: `Requirement ${n}`, category: 'functional', statement: 's', status: 'draft', risk: false, riskSource: null, edited: false, ...extra });
const totals = { repos: 2, ok: 1, absent: 1, errors: 0, dangling: 0 };
function page(items: unknown[], over: Record<string, unknown> = {}) {
  return {
    projectId: 'shop', offset: 0, limit: 50,
    totals: { ...totals, total: items.length, corpus: items.length },
    rows: [
      { repo: { id: 'r-api', name: 'shop-api' }, state: 'ok', total: items.length, corpus: items.length, orphanedOverrides: 0, items },
      { repo: { id: 'r-web', name: 'shop-web' }, state: 'absent', reason: 'no requirements artifact yet', total: 0, corpus: 0, orphanedOverrides: 0, items: [] },
    ],
    ...over,
  };
}

function wire(handler: (path: string, init?: { method?: string; body?: string }) => unknown): void {
  apiFetch.mockImplementation((path: string, init?: { method?: string; body?: string }) => Promise.resolve().then(() => handler(path, init)));
}

beforeEach(() => {
  apiFetch.mockReset();
  useProjectsStore.setState({ projects: [project('default', 'Unfiled'), project('shop', 'Shop'), project('old', 'Old', 'archived')] as never, loading: false });
});
afterEach(cleanup);

describe('the Product view (studio#157)', () => {
  it('no project chosen: the picker lists live projects (no Unfiled, no archived) and choosing one writes ?project=', async () => {
    const navigate = vi.fn();
    render(<ProductPage navigate={navigate} search="" />);
    expect(screen.getByTestId('product-no-project')).toHaveTextContent('Choose the project');
    const picker = screen.getByTestId('product-project') as HTMLSelectElement;
    expect([...picker.options].map((o) => o.value)).toEqual(['', 'shop']);
    fireEvent.change(picker, { target: { value: 'shop' } });
    expect(navigate).toHaveBeenCalledWith('/product?project=shop', { replace: true });
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('lists the requirements per repo, names the unread repo with crew\'s reason, and links to the project page', async () => {
    wire(() => page([req(1, { risk: true }), req(2)]));
    const navigate = vi.fn();
    render(<ProductPage navigate={navigate} search="?project=shop" />);
    expect(await screen.findByTestId('product-totals')).toHaveTextContent('1–2 of 2 requirements · 1 of 2 repositories read');
    expect(apiFetch).toHaveBeenCalledWith('/projects/shop/requirements?limit=50');
    const repo = screen.getByTestId('product-repo');
    expect(within(repo).getAllByTestId('product-requirement').map((r) => r.textContent)).toEqual(['REQ-1Requirement 1billing · risk', 'REQ-2Requirement 2billing']);
    expect(screen.getByTestId('product-repo-unread')).toHaveTextContent('shop-web — not generated yet — no requirements artifact yet');
    await userEvent.click(screen.getByTestId('product-project-link'));
    expect(navigate).toHaveBeenCalledWith('/projects/shop');
  });

  it('Draft epics sends the chosen refs and the steer, then opens the run\'s session', async () => {
    wire((path, init) => (init?.method === 'POST' ? { runId: 'run-77', requirements: 2 } : page([req(1), req(2), req(3)])));
    const navigate = vi.fn();
    render(<ProductPage navigate={navigate} search="?project=shop" />);
    await screen.findByTestId('product-repo');
    expect(screen.getByTestId('product-draft')).toBeDisabled();
    const picks = screen.getAllByTestId('product-requirement-pick');
    await userEvent.click(picks[0]!);
    await userEvent.click(picks[2]!);
    expect(screen.getByTestId('product-chosen')).toHaveTextContent('2 requirements chosen: Requirement 1 · Requirement 3');
    await userEvent.type(screen.getByTestId('product-instructions'), 'one epic per domain');
    await userEvent.click(screen.getByTestId('product-draft'));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/s/run%3Arun-77'));
    const post = apiFetch.mock.calls.find(([, init]) => (init as { method?: string } | undefined)?.method === 'POST')!;
    expect(post[0]).toBe('/projects/shop/product/compose');
    expect(JSON.parse((post[1] as { body: string }).body)).toEqual({
      requirements: [{ repoId: 'r-api', key: 'k1' }, { repoId: 'r-api', key: 'k3' }], instructions: 'one epic per domain',
    });
  });

  it('a refused draft keeps the choice and says crew\'s words; nothing navigates', async () => {
    wire((path, init) => { if (init?.method === 'POST') throw new ApiError(400, 'requirement r-api/k1 is not in the project'); return page([req(1)]); });
    const navigate = vi.fn();
    render(<ProductPage navigate={navigate} search="?project=shop" />);
    await screen.findByTestId('product-repo');
    await userEvent.click(screen.getAllByTestId('product-requirement-pick')[0]!);
    await userEvent.click(screen.getByTestId('product-draft'));
    expect(await screen.findByTestId('product-compose-error')).toHaveTextContent('requirement r-api/k1 is not in the project');
    expect(screen.getByTestId('product-draft')).toBeEnabled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('a draft answered after the project changed launches but does not pull the operator away (codex on #157)', async () => {
    let answer: (v: unknown) => void = () => undefined;
    wire((path, init) => (init?.method === 'POST' ? new Promise((r) => { answer = r; }) : page([req(1)])));
    const navigate = vi.fn();
    const { rerender } = render(<ProductPage navigate={navigate} search="?project=shop" />);
    await screen.findByTestId('product-repo');
    await userEvent.click(screen.getAllByTestId('product-requirement-pick')[0]!);
    await userEvent.click(screen.getByTestId('product-draft'));
    expect(screen.getByTestId('product-draft')).toHaveTextContent('Starting the draft…');
    rerender(<ProductPage navigate={navigate} search="?project=other" />);
    answer({ runId: 'late', requirements: 1 });
    await new Promise((r) => setTimeout(r, 0));
    expect(navigate).not.toHaveBeenCalled();
  });

  it('a window past a shrunk corpus keeps Previous (codex on #157)', async () => {
    wire((path) => (path.includes('offset=50')
      ? page([], { offset: 50, totals: { ...totals, total: 40, corpus: 40 } })
      : page([req(1)], { totals: { ...totals, total: 60, corpus: 60 } })));
    render(<ProductPage navigate={vi.fn()} search="?project=shop" />);
    await screen.findByTestId('product-repo');
    await userEvent.click(screen.getByTestId('product-next'));
    await waitFor(() => expect(screen.getByTestId('product-totals')).toHaveTextContent('Past the last of 40 requirements — the list shrank; go back a page'));
    expect(screen.getByTestId('product-prev')).toBeEnabled();
    expect(screen.getByTestId('product-next')).toBeDisabled();
    expect(screen.getByTestId('product-status')).toHaveAttribute('role', 'status');
    expect(screen.getByTestId('product-status')).toHaveTextContent('Past the last of 40 requirements — the list shrank; go back a page · 1 of 2 repositories read');
  });

  it(`at most ${COMPOSE_MAX} can be chosen; the rest are disabled`, async () => {
    wire(() => page(Array.from({ length: COMPOSE_MAX + 2 }, (_, i) => req(i))));
    render(<ProductPage navigate={vi.fn()} search="?project=shop" />);
    await screen.findByTestId('product-repo');
    const picks = screen.getAllByTestId('product-requirement-pick') as HTMLInputElement[];
    for (const p of picks.slice(0, COMPOSE_MAX)) fireEvent.click(p);
    expect(screen.getByTestId('product-chosen')).toHaveTextContent(`${COMPOSE_MAX} requirements chosen — the most one draft takes`);
    expect(picks[COMPOSE_MAX]).toBeDisabled();
    expect(picks[0]).toBeEnabled();
  });

  it('search and paging read crew\'s window; the choice survives a page turn', async () => {
    wire((path) => (path.includes('offset=50') ? page([req(51)], { offset: 50, totals: { ...totals, total: 60, corpus: 60 } }) : page([req(1)], { totals: { ...totals, total: 60, corpus: 60 } })));
    render(<ProductPage navigate={vi.fn()} search="?project=shop" />);
    await screen.findByTestId('product-repo');
    await userEvent.click(screen.getAllByTestId('product-requirement-pick')[0]!);
    await userEvent.click(screen.getByTestId('product-next'));
    expect(await screen.findByText('Requirement 51')).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledWith('/projects/shop/requirements?offset=50&limit=50');
    expect(screen.getByTestId('product-chosen')).toHaveTextContent('1 requirement chosen: Requirement 1');
    await userEvent.type(screen.getByTestId('product-search'), 'refund{Enter}');
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/projects/shop/requirements?q=refund&limit=50'));
  });

  it('an older daemon (route absent) says the Product view needs a newer crew; a refusal says why', async () => {
    apiFetch.mockRejectedValueOnce(new ApiError(404, 'Not Found'));
    render(<ProductPage navigate={vi.fn()} search="?project=shop" />);
    expect(await screen.findByTestId('product-absent')).toHaveTextContent('Upgrade wicked-crew');
    cleanup();
    apiFetch.mockRejectedValueOnce(new ApiError(404, 'project shop not found'));
    render(<ProductPage navigate={vi.fn()} search="?project=shop" />);
    expect(await screen.findByTestId('product-error')).toHaveTextContent('project shop not found');
  });
});

describe('the /product address', () => {
  it('parses /product (any ?project=) to the Product panel; a deeper path is a dead address', async () => {
    const { parseRoute, productPath } = await import('../src/hooks/useRoute.js');
    expect(parseRoute('/product').panel).toBe('product');
    expect(parseRoute('/product?project=shop').panel).toBe('product');
    expect(parseRoute('/product/shop').panel).toBe('not-found');
    expect(productPath('a b')).toBe('/product?project=a%20b');
    expect(productPath(null)).toBe('/product');
  });
});
