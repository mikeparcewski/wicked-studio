import { useMemo, useState } from 'react';
import { api, apiStatus } from '../api/client.js';
import type { AskAnswer } from '../api/ask.js';
import { askFromElicitation, elicitationContent, recordLine } from '../board/askModel.js';
import { answerShapeOf, askerOf, useElicitationStore, type OpenElicitation } from '../store/elicitations.js';
import { useAnsweredAsks } from '../store/answeredAsks.js';
import { AskCard } from './ask/AskCard.js';

/**
 * The operator's answer surface for an MCP server's mid-session question (DES-002), drawn as a guided ask
 * (DES-GUIDED-CHAT): free text, a yes / no, choose one (the producer's recommendation marked and preselected), or pick
 * several when the engine says `multi` (answered with `content.values`). Once answered, the thread keeps one line
 * ("You picked: main, develop") where the question was (`store/answeredAsks`, drawn by ThreadQuestions).
 *
 * Before this existed the daemon cached the elicitation and exposed it over REST, and answering
 * one meant a hand-written `curl`. This is the tap on that plumbing.
 *
 * # Two things here are load-bearing, not styling
 *
 * **Mount this with `key={elicitationId}`.** React reuses a component instance across prop
 * changes, so without the key a half-typed answer to elicitation A survives into elicitation B —
 * DES-002 v0.24 F3. `RunDetail` / `ChatPanel` own that; this component cannot enforce it, so it is
 * stated here and asserted in the tests.
 *
 * **A 409 is not an error to show the operator.** It means our `elicitationId` was stale — the
 * server has moved on. The recovery is to refetch and swap, guarded on the stale id so a
 * WebSocket-delivered newer prompt is never clobbered by the recovery (v0.22).
 */
export function ElicitationPrompt({ e, who = null }: { e: OpenElicitation; who?: string | null }): React.ReactElement {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const swapFromGet = useElicitationStore((s) => s.swapFromGet);
  const clearElicitation = useElicitationStore((s) => s.clearElicitation);
  const remember = useAnsweredAsks((s) => s.remember);
  const ask = useMemo(() => askFromElicitation(e, who === null ? 'A question, not a gate' : `${who} asks · a question, not a gate`), [e, who]);

  async function send(action: 'accept' | 'decline' | 'cancel', answer?: AskAnswer): Promise<void> {
    const content = action === 'accept' && answer !== undefined ? elicitationContent(ask, answer) : null;
    if (action === 'accept' && content === null) return;
    setBusy(true);
    setError(null);
    try {
      await api.respondToElicitation(e.runId, {
        elicitationId: e.elicitationId,
        action,
        // `content` must be ABSENT for decline/cancel — the route rejects it otherwise.
        ...(content !== null ? { content } : {}),
      });
      remember(e.runId, { askId: e.elicitationId, line: answer !== undefined ? recordLine(ask, answer) : 'You declined to answer', at: Date.now() });
      clearElicitation(e.runId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (apiStatus(err) === 409) {
        // Stale tab: refetch and swap in whatever the server has now (null clears).
        // `.catch(() => null)` here would treat a 500 or a dropped connection as "nothing
        // pending" and CLEAR the prompt — hiding a broken daemon behind an empty panel, which is
        // the degrade-silently shape this codebase keeps paying for. `getElicitation` already maps
        // a genuine 404 to null; anything else must surface.
        let fresh: Awaited<ReturnType<typeof api.getElicitation>>;
        try {
          fresh = await api.getElicitation(e.runId);
        } catch (refetchErr) {
          setError(refetchErr instanceof Error ? refetchErr.message : String(refetchErr));
          return;
        }
        const swapped = swapFromGet(
          e.runId,
          e.elicitationId,
          fresh === null
            ? null
            : {
                runId: fresh.runId,
                elicitationId: fresh.elicitationId,
                message: fresh.message,
                options: fresh.options,
                receivedAt: fresh.receivedAt,
                ...askerOf(fresh),
                ...answerShapeOf(fresh),
              },
        );
        // If the swap was refused, a newer prompt arrived by WS and already owns the slot —
        // nothing to say to the operator.
        if (swapped && fresh === null) setError(null);
      } else {
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-testid="elicitation-prompt" data-kind={ask.kind} className="wk-elicit">
      <AskCard
        ask={ask}
        tag="Question"
        busy={busy}
        onAnswer={(a) => void send('accept', a)}
        aside={
          <button type="button" data-testid="elicitation-decline" disabled={busy} onClick={() => void send('decline')} className="wk-btn wk-btn--quiet wk-btn--sm">
            Don’t answer
          </button>
        }
      />
      {ask.kind === 'confirm' && (
        <div className="wk-ask-go">
          <button type="button" data-testid="elicitation-decline" disabled={busy} onClick={() => void send('decline')} className="wk-btn wk-btn--quiet wk-btn--sm">
            Don’t answer
          </button>
        </div>
      )}
      {error !== null && <p role="alert" data-testid="elicitation-error" className="wk-session-gate-error">{error}</p>}
    </div>
  );
}
