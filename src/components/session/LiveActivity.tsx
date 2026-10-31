import { useEffect, useMemo, useState } from 'react';
import { BookOpen, CircleCheck, CircleX, GitCommitHorizontal, Loader, Pencil, Search, Sparkles, Terminal, Users } from 'lucide-react';
import { activityRows, activitySummary, currentTurn, narration, turnEndedAt, visibleRows, workingWords, type ActivityKind, type LiveRow, type TurnRef } from '../../board/liveActivity.js';
import { seatLabel } from '../../board/seatNames.js';
import { useRoster } from '../../hooks/useRoster.js';
import { api } from '../../api/client.js';
import { useRunEventStore } from '../../store/events.js';
import { outputKey, useRuntimeStore } from '../../store/runtime.js';
import { meterWords, rollingSummary, turnMeter, turnStart, type TurnKind } from '../../board/liveTurn.js';
import { InflightCheck } from './InflightCheck.js';

/**
 * What a working step is doing right now, live (operator 2026-10-30, "like Claude Code or Codex show"): the newest
 * few tool calls and edits, each with how long ago, and the step's newest line of its own words — refreshed every few
 * seconds while it runs. A finished step or turn says the same in one line ({@link ActivitySummaryLine}).
 */

const SHOWN = 5;

/** Runs whose recorded log was read in for a step's start (a reload mid-turn holds only the live frames since). */
const backfilled = new Set<string>();
const ICON: Record<ActivityKind, typeof Pencil> = {
  read: BookOpen, search: Search, run: Terminal, test: CircleCheck, edit: Pencil, write: Pencil, commit: GitCommitHorizontal,
  skill: Sparkles, task: Users, other: Terminal, working: Loader,
};

function ago(at: number | null, now: number): string | null {
  if (at === null) return null;
  const s = Math.max(0, Math.round((now - at) / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min`;
}

/**
 * `kind` (operator 2026-10-30, the chat's bare "studio working…"): a chat turn or a run's step. Either way, while it
 * works, the list leads with its meter ("Claude Code · 3 min 12 s · 412k tokens · $0.21") and, past 20 s, a one-line
 * rolling summary of its last half minute; past its threshold it offers the in-flight check ({@link InflightCheck}).
 * `label` is what Stop stops, in words.
 */
export function LiveActivity({ runId, ord, kind = 'step', seat = null, label }: { runId: string; ord: number; kind?: TurnKind; seat?: string | null; label?: string }): React.ReactElement | null {
  const events = useRunEventStore((s) => s.byRun[runId]);
  const output = useRuntimeStore((s) => s.outputs[outputKey(runId, ord)]);
  const roster = useRoster();
  const [now, setNow] = useState(() => Date.now());
  // Every few seconds: the ages move, and a row that just finished reads as finished.
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 3000); return () => clearInterval(t); }, []);
  // A power build's orchestrator: the turn running now; any other step: its newest attempt. A turn that ended says
  // itself in one line on its message, so the live list folds away once its last calls have been in view a minute.
  const turn = useMemo(() => currentTurn(events, ord), [events, ord]);
  const endedAt = turn !== null ? turnEndedAt(events, ord, turn) : null;
  const all = useMemo(() => activityRows(events, ord, turn), [events, ord, turn]);
  const rows = visibleRows(all, endedAt, now);
  const said = useMemo(() => (endedAt !== null ? null : narration(output)), [output, endedAt]);
  const meter = useMemo(() => (endedAt !== null ? null : turnMeter(events, ord)), [events, ord, endedAt]);
  const start = useMemo(() => turnStart(events, ord), [events, ord]);
  // A page opened mid-turn has no dispatch frame for it: the run's recorded log fills it in, once (merged, de-duplicated).
  useEffect(() => {
    if (start !== null || backfilled.has(`${runId}:${ord}`)) return;
    backfilled.add(`${runId}:${ord}`);
    api.getRunEvents(runId).then(({ events: ev }) => useRunEventStore.getState().hydrate(runId, ev)).catch(() => undefined);
  }, [start, runId, ord]);
  // The rolling line moves on its own 25 s beat, not on every 3 s tick.
  const summary = useMemo(() => (endedAt !== null ? null : rollingSummary(events, ord, now, turn)), [events, ord, now, turn, endedAt]);
  const seatKey = seat ?? all.find((r) => r.working !== undefined)?.working?.seat ?? null;
  const seatName = seatKey !== null ? seatLabel((roster ?? []).find((s) => s.key === seatKey) ?? { key: seatKey }) : 'It';
  const meterLine = meter !== null ? meterWords(meter, now) : '';
  if (rows.length === 0 && said === null && meterLine === '') return null;
  const shown = rows.slice(-SHOWN);
  // A quiet seat's row counts its silence up live, by the seat's roster name ("Codex · working · last output 40 s ago").
  const textOf = (r: LiveRow): string => {
    if (r.working === undefined || r.working.quietSince === null) return r.text;
    const seat = (roster ?? []).find((s) => s.key === r.working!.seat);
    return workingWords(seatLabel(seat ?? { key: r.working.seat }), r.working.quietSince, now);
  };
  const earlier = rows.length - shown.length;
  return (
    <div data-testid="live-activity" data-ord={ord} data-count={rows.length} data-kind={kind} className="wk-live" aria-live="polite" aria-label="What it is doing now">
      {meterLine !== '' && (
        <p data-testid="live-meter" className="wk-live-meter" data-live={meter?.live === true ? 'true' : 'false'}>
          <span className="wk-live-meter-who">{seatName}</span> · {meterLine}
        </p>
      )}
      {summary !== null && <p data-testid="live-rolling" className="wk-live-rolling">{summary}</p>}
      {earlier > 0 && <p data-testid="live-activity-earlier" className="wk-live-earlier">{earlier} earlier</p>}
      <ul className="wk-live-list">
        {shown.map((r) => {
          const Icon = r.running ? Loader : r.ok === false ? CircleX : ICON[r.kind];
          return (
            <li key={r.key} data-testid="live-activity-row" data-kind={r.kind} data-running={r.running ? 'true' : 'false'} className={`wk-live-row${r.running ? ' wk-live-row--running' : ''}${r.ok === false ? ' wk-live-row--fail' : ''}`}>
              <Icon size={13} aria-hidden className="wk-live-icon" />
              <span className="wk-live-text">{textOf(r)}</span>
              {r.kind !== 'working' && ago(r.at, now) !== null && <span className="wk-live-ago">{ago(r.at, now)}</span>}
            </li>
          );
        })}
      </ul>
      {said !== null && <p data-testid="live-activity-said" className="wk-live-said">“{said}”</p>}
      {endedAt === null && start !== null && start.at !== null && (
        <InflightCheck runId={runId} ord={ord} attempt={start.attempt} kind={kind} startedAt={start.at} now={now}
          seatName={seatName} seatKey={seatKey} label={label ?? (kind === 'chat' ? 'this answer' : 'the job')} />
      )}
    </div>
  );
}

/** A finished step's or turn's activity, in one line: "Read 4 files · ran 7 commands · edited 3 files · 2 commits". */
export function ActivitySummaryLine({ runId, ord, turn = null }: { runId: string; ord: number; turn?: number | TurnRef | null }): React.ReactElement | null {
  const events = useRunEventStore((s) => s.byRun[runId]);
  const line = useMemo(() => activitySummary(events, ord, turn), [events, ord, turn]);
  return line === null ? null : <p data-testid="activity-summary" className="wk-live-summary">{line}</p>;
}
