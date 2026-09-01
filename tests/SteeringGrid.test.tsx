import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SteeringGrid, draftRule, fmtWeight } from '../src/components/SteeringGrid.js';
import { SteeringPage } from '../src/components/SteeringPage.js';
import { ApiError } from '../src/api/errors.js';
import { ruleIdIssue, ruleTypeOfId, type SteeringRule } from '../src/api/steering.js';

/**
 * The steering SPREADSHEET's cell mechanics (SteeringGrid) + the shell's optimistic write
 * discipline (SteeringPage.commitRule). Pinned:
 *  - click/Enter opens a cell's editor; a commit hands the FULL next rule (one field changed)
 *    to the per-row save — the exact upsert body;
 *  - Esc REVERTS the editor (no commit); Tab/blur commits;
 *  - severity/type are live selects; applies_to/excludes are chip cells;
 *  - the draft row's manual id runs the ENGINE's steering-scoped INV-C1 (PAT-/POL- is the
 *    reserved doc-ingest namespace) with an upsert-collision warning;
 *  - REMOVE = retire (the shared typed-confirmation + reason modal, DELETE wire); retired rows
 *    render struck/dimmed + read-only, toggled by the include_retired facet; NO un-retire
 *    affordance exists (no wire supports one — recon'd);
 *  - the shell applies a commit OPTIMISTICALLY, reverts the one row on error, and reloads for
 *    the server's answer on success.
 */

const listConformanceRules = vi.fn();
const retireConformanceRule = vi.fn();
const upsertConformanceRule = vi.fn();
const apiFetch = vi.fn();

vi.mock('../src/api/client.js', () => ({
  api: {
    listConformanceRules: (...a: unknown[]) => listConformanceRules(...a),
    retireConformanceRule: (...a: unknown[]) => retireConformanceRule(...a),
    upsertConformanceRule: (...a: unknown[]) => upsertConformanceRule(...a),
    getRun: () => Promise.reject(new Error('no runs in this rig')),
  },
  apiFetch: (...a: unknown[]) => apiFetch(...a),
}));

function rule(over: Partial<SteeringRule> = {}): SteeringRule {
  return {
    id: 'PAT-001',
    rule_type: 'pattern',
    statement: 'Never use printf without %s',
    severity: 'error',
    confidence: 0.9,
    targets: {},
    provenance: { source: 'markdown', source_kinds: ['doc'] },
    steering_type: 'security',
    applies_to: ['build'],
    excludes: [],
    weight: 1.5,
    ...over,
  };
}

interface Handlers {
  onCommit: ReturnType<typeof vi.fn>;
  onCreate: ReturnType<typeof vi.fn>;
  onRetired: ReturnType<typeof vi.fn>;
  onSelect: ReturnType<typeof vi.fn>;
}

function grid(rules: SteeringRule[], over: Partial<{ addRequestTick: number }> = {}): Handlers {
  const h: Handlers = {
    onCommit: vi.fn(),
    onCreate: vi.fn().mockResolvedValue(undefined),
    onRetired: vi.fn(),
    onSelect: vi.fn(),
  };
  render(
    <SteeringGrid
      rules={rules}
      type="security"
      loading={false}
      error={null}
      selectedId={null}
      onSelect={h.onSelect}
      onCommit={h.onCommit}
      onCreate={h.onCreate}
      onRetired={h.onRetired}
      {...over}
    />,
  );
  return h;
}

beforeEach(() => {
  listConformanceRules.mockReset();
  retireConformanceRule.mockReset();
  upsertConformanceRule.mockReset();
  apiFetch.mockReset();
  apiFetch.mockRejectedValue(new ApiError(404, 'Not Found'));
  try { localStorage.clear(); } catch { /* jsdom always has it */ }
});

describe('SteeringGrid — inline cell editing', () => {
  it('a statement edit commits the FULL next rule (the exact upsert body: one field changed)', async () => {
    const user = userEvent.setup();
    const r = rule();
    const h = grid([r]);

    await user.click(screen.getByTestId('steering-cell-statement'));
    const input = screen.getByTestId('steering-cell-statement-input');
    await user.clear(input);
    await user.type(input, 'One printf spelling everywhere{Enter}');

    expect(h.onCommit).toHaveBeenCalledTimes(1);
    const [next, prev] = h.onCommit.mock.calls[0] as [SteeringRule, SteeringRule];
    expect(prev).toEqual(r);
    // The body is the WHOLE rule — nothing dropped, exactly one field changed.
    expect(next).toEqual({ ...r, statement: 'One printf spelling everywhere' });
  });

  it('Esc reverts the editor — no commit, the original value stays', async () => {
    const user = userEvent.setup();
    const h = grid([rule()]);

    await user.click(screen.getByTestId('steering-cell-statement'));
    const input = screen.getByTestId('steering-cell-statement-input');
    await user.clear(input);
    await user.type(input, 'half-typed nonsense{Escape}');

    expect(h.onCommit).not.toHaveBeenCalled();
    expect(screen.getByTestId('steering-cell-statement')).toHaveTextContent('Never use printf without %s');
    expect(screen.queryByTestId('steering-cell-statement-input')).toBeNull();
  });

  it('Tab (blur) commits the open editor — spreadsheet motion never loses a typed value', async () => {
    const user = userEvent.setup();
    const h = grid([rule()]);

    await user.click(screen.getByTestId('steering-cell-statement'));
    const input = screen.getByTestId('steering-cell-statement-input');
    await user.clear(input);
    await user.type(input, 'Committed by Tab');
    await user.tab();

    expect(h.onCommit).toHaveBeenCalledTimes(1);
    expect((h.onCommit.mock.calls[0] as [SteeringRule])[0].statement).toBe('Committed by Tab');
  });

  it('severity and type are live selects — a change commits the retyped rule', async () => {
    const user = userEvent.setup();
    const r = rule();
    const h = grid([r]);

    await user.selectOptions(screen.getByTestId('steering-cell-severity'), 'critical');
    expect((h.onCommit.mock.calls[0] as [SteeringRule])[0]).toEqual({ ...r, severity: 'critical' });

    await user.selectOptions(screen.getByTestId('steering-cell-type'), 'development');
    expect((h.onCommit.mock.calls[1] as [SteeringRule])[0]).toEqual({ ...r, steering_type: 'development' });
  });

  it('weight edits commit numerically and refuse a negative', async () => {
    const user = userEvent.setup();
    const r = rule();
    const h = grid([r]);

    await user.click(screen.getByTestId('steering-cell-weight'));
    const input = screen.getByTestId('steering-cell-weight-input');
    await user.clear(input);
    await user.type(input, '-2{Enter}');
    expect(h.onCommit).not.toHaveBeenCalled();

    await user.click(screen.getByTestId('steering-cell-weight'));
    const again = screen.getByTestId('steering-cell-weight-input');
    await user.clear(again);
    await user.type(again, '2.5{Enter}');
    expect((h.onCommit.mock.calls[0] as [SteeringRule])[0]).toEqual({ ...r, weight: 2.5 });
  });

  it('chip cells add/remove tokens and commit the set; Esc reverts it', async () => {
    const user = userEvent.setup();
    const r = rule({ applies_to: ['build'] });
    const h = grid([r]);

    // Esc first: adding a token then bailing commits nothing.
    await user.click(screen.getByTestId('steering-cell-applies'));
    await user.type(screen.getByTestId('steering-cell-applies-input'), 'review{Enter}{Escape}');
    expect(h.onCommit).not.toHaveBeenCalled();

    await user.click(screen.getByTestId('steering-cell-applies'));
    await user.type(screen.getByTestId('steering-cell-applies-input'), 'review{Enter}{Enter}');
    expect((h.onCommit.mock.calls[0] as [SteeringRule])[0]).toEqual({ ...r, applies_to: ['build', 'review'] });
  });

  it('the id cell does NOT edit — it opens the drawer (advanced fields live there)', async () => {
    const user = userEvent.setup();
    const h = grid([rule()]);

    await user.click(screen.getByTestId('steering-grid-id'));
    expect(h.onSelect).toHaveBeenCalledWith('PAT-001');
    expect(h.onCommit).not.toHaveBeenCalled();
  });
});

describe('SteeringGrid — retired rows + the include_retired facet', () => {
  it('retired rows render dimmed/struck, read-only, with NO un-retire affordance', async () => {
    grid([rule({ retired: true })]);

    const row = screen.getByTestId('steering-grid-row');
    expect(row).toHaveAttribute('data-retired', 'true');
    expect(row.style.opacity).toBe('0.55');
    expect(within(row).getByTestId('steering-rule-retired-chip')).toBeInTheDocument();
    // Read-only: no retire button, selects disabled, text cells inert.
    expect(within(row).queryByTestId('steering-grid-retire')).toBeNull();
    expect(within(row).getByTestId('steering-cell-severity')).toBeDisabled();
    expect(within(row).getByTestId('steering-cell-statement')).toBeDisabled();
    // The recon'd absence: nothing offers un-retire.
    expect(screen.queryByText(/un-?retire/i)).toBeNull();
  });

  it('the include_retired toggle hides and re-shows retired rows', async () => {
    const user = userEvent.setup();
    grid([rule(), rule({ id: 'PAT-002', retired: true })]);

    // Default ON: both rows, the retired one marked.
    expect(screen.getAllByTestId('steering-grid-row')).toHaveLength(2);
    const toggle = screen.getByTestId('steering-filter-retired');
    expect(toggle).toHaveAttribute('aria-pressed', 'true');

    await user.click(toggle);
    const rows = screen.getAllByTestId('steering-grid-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveAttribute('data-rule-id', 'PAT-001');

    await user.click(toggle);
    expect(screen.getAllByTestId('steering-grid-row')).toHaveLength(2);
  });

  it('Retire… opens the shared modal; confirming fires the DELETE wire and reports the reason', async () => {
    const user = userEvent.setup();
    retireConformanceRule.mockResolvedValue({ status: 'retired', id: 'PAT-001' });
    const h = grid([rule()]);

    await user.click(screen.getByTestId('steering-grid-retire'));
    await screen.findByTestId('steering-retire-modal');
    await user.type(screen.getByTestId('steering-retire-confirm-input'), 'PAT-001');
    await user.type(screen.getByTestId('steering-retire-reason'), 'superseded by PAT-050');
    await user.click(screen.getByTestId('steering-retire-confirm'));

    await waitFor(() => expect(retireConformanceRule).toHaveBeenCalledWith('PAT-001'));
    expect(h.onRetired).toHaveBeenCalledWith(expect.objectContaining({ id: 'PAT-001' }), 'superseded by PAT-050');
    expect(screen.queryByTestId('steering-retire-modal')).toBeNull();
  });
});

describe('SteeringGrid — the draft row', () => {
  it('the Add ▾ menu request (addRequestTick) opens the draft row', async () => {
    const rules = [rule()];
    const h: Handlers = { onCommit: vi.fn(), onCreate: vi.fn(), onRetired: vi.fn(), onSelect: vi.fn() };
    const { rerender } = render(
      <SteeringGrid rules={rules} type="security" loading={false} error={null} selectedId={null}
        onSelect={h.onSelect} onCommit={h.onCommit} onCreate={h.onCreate} onRetired={h.onRetired} addRequestTick={0} />,
    );
    expect(screen.queryByTestId('steering-grid-draft')).toBeNull();
    rerender(
      <SteeringGrid rules={rules} type="security" loading={false} error={null} selectedId={null}
        onSelect={h.onSelect} onCommit={h.onCommit} onCreate={h.onCreate} onRetired={h.onRetired} addRequestTick={1} />,
    );
    expect(await screen.findByTestId('steering-grid-draft')).toBeInTheDocument();
  });

  it('an id colliding with a loaded rule warns "will UPDATE" (the wire is an upsert) without blocking', async () => {
    const user = userEvent.setup();
    grid([rule({ id: 'PAT-104' })]);

    await user.click(screen.getByTestId('steering-grid-add'));
    const id = screen.getByTestId('steering-draft-id');
    await user.clear(id);
    await user.type(id, 'PAT-104');
    await user.type(screen.getByTestId('steering-draft-statement'), 'x');

    expect(screen.getByTestId('steering-draft-issue')).toHaveTextContent(/already exists — saving will UPDATE/);
    expect(screen.getByTestId('steering-draft-save')).toBeEnabled();
  });
});

describe('draftRule / ruleIdIssue — the draft body + the steering-scoped INV-C1, pinned', () => {
  it('builds the exact unified body: provenance ui, template confidence, derived rule_type', () => {
    expect(draftRule({
      id: ' POL-1201 ',
      steering_type: 'security',
      severity: 'critical',
      statement: ' No secrets in logs ',
      weight: '2.5',
      applies_to: ['gate'],
      excludes: ['chat'],
    })).toEqual({
      id: 'POL-1201',
      rule_type: 'policy',
      statement: 'No secrets in logs',
      severity: 'critical',
      confidence: 0.9,
      targets: {},
      provenance: { source: 'ui', source_kinds: ['doc'] },
      steering_type: 'security',
      applies_to: ['gate'],
      excludes: ['chat'],
      weight: 2.5,
    });
  });

  it('fmtWeight strips the engine f32 noise (1.2 stored comes back 1.2000000476…)', () => {
    expect(fmtWeight(1.2000000476837158)).toBe('1.2');
    expect(fmtWeight(1)).toBe('1');
    expect(fmtWeight(2.5)).toBe('2.5');
  });

  it('PAT-/POL- is the reserved namespace: shape + prefix agreement enforced INSIDE it, non-blank outside', () => {
    expect(ruleIdIssue('PAT-123', 'pattern')).toBeNull();
    expect(ruleIdIssue('POL-123456', 'policy')).toBeNull();
    expect(ruleIdIssue('PAT-12', 'pattern')).toMatch(/reserved doc-ingest namespace/);
    expect(ruleIdIssue('POL-123', 'pattern')).toMatch(/reserved doc-ingest namespace/);
    expect(ruleIdIssue('PAT-abc', 'pattern')).toMatch(/reserved doc-ingest namespace/);
    // Outside the namespace the engine asks only "non-blank" — migrated policies keep custom ids.
    expect(ruleIdIssue('SEC-CUSTOM-1', 'pattern')).toBeNull();
    expect(ruleIdIssue('   ', 'pattern')).toBe('id must not be blank');
    // The derived rule_type follows the prefix; custom ids default to pattern.
    expect(ruleTypeOfId('POL-300')).toBe('policy');
    expect(ruleTypeOfId('PAT-300')).toBe('pattern');
    expect(ruleTypeOfId('SEC-CUSTOM-1')).toBe('pattern');
  });
});

describe('SteeringPage — the optimistic commit discipline (the shell around the grid)', () => {
  it('a cell commit posts the exact body, applies optimistically, and reloads for the server', async () => {
    const user = userEvent.setup();
    const r = rule();
    listConformanceRules
      .mockResolvedValueOnce({ rules: [r] })
      .mockResolvedValue({ rules: [{ ...r, severity: 'critical' }] });
    upsertConformanceRule.mockResolvedValue({ status: 'ok' });
    render(<SteeringPage type="security" navigate={() => {}} />);

    await screen.findByTestId('steering-grid-row');
    await user.selectOptions(screen.getByTestId('steering-cell-severity'), 'critical');

    await waitFor(() => expect(upsertConformanceRule).toHaveBeenCalledTimes(1));
    expect(upsertConformanceRule).toHaveBeenCalledWith({ ...r, severity: 'critical' });
    // The server's answer wins: the reload ran and the note confirms.
    await waitFor(() => expect(listConformanceRules).toHaveBeenCalledTimes(2));
    expect(await screen.findByTestId('steering-saved-note')).toHaveTextContent('Saved PAT-001.');
  });

  it('a refused commit REVERTS the one row and says why — the sheet never lies', async () => {
    const user = userEvent.setup();
    const r = rule();
    listConformanceRules.mockResolvedValue({ rules: [r] });
    upsertConformanceRule.mockRejectedValue(new ApiError(400, 'INV-S2: weight must be finite'));
    render(<SteeringPage type="security" navigate={() => {}} />);

    await screen.findByTestId('steering-grid-row');
    await user.selectOptions(screen.getByTestId('steering-cell-severity'), 'critical');

    expect(await screen.findByTestId('steering-commit-error')).toHaveTextContent(/PAT-001: .*INV-S2/);
    // Reverted: the select shows the server's value again, and no reload was fabricated.
    expect(screen.getByTestId('steering-cell-severity')).toHaveValue('error');
    expect(listConformanceRules).toHaveBeenCalledTimes(1);
  });

  it('retire through the grid dims the row and echoes the reason note', async () => {
    const user = userEvent.setup();
    listConformanceRules
      .mockResolvedValueOnce({ rules: [rule()] })
      .mockResolvedValue({ rules: [rule({ retired: true })] });
    retireConformanceRule.mockResolvedValue({ status: 'retired', id: 'PAT-001' });
    render(<SteeringPage type="security" navigate={() => {}} />);

    await screen.findByTestId('steering-grid-row');
    await user.click(screen.getByTestId('steering-grid-retire'));
    await user.type(screen.getByTestId('steering-retire-confirm-input'), 'PAT-001');
    await user.type(screen.getByTestId('steering-retire-reason'), 'wrong severity model');
    await user.click(screen.getByTestId('steering-retire-confirm'));

    await waitFor(() => expect(retireConformanceRule).toHaveBeenCalledWith('PAT-001'));
    // The reload shows the SERVER's state: the row is now retired → dimmed/struck, still listed.
    await waitFor(() => expect(screen.getByTestId('steering-grid-row')).toHaveAttribute('data-retired', 'true'));
    expect(screen.getByTestId('steering-retired-note')).toHaveTextContent('wrong severity model');
  });
});
