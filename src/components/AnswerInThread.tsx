import { useEffect, useRef } from 'react';
import { plainGateQuestion } from '../board/deskWords.js';
import { GATE_HASH } from '../board/gateActions.js';
import { sessionPath } from '../board/sessionModel.js';
import { announceNavigateAway, inAppEntryState } from '../hooks/useHistoryState.js';
import type { Navigate } from '../hooks/useRoute.js';
import { useElicitationStore } from '../store/elicitations.js';
import { useGateStore } from '../store/gates.js';

/**
 * S16a-4g (DES-STUDIO-REBUILD-001 Amendment 5 §1, §5.5 — never "more than one place to answer a
 * gate"): a dock or panel whose run or chat is waiting on the operator shows ONE line — the plain
 * question and "Answer in its thread ›" to the session with `#gate` — and no gate card. It opens
 * nothing and sends nothing; the thread is where the answer is given.
 */

/** The session a waiting id is answered in: a run's own session, or the chat's. */
export function answerPath(subject: { kind: 'run'; runId: string } | { kind: 'chat'; chatId: string }): string {
  return `${sessionPath(subject.kind === 'run' ? `run:${subject.runId}` : subject.chatId)}${GATE_HASH}`;
}

/** Fires `onCleared` once when `id`'s gate leaves the gate store after being open (answered in its
 *  thread, or resolved by the run) — what a panel's gate card's `onResolved` used to report. */
export function useGateCleared(id: string | null, onCleared: () => void): boolean {
  const open = useGateStore((s) => id !== null && s.gates[id] !== undefined);
  const was = useRef<{ id: string | null; open: boolean }>({ id: null, open: false });
  const latest = useRef(onCleared);
  latest.current = onCleared;
  useEffect(() => {
    const prev = was.current;
    was.current = { id, open };
    if (prev.id === id && prev.open && !open) latest.current();
  }, [id, open]);
  return open;
}

/** The app's in-place navigation without a router in scope: push, then let every useRoute's
 *  popstate listener read the new address. */
function goTo(path: string): void {
  announceNavigateAway();
  history.pushState(inAppEntryState(), '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function AnswerInThread({ subject, awaiting = false, navigate }: {
  subject: { kind: 'run'; runId: string } | { kind: 'chat'; chatId: string };
  /** The run's own status says it waits on a human (a gate the cache has not caught yet). */
  awaiting?: boolean;
  navigate?: Navigate;
}): React.ReactElement | null {
  const id = subject.kind === 'run' ? subject.runId : subject.chatId;
  const gate = useGateStore((s) => s.gates[id]);
  const elicitation = useElicitationStore((s) => s.elicitations[id]);
  if (gate === undefined && elicitation === undefined && !awaiting) return null;
  const question = elicitation !== undefined && gate === undefined
    ? elicitation.message
    : plainGateQuestion(gate?.prompt, gate?.gateKind);
  const href = answerPath(subject);
  return (
    <p data-testid="answer-in-thread" data-subject={id} role="status" className="wk-answer-in-thread">
      <span className="wk-answer-in-thread-q">{question}</span>{' '}
      <a
        data-testid="answer-in-thread-open"
        href={href}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
          e.preventDefault();
          if (navigate !== undefined) navigate(href);
          else goTo(href);
        }}
        className="wk-since-toggle"
      >
        Answer in its thread ›
      </a>
    </p>
  );
}
