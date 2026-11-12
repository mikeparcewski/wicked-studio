import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RequirementsCoverageSummary } from '../src/components/RequirementsCoverageSummary.js';

const coverage = { realPct: 86, minPct: 80, behaviorBearing: 100, real: 86, placeholders: 10, unmapped: 4, notProduct: 5 };
const weightedNote = 'Each requirement counts by confidence: a validated one counts fully, a rule counts its confidence, an unscored one counts 0.75.';

describe('RequirementsCoverageSummary', () => {
  it('leads with weighted coverage and explains it for hover and assistive technology, keeping the stated bar', () => {
    render(<RequirementsCoverageSummary coverage={{ ...coverage, weightedPct: 62 }} bar />);
    const root = screen.getByTestId('requirements-coverage');
    expect(root).toHaveAttribute('data-weighted-pct', '62');
    expect(screen.getByTestId('requirements-coverage-headline').textContent).toBe('62% confidence-weighted · 86% stated · minimum 80%');
    const weighted = screen.getByText('62% confidence-weighted');
    expect(weighted).toHaveAttribute('title', weightedNote);
    expect(weighted).toHaveAccessibleDescription(weightedNote);
    expect(root.querySelector('.wk-reqcov-fill')).toHaveStyle({ width: '86%' });
    expect(root.querySelector('.wk-reqcov-min')).toHaveStyle({ left: '80%' });
  });

  it('keeps the existing headline, bar label and breakdown when weighted coverage is absent', () => {
    render(<RequirementsCoverageSummary coverage={coverage} bar note="more detail" />);
    expect(screen.getByTestId('requirements-coverage')).not.toHaveAttribute('data-weighted-pct');
    expect(screen.getByTestId('requirements-coverage-headline').textContent).toBe('86% real requirements · minimum 80% · more detail');
    expect(screen.getByRole('img')).toHaveAccessibleName('86% real requirements; the minimum is 80%');
    expect(screen.queryByTitle(weightedNote)).toBeNull();
    expect(screen.getByTestId('requirements-coverage-breakdown').textContent).toBe('86 real · 10 placeholders (unconfirmed) · 4 unmapped · 5 not product code');
  });

  it('treats zero weighted coverage as present and preserves the under-1% wording', () => {
    render(<RequirementsCoverageSummary coverage={{ ...coverage, realPct: 0, weightedPct: 0 }} />);
    expect(screen.getByTestId('requirements-coverage')).toHaveAttribute('data-weighted-pct', '0');
    expect(screen.getByTestId('requirements-coverage-headline').textContent).toBe('Under 1% confidence-weighted · Under 1% stated · minimum 80%');
    expect(screen.getByText('Under 1% confidence-weighted')).toHaveAccessibleDescription(weightedNote);
  });
});
