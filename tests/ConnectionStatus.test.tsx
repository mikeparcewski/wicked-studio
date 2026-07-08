import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConnectionStatus } from '../src/components/ConnectionStatus.js';
import { useConnectionStore } from '../src/store/connection.js';

function renderWithStatus(status: 'connecting' | 'connected' | 'disconnected') {
  useConnectionStore.setState({ status });
  return render(<ConnectionStatus />);
}

describe('ConnectionStatus', () => {
  it('shows "connecting" aria-label when connecting', () => {
    renderWithStatus('connecting');
    expect(screen.getByTestId('connection-status')).toHaveAttribute('aria-label', 'connecting');
  });

  it('shows "connected" aria-label when connected', () => {
    renderWithStatus('connected');
    expect(screen.getByTestId('connection-status')).toHaveAttribute('aria-label', 'connected');
  });

  it('shows "disconnected" aria-label when disconnected (SC-S05)', () => {
    renderWithStatus('disconnected');
    const el = screen.getByTestId('connection-status');
    expect(el).toBeInTheDocument();
    expect(el).toHaveAttribute('aria-label', 'disconnected');
  });

  it('renders without throwing in any state', () => {
    for (const status of ['connecting', 'connected', 'disconnected'] as const) {
      const { unmount } = renderWithStatus(status);
      expect(screen.getByTestId('connection-status')).toBeInTheDocument();
      unmount();
    }
  });
});
