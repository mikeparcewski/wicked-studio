import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';

/**
 * The rule page's bounded look into recent steps (DC-S8 B11, "Where it was considered"): the look is
 * keyed by what there is to look in, not by the runs list — a drawer opened before the runs arrived
 * gets its look when they do; a refresh of the same runs reads nothing again; a step dispatched since
 * is read; a daemon without the route stops the look.
 */

const apiFetch = vi.fn();
vi.mock('../src/api/client.js', () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }));

const { RuleOrigin } = await import('../src/components/decisions/RuleOrigin.js');
const { resetConsideredStoreForTest, useConsideredStore } = await import('../src/store/considered.js');
const { ApiError } = await import('../src/api/errors.js');
type SteeringRule = import('../src/api/steering.js').SteeringRule;
type SessionView = import('../src/api/types.js').SessionView;
type Consideration = import('../src/api/considered.js').Consideration;

function rule(over: Partial<SteeringRule> = {}): SteeringRule {
  return {
    id: 'proposal:pr-auto', rule_type: 'policy', statement: 'Always check the payment provider’s records', severity: 'warn',
    confidence: 0.9, targets: { project: 'upload-endpoint' }, provenance: { source: 'chat', source_kinds: ['decision'] },
    steering_type: 'development', ...over,
  };
}

function view(id: string, units: Array<{ ord: number; status: string }>, createdAt = 1): SessionView {
  return {
    session: { id, status: 'executing', problem: 'Fix the double charge', project_id: 'upload-endpoint', created_at: createdAt, unit_ix: 0 },
    units: units.map((u) => ({ ...u, phase_ref: 'build', stage: 'build', description: 'build it' })),
  } as unknown as SessionView;
}

function unitConsideration(runId: string, ord: number): Consideration {
  return {
    subject: { kind: 'unit', run_id: runId, ord, attempt: 0 }, key: `considered:${runId}:${ord}:0`, project_id: 'upload-endpoint',
    considered: [{ id: 'proposal:pr-auto', statement: 'Always check the payment provider’s records', severity: 'warn', project: 'upload-endpoint' }],
    set_aside: [], cited: [], source: 'considerRules',
  } as unknown as Consideration;
}

const consideredCalls = (): string[] => apiFetch.mock.calls.map((c) => String(c[0])).filter((p) => p.includes('/considered'));
const navigate = vi.fn();

beforeEach(() => {
  apiFetch.mockReset();
  navigate.mockReset();
  resetConsideredStoreForTest();
  apiFetch.mockImplementation((path: unknown) => {
    const p = String(path);
    if (p.startsWith('/decisions')) return Promise.resolve({ decisions: [] });
    const m = /^\/runs\/([^/]+)\/units\/(\d+)\/considered/.exec(p);
    if (m !== null) return Promise.resolve(unitConsideration(m[1]!, Number(m[2])));
    return Promise.reject(new Error(`unexpected read ${p}`));
  });
});

describe('RuleOrigin — the bounded look into recent steps', () => {
  it('looks once the runs arrive, not again on a refresh of the same runs, and again for a step dispatched since', async () => {
    const { rerender, container } = render(<RuleOrigin rule={rule()} runs={[]} navigate={navigate} />);
    await waitFor(() => expect(apiFetch.mock.calls.some((c) => String(c[0]).startsWith('/decisions'))).toBe(true));
    expect(consideredCalls()).toEqual([]);

    // The runs list finishes loading after the drawer opened: the look happens now.
    rerender(<RuleOrigin rule={rule()} runs={[view('r-1', [{ ord: 0, status: 'done' }])]} navigate={navigate} />);
    await waitFor(() => expect(consideredCalls()).toEqual(['/runs/r-1/units/0/considered?attempt=0']));
    await waitFor(() => expect(container.querySelector('[data-testid="rule-where"]')?.getAttribute('data-probed')).toBe('1'));
    expect(container.querySelectorAll('[data-testid="rule-where-row"]')).toHaveLength(1);

    // The list refreshes with the same steps (new objects, same content): nothing is read again.
    rerender(<RuleOrigin rule={rule()} runs={[view('r-1', [{ ord: 0, status: 'done' }])]} navigate={navigate} />);
    await act(async () => { await Promise.resolve(); });
    expect(consideredCalls()).toHaveLength(1);

    // A step dispatched since is new ground: it is read; the step already read is not.
    rerender(<RuleOrigin rule={rule()} runs={[view('r-1', [{ ord: 0, status: 'done' }, { ord: 1, status: 'executing' }])]} navigate={navigate} />);
    await waitFor(() => expect(consideredCalls()).toEqual(['/runs/r-1/units/0/considered?attempt=0', '/runs/r-1/units/1/considered?attempt=0']));
    await waitFor(() => expect(container.querySelector('[data-testid="rule-where"]')?.getAttribute('data-probed')).toBe('2'));
  });

  it('never looks into a pending step, and caps the look at the newest runs', async () => {
    const runs = [
      view('r-old', [{ ord: 0, status: 'done' }], 1),
      view('r-new', [{ ord: 0, status: 'pending' }, { ord: 1, status: 'done' }], 2),
    ];
    render(<RuleOrigin rule={rule()} runs={runs} navigate={navigate} />);
    await waitFor(() => expect(consideredCalls()).toEqual(['/runs/r-new/units/1/considered?attempt=0', '/runs/r-old/units/0/considered?attempt=0']));
  });

  it('a daemon without the route (404 on the first read) stops the look and draws no block', async () => {
    apiFetch.mockImplementation((path: unknown) => {
      const p = String(path);
      if (p.startsWith('/decisions')) return Promise.resolve({ decisions: [] });
      // Fastify's route-absent 404: `{message: 'Route GET:… not found', error: 'Not Found'}` — the wire is the `error`.
      return Promise.reject(new ApiError(404, 'Not Found'));
    });
    const { container } = render(<RuleOrigin rule={rule()} runs={[view('r-1', [{ ord: 0, status: 'done' }, { ord: 1, status: 'done' }])]} navigate={navigate} />);
    await waitFor(() => expect(useConsideredStore.getState().unsupported).toBe(true));
    await act(async () => { await Promise.resolve(); });
    expect(consideredCalls()).toHaveLength(1);
    expect(container.querySelector('[data-testid="rule-where"]')).toBeNull();
  });
});

describe('RuleOrigin — what the default layer says when a read fails', () => {
  it('a failed /decisions read: a plain sentence, never the daemon’s message (it may carry a path or a token)', async () => {
    apiFetch.mockImplementation((path: unknown) => {
      const p = String(path);
      if (p.startsWith('/decisions')) return Promise.reject(new ApiError(500, 'EACCES: /Users/alice/.wicked-crew/decisions.db', 'EACCES: /Users/alice/.wicked-crew/decisions.db'));
      return Promise.reject(new ApiError(404, 'Not Found'));
    });
    const { container } = render(<RuleOrigin rule={rule()} runs={[]} navigate={navigate} />);
    await waitFor(() => expect(container.querySelector('[data-testid="rule-origin-error"]')).not.toBeNull());
    expect(container.querySelector('[data-testid="rule-origin-error"]')?.textContent).toBe('Could not read where this rule came from.');
    expect(container.textContent).not.toContain('/Users/alice');
  });

  it('a decision that failed to land: the history row carries no path either', async () => {
    apiFetch.mockImplementation((path: unknown) => {
      const p = String(path);
      if (p.startsWith('/decisions')) {
        return Promise.resolve({ decisions: [{
          id: 'dec-x', at: 1_700_000_000_000, project_id: 'upload-endpoint', host: 'studio-chat',
          origin: { actor: { id: 'operator', kind: 'human', trust: 'operator' }, auth_mode: 'required', chat_id: 'chat-pay', turn_id: 'd1', words: 'always check', words_source: 'typed', redacted: false },
          derived: { statement: 'Always check', polarity: 'do', key: 'k', scope: 'project', steering_type: 'development', template: 'T1-always', exclusions: [] },
          route: 'auto', state: 'landing_failed', how: 'auto', rule_id: 'proposal:pr-auto', error: 'EACCES: /Users/alice/.wicked-crew/rules.db',
        }] });
      }
      return Promise.reject(new ApiError(404, 'Not Found'));
    });
    const { container } = render(<RuleOrigin rule={rule()} runs={[]} navigate={navigate} />);
    await waitFor(() => expect(container.querySelector('[data-testid="rule-history-row"]')).not.toBeNull());
    expect(container.querySelector('[data-testid="rule-history-row"]')?.textContent).toContain('Could not be remembered');
    expect(container.textContent).not.toContain('/Users/alice');
  });
});

describe('RuleOrigin — the look takes the newest steps', () => {
  it('a run with 13 dispatched steps: the look reads its 12 newest ordinals, newest first, and skips the oldest', async () => {
    const units = Array.from({ length: 13 }, (_, ord) => ({ ord, status: 'done' }));
    render(<RuleOrigin rule={rule()} runs={[view('r-long', units)]} navigate={navigate} />);
    await waitFor(() => expect(consideredCalls()).toHaveLength(12));
    expect(consideredCalls()[0]).toBe('/runs/r-long/units/12/considered?attempt=0');
    expect(consideredCalls()).not.toContain('/runs/r-long/units/0/considered?attempt=0');
  });
});

describe('RuleOrigin — titles and words in the default layer carry no home path (codex r4)', () => {
  it('a step row named by a run whose problem names a home path reads ~/…; the remembered words too', async () => {
    apiFetch.mockImplementation((path: unknown) => {
      const p = String(path);
      if (p.startsWith('/decisions')) {
        return Promise.resolve({ decisions: [{
          id: 'dec-y', at: 1_700_000_000_000, project_id: 'upload-endpoint', host: 'studio-chat',
          origin: { actor: { id: 'operator', kind: 'human', trust: 'operator' }, auth_mode: 'required', chat_id: 'chat-pay', turn_id: 'd1', words: 'always check /Users/alice/repo/payments first', words_source: 'typed', redacted: false },
          derived: { statement: 'Always check', polarity: 'do', key: 'k', scope: 'project', steering_type: 'development', template: 'T1-always', exclusions: [] },
          route: 'auto', state: 'remembered', how: 'auto', rule_id: 'proposal:pr-auto',
        }] });
      }
      const m = /^\/runs\/([^/]+)\/units\/(\d+)\/considered/.exec(p);
      if (m !== null) return Promise.resolve(unitConsideration(m[1]!, Number(m[2])));
      return Promise.reject(new ApiError(404, 'Not Found'));
    });
    const v = view('r-home', [{ ord: 1, status: 'done' }]);
    (v.session as { problem: string }).problem = 'Fix the upload in /Users/alice/repo/payments';
    const { container } = render(<RuleOrigin rule={rule()} runs={[v]} navigate={navigate} />);
    await waitFor(() => expect(container.querySelector('[data-testid="rule-where-row"]')).not.toBeNull());
    await waitFor(() => expect(container.querySelector('[data-testid="rule-origin-words"]')).not.toBeNull());
    expect(container.querySelector('[data-testid="rule-where-open"]')?.textContent).toContain('~/repo');
    expect(container.querySelector('[data-testid="rule-origin-words"]')?.textContent).toContain('~/repo/payments');
    expect(container.textContent).not.toContain('/Users/alice');
  });
});
