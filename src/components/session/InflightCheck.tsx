import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../api/client.js';
import type { Ask, AskAnswer } from '../../api/ask.js';
import { AskCard, AskRecord } from '../ask/AskCard.js';
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
 * undo). Nothing happens on its own. Both questions are the shared guided ask (`AskCard`, program DES-GUIDED-CHAT): the
 * recommended action preselected and marked, its consequence shown, the steer note in the card's reason box (opened
 * when you take Steer, prefilled with the suggested note), and an `AskRecord` line once answered.
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
  const minutes = Math.round(threshold / 60_000);
  const elapsed = now - startedAt;
  const [record, setRecord] = useState<UnitInspection | null>(null);
  const [asking, setAsking] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [snoozeAt, setSnoozeAt] = useState<number>(() => snoozed.get(key) ?? 0);
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

  /** The person's answer to the verdict's ask (AskCard): let it run, steer with the note, or stop. */
  const answer = useCallback((a: AskAnswer) => {
    if (a.option === 'let_run') {
      snooze();
      setChosen({ action: 'let_run', at: Date.now() });
      return;
    }
    if (a.option === 'stop') {
      stopRun([runId], label);
      setChosen({ action: 'stop', at: Date.now() });
      return;
    }
    const body = (a.reason ?? '').trim();
    if (body === '') return;
    api.injectMessage(runId, body, seatKey ?? 'all')
      .then(() => setChosen({ action: 'steer', at: Date.now(), note: body }))
      .catch((e: unknown) => setChosen({ action: 'steer', at: Date.now(), note: body, error: e instanceof Error ? e.message : String(e) }));
  }, [runId, seatKey, label, snooze]);

  const cost = useMemo(() => {
    const c = record?.cost;
    if (c === null || c === undefined) return null;
    return [`${tokenWords(c.inputTokens + c.outputTokens)} tokens`, c.costUsd !== null ? costWords(c.costUsd) : null].filter(Boolean).join(' · ');
  }, [record?.cost]);

  // ── the answer ──
  if (chosen !== null) {
    const line = chosen.action === 'let_run'
      ? 'You chose: Let it run'
      : chosen.action === 'stop'
        ? `You chose: Stop ${label} · undo it on the notice above`
        : chosen.error !== undefined
          ? `The note could not be sent: ${chosen.error}`
          : `You sent ${seatName} a note: “${chosen.note}”`;
    return (
      <AskRecord line={line} testId="inflight-check-record" className="wk-inflight-record"
        {...(chosen.action === 'let_run' ? { meta: `studio asks again in ${minutes} min` } : {})} />
    );
  }

  if (record !== null && record.state === 'checking') {
    return (
      <p data-testid="inflight-check" data-state="checking" className="wk-ask-record wk-inflight-record" role="status" aria-live="polite">
        <span aria-hidden className="wk-chat-working-dots"><i /><i /><i /></span>
        <span>Checking with <b>{record.seat ?? 'another agent'}</b> · it only reads{cost !== null ? ` · ${cost} so far` : ''}</span>
        <span className="wk-ask-record-meta">{elapsedWords(now - record.requestedAt)}</span>
      </p>
    );
  }

  if (record !== null && record.state === 'done' && record.verdict !== null) {
    const v = VERDICT[record.verdict];
    const rec = record.action ?? 'let_run';
    const verdictAsk: Ask = {
      id: `inflight:${key}:${record.id}`,
      host: 'chat',
      from: { kind: 'studio', id: 'studio', label: 'studio asks' },
      prompt: 'What now?',
      kind: 'choose',
      options: [
        { id: 'let_run', token: 'let_run', label: 'Let it run', sub: `check again in ${minutes} min`, consequence: `${seatName} keeps going as it is. Studio offers another check after ${minutes} more minutes.`, recommended: rec === 'let_run' },
        { id: 'steer', token: 'steer', label: 'Steer it', sub: 'send it a note', consequence: `${seatName} reads your note at its next step and keeps working. Edit the note before it goes.`, needsReason: true, recommended: rec === 'steer' },
        { id: 'stop', token: 'stop', label: `Stop ${label}`, sub: 'its work so far is kept', consequence: `${label.charAt(0).toUpperCase() + label.slice(1)} stops where it is. You can undo it for 10 s.`, tone: 'danger', recommended: rec === 'stop' },
      ],
      answeredBy: 'person',
      record: 'You chose: {label}',
    };
    return (
      <section data-testid="inflight-check" data-state="done" data-verdict={record.verdict} data-source={record.source ?? ''} className="wk-ask wk-inflight" data-tone={v.tone} aria-label="How it is going">
        <p className="wk-ask-who">
          <span data-testid="inflight-check-verdict" className={`wk-inflight-pill wk-inflight-pill--${v.tone}`}>{v.word}</span>
          <span data-testid="inflight-check-by">
            {record.source === 'seat' ? `${record.seat ?? 'Another agent'} checked · read only` : 'Crew’s own reading of the record'}
            {cost !== null ? ` · this check: ${cost}` : ''}
          </span>
        </p>
        {record.doing !== null && <p data-testid="inflight-check-doing" className="wk-ask-q">{record.doing}</p>}
        {record.progress !== null && <p data-testid="inflight-check-progress" className="wk-ask-sub">{record.progress}</p>}
        {record.evidence.length > 0 && (
          <ul data-testid="inflight-check-evidence" className="wk-inflight-evidence">
            {record.evidence.slice(0, 4).map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        )}
        {record.why !== null && <p data-testid="inflight-check-why" className="wk-inflight-why">{record.why}</p>}
        <p className="wk-inflight-then">What now?</p>
        <AskCard
          ask={verdictAsk}
          header={false}
          onAnswer={answer}
          reasonFor={(o) => (o.id === 'steer'
            ? { label: `Note to ${seatName}`, placeholder: `Say what ${seatName} should do differently`, prefill: record.note ?? '', send: `Send the note to ${seatName}` }
            : { label: 'Why? (kept with the record)' })}
          optionProps={(o) => ({ 'data-testid': `inflight-check-opt-${o.id}` })}
          footnote="Nothing happens until you choose."
          testIds={{ group: 'inflight-check-options', consequence: 'inflight-check-consequence', confirm: 'inflight-check-commit', send: 'inflight-check-commit', reason: 'inflight-check-note' }}
        />
      </section>
    );
  }

  // ── the ask ──
  if (elapsed < threshold || elapsed < snoozeAt) return null;
  const checkAsk: Ask = {
    id: `inflight:${key}:ask`,
    host: 'chat',
    from: { kind: 'studio', id: 'studio', label: 'studio asks' },
    prompt: 'Check on it?',
    kind: 'confirm',
    options: [
      { id: 'yes', token: 'yes', label: asking ? 'Asking…' : 'Check on it', sub: 'about a minute, a few cents', recommended: true, consequence: `Another agent reads what ${seatName} has done so far. It only reads.` },
      { id: 'later', token: 'later', label: 'Not now', sub: `ask again in ${minutes} min` },
    ],
    answeredBy: 'person',
    record: 'You chose: {label}',
  };
  return (
    <section data-testid="inflight-check" data-state="ask" className="wk-ask wk-inflight" aria-label="Check on it?">
      <p className="wk-ask-who"><span className="wk-ask-tag" data-tone="accent">Check</span> studio asks</p>
      <p data-testid="inflight-check-q" className="wk-ask-q">This has been running {elapsedWords(elapsed).replace(/ \d+ s$/, '')} · Check on it?</p>
      <p className="wk-ask-sub">Another agent reads what {seatName} has done so far and says whether it is progressing, looping, stuck or wasting tokens. It only reads: nothing changes unless you choose.</p>
      <AskCard ask={checkAsk} header={false} busy={asking} onAnswer={(a) => (a.option === 'yes' ? ask() : snooze())}
        optionProps={(o) => ({ 'data-testid': o.id === 'yes' ? 'inflight-check-yes' : 'inflight-check-later' })}
        testIds={{ group: 'inflight-check-options', consequence: 'inflight-check-consequence' }} />
      {refusal !== null && <p data-testid="inflight-check-refused" role="alert" className="wk-inflight-why">{refusal}</p>}
    </section>
  );
}
