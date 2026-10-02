import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SteeringGate } from '../src/components/SteeringGate.js';
import * as client from '../src/api/client.js';
import { useAnnotationStore } from '../src/store/annotations.js';

/**
 * DES-UX-001 §7.7 (slice AC) — the gate panel honors a / r: with the panel
 * holding focus, 'a' fires the SAME POST the Approve button fires (exactly
 * once), 'r' the Reject one; unfocused or typing, the keys yield.
 */

beforeEach(() => {
  vi.restoreAllMocks();
  // Slice BD re-scope (DES-UX-002 §8.3): a leaked session draft would mount
  // the textarea under the pre-populated contract — start draft-free.
  useAnnotationStore.setState({ drafts: {} });
  vi.spyOn(client.api, 'confirmGate').mockResolvedValue({ status: 'resumed' } as never);
  vi.spyOn(client.api, 'cancelRun').mockResolvedValue({ ok: true } as never);
});

function renderGate(): void {
  render(<SteeringGate runId="r-gate" ord={2} prompt="Proceed with unit 2?" />);
}

const ALT_A = { key: 'å', code: 'KeyA', altKey: true }; // macOS Option+A reports key 'å'
const ALT_R = { key: '®', code: 'KeyR', altKey: true };

describe('SteeringGate ⌥A/⌥R keys (§7.7, §5.6)', () => {
  it('⌥A with the panel focused fires the approve POST exactly once', async () => {
    renderGate();
    screen.getByTestId('steering-gate').focus();
    fireEvent.keyDown(window, ALT_A);
    fireEvent.keyDown(window, ALT_A); // double-tap: the in-flight guard drops it
    await waitFor(() => expect(client.api.confirmGate).toHaveBeenCalledTimes(1));
    expect(client.api.confirmGate).toHaveBeenCalledWith('r-gate', { approve: true });
  });

  it('⌥R with the panel focused fires the reject POST', async () => {
    renderGate();
    screen.getByTestId('steering-approve').focus(); // any focus INSIDE the panel arms the keys
    fireEvent.keyDown(window, ALT_R);
    await waitFor(() => expect(client.api.confirmGate).toHaveBeenCalledTimes(1));
    expect(client.api.confirmGate).toHaveBeenCalledWith('r-gate', { approve: false });
  });

  it('yields silently while the panel does not hold focus', () => {
    renderGate();
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.keyDown(window, ALT_A);
    expect(client.api.confirmGate).not.toHaveBeenCalled();
  });

  it('a bare a or r with the panel focused never answers the gate (§5.6: letters type)', () => {
    renderGate();
    screen.getByTestId('steering-gate').focus();
    fireEvent.keyDown(window, { key: 'a' });
    fireEvent.keyDown(window, { key: 'r' });
    // A handled decision disables Approve synchronously (it is queued before any POST), so an
    // enabled Approve proves nothing was queued — not merely that the POST has not run yet.
    expect(screen.getByTestId('steering-approve')).not.toBeDisabled();
    expect(client.api.confirmGate).not.toHaveBeenCalled();
  });

  it('typing a and r into the steer textarea stays typing (EC21 guard)', () => {
    renderGate();
    const ta = screen.getByTestId('steering-amend');
    ta.focus();
    fireEvent.keyDown(ta, { key: 'a' });
    fireEvent.keyDown(ta, { key: 'r' });
    fireEvent.keyDown(ta, ALT_A);
    fireEvent.keyDown(ta, ALT_R);
    expect(screen.getByTestId('steering-approve')).not.toBeDisabled();
    expect(client.api.confirmGate).not.toHaveBeenCalled();
  });
});
