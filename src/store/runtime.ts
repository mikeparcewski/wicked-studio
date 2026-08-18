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

/** Longest reason kept on a single log line before it is elided. */
const REASON_CAP = 160;

/**
 * The first line of a captured reason, CRLF-normalized and capped for a one-line log entry.
 *
 * Both halves matter: a seat that failed on Windows writes CRLF, and a bare `split('\n')` would
 * leave the `\r` behind; and a capture that is cut off must say so, or a truncated message reads
 * as a complete one.
 */
function firstLineOf(text: string): string {
  const line = text.replace(/\r/g, '').split('\n')[0] ?? '';
  return line.length > REASON_CAP ? `${line.slice(0, REASON_CAP - 1)}…` : line;
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
    case 'councilSeatFailed': {
      const exit = typeof event.exitCode === 'number' ? ` (exit ${event.exitCode})` : '';
      const why = (typeof event.stderr === 'string' && event.stderr.trim()) || (typeof event.detail === 'string' && event.detail.trim()) || '';
      // The stderr is what this event exists to carry — but the log is one line, so trim it to
      // the first line and cap it. The full capture stays on the frame. A Windows seat writes
      // CRLF, so strip the carriage returns first or the "first line" keeps a trailing \r that
      // renders as a stray glyph.
      return `seat ${String(event.cli ?? '?')} did not vote — ${String(event.kind ?? 'unreported')}${exit}${
        firstLineOf(why) ? `: ${firstLineOf(why)}` : ''
      }`;
    }
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
    case 'workerStalled':
      return `no output for ${String(event.stalledSecs ?? '?')}s — may be waiting at an interactive prompt (open Term or inject)`;
    case 'failureTriaged':
      return `triage: ${String(event.decision ?? '?')}${typeof event.analysis === 'string' && event.analysis ? ' — ' + event.analysis.slice(0, 120) : ''}`;
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

/**
 * The streamed text a frame carries, or null when it is not an output delta.
 * `unitOutputDelta` is the delta-relay spelling (shared contract 0.5.1, `text`);
 * `cliOutputDelta` is the legacy spelling (`chunk`). Identical append semantics,
 * one shared buffer, so every consumer reads the same text whichever frame the
 * daemon emits — live (`ingest`) or replayed (`hydrateOutputs`).
 */
function deltaTextOf(event: CoreEvent): string | null {
  return event.type === 'unitOutputDelta' && typeof event.text === 'string'
    ? event.text
    : event.type === 'cliOutputDelta' && typeof event.chunk === 'string'
      ? event.chunk
      : null;
}

/** One structured assumption parsed from a unit's output (assumptionRecorded). */
export interface RecordedAssumption {
  ord: number;
  kind: string;
  library: string;
  transform: string;
  /** false = needs-research placeholder — badge for human review. */
  known: boolean;
  detail: string;
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
  /**
   * Seats that were polled and did not vote, accumulated across the unit's ballots.
   *
   * Carried on the status — not only in the log — because it is the number that qualifies
   * the vote: "100% agreement" over one surviving seat of three is not the same governance
   * as 100% over three, and without this the two render identically.
   */
  failedSeats?: FailedSeat[];
}

/** One seat that was convened and did not vote (councilSeatFailed). */
export interface FailedSeat {
  /** Roster key of the seat. */
  cli: string;
  /** The named dispatch branch — `spawn_failed`, `non_zero_exit`, `timed_out`, … */
  kind: string;
  /** Exit code when the seat ran far enough to have one. */
  exitCode?: number;
  /** The seat's own stderr / OS error text, whichever was populated. */
  why: string;
}

/**
 * One interactive doc-status line, keyed by the project that owns the document
 * (DES-MERGE-001 §1.4 live activity, §5.4 one stream).
 *
 * The board renders this as a single informative line on the owning project's
 * card, and dates that document's tile from `at` — a `status.posted` IS the
 * document changing, which is the only "updated at" signal the board gets
 * between `listDocs` calls.
 */
export interface DocActivity {
  /** The doc the status is about, when the frame named one (`document_id`). */
  docId: string | null;
  /** The agent's own words — informative, never filler (§3.3). */
  message: string;
  /** Arrival time (epoch millis). */
  at: number;
}

/** The one relayed interactive event the board reads (§3.4(b) rule 1). */
const STATUS_POSTED = 'wicked.interactive.status.posted';

/** First non-empty string among the candidate keys of an untyped bag. */
function pick(bag: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = bag[key];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  return null;
}

/**
 * A `wicked.interactive.status.posted` frame reduced to the line the board shows,
 * or `null` for every other frame.
 *
 * Crew relays interactive's bus frames onto `/ws` inside slice 3's envelope,
 * `{type:'interactiveEvent', event}` — a foreign vocabulary crossing a seam this
 * repo does not own, so the payload is read DEFENSIVELY (both spellings of each
 * field, no throw on a shape that does not match). A frame that names no project
 * or carries no message is dropped rather than rendered as an empty status.
 */
export function docActivityOf(frame: CoreEvent): { projectId: string; activity: DocActivity } | null {
  if (frame.type !== 'interactiveEvent' || typeof frame.event !== 'object' || frame.event === null) {
    return null;
  }
  const event = frame.event as Record<string, unknown>;
  if (pick(event, 'event_type', 'type') !== STATUS_POSTED) return null;
  const payload =
    typeof event.payload === 'object' && event.payload !== null
      ? (event.payload as Record<string, unknown>)
      : {};
  const projectId = pick(payload, 'project_id', 'project') ?? pick(event, 'project_id', 'project');
  const message = pick(payload, 'message', 'status', 'text');
  if (projectId === null || message === null) return null;
  return {
    projectId,
    activity: {
      docId: pick(payload, 'document_id', 'doc_id', 'document'),
      message,
      at: Date.now(),
    },
  };
}

interface RuntimeStore {
  /** Accumulated live CLI output, keyed `<run>:u<ord>` (§11.4). */
  outputs: Record<string, string>;
  /**
   * Arrival `seq` of the newest output delta per run.
   *
   * Deltas stream into `outputs` and are deliberately NOT logged, so nothing else
   * orders scraped text against the structured frames in `logs`. The board's
   * headline needs exactly that comparison — §3.4(b) rule 1 lets a phase
   * transition win over the delta buffer only when it is the newer of the two.
   */
  deltaSeq: Record<string, number>;
  /** Newest relayed interactive doc status per project id (§5.4). */
  docActivity: Record<string, DocActivity>;
  /** Live council deliberation per unit, keyed `<session>:<ord>`. */
  councilStatus: Record<string, CouncilStatus>;
  /** Structured assumptions per run (assumptionRecorded events, arrival order). */
  assumptions: Record<string, RecordedAssumption[]>;
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
  /**
   * Seed a run's live-output buffers from the durably-persisted event trail
   * (`GET /runs/:id/events`). `/ws` has no late-join replay, and `outputs` was fed
   * ONLY by live frames — so a page opened (or reloaded) after a unit started
   * showed a bare "Working…" for a unit whose streamed text already existed, until
   * the next live delta happened to arrive. Same backfill idea as the run-event
   * store's `hydrate` (FINDING-013), with the guard moved per-key: a buffer that a
   * live `/ws` frame has already started is never touched, so replayed deltas are
   * never double-appended to live ones.
   */
  hydrateOutputs: (session: string, events: CoreEvent[]) => void;
  /** Drop a run's accumulated output + log. */
  clear: (session: string) => void;
}

export const useRuntimeStore = create<RuntimeStore>((set) => ({
  outputs: {},
  deltaSeq: {},
  docActivity: {},
  councilStatus: {},
  assumptions: {},
  logs: {},
  executorTypes: {},
  terminalIds: {},
  seq: 0,

  ingest: (event) => {
    // Relayed interactive frames are PROJECT-scoped, not run-scoped, so they are
    // folded before the run guard below drops everything without a `session`.
    const doc = docActivityOf(event);
    if (doc !== null) {
      set((s) => ({ seq: s.seq + 1, docActivity: { ...s.docActivity, [doc.projectId]: doc.activity } }));
      return;
    }

    const session = typeof event.session === 'string' ? event.session : undefined;
    // Frames with no run scope (heartbeat, repoRegistered, terminal*) aren't run-owned.
    if (session === undefined) return;

    set((s) => {
      const seq = s.seq + 1;

      // Live output delta -> append to the (run, unit) buffer (§11.4). ChatPanel's
      // live narration and the older LiveOutput consumers read the same buffer.
      const deltaText = deltaTextOf(event);
      if (deltaText !== null && typeof event.ord === 'number') {
        const key = outputKey(session, event.ord);
        const prev = s.outputs[key] ?? '';
        let combined = prev + deltaText;
        if (combined.length > OUTPUT_CAP) combined = combined.slice(combined.length - OUTPUT_CAP);
        return {
          seq,
          outputs: { ...s.outputs, [key]: combined },
          deltaSeq: { ...s.deltaSeq, [session]: seq },
        };
      }

      // Heartbeats would flood the log and carry no run detail.
      if (event.type === 'heartbeat') return { seq };

      // assumptionRecorded → per-run assumptions list (+ the normal log entry below
      // is skipped: the panel is the surface, a log line would just duplicate it).
      if (
        event.type === 'assumptionRecorded' &&
        typeof event.ord === 'number' &&
        typeof event.library === 'string' &&
        typeof event.transform === 'string'
      ) {
        const entry: RecordedAssumption = {
          ord: event.ord,
          kind: typeof event.kind === 'string' ? event.kind : 'external-transform',
          library: event.library,
          transform: event.transform,
          known: event.known === true,
          detail: typeof event.detail === 'string' ? event.detail : '',
        };
        const prev = s.assumptions[session] ?? [];
        return { seq, assumptions: { ...s.assumptions, [session]: [...prev, entry] } };
      }

      // A seat that was polled and did not vote. Accumulated onto the unit's council status
      // rather than replacing it: failures arrive between convened and voted, and the count of
      // seats that dropped out is what makes the final agreement percentage readable.
      if (event.type === 'councilSeatFailed' && typeof event.ord === 'number') {
        const cKey = `${session}:${event.ord}`;
        const prev = s.councilStatus[cKey];
        const seat: FailedSeat = {
          cli: typeof event.cli === 'string' ? event.cli : '?',
          kind: typeof event.kind === 'string' ? event.kind : 'unreported',
          ...(typeof event.exitCode === 'number' ? { exitCode: event.exitCode } : {}),
          // CRLF-normalized at the boundary: a Windows seat's stderr would otherwise carry \r
          // into every consumer, including the hover tooltip where it renders as a stray glyph.
          why: (
            (typeof event.stderr === 'string' && event.stderr.trim()) ||
            (typeof event.detail === 'string' && event.detail.trim()) ||
            ''
          ).replace(/\r\n?/g, '\n'),
        };
        const entry: LoggedEvent = { seq, type: event.type, ts: Date.now(), detail: summarize(event) };
        entry.ord = event.ord;
        const prevLog = s.logs[session] ?? [];
        const nextLog = [...prevLog, entry];
        if (nextLog.length > LOG_CAP) nextLog.splice(0, nextLog.length - LOG_CAP);
        return {
          seq,
          councilStatus: {
            ...s.councilStatus,
            [cKey]: {
              // A seat can fail before any convened frame is folded; default to 'convened'
              // rather than dropping the failure on the floor.
              ...(prev ?? { state: 'convened' as const }),
              failedSeats: [...(prev?.failedSeats ?? []), seat],
            },
          },
          logs: { ...s.logs, [session]: nextLog },
        };
      }

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
        // Each lifecycle frame replaces the status, but the failed seats accumulated so far
        // must survive it. Seats fail BEFORE the vote, so dropping them here would erase them
        // at exactly the moment the agreement percentage needs qualifying.
        const carried = s.councilStatus[cKey]?.failedSeats;
        if (carried !== undefined && carried.length > 0) status.failedSeats = carried;
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

  hydrateOutputs: (session, events) =>
    set((s) => {
      // Fold the trail's deltas per key first, then merge — one state write, and the
      // per-key liveness check stays atomic with it (a live frame that lands between
      // the fetch and this set() wins wholesale; skipping the key loses the older
      // replayed text but can never double-count, mirroring FINDING-013's guard).
      const folded: Record<string, string> = {};
      for (const event of events) {
        if (event.session !== session) continue;
        const deltaText = deltaTextOf(event);
        if (deltaText === null || typeof event.ord !== 'number') continue;
        const key = outputKey(session, event.ord);
        if (s.outputs[key] !== undefined) continue; // live buffer already started
        let combined = (folded[key] ?? '') + deltaText;
        if (combined.length > OUTPUT_CAP) combined = combined.slice(combined.length - OUTPUT_CAP);
        folded[key] = combined;
      }
      if (Object.keys(folded).length === 0) return s;
      // Spread order matters: existing (live) buffers win over the replayed fold.
      return { outputs: { ...folded, ...s.outputs } };
    }),

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
      const assumptions = { ...s.assumptions };
      delete assumptions[session];
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
      const deltaSeq = { ...s.deltaSeq };
      delete deltaSeq[session];
      return { outputs, deltaSeq, councilStatus, assumptions, executorTypes, terminalIds, logs };
    }),
}));
