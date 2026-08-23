import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SteeringGate } from '../src/components/SteeringGate.js';
import * as client from '../src/api/client.js';

/**
 * DES-UX-001 §7.7 (slice AC) — the gate panel honors a / r: with the panel
 * holding focus, 'a' fires the SAME POST the Approve button fires (exactly
 * once), 'r' the Reject one; unfocused or typing, the keys yield.
 */

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(client.api, 'confirmGate').mockResolvedValue({ status: 'resumed' } as never);
  vi.spyOn(client.api, 'cancelRun').mockResolvedValue({ ok: true } as never);
});

function renderGate(): void {
  render(<SteeringGate runId="r-gate" ord={2} prompt="Proceed with unit 2?" />);
}

describe('SteeringGate a/r keys (§7.7)', () => {
  it("'a' with the panel focused fires the approve POST exactly once", async () => {
    renderGate();
    screen.getByTestId('steering-gate').focus();
    fireEvent.keyDown(window, { key: 'a' });
    fireEvent.keyDown(window, { key: 'a' }); // double-tap: the in-flight guard drops it
    await waitFor(() => expect(client.api.confirmGate).toHaveBeenCalledTimes(1));
    expect(client.api.confirmGate).toHaveBeenCalledWith('r-gate', { approve: true });
  });

  it("'r' with the panel focused fires the reject POST", async () => {
    renderGate();
    screen.getByTestId('steering-approve').focus(); // any focus INSIDE the panel arms the keys
    fireEvent.keyDown(window, { key: 'r' });
    await waitFor(() => expect(client.api.confirmGate).toHaveBeenCalledTimes(1));
    expect(client.api.confirmGate).toHaveBeenCalledWith('r-gate', { approve: false });
  });

  it('yields silently while the panel does not hold focus', () => {
    renderGate();
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.keyDown(window, { key: 'a' });
    expect(client.api.confirmGate).not.toHaveBeenCalled();
  });

  it('typing a and r into the steer textarea stays typing (EC21 guard)', () => {
    renderGate();
    const ta = screen.getByTestId('steering-amend');
    ta.focus();
    fireEvent.keyDown(ta, { key: 'a' });
    fireEvent.keyDown(ta, { key: 'r' });
    expect(client.api.confirmGate).not.toHaveBeenCalled();
  });
});
