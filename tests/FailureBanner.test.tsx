import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FailureBanner } from '../src/components/FailureBanner.js';
import type { LoggedEvent } from '../src/store/runtime.js';
import { makeView, makeUnit } from './factories.js';

const errorLog: LoggedEvent[] = [
  { seq: 1, type: 'unitExecuting', ts: 0, detail: 'executing' },
  { seq: 2, type: 'error', ts: 0, detail: 'error: worker exited non-zero' },
];

describe('FailureBanner (§11.5 — run-halted explainer)', () => {
  it('renders nothing for a live (non-terminal-bad) run', () => {
    render(<FailureBanner view={makeView({ status: 'executing' })} log={[]} />);
    expect(screen.queryByTestId('failure-banner')).toBeNull();
  });

  it('explains a failed run using the error frame + per-unit denial reasons (real data)', () => {
    const view = makeView({ status: 'failed' }, [
      makeUnit({ id: 'u1', ord: 1, status: 'rejected', denial_reason: 'governance: touches secrets' }),
    ]);
    render(<FailureBanner view={view} log={errorLog} />);
    const banner = screen.getByTestId('failure-banner');
    expect(banner).toHaveAttribute('data-kind', 'failed');
    expect(banner).toHaveTextContent('Run halted');
    expect(banner).toHaveTextContent('worker exited non-zero');
    expect(banner).toHaveTextContent('governance: touches secrets');
  });

  it('renders a cancelled banner distinctly', () => {
    render(<FailureBanner view={makeView({ status: 'cancelled' })} log={[]} />);
    const banner = screen.getByTestId('failure-banner');
    expect(banner).toHaveAttribute('data-kind', 'cancelled');
    expect(banner).toHaveTextContent('Run cancelled');
  });
});
