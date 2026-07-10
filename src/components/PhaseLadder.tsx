import type { RunModel, UnitModel } from '../hooks/useRunModel.js';

interface Props {
  model: RunModel;
}

const STATUS_DOT: Record<UnitModel['status'], { ring: string; label: string }> = {
  pending: { ring: 'border-gray-300 bg-white text-gray-400', label: 'pending' },
  // HONESTY (cockpit review): the engine collapses distribute + execute into one `distributed` status,
  // so a unit here is dispatched and may or may not have started running — label it the lower-bound truth
  // ("dispatched"), never the overstated "executing".
  distributed: { ring: 'border-blue-400 bg-blue-50 text-blue-600', label: 'dispatched' },
  done: { ring: 'border-green-500 bg-green-50 text-green-700', label: 'done' },
  rejected: { ring: 'border-red-500 bg-red-50 text-red-700', label: 'rejected' },
};

const STAGE_TINT: Record<UnitModel['stage'], string> = {
  recon: 'text-blue-600',
  build: 'text-green-600',
  review: 'text-indigo-600',
  test: 'text-amber-600',
};

/**
 * FR-1 Phase ladder — the run's units as a track with each unit's status and the governed
 * gate markers between them. A gate marker (◆) is shown where a real `gateEvaluated` landed
 * for that unit, or where the run's `human_confirm` policy places a human gate. The current
 * unit (`session.unit_ix`) is ringed. Derived entirely from lifecycle + snapshot — no fakes.
 */
export function PhaseLadder({ model }: Props): React.ReactElement {
  const { units, session } = model;

  const humanGateAt = (ord: number): boolean => {
    const hc = session.human_confirm;
    if (hc === 'all') return true;
    if (hc === 'none') return false;
    return hc.before === ord;
  };

  if (units.length === 0) {
    return (
      <div data-testid="phase-ladder" className="text-xs text-gray-400">
        No units planned yet.
      </div>
    );
  }

  return (
    <div data-testid="phase-ladder" className="flex flex-col gap-2">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
        Phase ladder
      </p>
      <ol className="flex flex-wrap items-stretch gap-1">
        {units.map((u, i) => {
          // An insight-only ord (minted from a cliUsage/dataUsed/etc. the snapshot hasn't
          // backfilled) has placeholder stage/status — render it neutrally as "resolving…",
          // never as a real green BUILD tile, until the authoritative snapshot lands.
          if (!u.resolved) {
            return (
              <li
                key={u.ord}
                className="flex items-center gap-1"
                data-testid="ladder-unit"
                data-ord={u.ord}
                data-resolving="true"
              >
                {i > 0 && <span className="h-px w-3 bg-gray-300" aria-hidden />}
                <div
                  className="flex min-w-[3.5rem] flex-col items-center rounded border border-dashed border-gray-300 bg-white px-2 py-1 text-gray-400"
                  title={`unit #${u.ord} — resolving (awaiting snapshot)`}
                >
                  <span className="text-[10px] font-semibold">#{u.ord}</span>
                  <span className="text-[9px] italic text-gray-400">resolving…</span>
                </div>
              </li>
            );
          }
          const dot = STATUS_DOT[u.status];
          const isCurrent = u.ord === session.unit_ix;
          const gate = u.gateEvals.length > 0;
          const gateDenied = u.gateEvals.some((g) => !g.combined) || u.status === 'rejected';
          const human = humanGateAt(u.ord);
          return (
            <li key={u.ord} className="flex items-center gap-1" data-testid="ladder-unit" data-ord={u.ord}>
              {i > 0 && <span className="h-px w-3 bg-gray-300" aria-hidden />}
              <div
                className={`flex min-w-[3.5rem] flex-col items-center rounded border px-2 py-1 ${dot.ring} ${
                  isCurrent ? 'ring-2 ring-offset-1 ring-blue-400' : ''
                }`}
                title={`unit #${u.ord} — ${u.stage} — ${dot.label}`}
              >
                <span className="text-[10px] font-semibold">#{u.ord}</span>
                <span className={`text-[9px] font-medium uppercase ${STAGE_TINT[u.stage]}`}>
                  {u.stage}
                </span>
                <span className="text-[9px] text-gray-500">{dot.label}</span>
              </div>
              {(gate || human) && (
                <span
                  data-testid="ladder-gate"
                  className={`text-xs ${gateDenied ? 'text-red-500' : gate ? 'text-green-600' : 'text-gray-400'}`}
                  title={
                    gate
                      ? `gate evaluated (${gateDenied ? 'denied' : 'allowed'})`
                      : 'human-confirm gate (policy)'
                  }
                >
                  ◆
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
