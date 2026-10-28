import { useState } from 'react';
import { api } from '../../api/client.js';
import type { SessionView } from '../../api/types.js';
import { silentWords, type SilentStep } from '../../board/silentStep.js';
import { phaseLabel } from '../gateVerdictModel.js';
import { stepWord } from '../../board/runConversation.js';

/** The nudge the worker gets: the same words as the needs-you card's (the stall watchdog's hand-off). */
export const SILENT_NUDGE =
  'The operator is checking in: you have been silent for a long time. Continue the task, or say what is blocking you.';

/**
 * (J4 0.16.6) A running step that has said nothing for 5 min or more: said on the run page in plain words, with the
 * levers an executing run has (the needs-you card's: nudge the worker, move the step to another helper; Stop is the
 * header's). A slow model turn can be this quiet, so it is not called a failure.
 */
export function SilentStepCard({ view, silent, name }: { view: SessionView; silent: SilentStep; name: (cli: string) => string }): React.ReactElement {
  const runId = view.session.id;
  const [busy, setBusy] = useState<null | 'nudge' | 'move'>(null);
  const [note, setNote] = useState<{ tone: 'ok' | 'fail'; text: string } | null>(null);
  const step = silent.ord === null ? null : stepWord(phaseLabel(runId, view.units, silent.ord));
  const who = silent.cli === null ? null : name(silent.cli);
  const act = async (kind: 'nudge' | 'move'): Promise<void> => {
    setBusy(kind);
    setNote(null);
    try {
      if (kind === 'move') {
        const r = await api.reassignRun(runId);
        setNote({ tone: 'ok', text: `${step ?? `Step ${r.ord}`} is running again${r.cli !== undefined ? ` on ${name(r.cli)}` : ''}.` });
      } else {
        await api.injectMessage(runId, SILENT_NUDGE, 'all');
        setNote({ tone: 'ok', text: 'Message sent to the helper.' });
      }
    } catch (e) {
      setNote({ tone: 'fail', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };
  return (
    <section data-testid="silent-step" data-minutes={silent.minutes} aria-label={silentWords(silent)} className="wk-silent">
      <p data-testid="silent-step-headline" className="wk-silent-q">
        {silentWords(silent)}{who !== null ? ` from ${who}` : ''}{step !== null ? ` on ${step}` : ''}
      </p>
      <p className="wk-silent-p">A slow turn can be this quiet. If it stays silent, the job’s watchdog moves the step to another helper on its own.</p>
      <div className="wk-silent-btns">
        <button type="button" data-testid="silent-step-nudge" disabled={busy !== null} onClick={() => void act('nudge')} className="wk-btn wk-btn--secondary wk-btn--sm">
          {busy === 'nudge' ? 'Sending…' : `Ask ${who ?? 'the helper'} what’s happening`}
        </button>
        <button type="button" data-testid="silent-step-move" disabled={busy !== null} onClick={() => void act('move')} className="wk-btn wk-btn--secondary wk-btn--sm">
          {busy === 'move' ? 'Moving…' : 'Move it to another helper'}
        </button>
      </div>
      {note !== null && <p data-testid="silent-step-note" role={note.tone === 'fail' ? 'alert' : 'status'} className="wk-silent-note" data-tone={note.tone}>{note.text}</p>}
    </section>
  );
}
