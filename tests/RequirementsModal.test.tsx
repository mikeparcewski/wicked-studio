import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../src/api/errors.js';
import { resetLaunchWizard, useLaunchWizard } from '../src/store/launchWizard.js';
import { RequirementsModal } from '../src/components/RequirementsModal.js';
import type { RequirementDetail, RequirementsPage } from '../src/api/types.js';

const listRequirements = vi.fn();
const getRequirement = vi.fn();
const patchRequirement = vi.fn();
const launchRun = vi.fn();

vi.mock('../src/api/client.js', () => ({
  api: {
    listRequirements: (...a: unknown[]) => listRequirements(...a),
    getRequirement: (...a: unknown[]) => getRequirement(...a),
    patchRequirement: (...a: unknown[]) => patchRequirement(...a),
    launchRun: (...a: unknown[]) => launchRun(...a),
  },
}));

function page(
  items: RequirementsPage['items'],
  total = items.length,
  corpus = 3,
): RequirementsPage {
  return { total, corpus, offset: 0, limit: 50, items, source: 'store' };
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

describe('RequirementsModal — coverage label and corroboration (operator ruling 2026-10-31)', () => {
  beforeEach(() => {
    getRequirement.mockReset();
    patchRequirement.mockReset();
    resetLaunchWizard();
  });

  const validated = {
    ...row,
    corroboration: { status: 'validated', sources: 3, callSites: 1, tests: 1, docs: 1, extraExtractors: 0 },
  };
  const unconfirmed = {
    ...row,
    key: 'billing::REQ-2',
    reqId: 'REQ-2',
    title: 'Settle invoices',
    corroboration: {
      status: 'unconfirmed',
      sources: 0,
      callSites: 0,
      tests: 0,
      docs: 0,
      extraExtractors: 0,
      why: { code: 'unindexed_file', text: 'src/actor.rs names it, but the code index skipped that file, so callers there are not counted.' },
    },
  };

  it('labels the graph with its coverage and counts, and marks each item', async () => {
    listRequirements.mockReset().mockResolvedValue({
      ...page([validated, unconfirmed] as unknown as RequirementsPage['items'], 2, 2),
      coverage: { mappedPct: 82, minPct: 80, behaviorBearing: 100, mapped: 82, resolved: 70, unmapped: 18 },
      corroboration: { validated: 1, unconfirmed: 1 },
    });
    render(<RequirementsModal repoId="r1" repoName="repo" onClose={() => {}} />);
    const label = await screen.findByTestId('requirements-coverage');
    expect(label).toHaveTextContent('82% of behaviours mapped · minimum 80%');
    expect(label).toHaveAttribute('title', expect.stringContaining('18 not mapped yet'));
    expect(screen.getByTestId('requirements-corroboration-counts')).toHaveTextContent('1 validated · 1 unconfirmed');
    const marks = screen.getAllByTestId('requirement-corroboration');
    expect(marks.map((m) => [m.dataset['status'], m.textContent])).toEqual([
      ['validated', 'validated · 3'],
      ['unconfirmed', 'unconfirmed'],
    ]);
    expect(marks[0]).toHaveAttribute('title', 'Validated by 3 independent sources: 1 caller, 1 test, 1 doc.');
    // The reason is ON the item, not only in a tooltip.
    const why = screen.getByTestId('requirement-unconfirmed-why');
    expect(why).toHaveAttribute('data-code', 'unindexed_file');
    expect(why).toHaveTextContent('Unconfirmed: src/actor.rs names it, but the code index skipped that file');
  });

  it('the edit rail says why an item is unconfirmed', async () => {
    listRequirements.mockReset().mockResolvedValue(page([unconfirmed] as unknown as RequirementsPage['items'], 1, 1));
    getRequirement.mockResolvedValue({ requirement: { ...detail, ...unconfirmed } });
    render(<RequirementsModal repoId="r1" repoName="repo" onClose={() => {}} />);
    fireEvent.click(await screen.findByText('Settle invoices'));
    const rail = await screen.findByTestId('requirement-rail-corroboration');
    expect(rail).toHaveAttribute('data-status', 'unconfirmed');
    expect(rail).toHaveTextContent('Unconfirmed');
    expect(rail).toHaveTextContent('src/actor.rs names it');
  });

  it('a graph or daemon from before the fields shows no label and no marks', async () => {
    listRequirements.mockReset().mockResolvedValue(page([row]));
    render(<RequirementsModal repoId="r1" repoName="repo" onClose={() => {}} />);
    await screen.findByText('Totals include tax');
    expect(screen.queryByTestId('requirements-coverage')).not.toBeInTheDocument();
    expect(screen.queryByTestId('requirement-corroboration')).not.toBeInTheDocument();
  });
});

describe('RequirementsModal', () => {
  beforeEach(() => {
    listRequirements.mockReset().mockResolvedValue(page([row]));
    getRequirement.mockReset().mockResolvedValue({ requirement: detail });
    patchRequirement.mockReset();
    launchRun.mockReset();
    resetLaunchWizard();
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

  // FINDING-065. Measured on `agent-frameworks-autogpt`: 42,925 indexed nodes, zero of them
  // carrying a requirement, so the API answers 200 `{corpus: 0}` and the modal said
  // "No requirements match." That sentence claims a corpus was searched and the filters
  // excluded it. Nothing was searched, and the one action that would help appeared nowhere.
  describe('empty corpus vs empty result', () => {
    it('says nothing was extracted when there is nothing to search, and offers Generate it', async () => {
      listRequirements.mockResolvedValue(page([], 0, 0));
      render(<RequirementsModal repoId="r1" repoName="repo" onClose={() => {}} />);
      expect(
        await screen.findByText('No requirements have been extracted for this repository'),
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Generate it' })).toBeInTheDocument();
      expect(screen.queryByText('No requirements match.')).not.toBeInTheDocument();
    });

    it('still says no match when a real corpus was searched and excluded everything', async () => {
      listRequirements.mockResolvedValue(page([], 0, 3));
      render(<RequirementsModal repoId="r1" repoName="repo" onClose={() => {}} />);
      expect(await screen.findByText('No requirements match.')).toBeInTheDocument();
      expect(screen.queryByTestId('requirements-not-generated')).not.toBeInTheDocument();
    });
  });

  // studio#229 — Escape must close the modal (useModalEscape wiring)
  it('Escape key closes the modal (studio#229)', async () => {
    const onClose = vi.fn();
    render(<RequirementsModal repoId="r1" repoName="repo" onClose={onClose} />);
    await screen.findByText('Totals include tax');
    fireEvent.keyDown(document, { key: 'Escape', bubbles: true, cancelable: true });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // Lane repo-page: on the rig, Repositories → wicked-crew → Requirements read "the daemon refused
  // this — requirements_graph.json not generated for this repo yet" in red. Not generated is a
  // state: it is said plainly, with what the view would show, and "Generate it".
  describe('no requirements graph yet', () => {
    const notGenerated = new ApiError(404, 'No requirements graph yet for this repository', {
      error: 'No requirements graph yet for this repository',
      code: 'notGenerated',
      workflow: 'domain-extraction',
    });

    it('says there is no graph yet and what it would show, never a refusal', async () => {
      listRequirements.mockRejectedValue(notGenerated);
      render(<RequirementsModal repoId="r1" repoName="wicked-crew" onClose={() => {}} />);
      expect(await screen.findByText('No requirements graph yet for this repository')).toBeInTheDocument();
      expect(screen.getByText(/this lists what wicked-crew does as requirements/)).toBeInTheDocument();
      expect(screen.queryByText(/refused/)).not.toBeInTheDocument();
      // Nothing to search before the graph exists.
      expect(screen.queryByPlaceholderText(/Search requirements/)).not.toBeInTheDocument();
    });

    it('reads an older daemon\'s sentence the same way', async () => {
      listRequirements.mockRejectedValue(new ApiError(404, 'requirements_graph.json not generated for this repo yet'));
      render(<RequirementsModal repoId="r1" repoName="wicked-crew" onClose={() => {}} />);
      expect(await screen.findByText('No requirements graph yet for this repository')).toBeInTheDocument();
    });

    it('another failure is still said as one', async () => {
      listRequirements.mockRejectedValue(new ApiError(500, 'disk on fire'));
      render(<RequirementsModal repoId="r1" repoName="wicked-crew" onClose={() => {}} />);
      expect(await screen.findByText(/disk on fire/)).toBeInTheDocument();
      expect(screen.queryByTestId('requirements-not-generated')).not.toBeInTheDocument();
    });

    it('Generate it opens New job filled in for this repository and starts nothing itself', async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      listRequirements.mockRejectedValue(notGenerated);
      render(<RequirementsModal repoId="r1" repoName="wicked-crew" onClose={onClose} />);
      await user.click(await screen.findByRole('button', { name: 'Generate it' }));
      expect(onClose).toHaveBeenCalledTimes(1);
      const { open, draft } = useLaunchWizard.getState();
      expect(open).toBe(true);
      expect(draft?.workflowId).toBe('domain-extraction');
      expect(draft?.contextRepo).toBe('r1');
      expect(draft?.intent).toMatch(/^Map the domain of wicked-crew/);
      expect(launchRun).not.toHaveBeenCalled();
    });
  });

  // Defect 5 — Escape with the edit rail open must close the rail, not the whole modal.
  it('Escape with the edit rail open closes the rail first, not the modal', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<RequirementsModal repoId="r1" repoName="repo" onClose={onClose} />);

    // Open the edit rail by clicking a requirement row.
    await user.click(await screen.findByText('Totals include tax'));
    // Rail is open — wait for it to load.
    expect(await screen.findByText('⚑ Mark as risk')).toBeInTheDocument();

    // Press Escape — must close the rail, not the modal.
    fireEvent.keyDown(document, { key: 'Escape', bubbles: true, cancelable: true });

    expect(onClose).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText('⚑ Mark as risk')).not.toBeInTheDocument());

    // A second Escape (rail now closed) must close the modal.
    fireEvent.keyDown(document, { key: 'Escape', bubbles: true, cancelable: true });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
