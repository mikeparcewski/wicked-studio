import { useCallback, useEffect, useMemo, useState } from 'react';
import { CircleCheck } from 'lucide-react';
import { api } from '../../api/client.js';
import { apiStatus } from '../../api/errors.js';
import { inspectionOf, type InspectAction, type InspectVerdict, type UnitInspection } from '../../api/inspect.js';
import { checkAfterMs, costWords, elapsedWords, tokenWords, type TurnKind } from '../../board/liveTurn.js';
import { useRunEventStore } from '../../store/events.js';
import { stopRun } from '../../store/sheets.js';

/**
 * "IS THIS GOING WELL?" (operator 2026-10-30: "if it's been running long you can have an agent analyze right there, to
 * make sure no tokens are wasted and no problems are occurring"). Once a turn has run past its threshold (a chat 3 min,
 * a run's step 10 min: {@link checkAfterMs}), a guided ask grows in under its live activity: "This has been running
 * 6 min · Check on it?". Yes asks crew (`POST /runs/:id/units/:ord/inspect`): a seat that is not the step's own reads
 * the step's record, read-only, and answers progressing / looping / stuck / wasteful, with what it is doing, how far
 * along, the evidence, and one recommended action. The person chooses through the same ask: let it run, steer it
 * with the suggested note (editable, sent as a message to the step's seat), or stop it (the ordinary Stop, with its
 * undo). Nothing happens on its own. The visual language is the guided ask's (program DES-GUIDED-CHAT: options as
 * tiles, the recommended one preselected and marked, the consequence shown, one commit button, a record line after).
 */

/** "Not now" or "Let it run": the ask comes back after another threshold, per step attempt (kept across remounts). */
const snoozed = new Map<string, number>();

const VERDICT: Record<InspectVerdict, { word: string; tone: 'ok' | 'warn' | 'fail' }> = {
  progressing: { word: 'Progressing', tone: 'ok' },
  looping: { word: 'Looping', tone: 'warn' },
  stuck: { word: 'Stuck', tone: 'fail' },
  wasteful: { word: 'Wasting tokens', tone: 'warn' },
};

type Chosen = { action: InspectAction; at: number; note?: string; error?: string };

export function InflightCheck({ runId, ord, attempt, kind, startedAt, now, seatName, seatKey, label }: {
  runId: string;
  ord: number;
  attempt: number;
  kind: TurnKind;
  /** When the turn started (unix ms). */
  startedAt: number;
  now: number;
  /** The step's seat, in words ("Claude Code"), and its key (where a steer note goes). */
  seatName: string;
  seatKey: string | null;
  /** What Stop stops, in words ("this answer", "the job"). */
  label: string;
}): React.ReactElement | null {
  const key = `${runId}:${ord}:${attempt}`;
  const threshold = checkAfterMs(kind);
  const elapsed = now - startedAt;
  const [record, setRecord] = useState<UnitInspection | null>(null);
  const [asking, setAsking] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [snoozeAt, setSnoozeAt] = useState<number>(() => snoozed.get(key) ?? 0);
  const [choice, setChoice] = useState<InspectAction | null>(null);
  const [note, setNote] = useState('');
  const [chosen, setChosen] = useState<Chosen | null>(null);

  // A check asked earlier on this attempt (a reload, another tab) is shown as it stands, once the turn is long enough
  // to have been checked at all.
  const due = elapsed >= threshold;
  useEffect(() => {
    if (!due) return;
    let live = true;
    api.getInspections(runId, ord)
      .then(({ inspections }) => { const mine = inspections.find((i) => i.attempt === attempt); if (live && mine !== undefined) setRecord(mine); })
      .catch(() => undefined);
    return () => { live = false; };
  }, [runId, ord, attempt, due]);

  // crew's `unitInspection` frames land in the run's event log like any frame of the run (no socket of its own).
  const events = useRunEventStore((s) => s.byRun[runId]);
  useEffect(() => {
    for (let i = (events ?? []).length - 1; i >= 0; i -= 1) {
      const rec = inspectionOf(events![i]);
      if (rec !== null && rec.ord === ord && rec.attempt === attempt) {
        setRecord((cur) => (cur === null || cur.id !== rec.id || cur.state !== 'done' || rec.state === 'done' ? rec : cur));
        return;
      }
    }
  }, [events, ord, attempt]);

  // While it checks, read it back every 5 s too (a missed frame never leaves it spinning).
  const checking = record?.state === 'checking';
  useEffect(() => {
    if (!checking) return;
    const t = setInterval(() => {
      api.getInspections(runId, ord).then(({ inspections }) => { const mine = inspections.find((i) => i.id === record?.id); if (mine !== undefined) setRecord(mine); }).catch(() => undefined);
    }, 5000);
    return () => clearInterval(t);
  }, [checking, runId, ord, record?.id]);

  // The recommended action is the one preselected (DES-GUIDED-CHAT: recommended, not automatic).
  useEffect(() => {
    if (record?.state === 'done' && choice === null) {
      setChoice(record.action ?? 'let_run');
      setNote(record.note ?? '');
    }
  }, [record, choice]);

  const ask = useCallback(() => {
    setAsking(true);
    setRefusal(null);
    api.inspectUnit(runId, ord)
      .then(({ inspection }) => setRecord(inspection))
      .catch((e: unknown) => {
        const status = apiStatus(e);
        setRefusal(status === 404 || status === 501
          ? 'This version of studio’s service cannot check on a step yet.'
          : status === 409 ? 'It is not working on this step any more, so there is nothing to check.'
          : status === 403 ? 'Only a person signed in as an operator can ask for a check.'
          : `The check could not start: ${e instanceof Error ? e.message : String(e)}`);
      })
      .finally(() => setAsking(false));
  }, [runId, ord]);

  const snooze = useCallback(() => {
    const at = elapsed + threshold;
    snoozed.set(key, at);
    setSnoozeAt(at);
  }, [elapsed, threshold, key]);

  const commit = useCallback(() => {
    if (choice === null) return;
    if (choice === 'let_run') {
      snooze();
      setChosen({ action: 'let_run', at: Date.now() });
      return;
    }
    if (choice === 'stop') {
      stopRun([runId], label);
      setChosen({ action: 'stop', at: Date.now() });
      return;
    }
    const body = note.trim();
    if (body === '') return;
    api.injectMessage(runId, body, seatKey ?? 'all')
      .then(() => setChosen({ action: 'steer', at: Date.now(), note: body }))
      .catch((e: unknown) => setChosen({ action: 'steer', at: Date.now(), note: body, error: e instanceof Error ? e.message : String(e) }));
  }, [choice, note, runId, seatKey, label, snooze]);

  const cost = useMemo(() => {
    const c = record?.cost;
    if (c === null || c === undefined) return null;
    return [`${tokenWords(c.inputTokens + c.outputTokens)} tokens`, c.costUsd !== null ? costWords(c.costUsd) : null].filter(Boolean).join(' · ');
  }, [record?.cost]);

  // ── the answer ──
  if (chosen !== null) {
    const words = chosen.action === 'let_run'
      ? <>You chose: <b>Let it run</b></>
      : chosen.action === 'stop'
        ? <>You chose: <b>Stop {label}</b> · undo it on the notice above</>
        : chosen.error !== undefined
          ? <>The note could not be sent: {chosen.error}</>
          : <>You sent {seatName} a note: <b>“{chosen.note}”</b></>;
    return (
      <p data-testid="inflight-check-record" data-action={chosen.action} className="wk-ask-record" role="status">
        <CircleCheck size={16} aria-hidden /> <span>{words}</span>
        {chosen.action === 'let_run' && <span className="wk-ask-rmeta">· studio asks again in {Math.round(threshold / 60_000)} min</span>}
      </p>
    );
  }

  if (record !== null && record.state === 'checking') {
    return (
      <p data-testid="inflight-check" data-state="checking" className="wk-ask-record wk-ask-record--busy" role="status" aria-live="polite">
        <span aria-hidden className="wk-chat-working-dots"><i /><i /><i /></span>
        <span>Checking with <b>{record.seat ?? 'another agent'}</b> · it only reads{cost !== null ? ` · ${cost} so far` : ''}</span>
        <span className="wk-ask-rmeta">{elapsedWords(now - record.requestedAt)}</span>
      </p>
    );
  }

  if (record !== null && record.state === 'done' && record.verdict !== null) {
    const v = VERDICT[record.verdict];
    const rec = record.action ?? 'let_run';
    const options: Array<{ id: InspectAction; label: string; sub: string; consequence: string; danger?: boolean }> = [
      { id: 'let_run', label: 'Let it run', sub: `check again in ${Math.round(threshold / 60_000)} min`, consequence: `${seatName} keeps going as it is. Studio offers another check after ${Math.round(threshold / 60_000)} more minutes.` },
      { id: 'steer', label: 'Steer it', sub: 'send it a note', consequence: `${seatName} reads your note at its next step and keeps working. Edit the note below before it goes.` },
      { id: 'stop', label: `Stop ${label}`, sub: 'its work so far is kept', consequence: `${label.charAt(0).toUpperCase() + label.slice(1)} stops where it is. You can undo it for 10 s.`, danger: true },
    ];
    const sel = options.find((o) => o.id === choice) ?? options[0]!;
    return (
      <section data-testid="inflight-check" data-state="done" data-verdict={record.verdict} data-source={record.source ?? ''} className="wk-ask" data-tone={v.tone} aria-label="How it is going">
        <p className="wk-ask-who">
          <span data-testid="inflight-check-verdict" className={`wk-ask-pill wk-ask-pill--${v.tone}`}>{v.word}</span>
          <span data-testid="inflight-check-by">
            {record.source === 'seat' ? `${record.seat ?? 'Another agent'} checked · read only` : 'Crew’s own reading of the record'}
            {cost !== null ? ` · this check: ${cost}` : ''}
          </span>
        </p>
        {record.doing !== null && <p data-testid="inflight-check-doing" className="wk-ask-q">{record.doing}</p>}
        {record.progress !== null && <p data-testid="inflight-check-progress" className="wk-ask-sub">{record.progress}</p>}
        {record.evidence.length > 0 && (
          <ul data-testid="inflight-check-evidence" className="wk-ask-evidence">
            {record.evidence.slice(0, 4).map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        )}
        {record.why !== null && <p data-testid="inflight-check-why" className="wk-ask-why">{record.why}</p>}
        <p className="wk-ask-then">What now?</p>
        <div role="radiogroup" aria-label="What now?" className="wk-ask-opts">
          {options.map((o) => (
            <button key={o.id} type="button" role="radio" aria-checked={choice === o.id} data-testid={`inflight-check-opt-${o.id}`} data-tone={o.danger === true ? 'danger' : undefined}
              onClick={() => { setChoice(o.id); if (o.id === 'steer' && note === '') setNote(record.note ?? ''); }} data-rec={o.id === rec ? 'true' : undefined} className="wk-ask-opt">
              <b>{o.label}</b>
              <span>{o.sub}</span>
              {o.id === rec && <i className="wk-ask-rec">Recommended</i>}
            </button>
          ))}
        </div>
        <p data-testid="inflight-check-consequence" className="wk-ask-cons"><b>If you choose this:</b> {sel.consequence}</p>
        {choice === 'steer' && (
          <textarea data-testid="inflight-check-note" aria-label={`Note to ${seatName}`} rows={2} value={note} onChange={(e) => setNote(e.target.value)}
            placeholder={`Say what ${seatName} should do differently`} className="wk-ask-text" />
        )}
        <div className="wk-ask-go">
          <button type="button" data-testid="inflight-check-commit" disabled={choice === 'steer' && note.trim() === ''} onClick={commit}
            className={`wk-btn ${choice === 'stop' ? 'wk-stop-btn' : 'wk-btn--primary'}`}>
            {choice === 'steer' ? `Send the note to ${seatName}` : sel.label}
          </button>
          <span className="wk-ask-rmeta">Nothing happens until you choose.</span>
        </div>
      </section>
    );
  }

  // ── the ask ──
  if (elapsed < threshold || elapsed < snoozeAt) return null;
  return (
    <section data-testid="inflight-check" data-state="ask" className="wk-ask" aria-label="Check on it?">
      <p className="wk-ask-who"><span className="wk-ask-pill">Check</span> studio asks</p>
      <p data-testid="inflight-check-q" className="wk-ask-q">This has been running {elapsedWords(elapsed).replace(/ \d+ s$/, '')} · Check on it?</p>
      <p className="wk-ask-sub">Another agent reads what {seatName} has done so far and says whether it is progressing, looping, stuck or wasting tokens. It only reads: nothing changes unless you choose.</p>
      <div className="wk-ask-yn">
        <button type="button" data-testid="inflight-check-yes" aria-checked="true" role="radio" data-rec="true" disabled={asking} onClick={ask} className="wk-ask-opt">
          <b>{asking ? 'Asking…' : 'Check on it'}</b><span>about a minute, a few cents</span><i className="wk-ask-rec">Recommended</i>
        </button>
        <button type="button" data-testid="inflight-check-later" aria-checked="false" role="radio" onClick={snooze} className="wk-ask-opt">
          <b>Not now</b><span>ask again in {Math.round(threshold / 60_000)} min</span>
        </button>
      </div>
      {refusal !== null && <p data-testid="inflight-check-refused" role="alert" className="wk-ask-why">{refusal}</p>}
    </section>
  );
}
