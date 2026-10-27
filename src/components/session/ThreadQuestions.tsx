import { useEffect, useLayoutEffect, useRef } from 'react';
import type { SessionView as RunView } from '../../api/types.js';
import { GATE_HASH } from '../../board/gateActions.js';
import { pinAwaiting } from '../../store/awaitingPins.js';
import { Docked, DecisionMarker } from './DecisionDock.js';
import { useElicitationStore } from '../../store/elicitations.js';
import { useGateStore } from '../../store/gates.js';
import { ElicitationPrompt } from '../ElicitationPrompt.js';
import { NeedsYouCard, useNeedsYouState } from '../NeedsYouCard.js';
import { GateRow } from './GateRow.js';
import { askingResponder, CREW } from '../../board/responder.js';
import { useRoster } from '../../hooks/useRoster.js';
import { TurnWho } from './TurnWho.js';

/**
 * S16a-4g (DES-STUDIO-REBUILD-001 Amendment 5 §1, §5.5): every question a run or a chat asks the
 * operator is answered in its session thread — one place to answer, never a dock beside it.
 *
 *  - `RunQuestions` — under the run's card in `RunBlock`, while the run is live: an MCP server's
 *    question (`ElicitationPrompt`, keyed by the run id) and the stall watchdog's hand-off
 *    (`NeedsYouCard`). Both reused unchanged.
 *  - `ChatQuestions` — at a chat session's thread foot: the chat-keyed question and gate (the daemon
 *    keys them by the chat id, never in `GET /runs`, so the thread PINS the id while mounted —
 *    `store/awaitingPins.ts` — or the runs reconcile sweeps them).
 *
 * `#gate` on arrival focuses the open gate row (GateRow's own rule), else the question's first
 * control — once per question.
 */

const TERMINAL = new Set(['completed', 'cancelled', 'failed']);

/** On `#gate`, focus the question's first control once per question — unless a gate is open (the
 *  gate row takes the focus) or the caret is already in a text field. */
function useFocusQuestionOnGateHash(questionId: string | null, gateOpen: boolean): React.RefObject<HTMLDivElement> {
  const ref = useRef<HTMLDivElement>(null);
  const focusedFor = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (questionId === null || gateOpen || window.location.hash !== GATE_HASH || focusedFor.current === questionId) return;
    focusedFor.current = questionId;
    const active = document.activeElement;
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return;
    ref.current?.querySelector<HTMLElement>('input, textarea, select, button')?.focus();
  }, [questionId, gateOpen]);
  return ref;
}

export function RunQuestions({ view }: { view: RunView }): React.ReactElement | null {
  const id = view.session.id;
  const elicitation = useElicitationStore((s) => s.elicitations[id]);
  const gateOpen = useGateStore((s) => s.gates[id] !== undefined);
  // studio#284: the stall watchdog handed an executing run to a human (reload-safe).
  const needsYou = useNeedsYouState(view);
  const live = !TERMINAL.has(view.session.status);
  const ref = useFocusQuestionOnGateHash(live && elicitation !== undefined ? elicitation.elicitationId : null, gateOpen);
  const roster = useRoster();
  if (!live || (elicitation === undefined && needsYou === null)) return null;
  return (
    <div ref={ref} data-testid="session-run-questions" data-run-id={id} className="wk-session-questions">
      {/* `key`: a half-typed answer to question A never survives into B (v0.24 F3). */}
      {/* H3: a question card says who is asking — the seat that asked (an ask question names it),
          else the seat running the step; the stall watchdog's hand-off is crew's. */}
      {elicitation !== undefined && (
        <Docked dockKey={id} open marker={<DecisionMarker dockKey={id} who={askingResponder(view, roster, elicitation).name} since={null} />}>
          <TurnWho who={askingResponder(view, roster, elicitation)} runId={id} suffix="is asking" className="wk-who--asking" />
          <ElicitationPrompt key={elicitation.elicitationId} e={elicitation} />
        </Docked>
      )}
      {needsYou !== null && <TurnWho who={CREW} suffix="handing this to you" className="wk-who--asking" />}
      {needsYou !== null && <NeedsYouCard view={view} state={needsYou} />}
    </div>
  );
}

export function ChatQuestions({ chatId }: { chatId: string }): React.ReactElement | null {
  // The chat id is outside the run universe: pin it for the thread's lifetime (counted, so a
  // StrictMode remount or a second surface never unpins early).
  useEffect(() => pinAwaiting(chatId), [chatId]);
  const elicitation = useElicitationStore((s) => s.elicitations[chatId]);
  const gate = useGateStore((s) => s.gates[chatId]);
  const ref = useFocusQuestionOnGateHash(elicitation?.elicitationId ?? null, gate !== undefined);
  if (elicitation === undefined && gate === undefined) return null;
  return (
    <div ref={ref} data-testid="session-chat-questions" data-chat-id={chatId} className="wk-session-questions">
      <Docked dockKey={chatId} open marker={<DecisionMarker dockKey={chatId} who={null} since={gate?.receivedAt ?? null} />}>
        {elicitation !== undefined && <ElicitationPrompt key={elicitation.elicitationId} e={elicitation} />}
        {gate !== undefined && <GateRow view={null} gate={gate} chatId={chatId} />}
      </Docked>
    </div>
  );
}
