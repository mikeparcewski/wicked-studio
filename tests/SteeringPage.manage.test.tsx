import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SteeringPage } from '../src/components/SteeringPage.js';
import { ApiError } from '../src/api/errors.js';
import type { SteeringRule, SteeringType } from '../src/api/steering.js';
import { useGateStore } from '../src/store/gates.js';

/**
 * The Steering surface's MANAGEMENT flows after the SPREADSHEET wave — the type always inferred
 * from the page and every wire unchanged, but the SURFACES moved:
 *  - the Add ▾ menu collapsed to TWO entries: "Add row" (the grid's draft row — the individual
 *    form's add flow died with the modal) and "Open assistant" (the dock);
 *  - IMPORT folded into the dock: attach a .md/.json → "Import directly" POSTs
 *    `/governance/steering/import` with this page's type; per-entry results echo into the
 *    thread as narration notes (the ENGINE's `imported`/`rejected` vocabulary, ids included);
 *    a 501/route-absent daemon gets the honest unsupported copy, never a raw refusal;
 *  - ADD ROW: the grid's draft row builds the unified rule (manual id under the steering-scoped
 *    INV-C1, chips, weight), stamps provenance source "ui", POSTs the SHIPPING upsert CRUD, and
 *    reloads for the server's state — including the honesty note when an older engine drops
 *    steering_type and files the rule under the serde default;
 *  - EDIT: the modal form pre-filled (opened from the DRAWER), id fixed, provenance carried
 *    through untouched — the one place the ADVANCED effect/trigger fields are edited;
 *  - ADD WITH CHAT: a typed dock message POSTs `/governance/steering/author`
 *    ({instructions, type, documents}) and the run narrates inline; the PROPOSE gate arrives as
 *    a normal awaitingHuman frame and renders through the EXISTING SteeringGate card pinned
 *    INSIDE the dock (the ApprovalDock chatId entry point); approving it is what writes rules.
 */

const listConformanceRules = vi.fn();
const retireConformanceRule = vi.fn();
const upsertConformanceRule = vi.fn();
const confirmGate = vi.fn();
const cancelRun = vi.fn();
const getRun = vi.fn();
const apiFetch = vi.fn();

vi.mock('../src/api/client.js', () => ({
  api: {
    listConformanceRules: (...a: unknown[]) => listConformanceRules(...a),
    retireConformanceRule: (...a: unknown[]) => retireConformanceRule(...a),
    upsertConformanceRule: (...a: unknown[]) => upsertConformanceRule(...a),
    confirmGate: (...a: unknown[]) => confirmGate(...a),
    cancelRun: (...a: unknown[]) => cancelRun(...a),
    getRun: (...a: unknown[]) => getRun(...a),
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

/** Attach one file through the dock's picker (drag/drop shares the same onFiles fold). */
async function attach(user: ReturnType<typeof userEvent.setup>, file: File): Promise<void> {
  await user.upload(screen.getByTestId('assist-attach'), file);
}

async function typeMessage(user: ReturnType<typeof userEvent.setup>, text: string): Promise<void> {
  await user.type(screen.getByTestId('assist-input'), text);
}

beforeEach(() => {
  listConformanceRules.mockReset();
  retireConformanceRule.mockReset();
  upsertConformanceRule.mockReset();
  confirmGate.mockReset();
  cancelRun.mockReset();
  getRun.mockReset();
  // The dock's run block hydrates via GET /runs/:id — absent in this rig, the block keeps
  // its honest "launched" line (exactly the daemon-restart posture).
  getRun.mockRejectedValue(new ApiError(404, 'no run snapshot in this rig'));
  apiFetch.mockReset();
  useGateStore.setState({ gates: {}, approaching: {} });
  try { localStorage.clear(); } catch { /* jsdom always has it */ }
});

describe('SteeringPage — the ONE Add menu (two entries now)', () => {
  it('lists Add row + Open assistant; Add row opens the grid draft, nothing else renders by default', async () => {
    const user = userEvent.setup();
    listConformanceRules.mockResolvedValue({ rules: [] });
    wireManagement();
    page('security');

    // Closed by default: no draft row, no menu list, no edit modal.
    await screen.findByTestId('steering-add-menu');
    expect(screen.queryByTestId('steering-add-menu-list')).toBeNull();
    expect(screen.queryByTestId('steering-grid-draft')).toBeNull();
    expect(screen.queryByTestId('steering-rule-form')).toBeNull();

    await user.click(screen.getByTestId('steering-add-menu'));
    const menu = await screen.findByTestId('steering-add-menu-list');
    expect(within(menu).getByTestId('steering-add-open')).toBeInTheDocument();
    expect(within(menu).getByTestId('steering-assist-open')).toBeInTheDocument();
    // The retired flows are GONE from the menu — they live in the dock now.
    expect(within(menu).queryByTestId('steering-import-open')).toBeNull();
    expect(within(menu).queryByTestId('steering-author-open')).toBeNull();

    // Add row → the grid's editable draft row (the modal form's add flow died).
    await user.click(within(menu).getByTestId('steering-add-open'));
    expect(await screen.findByTestId('steering-grid-draft')).toBeInTheDocument();
    expect(screen.queryByTestId('steering-add-menu-list')).toBeNull();
    expect(screen.queryByTestId('steering-rule-form')).toBeNull();
  });

  it('Open assistant expands a collapsed dock', async () => {
    const user = userEvent.setup();
    listConformanceRules.mockResolvedValue({ rules: [] });
    wireManagement();
    try { localStorage.setItem('wicked.assist.steering.open', 'false'); } catch { /* set */ }
    page('security');

    // Collapsed: the rail renders, the panel does not.
    expect(await screen.findByTestId('assist-dock-rail')).toBeInTheDocument();
    expect(screen.queryByTestId('assist-dock')).toBeNull();

    await user.click(screen.getByTestId('steering-add-menu'));
    await user.click(await screen.findByTestId('steering-assist-open'));
    expect(await screen.findByTestId('assist-dock')).toBeInTheDocument();
  });
});

describe('SteeringPage — import (through the dock, the wire unchanged)', () => {
  it('attaching a .md offers the fork; Import directly POSTs THIS page type and echoes per-entry results', async () => {
    const user = userEvent.setup();
    listConformanceRules.mockResolvedValue({ rules: [] });
    let importBody: unknown = null;
    wireManagement({
      '/governance/steering/import': (body) => {
        importBody = body;
        // The ENGINE's per-entry vocabulary (wicked-core-ts SteeringEntryResult): a doc entry
        // can mint several rules, so success carries ids[].
        return Promise.resolve({
          results: [
            { index: 0, name: 'security-rules.md', status: 'imported', ids: ['POL-201', 'POL-202'] },
          ],
          imported: 1,
          rejected: 0,
        });
      },
    });
    page('security');

    await attach(user, new File(['# doctrine\n'], 'security-rules.md', { type: 'text/markdown' }));
    const chip = await screen.findByTestId('assist-attachment-chip');
    // Rule-shaped file → the FORK is offered.
    expect(within(chip).getByTestId('assist-import-now')).toBeInTheDocument();
    expect(within(chip).getByTestId('assist-analyze')).toBeInTheDocument();

    await user.click(within(chip).getByTestId('assist-import-now'));

    await waitFor(() => expect(importBody).not.toBeNull());
    expect(importBody).toMatchObject({
      type: 'security',
      entries: [{ kind: 'doc', name: 'security-rules.md', content: '# doctrine\n' }],
    });
    // The results echo into the THREAD as narration notes — summary + per-entry lines.
    const notes = await screen.findAllByTestId('assist-note');
    const texts = notes.map((n) => n.textContent ?? '');
    expect(texts.some((t) => t.includes('security-rules.md: 1 of 1 entry imported.'))).toBe(true);
    expect(texts.some((t) => t.includes('imported POL-201, POL-202'))).toBe(true);
    // Something may have landed — the grid reloads for the server's state.
    await waitFor(() => expect(listConformanceRules).toHaveBeenCalledTimes(2));
    // The chip is consumed by the import.
    expect(screen.queryByTestId('assist-attachment-chip')).toBeNull();
  });

  it('a rejected entry echoes as a FAIL note with the engine reason — a half-good batch reports honestly', async () => {
    const user = userEvent.setup();
    listConformanceRules.mockResolvedValue({ rules: [] });
    wireManagement({
      '/governance/steering/import': () =>
        Promise.resolve({
          results: [
            { index: 0, status: 'imported', ids: ['SEC-9'] },
            { index: 1, status: 'rejected', error: 'INV-C1: rule id must not be blank' },
          ],
          imported: 1,
          rejected: 1,
        }),
    });
    page('testing');

    await attach(user, new File(['[{"id":"SEC-9"},{}]'], 'batch.JSON', { type: 'application/json' }));
    await user.click(await screen.findByTestId('assist-import-now'));

    const notes = await screen.findAllByTestId('assist-note');
    const fails = notes.filter((n) => n.getAttribute('data-tone') === 'fail');
    expect(fails.some((n) => (n.textContent ?? '').includes('INV-C1'))).toBe(true);
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

    await attach(user, new File(['[{"id":"SEC-9"}]'], 'batch.JSON', { type: 'application/json' }));
    await user.click(await screen.findByTestId('assist-import-now'));
    await waitFor(() =>
      expect(importBody).toMatchObject({ type: 'testing', entries: [{ kind: 'rule', rule: { id: 'SEC-9' } }] }),
    );
  });

  it('a 501/route-absent daemon gets the honest unsupported copy, never a raw refusal', async () => {
    const user = userEvent.setup();
    listConformanceRules.mockResolvedValue({ rules: [] });
    wireManagement(); // the steering routes do not exist on this daemon
    page('security');

    await attach(user, new File(['x'], 'a.md', { type: 'text/markdown' }));
    await user.click(await screen.findByTestId('assist-import-now'));

    const notes = await screen.findAllByTestId('assist-note');
    expect(notes.some((n) => /predates steering management/.test(n.textContent ?? ''))).toBe(true);
  });

  it('a plain (non rule-shaped) file attaches for analysis — no fork offered', async () => {
    const user = userEvent.setup();
    listConformanceRules.mockResolvedValue({ rules: [] });
    wireManagement();
    page('security');

    await attach(user, new File(['col,val'], 'metrics.csv', { type: 'text/csv' }));
    const chip = await screen.findByTestId('assist-attachment-chip');
    expect(chip).toHaveAttribute('data-mode', 'analyze');
    expect(within(chip).queryByTestId('assist-import-now')).toBeNull();
  });
});

describe('SteeringPage — the grid draft row (the add flow)', () => {
  it('prefills the next free id (still fully manual), builds the unified rule with provenance "ui", and saves', async () => {
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

    await screen.findByTestId('steering-grid-row');
    await user.click(screen.getByTestId('steering-grid-add'));
    const draft = await screen.findByTestId('steering-grid-draft');
    // The suggested id follows the loaded corpus: max PAT ordinal + 1 — and stays editable.
    expect(within(draft).getByTestId('steering-draft-id')).toHaveValue('PAT-105');

    await user.type(within(draft).getByTestId('steering-draft-statement'), 'New secrets rule');
    await user.selectOptions(within(draft).getByTestId('steering-draft-severity'), 'critical');
    await user.click(within(draft).getByTestId('steering-draft-applies'));
    await user.type(within(draft).getByTestId('steering-draft-applies-input'), 'build{Enter}review{Enter}{Enter}');
    await user.click(within(draft).getByTestId('steering-draft-excludes'));
    await user.type(within(draft).getByTestId('steering-draft-excludes-input'), 'chat{Enter}{Enter}');
    const weight = within(draft).getByTestId('steering-draft-weight');
    await user.clear(weight);
    await user.type(weight, '2.5');
    await user.click(within(draft).getByTestId('steering-draft-save'));

    await waitFor(() => expect(upsertConformanceRule).toHaveBeenCalledTimes(1));
    expect(upsertConformanceRule).toHaveBeenCalledWith({
      id: 'PAT-105',
      rule_type: 'pattern',
      statement: 'New secrets rule',
      severity: 'critical',
      confidence: 0.9,
      targets: {},
      provenance: { source: 'ui', source_kinds: ['doc'] },
      steering_type: 'security', // defaulted from the page, editable in the draft's type cell
      applies_to: ['build', 'review'],
      excludes: ['chat'],
      weight: 2.5,
    });
    // The draft clears, the grid reloads for the server's state, and the save is confirmed.
    expect(await screen.findByTestId('steering-saved-note')).toHaveTextContent('Saved PAT-105.');
    expect(screen.queryByTestId('steering-grid-draft')).toBeNull();
    const rows = screen.getAllByTestId('steering-grid-row');
    expect(rows.map((r) => r.getAttribute('data-rule-id'))).toContain('PAT-105');
  });

  it('the draft grid never invents effect/trigger — a saved row is recall-only (advanced fields live in the drawer)', async () => {
    const user = userEvent.setup();
    listConformanceRules.mockResolvedValue({ rules: [] });
    upsertConformanceRule.mockResolvedValue({ status: 'ok' });
    wireManagement();
    page('operations');

    await user.click(await screen.findByTestId('steering-grid-add'));
    await user.type(screen.getByTestId('steering-draft-statement'), 'Runbooks live in ops/');
    await user.click(screen.getByTestId('steering-draft-save'));

    await waitFor(() => expect(upsertConformanceRule).toHaveBeenCalledTimes(1));
    const sent = upsertConformanceRule.mock.calls[0]![0] as Record<string, unknown>;
    expect(sent).not.toHaveProperty('effect');
    expect(sent).not.toHaveProperty('trigger');
    expect(sent).toMatchObject({ steering_type: 'operations', weight: 1 });
  });

  it('surfaces the reserved PAT-/POL- namespace rule on a bad manual id; a custom id outside it is legal', async () => {
    const user = userEvent.setup();
    listConformanceRules.mockResolvedValue({ rules: [] });
    wireManagement();
    page('security');

    await user.click(await screen.findByTestId('steering-grid-add'));
    const save = screen.getByTestId('steering-draft-save');
    expect(save).toBeDisabled(); // empty statement

    await user.type(screen.getByTestId('steering-draft-statement'), 'x');
    expect(save).toBeEnabled();

    const id = screen.getByTestId('steering-draft-id');
    await user.clear(id);
    await user.type(id, 'POL-1'); // inside the reserved namespace AND too short
    expect(save).toBeDisabled();
    expect(screen.getByTestId('steering-draft-issue')).toHaveTextContent(/reserved doc-ingest namespace/);

    // Outside the namespace, the engine's INV-C1 asks only "non-blank" — legal.
    await user.clear(id);
    await user.type(id, 'SEC-CUSTOM-1');
    expect(screen.queryByTestId('steering-draft-issue')).toBeNull();
    expect(save).toBeEnabled();
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

    await user.click(await screen.findByTestId('steering-grid-add'));
    await user.type(screen.getByTestId('steering-draft-statement'), 'dropped-type rule');
    await user.click(screen.getByTestId('steering-draft-save'));

    expect(await screen.findByTestId('steering-saved-note')).toHaveTextContent(
      /the server filed it under Architecture/,
    );
  });

  it('a refused save surfaces at the draft row instead of clearing it', async () => {
    const user = userEvent.setup();
    listConformanceRules.mockResolvedValue({ rules: [] });
    upsertConformanceRule.mockRejectedValue(new ApiError(400, 'INV-C2: confidence must be a number in [0,1]'));
    wireManagement();
    page('security');

    await user.click(await screen.findByTestId('steering-grid-add'));
    await user.type(screen.getByTestId('steering-draft-statement'), 'x');
    await user.click(screen.getByTestId('steering-draft-save'));

    expect(await screen.findByTestId('steering-draft-error')).toHaveTextContent(/INV-C2/);
    expect(screen.getByTestId('steering-grid-draft')).toBeInTheDocument();
  });
});

describe('SteeringPage — edit (the drawer’s modal, unchanged wires)', () => {
  it('pre-fills the form from the rule, fixes the id, carries provenance through untouched', async () => {
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

    await user.click(await screen.findByTestId('steering-grid-id'));
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

describe('SteeringPage — add with chat (the dock message → the authoring run + its propose gate)', () => {
  it('POSTs instructions + analysis documents with THIS page type, then pins the EXISTING gate card in the dock', async () => {
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

    const dock = await screen.findByTestId('assist-dock');
    await attach(user, new File(['CC6.1 …'], 'soc2.md', { type: 'text/markdown' }));
    // Rule-shaped file: pick the ANALYZE side of the fork — it rides the send as documents[].
    await user.click(await screen.findByTestId('assist-analyze'));
    expect(screen.getByTestId('assist-attachment-chip')).toHaveAttribute('data-mode', 'analyze');

    await typeMessage(user, 'Derive rules from the attached SOC2 doc');
    await user.click(screen.getByTestId('assist-send'));

    // Launched: the run block renders with its honest waiting line until events arrive.
    const runBlock = await screen.findByTestId('assist-run');
    expect(runBlock).toHaveAttribute('data-run-id', 'run-author-1');
    expect(within(runBlock).getByTestId('assist-run-waiting')).toBeInTheDocument();
    expect(authorBody).toMatchObject({
      type: 'compliance',
      instructions: 'Derive rules from the attached SOC2 doc',
      documents: [{ name: 'soc2.md', content: 'CC6.1 …' }],
    });

    // The propose gate arrives as a normal awaitingHuman frame on the run — the app's one /ws
    // fold puts it in the gate store, and the dock's PINNED ApprovalDock renders the EXISTING
    // SteeringGate card (never a second gate UI).
    act(() => {
      useGateStore.getState().ingest({
        type: 'awaitingHuman',
        session: 'run-author-1',
        ord: 1,
        prompt: 'Propose 3 compliance rules — approve to write them',
      } as never);
    });
    const gate = await within(dock).findByTestId('steering-gate');
    expect(gate).toHaveAttribute('data-run-id', 'run-author-1');
    expect(within(gate).getByTestId('steering-prompt')).toHaveTextContent(/Propose 3 compliance rules/);
    // Structural: the gate is OUTSIDE the thread scroll region — pinned, it can never scroll away.
    expect(screen.getByTestId('assist-thread').contains(gate)).toBe(false);

    // Approving rides the same POST /runs/:id/gate as every gate, then the page reloads rules.
    await user.click(within(gate).getByTestId('steering-approve'));
    await waitFor(() => expect(confirmGate).toHaveBeenCalledWith('run-author-1', { approve: true }));
    await waitFor(() => expect(listConformanceRules).toHaveBeenCalledTimes(2));
  });

  it('a daemon without the author route gets the honest unsupported copy in-thread', async () => {
    const user = userEvent.setup();
    listConformanceRules.mockResolvedValue({ rules: [] });
    wireManagement(); // no steering routes
    page('compliance');

    await typeMessage(user, 'anything');
    await user.click(screen.getByTestId('assist-send'));

    const notes = await screen.findAllByTestId('assist-note');
    expect(notes.some((n) => /predates steering management/.test(n.textContent ?? ''))).toBe(true);
    expect(screen.queryByTestId('assist-run')).toBeNull();
  });

  it('the send button stays disabled with no text', async () => {
    listConformanceRules.mockResolvedValue({ rules: [] });
    wireManagement();
    page('compliance');

    await screen.findByTestId('assist-dock');
    expect(screen.getByTestId('assist-send')).toBeDisabled();
  });
});
