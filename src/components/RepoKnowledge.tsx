import type { KnowMark, MarkTarget } from '../board/repoKnowledge.js';
import { useDisplayText } from '../hooks/useHomePath.js';

/**
 * What we know about a repository, as small marks (board/repoKnowledge.ts). Each mark is a link to the thing
 * itself (the code graph, the requirements, the requirements graph, a run); a mark with nothing behind it is
 * plain text. `strip`: a row of pills under a repository's row; `band`: the repository page's tiles.
 */
export function KnowMarks({ marks, onOpen, variant = 'strip', repoName, testId = 'repo-know' }: {
  marks: readonly KnowMark[];
  onOpen: (target: MarkTarget, mark: KnowMark) => void;
  variant?: 'strip' | 'band';
  /** Names the repository in each mark's accessible name (a list holds many). */
  repoName?: string;
  testId?: string;
}): React.ReactElement {
  // A mark's sentence can carry the engine's own words (a code-graph finding names a path), so it is drawn through the
  // default layer's formatter: `~/…` for the home directory unless "Show technical details" is on (studio#458).
  const display = useDisplayText();
  return (
    <ul className={`wk-know wk-know--${variant}`} data-testid={testId} aria-label={repoName === undefined ? 'What we know' : `What we know about ${repoName}`}>
      {marks.map((m) => {
        const body = (
          <>
            <MarkGlyph mark={m} />
            <span className="wk-know-words">
              <span className="wk-know-label">{m.label}</span>
              <span className="wk-know-value" data-testid="repo-know-value">{m.value}</span>
            </span>
            {m.flag !== undefined && <span className="wk-know-flag" data-testid="repo-know-flag">{m.flag}</span>}
          </>
        );
        const title = display(m.title);
        const common = { className: 'wk-know-mark', 'data-testid': 'repo-know-mark', 'data-mark': m.id, 'data-tone': m.tone, title };
        return (
          <li key={m.id}>
            {m.target.kind === 'none' ? (
              <span {...common} data-link="false">{body}</span>
            ) : (
              <button type="button" {...common} data-link="true" aria-label={`${repoName !== undefined ? `${repoName}: ` : ''}${title.replace(/\.$/, '')}. Open it`}
                onClick={() => onOpen(m.target, m)}>
                {body}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** A tone dot, or for the requirements the real share as a small meter with the minimum marked. */
function MarkGlyph({ mark }: { mark: KnowMark }): React.ReactElement {
  if (mark.meter !== undefined) {
    return (
      <span className="wk-know-meter" aria-hidden data-testid="repo-know-meter" data-pct={mark.meter.pct} data-min={mark.meter.min}>
        <span className="wk-know-meter-fill" style={{ width: `${mark.meter.pct}%` }} />
        <span className="wk-know-meter-min" style={{ left: `${mark.meter.min}%` }} />
      </span>
    );
  }
  return <span className="wk-know-dot" aria-hidden />;
}
