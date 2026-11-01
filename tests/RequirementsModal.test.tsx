import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../src/api/errors.js';
import { resetLaunchWizard, useLaunchWizard } from '../src/store/launchWizard.js';
import { RequirementsModal } from '../src/components/RequirementsModal.js';
import type { RequirementDetail, RequirementsPage } from '../src/api/types.js';

const listRequirements = vi.fn();
const getRequirement = vi.fn();
const patchRequirement = vi.fn();
const launchRun = vi.fn();
const listRuns = vi.fn().mockResolvedValue({ runs: [] });
const getRunEvents = vi.fn().mockResolvedValue({ events: [] });

vi.mock('../src/api/client.js', () => ({
  api: {
    listRuns: (...a: unknown[]) => listRuns(...a),
    getRunEvents: (...a: unknown[]) => getRunEvents(...a),
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
      coverage: { realPct: 54, minPct: 80, behaviorBearing: 5786, real: 3182, placeholders: 2577, unmapped: 27, notProduct: 2380 },
      corroboration: { validated: 1, unconfirmed: 1 },
    });
    render(<RequirementsModal repoId="r1" repoName="repo" onClose={() => {}} />);
    const label = await screen.findByTestId('requirements-coverage');
    expect(label).toHaveAttribute('data-real-pct', '54');
    expect(screen.getByTestId('requirements-coverage-headline')).toHaveTextContent('54% real requirements · minimum 80%');
    expect(screen.getByTestId('requirements-coverage-breakdown')).toHaveTextContent(
      '3,182 real · 2,577 placeholders (unconfirmed) · 27 unmapped · 2,380 not product code');
    // placeholders are marked unconfirmed, never counted as progress
    const ph = label.querySelector('[data-part="placeholders"]')!;
    expect(ph).toHaveAttribute('data-unconfirmed', 'true');
    expect(ph).toHaveAttribute('title', expect.stringContaining('do not count toward the share'));
    expect(label).not.toHaveTextContent(/\bmapped\b/);
    // one set of numbers (operator 2026-11-01): no validated/unconfirmed pair, no "matching · total" in the header
    expect(screen.queryByTestId('requirements-corroboration-counts')).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/\d+ validated · \d+ unconfirmed|matching ·|\d+ total/);
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

  it('a placeholder is marked a placeholder, never validated; mono is for the id only; chips sit in their own cell', async () => {
    const placeholder = { ...validated, key: 'd::REQ-9', reqId: 'REQ-9', title: 'private',
      statement: '[RISK] private: empty statement (model could not state a rule)', status: 'review', risk: true, riskSource: 'data' };
    listRequirements.mockReset().mockResolvedValue({
      ...page([validated, placeholder] as unknown as RequirementsPage['items'], 2, 2),
      coverage: { realPct: 54, minPct: 80, behaviorBearing: 5786, real: 3182, placeholders: 2577, unmapped: 27, notProduct: 2380 },
    });
    render(<RequirementsModal repoId="r1" repoName="repo" onClose={() => {}} />);
    await screen.findByText('private');
    const rows = screen.getAllByTestId('requirement-row');
    expect(rows.map((r) => r.dataset['placeholder'])).toEqual(['false', 'true']);
    // the validated item keeps its corroboration; the placeholder shows "placeholder" and no corroboration at all
    expect(within(rows[0]!).getByTestId('requirement-corroboration')).toHaveTextContent('validated · 3');
    expect(within(rows[1]!).queryByTestId('requirement-corroboration')).not.toBeInTheDocument();
    expect(within(rows[1]!).queryByTestId('requirement-unconfirmed-why')).not.toBeInTheDocument();
    expect(within(rows[1]!).getByTestId('requirement-placeholder')).toHaveAttribute('title', expect.stringContaining('unconfirmed'));
    expect(rows[1]).not.toHaveTextContent(/validated/);
    // mono only for the REQ id
    for (const r of rows) {
      expect([...r.querySelectorAll('.font-mono')].map((e) => e.textContent)).toEqual([r.querySelector('.wk-req-row-id')!.textContent]);
      expect(r.querySelector('.wk-req-row-chips')).not.toBeNull();
    }
  });

  it('says when the list is an older graph build than the numbers above it, and nothing when it is current', async () => {
    const live = { realPct: 61, minPct: 80, behaviorBearing: 5786, real: 3585, placeholders: 2174, unmapped: 27, notProduct: 2380 };
    listRequirements.mockReset().mockResolvedValue({
      ...page([validated] as unknown as RequirementsPage['items'], 1, 1), coverage: live,
      graphBuild: { generation: 2, coverage: null, behind: true },
    });
    const { unmount } = render(<RequirementsModal repoId="r1" repoName="wicked-crew" onClose={() => {}} />);
    expect(await screen.findByTestId('requirements-graph-behind')).toHaveTextContent(
      'This list is a graph built before real requirements were counted. The 3,585 real requirements mapped now are kept, not listed');
    unmount();
    listRequirements.mockReset().mockResolvedValue({
      ...page([validated] as unknown as RequirementsPage['items'], 1, 1), coverage: { ...live, realPct: 100, real: 3, behaviorBearing: 3, placeholders: 0, unmapped: 0 },
      graphBuild: { generation: 2, coverage: { ...live, realPct: 100, real: 3, behaviorBearing: 3, placeholders: 0, unmapped: 0 }, behind: false },
    });
    render(<RequirementsModal repoId="r2" repoName="pi-governance" onClose={() => {}} />);
    await screen.findByTestId('requirements-coverage');
    expect(screen.queryByTestId('requirements-graph-behind')).not.toBeInTheDocument();
  });

  it('crew 0.167.0: a row on a type shape is "not counted", the page says how many, and an empty Config & data filter is gone', async () => {
    const live = { realPct: 80, minPct: 80, behaviorBearing: 4333, real: 3476, placeholders: 836, unmapped: 21, notProduct: 2256 };
    const shape = { ...validated, key: 'chat::REQ-061', reqId: 'REQ-061', title: 'ChatAttachmentError', uncounted: 'structural',
      statement: 'Attachment refusals must use one of attachment_too_large or attachment_type.', risk: true, riskSource: 'data' };
    listRequirements.mockReset().mockResolvedValue({
      ...page([validated, shape] as unknown as RequirementsPage['items'], 2, 2), coverage: live,
      uncounted: { stated: 441, placeholders: 1017 }, categories: { functional: 5770, configData: 0 },
    });
    render(<RequirementsModal repoId="r1" repoName="wicked-crew" onClose={() => {}} />);
    await screen.findByText('ChatAttachmentError');
    const rows = screen.getAllByTestId('requirement-row');
    const mark = within(rows[1]!).getByTestId('requirement-not-counted');
    expect(mark).toHaveTextContent('not counted');
    expect(mark).toHaveAttribute('title', 'A type shape, not a behaviour: the coverage share does not count it.');
    expect(within(rows[1]!).queryByTestId('requirement-corroboration')).not.toBeInTheDocument();
    expect(within(rows[1]!).queryByTestId('requirement-placeholder')).not.toBeInTheDocument();
    expect(within(rows[1]!).queryByTestId('requirement-unconfirmed-why')).not.toBeInTheDocument();
    // "risk" now means a placeholder the engine does not resolve
    expect(within(rows[1]!).getByText('risk')).toHaveAttribute('title', 'placeholder: the engine does not resolve it');
    // the counted row keeps its own mark
    expect(within(rows[0]!).getByTestId('requirement-corroboration')).toBeInTheDocument();
    expect(screen.getByTestId('requirements-uncounted')).toHaveTextContent('441 stated rules and 1,017 placeholders sit on type shapes and are not counted.');
    const filters = screen.getByRole('group', { name: 'Category filter' });
    expect(within(filters).queryByText('Config & data')).not.toBeInTheDocument();
    expect(within(filters).getByText('Functional')).toBeInTheDocument();
  });

  it('a not-product or unindexed row says so; a view on Config & data moves to Functional when the corpus has none (r4)', async () => {
    const np = { ...validated, key: 'x::REQ-7', reqId: 'REQ-7', title: 'fixtures', uncounted: 'not_product' };
    const ui = { ...validated, key: 'x::REQ-8', reqId: 'REQ-8', title: 'skipped', uncounted: 'unindexed' };
    listRequirements.mockReset().mockResolvedValueOnce({ ...page([np, ui] as unknown as RequirementsPage['items'], 2, 2), categories: { functional: 2, configData: 3 } });
    render(<RequirementsModal repoId="r1" repoName="repo" onClose={() => {}} />);
    await screen.findByText('fixtures');
    const marks = screen.getAllByTestId('requirement-not-counted');
    expect(marks.map((m) => m.getAttribute('title'))).toEqual([
      'Not product code (a test, data, a manifest or a doc): the coverage share does not count it.',
      'In a file the code index skipped: the coverage share does not count it.',
    ]);
    listRequirements.mockResolvedValue({ ...page([] as unknown as RequirementsPage['items'], 0, 2), categories: { functional: 2, configData: 0 } });
    fireEvent.click(within(screen.getByRole('group', { name: 'Category filter' })).getByText('Config & data'));
    await waitFor(() => expect(within(screen.getByRole('group', { name: 'Category filter' })).queryByText('Config & data')).not.toBeInTheDocument());
    await waitFor(() => expect(within(screen.getByRole('group', { name: 'Category filter' })).getByText('Functional')).toHaveAttribute('aria-pressed', 'true'));
    await waitFor(() => expect(listRequirements).toHaveBeenLastCalledWith('r1', expect.objectContaining({ category: 'functional' })));
  });

  it('crew 0.167.0 fields absent (an older daemon) or zero: nothing extra, and Config & data stays', async () => {
    listRequirements.mockReset().mockResolvedValue({ ...page([validated] as unknown as RequirementsPage['items'], 1, 1) });
    const { unmount } = render(<RequirementsModal repoId="r1" repoName="repo" onClose={() => {}} />);
    await screen.findByTestId('requirement-row');
    expect(screen.queryByTestId('requirements-uncounted')).not.toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'Category filter' })).getByText('Config & data')).toBeInTheDocument();
    unmount();
    listRequirements.mockReset().mockResolvedValue({
      ...page([validated] as unknown as RequirementsPage['items'], 1, 1), coverage: { realPct: 100, minPct: 80, behaviorBearing: 3, real: 3, placeholders: 0, unmapped: 0, notProduct: 117 },
      uncounted: { stated: 0, placeholders: 0 }, categories: { functional: 3, configData: 4 },
    });
    render(<RequirementsModal repoId="r2" repoName="pi-governance" onClose={() => {}} />);
    await screen.findByTestId('requirement-row');
    expect(screen.queryByTestId('requirements-uncounted')).not.toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'Category filter' })).getByText('Config & data')).toBeInTheDocument();
  });

  it('the range under the list counts the list shown, not the corpus', async () => {
    listRequirements.mockReset().mockResolvedValue({
      ...page([validated] as unknown as RequirementsPage['items'], 7285, 7300),
      coverage: { realPct: 54, minPct: 80, behaviorBearing: 5786, real: 3182, placeholders: 2577, unmapped: 27, notProduct: 2380 },
    });
    render(<RequirementsModal repoId="r1" repoName="repo" onClose={() => {}} />);
    expect(await screen.findByTestId('requirements-range')).toHaveTextContent('Requirements 1–50 of 7,285');
    expect(document.body).not.toHaveTextContent(/7,?300/);
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
    await user.type(screen.getByPlaceholderText(/Search id, domain, title or statement/), 'tax');
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

    // domain-graph-3: the real share so far is said in the view, and a job still mapping it leads with its own
    // progress line (and the launch button gives way to it).
    it('says the real share so far against the minimum, and offers to keep mapping', async () => {
      listRequirements.mockRejectedValue(new ApiError(404, 'No requirements graph yet for this repository', {
        error: 'No requirements graph yet for this repository', code: 'notGenerated', workflow: 'domain-extraction',
        coverage: { realPct: 3, minPct: 80, behaviorBearing: 8109, real: 300, placeholders: 7700, unmapped: 109, notProduct: 40 },
      }));
      render(<RequirementsModal repoId="r1" repoName="wicked-crew" onClose={() => {}} />);
      const share = await screen.findByTestId('requirements-real-share');
      expect(screen.getByTestId('requirements-real-share-headline')).toHaveTextContent(
        '3% real requirements · minimum 80% · the graph is built once the minimum is reached; the real requirements found so far are kept');
      expect(screen.getByTestId('requirements-real-share-breakdown')).toHaveTextContent('300 real · 7,700 placeholders (unconfirmed) · 109 unmapped · 40 not product code');
      // the bar fills the real share only, with the minimum ticked
      expect(share.querySelector<HTMLElement>('.wk-reqcov-fill')!.style.width).toBe('3%');
      expect(share.querySelector<HTMLElement>('.wk-reqcov-min')!.style.left).toBe('80%');
      expect(screen.getByRole('button', { name: 'Keep mapping' })).toBeInTheDocument();
    });

    it('a job mapping it now leads with its progress line and opens from here', async () => {
      const user = userEvent.setup();
      const onOpenRun = vi.fn();
      listRequirements.mockRejectedValue(notGenerated);
      // the daemon lists actionable runs first: the newest live job is chosen by when it started, whatever its status
      listRuns.mockResolvedValueOnce({ runs: [
        { session: { id: 'older-live', repo_ref: 'r1', workflow_id: 'domain-extraction', status: 'awaiting_human', created_at: 5 }, units: [] },
        { session: { id: 'old', repo_ref: 'r1', workflow_id: 'domain-extraction', status: 'cancelled', created_at: 9 }, units: [] },
        { session: { id: 'job-1', repo_ref: 'r1', workflow_id: 'domain-extraction', status: 'distributing', created_at: 7 }, units: [] },
        { session: { id: 'other', repo_ref: 'r2', workflow_id: 'domain-extraction', status: 'executing', created_at: 8 }, units: [] },
      ] });
      getRunEvents.mockResolvedValueOnce({ events: [
        { type: 'stepRepeated', session: 'job-1', ord: 11, fromOrd: 7, pass: 3, line: 'Mapping wicked-crew · 3% → 9% → 15% → 21% · target 80% · page 4 · about 3 h left' },
      ] });
      render(<RequirementsModal repoId="r1" repoName="wicked-crew" onClose={() => {}} onOpenRun={onOpenRun} />);
      const job = await screen.findByTestId('requirements-mapping-job');
      expect(job).toHaveTextContent('Mapping wicked-crew · 3% → 9% → 15% → 21% · target 80% · page 4 · about 3 h left');
      expect(getRunEvents).toHaveBeenCalledWith('job-1', ['stepRepeated', 'awaitingHuman', 'resumed', 'unitExecuting']);
      expect(screen.queryByRole('button', { name: /Generate it|Keep mapping/ })).not.toBeInTheDocument();
      await user.click(screen.getByTestId('requirements-open-mapping-job'));
      expect(onOpenRun).toHaveBeenCalledWith('job-1');
    });

    it('with no job seen mapping, the view reads the requirements once and stands', async () => {
      listRequirements.mockReset();
      listRequirements.mockRejectedValueOnce(notGenerated); // the read just before the job built the graph
      listRequirements.mockResolvedValue(page([row]));
      listRuns.mockResolvedValueOnce({ runs: [] }); // …and the job list read just after it ended
      render(<RequirementsModal repoId="r1" repoName="wicked-crew" onClose={() => {}} />);
      expect(await screen.findByTestId('requirements-not-generated')).toBeInTheDocument();
      // no job was seen mapping, so nothing more is read: the panel stands
      await waitFor(() => expect(listRuns).toHaveBeenCalled());
      expect(listRequirements).toHaveBeenCalledTimes(1);
    });

    it('a watched job that ends triggers one more read, and the graph shows', async () => {
      listRequirements.mockReset();
      listRequirements.mockRejectedValueOnce(notGenerated).mockRejectedValueOnce(notGenerated);
      listRequirements.mockResolvedValue(page([row]));
      listRuns
        .mockResolvedValueOnce({ runs: [{ session: { id: 'job-1', repo_ref: 'r1', workflow_id: 'domain-extraction', status: 'executing', created_at: 1 }, units: [] }] })
        .mockResolvedValueOnce({ runs: [{ session: { id: 'job-1', repo_ref: 'r1', workflow_id: 'domain-extraction', status: 'completed', created_at: 1 }, units: [] }] });
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        render(<RequirementsModal repoId="r1" repoName="wicked-crew" onClose={() => {}} />);
        expect(await screen.findByTestId('requirements-mapping-job')).toBeInTheDocument();
        await vi.advanceTimersByTimeAsync(30_000); // the half-minute refresh: still no graph, the job has ended
        expect(await screen.findByText('Totals include tax')).toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    });

    it('a job list that cannot be read is said, with a way to check again, and does not hide the launch', async () => {
      const user = userEvent.setup();
      listRequirements.mockRejectedValue(notGenerated);
      listRuns.mockRejectedValueOnce(new Error('daemon away'));
      render(<RequirementsModal repoId="r1" repoName="wicked-crew" onClose={() => {}} />);
      expect(await screen.findByTestId('requirements-mapping-unknown')).toHaveTextContent('Could not check whether a job is mapping wicked-crew now.');
      expect(screen.getByRole('button', { name: 'Generate it' })).toBeInTheDocument();
      await user.click(screen.getByTestId('requirements-mapping-retry'));
      await waitFor(() => expect(screen.queryByTestId('requirements-mapping-unknown')).not.toBeInTheDocument());
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
