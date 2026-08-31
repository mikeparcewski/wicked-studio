import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SteeringPage, filterSteeringRules } from '../src/components/SteeringPage.js';
import { ApiError } from '../src/api/errors.js';
import type { SteeringRule, SteeringType } from '../src/api/steering.js';
import type { WikiMeta, WikiScoreboard } from '../src/api/wiki.js';

/**
 * The Steering surface (`/steering/:type`) — the read side, demo-able entirely off mocked wire
 * payloads. Pinned here (carrying the WikiPage pins forward onto the unified model):
 *  - ONE component, parameterized by type: the same render scopes to the page's steering_type,
 *    with absent `steering_type` folding to architecture (the engine's serde default);
 *  - the sub-page strip navigates between the seven types;
 *  - the health header renders the AW-23 raw signals; PER-TYPE numbers when the wire serves
 *    `by_steering_type`, the store-wide numbers LABELED store-wide when it does not; a 501 is
 *    the honest adoption state, never an error card;
 *  - `meta.seeded === false` + an empty store is the unseeded state (seed command shown), and a
 *    daemon that cannot answer meta is never accused of an unseeded store; an empty TYPE on a
 *    populated store names the management flows instead;
 *  - the rules browser facets client-side; rows carry weight + effect badges; detail joins
 *    applies_to/excludes, provenance (path@sha for doc-ingested, ui/chat first-class), and
 *    evidence — each honest when its producer is not served;
 *  - retire takes a TYPED confirmation + required reason over the shipping DELETE wire, reloads
 *    for the server's state, and surfaces failure instead of pretending.
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
    return Promise.reject(new Error(`unexpected apiFetch path: ${String(path)}`));
  });
}

function page(type: SteeringType = 'architecture', navigate: (p: string) => void = () => {}): ReturnType<typeof render> {
  return render(<SteeringPage type={type} navigate={navigate} />);
}

beforeEach(() => {
  listConformanceRules.mockReset();
  retireConformanceRule.mockReset();
  upsertConformanceRule.mockReset();
  apiFetch.mockReset();
});

describe('SteeringPage — one component, parameterized by type', () => {
  const corpus = [
    rule(), // no steering_type → architecture (the serde default)
    rule({ id: 'PAT-002', statement: 'Pin the fetch boundary', steering_type: 'architecture' }),
    rule({ id: 'POL-100', rule_type: 'policy', statement: 'No secrets in logs', steering_type: 'security', severity: 'critical' }),
  ];

  it('scopes the browser to the page type; absent steering_type folds to architecture', async () => {
    listConformanceRules.mockResolvedValue({ rules: corpus });
    wire();
    const { unmount } = page('architecture');

    const rows = await screen.findAllByTestId('steering-rule-row');
    expect(rows.map((r) => r.getAttribute('data-rule-id'))).toEqual(['PAT-001', 'PAT-002']);
    expect(screen.getByTestId('steering-page')).toHaveAttribute('data-steering-type', 'architecture');
    unmount();

    page('security');
    const secRows = await screen.findAllByTestId('steering-rule-row');
    expect(secRows.map((r) => r.getAttribute('data-rule-id'))).toEqual(['POL-100']);
  });

  it('an empty TYPE on a populated store names the management flows, never "unseeded"', async () => {
    listConformanceRules.mockResolvedValue({ rules: corpus });
    wire({ meta: () => Promise.resolve({ meta: { seeded: true } }) });
    page('testing');

    expect(await screen.findByTestId('steering-rules-empty')).toHaveTextContent(
      /No Testing steering rules yet — import a doc, add one, or author with chat/,
    );
    expect(screen.queryByTestId('steering-unseeded')).toBeNull();
  });

  it('the sub-page strip lists all seven types and navigates between them', async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    listConformanceRules.mockResolvedValue({ rules: [] });
    wire();
    page('development', navigate);

    const tabs = screen.getAllByTestId('steering-tab');
    expect(tabs.map((t) => t.getAttribute('data-type'))).toEqual([
      'architecture', 'development', 'security', 'testing', 'operations', 'compliance', 'design-ux',
    ]);
    expect(tabs[1]).toHaveAttribute('aria-current', 'page');
    expect(tabs[6]).toHaveTextContent('Design/UX');

    await user.click(tabs[2]!);
    expect(navigate).toHaveBeenCalledWith('/steering/security');
  });
});

describe('filterSteeringRules — the page-scope + facet predicate, pinned', () => {
  const f = (over: Partial<{ severity: string; layer: string; rule_type: string; status: 'all' | 'active' | 'retired' }> = {}) =>
    ({ severity: 'all', layer: 'all', rule_type: 'all', status: 'all' as const, ...over });

  it('a rule belongs to exactly one page: its steering_type, absent = architecture', () => {
    const rules = [rule(), rule({ id: 'POL-100', steering_type: 'security' })];
    expect(filterSteeringRules(rules, 'architecture', f()).map((r) => r.id)).toEqual(['PAT-001']);
    expect(filterSteeringRules(rules, 'security', f()).map((r) => r.id)).toEqual(['POL-100']);
    expect(filterSteeringRules(rules, 'testing', f())).toHaveLength(0);
  });

  it('an out-of-enum steering_type folds to architecture rather than vanishing from all pages', () => {
    const odd = rule({ id: 'PAT-009', steering_type: 'not-a-type' });
    expect(filterSteeringRules([odd], 'architecture', f()).map((r) => r.id)).toEqual(['PAT-009']);
  });

  it('status active excludes retired and vice versa; severity/layer/type facets compose', () => {
    const rules = [
      rule(),
      rule({ id: 'PAT-002', severity: 'warn', retired: true }),
      rule({ id: 'POL-100', rule_type: 'policy', severity: 'critical', targets: { layer: 'surface' } }),
    ];
    expect(filterSteeringRules(rules, 'architecture', f({ status: 'active' })).map((r) => r.id)).toEqual(['PAT-001', 'POL-100']);
    expect(filterSteeringRules(rules, 'architecture', f({ status: 'retired' })).map((r) => r.id)).toEqual(['PAT-002']);
    expect(filterSteeringRules(rules, 'architecture', f({ severity: 'critical' })).map((r) => r.id)).toEqual(['POL-100']);
    expect(filterSteeringRules(rules, 'architecture', f({ layer: 'surface' })).map((r) => r.id)).toEqual(['POL-100']);
    expect(filterSteeringRules(rules, 'architecture', f({ rule_type: 'pattern' }))).toHaveLength(2);
  });
});

describe('SteeringPage — health header', () => {
  it('renders per-type numbers when the wire serves by_steering_type', async () => {
    listConformanceRules.mockResolvedValue({ rules: [rule({ steering_type: 'security' })] });
    const sb = scoreboard({
      by_steering_type: {
        security: { rules_total: 5, rules_active: 4, rules_retired: 1 },
        architecture: { rules_total: 30, rules_active: 28, rules_retired: 2 },
      },
    });
    wire({ scoreboard: () => Promise.resolve({ scoreboard: sb }) });
    page('security');

    const stat = await screen.findByTestId('steering-stat-rules-type');
    expect(stat).toHaveTextContent('Security rules');
    expect(stat).toHaveTextContent('4 active');
    expect(stat).toHaveTextContent('5 total · 1 retired');
    expect(screen.queryByTestId('steering-stat-rules')).toBeNull();
    // The rest of the AW-23 raw signals still render beside the derived verdict chip.
    expect(screen.getByTestId('steering-verdict')).toHaveAttribute('data-verdict', 'populated');
    expect(screen.getByTestId('steering-stat-typed')).toHaveTextContent('90%');
  });

  it('falls back to store-wide numbers, LABELED store-wide, when the wire has no per-type split', async () => {
    listConformanceRules.mockResolvedValue({ rules: [rule()] });
    wire({ scoreboard: () => Promise.resolve({ scoreboard: scoreboard() }) });
    page('architecture');

    const stat = await screen.findByTestId('steering-stat-rules');
    expect(stat).toHaveTextContent('Rules (store-wide)');
    expect(stat).toHaveTextContent('2 active');
    expect(stat).toHaveTextContent(/no per-type split/);
    expect(screen.queryByTestId('steering-stat-rules-type')).toBeNull();
  });

  it('a 501 renders the honest "engine predates the scoreboard" state, never an error card', async () => {
    listConformanceRules.mockResolvedValue({ rules: [rule()] });
    wire({ scoreboard: () => Promise.reject(new ApiError(501, 'engine predates governanceScoreboard')) });
    page();

    expect(await screen.findByTestId('steering-health-unsupported')).toHaveTextContent(/predates the governance scoreboard/);
    expect(screen.queryByTestId('steering-health-error')).toBeNull();
    // The rules browser still works off the shipping wire.
    expect(await screen.findByTestId('steering-rule-row')).toBeInTheDocument();
  });

  it('a real scoreboard failure surfaces as one', async () => {
    listConformanceRules.mockResolvedValue({ rules: [] });
    wire({ scoreboard: () => Promise.reject(new ApiError(500, 'store locked')) });
    page();

    expect(await screen.findByTestId('steering-health-error')).toHaveTextContent(/store locked/);
  });
});

describe('SteeringPage — seededness', () => {
  it('meta seeded:false + an empty store renders the unseeded state WITH the management bar', async () => {
    listConformanceRules.mockResolvedValue({ rules: [] });
    wire({ meta: () => Promise.resolve({ meta: { seeded: false } }) });
    page();

    expect(await screen.findByTestId('steering-unseeded')).toHaveTextContent(/No steering rules seeded yet/);
    expect(screen.getByTestId('steering-seed-command')).toHaveTextContent('seed_wiki.py');
    // Unlike the old wiki page, the unseeded state does NOT hide the way in: import/add/author
    // are exactly how a store gets seeded from here.
    expect(screen.getByTestId('steering-import-open')).toBeInTheDocument();
    expect(screen.getByTestId('steering-add-open')).toBeInTheDocument();
    expect(screen.getByTestId('steering-author-open')).toBeInTheDocument();
    // No facets to fiddle with an empty store.
    expect(screen.queryByTestId('steering-filter-severity')).toBeNull();
  });

  it('a daemon that cannot answer meta is never accused of an unseeded store', async () => {
    listConformanceRules.mockResolvedValue({ rules: [] });
    wire(); // every governance-wiki route absent
    page();

    expect(await screen.findByTestId('steering-rules-empty')).toHaveTextContent('No steering rules in the store.');
    expect(screen.queryByTestId('steering-unseeded')).toBeNull();
  });

  it('a mis-shaped meta payload (no wrapper) degrades like an unanswerable route, never a crash', async () => {
    listConformanceRules.mockResolvedValue({ rules: [] });
    wire({ meta: () => Promise.resolve({ seeded: false } as unknown as { meta: WikiMeta }) });
    page();

    expect(await screen.findByTestId('steering-rules-empty')).toHaveTextContent('No steering rules in the store.');
    expect(screen.queryByTestId('steering-unseeded')).toBeNull();
  });
});

describe('SteeringPage — rows and detail on the unified model', () => {
  it('rows carry weight and effect badges; a rule without an effect gets NO badge', async () => {
    listConformanceRules.mockResolvedValue({
      rules: [
        rule({ id: 'PAT-001', weight: 1.5, effect: 'deny', trigger: { contains: 'DROP TABLE' } }),
        rule({ id: 'PAT-002', statement: 'recall-only rule' }),
      ],
    });
    wire();
    page();

    const rows = await screen.findAllByTestId('steering-rule-row');
    expect(within(rows[0]!).getByTestId('steering-effect-badge')).toHaveAttribute('data-effect', 'deny');
    expect(within(rows[0]!).getByTestId('steering-rule-weight-chip')).toHaveTextContent('w=1.5');
    expect(within(rows[1]!).queryByTestId('steering-effect-badge')).toBeNull();
    expect(within(rows[1]!).queryByTestId('steering-rule-weight-chip')).toBeNull();
  });

  it('detail joins applies_to/excludes, weight, effect+trigger, provenance path@sha, and evidence', async () => {
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

    await user.click(await screen.findByTestId('steering-rule-row'));
    const detail = await screen.findByTestId('steering-rule-detail');
    expect(within(detail).getByTestId('steering-rule-applies')).toHaveTextContent('build');
    expect(within(detail).getByTestId('steering-rule-applies')).toHaveTextContent('review');
    expect(within(detail).getByTestId('steering-rule-excludes')).toHaveTextContent('chat');
    expect(within(detail).getByTestId('steering-rule-weight')).toHaveTextContent('2');
    expect(within(detail).getByTestId('steering-rule-effect')).toHaveTextContent(/allow\+cond/);
    expect(within(detail).getByTestId('steering-rule-effect')).toHaveTextContent(/migration/);
    expect(within(detail).getByTestId('steering-rule-obligations')).toHaveTextContent('record evidence');
    expect(within(detail).getByTestId('steering-rule-criteria')).toHaveTextContent('the gate criteria text');
    expect(within(detail).getByTestId('steering-rule-provenance')).toHaveTextContent(`docs/agent-behavior.md@${SHA.slice(0, 12)}`);
    expect(within(detail).getByTestId('steering-rule-source-uri')).toHaveTextContent(`docs/agent-behavior.md@${SHA}#PAT-001`);
    expect(within(detail).getByTestId('steering-rule-evidence')).toHaveTextContent('3 denial claims · 7 governs evidence');
  });

  it('renders honest defaults when the wire predates the unified fields', async () => {
    const user = userEvent.setup();
    listConformanceRules.mockResolvedValue({ rules: [rule()] });
    wire(); // no scoreboard either — the evidence join has no producer
    page();

    await user.click(await screen.findByTestId('steering-rule-row'));
    const detail = await screen.findByTestId('steering-rule-detail');
    expect(within(detail).getByTestId('steering-rule-applies')).toHaveTextContent('—');
    expect(within(detail).getByTestId('steering-rule-excludes')).toHaveTextContent('—');
    expect(within(detail).getByTestId('steering-rule-weight')).toHaveTextContent(/engine default 1\.0/);
    expect(within(detail).getByTestId('steering-rule-effect')).toHaveTextContent('recall-only');
    expect(within(detail).getByTestId('steering-rule-evidence')).toHaveTextContent('—');
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

    const rows = await screen.findAllByTestId('steering-rule-row');
    await user.click(rows[0]!);
    expect(within(await screen.findByTestId('steering-rule-detail')).getByTestId('steering-provenance-ui'))
      .toHaveTextContent('authored in studio (ui)');
    await user.click(rows[1]!);
    await waitFor(() =>
      expect(within(screen.getByTestId('steering-rule-detail')).getByTestId('steering-provenance-chat'))
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

    await user.click(await screen.findByTestId('steering-rule-row'));
    expect(await screen.findByTestId('steering-rule-provenance')).toHaveTextContent(/no digest — re-ingest/);
  });
});

describe('SteeringPage — the retire kill switch', () => {
  async function openModal(user: ReturnType<typeof userEvent.setup>): Promise<void> {
    await user.click(await screen.findByTestId('steering-rule-row'));
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
    expect(await screen.findByTestId('steering-rule-retired-chip')).toBeInTheDocument();
    expect(screen.getByTestId('steering-retired-note')).toHaveTextContent('superseded by PAT-050');
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

    await user.click(await screen.findByTestId('steering-rule-row'));
    await screen.findByTestId('steering-rule-detail');
    expect(screen.queryByTestId('steering-retire-open')).toBeNull();
    expect(screen.queryByTestId('steering-edit-open')).toBeNull();
    expect(screen.getByTestId('steering-rule-retired-note')).toHaveTextContent(/withdrawn from recall/);
  });
});
