import { Fragment, useId, useState } from 'react';
import { CircleHelp } from 'lucide-react';
import { coverageHeadline, coverageParts, PLACEHOLDER_NOTE, WEIGHTED_NOTE, type RequirementsCoverage } from '../board/requirementsState.js';

/**
 * A repository's coverage, led by confidence-weighted coverage when available, then a breakdown of the counts.
 * Placeholders are marked unconfirmed and never counted in the share. A bar (when shown) fills the real share only,
 * with the minimum ticked.
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
  const weightedNoteId = useId();
  // The weighting's one line: a hover title, and a help button that shows it (keyboard and touch have no hover).
  const [whyOpen, setWhyOpen] = useState(false);
  const headline = coverageHeadline(c);
  const weightedEnd = headline.indexOf(' · ');
  return (
    <div data-testid={testId} data-real-pct={c.realPct} data-weighted-pct={c.weightedPct} data-min-pct={c.minPct} className={`wk-reqcov${inline ? ' wk-reqcov--inline' : ''}`}>
      <p className="wk-reqcov-head" data-testid={`${testId}-headline`}>
        {c.weightedPct !== undefined ? <>
          <span title={WEIGHTED_NOTE} aria-describedby={weightedNoteId}>{headline.slice(0, weightedEnd)}</span>
          <button type="button" data-testid={`${testId}-weighted-why`} aria-expanded={whyOpen} aria-controls={weightedNoteId}
            aria-label="How the confidence weighting counts" title={WEIGHTED_NOTE} onClick={() => setWhyOpen((v) => !v)} className="wk-reqcov-why">
            <CircleHelp aria-hidden size={13} />
          </button>
          {headline.slice(weightedEnd)}
        </> : headline}
        {note !== undefined && <span className="wk-reqcov-note"> · {note}</span>}
      </p>
      {c.weightedPct !== undefined && (
        <span id={weightedNoteId} data-testid={`${testId}-weighted-note`} className={whyOpen ? 'wk-reqcov-why-note' : 'wk-visually-hidden'}>{WEIGHTED_NOTE}</span>
      )}
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
