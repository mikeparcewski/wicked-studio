import { fireEvent, render, screen } from '@testing-library/react';
import { WEIGHTED_NOTE } from '../src/board/requirementsState.js';
import { describe, expect, it } from 'vitest';
import { RequirementsCoverageSummary } from '../src/components/RequirementsCoverageSummary.js';

const coverage = { realPct: 86, minPct: 80, behaviorBearing: 100, real: 86, placeholders: 10, unmapped: 4, notProduct: 5 };
const weightedNote = WEIGHTED_NOTE;

describe('RequirementsCoverageSummary', () => {
  it('leads with weighted coverage and explains it for hover and assistive technology, keeping the stated bar', () => {
    render(<RequirementsCoverageSummary coverage={{ ...coverage, weightedPct: 62 }} bar />);
    const root = screen.getByTestId('requirements-coverage');
    expect(root).toHaveAttribute('data-weighted-pct', '62');
    expect(screen.getByTestId('requirements-coverage-headline').textContent).toBe('62% confidence-weighted · 86% stated · minimum 80%');
    const weighted = screen.getByText('62% confidence-weighted');
    expect(weighted).toHaveAttribute('title', weightedNote);
    expect(weighted).toHaveAccessibleDescription(weightedNote);
    // Keyboard and touch: a help button shows the same line (hover is not the only way to read it).
    const why = screen.getByTestId('requirements-coverage-weighted-why');
    expect(why).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByTestId('requirements-coverage-weighted-note')).toHaveClass('wk-visually-hidden');
    fireEvent.click(why);
    expect(why).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('requirements-coverage-weighted-note')).toHaveClass('wk-reqcov-why-note');
    expect(screen.getByTestId('requirements-coverage-weighted-note').textContent).toBe(weightedNote);
    expect(root.querySelector('.wk-reqcov-fill')).toHaveStyle({ width: '86%' });
    expect(root.querySelector('.wk-reqcov-min')).toHaveStyle({ left: '80%' });
  });

  it('keeps the existing headline, bar label and breakdown when weighted coverage is absent', () => {
    render(<RequirementsCoverageSummary coverage={coverage} bar note="more detail" />);
    expect(screen.getByTestId('requirements-coverage')).not.toHaveAttribute('data-weighted-pct');
    expect(screen.getByTestId('requirements-coverage-headline').textContent).toBe('86% real requirements · minimum 80% · more detail');
    expect(screen.getByRole('img')).toHaveAccessibleName('86% real requirements; the minimum is 80%');
    expect(screen.queryByTitle(weightedNote)).toBeNull();
    expect(screen.queryByTestId('requirements-coverage-weighted-why')).toBeNull();
    expect(screen.getByTestId('requirements-coverage-breakdown').textContent).toBe('86 real · 10 placeholders (unconfirmed) · 4 unmapped · 5 not product code');
  });

  it('treats zero weighted coverage as present and preserves the under-1% wording', () => {
    render(<RequirementsCoverageSummary coverage={{ ...coverage, realPct: 0, weightedPct: 0 }} />);
    expect(screen.getByTestId('requirements-coverage')).toHaveAttribute('data-weighted-pct', '0');
    expect(screen.getByTestId('requirements-coverage-headline').textContent).toBe('Under 1% confidence-weighted · Under 1% stated · minimum 80%');
    expect(screen.getByText('Under 1% confidence-weighted')).toHaveAccessibleDescription(weightedNote);
  });
});
