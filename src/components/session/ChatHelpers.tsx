import { useEffect, useRef, useState } from 'react';
import { api } from '../../api/client.js';
import { apiStatus, apiWire } from '../../api/errors.js';
import type { RosterSeat } from '../../api/types.js';
import { seatLabel, userSeats } from '../../board/seatNames.js';
import { foldJobLineages } from '../../board/jobStream.js';

function words(e: unknown): string {
  return apiWire(e) ?? (e instanceof Error ? e.message : String(e));
}

/** The chat's open job card and the seats it names, from the chat's transcript; `null` when it holds none. */
export function openJobCard(messages: readonly unknown[] | undefined): { pid: string; seats: string[] } | null {
  // Folded as the job card folds them (studio's job lineages, crew's own rules): the open head of a job lineage.
  const open = foldJobLineages(messages ?? []).filter((l) => l.state === 'open').at(-1)?.head.proposal;
  const keys = open?.seats?.keys;
  return open === undefined || keys === undefined ? null : { pid: open.pid, seats: [...keys] };
}

/**
 * A seed has seats before it has a person message. Crew owns every edit and its admission result.
 * (studio#1483) While the chat holds an open job card, the chips are THAT job's helpers: crew draws a job's seats
 * from the seats new work may use, never from the chat's (`chat-jobs.ts` drawOrder), so re-seating the chat would
 * change nothing the job runs. A press re-versions the card instead (a revision that adds or removes the seat).
 * A press decides on what crew holds at that moment (the chat read again), never on what this row last read: a card
 * may have been drawn, dismissed (Not now), started or replaced since. The row also reads again whenever the
 * transcript does (`rev`), so a card drawn after it read shows here.
 */
export function ChatHelpers({ chatId, roster, onJobChanged, rev = 0 }: {
  chatId: string;
  roster: RosterSeat[] | null;
  onJobChanged?: (() => void) | undefined;
  /** The transcript's read generation: a change (a card drawn, decided or re-versioned) reads the chat again. */
  rev?: number | undefined;
}): React.ReactElement | null {
  const [seats, setSeats] = useState<string[] | null>(null);
  const [card, setCard] = useState<{ pid: string; seats: string[] } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // A chat read with no seats (a run's session, an ended chat) has none to change here: no row.
  const [noSeats, setNoSeats] = useState(false);
  const busy = useRef(false);
  const live = useRef(true);
  // Every chat read is numbered; only the newest one's answer is drawn, so a slow older read never paints over a newer
  // one (codex-check r2 on #1487: an old read had put a dropped helper back "on").
  const readSeq = useRef(0);
  type Held = { card: { pid: string; seats: string[] } | null; seats: string[] | null };
  /**
   * Read the chat and answer what crew holds (`null` once unmounted). It is drawn only if no newer read started
   * meanwhile; the answer is returned either way, so a press decides on its own read even when a refresh (a
   * WebSocket reconnect, a transcript re-read) started during it (codex-check r3 on #1487).
   */
  const read = async (): Promise<Held | null> => {
    const seq = ++readSeq.current;
    const r = await api.getChat(chatId);
    if (!live.current) return null;
    const held: Held = { card: openJobCard(r.messages), seats: Array.isArray(r.seats) ? r.seats : null };
    if (seq === readSeq.current) {
      setCard(held.card);
      if (held.seats !== null) setSeats(held.seats); else setNoSeats(true);
    }
    return held;
  };
  useEffect(() => {
    live.current = true;
    read().catch((e: unknown) => { if (live.current) setNote(words(e)); });
    return () => { live.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read() closes over chatId only
  }, [chatId, rev]);

  // The seats the chips show: the open job card's, else the chat's.
  const shown = card !== null ? card.seats : seats;
  const keys = userSeats(roster).map((s) => s.key);
  // Keep seats the chat (or its card) still has even if they have since left the roster.
  for (const key of shown ?? []) if (!keys.includes(key)) keys.push(key);
  const reread = async (): Promise<void> => { await read(); };
  /** Inside a press (`busy` held): set the open card's helper `key` to `want` by a revision. */
  const reviseCard = async (key: string, want: boolean, open: { pid: string; seats: string[] }): Promise<void> => {
    try {
      await api.reviseChatProposal(chatId, {
        revises: open.pid,
        edits: want ? { addSeats: [key] } : { removeSeats: [key] },
        source: 'question',
        // One request per card version and press: a retry of the same press answers the same revision.
        requestId: `${open.pid}:helpers:${want ? 'on' : 'off'}:${key}`,
      });
    } catch (e: unknown) {
      // No answer (the network, a restart) is not a refusal: crew may have taken the change. The re-read below shows
      // what it holds; a press again is safe, since it carries the person's intent.
      const status = apiStatus(e);
      if (live.current) {
        setNote(status === null || status === 0
          ? 'Crew did not answer, so this change may or may not have reached the job. The helpers above are what it holds now.'
          : `The job's helpers were not changed (${words(e)}).`);
      }
    } finally {
      // The transcript draws the card: it reads the new version (or crew's unchanged one) as the card's own edits do.
      onJobChanged?.();
      try { await reread(); } catch (readError: unknown) { if (live.current) setNote(words(readError)); }
      busy.current = false;
      if (live.current) setSaving(false);
    }
  };
  /**
   * A press carries the person's intent as the chip showed it (`want`: include, or leave out) and applies it to what
   * crew holds NOW (the chat read again): under an open card it revises that card, else it re-seats the chat. If crew
   * already holds what the person asked for, nothing is sent. It never toggles against the fresh read, so a chip
   * drawn from an older read cannot reverse a change (codex-check r2 on #1487).
   */
  const press = async (key: string, want: boolean): Promise<void> => {
    if (seats === null || roster === null || busy.current) return;
    busy.current = true;
    setSaving(true);
    setNote(null);
    let held: Held | null;
    try {
      held = await read();
    } catch (e: unknown) {
      if (live.current) { setNote(words(e)); setSaving(false); }
      busy.current = false;
      return;
    }
    if (held === null || held.seats === null) {
      busy.current = false;
      if (live.current) setSaving(false);
      return;
    }
    if (held.card !== null) {
      if (held.card.seats.includes(key) === want) { busy.current = false; setSaving(false); return; }
      return reviseCard(key, want, held.card);
    }
    if (held.seats.includes(key) === want) { busy.current = false; setSaving(false); return; }
    const next = new Set(held.seats);
    if (want) next.add(key); else next.delete(key);
    try {
      const r = await api.reseatChat(chatId, keys.filter((k) => next.has(k))) as Awaited<ReturnType<typeof api.reseatChat>> & { reseated?: false; note?: string };
      if (!live.current) return;
      setNote(r.note ?? (r.refused.length > 0 ? r.refused.map((s) => s.reason).join(' ') : null));
      if (r.reseated === false) await reread();
      else {
        // This answer is newer than any read started before the press: an older read must not paint over it.
        readSeq.current += 1;
        setSeats(r.seats.filter((s) => s.ok).map((s) => s.cliKey));
      }
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

  if (noSeats) return null;
  return (
    <div data-testid="composer-seats" data-target={card !== null ? 'job' : 'chat'} role="group" aria-label={card !== null ? 'Helpers on this job' : 'Helpers in this chat'} className="wk-composer-chips">
      <span className="wk-composer-note">Helpers</span>
      {shown === null && note === null && <span className="wk-composer-note">Reading helpers…</span>}
      {shown !== null && keys.map((key) => {
        const on = shown.includes(key);
        const last = on && shown.length === 1;
        const name = seatLabel((roster ?? []).find((s) => s.key === key) ?? { key });
        return (
          <button key={key} type="button" data-testid="composer-seat" data-key={key} aria-pressed={on}
            disabled={roster === null || saving || last}
            title={last ? (card !== null ? 'A job needs at least one helper' : 'A chat needs at least one helper') : on ? `${name} takes part — click to leave it out` : `${name} is left out — click to include it`}
            onClick={() => { void press(key, !on); }}
            className={`wk-composer-chip wk-composer-seat${on ? '' : ' wk-composer-seat--off'}`}>
            {name}
          </button>
        );
      })}
      <span className="wk-composer-note">{card !== null ? 'A change here draws the job card again with these helpers.' : 'Set before the first message; after it, they stay.'}</span>
      {note !== null && <span role="status" className="wk-composer-note wk-composer-note--bad">{note}</span>}
    </div>
  );
}
