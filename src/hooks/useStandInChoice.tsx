import { useRef, useState } from 'react';
import type { LaunchBodyWithDeliver } from '../api/types.js';
import { helperNamer, saveStandInsEveryJob, standInRelaunchBody, type StandInChoiceId, type StandInChoiceRefusal } from '../board/standIn.js';
import { StandInChoice } from '../components/StandInChoice.js';
import { AGENTS_PATH, type Navigate } from './useRoute.js';

/** A launch crew answered with the stand-in choice, kept to start again once the person chooses. */
export interface StandInRetry<T> { body: LaunchBodyWithDeliver; meta: T }

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * (wicked-crew#1932) The stand-in choice for a launcher that is a button, not a form: Learn my style (Style and the
 * first run's style ask). `ask` holds what crew refused; the card's choices do what LaunchWizard's do:
 * - "this job" starts each held launch again with crew's `retryWith`;
 * - "every job" saves the setting first (a setting not saved starts nothing and keeps the choices), then starts each
 *   as it was sent;
 * - "sign in" opens Helpers;
 * - Cancel closes the card.
 *
 * `launch` only starts a job. A held launch that fails again stays held, with its error on the card. The jobs that
 * started are handed to `started` once, together, so the launcher records them in one write; a failure to record is
 * the launcher's to say, and never starts a job again. `ask` (a new hold, or `null`) retires a choice in flight: it
 * starts nothing more and hands nothing more to `started`, and frees the launcher's Start at once (a stalled request
 * of a retired choice never holds it; studio#1444 r1). A choice the person made outlives its card: a start that answers
 * after the card is gone is still handed to `started`, as the launcher's own Start would land (studio#1444 r2: the chat
 * drawer's composer unmounts when the drawer closes, and its job must still be filed).
 */
export function useStandInChoice<T, R>(
  launch: (body: LaunchBodyWithDeliver, meta: T) => Promise<R>,
  started: (done: ReadonlyArray<{ result: R; meta: T }>) => void | Promise<void>,
  navigate: Navigate,
  /** Where "sign in another helper" goes (Helpers; the first run keeps its setup there). */
  signInPath: string = AGENTS_PATH,
): {
  /** Hold `retries` under `refusal` (none: the card closes). */
  ask: (refusal: StandInChoiceRefusal | null, retries: readonly StandInRetry<T>[]) => void;
  /** The card, where the launcher shows it (`null` when nothing is held). */
  card: (testId: string) => React.ReactElement | null;
  /** A choice is being carried out (the launcher holds its own Start meanwhile). */
  busy: boolean;
  /** What each held launch is, as the launcher named it. */
  held: readonly T[];
} {
  const [held, setHeld] = useState<{ refusal: StandInChoiceRefusal; retries: readonly StandInRetry<T>[] } | null>(null);
  const [busy, setBusy] = useState<StandInChoiceId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const gen = useRef(0);

  const ask = (refusal: StandInChoiceRefusal | null, retries: readonly StandInRetry<T>[]): void => {
    gen.current += 1;
    busyRef.current = false;
    setBusy(null);
    setHeld(refusal !== null && retries.length > 0 ? { refusal, retries } : null);
    setError(null);
  };

  const choose = async (id: StandInChoiceId): Promise<void> => {
    if (held === null || busyRef.current) return;
    if (id === 'cancel') { ask(null, []); return; }
    if (id === 'sign_in') { navigate(signInPath); return; }
    const mine = gen.current;
    const live = (): boolean => gen.current === mine;
    busyRef.current = true;
    setBusy(id);
    setError(null);
    try {
      if (id === 'always') {
        try { await saveStandInsEveryJob(); } catch (e) { if (live()) setError(message(e)); return; }
      }
      const left: StandInRetry<T>[] = [];
      const done: Array<{ result: R; meta: T }> = [];
      let fail: string | null = null;
      for (const r of held.retries) {
        if (!live()) return;
        try {
          done.push({ result: await launch(id === 'job' ? standInRelaunchBody(r.body, held.refusal) : r.body, r.meta), meta: r.meta });
        } catch (e) {
          left.push(r);
          fail = message(e);
        }
      }
      if (!live()) return;
      setHeld(left.length > 0 ? { refusal: held.refusal, retries: left } : null);
      setError(fail);
      if (done.length > 0) await started(done);
    } finally {
      // A retired choice's lock is already free, and may be a newer choice's now.
      if (live()) { busyRef.current = false; setBusy(null); }
    }
  };

  const card = (testId: string): React.ReactElement | null => (held === null ? null : (
    <StandInChoice refusal={held.refusal} name={helperNamer(null)} busy={busy} error={error} testId={testId}
      // No `signedInNow` is passed here, so the card never offers studio's `pick` (studio#1436): crew's ids only.
      onChoose={(id) => { if (id !== 'pick') void choose(id); }} />
  ));

  return { ask, card, busy: busy !== null, held: held?.retries.map((r) => r.meta) ?? [] };
}
