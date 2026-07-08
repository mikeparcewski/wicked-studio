import type { WorkUnit } from '../api/types.js';
import { WorkUnitDetail } from './WorkUnitDetail.js';

interface Props {
  runId: string;
  units: WorkUnit[];
  /** The ord the run is paused before, if any (marks the gated unit for per-unit approve). */
  gateOrd?: number;
  onResolved?: () => void;
}

/**
 * The ordered work-unit list (was `PhaseGraph`; DES-STUDIO-001 §11.9). Units are
 * rendered by `ord`; the fixed phase ladder is gone — units are planned from the
 * brief.
 */
export function UnitList({ runId, units, gateOrd, onResolved }: Props): React.ReactElement {
  if (units.length === 0) {
    return (
      <p data-testid="unit-list" className="text-xs text-gray-400">
        No units planned yet.
      </p>
    );
  }

  const ordered = [...units].sort((a, b) => a.ord - b.ord);

  return (
    <ol className="flex flex-col gap-1.5" data-testid="unit-list">
      {ordered.map((unit) => {
        const props =
          onResolved !== undefined
            ? { runId, unit, isGated: gateOrd === unit.ord, onResolved }
            : { runId, unit, isGated: gateOrd === unit.ord };
        return <WorkUnitDetail key={unit.id} {...props} />;
      })}
    </ol>
  );
}
