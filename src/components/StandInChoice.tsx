import { useId } from 'react';
import { standInChoiceWords, type StandInChoiceId, type StandInChoiceRefusal } from '../board/standIn.js';

/**
 * THE STAND-IN CHOICE CARD (DES-STANDIN-001 §2.1, studio S0). A launch crew refused because too few helpers are
 * signed in to check the job: what is missing, what a stand-in is, what the record will say, and the choices crew
 * listed, each with what happens next. Nothing has started while this shows (DES §4: the refusal comes before any
 * write). The host form does what a choice means (`onChoose`).
 */
export function StandInChoice({ refusal, name, busy, onChoose, testId }: {
  refusal: StandInChoiceRefusal;
  /** A helper key as studio names it ("claude" → "Claude Code"). */
  name: (cli: string) => string;
  /** The choice being carried out (its button says so; every button waits). */
  busy: StandInChoiceId | null;
  onChoose: (id: StandInChoiceId) => void;
  testId: string;
}): React.ReactElement {
  const words = standInChoiceWords(refusal, name);
  const titleId = useId();
  return (
    <section role="group" aria-labelledby={titleId} data-testid={testId} className="wk-standin-choice">
      <p id={titleId} className="wk-standin-choice-title" data-testid={`${testId}-title`}>{words.title}</p>
      <p className="wk-standin-choice-text" data-testid={`${testId}-why`}>{words.why}</p>
      <p className="wk-standin-choice-text" data-testid={`${testId}-meaning`}>{words.meaning}</p>
      <p className="wk-standin-choice-text" data-testid={`${testId}-record`}>{words.record}</p>
      <ul className="wk-standin-choice-list">
        {words.choices.map((c, i) => {
          const nextId = `${titleId}-${c.id}`;
          return (
            <li key={c.id} className="wk-standin-choice-row">
              <button
                type="button"
                className={`wk-btn wk-btn--sm ${i === 0 ? 'wk-btn--primary' : 'wk-btn--secondary'}`}
                data-testid={`${testId}-${c.id}`}
                aria-describedby={nextId}
                disabled={busy !== null}
                onClick={() => onChoose(c.id)}
              >
                {busy === c.id ? 'Starting…' : c.label}
              </button>
              <span id={nextId} className="wk-standin-choice-next" data-testid={`${testId}-${c.id}-next`}>{c.next}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
