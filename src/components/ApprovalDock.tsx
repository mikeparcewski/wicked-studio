import { sessionGuidance } from '../api/guidance.js';
import type { SessionView } from '../api/types.js';
import { useElicitationStore } from '../store/elicitations.js';
import { useGateStore } from '../store/gates.js';
import { ElicitationPrompt } from './ElicitationPrompt.js';
import { SteeringGate } from './SteeringGate.js';

/**
 * The pinned approval dock (DES-RUN-NARRATOR §2, §11.5): anything awaiting the
 * HUMAN — the steering gate, an MCP elicitation — renders here, as a sibling of
 * the scrolling feed, between it and the composer. It can NEVER scroll away:
 * the directive's "approvals go direct to user" surface. The feed still records
 * the gate moment inline as history; this dock is the action.
 *
 * Two callers, one dock: the run page passes `view` (status-aware — a gate also
 * shows on a bare `awaiting_human` with an empty cache, §3.3); the chat surface
 * passes `chatId` (§11.5 — gates and elicitations the daemon keys by the chat
 * session id render and answer HERE, on the surface the user is watching; with
 * no cached record there is no status wire to fall back on, so only a held
 * gate/elicitation shows).
 *
 * Renders nothing when nothing awaits (and never on a terminal run) — the
 * layout gives the feed the space back.
 */
export function ApprovalDock({
  view,
  chatId,
  onResolved,
}: {
  view?: SessionView;
  chatId?: string;
  onResolved: () => void;
}): React.ReactElement | null {
  const session = view?.session;
  const id = session?.id ?? chatId ?? null;
  const gate = useGateStore((s) => (id === null ? undefined : s.gates[id]));
  const elicitation = useElicitationStore((s) => (id === null ? undefined : s.elicitations[id]));
  if (id === null) return null;
  const isTerminal = session !== undefined && ['completed', 'cancelled', 'failed'].includes(session.status);

  const showGate =
    !isTerminal && (session?.status === 'awaiting_human' || gate !== undefined);
  const showElicitation = !isTerminal && elicitation !== undefined;
  if (!showGate && !showElicitation) return null;

  const guidance = session === undefined ? undefined : sessionGuidance(session);

  // The gate's ord, best-first: the cached gate record, else — the daemon-restarted fallback
  // (§3.3: status says awaiting_human, the transient cache is empty) — derived from the run's own
  // cursor the way `useRunModel.pendingGate` does: `unit_ix` is a 0-based INDEX and a gate's ord is
  // the unit it sits before, so resolve it through the snapshot (`units[unit_ix].ord`, else
  // `unit_ix + 1`). Trusted run state, never a guess — it keeps the card's verdict lookup BOUNDED
  // when the prompt itself was lost (Copilot on #252). Undefined only with no run view at all.
  const ord: number | undefined =
    gate !== undefined
      ? gate.ord
      : view !== undefined
        ? (view.units[view.session.unit_ix]?.ord ?? view.session.unit_ix + 1)
        : undefined;

  return (
    <div
      data-testid="approval-dock"
      className="shrink-0 px-4 pt-2 pb-1 flex flex-col gap-2 max-w-3xl w-full mx-auto"
    >
      {/* An open MCP elicitation suspends the agent's turn, so it leads the dock (DES-002).
          `key` is REQUIRED: React reuses the instance across prop changes, so without it a
          half-typed answer to elicitation A survives into B (v0.24 F3). */}
      {showElicitation && elicitation !== undefined && (
        <ElicitationPrompt key={elicitation.elicitationId} e={elicitation} />
      )}
      {showGate && (
        <SteeringGate
          runId={id}
          guidance={guidance}
          {...(ord !== undefined ? { ord } : {})}
          {...(gate ? { prompt: gate.prompt } : {})}
          {...(view !== undefined ? { units: view.units } : {})}
          onResolved={onResolved}
        />
      )}
    </div>
  );
}
