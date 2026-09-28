import { describe, it, expect } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { ConnectionStatus } from '../src/components/ConnectionStatus.js';
import { useConnectionStore } from '../src/store/connection.js';

function renderWithStatus(status: 'connecting' | 'connected' | 'disconnected') {
  useConnectionStore.setState({ status });
  return render(<ConnectionStatus />);
}

describe('ConnectionStatus — the lost-connection banner (crew#551)', () => {
  it('renders nothing while connecting or connected (the health rail pill owns those)', () => {
    for (const status of ['connecting', 'connected'] as const) {
      const { unmount } = renderWithStatus(status);
      expect(screen.queryByTestId('connection-status')).toBeNull();
      unmount();
    }
  });

  it('when disconnected: an alert that names the same one-line fix `wicked-crew status` prints (SC-S05)', () => {
    renderWithStatus('disconnected');
    const el = screen.getByTestId('connection-status');
    expect(el).toHaveAttribute('role', 'alert');
    expect(el).toHaveAttribute('aria-label', 'disconnected');
    const remedy = screen.getByTestId('connection-remedy').textContent ?? '';
    expect(remedy).toContain('wicked-crew serve');
    expect(remedy).toContain('wicked-crew serve --install-service');
    expect(remedy).toContain('wicked-crew status');
  });

  it('goes away when the socket reconnects', () => {
    renderWithStatus('disconnected');
    expect(screen.getByTestId('connection-status')).toBeInTheDocument();
    act(() => useConnectionStore.setState({ status: 'connected' }));
    expect(screen.queryByTestId('connection-status')).toBeNull();
  });
});
