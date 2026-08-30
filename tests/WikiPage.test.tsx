import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WikiPage, filterRules } from '../src/components/WikiPage.js';
import { ApiError } from '../src/api/errors.js';
import type { WikiMeta, WikiRuleSet, WikiScoreboard } from '../src/api/wiki.js';
import type { ConformanceRule } from '../src/api/types.js';

/**
 * The Architecture Wiki surface (`/wiki`) — demo-able entirely off mocked wire payloads.
 * Pinned here:
 *  - the health header renders the AW-23 scoreboard's RAW signals plus studio's derived
 *    populated-vs-decaying verdict chip beside them;
 *  - a 501 (engine predates the scoreboard) is the HONEST adoption state, never an error card;
 *  - `meta.seeded === false` is the EMPTY state with the seed-runbook command shown — and a
 *    daemon that cannot answer meta is never accused of an unseeded store;
 *  - the rules browser filters client-side on severity/layer/rule_type/status (incl. retired);
 *  - rule detail joins enforcement class (meta docs), provenance path@sha + wiki URI
 *    (provenance.ref), and evidence counts (scoreboard per_rule) — each with an honest "—"
 *    when its producer is not served;
 *  - the retire kill switch takes a TYPED confirmation (the exact rule id) AND a required
 *    reason before the existing DELETE wire fires, reloads to show the server's state, and
 *    surfaces a failed retire instead of pretending;
 *  - RuleSet grouping groups by doctrine domain with an `ungrouped` bucket, and says plainly
 *    when the daemon does not serve grouping.
 */

const listConformanceRules = vi.fn();
const retireConformanceRule = vi.fn();
const apiFetch = vi.fn();

vi.mock('../src/api/client.js', () => ({
  api: {
    listConformanceRules: (...a: unknown[]) => listConformanceRules(...a),
    retireConformanceRule: (...a: unknown[]) => retireConformanceRule(...a),
  },
  apiFetch: (...a: unknown[]) => apiFetch(...a),
}));

const SHA = 'a'.repeat(40);

function rule(over: Partial<ConformanceRule> = {}): ConformanceRule {
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

/** Wire the three wiki reads; each is a thunk so a case can reject one independently. */
function wire(w: {
  scoreboard?: () => Promise<{ scoreboard: WikiScoreboard }>;
  meta?: () => Promise<{ meta: WikiMeta }>;
  rulesets?: () => Promise<{ rulesets: WikiRuleSet[] }>;
} = {}): void {
  const routeAbsent = (): Promise<never> => Promise.reject(new ApiError(404, 'Not Found'));
  apiFetch.mockImplementation((path: unknown) => {
    if (path === '/governance/wiki/scoreboard') return (w.scoreboard ?? routeAbsent)();
    if (path === '/governance/wiki/meta') return (w.meta ?? routeAbsent)();
    if (path === '/governance/wiki/rulesets') return (w.rulesets ?? routeAbsent)();
    return Promise.reject(new Error(`unexpected apiFetch path: ${String(path)}`));
  });
}

beforeEach(() => {
  listConformanceRules.mockReset();
  retireConformanceRule.mockReset();
  apiFetch.mockReset();
});

describe('WikiPage — health header', () => {
  it('renders the scoreboard raw signals with the derived verdict chip beside them', async () => {
    listConformanceRules.mockResolvedValue({ rules: [rule()] });
    wire({ scoreboard: () => Promise.resolve({ scoreboard: scoreboard() }) });
    render(<WikiPage />);

    const health = await screen.findByTestId('wiki-health');
    expect(within(health).getByTestId('wiki-verdict')).toHaveAttribute('data-verdict', 'populated');
    expect(within(health).getByTestId('wiki-stat-typed')).toHaveTextContent('90%');
    expect(within(health).getByTestId('wiki-stat-resolving')).toHaveTextContent('100%');
    expect(within(health).getByTestId('wiki-stat-denials')).toHaveTextContent('2');
    expect(within(health).getByTestId('wiki-stat-rules')).toHaveTextContent('2 active');
    // Recall volume is documented UNAVAILABLE by the engine — the header says so in-band.
    expect(screen.getByTestId('wiki-recall-unavailable')).toHaveTextContent('nothing writes recall telemetry yet');
  });

  it('states the honest unmeasured typing reason when the daemon had no docs root', async () => {
    listConformanceRules.mockResolvedValue({ rules: [] });
    const sb = scoreboard();
    sb.typing = { available: false, reason: 'no docs root supplied', docs_scanned: 0, statements_total: 0, statements_typed: 0, by_class: {}, docs_untyped: [] };
    wire({ scoreboard: () => Promise.resolve({ scoreboard: sb }) });
    render(<WikiPage />);

    const typed = await screen.findByTestId('wiki-stat-typed');
    expect(typed).toHaveTextContent('not measured');
    expect(typed).toHaveTextContent('no docs root supplied');
  });

  it('a 501 renders the honest "engine predates the wiki scoreboard" state, never an error card', async () => {
    listConformanceRules.mockResolvedValue({ rules: [rule()] });
    wire({ scoreboard: () => Promise.reject(new ApiError(501, 'core-ts engine predates wiki scoreboard')) });
    render(<WikiPage />);

    expect(await screen.findByTestId('wiki-health-unsupported')).toHaveTextContent(/predates the wiki scoreboard/);
    expect(screen.queryByTestId('wiki-health-error')).toBeNull();
    // The rules browser still works off the shipping wire.
    expect(await screen.findByTestId('wiki-rule-row')).toBeInTheDocument();
  });

  it('a real scoreboard failure surfaces as one', async () => {
    listConformanceRules.mockResolvedValue({ rules: [] });
    wire({ scoreboard: () => Promise.reject(new ApiError(500, 'store locked')) });
    render(<WikiPage />);

    expect(await screen.findByTestId('wiki-health-error')).toHaveTextContent(/store locked/);
  });
});

describe('WikiPage — seededness', () => {
  it('meta seeded:false renders the EMPTY state with the seed-runbook command shown', async () => {
    listConformanceRules.mockResolvedValue({ rules: [] });
    wire({ meta: () => Promise.resolve({ meta: { seeded: false } }) });
    render(<WikiPage />);

    expect(await screen.findByTestId('wiki-unseeded')).toHaveTextContent(/Wiki not seeded — run the seed runbook/);
    expect(screen.getByTestId('wiki-seed-command')).toHaveTextContent('seed_wiki.py');
    // The empty state replaces the browser — no facets to fiddle with an empty store.
    expect(screen.queryByTestId('wiki-filter-severity')).toBeNull();
    // The About panel still explains the pipeline, so the way out is on the page.
    expect(screen.getByTestId('wiki-about')).toBeInTheDocument();
  });

  it('a daemon that cannot answer meta is never accused of an unseeded store', async () => {
    listConformanceRules.mockResolvedValue({ rules: [] });
    wire(); // every wiki route absent
    render(<WikiPage />);

    expect(await screen.findByTestId('wiki-rules-empty')).toHaveTextContent('No rules in the store.');
    expect(screen.queryByTestId('wiki-unseeded')).toBeNull();
  });

  it('a mis-shaped meta payload (no wrapper) degrades like an unanswerable route, never a crash', async () => {
    listConformanceRules.mockResolvedValue({ rules: [] });
    // A daemon serving the meta object BARE instead of `{ meta: ... }` — a contract bug on the
    // wire, which must read as "cannot tell", not throw through the page render.
    wire({ meta: () => Promise.resolve({ seeded: false } as unknown as { meta: WikiMeta }) });
    render(<WikiPage />);

    expect(await screen.findByTestId('wiki-rules-empty')).toHaveTextContent('No rules in the store.');
    expect(screen.queryByTestId('wiki-unseeded')).toBeNull();
  });
});

describe('WikiPage — rules browser facets', () => {
  const corpus = [
    rule(),
    rule({ id: 'POL-100', rule_type: 'policy', severity: 'critical', statement: 'One writer per store', targets: { layer: 'surface' } }),
    rule({ id: 'PAT-002', severity: 'warn', statement: 'Old habit', retired: true }),
  ];

  it('shows everything by default (status facet = all), retired chip included', async () => {
    listConformanceRules.mockResolvedValue({ rules: corpus });
    wire();
    render(<WikiPage />);

    expect(await screen.findAllByTestId('wiki-rule-row')).toHaveLength(3);
    expect(screen.getByTestId('wiki-rule-retired-chip')).toBeInTheDocument();
  });

  it('filters by severity, layer, type, and status incl. retired', async () => {
    const user = userEvent.setup();
    listConformanceRules.mockResolvedValue({ rules: corpus });
    wire();
    render(<WikiPage />);
    await screen.findAllByTestId('wiki-rule-row');

    await user.selectOptions(screen.getByTestId('wiki-filter-severity'), 'critical');
    let rows = screen.getAllByTestId('wiki-rule-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveAttribute('data-rule-id', 'POL-100');

    await user.selectOptions(screen.getByTestId('wiki-filter-severity'), 'all');
    await user.selectOptions(screen.getByTestId('wiki-filter-status'), 'retired');
    rows = screen.getAllByTestId('wiki-rule-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveAttribute('data-rule-id', 'PAT-002');

    await user.selectOptions(screen.getByTestId('wiki-filter-status'), 'active');
    await user.selectOptions(screen.getByTestId('wiki-filter-layer'), 'surface');
    rows = screen.getAllByTestId('wiki-rule-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveAttribute('data-rule-id', 'POL-100');

    await user.selectOptions(screen.getByTestId('wiki-filter-layer'), 'all');
    await user.selectOptions(screen.getByTestId('wiki-filter-status'), 'all');
    await user.selectOptions(screen.getByTestId('wiki-filter-type'), 'pattern');
    expect(screen.getAllByTestId('wiki-rule-row')).toHaveLength(2);
  });

  it('says which kind of empty it is when facets match nothing', async () => {
    const user = userEvent.setup();
    listConformanceRules.mockResolvedValue({ rules: [rule()] });
    wire();
    render(<WikiPage />);
    await screen.findByTestId('wiki-rule-row');

    await user.selectOptions(screen.getByTestId('wiki-filter-severity'), 'info');
    expect(screen.getByTestId('wiki-rules-empty')).toHaveTextContent('No rules match these facets.');
  });
});

describe('filterRules — the facet predicate, pinned', () => {
  it('an absent layer facet on the rule only matches the all filter', () => {
    const noLayer = rule({ id: 'PAT-003', targets: {} });
    expect(filterRules([noLayer], { severity: 'all', layer: 'foundation', rule_type: 'all', status: 'all' })).toHaveLength(0);
    expect(filterRules([noLayer], { severity: 'all', layer: 'all', rule_type: 'all', status: 'all' })).toHaveLength(1);
  });

  it('status active excludes retired and vice versa; all keeps both', () => {
    const rules = [rule(), rule({ id: 'PAT-002', retired: true })];
    const f = (status: 'all' | 'active' | 'retired') => ({ severity: 'all', layer: 'all', rule_type: 'all', status });
    expect(filterRules(rules, f('active')).map((r) => r.id)).toEqual(['PAT-001']);
    expect(filterRules(rules, f('retired')).map((r) => r.id)).toEqual(['PAT-002']);
    expect(filterRules(rules, f('all'))).toHaveLength(2);
  });
});

describe('WikiPage — rule detail', () => {
  it('joins wiki URI, provenance path@sha, evidence counts, and enforcement class', async () => {
    const user = userEvent.setup();
    listConformanceRules.mockResolvedValue({ rules: [rule()] });
    wire({
      scoreboard: () => Promise.resolve({ scoreboard: scoreboard() }),
      meta: () => Promise.resolve({
        meta: { seeded: true, docs: [{ path: 'docs/agent-behavior.md', enforcement_class: 'policy' }] },
      }),
    });
    render(<WikiPage />);

    await user.click(await screen.findByTestId('wiki-rule-row'));
    const detail = await screen.findByTestId('wiki-rule-detail');
    expect(within(detail).getByTestId('wiki-rule-wiki-uri')).toHaveTextContent(`docs/agent-behavior.md@${SHA}#PAT-001`);
    expect(within(detail).getByTestId('wiki-rule-provenance')).toHaveTextContent(`docs/agent-behavior.md@${SHA.slice(0, 12)}`);
    expect(within(detail).getByTestId('wiki-rule-evidence')).toHaveTextContent('3 denial claims · 7 governs evidence');
    expect(within(detail).getByTestId('wiki-rule-class')).toHaveTextContent('policy');
    expect(within(detail).getByTestId('wiki-rule-statement')).toHaveTextContent('Never use printf without %s');
  });

  it('renders honest dashes when the joins have no producer on this daemon', async () => {
    const user = userEvent.setup();
    listConformanceRules.mockResolvedValue({ rules: [rule()] });
    wire(); // no scoreboard (evidence join), no meta (class join)
    render(<WikiPage />);

    await user.click(await screen.findByTestId('wiki-rule-row'));
    const detail = await screen.findByTestId('wiki-rule-detail');
    expect(within(detail).getByTestId('wiki-rule-evidence')).toHaveTextContent('—');
    expect(within(detail).getByTestId('wiki-rule-class')).toHaveTextContent('—');
  });

  it('flags a legacy digest-less ref as needing re-ingest instead of inventing a sha', async () => {
    const user = userEvent.setup();
    listConformanceRules.mockResolvedValue({
      rules: [rule({ provenance: { source: 'markdown', ref: 'docs/a.md#PAT-001', source_kinds: ['doc'] } })],
    });
    wire();
    render(<WikiPage />);

    await user.click(await screen.findByTestId('wiki-rule-row'));
    expect(await screen.findByTestId('wiki-rule-provenance')).toHaveTextContent(/no digest — re-ingest/);
  });
});

describe('WikiPage — the retire kill switch', () => {
  async function openModal(user: ReturnType<typeof userEvent.setup>): Promise<void> {
    await user.click(await screen.findByTestId('wiki-rule-row'));
    await user.click(await screen.findByTestId('wiki-retire-open'));
    await screen.findByTestId('wiki-retire-modal');
  }

  it('stays disarmed until the EXACT rule id is typed AND a reason is given', async () => {
    const user = userEvent.setup();
    listConformanceRules.mockResolvedValue({ rules: [rule()] });
    wire();
    render(<WikiPage />);
    await openModal(user);

    const confirm = screen.getByTestId('wiki-retire-confirm');
    expect(confirm).toBeDisabled();

    await user.type(screen.getByTestId('wiki-retire-confirm-input'), 'PAT-00'); // wrong id
    await user.type(screen.getByTestId('wiki-retire-reason'), 'superseded by PAT-050');
    expect(confirm).toBeDisabled();

    await user.type(screen.getByTestId('wiki-retire-confirm-input'), '1'); // now exact
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
    render(<WikiPage />);
    await openModal(user);

    await user.type(screen.getByTestId('wiki-retire-confirm-input'), 'PAT-001');
    await user.type(screen.getByTestId('wiki-retire-reason'), 'superseded by PAT-050');
    await user.click(screen.getByTestId('wiki-retire-confirm'));

    await waitFor(() => expect(retireConformanceRule).toHaveBeenCalledWith('PAT-001'));
    // The row shows the SERVER's state, never this surface's optimism.
    await waitFor(() => expect(listConformanceRules).toHaveBeenCalledTimes(2));
    expect(await screen.findByTestId('wiki-rule-retired-chip')).toBeInTheDocument();
    // Git is the source of truth — the reason's durable home is the doc PR, so it is echoed back.
    expect(screen.getByTestId('wiki-retired-note')).toHaveTextContent('superseded by PAT-050');
    expect(screen.queryByTestId('wiki-retire-modal')).toBeNull();
  });

  it('surfaces a failed retire in the modal instead of silently leaving the rule enforcing', async () => {
    const user = userEvent.setup();
    listConformanceRules.mockResolvedValue({ rules: [rule()] });
    retireConformanceRule.mockRejectedValue(new ApiError(404, 'unknown rule: PAT-001'));
    wire();
    render(<WikiPage />);
    await openModal(user);

    await user.type(screen.getByTestId('wiki-retire-confirm-input'), 'PAT-001');
    await user.type(screen.getByTestId('wiki-retire-reason'), 'gone already');
    await user.click(screen.getByTestId('wiki-retire-confirm'));

    expect(await screen.findByTestId('wiki-retire-error')).toHaveTextContent(/unknown rule/);
    expect(screen.getByTestId('wiki-retire-modal')).toBeInTheDocument();
    expect(listConformanceRules).toHaveBeenCalledTimes(1);
  });

  it('offers no retire button on an already-retired rule', async () => {
    const user = userEvent.setup();
    listConformanceRules.mockResolvedValue({ rules: [rule({ retired: true })] });
    wire();
    render(<WikiPage />);

    await user.click(await screen.findByTestId('wiki-rule-row'));
    await screen.findByTestId('wiki-rule-detail');
    expect(screen.queryByTestId('wiki-retire-open')).toBeNull();
    expect(screen.getByTestId('wiki-rule-retired-note')).toHaveTextContent(/withdrawn from recall/);
  });
});

describe('WikiPage — RuleSet grouping', () => {
  const corpus = [
    rule(),
    rule({ id: 'POL-100', rule_type: 'policy', severity: 'critical', statement: 'One writer per store' }),
  ];

  it('groups by doctrine domain with an ungrouped bucket, behind the toggle', async () => {
    const user = userEvent.setup();
    listConformanceRules.mockResolvedValue({ rules: corpus });
    wire({ rulesets: () => Promise.resolve({ rulesets: [{ domain: 'agent-behavior', rule_ids: ['PAT-001'] }] }) });
    render(<WikiPage />);
    await screen.findAllByTestId('wiki-rule-row');

    await user.click(await screen.findByTestId('wiki-group-toggle'));
    const groups = screen.getAllByTestId('wiki-ruleset-group');
    expect(groups.map((g) => g.getAttribute('data-domain'))).toEqual(['agent-behavior', 'ungrouped']);
    expect(within(groups[0]!).getByTestId('wiki-rule-row')).toHaveAttribute('data-rule-id', 'PAT-001');
    expect(within(groups[1]!).getByTestId('wiki-rule-row')).toHaveAttribute('data-rule-id', 'POL-100');

    // The toggle flips back to the flat list.
    await user.click(screen.getByTestId('wiki-group-toggle'));
    expect(screen.queryByTestId('wiki-ruleset-group')).toBeNull();
  });

  it('says plainly when this daemon does not serve grouping', async () => {
    listConformanceRules.mockResolvedValue({ rules: corpus });
    wire(); // rulesets route absent
    render(<WikiPage />);

    expect(await screen.findByTestId('wiki-groups-unsupported')).toHaveTextContent(/not served by this daemon/);
    expect(screen.queryByTestId('wiki-group-toggle')).toBeNull();
  });
});
