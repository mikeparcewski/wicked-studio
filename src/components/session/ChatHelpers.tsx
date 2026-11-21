import { useEffect, useRef, useState } from 'react';
import { api } from '../../api/client.js';
import { apiStatus, apiWire } from '../../api/errors.js';
import type { RosterSeat } from '../../api/types.js';
import { seatLabel, userSeats } from '../../board/seatNames.js';

function words(e: unknown): string {
  return apiWire(e) ?? (e instanceof Error ? e.message : String(e));
}

/** A seed has seats before it has a person message. Crew owns every edit and its admission result. */
export function ChatHelpers({ chatId, roster }: { chatId: string; roster: RosterSeat[] | null }): React.ReactElement {
  const [seats, setSeats] = useState<string[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    void api.getChat(chatId).then((r) => {
      if (live.current) setSeats(r.seats);
    }).catch((e: unknown) => { if (live.current) setNote(words(e)); });
    return () => { live.current = false; };
  }, [chatId]);

  const keys = userSeats(roster).map((s) => s.key);
  // Keep seats the chat still has even if they have since left the roster.
  for (const key of seats ?? []) if (!keys.includes(key)) keys.push(key);
  const toggle = async (key: string): Promise<void> => {
    if (seats === null || roster === null || busy.current) return;
    const next = new Set(seats);
    if (next.has(key)) next.delete(key); else next.add(key);
    busy.current = true;
    setSaving(true);
    setNote(null);
    const reread = async (): Promise<void> => {
      const r = await api.getChat(chatId);
      if (live.current) setSeats(r.seats);
    };
    try {
      const r = await api.reseatChat(chatId, keys.filter((k) => next.has(k))) as Awaited<ReturnType<typeof api.reseatChat>> & { reseated?: false; note?: string };
      if (!live.current) return;
      setNote(r.note ?? (r.refused.length > 0 ? r.refused.map((s) => s.reason).join(' ') : null));
      if (r.reseated === false) await reread();
      else setSeats(r.seats.filter((s) => s.ok).map((s) => s.cliKey));
    } catch (e: unknown) {
      if (!live.current) return;
      setNote(words(e));
      if (apiStatus(e) === 409) {
        try { await reread(); }
        catch (readError: unknown) { if (live.current) setNote(`${words(e)} ${words(readError)}`); }
      }
    } finally {
      busy.current = false;
      if (live.current) setSaving(false);
    }
  };

  return (
    <div data-testid="composer-seats" role="group" aria-label="Helpers in this chat" className="wk-composer-chips">
      <span className="wk-composer-note">Helpers</span>
      {seats === null && note === null && <span className="wk-composer-note">Reading helpers…</span>}
      {seats !== null && keys.map((key) => {
        const on = seats.includes(key);
        const last = on && seats.length === 1;
        const name = seatLabel((roster ?? []).find((s) => s.key === key) ?? { key });
        return (
          <button key={key} type="button" data-testid="composer-seat" data-key={key} aria-pressed={on}
            disabled={roster === null || saving || last}
            title={last ? 'A chat needs at least one helper' : on ? `${name} takes part — click to leave it out` : `${name} is left out — click to include it`}
            onClick={() => { void toggle(key); }}
            className={`wk-composer-chip wk-composer-seat${on ? '' : ' wk-composer-seat--off'}`}>
            {name}
          </button>
        );
      })}
      <span className="wk-composer-note">Set before the first message; after it, they stay.</span>
      {note !== null && <span role="status" className="wk-composer-note wk-composer-note--bad">{note}</span>}
    </div>
  );
}
