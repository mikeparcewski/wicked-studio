import { create } from 'zustand';
import type { CoreEvent } from '../api/types.js';

/** Cap per (run, unit) output buffer so a chatty CLI can't grow memory unbounded. */
const OUTPUT_CAP = 200_000;
/** Cap the per-run event log (ring-buffer semantics: keep the most recent). */
const LOG_CAP = 500;

/** One entry in a run's ordered, filtered event log (DES-STUDIO-001 §11.4). */
export interface LoggedEvent {
  /** Client-side monotonic arrival index — stable ordering key for rendering. */
  seq: number;
  type: string;
  ord?: number;
  /** Attempt number — preserved from any event that carries an `attempt` field. */
  attempt?: number;
  ts: number;
  /** A short human summary of the frame (cli won, description, prompt, message...). */
  detail: string;
}

/** The key for a unit's live output buffer: `<run>:u<ord>` (matches the transcript id). */
export function outputKey(session: string, ord: number): string {
  return `${session}:u${ord}`;
}

/** A compact one-line summary of a frame for the event log. */
function summarize(event: CoreEvent): string {
  switch (event.type) {
    case 'sessionStarted':
      return typeof event.problem === 'string' ? event.problem : 'run started';
    case 'unitPlanned':
      return typeof event.description === 'string' ? event.description : 'unit planned';
    case 'unitDistributed':
      return typeof event.cli === 'string' ? `assigned -> ${event.cli}` : 'distributed';
    case 'councilConvened':
      return Array.isArray(event.clis) ? `council convened — polling ${event.clis.length} CLIs` : 'council convened';
    case 'councilDeliberated':
      return typeof event.agreementPct === 'number'
        ? `ballot ${String(event.round ?? '?')} at ${event.agreementPct}% — below ${String(event.neededPct ?? '?')}%, runoff round starting`
        : 'council deliberating';
    case 'councilVoted':
      return typeof event.agreementPct === 'number'
        ? `council voted — ${event.agreementPct}% agreement (${String(event.votes ?? '?')} votes)`
        : 'council voted';
    case 'unitExecuting':
      return 'executing';
    case 'gateDecided':
      return event.allow === true ? 'gate: allow' : 'gate: deny';
    case 'unitDone':
      return 'unit done';
    case 'unitDenied':
      return 'unit denied';
    case 'awaitingHuman':
      return typeof event.prompt === 'string' ? `awaiting human: ${event.prompt}` : 'awaiting human';
    case 'resumed':
      return 'resumed';
    case 'runCancelled':
      return 'run cancelled';
    case 'sessionFailed':
      return 'run failed';
    case 'sessionCompleted':
      return 'run completed';
    case 'stepFailed':
      return typeof event.detail === 'string' ? event.detail : 'step failed';
    case 'crashRecoveryRedrive':
      return typeof event.attempt === 'number' ? `attempt ${event.attempt}` : 'crash recovery';
    case 'workerMessageQueued':
    case 'workerMessageInjected':
      return typeof event.message === 'string'
        ? `${String(event.target ?? 'all')}: "${event.message.length > 80 ? event.message.slice(0, 80) + '…' : event.message}"`
        : event.type;
    case 'error':
      return typeof event.message === 'string' ? `error: ${event.message}` : 'error';
    default:
      return event.type;
  }
}

/** Live council deliberation state for one unit (councilConvened / councilDeliberated / councilVoted). */
export interface CouncilStatus {
  state: 'convened' | 'deliberating' | 'voted';
  /** Roster keys polled (set on convened). */
  clis?: string[];
  /** Latest agreement percent (deliberating and voted). */
  agreementPct?: number;
  /** Vote count returned (deliberating and voted). */
  votes?: number;
  /** Deliberating only: the completed ballot number. */
  round?: number;
  /** Deliberating only: the approval bar the council must reach, as a percent. */
  neededPct?: number;
}

interface RuntimeStore {
  /** Accumulated live CLI output, keyed `<run>:u<ord>` (§11.4). */
  outputs: Record<string, string>;
  /** Live council deliberation per unit, keyed `<session>:<ord>`. */
  councilStatus: Record<string, CouncilStatus>;
  /** Per-run event log (excludes raw output deltas — those stream to `outputs`). */
  logs: Record<string, LoggedEvent[]>;
  /** Executor type per unit, keyed `<session>:<ord>` — populated from unitPlanned events. */
  executorTypes: Record<string, 'agent' | 'tool'>;
  /**
   * PTY terminal id per active worker, keyed `<session>:<cliKey>` — populated from
   * workerSessionStarted events. Used to open an observer terminal on agent click.
   */
  terminalIds: Record<string, string>;
  /** Monotonic arrival counter across all frames. */
  seq: number;
  /** Fold one CoreEvent: append output deltas, log every other run-scoped frame. */
  ingest: (event: CoreEvent) => void;
  /** Drop a run's accumulated output + log. */
  clear: (session: string) => void;
}

export const useRuntimeStore = create<RuntimeStore>((set) => ({
  outputs: {},
  councilStatus: {},
  logs: {},
  executorTypes: {},
  terminalIds: {},
  seq: 0,

  ingest: (event) => {
    const session = typeof event.session === 'string' ? event.session : undefined;
    // Frames with no run scope (heartbeat, repoRegistered, terminal*) aren't run-owned.
    if (session === undefined) return;

    set((s) => {
      const seq = s.seq + 1;

      // Live output delta -> append to the (run, unit) buffer (§11.4).
      if (
        event.type === 'cliOutputDelta' &&
        typeof event.ord === 'number' &&
        typeof event.chunk === 'string'
      ) {
        const key = outputKey(session, event.ord);
        const prev = s.outputs[key] ?? '';
        let combined = prev + event.chunk;
        if (combined.length > OUTPUT_CAP) combined = combined.slice(combined.length - OUTPUT_CAP);
        return { seq, outputs: { ...s.outputs, [key]: combined } };
      }

      // Heartbeats would flood the log and carry no run detail.
      if (event.type === 'heartbeat') return { seq };

      // Council deliberation lifecycle → live per-unit status (also logged below via fall-through
      // is NOT used here: log the entry inline so the status map and log stay one atomic update).
      if (
        (event.type === 'councilConvened' ||
          event.type === 'councilDeliberated' ||
          event.type === 'councilVoted') &&
        typeof event.ord === 'number'
      ) {
        const cKey = `${session}:${event.ord}`;
        const status: CouncilStatus =
          event.type === 'councilConvened'
            ? { state: 'convened', ...(Array.isArray(event.clis) ? { clis: event.clis as string[] } : {}) }
            : event.type === 'councilDeliberated'
              ? {
                  state: 'deliberating',
                  ...(typeof event.round === 'number' ? { round: event.round } : {}),
                  ...(typeof event.agreementPct === 'number' ? { agreementPct: event.agreementPct } : {}),
                  ...(typeof event.neededPct === 'number' ? { neededPct: event.neededPct } : {}),
                  ...(typeof event.votes === 'number' ? { votes: event.votes } : {}),
                }
              : {
                  state: 'voted',
                  ...(typeof event.agreementPct === 'number' ? { agreementPct: event.agreementPct } : {}),
                  ...(typeof event.votes === 'number' ? { votes: event.votes } : {}),
                };
        const entry: LoggedEvent = { seq, type: event.type, ts: Date.now(), detail: summarize(event) };
        entry.ord = event.ord;
        if (typeof event.attempt === 'number') entry.attempt = event.attempt;
        const prevLog = s.logs[session] ?? [];
        const nextLog = [...prevLog, entry];
        if (nextLog.length > LOG_CAP) nextLog.splice(0, nextLog.length - LOG_CAP);
        return {
          seq,
          councilStatus: { ...s.councilStatus, [cKey]: status },
          logs: { ...s.logs, [session]: nextLog },
        };
      }

      // unitPlanned: record executor type for council deliberation UI.
      // The wire field is camelCase `executorType` (event_to_json); accept the legacy
      // snake_case spelling too so older daemons keep working.
      const executorType = (event.executorType ?? event.executor_type) as string | undefined;
      if (
        event.type === 'unitPlanned' &&
        typeof event.ord === 'number' &&
        (executorType === 'agent' || executorType === 'tool')
      ) {
        const typeKey = `${session}:${event.ord}`;
        return {
          seq,
          executorTypes: { ...s.executorTypes, [typeKey]: executorType },
          ...((): Pick<RuntimeStore, 'logs'> => {
            const entry: LoggedEvent = { seq, type: event.type, ts: Date.now(), detail: summarize(event) };
            entry.ord = event.ord as number;
            const prevLog = s.logs[session] ?? [];
            const nextLog = [...prevLog, entry];
            if (nextLog.length > LOG_CAP) nextLog.splice(0, nextLog.length - LOG_CAP);
            return { logs: { ...s.logs, [session]: nextLog } };
          })(),
        };
      }

      // workerSessionStarted: record the terminalId for that CLI so the UI can attach a viewer.
      if (
        event.type === 'workerSessionStarted' &&
        typeof event.terminalId === 'string' &&
        typeof event.cliKey === 'string'
      ) {
        const tKey = `${session}:${event.cliKey as string}`;
        return {
          seq,
          terminalIds: { ...s.terminalIds, [tKey]: event.terminalId as string },
        };
      }

      // Every other run-scoped frame -> the per-run event log.
      const entry: LoggedEvent = { seq, type: event.type, ts: Date.now(), detail: summarize(event) };
      if (typeof event.ord === 'number') entry.ord = event.ord;
      if (typeof event.attempt === 'number') entry.attempt = event.attempt;
      const prevLog = s.logs[session] ?? [];
      const nextLog = [...prevLog, entry];
      if (nextLog.length > LOG_CAP) nextLog.splice(0, nextLog.length - LOG_CAP);
      return { seq, logs: { ...s.logs, [session]: nextLog } };
    });
  },

  clear: (session) =>
    set((s) => {
      const outputs = { ...s.outputs };
      for (const key of Object.keys(outputs)) {
        if (key.startsWith(`${session}:u`)) delete outputs[key];
      }
      const councilStatus = { ...s.councilStatus };
      for (const key of Object.keys(councilStatus)) {
        if (key.startsWith(`${session}:`)) delete councilStatus[key];
      }
      const executorTypes = { ...s.executorTypes };
      for (const key of Object.keys(executorTypes)) {
        if (key.startsWith(`${session}:`)) delete executorTypes[key];
      }
      const terminalIds = { ...s.terminalIds };
      for (const key of Object.keys(terminalIds)) {
        if (key.startsWith(`${session}:`)) delete terminalIds[key];
      }
      const logs = { ...s.logs };
      delete logs[session];
      return { outputs, councilStatus, executorTypes, terminalIds, logs };
    }),
}));
