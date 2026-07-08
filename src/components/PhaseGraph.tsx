import type { Phase } from '../api/client.js';

const stateColors: Record<string, string> = {
  Pending: 'bg-gray-100 text-gray-500',
  InProgress: 'bg-blue-100 text-blue-700',
  AwaitingHuman: 'bg-yellow-100 text-yellow-700',
  AwaitingCouncil: 'bg-purple-100 text-purple-700',
  GateRunning: 'bg-indigo-100 text-indigo-700',
  Approved: 'bg-green-100 text-green-700',
  Rejected: 'bg-red-100 text-red-700',
};

interface Props {
  phases: Phase[];
}

export function PhaseGraph({ phases }: Props): React.ReactElement {
  return (
    <ol className="flex flex-col gap-1" data-testid="phase-graph">
      {phases.map((phase, i) => (
        <li key={phase.id} className="flex items-center gap-2 text-sm">
          <span className="w-5 text-center text-xs text-gray-400 shrink-0">{i + 1}</span>
          <span
            className={`rounded px-2 py-0.5 font-mono text-xs ${stateColors[phase.state] ?? 'bg-gray-100 text-gray-500'}`}
          >
            {phase.phase_id}
          </span>
          <span className="text-xs text-gray-500">{phase.state}</span>
        </li>
      ))}
    </ol>
  );
}
