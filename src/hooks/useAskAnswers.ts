import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';
import type { SessionView } from '../api/types.js';
import { askAnswerText, askAnswerUnits, type AskAnswerUnit } from '../board/askThread.js';

/** One answer read back from its run (studio#816). */
export interface AskAnswer extends AskAnswerUnit {
  text: string;
}

/**
 * studio#816: an ask's answers read from the RUN once its chat's transcript is gone (the chat was
 * closed, or the daemon restarted — crew keeps no transcript for either). Each answered step's stored
 * output (`GET /runs/:id/units/answer-N/output`) is read once and shown as the reply it was. Off
 * (`enabled: false`) while the transcript still holds the replies. A read that fails, or a unit with
 * no stored output, adds nothing: the thread claims no answer it cannot show.
 */
export function useAskAnswers(views: readonly SessionView[], enabled: boolean): readonly AskAnswer[] {
  const units = useMemo(() => (enabled ? views.flatMap((v) => askAnswerUnits(v)) : []), [views, enabled]);
  const wanted = units.map((u) => `${u.runId}\u0000${u.key}`).join('\u0001');
  const [read, setRead] = useState<Record<string, string | null>>({});
  useEffect(() => {
    let live = true;
    for (const u of units) {
      const id = `${u.runId}\u0000${u.key}`;
      if (id in read) continue;
      api.getUnitOutput(u.runId, u.key)
        .then(({ output }) => { if (live) setRead((r) => ({ ...r, [id]: typeof output === 'string' ? askAnswerText(output) : null })); })
        .catch(() => { if (live) setRead((r) => ({ ...r, [id]: null })); });
    }
    return () => { live = false; };
    // `read` is deliberately not a dependency: each unit is read once, and a landed read must not re-run the fan-out.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted]);
  return useMemo(() => units.flatMap((u) => {
    const text = read[`${u.runId}\u0000${u.key}`];
    return typeof text === 'string' && text !== '' ? [{ ...u, text }] : [];
  }), [units, read]);
}
