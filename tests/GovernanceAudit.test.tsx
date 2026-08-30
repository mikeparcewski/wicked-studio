import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { mergeRunModel } from '../src/hooks/useRunModel.js';
import type { CoreEvent } from '../src/api/types.js';
import { makeView, makeUnit } from './factories.js';

// The J1 self-contradiction pin: on a run whose halt banner + Decisions panel
// carry a governance deny, the Governance panel must never read "No governance
// claims recorded for this run" — the two surfaces read DIFFERENT wires (the
// conformance claims store vs the run's own snapshot + event tail), and the
// panel has to state that split instead of contradicting the page.

const listClaims = vi.fn();
const getRunAcceptance = vi.fn();

vi.mock('../src/api/client.js', () => ({
  api: new Proxy({}, {
    get: (_t, prop) => {
      if (String(prop) === 'listClaims') return listClaims;
      if (String(prop) === 'getRunAcceptance') return getRunAcceptance;
      return vi.fn().mockResolvedValue({});
    },
  }),
}));

import {
  GovernanceAudit,
  modelUnenforcedUnits,
  resolveEnforcementBanner,
  runRecordDecisions,
} from '../src/components/GovernanceAudit.js';
import type { AcceptanceConformance, RunAcceptanceView } from '../src/api/types.js';

const DENIAL =
  'Governance DENIED unit 1 (review): the refactored middleware drops the token-refresh path';

/** A run shaped like the reproduced 61fcef-class page: gate deny in the tail,
 *  denial_reason on the unit, nothing on the claims wire. */
function deniedModel() {
  const snap = makeView({ id: 'r-auth', status: 'failed' }, [
    makeUnit({ ord: 0, status: 'done' }),
    makeUnit({ id: 'r-auth:u1', ord: 1, status: 'rejected', denial_reason: DENIAL }),
  ]);
  const events: CoreEvent[] = [{
    type: 'gateEvaluated', session: 'r-auth', ord: 1,
    criterion: 'the middleware refactor keeps every existing auth test green',
    hasDeterministicFloor: true, deterministicPass: true,
    agentVerdict: 'fail', agentReasoning: 'drops the token-refresh path',
    evaluatorPass: true, evaluatorPolicies: [],
    denialReason: DENIAL, combined: false,
  } as unknown as CoreEvent];
  return mergeRunModel(snap, events);
}

beforeEach(() => {
  listClaims.mockReset();
  getRunAcceptance.mockReset();
  // Default: a pre-conformance daemon (no `conformance` field) → the panel
  // takes the legacy claims-wire fallback the older tests pin.
  getRunAcceptance.mockResolvedValue({});
});

/** A conformance section with sane clean defaults, override per test. */
function conformanceWith(over: Partial<AcceptanceConformance> = {}): AcceptanceConformance {
  return {
    claimsAvailable: true,
    claims: [],
    denials: 0,
    advisoryDenials: 0,
    denied: false,
    enforcement: { status: 'enforced', unenforced: [], armedUnits: [0], reason: 'armed' },
    guardrailed: true,
    summary: 'guardrailed — enforcement verified and 0 claim(s) carry no standing denial',
    ...over,
  };
}

function acceptanceWith(conformance: AcceptanceConformance, satisfied = true): RunAcceptanceView {
  return {
    runId: 'r-auth',
    gate: {
      required: true,
      satisfied,
      verdict: satisfied ? 'PASS' : 'FAIL',
      runStatus: satisfied ? 'passed' : 'failed',
      reason: satisfied ? 'PASS — verdict v-1 by reviewer-x' : 'FAIL — verdict v-1 by reviewer-x',
    },
    conformance,
  };
}

describe('runRecordDecisions — the run-record derivation', () => {
  it('collects gate denies and does not double-count the unit denial_reason that matches', () => {
    const decisions = runRecordDecisions(deniedModel());
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({ ord: 1, source: 'gate', detail: DENIAL });
  });

  it('collects a snapshot denial_reason when no gate event survived', () => {
    const model = mergeRunModel(
      makeView({ id: 'r-x' }, [makeUnit({ ord: 2, denial_reason: 'denied: no evidence' })]),
      [],
    );
    expect(runRecordDecisions(model)).toEqual([
      { ord: 2, source: 'unit', detail: 'denied: no evidence' },
    ]);
  });

  it('collects hook denies and never collects approvals', () => {
    const model = mergeRunModel(makeView({ id: 'r-h' }, [makeUnit({ ord: 0 })]), [
      { type: 'governanceHookFired', session: 'run-1', ord: 0, attempt: 0,
        toolName: 'Write', decision: 'deny', denyingPolicy: 'pol-1' } as unknown as CoreEvent,
      { type: 'governanceHookFired', session: 'run-1', ord: 0, attempt: 0,
        toolName: 'Read', decision: 'allow' } as unknown as CoreEvent,
    ]);
    expect(runRecordDecisions(model)).toEqual([
      { ord: 0, source: 'hook', detail: 'Write denied by pol-1' },
    ]);
  });

  it('is empty for a run with no governance activity at all', () => {
    const model = mergeRunModel(makeView({ id: 'r-clean' }, [makeUnit({ ord: 0 })]), []);
    expect(runRecordDecisions(model)).toEqual([]);
  });
});

describe('GovernanceAudit — non-contradiction on an empty claims wire', () => {
  it('names its own wire as empty AND surfaces the run-record deny, never the flat "no governance" copy', async () => {
    listClaims.mockResolvedValue({ claims: [] });
    render(<GovernanceAudit model={deniedModel()} />);

    await waitFor(() => expect(screen.getByTestId('governance-wire-empty')).toBeInTheDocument());
    expect(screen.getByTestId('governance-wire-empty').textContent)
      .toMatch(/claims wire.*holds no claims/s);
    const record = screen.getByTestId('governance-run-record');
    expect(record.textContent).toContain('DENY');
    expect(record.textContent).toContain('unit #1');
    expect(record.textContent).toContain('token-refresh');
    expect(record.textContent).toContain('Decisions panel');
    // The contradiction sentence must be gone on this run.
    expect(screen.queryByText(/No governance claims recorded for this run/)).toBeNull();
  });

  it('keeps the honest empty state on a run with no governance activity anywhere', async () => {
    listClaims.mockResolvedValue({ claims: [] });
    const model = mergeRunModel(makeView({ id: 'r-clean' }, [makeUnit({ ord: 0 })]), []);
    render(<GovernanceAudit model={model} />);
    await waitFor(() =>
      expect(screen.getByText(/No governance claims recorded for this run/)).toBeInTheDocument());
    expect(screen.queryByTestId('governance-run-record')).toBeNull();
  });

  it('renders the claims themselves when the wire carries them (unchanged path)', async () => {
    listClaims.mockResolvedValue({ claims: [{
      claim_id: 'clm-1', scope: 'r-auth', phase: 'review', policy_ids: [],
      decision: 'deny', obligations: [], evaluated_context_ref: 'ctx',
      criteria: null, evaluator_identity: 'conformance', evaluated_at: 1,
    }] });
    render(<GovernanceAudit model={deniedModel()} />);
    await waitFor(() => expect(screen.getByText('DENY')).toBeInTheDocument());
    expect(screen.queryByTestId('governance-wire-empty')).toBeNull();
  });

  it('also matches run-scoped claims under the engine scope grammar (wicked-agent/<id>/…)', async () => {
    listClaims.mockResolvedValue({ claims: [{
      claim_id: 'clm-scoped', scope: 'wicked-agent/r-auth/unit/u1', phase: 'build', policy_ids: [],
      decision: 'deny', obligations: [], evaluated_context_ref: 'ctx',
      criteria: null, evaluator_identity: 'conformance', evaluated_at: 1,
    }] });
    render(<GovernanceAudit model={deniedModel()} />);
    await waitFor(() => expect(screen.getByText('DENY')).toBeInTheDocument());
  });
});

// ── AW-14 + AW-18: the conformance section, rendered where humans look ────────

/** A model whose event tail carries a governanceUnenforced frame (FINDING-063). */
function unenforcedModel() {
  const snap = makeView({ id: 'r-auth', status: 'executing' }, [
    makeUnit({ ord: 0, status: 'done' }),
    makeUnit({ id: 'r-auth:u1', ord: 1, status: 'distributed' }),
  ]);
  const events: CoreEvent[] = [{
    type: 'governanceUnenforced', session: 'r-auth', ord: 1, attempt: 0,
    cli: 'codex', reason: "unit is governed but 'codex' has no input-governance adapter",
  } as unknown as CoreEvent];
  return mergeRunModel(snap, events);
}

describe('modelUnenforcedUnits + resolveEnforcementBanner — deny-dominates across sources', () => {
  it('collects unenforced units off the run model', () => {
    expect(modelUnenforcedUnits(unenforcedModel())).toEqual([
      { ord: 1, cli: 'codex', reason: "unit is governed but 'codex' has no input-governance adapter" },
    ]);
  });

  it('an unenforced unit dominates even a guardrailed-claiming wire', () => {
    const banner = resolveEnforcementBanner(conformanceWith(), unenforcedModel());
    expect(banner).toMatchObject({ kind: 'unenforced' });
  });

  it('no wire + no model signal = no banner (an older daemon claims nothing either way)', () => {
    const model = mergeRunModel(makeView({ id: 'r-clean' }, [makeUnit({ ord: 0 })]), []);
    expect(resolveEnforcementBanner(undefined, model)).toBeNull();
  });

  it('maps the wire statuses: guardrailed / enforced-not-clean / ungoverned / unverifiable', () => {
    const model = mergeRunModel(makeView({ id: 'r-x' }, [makeUnit({ ord: 0 })]), []);
    expect(resolveEnforcementBanner(conformanceWith(), model)).toMatchObject({ kind: 'guardrailed' });
    expect(
      resolveEnforcementBanner(conformanceWith({ guardrailed: false, denied: true, denials: 1 }), model),
    ).toMatchObject({ kind: 'enforced-not-clean' });
    expect(
      resolveEnforcementBanner(
        conformanceWith({
          guardrailed: false,
          enforcement: { status: 'ungoverned', unenforced: [], armedUnits: [], reason: 'no signal' },
        }),
        model,
      ),
    ).toMatchObject({ kind: 'ungoverned' });
    expect(
      resolveEnforcementBanner(
        conformanceWith({
          guardrailed: false,
          enforcement: { status: 'unverifiable', unenforced: [], armedUnits: [], reason: 'log unavailable' },
        }),
        model,
      ),
    ).toMatchObject({ kind: 'unverifiable' });
  });
});

describe('GovernanceAudit — the conformance section (crew ≥ 0.8 wire)', () => {
  it('a wiki-rule violation appears where humans look: rule id + statement, without a click', async () => {
    getRunAcceptance.mockResolvedValue(
      acceptanceWith(
        conformanceWith({
          guardrailed: false,
          denied: true,
          denials: 1,
          claims: [{
            claimId: 'clm-deny', scope: 'wicked-agent/r-auth/shared', phase: 'build',
            decision: 'deny', policyIds: ['no-unsafe'],
            rules: [{ severity: 'Critical', ruleId: 'POL-002', statement: 'all governed outputs must cite their evidence' }],
            obligations: ['conform:Critical:POL-002:all governed outputs must cite their evidence'],
            evaluator: 'wicked-governance', evaluatedAt: 100, advisory: false,
          }],
          summary: '1 governance denial(s) stand against this run (rules cited: POL-002) — deny-dominates',
        }),
        false,
      ),
    );
    render(<GovernanceAudit model={deniedModel()} />);

    await waitFor(() => expect(screen.getByTestId('conformance-claim')).toBeInTheDocument());
    const citation = screen.getByTestId('conformance-rule-citation');
    expect(citation.textContent).toContain('POL-002');
    expect(citation.textContent).toContain('all governed outputs must cite their evidence');
    // The QE verdict sits BESIDE the governance one.
    expect(screen.getByTestId('acceptance-gate-line').textContent).toContain('QE acceptance: DENIED');
    // Denied ⇒ never the guardrailed banner.
    expect(screen.getByTestId('governance-enforcement').getAttribute('data-status')).toBe('enforced-not-clean');
    // The legacy wire is not consulted on this path.
    expect(listClaims).not.toHaveBeenCalled();
  });

  it('an unenforced run is NEVER claimed guardrailed — the banner names the unit, CLI, and reason', async () => {
    getRunAcceptance.mockResolvedValue(
      acceptanceWith(
        conformanceWith({
          guardrailed: false,
          enforcement: {
            status: 'unenforced',
            unenforced: [{ ord: 1, attempt: 0, cli: 'codex', reason: 'no input-governance adapter' }],
            armedUnits: [0],
            reason: '1 governed unit(s) ran with UNCHECKED tool calls on codex',
          },
          summary: 'no standing denial, but NOT guardrailed — unenforced',
        }),
      ),
    );
    render(<GovernanceAudit model={deniedModel()} />);

    await waitFor(() =>
      expect(screen.getByTestId('governance-enforcement').getAttribute('data-status')).toBe('unenforced'));
    expect(screen.getByText(/UNENFORCED — governed unit\(s\) ran with unchecked tool calls/)).toBeInTheDocument();
    expect(screen.getByTestId('governance-unenforced-unit').textContent).toContain('codex');
    expect(screen.queryByText('GUARDRAILED')).toBeNull();
  });

  it('renders GUARDRAILED only when the wire affirmatively says so', async () => {
    getRunAcceptance.mockResolvedValue(acceptanceWith(conformanceWith()));
    const model = mergeRunModel(makeView({ id: 'r-clean' }, [makeUnit({ ord: 0 })]), []);
    render(<GovernanceAudit model={model} />);
    await waitFor(() => expect(screen.getByText('GUARDRAILED')).toBeInTheDocument());
    expect(screen.getByTestId('governance-enforcement').getAttribute('data-status')).toBe('guardrailed');
  });

  it('an unreadable claims wire is surfaced as unavailable, never as clean-empty', async () => {
    getRunAcceptance.mockResolvedValue(
      acceptanceWith(
        conformanceWith({
          claimsAvailable: false,
          claimsError: 'store locked',
          guardrailed: false,
          summary: 'conformance claims unreadable: store locked — not claimed clean',
        }),
      ),
    );
    render(<GovernanceAudit model={deniedModel()} />);
    await waitFor(() => expect(screen.getByTestId('governance-claims-unavailable')).toBeInTheDocument());
    expect(screen.getByTestId('governance-claims-unavailable').textContent).toContain('store locked');
    expect(screen.queryByText(/No conformance claims scoped/)).toBeNull();
  });

  it('a run-model unenforced unit dominates the panel even on the legacy fallback path', async () => {
    // Older daemon: no conformance on the wire, empty claims — but the run's own
    // durable event tail says a governed unit ran unchecked. The banner renders.
    listClaims.mockResolvedValue({ claims: [] });
    render(<GovernanceAudit model={unenforcedModel()} />);
    await waitFor(() =>
      expect(screen.getByTestId('governance-enforcement').getAttribute('data-status')).toBe('unenforced'));
    expect(screen.getByTestId('governance-unenforced-unit').textContent).toContain('codex');
    expect(screen.queryByText('GUARDRAILED')).toBeNull();
  });

  it('the coverage boundary is written down on every path (AW-18 / arch-R16)', async () => {
    // Conformance path…
    getRunAcceptance.mockResolvedValue(acceptanceWith(conformanceWith()));
    const model = mergeRunModel(makeView({ id: 'r-clean' }, [makeUnit({ ord: 0 })]), []);
    const first = render(<GovernanceAudit model={model} />);
    await waitFor(() => expect(screen.getByTestId('governance-coverage-boundary')).toBeInTheDocument());
    expect(screen.getByTestId('governance-coverage-boundary').textContent).toMatch(/claude seats only/);
    first.unmount();

    // …and the legacy fallback path.
    getRunAcceptance.mockResolvedValue({});
    listClaims.mockResolvedValue({ claims: [] });
    render(<GovernanceAudit model={model} />);
    await waitFor(() => expect(screen.getByTestId('governance-coverage-boundary')).toBeInTheDocument());
  });
});
