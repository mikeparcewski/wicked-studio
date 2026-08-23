import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProvenanceLine } from '../src/components/ProvenanceLine.js';

/**
 * DES-UX-001 §3.4/§3.5 — the one provenance line: named when known, the
 * brief's exact degraded copy when not; the line never renders nothing.
 * Lineage cross-links (§4.3) ride inside it and navigate.
 */

describe('ProvenanceLine', () => {
  it('renders actor id, kind badge, and channel when known', () => {
    render(<ProvenanceLine
      provenance={{ state: 'known', actorId: 'mika', actorKind: 'human', channel: 'studio' }}
      testId="run-provenance"
    />);
    const line = screen.getByTestId('run-provenance');
    expect(line).toHaveTextContent('launched by mika');
    expect(line).toHaveTextContent('human');
    expect(line).toHaveTextContent('via studio');
  });

  it('degrades to the exact copy — the line is never absent', () => {
    render(<ProvenanceLine provenance={{ state: 'unknown' }} testId="run-provenance" />);
    expect(screen.getByTestId('run-provenance'))
      .toHaveTextContent('launched via API (actor unknown)');
  });

  it('renders the degraded copy while the audit answer is still null', () => {
    render(<ProvenanceLine provenance={null} testId="notif-provenance" />);
    expect(screen.getByTestId('notif-provenance'))
      .toHaveTextContent('launched via API (actor unknown)');
  });

  it('lineage cross-links render short ids and navigate on click', async () => {
    const user = userEvent.setup();
    const onSelectRun = vi.fn();
    render(<ProvenanceLine
      provenance={{ state: 'known', actorId: 'mika', actorKind: 'human', channel: 'API' }}
      retryOf="r-original-run"
      retriedAs={['r-child-run-1']}
      onSelectRun={onSelectRun}
      testId="run-provenance"
    />);
    const back = screen.getByTestId('lineage-retry-of');
    expect(back).toHaveTextContent('retry of r-origin');
    await user.click(back);
    expect(onSelectRun).toHaveBeenCalledWith('r-original-run');
    const fwd = screen.getByTestId('lineage-retried-as');
    expect(fwd).toHaveTextContent('retried as r-child-');
    await user.click(fwd);
    expect(onSelectRun).toHaveBeenCalledWith('r-child-run-1');
  });

  it('DTO lineage renders even when the audit answer degraded', () => {
    render(<ProvenanceLine provenance={{ state: 'unknown' }} retryOf="r-original-run"
      testId="run-provenance" />);
    const line = screen.getByTestId('run-provenance');
    expect(line).toHaveTextContent('launched via API (actor unknown)');
    expect(screen.getByTestId('lineage-retry-of')).toHaveTextContent('retry of r-origin');
  });
});
