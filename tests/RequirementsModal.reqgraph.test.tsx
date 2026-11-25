/**
 * Operator rulings 2026-11-06 on the requirements page (crew api-types 0.197.0):
 *  - P1: "Built from code N commits old (date)" with Refresh map, when the code has moved on.
 *  - P2: a requirement whose code is wrong counts and shows "Code doesn't meet it: …"; a filter lists them.
 *  (P3, the minimum in force and its control, left with J6 S1: the domain model has no minimum.)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { resetLaunchWizard, useLaunchWizard } from '../src/store/launchWizard.js';
import { RequirementsModal } from '../src/components/RequirementsModal.js';
import type { RequirementsPage } from '../src/api/types.js';

const listRequirements = vi.fn();
const launchRun = vi.fn();
vi.mock('../src/api/client.js', () => ({
  api: {
    listRuns: vi.fn().mockResolvedValue({ runs: [] }),
    getRunEvents: vi.fn().mockResolvedValue({ events: [] }),
    listRequirements: (...a: unknown[]) => listRequirements(...a),
    getRequirement: vi.fn(),
    patchRequirement: vi.fn(),
    launchRun: (...a: unknown[]) => launchRun(...a),
  },
}));

const coverage = { realPct: 100, minPct: 66, behaviorBearing: 3, real: 3, placeholders: 0, unmapped: 0, notProduct: 5 };
const item = (reqId: string, title: string, codeMismatch: string | null) => ({
  key: `src::${reqId}`, domain: 'src', reqId, title, statement: `${title} holds`, status: 'active', risk: false,
  riskSource: null, edited: false, category: 'functional', placeholder: false, uncounted: null, codeMismatch,
});
function pageWith(extra: Record<string, unknown> = {}): RequirementsPage {
  return {
    total: 2, corpus: 2, offset: 0, limit: 50, source: 'store', coverage,
    items: [item('REQ-001', 'clamp', null), item('REQ-003', 'sum', 'the loop starts at index 1, so it skips the first element')],
    codeDrift: { builtFromCommit: '8cc32aabde358bf81042ed116623a51c0ef03a96', builtAt: `${new Date().getFullYear()}-11-01T13:57:56-05:00`, basis: 'build', commitsBehind: 69, headCommit: null },
    mismatches: 1,
    ...extra,
  } as unknown as RequirementsPage;
}

describe('requirements page: code age, code mismatches (operator rulings 2026-11-06)', () => {
  beforeEach(() => {
    listRequirements.mockReset().mockResolvedValue(pageWith());
    launchRun.mockReset();
    resetLaunchWizard();
  });

  it('says how old the code behind the map is, and Refresh map opens the mapping job for this repository', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<RequirementsModal repoId="tiny-math" repoName="tiny-math" onClose={onClose} />);
    const age = await screen.findByTestId('requirements-code-age');
    expect(age).toHaveTextContent('Built from code 69 commits old (Nov 1)');
    await user.click(within(age).getByRole('button', { name: 'Refresh map' }));
    const { open, draft } = useLaunchWizard.getState();
    expect(open).toBe(true);
    expect(draft?.workflowId).toBe('domain-extraction');
    expect(draft?.contextRepo).toBe('tiny-math');
    expect(launchRun).not.toHaveBeenCalled();
  });

  it('says nothing about code age when the map is current or the daemon cannot tell', async () => {
    listRequirements.mockReset().mockResolvedValue(pageWith({ codeDrift: { builtFromCommit: '8cc32aa', builtAt: null, basis: 'build', commitsBehind: 0, headCommit: null } }));
    const { unmount } = render(<RequirementsModal repoId="a" repoName="a" onClose={() => {}} />);
    await screen.findAllByTestId('requirement-row');
    expect(screen.queryByTestId('requirements-code-age')).not.toBeInTheDocument();
    unmount();
    listRequirements.mockReset().mockResolvedValue(pageWith({ codeDrift: undefined }));
    render(<RequirementsModal repoId="b" repoName="b" onClose={() => {}} />);
    await screen.findAllByTestId('requirement-row');
    expect(screen.queryByTestId('requirements-code-age')).not.toBeInTheDocument();
  });

  it("shows a requirement whose code is wrong as a finding beside it, and filters to those", async () => {
    const user = userEvent.setup();
    render(<RequirementsModal repoId="tiny-math" repoName="tiny-math" onClose={() => {}} />);
    const rows = await screen.findAllByTestId('requirement-row');
    expect(within(rows[1]!).getByTestId('requirement-code-mismatch')).toHaveTextContent(
      "Code doesn't meet it: the loop starts at index 1, so it skips the first element");
    expect(rows[1]!.dataset['placeholder']).toBe('false');
    expect(within(rows[0]!).queryByTestId('requirement-code-mismatch')).not.toBeInTheDocument();
    const filter = screen.getByTestId('requirements-mismatch-filter');
    expect(filter).toHaveTextContent("Code doesn't meet it · 1");
    await user.click(filter);
    await waitFor(() => expect(listRequirements).toHaveBeenLastCalledWith('tiny-math', expect.objectContaining({ mismatch: 'yes', offset: 0 })));
  });

  it('a late answer to an older read never overwrites a newer one', async () => {
    const user = userEvent.setup();
    let releaseOld: (v: unknown) => void = () => {};
    listRequirements.mockReset()
      .mockResolvedValueOnce(pageWith())
      .mockImplementationOnce(() => new Promise((r) => { releaseOld = r; }))
      .mockResolvedValueOnce(pageWith({ items: [item('REQ-003', 'sum', 'skips the first')], total: 1 }));
    render(<RequirementsModal repoId="tiny-math" repoName="tiny-math" onClose={() => {}} />);
    await screen.findAllByTestId('requirement-row');
    const filter = screen.getByTestId('requirements-mismatch-filter');
    await user.click(filter); // read 2 (held)
    await waitFor(() => expect(listRequirements).toHaveBeenCalledTimes(2));
    await user.click(filter); // read 3 (answers first)
    await waitFor(() => expect(listRequirements).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(screen.getAllByTestId('requirement-row')).toHaveLength(1));
    releaseOld(pageWith());
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getAllByTestId('requirement-row')).toHaveLength(1);
  });

});

describe('a write or a read for another repository is never applied to this one (codex r2)', () => {
  beforeEach(() => {
    listRequirements.mockReset();
    resetLaunchWizard();
  });
  it("an answer for the previous repository that lands before the next read starts is not shown", async () => {
    let landA: (v: unknown) => void = () => {};
    const bPage = pageWith({ items: [item('REQ-009', 'only in b', null)], total: 1, corpus: 1 });
    listRequirements
      .mockResolvedValueOnce(pageWith())
      .mockImplementationOnce(() => new Promise((r) => { landA = r; }))
      .mockImplementation(() => Promise.resolve(bPage));
    const user = userEvent.setup();
    const { rerender } = render(<RequirementsModal repoId="a" repoName="a" onClose={() => {}} />);
    await screen.findAllByTestId('requirement-row');
    await user.click(screen.getByTestId('requirements-mismatch-filter')); // a read for a, held
    await waitFor(() => expect(listRequirements).toHaveBeenCalledTimes(2));
    rerender(<RequirementsModal repoId="b" repoName="b" onClose={() => {}} />);
    landA(pageWith()); // a's answer lands inside b's debounce window
    await waitFor(() => expect(screen.getAllByTestId('requirement-row')).toHaveLength(1));
    expect(screen.getByTestId('requirement-row')).toHaveTextContent('only in b');
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.getAllByTestId('requirement-row')).toHaveLength(1);
  });
});
