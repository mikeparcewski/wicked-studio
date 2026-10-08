import type { DocGrounding } from '../api/interactive.js';
import { groundingChip } from '../board/groundingChip.js';

/**
 * studio#567: "Grounded on N repos · <source> · skipped K" for a document row, from the structured
 * `grounding` record (crew#512). Renders nothing when the record is absent — the row is unchanged.
 */
export function GroundingChip({ grounding }: { grounding: DocGrounding | null | undefined }): React.ReactElement | null {
  const chip = groundingChip(grounding);
  if (chip === null) return null;
  return (
    <span
      data-testid="doc-grounding-chip"
      className="wk-grounding-chip"
      style={{ fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', color: 'var(--ink-dim)', flexShrink: 0 }}
    >
      <span data-testid="doc-grounding-repos" title={chip.reposTitle === '' ? undefined : chip.reposTitle}>{chip.label}</span>
      {' · '}
      <span data-testid="doc-grounding-source">{chip.source}</span>
      {chip.skipped !== null && (
        <>
          {' · '}
          <span data-testid="doc-grounding-skipped" title={chip.skipped.title} style={{ opacity: 0.7 }}>
            skipped {chip.skipped.count}
          </span>
        </>
      )}
    </span>
  );
}
