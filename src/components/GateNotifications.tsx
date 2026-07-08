import { useGateStore } from '../store/gates.js';
import { GatePanel } from './GatePanel.js';

export function GateNotifications(): React.ReactElement {
  const pendingGates = useGateStore((s) => s.pendingGates);

  if (pendingGates.length === 0) return <></>;

  return (
    <div className="fixed bottom-4 right-4 flex flex-col gap-2 z-50" data-testid="gate-notification">
      {pendingGates.map((gate) => (
        <GatePanel key={`${gate.sessionId}-${gate.phaseId}`} gate={gate} />
      ))}
    </div>
  );
}
