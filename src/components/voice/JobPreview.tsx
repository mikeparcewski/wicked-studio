import { useEffect, useMemo, useState } from 'react';
import { Pin, PinOff, X } from 'lucide-react';
import { api } from '../../api/client.js';
import type { SessionView } from '../../api/types.js';
import { narration } from '../../board/liveActivity.js';
import { jobTitle, plainGateQuestion } from '../../board/deskWords.js';
import { useRunEvents } from '../../hooks/useRunEvents.js';
import { useGateStore } from '../../store/gates.js';
import { outputKey, useRuntimeStore } from '../../store/runtime.js';
import { closeJob, pinJob } from '../../voice/controller.js';
import { useDashStore } from '../../voice/dashboardStore.js';
import { previewFacts } from '../../voice/jobPreview.js';
import { LiveActivity } from '../session/LiveActivity.js';

/** How often the run's detail (steps, power state) is read again while the tile is open. */
const DETAIL_MS = 10_000;

const LIVENESS: Record<string, { word: string; tone: 'run' | 'warn' | 'fail' | 'ok' | 'idle' }> = {
  working: { word: 'Working', tone: 'run' },
  quiet: { word: 'Quiet', tone: 'run' },
  waiting_on_you: { word: 'Waiting on you', tone: 'warn' },
  stalled: { word: 'Stalled', tone: 'fail' },
  held: { word: 'Held', tone: 'idle' },
};

/**
 * "SHOW ME THIS JOB" (lane voice-jobs): a large live tile on the voice dashboard. The same live activity the run page
 * shows (tool calls, edits, the quiet seat's "working" row, the step's meter), its phase, rigor, checks, the newest
 * line it said, and any decision waiting. Pinned, it stays when another job needs you. Swapped by "show me the other
 * one", closed by "close it" (or the buttons here).
 */
export function JobPreview({ runId, pinned }: { runId: string; pinned: boolean }): React.ReactElement {
  const sys = useDashStore((s) => s.system?.runs.find((r) => r.runId === runId) ?? null);
  const raw = useDashStore((s) => s.raw.system) as { runs?: Array<{ runId?: unknown; unitOrd?: unknown }> } | null;
  const unitOrd = useMemo(() => {
    const o = raw?.runs?.find((r) => r.runId === runId)?.unitOrd;
    return typeof o === 'number' ? o : null;
  }, [raw, runId]);
  const gate = useGateStore((s) => s.gates[runId]);
  const { events } = useRunEvents(runId);
  const [view, setView] = useState<SessionView | null>(null);
  const [readError, setReadError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setView(null);
    const read = (): void => {
      api.getRun(runId).then(({ run }) => { if (live) { setView(run); setReadError(null); } })
        .catch((e: unknown) => { if (live) setReadError(e instanceof Error ? e.message : String(e)); });
    };
    read();
    const t = setInterval(() => { if (document.visibilityState !== 'hidden') read(); }, DETAIL_MS);
    return () => { live = false; clearInterval(t); };
  }, [runId]);

  const facts = previewFacts(view, sys !== null ? { phase: sys.phase, unitOrd } : null, events);
  const output = useRuntimeStore((s) => (facts.ord !== null ? s.outputs[outputKey(runId, facts.ord)] : undefined));
  const said = useMemo(() => narration(output), [output]);
  const title = sys?.title ?? (view !== null ? jobTitle(view.session) : 'This job');
  const state = sys !== null ? LIVENESS[sys.liveness] ?? { word: sys.liveness, tone: 'run' as const }
    : facts.status !== null ? { word: facts.status === 'completed' ? 'Finished' : facts.status === 'cancelled' ? 'Stopped' : facts.status === 'failed' ? 'Failed' : facts.status, tone: facts.status === 'failed' ? 'fail' as const : 'idle' as const }
      : { word: 'Reading…', tone: 'idle' as const };

  return (
    <section className="wk-voice-tile wk-voice-job" data-testid="voice-job" data-run={runId} data-pinned={pinned ? 'true' : 'false'} aria-label={`Job: ${title}`} aria-live="off">
      <h3>
        <span>Job · live</span>
        <button type="button" className="wk-voice-tile-x wk-voice-job-btn" data-testid="voice-job-pin" aria-pressed={pinned}
          aria-label={pinned ? `Unpin ${title}` : `Pin ${title}`} title={pinned ? 'Pinned: it stays when another job needs you' : 'Pin it here'} onClick={() => pinJob(!pinned)}>
          {pinned ? <PinOff size={13} aria-hidden /> : <Pin size={13} aria-hidden />}
        </button>
        <button type="button" className="wk-voice-tile-x wk-voice-job-btn" data-testid="voice-job-close" aria-label={`Close ${title}`} onClick={closeJob}>
          <X size={13} aria-hidden />
        </button>
      </h3>
      <p className="wk-voice-job-title" data-testid="voice-job-title">
        <span className="wk-voice-dot" data-tone={state.tone} aria-hidden />
        <span className="wk-voice-job-name">{title}</span>
        <span className="wk-voice-job-state" data-testid="voice-job-state">{state.word}</span>
        {pinned && <span className="wk-voice-job-pinned">Pinned</span>}
      </p>
      <dl className="wk-voice-job-facts">
        <div><dt>Phase</dt><dd data-testid="voice-job-phase">{facts.phase ?? '—'}</dd></div>
        <div><dt>Rigor</dt><dd data-testid="voice-job-rigor">{facts.rigor === null ? '—' : facts.rigor === 'phased' ? 'phased run' : facts.rigor}</dd></div>
        <div><dt>Checks</dt><dd data-testid="voice-job-checks" data-tone={facts.checksTone}>{facts.checks}</dd></div>
        <div><dt>Waiting</dt><dd data-testid="voice-job-gates" data-tone={gate !== undefined ? 'warn' : 'idle'}>{gate !== undefined ? `a decision: ${plainGateQuestion(gate.prompt, gate.gateKind)}` : 'nothing on you'}</dd></div>
      </dl>
      {said !== null && (
        <p className="wk-voice-job-said" data-testid="voice-job-said"><small>Newest line</small>“{said}”</p>
      )}
      <div className="wk-voice-job-live">
        {facts.ord !== null
          ? <LiveActivity runId={runId} ord={facts.ord} kind="step" label={`“${title}”`} />
          : <p className="wk-voice-small">{readError !== null ? `Couldn’t read the job: ${readError}` : 'Not working on a step right now.'}</p>}
      </div>
      <p className="wk-voice-small wk-voice-job-tip">Say “tell it …”, “stop it”, “raise rigor”, “check on it”, or “close it”.</p>
    </section>
  );
}
