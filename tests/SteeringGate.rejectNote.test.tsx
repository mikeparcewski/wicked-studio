// DES-RUN-NARRATOR §7 — the reject-note gap: the steer textarea's text now
// rides REJECT as `amend` (the same `{approve:false, amend}` wire
// GateRejectNote already speaks; the daemon's gate audit records the note on
// the decision). An empty textarea still sends the bare reject — pinned by
// the pre-existing SteeringGate.test.tsx case, unchanged.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SteeringGate } from '../src/components/SteeringGate.js';
import * as client from '../src/api/client.js';

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('SteeringGate reject carries the typed note (wire assertion)', () => {
  it('Reject with a note → confirmGate(id, {approve:false, amend: note})', async () => {
    const confirm = vi.spyOn(client.api, 'confirmGate').mockResolvedValue({ ok: true } as never);
    render(<SteeringGate runId="run-1" ord={2} prompt="Approve the design phase?" />);

    await userEvent.type(
      screen.getByTestId('steering-amend'),
      'wrong direction — the retry path must be config-driven',
    );
    await userEvent.click(screen.getByTestId('steering-reject'));

    await waitFor(() =>
      expect(confirm).toHaveBeenCalledWith('run-1', {
        approve: false,
        amend: 'wrong direction — the retry path must be config-driven',
      }),
    );
  });

  it('Reject with an empty note stays the bare {approve:false}', async () => {
    const confirm = vi.spyOn(client.api, 'confirmGate').mockResolvedValue({ ok: true } as never);
    render(<SteeringGate runId="run-1" ord={2} prompt="Approve?" />);
    await userEvent.click(screen.getByTestId('steering-reject'));
    await waitFor(() => expect(confirm).toHaveBeenCalledWith('run-1', { approve: false }));
  });
});
