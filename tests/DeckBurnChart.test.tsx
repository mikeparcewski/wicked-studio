// The live-pulse burn chart — cumulative session spend from the /ws cliUsage frames (burnSteps).

import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useRuntimeStore } from '../src/store/runtime.js';
import { DeckBurnChart } from '../src/components/DeckBurnChart.js';

afterEach(cleanup);

describe('DeckBurnChart', () => {
  it('shows the session spend total + a curve once cliUsage frames arrive', () => {
    useRuntimeStore.setState({
      logs: {
        'run-a': [
          { seq: 1, type: 'cliUsage', ts: 1000, costUsd: 0.5, detail: 'usage $0.50' },
          { seq: 2, type: 'cliUsage', ts: 2000, costUsd: 0.7, detail: 'usage $0.70' },
        ],
      } as never,
    });
    render(<DeckBurnChart />);
    expect(screen.getByTestId('burn-total').textContent).toContain('$1.20');
    expect(screen.getByTestId('home-burn-chart').querySelector('polyline')).not.toBeNull();
  });

  it('honestly shows no usage when nothing has burned this session', () => {
    useRuntimeStore.setState({ logs: {} });
    render(<DeckBurnChart />);
    expect(screen.getByTestId('burn-total').textContent).toContain('no usage yet');
    expect(screen.getByTestId('home-burn-chart').querySelector('polyline')).toBeNull();
  });
});
