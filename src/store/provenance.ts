import { create } from 'zustand';
import { api } from '../api/client.js';
import type { ActorKind, AuditEntry } from '../api/types.js';

/**
 * Run provenance — "launched by X via Y" (DES-UX-001 §3).
 *
 * The daemon's audit trail (`GET /audit?runId=`) is the declared system of
 * record for who launched a run: the engine's `LaunchOptions` carries no actor
 * field, so crew writes a `run.launched` entry with the AUTHENTICATED actor
 * at launch time (crew routes.ts:570). This store holds one derived
 * {@link Provenance} per run id:
 *
 *  - One live read per run id, plus one read after the run ends so the stop record is fresh.
 *    Failed reads cache the degraded answer too: revisits never re-fire that read.
 *  - List rows (notifications) read ONLY this cache — no fan-out.
 *  - Absence degrades honestly: no matching audit entry (or an unreachable
 *    trail) is `{state:'unknown'}`, rendered as "launch not recorded" (wicked-crew#632:
 *    absence means unknown, not API) — never an omitted line.
 */
export type Provenance =
  | {
      state: 'known';
      actorId: string;
      actorKind: ActorKind;
      /**
       * The launch channel. Resolution order: (1) `detail.channel` on the audit
       * entry (crew#632 — compared case-insensitively; the daemon emits lower-case
       * `studio|cli|api`); (2) the per-tab sessionStorage witness (`studio`);
       * (3) `unrecorded` — the daemon has not written the field and this tab did
       * not witness the launch. Never 'API'/'CLI' without the daemon saying so.
       */
      channel: 'studio' | 'CLI' | 'API' | 'unrecorded';
      /** Lineage from the audit detail (CREW-UX-3): the run this one retries. */
      retryOf?: string;
    }
  | { state: 'unknown' };

/**
 * Pure derivation over the audit page (unit-tested): the NEWEST `run.launched`
 * entry for this run wins (`GET /audit` serves newest-first). Anything short of
 * a well-formed actor is the degraded answer — never a fabricated name.
 *
 * Channel resolution order (survives page reload):
 *  1. `detail.channel` on the audit entry — the launch channel crew persists on
 *     `run.launched` since crew#632 (a launch body's `channel`); older daemons
 *     omit it. Read off `AuditEntry.detail` (`Record<string, unknown>`).
 *  2. `launchedHere` — set by the caller from the sessionStorage witness so the
 *     'studio' answer survives a same-session page reload even before the daemon
 *     writes the channel field.
 */
export function deriveProvenance(
  entries: readonly AuditEntry[],
  runId: string,
  launchedHere: boolean,
): Provenance {
  const launched = entries.find(
    (e) =>
      e.action === 'run.launched' &&
      e.runId === runId &&
      typeof e.actor === 'object' &&
      e.actor !== null &&
      typeof e.actor.id === 'string' &&
      typeof e.actor.kind === 'string',
  );
  if (launched === undefined) return { state: 'unknown' };
  const detail = (launched.detail ?? {}) as Record<string, unknown>;
  const retryOf = typeof detail['retryOf'] === 'string' ? detail['retryOf'] : undefined;
  const channelRaw = typeof detail['channel'] === 'string' ? detail['channel'].toLowerCase() : '';
  const channel: 'studio' | 'CLI' | 'API' | 'unrecorded' =
    channelRaw === 'studio' ? 'studio'
    : channelRaw === 'cli'  ? 'CLI'
    : channelRaw === 'api'  ? 'API'
    : launchedHere          ? 'studio'
    :                         'unrecorded';
  return {
    state: 'known',
    actorId: launched.actor.id,
    actorKind: launched.actor.kind,
    channel,
    ...(retryOf !== undefined ? { retryOf } : {}),
  };
}

/**
 * studio#537: a `gate.decided` is a REJECTION only on the reject arm — `approve: false` with no
 * `action` (the legacy two-arm wire) or `action: 'reject'`. `approve: false` + `action:
 * 'request_changes'` is a SEND-BACK: the creator was rewound and handed the note, the run went
 * on. Before this every `approve: false` read as a rejection, so an engine cancel hours after a
 * send-back was captioned "You rejected it" with the send-back note as the reason.
 */
function isRejection(d: Record<string, unknown>): boolean {
  return d['approve'] === false && (d['action'] === undefined || d['action'] === 'reject');
}

function isSendBack(d: Record<string, unknown>): boolean {
  return d['approve'] === false && d['action'] === 'request_changes';
}

/** The newest `gate.decided` for this run that `pick` accepts AND carried words; `null` when none did. */
function gateNoteOf(entries: readonly AuditEntry[], runId: string, pick: (d: Record<string, unknown>) => boolean): string | null {
  for (const e of entries) {
    if (e.action !== 'gate.decided' || e.runId !== runId) continue;
    const d = (e.detail ?? {}) as Record<string, unknown>;
    if (!pick(d)) continue;
    const amend = typeof d['amend'] === 'string' ? d['amend'].trim() : '';
    if (amend !== '') return amend;
  }
  return null;
}

/**
 * studio#478: the note the operator typed when they rejected a gate, off the same audit page —
 * crew records every gate decision as `gate.decided` with `detail.approve` and `detail.amend`. The
 * newest rejection for this run that carried words; `null` when none did. (The engine's own
 * `gate.decided` team event has no note; the HTTP audit is where the words are kept.) A send-back
 * (`action: 'request_changes'`) is NOT a rejection (studio#537) — see {@link sendBackNoteOf}.
 */
export function rejectNoteOf(entries: readonly AuditEntry[], runId: string): string | null {
  return gateNoteOf(entries, runId, isRejection);
}

/** studio#537: the newest send-back note (`approve: false, action: 'request_changes', amend`) — what the
 *  creator received and acted on; shown as a send-back, never as a rejection. */
export function sendBackNoteOf(entries: readonly AuditEntry[], runId: string): string | null {
  return gateNoteOf(entries, runId, isSendBack);
}

/** The daemon's own audit mark for the engine's turn ceiling (`WICKED_UNIT_TIMEOUT_SECS`) —
 *  "A worker turn hit its time ceiling and was stopped" (handover's SYSTEM_ACTION_TEXT). */
export const ENGINE_TIMEOUT_AUDIT = 'run.turn.timedout';

/**
 * studio#537: why a cancelled run ended, off the one audit fetch — the banner says exactly what the
 * record holds and puts no words in the operator's mouth:
 *  - `rejectNote`      — the operator REJECTED a gate with these words (the run was cancelled by that);
 *  - `sendBackNote`    — the operator's last send-back to the creator (acted on; not a rejection);
 *  - `stop`            — the newest recorded stop, its reason and whether a person stopped it;
 *  - `engineTimedOut`  — the daemon recorded a worker turn hitting the engine's time ceiling.
 */
export interface CancelStory {
  rejectNote: string | null;
  sendBackNote: string | null;
  engineTimedOut: boolean;
  stop: { reason: string | null; byPerson: boolean } | null;
}

export function cancelStoryOf(entries: readonly AuditEntry[], runId: string): CancelStory {
  const stopped = entries.find((e) => e.action === 'run.cancelled' && e.runId === runId);
  const reason = stopped?.detail?.['reason'];
  return {
    stop: stopped !== undefined ? { reason: typeof reason === 'string' && reason.trim() !== '' ? reason.trim() : null, byPerson: stopped.actor.kind === 'human' } : null,
    rejectNote: rejectNoteOf(entries, runId),
    sendBackNote: sendBackNoteOf(entries, runId),
    engineTimedOut: entries.some((e) => e.action === ENGINE_TIMEOUT_AUDIT && e.runId === runId),
  };
}

/** crew#1645: the daemon's one audit entry when the engine's `git fetch origin` failed at run start. */
export const BASE_UNFETCHED_AUDIT = 'run.base_unfetched';

/** The sentence crew wrote on `run.base_unfetched` (`detail.message`), or null when the run has none. */
export function baseNoticeOf(entries: readonly AuditEntry[], runId: string): string | null {
  const e = entries.find((x) => x.action === BASE_UNFETCHED_AUDIT && x.runId === runId);
  const m = e?.detail?.['message'];
  return typeof m === 'string' && m.trim() !== '' ? m : null;
}

/** SessionStorage key for runs this studio session launched (survives page reload). */
const SESSION_KEY = 'wk-studio-launches';

function readSessionLaunches(): Record<string, true> {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw !== null ? (JSON.parse(raw) as Record<string, true>) : {};
  } catch {
    return {};
  }
}

function writeSessionLaunch(runId: string): void {
  try {
    const current = readSessionLaunches();
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ ...current, [runId]: true }));
  } catch {
    // sessionStorage unavailable (e.g. private-browsing quota) — degrade silently
  }
}

interface ProvenanceStore {
  /** Derived provenance per run id — the cache list rows read (no fan-out). */
  byRun: Record<string, Provenance>;
  /** studio#478: the newest reject note per run ({@link rejectNoteOf}), from the same one fetch. */
  rejectNotes: Record<string, string | null>;
  /** studio#537: why a cancelled run ended ({@link cancelStoryOf}), from the same one fetch. */
  cancelStories: Record<string, CancelStory>;
  /** wicked-crew#1566: why this run may have started behind the remote ({@link baseNoticeOf}), same one fetch. */
  baseNotices: Record<string, string | null>;
  /** Run ids THIS studio session launched (the `studio` channel witness). */
  launchedHere: Record<string, true>;
  markLaunchedHere: (runId: string) => void;
  /** Runs whose one ended audit read has started (including failed reads). */
  endedRead: Record<string, true>;
  /** One live audit read, plus one ended read to pick up the stop record; both deduped. */
  load: (runId: string, ended?: boolean) => void;
}

/** In-flight guard so a re-render during the fetch never doubles it. */
const inflight = new Map<string, Promise<void>>();

export const useProvenanceStore = create<ProvenanceStore>((set, get) => ({
  byRun: {},
  rejectNotes: {},
  cancelStories: {},
  baseNotices: {},
  launchedHere: {},
  endedRead: {},

  markLaunchedHere: (runId) => {
    writeSessionLaunch(runId);
    set((s) => ({ launchedHere: { ...s.launchedHere, [runId]: true } }));
  },

  load: (runId, ended = false) => {
    if (get().byRun[runId] !== undefined && (!ended || get().endedRead[runId])) return;
    const pending = inflight.get(runId);
    if (pending !== undefined) {
      if (ended) void pending.then(() => get().load(runId, true));
      return;
    }
    if (ended) set((s) => ({ endedRead: { ...s.endedRead, [runId]: true } }));
    const read = api
      .getAudit(runId)
      .then(({ entries }) => {
        // Check both the in-memory Zustand witness AND the sessionStorage record so
        // 'studio' survives a same-session page reload even before the daemon writes
        // the channel field to the audit entry.
        const launchedHere =
          get().launchedHere[runId] === true || readSessionLaunches()[runId] === true;
        set((s) => ({
          byRun: {
            ...s.byRun,
            [runId]: deriveProvenance(entries, runId, launchedHere),
          },
          rejectNotes: { ...s.rejectNotes, [runId]: rejectNoteOf(entries, runId) },
          cancelStories: { ...s.cancelStories, [runId]: cancelStoryOf(entries, runId) },
          baseNotices: { ...s.baseNotices, [runId]: baseNoticeOf(entries, runId) },
        }));
      })
      .catch(() => {
        // Audit unreachable — the degraded answer is cached too, so the one-
        // fetch-per-detail-view budget holds on revisit (ConnectionStatus owns
        // reporting the outage; this line just stays honest).
        set((s) => ({ byRun: { ...s.byRun, [runId]: { state: 'unknown' } } }));
      })
      .finally(() => {
        inflight.delete(runId);
      });
    inflight.set(runId, read);
  },
}));
