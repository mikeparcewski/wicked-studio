/**
 * J6 S1 (DES-j6-build S4 + §7): a repository whose page carries a domain model opens on the model: the header in
 * words, the rule groups, and the follow-ups with Confirm / Reject. A ruling sends the key and target hash the model
 * gave and is followed by a fresh read; a refusal is said in words. The minimum control is gone. Pages are crew's own
 * answer shape (tests/fixtures/domain-v3/README.md).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../src/api/errors.js';
import { RequirementsModal } from '../src/components/RequirementsModal.js';
import type { DomainModel } from '../src/api/domainModel-wire.js';

const fx = (n: string): DomainModel => JSON.parse(readFileSync(join(__dirname, 'fixtures', 'domain-v3', n), 'utf8')) as DomainModel;
const BUILT = fx('model-built.crew.json');
const RULED = fx('model-after-rulings.crew.json');
const MAIN = 'ts-cobol . . . app/cbl/PAYCALC1/PAYCALC1#MAIN-PARA().';
const READ = 'ts-cobol . . . app/cbl/PAYCALC1/PAYCALC1#READ-PARA().';

const listRequirements = vi.fn();
const domainRuling = vi.fn();
vi.mock('../src/api/client.js', () => ({
  api: {
    listRuns: vi.fn().mockResolvedValue({ runs: [] }),
    getRunEvents: vi.fn().mockResolvedValue({ events: [] }),
    listRequirements: (...a: unknown[]) => listRequirements(...a),
    domainRuling: (...a: unknown[]) => domainRuling(...a),
    getRequirement: vi.fn(),
    patchRequirement: vi.fn(),
  },
}));

const page = (model: DomainModel | undefined) => ({
  total: 1, corpus: 1, offset: 0, limit: 50, source: 'store',
  items: [{ key: 'app/cbl/PAYCALC1.cbl::REQ-001', domain: 'app/cbl/PAYCALC1.cbl', reqId: 'REQ-001', title: 'Overtime pay', statement: 'Hours over forty are paid at the overtime rate.', status: 'active', risk: false, riskSource: null, edited: false, category: 'functional' }],
  ...(model !== undefined ? { model } : {}),
});

describe('the domain model view (J6 S1)', () => {
  beforeEach(() => {
    listRequirements.mockReset().mockResolvedValue(page(BUILT));
    domainRuling.mockReset();
  });

  it('opens on the rules with the header in words; the list is a tab; no minimum control', async () => {
    const user = userEvent.setup();
    render(<RequirementsModal repoId="payroll" repoName="payroll" onClose={() => {}} />);
    expect(await screen.findByTestId('domain-model-headline')).toHaveTextContent('1 rule · 1 checked statement · 4 follow-ups · 2 of 4 targets accounted');
    expect(screen.queryByTestId('requirements-minimum')).not.toBeInTheDocument();
    const group = screen.getByTestId('domain-group');
    expect(group).toHaveTextContent('Overtime pay');
    expect(group).toHaveTextContent('Hours over forty are paid at the overtime rate.');
    expect(within(group).getByTestId('domain-withheld')).toHaveTextContent('1 sentence withheld');
    // A sentence opens the statements it rests on, with where they are.
    await user.click(within(group).getByTestId('domain-sentence'));
    expect(within(group).getByTestId('domain-sentence-statements')).toHaveTextContent('app/cbl/PAYCALC1.cbl:20-29');
    expect(within(group).getByTestId('domain-sentence-statements')).toHaveTextContent('Checked by a second helper');
    expect(screen.queryByTestId('requirement-row')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('domain-tab-list'));
    expect(await screen.findByTestId('requirement-row')).toBeInTheDocument();
  });

  it("a target's lines are confirmed with the model's hash, and the next read shows the rebuilt model", async () => {
    const user = userEvent.setup();
    domainRuling.mockResolvedValue({ ruling: { action: 'confirm', by: 'local', at: 1, subject: 'target', id: MAIN }, build: { rebuilt: true, accounting: RULED.accounting } });
    render(<RequirementsModal repoId="payroll" repoName="payroll" onClose={() => {}} />);
    await user.click(await screen.findByTestId('domain-tab-followups'));
    const rows = screen.getAllByTestId('domain-followup');
    expect(rows.map((r) => r.dataset['kind'])).toEqual(['flagged', 'open', 'open', 'refused']);
    const refused = rows[3]!;
    expect(within(refused).getByTestId('domain-followup-where')).toHaveTextContent('app/cbl/PAYCALC1.cbl:15-19');
    expect(within(refused).queryByTestId('domain-followup-reject')).not.toBeInTheDocument();
    listRequirements.mockResolvedValue(page(RULED));
    const reads = listRequirements.mock.calls.length;
    await user.click(within(refused).getByTestId('domain-followup-confirm'));
    expect(domainRuling).toHaveBeenCalledWith('payroll', { target: MAIN, expectTarget: BUILT.targets.find((t) => t.id === MAIN)!.targetHash, action: 'confirm' });
    await waitFor(() => expect(listRequirements.mock.calls.length).toBeGreaterThan(reads));
    await waitFor(() => expect(screen.getByTestId('domain-model-headline')).toHaveTextContent('1 follow-up · 3 of 4 targets accounted'));
  });

  it('a reject needs a note and sends it with the key; a stale read is said in words and read again', async () => {
    const user = userEvent.setup();
    domainRuling.mockRejectedValue(new ApiError(409, 'the code changed since the model was read', { error: 'the code changed since the model was read', code: 'stale_code' }));
    render(<RequirementsModal repoId="payroll" repoName="payroll" onClose={() => {}} />);
    await user.click(await screen.findByTestId('domain-tab-followups'));
    const open = screen.getAllByTestId('domain-followup')[1]!;
    await user.click(within(open).getByTestId('domain-followup-reject'));
    expect(within(open).getByTestId('domain-followup-reject-send')).toBeDisabled();
    await user.type(within(open).getByTestId('domain-followup-note'), 'The FD is out of scope.');
    const reads = listRequirements.mock.calls.length;
    await user.click(within(open).getByTestId('domain-followup-reject-send'));
    const st = BUILT.statements.find((s) => s.id === BUILT.followups[1]!.statement)!;
    expect(domainRuling).toHaveBeenCalledWith('payroll', {
      statement: st.id, expect: st.key, expectTarget: BUILT.targets.find((t) => t.id === READ)!.targetHash, action: 'reject', note: 'The FD is out of scope.',
    });
    expect(await within(open).findByTestId('domain-followup-error')).toHaveTextContent('The code or the model changed since this was read; it has been read again.');
    await waitFor(() => expect(listRequirements.mock.calls.length).toBeGreaterThan(reads));
  });

  it('a page without a model (a 1.1.0 graph) shows the list as before, with no tabs', async () => {
    listRequirements.mockResolvedValue(page(undefined));
    render(<RequirementsModal repoId="payroll" repoName="payroll" onClose={() => {}} />);
    expect(await screen.findByTestId('requirement-row')).toBeInTheDocument();
    expect(screen.queryByTestId('domain-tab-rules')).not.toBeInTheDocument();
    expect(screen.queryByTestId('domain-model-headline')).not.toBeInTheDocument();
  });
});
