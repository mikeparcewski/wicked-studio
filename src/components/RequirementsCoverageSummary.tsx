import { Fragment } from 'react';
import { coverageHeadline, coverageParts, PLACEHOLDER_NOTE, type RequirementsCoverage } from '../board/requirementsState.js';

/**
 * A repository's REAL-requirements share (domain-real WIRE 2026-11-01): "54% real requirements · minimum 80%", then
 * "3,182 real · 2,577 placeholders · 27 unmapped · 2,380 not product code". Placeholders are unconfirmed: they are
 * marked so, never counted in the share, and a bar (when shown) fills the real share only, with the minimum ticked.
 * One component for the requirements view, its not-generated state and the domain-graph modal.
 */
export function RequirementsCoverageSummary({ coverage: c, testId = 'requirements-coverage', inline = false, bar = false, note }: {
  coverage: RequirementsCoverage;
  testId?: string;
  /** Headline and breakdown on one wrapping line (a header row) instead of stacked. */
  inline?: boolean;
  bar?: boolean;
  /** A muted clause after the headline. */
  note?: string;
}): React.ReactElement {
  return (
    <div data-testid={testId} data-real-pct={c.realPct} data-min-pct={c.minPct} className={`wk-reqcov${inline ? ' wk-reqcov--inline' : ''}`}>
      <p className="wk-reqcov-head" data-testid={`${testId}-headline`}>
        {coverageHeadline(c)}
        {note !== undefined && <span className="wk-reqcov-note"> · {note}</span>}
      </p>
      {bar && (
        <div className="wk-reqcov-bar" role="img" aria-label={`${c.realPct}% real requirements; the minimum is ${c.minPct}%`}>
          <span className="wk-reqcov-fill" style={{ width: `${c.realPct}%` }} />
          <span className="wk-reqcov-min" style={{ left: `${c.minPct}%` }} />
        </div>
      )}
      <p className="wk-reqcov-parts" data-testid={`${testId}-breakdown`}>
        {coverageParts(c).map((p, i) => (
          <Fragment key={p.key}>
            {i > 0 && ' · '}
            {p.key === 'placeholders' ? (
              <span data-part={p.key} data-unconfirmed="true" className="wk-reqcov-unconfirmed" title={PLACEHOLDER_NOTE}>
                {p.text}<span className="wk-visually-hidden"> (unconfirmed)</span>
              </span>
            ) : (
              <span data-part={p.key}>{p.text}</span>
            )}
          </Fragment>
        ))}
      </p>
    </div>
  );
}
