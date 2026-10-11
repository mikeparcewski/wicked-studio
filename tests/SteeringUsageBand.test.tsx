import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SteeringUsageBand } from '../src/components/SteeringUsageBand.js';
import { SteeringPage } from '../src/components/SteeringPage.js';
import { useEvalReportStore } from '../src/store/evalReport.js';
import { ApiError } from '../src/api/errors.js';
import type { SteeringRule } from '../src/api/steering.js';
import type { WikiScoreboard } from '../src/api/wiki.js';
import type { GovernanceClaim } from '../src/api/types.js';
import type { EvalReport } from '../src/api/testing.js';
import { makeView } from './factories.js';

/**
 * The STEERING USAGE band (the /steering landing): when/how steering was used and its
 * success lens — ≤6 dashboardKit tiles, every one a door, every number from a wire the
 * app actually speaks:
 *  - gate evaluations + denials fold the CLAIMS record (real clocks, honest deltas —
 *    zero history renders 0 with NO delta);
 *  - runs-governed joins claim scopes against the one runs list;
 *  - unused rules come from the scoreboard's per_rule evidence, and CLICKING opens the
 *    type page's grid FILTERED to those ids (?usage=unused);
 *  - the latest-eval tile reads the session deposit and renders the honest absent state
 *    when no eval ran;
 *  - a daemon without the claims wire gets "—" tiles that SAY so.
 */

const listClaims = vi.fn();
const listConformanceRules = vi.fn();
const retireConformanceRule = vi.fn();
const upsertConformanceRule = vi.fn();
const apiFetch = vi.fn();

vi.mock('../src/api/client.js', () => ({
  api: {
    listClaims: (...a: unknown[]) => listClaims(...a),
    listConformanceRules: (...a: unknown[]) => listConformanceRules(...a),
    retireConformanceRule: (...a: unknown[]) => retireConformanceRule(...a),
    upsertConformanceRule: (...a: unknown[]) => upsertConformanceRule(...a),
  },
  apiFetch: (...a: unknown[]) => apiFetch(...a),
}));

const DAY = 24 * 3_600_000;
const NOW = 1_800_000_000_000;

function claim(daysAgo: number, decision: GovernanceClaim['decision'] = 'allow', scope = 'wicked-agent/run-1/shared'): GovernanceClaim {
  return {
    claim_id: `c-${daysAgo}-${decision}`,
    scope,
    phase: 'unit-1',
    policy_ids: [],
    decision,
    obligations: [],
    evaluated_context_ref: 'sha256:x',
    criteria: '',
    evaluator_identity: 'wicked-governance@0.1.0',
    evaluated_at: Math.floor((NOW - daysAgo * DAY) / 1000),
  };
}

function rule(id: string, over: Partial<SteeringRule> = {}): SteeringRule {
  return {
    id,
    rule_type: 'pattern',
    statement: `statement for ${id}`,
    severity: 'warn',
    confidence: 0.9,
    targets: {},
    provenance: { source: 'ui', source_kinds: ['doc'] },
    ...over,
  };
}

function scoreboard(perRule: { rule_id: string; denial_claims: number; governs_evidence: number }[]): WikiScoreboard {
  return {
    rules_total: 3,
    rules_active: 3,
    rules_retired: 0,
    typing: { available: false, docs_scanned: 0, statements_total: 0, statements_typed: 0, by_class: {}, docs_untyped: [] },
    connection: { rules_with_ref: 0, refs_resolving: 0, refs_unresolvable: 0, rules_linked: 0 },
    evidence: {
      denial_claims: perRule.reduce((a, r) => a + r.denial_claims, 0),
      rules_evidenced: perRule.filter((r) => r.denial_claims + r.governs_evidence > 0).length,
      evidenced_by_edges: 0,
      governs_evidence_total: perRule.reduce((a, r) => a + r.governs_evidence, 0),
      per_rule: perRule,
    },
    recall_volume: { available: false, reason: 'no writer' },
  };
}

const report: EvalReport = {
  results: [],
  summary: { total: 12, caught: 9, gaps: 2, false_positives: 1 },
  degraded: null,
};

beforeEach(() => {
  cleanup();
  listClaims.mockReset();
  listConformanceRules.mockReset();
  retireConformanceRule.mockReset();
  upsertConformanceRule.mockReset();
  apiFetch.mockReset();
  useEvalReportStore.setState({ latest: null });
});

const RULES = [rule('PAT-001'), rule('PAT-002', { steering_type: 'security' }), rule('PAT-003', { steering_type: 'security' })];

function band(over: Partial<{ navigate: (p: string) => void; runs: ReturnType<typeof makeView>[]; sb: WikiScoreboard | null }> = {}): void {
  const sb = over.sb === undefined ? scoreboard([{ rule_id: 'PAT-001', denial_claims: 3, governs_evidence: 7 }]) : over.sb;
  render(
    <SteeringUsageBand
      runs={over.runs ?? [makeView({ id: 'run-1' }), makeView({ id: 'run-2' })]}
      rules={RULES}
      scoreboard={sb === null ? { kind: 'unsupported' } : { kind: 'loaded', scoreboard: sb }}
      navigate={over.navigate ?? ((): void => undefined)}
      now={NOW}
    />,
  );
}

describe('SteeringUsageBand — the folds', () => {
  it('folds the claims record into evaluations/denials/split/governed, honest deltas', async () => {
    listClaims.mockResolvedValue({
      claims: [
        claim(1), claim(2, 'deny'), claim(3),
        claim(8), claim(9), // prior window
        claim(20), // proves the prior window
      ],
    });
    band();

    const facts = () => screen.getByTestId('steering-usage');
    await waitFor(() => expect(facts()).toHaveAttribute('data-evals', '3'));
    // Delta vs the proven prior window: 3 now, 2 before → +1.
    expect(facts()).toHaveAttribute('data-evals-delta', '1');
    expect(facts()).toHaveAttribute('data-denials', '1');
    expect(facts()).toHaveAttribute('data-split', '2 / 1');
    // run-1 is claimed, run-2 not → 50%.
    expect(facts()).toHaveAttribute('data-governed', '50%');
    expect(screen.getByTestId('steering-usage-governed')).toHaveTextContent('50% of runs checked (1 of 2)');
    expect(screen.getByTestId('steering-usage-delta')).toHaveTextContent('+1 vs the 7 days before');
    // One sentence-case line of facts — KPI tiles are retired (UI-CONTRACT §4.6).
    expect(facts()).toHaveTextContent('3 gate checks in the last 7 days');
  });

  it('ZERO history: 0 evaluations with NO delta ("—", never a fabricated 0%)', async () => {
    listClaims.mockResolvedValue({ claims: [] });
    band();

    await waitFor(() => expect(screen.getByTestId('steering-usage')).toHaveAttribute('data-evals', '0'));
    expect(screen.getByTestId('steering-usage')).toHaveAttribute('data-evals-delta', 'none');
    expect(screen.getByTestId('steering-usage-delta')).toHaveTextContent('Nothing to compare with yet');
    expect(screen.getByTestId('steering-usage')).toHaveAttribute('data-denials-delta', 'none');
  });

  it('a service without the claims wire hides the numbers and SAYS so', async () => {
    listClaims.mockRejectedValue(new ApiError(404, 'not found'));
    band();

    await waitFor(() =>
      expect(screen.getByTestId('steering-usage-claims-note')).toHaveTextContent('doesn’t report gate checks yet'),
    );
    expect(screen.getByTestId('steering-usage')).toHaveAttribute('data-evals', '—');
    expect(screen.getByTestId('steering-usage')).toHaveAttribute('data-governed', '—');
    expect(screen.getByTestId('steering-usage').textContent).not.toMatch(/\b0 gate checks/);
  });

  it('unused rules count active zero-evidence rules; the meta line names the most-used rule', async () => {
    listClaims.mockResolvedValue({ claims: [] });
    band();

    await waitFor(() => expect(screen.getByTestId('steering-usage')).toHaveAttribute('data-unused', '2')); // PAT-002 + PAT-003 (security)
    expect(screen.getByTestId('steering-usage-top')).toHaveTextContent('most used: PAT-001 (10×)');
  });

  it('unused-rules click-through navigates to the majority type page with ?usage=unused', async () => {
    const user = userEvent.setup();
    listClaims.mockResolvedValue({ claims: [] });
    const navigate = vi.fn();
    band({ navigate });

    await user.click(await screen.findByTestId('steering-usage-rules'));
    expect(navigate).toHaveBeenCalledWith('/steering/policies?type=security&usage=unused');
  });

  it('scoreboard unsupported → the unused count is honestly absent, not zero', async () => {
    listClaims.mockResolvedValue({ claims: [] });
    band({ sb: null });

    await waitFor(() => expect(screen.getByTestId('steering-usage-rules-note')).toHaveTextContent('Rule usage isn’t reported'));
    expect(screen.getByTestId('steering-usage')).toHaveAttribute('data-unused', '—');
    expect(screen.queryByTestId('steering-usage-rules')).toBeNull();
  });

  it('latest eval: absent → a door to Testing › Evals', async () => {
    listClaims.mockResolvedValue({ claims: [] });
    const navigate = vi.fn();
    band({ navigate });

    const door = await screen.findByTestId('steering-usage-eval');
    expect(screen.getByTestId('steering-usage')).toHaveAttribute('data-eval', '—');
    expect(door).toHaveTextContent('Run an eval');
    await userEvent.setup().click(door);
    expect(navigate).toHaveBeenCalledWith('/testing/evals');
  });

  it('latest eval: a session deposit renders caught/total + gaps', async () => {
    listClaims.mockResolvedValue({ claims: [] });
    useEvalReportStore.getState().deposit(report, 'dev-behaviors');
    band();

    const door = await screen.findByTestId('steering-usage-eval');
    expect(screen.getByTestId('steering-usage')).toHaveAttribute('data-eval', '9/12');
    expect(door).toHaveTextContent('2 gaps');
  });
});

describe('the ?usage=unused click-through — the grid filters to the unused ids', () => {
  it('the type page grid shows ONLY zero-evidence rules, with the note + Show all', async () => {
    listConformanceRules.mockResolvedValue({ rules: RULES });
    listClaims.mockResolvedValue({ claims: [] });
    apiFetch.mockImplementation((path: unknown) => {
      if (path === '/governance/wiki/scoreboard') {
        return Promise.resolve({ scoreboard: scoreboard([{ rule_id: 'PAT-002', denial_claims: 2, governs_evidence: 0 }]) });
      }
      if (path === '/governance/wiki/meta') return Promise.resolve({ meta: { seeded: true } });
      return Promise.reject(new ApiError(404, 'not found'));
    });

    render(<SteeringPage type="security" navigate={() => undefined} search="?usage=unused" />);

    // PAT-003 (security, zero evidence) stays; PAT-002 (security, evidenced) is filtered out.
    await waitFor(() => expect(screen.getByTestId('steering-usage-filter-note')).toBeInTheDocument());
    await waitFor(() => {
      const rows = screen.getAllByTestId('steering-grid-row');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toHaveAttribute('data-rule-id', 'PAT-003');
    });
    expect(screen.getByTestId('steering-usage-filter-note')).toHaveTextContent('the enforcement record never cites');
    expect(screen.getByTestId('steering-usage-filter-clear')).toHaveAttribute('href', '/steering/policies?type=security');
  });

  it('without the scoreboard the filter says it cannot compute and shows ALL rules', async () => {
    listConformanceRules.mockResolvedValue({ rules: RULES });
    listClaims.mockResolvedValue({ claims: [] });
    apiFetch.mockRejectedValue(new ApiError(404, 'not found'));

    render(<SteeringPage type="security" navigate={() => undefined} search="?usage=unused" />);

    await waitFor(() => expect(screen.getByTestId('steering-usage-filter-note')).toBeInTheDocument());
    expect(screen.getByTestId('steering-usage-filter-note')).toHaveTextContent('can’t say which rules are unused');
    await waitFor(() => expect(screen.getAllByTestId('steering-grid-row')).toHaveLength(2)); // both security rules
  });
});
