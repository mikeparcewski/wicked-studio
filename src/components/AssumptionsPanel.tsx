import type { RunModel } from '../hooks/useRunModel.js';

interface Props {
  model: RunModel;
}

/**
 * FR-6 Assumptions — **proto** (NFR-3 labeled). No engine backing exists yet: the real
 * version needs a skill convention that emits structured assumptions. Until then this
 * derives a thin proxy from council **dissent** on the snapshot's routing (a dissenting
 * seat = an unsettled judgement the run is proceeding past). Every item cites a real
 * `routing.dissent`; when there's no signal the panel says "coming", never invents one.
 */
export function AssumptionsPanel({ model }: Props): React.ReactElement {
  const dissented = model.units.filter(
    (u) => u.routing !== null && u.routing.method === 'council' && u.routing.dissent > 0,
  );

  return (
    <div data-testid="assumptions" className="flex flex-col gap-2 text-[11px]">
      <p className="rounded border border-dashed border-purple-300 bg-purple-50 p-1.5 text-purple-600">
        proto — derived from council dissent; structured-assumptions skill convention pending
      </p>
      {dissented.length === 0 ? (
        <p className="text-gray-400">
          No dissent signal yet. The full assumptions surface (assumed toolchain, no-rollback,
          …) is coming with the skill convention.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {dissented.map((u) => {
            const r = u.routing;
            const dissent = r !== null && r.method === 'council' ? r.dissent : 0;
            const winner = r !== null && r.method === 'council' ? r.winner : '';
            return (
              <li key={u.ord} className="rounded border border-gray-200 p-1.5 text-gray-600">
                unit #{u.ord}: {dissent} dissenting seat{dissent === 1 ? '' : 's'} vs winner{' '}
                <span className="font-mono">{winner}</span> — proceeding past an unsettled call
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
