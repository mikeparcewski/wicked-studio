import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RequirementsModal } from '../src/components/RequirementsModal.js';
import type { RequirementDetail, RequirementsPage } from '../src/api/types.js';

const listRequirements = vi.fn();
const getRequirement = vi.fn();
const patchRequirement = vi.fn();

vi.mock('../src/api/client.js', () => ({
  api: {
    listRequirements: (...a: unknown[]) => listRequirements(...a),
    getRequirement: (...a: unknown[]) => getRequirement(...a),
    patchRequirement: (...a: unknown[]) => patchRequirement(...a),
  },
}));

function page(items: RequirementsPage['items'], total = items.length): RequirementsPage {
  return { total, corpus: 3, offset: 0, limit: 50, items };
}

const row = {
  key: 'billing::REQ-1',
  domain: 'billing',
  reqId: 'REQ-1',
  title: 'Totals include tax',
  statement: 'Line items are summed before tax is applied per jurisdiction',
  status: 'active',
  risk: false,
  category: 'functional' as const,
  riskSource: null,
  edited: false,
};

const detail: RequirementDetail = {
  ...row,
  description: 'Line items summed then tax',
  notes: '',
  sourceTitle: 'Totals include tax',
  ruleCount: 1,
  componentCount: 0,
  validationCount: 0,
  errorPathCount: 0,
  businessRules: [],
  legacyComponents: [],
};

describe('RequirementsModal', () => {
  beforeEach(() => {
    listRequirements.mockReset().mockResolvedValue(page([row]));
    getRequirement.mockReset().mockResolvedValue({ requirement: detail });
    patchRequirement.mockReset();
  });

  it('lists requirements from the server and shows corpus counts', async () => {
    render(<RequirementsModal repoId="r1" repoName="repo" onClose={() => {}} />);
    expect(await screen.findByText('Totals include tax')).toBeInTheDocument();
    expect(
      screen.getByText('Line items are summed before tax is applied per jurisdiction'),
    ).toBeInTheDocument();
    expect(listRequirements).toHaveBeenCalledWith('r1', { offset: 0, limit: 50, category: 'functional' });
  });

  it('search and risk filter go to the SERVER as query params', async () => {
    const user = userEvent.setup();
    render(<RequirementsModal repoId="r1" repoName="repo" onClose={() => {}} />);
    await screen.findByText('Totals include tax');
    await user.type(screen.getByPlaceholderText(/Search requirements/), 'tax');
    await waitFor(() =>
      expect(listRequirements).toHaveBeenCalledWith('r1', { offset: 0, limit: 50, q: 'tax', category: 'functional' }),
    );
    await user.click(screen.getByRole('button', { name: 'Risk' }));
    await waitFor(() =>
      expect(listRequirements).toHaveBeenCalledWith('r1', {
        offset: 0,
        limit: 50,
        category: 'functional',
        q: 'tax',
        risk: 'risk',
      }),
    );
  });

  it('clicking a row opens the edit rail; risk toggle PATCHes and updates the row', async () => {
    const user = userEvent.setup();
    patchRequirement.mockResolvedValue({
      requirement: { ...detail, risk: true, riskSource: 'operator', edited: true },
    });
    render(<RequirementsModal repoId="r1" repoName="repo" onClose={() => {}} />);
    await user.click(await screen.findByText('Totals include tax'));
    expect(await screen.findByText('⚑ Mark as risk')).toBeInTheDocument();
    await user.click(screen.getByText('⚑ Mark as risk'));
    await waitFor(() =>
      expect(patchRequirement).toHaveBeenCalledWith('r1', 'billing::REQ-1', { risk: true }),
    );
    // Row absorbed the update: risk badge appears in the list.
    expect(await screen.findAllByText(/risk ●/)).not.toHaveLength(0);
  });

  it('save sends only the changed fields', async () => {
    const user = userEvent.setup();
    patchRequirement.mockResolvedValue({
      requirement: { ...detail, notes: 'checked', edited: true },
    });
    render(<RequirementsModal repoId="r1" repoName="repo" onClose={() => {}} />);
    await user.click(await screen.findByText('Totals include tax'));
    const notes = await screen.findByRole('textbox', { name: /Notes/i });
    await user.type(notes, 'checked');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(patchRequirement).toHaveBeenCalledWith('r1', 'billing::REQ-1', { notes: 'checked' }),
    );
    expect(await screen.findByText('saved ✓')).toBeInTheDocument();
  });
});
