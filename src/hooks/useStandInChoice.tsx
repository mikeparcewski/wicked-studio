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
 * `launch` is the launcher's own start-and-record step; a held launch that fails again stays held, its error said.
 */
export function useStandInChoice<T>(launch: (body: LaunchBodyWithDeliver, meta: T) => Promise<void>, navigate: Navigate): {
  /** Hold `retries` under `refusal` (none: the card closes). */
  ask: (refusal: StandInChoiceRefusal | null, retries: readonly StandInRetry<T>[]) => void;
  /** The card, where the launcher shows it (`null` when nothing is held). */
  card: (testId: string) => React.ReactElement | null;
} {
  const [held, setHeld] = useState<{ refusal: StandInChoiceRefusal; retries: readonly StandInRetry<T>[] } | null>(null);
  const [busy, setBusy] = useState<StandInChoiceId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);

  const ask = (refusal: StandInChoiceRefusal | null, retries: readonly StandInRetry<T>[]): void => {
    setHeld(refusal !== null && retries.length > 0 ? { refusal, retries } : null);
    setError(null);
  };

  const choose = async (id: StandInChoiceId): Promise<void> => {
    if (held === null || busyRef.current) return;
    if (id === 'cancel') { ask(null, []); return; }
    if (id === 'sign_in') { navigate(AGENTS_PATH); return; }
    busyRef.current = true;
    setBusy(id);
    setError(null);
    try {
      if (id === 'always') {
        try { await saveStandInsEveryJob(); } catch (e) { setError(message(e)); return; }
      }
      const left: StandInRetry<T>[] = [];
      let fail: string | null = null;
      for (const r of held.retries) {
        try {
          await launch(id === 'job' ? standInRelaunchBody(r.body, held.refusal) : r.body, r.meta);
        } catch (e) {
          left.push(r);
          fail = message(e);
        }
      }
      setHeld(left.length > 0 ? { refusal: held.refusal, retries: left } : null);
      setError(fail);
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  };

  const card = (testId: string): React.ReactElement | null => (held === null ? null : (
    <StandInChoice refusal={held.refusal} name={helperNamer(null)} busy={busy} error={error} testId={testId}
      onChoose={(id) => { void choose(id); }} />
  ));

  return { ask, card };
}
