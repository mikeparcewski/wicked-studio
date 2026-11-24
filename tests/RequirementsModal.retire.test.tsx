import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ApiError } from '../src/api/errors.js';
import { resetLaunchWizard } from '../src/store/launchWizard.js';
import type { RequirementDetail, RequirementsPage } from '../src/api/types.js';

/**
 * studio#1386: Retire on a requirement whose code was deleted. crew flags such a row `uncounted: 'unindexed'` in the
 * list (`RequirementSummary.uncounted`, crew `packages/crew/src/api/requirements.ts:595`) and keeps it across re-maps;
 * `POST /api/v1/repos/:id/requirements/:key/retire` (crew#1858, `packages/crew/src/api/routes.ts:9968`) retires it and
 * answers `{ retired: <key> }`, or 409 `{ error }` with its own sentences (routes.ts:9988-9996), or 404 `{ error }`.
 * A crew before the route answers Fastify's plain 404 `{ message, error: 'Not Found', statusCode }`.
 */
const listRequirements = vi.fn();
const getRequirement = vi.fn();
const patchRequirement = vi.fn();
const retireRequirement = vi.fn();

vi.mock('../src/api/client.js', () => ({
  api: {
    listRuns: () => Promise.resolve({ runs: [] }),
    getRunEvents: () => Promise.resolve({ events: [] }),
    listRequirements: (...a: unknown[]) => listRequirements(...a),
    getRequirement: (...a: unknown[]) => getRequirement(...a),
    patchRequirement: (...a: unknown[]) => patchRequirement(...a),
    retireRequirement: (...a: unknown[]) => retireRequirement(...a),
  },
}));
const { RequirementsModal } = await import('../src/components/RequirementsModal.js');

const base = {
  domain: 'billing', status: 'active', risk: false, category: 'functional' as const, riskSource: null, edited: false,
  corroboration: null, placeholder: false, codeMismatch: null,
};
const gone = { ...base, key: 'billing::REQ-7', reqId: 'REQ-7', title: 'Export invoices as CSV', statement: 'Invoices export as CSV', uncounted: 'unindexed' };
const kept = { ...base, key: 'billing::REQ-1', reqId: 'REQ-1', title: 'Totals include tax', statement: 'Tax applies per line', uncounted: null };

function page(items: unknown[]): RequirementsPage {
  return { total: items.length, corpus: items.length, offset: 0, limit: 50, items, source: 'store' } as unknown as RequirementsPage;
}
function detailOf(r: typeof gone | typeof kept): RequirementDetail {
  return {
    ...r, description: '', notes: '', sourceTitle: r.title, ruleCount: 1, componentCount: 0, validationCount: 0, errorPathCount: 0,
    businessRules: [], legacyComponents: [],
  } as unknown as RequirementDetail;
}

beforeEach(() => {
  resetLaunchWizard();
  listRequirements.mockReset().mockResolvedValue(page([gone, kept]));
  getRequirement.mockReset().mockImplementation((_repo: string, key: string) => Promise.resolve({ requirement: detailOf(key === gone.key ? gone : kept) }));
  patchRequirement.mockReset();
  retireRequirement.mockReset().mockResolvedValue({ retired: gone.key });
});
afterEach(cleanup);

async function openRow(title: string): Promise<void> {
  render(<RequirementsModal repoId="r1" repoName="billing-api" onClose={() => {}} />);
  fireEvent.click(await screen.findByText(title));
  await screen.findByText('Description (source)');
}

describe('Retire a requirement whose code was deleted (studio#1386)', () => {
  it('a row that still counts offers no Retire', async () => {
    await openRow('Totals include tax');
    expect(screen.queryByTestId('requirement-retire')).toBeNull();
  });

  it('a row flagged as no longer in the code offers Retire, which confirms first and sends nothing until then', async () => {
    await openRow('Export invoices as CSV');
    const block = screen.getByTestId('requirement-retire');
    expect(block.textContent).toContain('Its code is no longer in the code index.');
    fireEvent.click(screen.getByTestId('requirement-retire-start'));
    expect(screen.getByTestId('requirement-retire-confirm').textContent).toContain(
      'This requirement’s code was deleted. Retire it? It will no longer be listed, and its id is not reused.');
    expect(retireRequirement).not.toHaveBeenCalled();
    // Keep it backs out without a request.
    fireEvent.click(screen.getByTestId('requirement-retire-cancel'));
    expect(screen.queryByTestId('requirement-retire-confirm')).toBeNull();
    expect(retireRequirement).not.toHaveBeenCalled();
  });

  it('confirming posts the retire for that repository and key, closes the rail and reads the list again', async () => {
    await openRow('Export invoices as CSV');
    const reads = listRequirements.mock.calls.length;
    listRequirements.mockResolvedValue(page([kept]));
    fireEvent.click(screen.getByTestId('requirement-retire-start'));
    fireEvent.click(screen.getByTestId('requirement-retire-go'));
    await waitFor(() => expect(retireRequirement).toHaveBeenCalledWith('r1', 'billing::REQ-7'));
    expect(retireRequirement).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByText('Export invoices as CSV')).toBeNull());
    expect(listRequirements.mock.calls.length).toBeGreaterThan(reads);
    expect(screen.queryByText('Description (source)')).toBeNull();
  });

  it('crew\'s 409 sentence shows as it is, and the rail stays for another try', async () => {
    const said = 'The installed wicked-core cannot retire requirements yet. Update wicked-core, then try again.';
    retireRequirement.mockRejectedValueOnce(new ApiError(409, said, { error: said }));
    await openRow('Export invoices as CSV');
    fireEvent.click(screen.getByTestId('requirement-retire-start'));
    fireEvent.click(screen.getByTestId('requirement-retire-go'));
    expect((await screen.findByTestId('requirement-retire-error')).textContent).toBe(said);
    expect(screen.getByTestId('requirement-retire-start')).toBeEnabled();
  });

  it('a crew without the route says to update, never "not found"', async () => {
    retireRequirement.mockRejectedValueOnce(new ApiError(404, 'Not Found', { message: 'Route POST:/api/v1/repos/r1/requirements/billing%3A%3AREQ-7/retire not found', error: 'Not Found', statusCode: 404 }));
    await openRow('Export invoices as CSV');
    fireEvent.click(screen.getByTestId('requirement-retire-start'));
    fireEvent.click(screen.getByTestId('requirement-retire-go'));
    expect((await screen.findByTestId('requirement-retire-error')).textContent).toBe(
      'This version of Studio’s service can’t retire requirements. Update wicked to get it.');
  });

  it('two presses of Retire send one request', async () => {
    let settle: (v: unknown) => void = () => undefined;
    retireRequirement.mockImplementationOnce(() => new Promise((r) => { settle = r; }));
    await openRow('Export invoices as CSV');
    fireEvent.click(screen.getByTestId('requirement-retire-start'));
    const go = screen.getByTestId('requirement-retire-go');
    fireEvent.click(go);
    fireEvent.click(go);
    expect(retireRequirement).toHaveBeenCalledTimes(1);
    settle({ retired: gone.key });
    await waitFor(() => expect(screen.queryByText('Description (source)')).toBeNull());
  });
});
