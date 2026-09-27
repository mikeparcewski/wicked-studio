import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { isRouteAbsent } from '../api/errors.js';
import type { SeatRecordResponse } from '../api/seatRecord.js';
import type { CoachMove } from '../board/seatCoaching.js';

/** What the Health panel's expand learned about the seats' week. */
export type SeatWeekRead =
  | { kind: 'loading' }
  | { kind: 'absent' }
  | { kind: 'error'; message: string }
  | { kind: 'ok'; record: SeatRecordResponse };

/** One seat's applied move. */
export type MoveState =
  | { status: 'busy' }
  | { status: 'done'; note: string }
  | { status: 'error'; note: string };

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * The weekly 1:1 read (Wave B, idea 9): `GET /roster/record?days=7` on the Health panel's expand
 * gesture, beside `/health` and `/roster` (EC30: never on mount, never on a timer). A daemon without
 * the route is a named state, never an invented empty week. Only the current expand's answer lands.
 *
 * `apply` takes a seat's route-away move through `POST /governance/rules` and says what landed.
 * The sign-in move opens a terminal in the component; `markOpened` records it.
 */
export function useSeatWeek(open: boolean, days = 7): {
  week: SeatWeekRead;
  moves: Record<string, MoveState>;
  apply: (seat: string, move: CoachMove) => Promise<void>;
  markOpened: (seat: string) => void;
} {
  const [week, setWeek] = useState<SeatWeekRead>({ kind: 'loading' });
  const [moves, setMoves] = useState<Record<string, MoveState>>({});
  const gen = useRef(0);

  useEffect(() => {
    if (!open) return;
    const mine = ++gen.current;
    setWeek({ kind: 'loading' });
    setMoves({});
    Promise.resolve()
      .then(() => api.getSeatRecord(days))
      .then((record) => { if (gen.current === mine) setWeek({ kind: 'ok', record }); })
      .catch((e: unknown) => {
        if (gen.current !== mine) return;
        setWeek(isRouteAbsent(e) ? { kind: 'absent' } : { kind: 'error', message: message(e) });
      });
  }, [open, days]);

  const apply = useCallback(async (seat: string, move: CoachMove): Promise<void> => {
    if (move.kind !== 'route-away') return;
    setMoves((m) => ({ ...m, [seat]: { status: 'busy' } }));
    try {
      await api.upsertConformanceRule(move.rule);
      setMoves((m) => ({ ...m, [seat]: { status: 'done', note: `Rule ${move.rule.id} added (operations). Retire it in Steering › Policies.` } }));
    } catch (e) {
      setMoves((m) => ({ ...m, [seat]: { status: 'error', note: message(e) } }));
    }
  }, []);

  const markOpened = useCallback((seat: string): void => {
    setMoves((m) => ({ ...m, [seat]: { status: 'done', note: 'Sign-in opened.' } }));
  }, []);

  return { week, moves, apply, markOpened };
}
