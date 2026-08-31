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

  it('a single-seat council suppresses won/agreement/dissent — no election was held (review #7)', () => {
    render(
      <RoutingProvenance
        routing={{ method: 'council', winner: 'claude', agreement_pct: 100, returned: 1, seated: 1, dissent: 0 }}
      />,
    );
    const el = screen.getByTestId('routing-provenance');
    expect(el).toHaveAttribute('data-seats', '1');
    expect(el).toHaveTextContent('claude — single seat, no vote held');
    expect(el).not.toHaveTextContent('won');
    expect(el).not.toHaveTextContent('agreement');
    expect(el).not.toHaveTextContent('dissent');
  });

  it('a multi-seat council keeps the full verdict line (seated known)', () => {
    render(
      <RoutingProvenance
        routing={{ method: 'council', winner: 'claude', agreement_pct: 67, returned: 4, seated: 6, dissent: 2 }}
      />,
    );
    const el = screen.getByTestId('routing-provenance');
    expect(el).toHaveTextContent('claude won · 67% agreement · 4 of 6 seats · 2 dissent');
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
