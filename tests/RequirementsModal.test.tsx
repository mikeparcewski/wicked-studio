import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useProvenanceStore } from '../src/store/provenance.js';
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

describe('RequirementsModal', () => {
  beforeEach(() => {
    listRequirements.mockReset().mockResolvedValue(page([row]));
    getRequirement.mockReset().mockResolvedValue({ requirement: detail });
    patchRequirement.mockReset();
    launchRun.mockReset();
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
  // excluded it. Nothing was searched, and the one action that would help — run extraction —
  // appeared nowhere.
  describe('empty corpus vs empty result', () => {
    it('says extraction has not run when there is nothing to search', async () => {
      listRequirements.mockResolvedValue(page([], 0, 0));
      render(<RequirementsModal repoId="r1" repoName="repo" onClose={() => {}} />);
      expect(
        await screen.findByText('No requirements have been extracted for this repo.'),
      ).toBeInTheDocument();
      expect(screen.getByText(/Run domain extraction/)).toBeInTheDocument();
      expect(screen.queryByText('No requirements match.')).not.toBeInTheDocument();
    });

    it('still says no match when a real corpus was searched and excluded everything', async () => {
      listRequirements.mockResolvedValue(page([], 0, 3));
      render(<RequirementsModal repoId="r1" repoName="repo" onClose={() => {}} />);
      expect(await screen.findByText('No requirements match.')).toBeInTheDocument();
      expect(
        screen.queryByText('No requirements have been extracted for this repo.'),
      ).not.toBeInTheDocument();
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

  // studio#229 — empty corpus must offer a "Run domain extraction" button that launches a run
  it('"Run domain extraction" button appears on empty corpus and launches the workflow (studio#229)', async () => {
    const user = userEvent.setup();
    listRequirements.mockResolvedValue(page([], 0, 0));
    launchRun.mockResolvedValue({ runId: 'run-42' });
    render(<RequirementsModal repoId="r1" repoName="my-repo" onClose={() => {}} />);

    const btn = await screen.findByRole('button', { name: /Run domain extraction/i });
    expect(btn).toBeInTheDocument();
    await user.click(btn);
    expect(launchRun).toHaveBeenCalledWith(
      expect.objectContaining({ repoRef: 'r1', workflow: 'domain-extraction' }),
    );
  });

  // studio#324 round 2, Defect 2 — the guard must outlive the POST. launchRun resolves in
  // tens of ms while the extraction runs for minutes; resetting on `finally` re-enables the
  // button and a second click spawns a DUPLICATE run. After a successful launch the button
  // must stay disabled, the run must be named, and provenance recorded.
  // Expected run id ('run-77') comes from the launchRun mock, not from the component.
  it('a second click after a successful launch does not start a second run (studio#324 D2)', async () => {
    const user = userEvent.setup();
    listRequirements.mockResolvedValue(page([], 0, 0));
    launchRun.mockResolvedValue({ runId: 'run-77' });
    render(<RequirementsModal repoId="r1" repoName="my-repo" onClose={() => {}} />);

    const btn = await screen.findByRole('button', { name: /Run domain extraction/i });
    await user.click(btn);
    await waitFor(() => expect(screen.getByText(/run-77/)).toBeInTheDocument());

    // Try again once the POST has settled — this is exactly when the old guard re-armed.
    const after = screen.queryByRole('button', { name: /Run domain extraction|Extraction launched/i });
    if (after) await user.click(after);
    expect(launchRun).toHaveBeenCalledTimes(1);
    expect(useProvenanceStore.getState().launchedHere['run-77']).toBe(true);
  });

  // Defect 4 — button must be disabled while the launch is in flight (spam guard) and
  // surface a failure rather than swallowing it with `void`.
  it('"Run domain extraction" button is disabled while launching and surfaces failure', async () => {
    const user = userEvent.setup();
    listRequirements.mockResolvedValue(page([], 0, 0));
    let rejectLaunch!: (e: Error) => void;
    launchRun.mockReturnValue(new Promise<{ runId: string }>((_res, rej) => { rejectLaunch = rej; }));
    render(<RequirementsModal repoId="r1" repoName="my-repo" onClose={() => {}} />);

    const btn = await screen.findByRole('button', { name: /Run domain extraction/i });
    await user.click(btn);

    // Button becomes disabled (shows "Launching…") and a second click is guarded.
    expect(btn).toBeDisabled();
    expect(btn).toHaveTextContent('Launching…');
    expect(launchRun).toHaveBeenCalledTimes(1);

    // Reject the launch: the error must surface in the UI.
    rejectLaunch(new Error('daemon unavailable'));
    await waitFor(() => expect(screen.getByText('daemon unavailable')).toBeInTheDocument());
    // Button is re-enabled after failure.
    expect(btn).not.toBeDisabled();
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
