import { useState } from 'react';
import { api } from '../api/client.js';
import { useElicitationStore, type OpenElicitation } from '../store/elicitations.js';

/**
 * The operator's answer surface for an MCP server's mid-session question (DES-002).
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
export function ElicitationPrompt({ e }: { e: OpenElicitation }): React.ReactElement {
  const [text, setText] = useState('');
  const [choice, setChoice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const swapFromGet = useElicitationStore((s) => s.swapFromGet);
  const clearElicitation = useElicitationStore((s) => s.clearElicitation);

  const answer = choice ?? text.trim();
  const canAccept = e.options === null ? answer.length > 0 : choice !== null;

  async function send(action: 'accept' | 'decline' | 'cancel'): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await api.respondToElicitation(e.runId, {
        elicitationId: e.elicitationId,
        action,
        // `content` must be ABSENT for decline/cancel — the route rejects it otherwise.
        ...(action === 'accept' ? { content: { response: answer } } : {}),
      });
      clearElicitation(e.runId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/\b409\b/.test(msg)) {
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
    <div
      className="flex flex-col gap-2 rounded p-3"
      style={{ border: '1px solid rgba(230,237,243,0.12)', background: '#1b222e' }}
      data-testid="elicitation-prompt"
    >
      <p className="text-[11px] font-semibold uppercase tracking-wider font-mono"
         style={{ color: 'rgba(230,237,243,0.4)' }}>
        Input requested
      </p>
      <p className="text-sm" style={{ color: '#e6edf3' }}>{e.message}</p>

      {e.options === null ? (
        <input
          type="text"
          value={text}
          disabled={busy}
          onChange={(ev) => setText(ev.target.value)}
          placeholder="Your answer"
          aria-label="Your answer"
          className="rounded px-2 py-1 text-sm"
          style={{ background: '#161c26', border: '1px solid rgba(230,237,243,0.1)', color: '#e6edf3' }}
        />
      ) : (
        <div className="flex flex-wrap gap-1">
          {e.options.map((opt) => (
            <button
              key={opt}
              type="button"
              disabled={busy}
              onClick={() => setChoice(opt)}
              className="rounded px-2 py-0.5 text-xs font-mono"
              style={{
                background: choice === opt ? 'rgba(121,192,255,0.15)' : '#161c26',
                border: `1px solid ${choice === opt ? '#79c0ff' : 'rgba(230,237,243,0.1)'}`,
                color: '#e6edf3',
              }}
            >
              {opt}
            </button>
          ))}
        </div>
      )}

      {error !== null && (
        <p className="text-xs" style={{ color: '#f85149' }}>{error}</p>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy || !canAccept}
          onClick={() => void send('accept')}
          className="rounded px-2 py-0.5 text-xs font-semibold"
          style={{
            background: canAccept ? 'rgba(63,185,80,0.12)' : 'rgba(230,237,243,0.05)',
            border: `1px solid ${canAccept ? 'rgba(63,185,80,0.3)' : 'rgba(230,237,243,0.1)'}`,
            color: canAccept ? '#3fb950' : 'rgba(230,237,243,0.3)',
          }}
        >
          Send
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void send('decline')}
          className="rounded px-2 py-0.5 text-xs"
          style={{ border: '1px solid rgba(230,237,243,0.15)', color: 'rgba(230,237,243,0.7)' }}
        >
          Decline
        </button>
      </div>
    </div>
  );
}
