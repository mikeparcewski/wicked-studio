import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PolicyManager } from '../src/components/PolicyManager.js';
import type { GovernancePolicy } from '../src/api/types.js';

const listPolicies = vi.fn();
const retirePolicy = vi.fn();
const upsertPolicy = vi.fn();

vi.mock('../src/api/client.js', () => ({
  api: {
    listPolicies: (...a: unknown[]) => listPolicies(...a),
    retirePolicy: (...a: unknown[]) => retirePolicy(...a),
    upsertPolicy: (...a: unknown[]) => upsertPolicy(...a),
  },
}));

function policy(over: Partial<GovernancePolicy> = {}): GovernancePolicy {
  return {
    id: 'deny-secrets',
    kind: 'output',
    applies_to: ['creator'],
    effect: 'deny',
    trigger: { contains: 'AKIA' },
    obligations: [],
    criteria: '',
    severity: 'high',
    rule: 'No AWS keys in output',
    ...over,
  };
}

beforeEach(() => {
  listPolicies.mockReset();
  retirePolicy.mockReset();
  upsertPolicy.mockReset();
});

describe('PolicyManager — retire', () => {
  it('takes two clicks: the first arms, the second calls the API', async () => {
    // Retiring stops a policy from deciding gates. One misplaced click should not do that, so the
    // button arms before it fires — the assertion that matters is that NOTHING was called after
    // the first click.
    const user = userEvent.setup();
    listPolicies.mockResolvedValue({ policies: [policy()] });
    retirePolicy.mockResolvedValue(undefined);
    render(<PolicyManager />);
    await screen.findByText('deny-secrets');

    await user.click(screen.getByRole('button', { name: 'Retire' }));
    expect(retirePolicy).not.toHaveBeenCalled();

    await user.click(await screen.findByRole('button', { name: 'Confirm retire' }));
    await waitFor(() => expect(retirePolicy).toHaveBeenCalledWith('deny-secrets'));
  });

  it('reloads after retiring, so the row shows the server state rather than a guess', async () => {
    // The component must not paint "retired" from its own optimism — the second list call is the
    // one that proves the store agreed. A retire that 404s server-side would otherwise leave the
    // UI claiming an enforcement change that never happened.
    const user = userEvent.setup();
    listPolicies
      .mockResolvedValueOnce({ policies: [policy()] })
      .mockResolvedValueOnce({ policies: [policy({ retired: true })] });
    retirePolicy.mockResolvedValue(undefined);
    render(<PolicyManager />);
    await screen.findByText('deny-secrets');

    await user.click(screen.getByRole('button', { name: 'Retire' }));
    await user.click(await screen.findByRole('button', { name: 'Confirm retire' }));

    await waitFor(() => expect(listPolicies).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('retired')).toBeTruthy();
  });

  it('offers no Retire button on an already-retired policy', async () => {
    // Retire is idempotent server-side, but re-offering it reads as "this still enforces".
    listPolicies.mockResolvedValue({ policies: [policy({ retired: true })] });
    render(<PolicyManager />);
    await screen.findByText('deny-secrets');

    expect(screen.queryByRole('button', { name: 'Retire' })).toBeNull();
    // Retired policies stay editable and stay listed: past decisions cite them by id.
    expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy();
  });

  it('surfaces a failed retire instead of silently leaving the policy enforcing', async () => {
    const user = userEvent.setup();
    listPolicies.mockResolvedValue({ policies: [policy()] });
    retirePolicy.mockRejectedValue(new Error('404 policy not found'));
    render(<PolicyManager />);
    await screen.findByText('deny-secrets');

    await user.click(screen.getByRole('button', { name: 'Retire' }));
    await user.click(await screen.findByRole('button', { name: 'Confirm retire' }));

    expect(await screen.findByText(/404 policy not found/)).toBeTruthy();
  });
});
