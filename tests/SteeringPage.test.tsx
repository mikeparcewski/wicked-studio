import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SteeringPage } from '../src/components/SteeringPage.js';
import { filterSteeringRules, GRID_FACETS_DEFAULT, type GridFacets } from '../src/components/SteeringGrid.js';
import { countByType } from '../src/components/SteeringTypeCards.js';
import { ApiError } from '../src/api/errors.js';
import type { SteeringRule, SteeringType } from '../src/api/steering.js';
import type { WikiMeta, WikiScoreboard } from '../src/api/wiki.js';

/**
 * The Steering surface after the SPREADSHEET wave — the read side, demo-able entirely off
 * mocked wire payloads. Pinned here:
 *  - the `/steering` LANDING (type null): a calm grid of seven type cards, each counting that
 *    type's rules from the ONE rules fetch, client-side; a card click is a real navigation;
 *  - `/steering/:type`: ONE shell parameterized by type — the GRID scopes to the page's
 *    steering_type, with absent `steering_type` folding to architecture (the engine's serde
 *    default); the breadcrumb walks back to the landing;
 *  - the health header renders the AW-23 raw signals; PER-TYPE numbers when the wire serves
 *    `by_type` (the wicked-governance Scoreboard spelling), the store-wide numbers LABELED
 *    store-wide when it does not; a 501 is the honest adoption state, never an error card;
 *  - `meta.seeded === false` + an empty store is the unseeded state (seed command shown), and a
 *    daemon that cannot answer meta is never accused of an unseeded store; an empty TYPE on a
 *    populated store names the ways in (a draft row, the assistant) instead;
 *  - the GRID carries the common columns (id · type · severity · statement · weight ·
 *    applies_to · excludes · status); everything richer lives in the DRAWER the ID CELL opens
 *    (provenance, effect+trigger, obligations, criteria, evidence — each honest when its
 *    producer is not served); cell-editing mechanics are pinned in SteeringGrid.test.tsx;
 *  - retire takes a TYPED confirmation + required reason over the shipping DELETE wire (the
 *    SHARED modal, opened from the drawer or a grid row), reloads for the server's state, and
 *    surfaces failure instead of pretending.
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
    return Promise.reject(new Error(`unexpected apiFetch path: ${String(path)}`));
  });
}

function page(type: SteeringType | null = 'architecture', navigate: (p: string) => void = () => {}): ReturnType<typeof render> {
  return render(<SteeringPage type={type} navigate={navigate} />);
}

beforeEach(() => {
  listConformanceRules.mockReset();
  retireConformanceRule.mockReset();
  upsertConformanceRule.mockReset();
  apiFetch.mockReset();
  // The landing's usage band reads the claims wire; default it to the honest
  // unsupported answer so the band renders its "not served" tiles — its own
  // loaded-path assertions live in SteeringUsageBand.test.tsx.
  listClaims.mockReset();
  listClaims.mockRejectedValue(new ApiError(404, 'not found'));
});

describe('SteeringPage — the /steering landing (type null)', () => {
  const corpus = [
    rule(), // no steering_type → architecture (the serde default)
    rule({ id: 'PAT-002', statement: 'Pin the fetch boundary', steering_type: 'architecture' }),
    rule({ id: 'PAT-003', statement: 'A retired one', steering_type: 'architecture', retired: true }),
    rule({ id: 'POL-100', rule_type: 'policy', statement: 'No secrets in logs', steering_type: 'security', severity: 'critical' }),
  ];

  it('renders seven compact type cards, each counting that type from the one rules fetch', async () => {
    listConformanceRules.mockResolvedValue({ rules: corpus });
    wire();
    page(null);

    const cards = await screen.findAllByTestId('steering-type-card');
    expect(cards.map((c) => c.getAttribute('data-type'))).toEqual([
      'architecture', 'development', 'security', 'testing', 'operations', 'compliance', 'design-ux',
    ]);
    const counts = cards.map((c) => within(c).getByTestId('steering-type-card-count').textContent);
    expect(counts).toEqual(['2', '0', '1', '0', '0', '0', '0']);
    // The retired architecture rule counts as retired, never silently dropped.
    expect(cards[0]).toHaveTextContent('1 retired');
    // The landing is CALM: no grid, no forms, no dock, no health tiles.
    expect(screen.queryByTestId('steering-grid-row')).toBeNull();
    expect(screen.queryByTestId('steering-add-menu')).toBeNull();
    expect(screen.queryByTestId('steering-rule-form')).toBeNull();
    expect(screen.queryByTestId('assist-dock')).toBeNull();
    expect(screen.queryByTestId('steering-health')).toBeNull();
    expect(listConformanceRules).toHaveBeenCalledTimes(1);
  });

  it('a card click navigates to that type page', async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    listConformanceRules.mockResolvedValue({ rules: corpus });
    wire();
    page(null, navigate);

    const cards = await screen.findAllByTestId('steering-type-card');
    await user.click(cards[2]!);
    expect(navigate).toHaveBeenCalledWith('/steering/security');
  });

  it('a failed rules fetch surfaces on the landing instead of seven fabricated zeros', async () => {
    listConformanceRules.mockRejectedValue(new ApiError(500, 'store locked'));
    wire();
    page(null);

    expect(await screen.findByTestId('steering-rules-error')).toHaveTextContent(/store locked/);
    expect(screen.queryByTestId('steering-type-card')).toBeNull();
  });
});

describe('countByType — the landing count fold, pinned to agree with the pages', () => {
  it('folds absent/out-of-enum steering_type to architecture and splits active/retired', () => {
    const counts = countByType([
      rule(),
      rule({ id: 'PAT-009', steering_type: 'not-a-type' }),
      rule({ id: 'PAT-010', retired: true }),
      rule({ id: 'POL-100', steering_type: 'security' }),
    ]);
    expect(counts.architecture).toEqual({ active: 2, retired: 1 });
    expect(counts.security).toEqual({ active: 1, retired: 0 });
    expect(counts.testing).toEqual({ active: 0, retired: 0 });
  });
});

describe('SteeringPage — one shell, parameterized by type', () => {
  const corpus = [
    rule(), // no steering_type → architecture (the serde default)
    rule({ id: 'PAT-002', statement: 'Pin the fetch boundary', steering_type: 'architecture' }),
    rule({ id: 'POL-100', rule_type: 'policy', statement: 'No secrets in logs', steering_type: 'security', severity: 'critical' }),
  ];

  it('scopes the grid to the page type; absent steering_type folds to architecture', async () => {
    listConformanceRules.mockResolvedValue({ rules: corpus });
    wire();
    const { unmount } = page('architecture');

    const rows = await screen.findAllByTestId('steering-grid-row');
    expect(rows.map((r) => r.getAttribute('data-rule-id'))).toEqual(['PAT-001', 'PAT-002']);
    expect(screen.getByTestId('steering-page')).toHaveAttribute('data-steering-type', 'architecture');
    unmount();

    page('security');
    const secRows = await screen.findAllByTestId('steering-grid-row');
    expect(secRows.map((r) => r.getAttribute('data-rule-id'))).toEqual(['POL-100']);
  });

  it('an empty TYPE on a populated store names the ways in, never "unseeded"', async () => {
    listConformanceRules.mockResolvedValue({ rules: corpus });
    wire({ meta: () => Promise.resolve({ meta: { seeded: true } }) });
    page('testing');

    expect(await screen.findByTestId('steering-rules-empty')).toHaveTextContent(
      /No Testing steering rules yet — add a row, or open the assistant/,
    );
    expect(screen.queryByTestId('steering-unseeded')).toBeNull();
  });

  it('the breadcrumb walks back to the /steering landing', async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    listConformanceRules.mockResolvedValue({ rules: [] });
    wire();
    page('development', navigate);

    const crumb = screen.getByTestId('steering-breadcrumb');
    expect(crumb).toHaveAttribute('href', '/steering');
    await user.click(crumb);
    expect(navigate).toHaveBeenCalledWith('/steering');
    // The old seven-tab strip retired with the landing — the cards are the navigation now.
    expect(screen.queryByTestId('steering-tab')).toBeNull();
  });
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
    const odd = rule({ id: 'PAT-009', steering_type: 'not-a-type' });
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

describe('SteeringPage — health header (TYPE-scoped, usability review #5)', () => {
  it('renders per-type numbers when the wire serves by_type — and NOTHING store-wide', async () => {
    listConformanceRules.mockResolvedValue({ rules: [rule({ steering_type: 'security' })] });
    // The wicked-governance `Scoreboard.by_type` shape, serde spellings verbatim.
    const sb = scoreboard({
      by_type: {
        security: { total: 5, active: 4, retired: 1, enforcing: 0 },
        architecture: { total: 30, active: 28, retired: 2, enforcing: 3 },
      },
    });
    wire({ scoreboard: () => Promise.resolve({ scoreboard: sb }) });
    page('security');

    const stat = await screen.findByTestId('steering-stat-rules-type');
    expect(stat).toHaveTextContent('Security rules');
    expect(stat).toHaveTextContent('4 active');
    expect(stat).toHaveTextContent('5 total · 1 retired');
    // The store-wide stats, the verdict pill and the ingest diagnostics moved
    // to the LANDING (the one place they are actionable) — never a type page.
    expect(screen.queryByTestId('steering-stat-rules')).toBeNull();
    expect(screen.queryByTestId('steering-verdict')).toBeNull();
    expect(screen.queryByTestId('steering-stat-typed')).toBeNull();
    expect(screen.queryByTestId('steering-diagnostics')).toBeNull();
  });

  it('a served by_type map with NO row for this type means zero — no stats block (only types holding rules appear)', async () => {
    // The live 0.7.3 shape: by_type carries architecture only; Security must
    // read as empty through the WIRE path, never inherit a fallback count.
    listConformanceRules.mockResolvedValue({ rules: [rule({ steering_type: 'security' })] });
    const sb = scoreboard({ by_type: { architecture: { total: 36, active: 36, retired: 0, enforcing: 0 } } });
    wire({ scoreboard: () => Promise.resolve({ scoreboard: sb }) });
    page('security');

    await screen.findByTestId('steering-page');
    await waitFor(() => expect(listConformanceRules).toHaveBeenCalled());
    expect(screen.queryByTestId('steering-health')).toBeNull();
    expect(screen.queryByTestId('steering-stat-rules-type')).toBeNull();
  });

  it('falls back to a CLIENT-side count of this type’s loaded rules when the wire has no per-type split', async () => {
    listConformanceRules.mockResolvedValue({ rules: [rule()] }); // architecture via serde default
    wire({ scoreboard: () => Promise.resolve({ scoreboard: scoreboard() }) });
    page('architecture');

    const stat = await screen.findByTestId('steering-stat-rules-type');
    expect(stat).toHaveTextContent('Architecture rules');
    expect(stat).toHaveTextContent('1 loaded');
    expect(stat).toHaveTextContent(/no per-type split/);
    // Never the store-wide "2 active" wearing this type's label.
    expect(screen.queryByTestId('steering-stat-rules')).toBeNull();
  });

  it('an EMPTY type page loses the stats entirely — no store-wide numbers over an empty list', async () => {
    // The live-verified finding: Security with 0 rules of its own said "36
    // active" + a red decaying pill. Now: no health block at all.
    listConformanceRules.mockResolvedValue({ rules: [rule()] }); // architecture only
    wire({ scoreboard: () => Promise.resolve({ scoreboard: scoreboard() }) });
    page('security');

    await screen.findByTestId('steering-page');
    await waitFor(() => expect(listConformanceRules).toHaveBeenCalled());
    expect(screen.queryByTestId('steering-health')).toBeNull();
    expect(screen.queryByTestId('steering-verdict')).toBeNull();
    expect(screen.queryByTestId('steering-stat-rules')).toBeNull();
    expect(screen.queryByTestId('steering-stat-rules-type')).toBeNull();
  });

  it('the LANDING carries the store-wide verdict, with diagnostics behind a details toggle', async () => {
    listConformanceRules.mockResolvedValue({ rules: [rule()] });
    wire({ scoreboard: () => Promise.resolve({ scoreboard: scoreboard() }) });
    page(null);

    const health = await screen.findByTestId('steering-store-health');
    expect(within(health).getByTestId('steering-verdict')).toHaveAttribute('data-verdict', 'populated');
    // The raw signals are PRESENT but folded — a details element, closed by default.
    const details = within(health).getByTestId('steering-diagnostics');
    expect(details).not.toHaveAttribute('open');
    expect(within(health).getByTestId('steering-stat-typed')).toHaveTextContent('90%');
    expect(within(health).getByTestId('steering-stat-rules')).toHaveTextContent('Rules (store-wide)');
  });

  it('a 501 renders the honest "engine predates the scoreboard" state, never an error card', async () => {
    listConformanceRules.mockResolvedValue({ rules: [rule()] });
    wire({ scoreboard: () => Promise.reject(new ApiError(501, 'engine predates governanceScoreboard')) });
    page();

    expect(await screen.findByTestId('steering-health-unsupported')).toHaveTextContent(/predates the governance scoreboard/);
    expect(screen.queryByTestId('steering-health-error')).toBeNull();
    // The rules browser still works off the shipping wire.
    expect(await screen.findByTestId('steering-grid-row')).toBeInTheDocument();
  });

  it('a real scoreboard failure surfaces as one', async () => {
    listConformanceRules.mockResolvedValue({ rules: [] });
    wire({ scoreboard: () => Promise.reject(new ApiError(500, 'store locked')) });
    page();

    expect(await screen.findByTestId('steering-health-error')).toHaveTextContent(/store locked/);
  });
});

describe('SteeringPage — seededness', () => {
  it('meta seeded:false + an empty store renders the unseeded state WITH the Add menu', async () => {
    listConformanceRules.mockResolvedValue({ rules: [] });
    wire({ meta: () => Promise.resolve({ meta: { seeded: false } }) });
    page();

    expect(await screen.findByTestId('steering-unseeded')).toHaveTextContent(/No steering rules seeded yet/);
    expect(screen.getByTestId('steering-seed-command')).toHaveTextContent('seed_wiki.py');
    // The unseeded state does NOT hide the way in: the Add menu (draft row / assistant)
    // is exactly how a store gets seeded from here.
    expect(screen.getByTestId('steering-add-menu')).toBeInTheDocument();
    // No grid (and no facets) to fiddle with an empty store.
    expect(screen.queryByTestId('steering-grid-filter-search')).toBeNull();
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

describe('SteeringPage — the grid + the drawer', () => {
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

describe('SteeringPage — the retire kill switch (opened from the drawer)', () => {
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

    await user.click(await screen.findByTestId('steering-grid-id'));
    await screen.findByTestId('steering-rule-drawer');
    expect(screen.queryByTestId('steering-retire-open')).toBeNull();
    expect(screen.queryByTestId('steering-edit-open')).toBeNull();
    expect(screen.getByTestId('steering-rule-retired-note')).toHaveTextContent(/withdrawn from recall/);
  });
});

describe('SteeringPage — ?rule deep link opens the drawer (qe finding: eval gap hints are links)', () => {
  it('landing on /steering/security?rule=POL-100 opens POL-100’s drawer', async () => {
    listConformanceRules.mockResolvedValue({
      rules: [rule({ id: 'POL-100', rule_type: 'policy', statement: 'No secrets in logs', steering_type: 'security' })],
    });
    wire();
    render(<SteeringPage type="security" navigate={() => {}} search="?rule=POL-100" />);

    const drawer = await screen.findByTestId('steering-rule-drawer');
    expect(drawer).toHaveTextContent('POL-100');
    expect(drawer).toHaveTextContent('No secrets in logs');
  });

  it('a routed rule filed under a NEIGHBOURING type still opens (the link came from an eval sample)', async () => {
    listConformanceRules.mockResolvedValue({
      rules: [rule({ id: 'PAT-777', statement: 'Pin the fetch boundary', steering_type: 'development' })],
    });
    wire();
    render(<SteeringPage type="security" navigate={() => {}} search="?rule=PAT-777" />);

    expect(await screen.findByTestId('steering-rule-drawer')).toHaveTextContent('PAT-777');
  });

  it('an unknown ?rule id opens nothing — never a fabricated drawer', async () => {
    listConformanceRules.mockResolvedValue({ rules: [rule()] });
    wire();
    render(<SteeringPage type="architecture" navigate={() => {}} search="?rule=NOPE-1" />);

    await screen.findByTestId('steering-grid-row');
    expect(screen.queryByTestId('steering-rule-drawer')).toBeNull();
  });

  // The failure banner links `/steering?rule=<id>` (a rule id alone does not name its type
  // page): the LANDING resolves the id to its type once rules load and navigates there with
  // the drawer param intact. Unknown ids stay put — no dead redirect.
  it('landing resolves ?rule=<id> to the rule\'s type page', async () => {
    listConformanceRules.mockResolvedValue({ rules: [
      { id: 'SEC-101', rule_type: 'policy', statement: 's', severity: 'critical', confidence: 1,
        targets: {}, provenance: { source: 'policy', source_kinds: [] }, retired: false,
        steering_type: 'security' },
    ] });
    wire();
    const navigate = vi.fn();
    render(<SteeringPage type={null} navigate={navigate} search="?rule=SEC-101" />);
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/steering/security?rule=SEC-101'));
  });

  it('landing stays put on an unknown ?rule id', async () => {
    listConformanceRules.mockResolvedValue({ rules: [] });
    wire();
    const navigate = vi.fn();
    render(<SteeringPage type={null} navigate={navigate} search="?rule=NOPE-1" />);
    await screen.findByTestId('steering-landing');
    expect(navigate).not.toHaveBeenCalled();
  });

});
