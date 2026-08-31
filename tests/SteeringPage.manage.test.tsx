import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SteeringPage } from '../src/components/SteeringPage.js';
import { ApiError } from '../src/api/errors.js';
import type { SteeringRule, SteeringType } from '../src/api/steering.js';
import { useGateStore } from '../src/store/gates.js';

/**
 * The Steering surface's MANAGEMENT flows — all four, behind the ONE "Add" menu now (the
 * steering-UX wave: each opens on demand, none rendered open by default), the type always
 * inferred from the page and every wire unchanged:
 *  - Import: a picked .md/.json POSTs `/governance/steering/import` with this page's type;
 *    per-entry results render honestly (created/updated/error rows), and a 501/route-absent
 *    daemon gets the honest unsupported copy, never a raw refusal;
 *  - Add individual: the MODAL form derives a fresh INV-C1 id, builds the unified rule
 *    (applies_to/excludes chips, weight, optional effect+trigger), stamps provenance source
 *    "ui", POSTs the SHIPPING upsert CRUD, and reloads for the server's state — including the
 *    honesty note when an older engine drops steering_type and files the rule under the serde
 *    default;
 *  - Edit: the same modal form pre-filled (opened from the DRAWER), id fixed, provenance
 *    carried through untouched;
 *  - Add with chat: POST `/governance/steering/author` launches the authoring run; the PROPOSE
 *    gate arrives as a normal awaitingHuman frame and renders through the EXISTING SteeringGate
 *    card (reused, not re-implemented); approving it is what writes rules.
 */

const listConformanceRules = vi.fn();
const retireConformanceRule = vi.fn();
const upsertConformanceRule = vi.fn();
const confirmGate = vi.fn();
const cancelRun = vi.fn();
const apiFetch = vi.fn();

vi.mock('../src/api/client.js', () => ({
  api: {
    listConformanceRules: (...a: unknown[]) => listConformanceRules(...a),
    retireConformanceRule: (...a: unknown[]) => retireConformanceRule(...a),
    upsertConformanceRule: (...a: unknown[]) => upsertConformanceRule(...a),
    confirmGate: (...a: unknown[]) => confirmGate(...a),
    cancelRun: (...a: unknown[]) => cancelRun(...a),
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
    ...over,
  };
}

/** The wiki reads stay route-absent in these suites — management is what is under test. */
function wireManagement(handlers: Record<string, (body: unknown) => Promise<unknown>> = {}): void {
  apiFetch.mockImplementation((path: unknown, init?: { body?: string }) => {
    const h = handlers[String(path)];
    if (h !== undefined) return h(init?.body === undefined ? undefined : JSON.parse(init.body));
    return Promise.reject(new ApiError(404, 'Not Found'));
  });
}

function page(type: SteeringType = 'security'): ReturnType<typeof render> {
  return render(<SteeringPage type={type} navigate={() => {}} />);
}

/** Open one of the three flows through the ONE Add menu — the menu items keep the retired
 *  management bar's testids (the affordances survived, only their placement changed). */
async function openFlow(
  user: ReturnType<typeof userEvent.setup>,
  item: 'steering-add-open' | 'steering-import-open' | 'steering-author-open',
): Promise<void> {
  await user.click(await screen.findByTestId('steering-add-menu'));
  await user.click(await screen.findByTestId(item));
}

beforeEach(() => {
  listConformanceRules.mockReset();
  retireConformanceRule.mockReset();
  upsertConformanceRule.mockReset();
  confirmGate.mockReset();
  cancelRun.mockReset();
  apiFetch.mockReset();
  useGateStore.setState({ gates: {}, approaching: {} });
});

describe('SteeringPage — the ONE Add menu', () => {
  it('lists the three flows and opens each on demand — none rendered open by default', async () => {
    const user = userEvent.setup();
    listConformanceRules.mockResolvedValue({ rules: [] });
    wireManagement();
    page('security');

    // Closed by default: no flow panel, no form, no menu list.
    await screen.findByTestId('steering-add-menu');
    expect(screen.queryByTestId('steering-add-menu-list')).toBeNull();
    expect(screen.queryByTestId('steering-rule-form')).toBeNull();
    expect(screen.queryByTestId('steering-import-panel')).toBeNull();
    expect(screen.queryByTestId('steering-author-panel')).toBeNull();

    await user.click(screen.getByTestId('steering-add-menu'));
    const menu = await screen.findByTestId('steering-add-menu-list');
    expect(within(menu).getByTestId('steering-add-open')).toBeInTheDocument();
    expect(within(menu).getByTestId('steering-import-open')).toBeInTheDocument();
    expect(within(menu).getByTestId('steering-author-open')).toBeInTheDocument();

    // Add individual → the modal form; picking an item closes the menu.
    await user.click(within(menu).getByTestId('steering-add-open'));
    expect(await screen.findByTestId('steering-rule-form')).toBeInTheDocument();
    expect(screen.queryByTestId('steering-add-menu-list')).toBeNull();
    await user.click(screen.getByTestId('steering-form-cancel'));
    expect(screen.queryByTestId('steering-rule-form')).toBeNull();

    // Import → the file-picker panel.
    await openFlow(user, 'steering-import-open');
    expect(await screen.findByTestId('steering-import-panel')).toBeInTheDocument();
    await user.click(screen.getByTestId('steering-import-close'));
    expect(screen.queryByTestId('steering-import-panel')).toBeNull();

    // Add with chat → the governed authoring panel.
    await openFlow(user, 'steering-author-open');
    expect(await screen.findByTestId('steering-author-panel')).toBeInTheDocument();
    await user.click(screen.getByTestId('steering-author-close'));
    expect(screen.queryByTestId('steering-author-panel')).toBeNull();
  });
});

describe('SteeringPage — import', () => {
  it('POSTs the picked file with THIS page type and renders per-entry results honestly', async () => {
    const user = userEvent.setup();
    listConformanceRules.mockResolvedValue({ rules: [] });
    let importBody: unknown = null;
    wireManagement({
      '/governance/steering/import': (body) => {
        importBody = body;
        return Promise.resolve({
          results: [
            { id: 'POL-201', status: 'created', statement: 'No secrets in logs' },
            { id: 'POL-202', status: 'updated', statement: 'Rotate keys' },
            { status: 'error', error: 'statement missing on entry 3' },
          ],
        });
      },
    });
    page('security');

    await openFlow(user, 'steering-import-open');
    const file = new File(['# doctrine\n'], 'security-rules.md', { type: 'text/markdown' });
    await user.upload(screen.getByTestId('steering-import-file'), file);

    expect(await screen.findByTestId('steering-import-summary')).toHaveTextContent(
      'security-rules.md: 1 created · 1 updated · 1 failed',
    );
    expect(importBody).toMatchObject({
      type: 'security',
      entries: [{ kind: 'doc', name: 'security-rules.md', content: '# doctrine\n' }],
    });
    const rows = screen.getAllByTestId('steering-import-result');
    expect(rows.map((r) => r.getAttribute('data-status'))).toEqual(['created', 'updated', 'error']);
    expect(rows[2]).toHaveTextContent('statement missing on entry 3');
    // Something may have landed even in a half-good batch — the list reloads for the server's state.
    await waitFor(() => expect(listConformanceRules).toHaveBeenCalledTimes(2));
  });

  it('parses a .json file into per-rule entries', async () => {
    const user = userEvent.setup();
    listConformanceRules.mockResolvedValue({ rules: [] });
    let importBody: { entries?: unknown[] } | null = null;
    wireManagement({
      '/governance/steering/import': (body) => {
        importBody = body as { entries?: unknown[] };
        return Promise.resolve({ results: [] });
      },
    });
    page('testing');

    await openFlow(user, 'steering-import-open');
    await user.upload(
      screen.getByTestId('steering-import-file'),
      new File(['[{"id":"SEC-9"}]'], 'batch.JSON', { type: 'application/json' }),
    );
    await waitFor(() =>
      expect(importBody).toMatchObject({ type: 'testing', entries: [{ kind: 'rule', rule: { id: 'SEC-9' } }] }),
    );
  });

  it('a 501/route-absent daemon gets the honest unsupported copy, never a raw refusal', async () => {
    const user = userEvent.setup();
    listConformanceRules.mockResolvedValue({ rules: [] });
    wireManagement(); // the steering routes do not exist on this daemon
    page('security');

    await openFlow(user, 'steering-import-open');
    await user.upload(
      screen.getByTestId('steering-import-file'),
      new File(['x'], 'a.md', { type: 'text/markdown' }),
    );
    expect(await screen.findByTestId('steering-import-unsupported')).toHaveTextContent(/predates steering management/);
    expect(screen.queryByTestId('steering-import-error')).toBeNull();
  });

  it('a real import failure surfaces as one', async () => {
    const user = userEvent.setup();
    listConformanceRules.mockResolvedValue({ rules: [] });
    wireManagement({
      '/governance/steering/import': () => Promise.reject(new ApiError(400, 'unparseable frontmatter')),
    });
    page('security');

    await openFlow(user, 'steering-import-open');
    await user.upload(
      screen.getByTestId('steering-import-file'),
      new File(['x'], 'a.md', { type: 'text/markdown' }),
    );
    expect(await screen.findByTestId('steering-import-error')).toHaveTextContent(/unparseable frontmatter/);
  });
});

describe('SteeringPage — the Add-rule form', () => {
  it('derives the next free INV-C1 id, builds the unified rule with provenance "ui", and saves', async () => {
    const user = userEvent.setup();
    listConformanceRules
      .mockResolvedValueOnce({ rules: [rule({ id: 'PAT-104', steering_type: 'security' })] })
      .mockResolvedValue({
        rules: [
          rule({ id: 'PAT-104', steering_type: 'security' }),
          rule({ id: 'PAT-105', statement: 'New secrets rule', steering_type: 'security' }),
        ],
      });
    upsertConformanceRule.mockResolvedValue({ status: 'ok' });
    wireManagement();
    page('security');

    await screen.findByTestId('steering-rule-row');
    await openFlow(user, 'steering-add-open');
    const form = await screen.findByTestId('steering-rule-form');
    // The suggested id follows the loaded corpus: max PAT ordinal + 1.
    expect(within(form).getByTestId('steering-form-id')).toHaveValue('PAT-105');

    await user.type(within(form).getByTestId('steering-form-statement'), 'New secrets rule');
    await user.selectOptions(within(form).getByTestId('steering-form-severity'), 'critical');
    await user.type(within(form).getByTestId('steering-form-applies'), 'build{Enter}review{Enter}');
    await user.type(within(form).getByTestId('steering-form-excludes'), 'chat{Enter}');
    await user.clear(within(form).getByTestId('steering-form-weight'));
    await user.type(within(form).getByTestId('steering-form-weight'), '2.5');
    await user.selectOptions(within(form).getByTestId('steering-form-effect'), 'deny');
    await user.type(within(form).getByTestId('steering-form-trigger'), 'secret');
    await user.click(within(form).getByTestId('steering-form-save'));

    await waitFor(() => expect(upsertConformanceRule).toHaveBeenCalledTimes(1));
    expect(upsertConformanceRule).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'PAT-105',
        rule_type: 'pattern',
        statement: 'New secrets rule',
        severity: 'critical',
        steering_type: 'security', // inferred from the page, never a form field
        applies_to: ['build', 'review'],
        excludes: ['chat'],
        weight: 2.5,
        effect: 'deny',
        trigger: { contains: 'secret' },
        provenance: expect.objectContaining({ source: 'ui' }),
      }),
    );
    // The form closes, the list reloads for the server's state, and the save is confirmed.
    expect(await screen.findByTestId('steering-saved-note')).toHaveTextContent('Saved PAT-105.');
    expect(screen.queryByTestId('steering-rule-form')).toBeNull();
    const rows = screen.getAllByTestId('steering-rule-row');
    expect(rows.map((r) => r.getAttribute('data-rule-id'))).toContain('PAT-105');
  });

  it('a rule without an effect saves recall-only — no effect, no trigger on the wire', async () => {
    const user = userEvent.setup();
    listConformanceRules.mockResolvedValue({ rules: [] });
    upsertConformanceRule.mockResolvedValue({ status: 'ok' });
    wireManagement();
    page('operations');

    await openFlow(user, 'steering-add-open');
    await user.type(screen.getByTestId('steering-form-statement'), 'Runbooks live in ops/');
    await user.click(screen.getByTestId('steering-form-save'));

    await waitFor(() => expect(upsertConformanceRule).toHaveBeenCalledTimes(1));
    const sent = upsertConformanceRule.mock.calls[0]![0] as Record<string, unknown>;
    expect(sent).not.toHaveProperty('effect');
    expect(sent).not.toHaveProperty('trigger');
    expect(sent).toMatchObject({ steering_type: 'operations', weight: 1 });
  });

  it('stays disabled on an out-of-contract id or an empty statement (INV-C1 echoed client-side)', async () => {
    const user = userEvent.setup();
    listConformanceRules.mockResolvedValue({ rules: [] });
    wireManagement();
    page('security');

    await openFlow(user, 'steering-add-open');
    const save = screen.getByTestId('steering-form-save');
    expect(save).toBeDisabled(); // empty statement

    await user.type(screen.getByTestId('steering-form-statement'), 'x');
    expect(save).toBeEnabled();

    await user.clear(screen.getByTestId('steering-form-id'));
    await user.type(screen.getByTestId('steering-form-id'), 'POL-1'); // wrong prefix AND too short
    expect(save).toBeDisabled();
    expect(screen.getByText(/id must match PAT-/)).toBeInTheDocument();
    expect(upsertConformanceRule).not.toHaveBeenCalled();
  });

  it('says where the SERVER filed the rule when an older engine drops steering_type', async () => {
    const user = userEvent.setup();
    listConformanceRules
      .mockResolvedValueOnce({ rules: [] })
      // The reload after save: the engine dropped the unified fields, so the rule comes back
      // typeless — the serde default, architecture.
      .mockResolvedValue({ rules: [rule({ id: 'PAT-100', statement: 'dropped-type rule' })] });
    upsertConformanceRule.mockResolvedValue({ status: 'ok' });
    wireManagement();
    page('security');

    await openFlow(user, 'steering-add-open');
    await user.type(screen.getByTestId('steering-form-statement'), 'dropped-type rule');
    await user.click(screen.getByTestId('steering-form-save'));

    expect(await screen.findByTestId('steering-saved-note')).toHaveTextContent(
      /the server filed it under Architecture/,
    );
  });

  it('a refused save surfaces in the form instead of closing over it', async () => {
    const user = userEvent.setup();
    listConformanceRules.mockResolvedValue({ rules: [] });
    upsertConformanceRule.mockRejectedValue(new ApiError(400, 'INV-C2: confidence must be a number in [0,1]'));
    wireManagement();
    page('security');

    await openFlow(user, 'steering-add-open');
    await user.type(screen.getByTestId('steering-form-statement'), 'x');
    await user.click(screen.getByTestId('steering-form-save'));

    expect(await screen.findByTestId('steering-form-error')).toHaveTextContent(/INV-C2/);
    expect(screen.getByTestId('steering-rule-form')).toBeInTheDocument();
  });
});

describe('SteeringPage — edit', () => {
  it('pre-fills the form from the row, fixes the id, carries provenance through untouched', async () => {
    const user = userEvent.setup();
    const existing = rule({
      id: 'POL-300',
      rule_type: 'policy',
      statement: 'Old statement',
      steering_type: 'security',
      applies_to: ['gate'],
      weight: 1.2,
      provenance: { source: 'markdown', ref: 'docs/sec.md#POL-300', source_kinds: ['doc'] },
    });
    listConformanceRules.mockResolvedValue({ rules: [existing] });
    upsertConformanceRule.mockResolvedValue({ status: 'ok' });
    wireManagement();
    page('security');

    await user.click(await screen.findByTestId('steering-rule-row'));
    await screen.findByTestId('steering-rule-drawer');
    await user.click(await screen.findByTestId('steering-edit-open'));
    const form = await screen.findByTestId('steering-rule-form');
    expect(within(form).getByTestId('steering-form-id')).toHaveValue('POL-300');
    expect(within(form).getByTestId('steering-form-id')).toHaveAttribute('readonly');
    expect(within(form).getByTestId('steering-form-statement')).toHaveValue('Old statement');
    expect(within(form).getByTestId('steering-form-rule-type')).toBeDisabled();

    await user.clear(within(form).getByTestId('steering-form-statement'));
    await user.type(within(form).getByTestId('steering-form-statement'), 'New statement');
    await user.click(within(form).getByTestId('steering-form-save'));

    await waitFor(() => expect(upsertConformanceRule).toHaveBeenCalledTimes(1));
    expect(upsertConformanceRule).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'POL-300',
        statement: 'New statement',
        applies_to: ['gate'],
        // An edit never rewrites where a rule came from.
        provenance: { source: 'markdown', ref: 'docs/sec.md#POL-300', source_kinds: ['doc'] },
      }),
    );
  });
});

describe('SteeringPage — add with chat (the authoring run + its propose gate)', () => {
  it('POSTs instructions + documents with THIS page type, then renders the EXISTING gate card when the propose gate arrives', async () => {
    const user = userEvent.setup();
    listConformanceRules.mockResolvedValue({ rules: [] });
    confirmGate.mockResolvedValue({ status: 'ok' });
    let authorBody: unknown = null;
    wireManagement({
      '/governance/steering/author': (body) => {
        authorBody = body;
        return Promise.resolve({ runId: 'run-author-1' });
      },
    });
    page('compliance');

    await openFlow(user, 'steering-author-open');
    const panel = await screen.findByTestId('steering-author-panel');
    await user.type(
      within(panel).getByTestId('steering-author-instructions'),
      'Derive rules from the attached SOC2 doc',
    );
    await user.upload(
      within(panel).getByTestId('steering-author-files'),
      new File(['CC6.1 …'], 'soc2.md', { type: 'text/markdown' }),
    );
    expect(within(panel).getByTestId('steering-author-file-chip')).toHaveTextContent('soc2.md');
    await user.click(within(panel).getByTestId('steering-author-launch'));

    // Launched: the honest waiting state until the run actually asks.
    expect(await screen.findByTestId('steering-author-waiting')).toHaveTextContent(/run-auth/);
    expect(authorBody).toMatchObject({
      type: 'compliance',
      instructions: 'Derive rules from the attached SOC2 doc',
      documents: [{ name: 'soc2.md', content: 'CC6.1 …' }],
    });

    // The propose gate arrives as a normal awaitingHuman frame on the run — the app's one /ws
    // fold puts it in the gate store, and the panel renders the EXISTING SteeringGate card.
    act(() => {
      useGateStore.getState().ingest({
        type: 'awaitingHuman',
        session: 'run-author-1',
        ord: 1,
        prompt: 'Propose 3 compliance rules — approve to write them',
      } as never);
    });
    const gate = await screen.findByTestId('steering-gate');
    expect(gate).toHaveAttribute('data-run-id', 'run-author-1');
    expect(within(gate).getByTestId('steering-prompt')).toHaveTextContent(/Propose 3 compliance rules/);

    // Approving rides the same POST /runs/:id/gate as every gate, then the page reloads rules.
    await user.click(within(gate).getByTestId('steering-approve'));
    await waitFor(() => expect(confirmGate).toHaveBeenCalledWith('run-author-1', { approve: true }));
    await waitFor(() => expect(listConformanceRules).toHaveBeenCalledTimes(2));
  });

  it('a daemon without the author route gets the honest unsupported copy in-band', async () => {
    const user = userEvent.setup();
    listConformanceRules.mockResolvedValue({ rules: [] });
    wireManagement(); // no steering routes
    page('compliance');

    await openFlow(user, 'steering-author-open');
    await user.type(screen.getByTestId('steering-author-instructions'), 'anything');
    await user.click(screen.getByTestId('steering-author-launch'));

    expect(await screen.findByTestId('steering-author-unsupported')).toHaveTextContent(/predates steering management/);
    expect(screen.queryByTestId('steering-author-waiting')).toBeNull();
  });

  it('the launch button stays disabled with no instructions', async () => {
    const user = userEvent.setup();
    listConformanceRules.mockResolvedValue({ rules: [] });
    wireManagement();
    page('compliance');

    await openFlow(user, 'steering-author-open');
    expect(screen.getByTestId('steering-author-launch')).toBeDisabled();
  });
});
