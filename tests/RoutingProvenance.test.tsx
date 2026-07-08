import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RoutingProvenance } from '../src/components/RoutingProvenance.js';

describe('RoutingProvenance (§11.5 — why this CLI won)', () => {
  it('renders a council verdict', () => {
    render(
      <RoutingProvenance
        routing={{ method: 'council', winner: 'claude', agreement_pct: 80, returned: 4, dissent: 1 }}
      />,
    );
    const el = screen.getByTestId('routing-provenance');
    expect(el).toHaveTextContent('claude won');
    expect(el).toHaveTextContent('80% agreement');
    expect(el).toHaveTextContent('1 dissent');
  });

  it('renders a degraded fallback with its reason', () => {
    render(<RoutingProvenance routing={{ method: 'degraded', reason: 'no quorum' }} />);
    expect(screen.getByTestId('routing-provenance')).toHaveTextContent('no quorum');
  });

  it('renders the evaluator-distinct reassignment (evaluator != creator)', () => {
    render(<RoutingProvenance routing={{ method: 'evaluator_distinct', winner: 'agy', was: 'claude' }} />);
    const el = screen.getByTestId('routing-provenance');
    expect(el).toHaveTextContent('agy');
    expect(el).toHaveTextContent('was claude');
  });

  it('renders nothing when routing is null (not fabricated)', () => {
    render(<RoutingProvenance routing={null} />);
    expect(screen.queryByTestId('routing-provenance')).toBeNull();
  });
});
