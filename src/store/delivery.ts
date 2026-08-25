import { create } from 'zustand';
import { api } from '../api/client.js';
import { prUrlFrom } from '../components/delivery.js';

/**
 * The delivered run's PR url — the ONE sanctioned per-run fetch (studio#122, EC59).
 *
 * `WorkUnit` carries no transcript (deliberately: `GET /runs` assembles every
 * run's detail, so inlining output would make the list endpoint O(all transcript
 * bytes)), so the url a delivered run printed lives behind
 * `GET /runs/:id/units/:unitKey/output` — the call studio already has
 * (`api.getUnitOutput`). This store holds one resolved {@link DeliveryUrl} per
 * run id, on exactly the posture `store/provenance.ts` set:
 *
 *  - ONE fetch per delivered run, cached per run id, in-flight-deduped.
 *  - A failed fetch caches the degraded answer too: revisits never re-fire.
 *  - LIST SURFACES NEVER CALL THIS. The project page and the build run list are
 *    DTO-derived and fire zero requests — an N-run fan-out is exactly what
 *    CREW-UX-8 (`session.delivery`) exists to make unnecessary, and when that
 *    field lands `load` is never reached at all.
 *
 * Call it ONLY for `state === 'delivered'`. A `rejected` deliver unit has NO
 * stored transcript BY DESIGN — deny-dominates writes no `work_output` past a
 * deny — so fetching for a failure asks a question the wire already answered
 * with `denial_reason`.
 */
export interface DeliveryUrl {
  /** The PR url from the transcript, or `null` when it carries none. */
  url: string | null;
  /**
   * The daemon's OWN reason the transcript is absent (`outputUnavailable`), or a
   * client-side "unreachable" note. `null` when the read succeeded — in which
   * case a `null` url is itself the honest answer: the deliver phase reported
   * done and printed no PR url (run 665a9aeb, the empty-branch push crew#317
   * describes). Never rendered as a link, never rendered as "Delivered" alone.
   */
  unavailable: string | null;
}

interface DeliveryStore {
  /** Resolved url per run id. An ABSENT key = not read yet (never "no url"). */
  byRun: Record<string, DeliveryUrl>;
  /** The one output fetch per delivered run; cached + in-flight-deduped. */
  load: (runId: string, unitKey: string) => void;
}

/** In-flight guard so a re-render during the fetch never doubles it. */
const inflight = new Set<string>();

export const useDeliveryStore = create<DeliveryStore>((set, get) => ({
  byRun: {},

  load: (runId, unitKey) => {
    if (get().byRun[runId] !== undefined || inflight.has(runId)) return;
    inflight.add(runId);
    api
      .getUnitOutput(runId, unitKey)
      .then(({ output, outputUnavailable }) => {
        set((s) => ({
          byRun: {
            ...s.byRun,
            [runId]: {
              url: output === null ? null : prUrlFrom(output),
              // `??` alone would keep an EMPTY `outputUnavailable` and the panel
              // would render a blank line where the daemon's reason belongs —
              // absent and empty are the same "nothing to say" here, and the
              // caller's own sentence is the honest fallback for both.
              unavailable:
                outputUnavailable !== undefined && outputUnavailable !== '' ? outputUnavailable : null,
            },
          },
        }));
      })
      .catch(() => {
        // Daemon unreachable / route absent — the degraded answer is cached too,
        // so the one-fetch-per-run budget holds on revisit (ConnectionStatus owns
        // reporting the outage; this line just stays honest about the link).
        set((s) => ({
          byRun: {
            ...s.byRun,
            [runId]: { url: null, unavailable: 'the deliver phase transcript could not be read' },
          },
        }));
      })
      .finally(() => {
        inflight.delete(runId);
      });
  },
}));
