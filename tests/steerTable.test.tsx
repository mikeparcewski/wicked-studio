import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { SteerSurface } from '../src/components/steer/SteerSurface.js';
import { filterSteeringRules, GRID_FACETS_DEFAULT, type GridFacets } from '../src/components/SteeringGrid.js';
import { ApiError } from '../src/api/errors.js';
import type { SteeringRule, SteeringType } from '../src/api/steering.js';
import type { WikiMeta, WikiScoreboard } from '../src/api/wiki.js';

/**
 * The Steer page's Table layout (studio#689 ruling b, studio#892): `?view=table` shows the one Steer
 * page's rules as the spreadsheet, under the page's one heading and filters — never a second rules page.
 * Moved here from the retired table page's suite, pinned on the page that now hosts the grid:
 *  - the grid carries the common columns; the id cell opens the page's own drawer (advanced fields,
 *    provenance, evidence), on the page's address;
 *  - the drawer's retire kill switch; seededness; the pure grid predicate and the import skip words.
 */

const listConformanceRules = vi.fn();
const retireConformanceRule = vi.fn();
const upsertConformanceRule = vi.fn();
const listClaims = vi.fn();
const apiFetch = vi.fn();

vi.mock('../src/api/client.js', () => ({
  api: {
    listConformanceRules: (...a: unknown[]) => listConformanceRules(...a),
    retireConformanceRule: (...a: unknown[]) => retireConformanceRule(...a),
    upsertConformanceRule: (...a: unknown[]) => upsertConformanceRule(...a),
    listClaims: (...a: unknown[]) => listClaims(...a),
  },
  apiFetch: (...a: unknown[]) => apiFetch(...a),
}));

const SHA = 'a'.repeat(40);

function rule(over: Partial<SteeringRule> = {}): SteeringRule {
  return {
    id: 'PAT-001',
    rule_type: 'pattern',
    statement: 'Never use printf without %s',
    severity: 'error',
    confidence: 0.9,
    targets: { layer: 'foundation' },
    provenance: { source: 'markdown', ref: `docs/agent-behavior.md@${SHA}#PAT-001`, source_kinds: ['doc'] },
    ...over,
  };
}

function scoreboard(over: Partial<WikiScoreboard> = {}): WikiScoreboard {
  return {
    rules_total: 3,
    rules_active: 2,
    rules_retired: 1,
    typing: {
      available: true,
      docs_scanned: 4,
      statements_total: 20,
      statements_typed: 18,
      percent: 90,
      by_class: { policy: 10, guidance: 8 },
      docs_untyped: [],
    },
    connection: { rules_with_ref: 3, refs_resolving: 3, refs_unresolvable: 0, percent: 100, rules_linked: 3 },
    evidence: {
      denial_claims: 2,
      rules_evidenced: 2,
      evidenced_by_edges: 2,
      governs_evidence_total: 5,
      per_rule: [{ rule_id: 'PAT-001', denial_claims: 3, governs_evidence: 7 }],
    },
    recall_volume: { available: false, reason: 'nothing writes recall telemetry yet' },
    ...over,
  };
}

/** Wire the scoreboard/meta reads; each is a thunk so a case can reject one independently. */
function wire(w: {
  scoreboard?: () => Promise<{ scoreboard: WikiScoreboard }>;
  meta?: () => Promise<{ meta: WikiMeta }>;
} = {}): void {
  const routeAbsent = (): Promise<never> => Promise.reject(new ApiError(404, 'Not Found'));
  apiFetch.mockImplementation((path: unknown) => {
    if (path === '/governance/wiki/scoreboard') return (w.scoreboard ?? routeAbsent)();
    if (path === '/governance/wiki/meta') return (w.meta ?? routeAbsent)();
    // The unified surface embeds the policy-proposals section — default it to an empty queue so
    // its review half renders "no proposals" quietly (its own wire is exercised elsewhere).
    if (String(path).startsWith('/proposals')) return Promise.resolve({ proposals: [] });
    return Promise.reject(new Error(`unexpected apiFetch path: ${String(path)}`));
  });
}

/** The page on a live address: a move (the id cell, the drawer's close) changes what it renders, as in the app. */
function Host({ start }: { start: string }): React.ReactElement {
  const [at, setAt] = useState(start);
  const u = new URL(at, 'http://studio.local');
  return <SteerSurface pathname={u.pathname} search={u.search} navigate={(p) => setAt(p)} runs={[]} />;
}
function page(search = '?view=table'): ReturnType<typeof render> {
  return render(<Host start={`/steering/policies${search}`} />);
}

beforeEach(() => {
  listConformanceRules.mockReset();
  retireConformanceRule.mockReset();
  upsertConformanceRule.mockReset();
  apiFetch.mockReset();
  listClaims.mockReset();
  listClaims.mockRejectedValue(new ApiError(404, 'not found'));
});

describe('filterSteeringRules — the page-scope + facet predicate, pinned', () => {
  const f = (over: Partial<GridFacets> = {}): GridFacets => ({ ...GRID_FACETS_DEFAULT, ...over });

  it('a rule belongs to exactly one page: its steering_type, absent = architecture', () => {
    const rules = [rule(), rule({ id: 'POL-100', steering_type: 'security' })];
    expect(filterSteeringRules(rules, 'architecture', f()).map((r) => r.id)).toEqual(['PAT-001']);
    expect(filterSteeringRules(rules, 'security', f()).map((r) => r.id)).toEqual(['POL-100']);
    expect(filterSteeringRules(rules, 'testing', f())).toHaveLength(0);
  });

  it('an out-of-enum steering_type folds to architecture rather than vanishing from all pages', () => {
    const odd = rule({ id: 'PAT-009', steering_type: 'not-a-type' as unknown as SteeringType });
    expect(filterSteeringRules([odd], 'architecture', f()).map((r) => r.id)).toEqual(['PAT-009']);
  });

  it('include_retired keeps retired rows listed (default) and hides them when off; severity + query compose', () => {
    const rules = [
      rule(),
      rule({ id: 'PAT-002', severity: 'warn', retired: true }),
      rule({ id: 'POL-100', rule_type: 'policy', statement: 'No secrets in logs', severity: 'critical' }),
    ];
    // include_retired defaults TRUE — retire never silently hides a row it just dimmed.
    expect(filterSteeringRules(rules, 'architecture', f()).map((r) => r.id)).toEqual(['PAT-001', 'PAT-002', 'POL-100']);
    expect(filterSteeringRules(rules, 'architecture', f({ includeRetired: false })).map((r) => r.id)).toEqual(['PAT-001', 'POL-100']);
    expect(filterSteeringRules(rules, 'architecture', f({ severity: 'critical' })).map((r) => r.id)).toEqual(['POL-100']);
    // The search facet matches id OR statement, case-insensitively.
    expect(filterSteeringRules(rules, 'architecture', f({ query: 'secrets' })).map((r) => r.id)).toEqual(['POL-100']);
    expect(filterSteeringRules(rules, 'architecture', f({ query: 'pat-002' })).map((r) => r.id)).toEqual(['PAT-002']);
  });
});

describe('Table layout — the grid + the drawer', () => {
  it('rows carry the common columns; the ADVANCED fields (effect) live in the drawer only', async () => {
    listConformanceRules.mockResolvedValue({
      rules: [
        rule({ id: 'PAT-001', weight: 1.5, effect: 'deny', trigger: { contains: 'DROP TABLE' } }),
        rule({ id: 'PAT-002', statement: 'recall-only rule' }),
        rule({ id: 'PAT-003', statement: 'engine-default weight', weight: 1.0 }),
      ],
    });
    wire();
    page();

    const rows = await screen.findAllByTestId('steering-grid-row');
    // Weight is a COLUMN now: the stored value renders, and a wire that predates weights
    // shows the engine default (1) rather than pretending the field is empty.
    expect(within(rows[0]!).getByTestId('steering-cell-weight')).toHaveTextContent('1.5');
    expect(within(rows[1]!).getByTestId('steering-cell-weight')).toHaveTextContent('1');
    expect(within(rows[2]!).getByTestId('steering-cell-weight')).toHaveTextContent('1');
    // The grid carries the COMMON columns only: no effect badge inline — it renders in the drawer.
    expect(within(rows[0]!).queryByTestId('steering-effect-badge')).toBeNull();
    // Nothing renders open by default: no drawer, no forms, no draft row.
    expect(screen.queryByTestId('steering-rule-drawer')).toBeNull();
    expect(screen.queryByTestId('steering-rule-form')).toBeNull();
    expect(screen.queryByTestId('steering-grid-draft')).toBeNull();
  });

  it('the ID CELL opens the drawer joining applies_to/excludes, weight, effect+trigger, provenance path@sha, and evidence', async () => {
    const user = userEvent.setup();
    listConformanceRules.mockResolvedValue({
      rules: [rule({
        applies_to: ['build', 'review'],
        excludes: ['chat'],
        weight: 2,
        effect: 'allow_with_conditions',
        trigger: { contains: 'migration' },
        obligations: ['record evidence'],
        criteria: 'the gate criteria text',
      })],
    });
    wire({ scoreboard: () => Promise.resolve({ scoreboard: scoreboard() }) });
    page();

    await user.click(await screen.findByTestId('steering-grid-id'));
    const drawer = await screen.findByTestId('steering-rule-drawer');
    expect(within(drawer).getByTestId('steering-rule-detail')).toBeInTheDocument();
    expect(within(drawer).getByTestId('steering-rule-statement')).toHaveTextContent('Never use printf without %s');
    expect(within(drawer).getByTestId('steering-rule-applies')).toHaveTextContent('build');
    expect(within(drawer).getByTestId('steering-rule-applies')).toHaveTextContent('review');
    expect(within(drawer).getByTestId('steering-rule-excludes')).toHaveTextContent('chat');
    expect(within(drawer).getByTestId('steering-rule-weight')).toHaveTextContent('2');
    expect(within(drawer).getByTestId('steering-rule-effect')).toHaveTextContent(/allow\+cond/);
    expect(within(drawer).getByTestId('steering-rule-effect')).toHaveTextContent(/migration/);
    expect(within(drawer).getByTestId('steering-effect-badge')).toHaveAttribute('data-effect', 'allow_with_conditions');
    expect(within(drawer).getByTestId('steering-rule-obligations')).toHaveTextContent('record evidence');
    expect(within(drawer).getByTestId('steering-rule-criteria')).toHaveTextContent('the gate criteria text');
    expect(within(drawer).getByTestId('steering-rule-provenance')).toHaveTextContent(`docs/agent-behavior.md@${SHA.slice(0, 12)}`);
    expect(within(drawer).getByTestId('steering-rule-source-uri')).toHaveTextContent(`docs/agent-behavior.md@${SHA}#PAT-001`);
    expect(within(drawer).getByTestId('steering-rule-evidence')).toHaveTextContent('3 denial claims · 7 governs evidence');

    // The ✕ closes it.
    await user.click(within(drawer).getByTestId('steering-drawer-close'));
    expect(screen.queryByTestId('steering-rule-drawer')).toBeNull();
  });

  it('renders honest defaults in the drawer when the wire predates the unified fields', async () => {
    const user = userEvent.setup();
    listConformanceRules.mockResolvedValue({ rules: [rule()] });
    wire(); // no scoreboard either — the evidence join has no producer
    page();

    await user.click(await screen.findByTestId('steering-grid-id'));
    const drawer = await screen.findByTestId('steering-rule-drawer');
    expect(within(drawer).getByTestId('steering-rule-applies')).toHaveTextContent('—');
    expect(within(drawer).getByTestId('steering-rule-excludes')).toHaveTextContent('—');
    expect(within(drawer).getByTestId('steering-rule-weight')).toHaveTextContent(/engine default 1\.0/);
    expect(within(drawer).getByTestId('steering-rule-effect')).toHaveTextContent('recall-only');
    expect(within(drawer).getByTestId('steering-rule-evidence')).toHaveTextContent('—');
  });

  it('ui and chat provenance are first-class — named, never a dash', async () => {
    const user = userEvent.setup();
    listConformanceRules.mockResolvedValue({
      rules: [
        rule({ id: 'PAT-010', provenance: { source: 'ui', source_kinds: ['doc'] } }),
        rule({ id: 'PAT-011', provenance: { source: 'chat', source_kinds: ['doc'] } }),
      ],
    });
    wire();
    page();

    const cells = await screen.findAllByTestId('steering-grid-id');
    await user.click(cells[0]!);
    expect(within(await screen.findByTestId('steering-rule-drawer')).getByTestId('steering-provenance-ui'))
      .toHaveTextContent('authored in studio (ui)');
    // Selecting the second row swaps the drawer to it.
    await user.click(cells[1]!);
    await waitFor(() =>
      expect(within(screen.getByTestId('steering-rule-drawer')).getByTestId('steering-provenance-chat'))
        .toHaveTextContent('authored by the chat run (chat)'),
    );
  });

  it('flags a legacy digest-less ref as needing re-ingest instead of inventing a sha', async () => {
    const user = userEvent.setup();
    listConformanceRules.mockResolvedValue({
      rules: [rule({ provenance: { source: 'markdown', ref: 'docs/a.md#PAT-001', source_kinds: ['doc'] } })],
    });
    wire();
    page();

    await user.click(await screen.findByTestId('steering-grid-id'));
    expect(await screen.findByTestId('steering-rule-provenance')).toHaveTextContent(/no digest — re-ingest/);
  });
});

describe('Table layout — the retire kill switch (opened from the drawer)', () => {
  async function openModal(user: ReturnType<typeof userEvent.setup>): Promise<void> {
    await user.click(await screen.findByTestId('steering-grid-id'));
    await user.click(await screen.findByTestId('steering-retire-open'));
    await screen.findByTestId('steering-retire-modal');
  }

  it('stays disarmed until the EXACT rule id is typed AND a reason is given', async () => {
    const user = userEvent.setup();
    listConformanceRules.mockResolvedValue({ rules: [rule()] });
    wire();
    page();
    await openModal(user);

    const confirm = screen.getByTestId('steering-retire-confirm');
    expect(confirm).toBeDisabled();

    await user.type(screen.getByTestId('steering-retire-confirm-input'), 'PAT-00'); // wrong id
    await user.type(screen.getByTestId('steering-retire-reason'), 'superseded by PAT-050');
    expect(confirm).toBeDisabled();

    await user.type(screen.getByTestId('steering-retire-confirm-input'), '1'); // now exact
    expect(confirm).toBeEnabled();
    expect(retireConformanceRule).not.toHaveBeenCalled();
  });

  it('fires the existing retire wire, reloads for the server state, and echoes the reason', async () => {
    const user = userEvent.setup();
    listConformanceRules
      .mockResolvedValueOnce({ rules: [rule()] })
      .mockResolvedValueOnce({ rules: [rule({ retired: true })] });
    retireConformanceRule.mockResolvedValue({ status: 'retired', id: 'PAT-001' });
    wire();
    page();
    await openModal(user);

    await user.type(screen.getByTestId('steering-retire-confirm-input'), 'PAT-001');
    await user.type(screen.getByTestId('steering-retire-reason'), 'superseded by PAT-050');
    await user.click(screen.getByTestId('steering-retire-confirm'));

    await waitFor(() => expect(retireConformanceRule).toHaveBeenCalledWith('PAT-001'));
    // The row shows the SERVER's state, never this surface's optimism.
    await waitFor(() => expect(listConformanceRules).toHaveBeenCalledTimes(2));
    // Retired, it leaves the Active rows; the page's note echoes the reason.
    await waitFor(() => expect(screen.queryByTestId('steering-grid-row')).toBeNull());
    expect(screen.getByTestId('steering-saved-note')).toHaveTextContent('superseded by PAT-050');
    expect(screen.queryByTestId('steering-retire-modal')).toBeNull();
  });

  it('surfaces a failed retire in the modal instead of silently leaving the rule enforcing', async () => {
    const user = userEvent.setup();
    listConformanceRules.mockResolvedValue({ rules: [rule()] });
    retireConformanceRule.mockRejectedValue(new ApiError(404, 'unknown rule: PAT-001'));
    wire();
    page();
    await openModal(user);

    await user.type(screen.getByTestId('steering-retire-confirm-input'), 'PAT-001');
    await user.type(screen.getByTestId('steering-retire-reason'), 'gone already');
    await user.click(screen.getByTestId('steering-retire-confirm'));

    expect(await screen.findByTestId('steering-retire-error')).toHaveTextContent(/unknown rule/);
    expect(screen.getByTestId('steering-retire-modal')).toBeInTheDocument();
    expect(listConformanceRules).toHaveBeenCalledTimes(1);
  });

  it('offers neither retire nor edit on an already-retired rule', async () => {
    const user = userEvent.setup();
    listConformanceRules.mockResolvedValue({ rules: [rule({ retired: true })] });
    wire();
    page();

    // A retired rule is under Retired (the ⋯ menu), in the Table layout too: the row is there, struck.
    await screen.findByTestId('steering-rule-grid');
    expect(screen.queryByTestId('steering-grid-row')).toBeNull();
    await user.click(screen.getByTestId('steer-more-button'));
    await user.click(screen.getByTestId('steer-view-retired'));
    expect(await screen.findByTestId('steering-grid-row')).toHaveAttribute('data-retired', 'true');
    await user.click(screen.getByTestId('steering-grid-id'));
    await screen.findByTestId('steering-rule-drawer');
    expect(screen.queryByTestId('steering-retire-open')).toBeNull();
    expect(screen.queryByTestId('steering-edit-open')).toBeNull();
    expect(screen.getByTestId('steering-rule-retired-note')).toHaveTextContent(/withdrawn from recall/);
  });
});

describe('Table layout — seededness', () => {
  it('meta seeded:false + an empty store says so, and Add a rule still opens the grid’s first row', async () => {
    const user = userEvent.setup();
    listConformanceRules.mockResolvedValue({ rules: [] });
    wire({ meta: () => Promise.resolve({ meta: { seeded: false } }) });
    page();
    expect(await screen.findByTestId('steering-unseeded')).toHaveTextContent('No steering rules yet.');
    await user.click(screen.getByTestId('steer-more-button'));
    await user.click(screen.getByTestId('steer-add-rule'));
    expect(await screen.findByTestId('steering-grid-draft')).toBeInTheDocument();
  });

  it('a daemon that cannot answer meta is never accused of an unseeded store', async () => {
    listConformanceRules.mockResolvedValue({ rules: [] });
    wire();
    page();
    expect(await screen.findByTestId('steering-rule-grid')).toBeInTheDocument();
    expect(screen.queryByTestId('steering-unseeded')).toBeNull();
  });
});

describe('plainSkip (studio#689 row 49, studio#934)', () => {
  it('says why an import entry was skipped in plain words first, then the service’s own reason', async () => {
    const { plainSkip } = await import('../src/board/steerImport.js');
    expect(plainSkip(1, 'INV-S3: steering rule "POL-301" carries an effect but no non-blank applies_to entry')).toBe(
      'Rule 2 skipped: it doesn’t say where it applies. Studio’s service said: steering rule "POL-301" carries an effect but no non-blank applies_to entry.',
    );
    // ui-v3 integration: #934 shows the service's reason, #689 row 49 keeps the invariant code out of it.
    expect(plainSkip(1, 'INV-C1: rule id must not be blank')).toBe('Rule 2 skipped: it has no id. Studio’s service said: rule id must not be blank.');
  });

  it('never swallows a reason it has no plain words for (studio#934)', async () => {
    const { plainSkip } = await import('../src/board/steerImport.js');
    expect(plainSkip(0, 'something odd')).toBe('Rule 1 skipped. Studio’s service said: something odd.');
    expect(plainSkip(0, '')).toBe('Rule 1 skipped. Studio’s service gave no reason.');
  });
});
