import { cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RULES_PATH, rulePath } from '../src/api/decisions.js';
import type { SteeringRule } from '../src/api/steering.js';
import { fromYourWords, groupOf, landedWithoutProject, orderRules, rulesSentence } from '../src/board/rulesPage.js';
import { RulesPage } from '../src/components/rules/RulesPage.js';
import { useSteeringRedirect } from '../src/hooks/useLegacyRedirect.js';
import { parseRoute } from '../src/hooks/useRoute.js';
import { ROUTE_SHAPES } from '../src/palette/routeTargets.js';
import { useProjectsStore } from '../src/store/projects.js';

/**
 * S12 (DES-STUDIO-REBUILD-001 §5.4, §11): decision capture PLACED — `/rules` and `/rules/:ruleId`
 * are real routes again, the Rules page is DC's components on one frame (the rule's sentence,
 * ORIGIN, history, where it was considered — `SteeringRuleDrawer` + `RuleOrigin`), the steering
 * grid stays reachable as "All rules", and `rulePath` (what every DC line links to) lands here.
 * No rule model is derived in this repo: the page groups and counts crew's rules, in words.
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

function rule(over: Partial<SteeringRule> = {}): SteeringRule {
  return {
    id: 'PAT-100',
    rule_type: 'pattern',
    statement: 'Prefer the repo’s own test runner',
    severity: 'info',
    confidence: 0.8,
    targets: {},
    provenance: { source: 'ui', source_kinds: ['doc'] },
    steering_type: 'development',
    ...over,
  } as SteeringRule;
}

/** The fixture's three (e2e/uxfix_fixture.py STEERING_RULES): a decision-landed policy, a UI pattern, core's testing starter. */
const WORDS = rule({ id: 'proposal:pr-auto', rule_type: 'policy', statement: 'Always check the payment provider’s records, not just our database', severity: 'warn', targets: { project: 'upload-endpoint' }, provenance: { source: 'chat', source_kinds: ['decision'] } });
const PATTERN = rule();
const TESTING = rule({ id: 'TST-1002', rule_type: 'policy', statement: 'A change to code or config gets Test plus a walkthrough review by a different helper.', severity: 'warn', steering_type: 'testing', applies_to: ['plan.compose'], obligations: ['step:test', 'step:walkthrough'], provenance: { ref: 'seed/testing-starter.json#TST-1002', source_kinds: ['doc'] } as SteeringRule['provenance'] });

/** The decision crew's ledger says landed `proposal:pr-auto` (DC-S4a `DecisionView`; the decisionLine test's shape). */
const DECISION = {
  id: 'dec-auto', at: 1_700_000_000_000, project_id: 'upload-endpoint', host: 'studio-chat',
  origin: {
    actor: { id: 'op', kind: 'human', trust: 'operator' }, auth_mode: 'required', chat_id: 'chat-pay', turn_id: 'd1',
    words: 'from now on, always check the payment provider’s records, not just our database', words_source: 'typed', redacted: false,
  },
  derived: { statement: WORDS.statement, polarity: 'do', key: 'check-provider-records', scope: 'project', steering_type: 'development', template: 'T1-always', exclusions: [] },
  route: 'auto', state: 'remembered', how: 'auto', rule_id: 'proposal:pr-auto', proposal_id: 'pr-auto',
};

beforeEach(() => {
  listConformanceRules.mockReset();
  apiFetch.mockReset();
  // RuleOrigin's reads: the ledger names the decision that landed pr-auto; nothing else is read
  // (runs are empty, so no step is probed) — an unexpected read fails loudly.
  apiFetch.mockImplementation((path: unknown) => {
    const p = String(path);
    if (p.startsWith('/decisions')) return Promise.resolve({ decisions: [DECISION], mode: 'on' });
    return Promise.reject(new Error(`unexpected read ${p}`));
  });
  useProjectsStore.setState({ projects: [{ id: 'upload-endpoint', name: 'Kestrel' }] } as never);
});
afterEach(() => cleanup());

describe('the route', () => {
  it('/rules and /rules/:ruleId are REAL routes (S12) — the retired fold into steering is gone for them', () => {
    expect(parseRoute('/rules')).toMatchObject({ panel: 'rules', ruleId: null });
    expect(parseRoute('/rules/proposal%3Apr-auto')).toMatchObject({ panel: 'rules', ruleId: 'proposal:pr-auto' });
    // The other retired governance addresses still fold.
    expect(parseRoute('/wiki')).toMatchObject({ panel: 'steering', steeringSection: null });
    expect(parseRoute('/policies')).toMatchObject({ panel: 'steering', steeringSection: null });
  });

  it('rulePath — what every DC line links to — lands on the Rules page and parses back to the rule', () => {
    expect(RULES_PATH).toBe('/rules');
    expect(rulePath('proposal:pr-auto')).toBe('/rules/proposal%3Apr-auto');
    expect(parseRoute(rulePath('proposal:pr-auto')).ruleId).toBe('proposal:pr-auto');
  });

  it('the steering redirect leaves the Rules page alone', () => {
    const navigate = vi.fn();
    renderHook(() => useSteeringRedirect('rules', null, '/rules', '', navigate));
    renderHook(() => useSteeringRedirect('rules', null, '/rules/proposal%3Apr-auto', '', navigate));
    expect(navigate).not.toHaveBeenCalled();
  });

  it('⌘K knows the shape (every route is reachable under every skin)', () => {
    const shape = ROUTE_SHAPES.find((s) => s.id === 'rules');
    expect(shape?.example).toBe('/rules');
    expect(shape?.is(parseRoute('/rules'))).toBe(true);
    expect(shape?.is(parseRoute('/rules/x'))).toBe(true);
  });
});

describe('the words (no rule model: grouping and counts over crew’s rules)', () => {
  it('a rule crew landed from a decision is "from your words"; a testing rule is testing; the rest are other', () => {
    expect(fromYourWords(WORDS)).toBe(true);
    expect(fromYourWords(PATTERN)).toBe(false);
    expect(fromYourWords(rule({ id: 'proposal:pr-9', provenance: { source: 'chat', source_kinds: [] } }))).toBe(true);
    expect(groupOf(WORDS)).toBe('words');
    expect(groupOf(TESTING)).toBe('testing');
    expect(groupOf(PATTERN)).toBe('other');
  });

  it('DC §5.2: a decision policy that landed without its project is said so once — never a scoped one, a pattern, or a retired one', () => {
    expect(landedWithoutProject(rule({ ...WORDS, targets: {} }))).toBe(true);
    expect(landedWithoutProject(WORDS)).toBe(false);
    expect(landedWithoutProject(PATTERN)).toBe(false);
    expect(landedWithoutProject(rule({ ...WORDS, targets: {}, retired: true }))).toBe(false);
  });

  it('orders: from your words, testing, other — newest first inside a group — retired last', () => {
    const older = rule({ ...WORDS, id: 'proposal:pr-old', created_at: 10 });
    const newer = rule({ ...WORDS, id: 'proposal:pr-new', created_at: 20 });
    const gone = rule({ id: 'PAT-001', retired: true });
    expect(orderRules([gone, PATTERN, TESTING, older, newer]).map((r) => r.id)).toStrictEqual(['proposal:pr-new', 'proposal:pr-old', 'TST-1002', 'PAT-100', 'PAT-001']);
  });

  it('the sentence counts what is in force and says the rest only when there is some', () => {
    expect(rulesSentence([])).toBe('No rules yet — helpers work from the defaults.');
    expect(rulesSentence([PATTERN])).toBe('1 rule in force');
    expect(rulesSentence([WORDS, PATTERN, TESTING, rule({ id: 'PAT-001', retired: true })])).toBe('3 rules in force · 1 from your words · 1 testing rule · 1 retired');
  });
});

describe('the page', () => {
  it('lists crew’s rules as sentences, grouped, each opening on its own address; "All rules" reaches the steering grid', async () => {
    listConformanceRules.mockResolvedValue({ rules: [PATTERN, TESTING, WORDS] });
    const navigate = vi.fn();
    render(<RulesPage ruleId={null} runs={[]} navigate={navigate} />);
    await waitFor(() => expect(screen.getByTestId('rules-sentence').textContent).toBe('3 rules in force · 1 from your words · 1 testing rule'));
    const groups = screen.getAllByTestId('rules-group').map((g) => g.getAttribute('data-group'));
    expect(groups).toStrictEqual(['words', 'testing', 'other']);
    const rows = screen.getAllByTestId('rules-row');
    expect(rows.map((r) => r.getAttribute('data-rule-id'))).toStrictEqual(['proposal:pr-auto', 'TST-1002', 'PAT-100']);
    // The row's line is DC's sentence for the rule, with the project's NAME.
    expect(rows[0]?.querySelector('[data-testid="rules-row-line"]')?.textContent).toBe('A Development rule for Kestrel — helpers are told about it when it applies; it never blocks.');
    expect(screen.queryByTestId('rules-row-aside')).toBeNull();
    const open = rows[0]?.querySelector('[data-testid="rules-row-open"]') as HTMLAnchorElement;
    expect(open.getAttribute('href')).toBe('/rules/proposal%3Apr-auto');
    fireEvent.click(open);
    expect(navigate).toHaveBeenCalledWith('/rules/proposal%3Apr-auto');
    const all = screen.getByTestId('rules-all');
    expect(all.getAttribute('href')).toBe('/steering/policies');
    fireEvent.click(all);
    expect(navigate).toHaveBeenLastCalledWith('/steering/policies');
    // No drawer without a rule in the address; "Followed" is nowhere (DC rev 2 B10).
    expect(screen.queryByTestId('steering-rule-drawer')).toBeNull();
    expect(document.body.textContent).not.toContain('Followed');
  });

  it('says once when a decision policy landed without its project', async () => {
    listConformanceRules.mockResolvedValue({ rules: [rule({ ...WORDS, targets: {} })] });
    render(<RulesPage ruleId={null} runs={[]} navigate={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('rules-row-aside').textContent).toContain('Landed without its project'));
  });

  it('/rules/:ruleId opens the rule as DC’s components — the sentence, ORIGIN, no Hold on a decision rule; closing returns to /rules', async () => {
    listConformanceRules.mockResolvedValue({ rules: [PATTERN, TESTING, WORDS] });
    const navigate = vi.fn();
    render(<RulesPage ruleId="proposal:pr-auto" runs={[]} navigate={navigate} />);
    const drawer = await screen.findByTestId('steering-rule-drawer');
    expect(drawer.querySelector('[data-testid="rule-sentence"]')?.textContent).toBe('A Development rule for Kestrel — helpers are told about it when it applies; it never blocks.');
    expect(drawer.querySelector('[data-testid="steering-rule-statement"]')?.textContent).toBe(WORDS.statement);
    // ORIGIN from the ledger (B11): the operator's verbatim words, read from `/decisions` — DC's component, unchanged.
    await waitFor(() => expect(drawer.querySelector('[data-testid="rule-origin"]')).not.toBeNull());
    expect(drawer.querySelector('[data-testid="rule-origin"]')?.getAttribute('data-decision-id')).toBe('dec-auto');
    expect(drawer.textContent).toContain('from now on, always check the payment provider’s records');
    expect(drawer.textContent).not.toContain('Hold work to it');
    fireEvent.click(drawer.querySelector('[aria-label="Close rule detail"]') as HTMLElement);
    expect(navigate).toHaveBeenCalledWith('/rules');
  });

  it('Hold appears only where DC’s drawer renders it (a testing rule) — the page adds none of its own', async () => {
    listConformanceRules.mockResolvedValue({ rules: [PATTERN, TESTING, WORDS] });
    render(<RulesPage ruleId="TST-1002" runs={[]} navigate={vi.fn()} />);
    const drawer = await screen.findByTestId('steering-rule-drawer');
    expect(drawer.textContent).toContain('Hold work to it');
    expect(screen.getAllByText('Hold work to it')).toHaveLength(1);
  });

  it('a rule the daemon does not list is said to be missing, with the rest of the page still there', async () => {
    listConformanceRules.mockResolvedValue({ rules: [PATTERN] });
    render(<RulesPage ruleId="proposal:pr-gone" runs={[]} navigate={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('rules-missing').textContent).toContain('proposal:pr-gone'));
    expect(screen.getAllByTestId('rules-row')).toHaveLength(1);
    expect(screen.queryByTestId('steering-rule-drawer')).toBeNull();
  });

  it('a failed read says so and offers Try again; it is never shown as "no rules"', async () => {
    listConformanceRules.mockRejectedValueOnce(new Error('daemon away')).mockResolvedValueOnce({ rules: [PATTERN] });
    render(<RulesPage ruleId={null} runs={[]} navigate={vi.fn()} />);
    const err = await screen.findByTestId('rules-error');
    expect(err.textContent).toContain('daemon away');
    expect(screen.queryByTestId('rules-sentence')).toBeNull();
    fireEvent.click(screen.getByTestId('rules-retry'));
    await waitFor(() => expect(screen.getByTestId('rules-sentence').textContent).toBe('1 rule in force'));
    expect(listConformanceRules).toHaveBeenCalledTimes(2);
  });
});
