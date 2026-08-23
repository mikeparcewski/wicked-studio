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
 *  - ONE fetch per detail view, cached per run id (§3.3's declared exception
 *    to the zero-requests-on-mount budgets — named in its AC). A failed fetch
 *    caches the degraded answer too: revisits never re-fire.
 *  - List rows (notifications) read ONLY this cache — no fan-out.
 *  - Absence degrades honestly: no matching audit entry (or an unreachable
 *    trail) is `{state:'unknown'}`, rendered as the brief's own words —
 *    "launched via API (actor unknown)" — never an omitted line.
 */
export type Provenance =
  | {
      state: 'known';
      actorId: string;
      actorKind: ActorKind;
      /**
       * The launch channel. The audit detail carries no channel marker, so the
       * honest derivation is: a run THIS studio session launched is `studio`
       * (we witnessed the POST); anything else can only truthfully be called
       * the API — a curl, another skin, a schedule all look identical here.
       */
      channel: 'studio' | 'API';
      /** Lineage from the audit detail (CREW-UX-3): the run this one retries. */
      retryOf?: string;
    }
  | { state: 'unknown' };

/**
 * Pure derivation over the audit page (unit-tested): the NEWEST `run.launched`
 * entry for this run wins (`GET /audit` serves newest-first). Anything short of
 * a well-formed actor is the degraded answer — never a fabricated name.
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
  return {
    state: 'known',
    actorId: launched.actor.id,
    actorKind: launched.actor.kind,
    channel: launchedHere ? 'studio' : 'API',
    ...(retryOf !== undefined ? { retryOf } : {}),
  };
}

interface ProvenanceStore {
  /** Derived provenance per run id — the cache list rows read (no fan-out). */
  byRun: Record<string, Provenance>;
  /** Run ids THIS studio session launched (the `studio` channel witness). */
  launchedHere: Record<string, true>;
  markLaunchedHere: (runId: string) => void;
  /** The one sanctioned audit fetch per detail view; cached + in-flight-deduped. */
  load: (runId: string) => void;
}

/** In-flight guard so a re-render during the fetch never doubles it. */
const inflight = new Set<string>();

export const useProvenanceStore = create<ProvenanceStore>((set, get) => ({
  byRun: {},
  launchedHere: {},

  markLaunchedHere: (runId) =>
    set((s) => ({ launchedHere: { ...s.launchedHere, [runId]: true } })),

  load: (runId) => {
    if (get().byRun[runId] !== undefined || inflight.has(runId)) return;
    inflight.add(runId);
    api
      .getAudit(runId)
      .then(({ entries }) => {
        set((s) => ({
          byRun: {
            ...s.byRun,
            [runId]: deriveProvenance(entries, runId, s.launchedHere[runId] === true),
          },
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
  },
}));
