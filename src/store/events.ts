import { create } from 'zustand';
import type { CoreEvent } from '../api/types.js';

/**
 * The raw per-run append log the {@link import('../hooks/useRunModel.js').useRunModel}
 * merge folds over. Distinct from the runtime store (which owns high-volume output text +
 * a summarized event log): this keeps the *structured* frames the insight merge needs —
 * lifecycle + the Phase-B insight events — so the merge stays a pure function of them.
 *
 * `cliOutputDelta` / `unitOutputDelta` (streamed by the runtime store into `outputs`)
 * and heartbeats are dropped here — they carry no structured insight and would flood
 * the buffer.
 */

/**
 * Ring-buffer cap per run (keep the most recent). Set well above any realistic run's STRUCTURED-frame
 * count: the high-volume `cliOutputDelta` + `heartbeat` are excluded (see `IGNORED`), so what remains is
 * lifecycle + the low-volume insight events (tens per unit). The cap is only a pathological-spam backstop;
 * a normal run never approaches it, so the burn/data totals (which fold these frames) never silently lose
 * an early `cliUsage`/`dataUsed` to eviction. If a run ever DID exceed this, only the oldest lifecycle
 * frames drop first (appended-newest), and Burn already captions totals "(partial)" for any non-terminal
 * or pending/no-adapter seat.
 */
const CAP = 50000;

const IGNORED: ReadonlySet<string> = new Set(['cliOutputDelta', 'unitOutputDelta', 'heartbeat']);

/**
 * Content identity of a frame, ignoring the two fields only the DURABLE copy
 * carries (`ts`/`seq` are stamped by the event log at capture — the live `/ws`
 * copy of the same emission lacks both). Key order is normalized so the same
 * frame always fingerprints the same. Used by {@link RunEventStore.hydrate}'s
 * merge to de-duplicate live frames that raced the backfill fetch.
 */
function fingerprint(event: CoreEvent): string {
  const bag: Record<string, unknown> = {};
  for (const key of Object.keys(event).sort()) {
    if (key === 'ts' || key === 'seq') continue;
    bag[key] = (event as Record<string, unknown>)[key];
  }
  return JSON.stringify(bag);
}

interface RunEventStore {
  /** Ordered, capped structured frames keyed by run id. */
  byRun: Record<string, CoreEvent[]>;
  /** Fold one CoreEvent (drops output deltas / heartbeats / run-less frames). */
  ingest: (event: CoreEvent) => void;
  /** Seed a run's log from the durably-persisted event trail (`GET /runs/:id/events`).
   * The studio's `/ws` stream has no late-join replay, so a page reloaded against a
   * finished (or already-running) run showed an empty Burn panel even though the usage
   * was persisted. FINDING-013's original guard was all-or-nothing — ONE live frame
   * arriving before the fetch resolved dropped the ENTIRE backfill and the feed began
   * mid-story (DES-RUN-NARRATOR §3 rule 1). Now the recorded trail (every frame
   * carrying the run-wide `seq`) is merged as the authoritative PREFIX: live frames
   * that duplicate it (the same emission seen on both wires) are removed by content
   * fingerprint, the live remainder appends in arrival order. A live `cliUsage` is
   * therefore still never double-counted — the guard is upgraded, not weakened. */
  hydrate: (runId: string, events: CoreEvent[]) => void;
  /** Drop a run's log. */
  clear: (runId: string) => void;
}

export const useRunEventStore = create<RunEventStore>((set) => ({
  byRun: {},

  ingest: (event) => {
    const session = typeof event.session === 'string' ? event.session : undefined;
    if (session === undefined) return;
    if (IGNORED.has(event.type)) return;
    set((s) => {
      const prev = s.byRun[session] ?? [];
      const next = [...prev, event];
      if (next.length > CAP) next.splice(0, next.length - CAP);
      return { byRun: { ...s.byRun, [session]: next } };
    });
  },

  hydrate: (runId, events) =>
    set((s) => {
      const recorded = events
        .filter((e) => e.session === runId && !IGNORED.has(e.type))
        .sort((a, b) => (typeof a.seq === 'number' && typeof b.seq === 'number' ? a.seq - b.seq : 0));
      if (recorded.length === 0) return s;
      const live = s.byRun[runId] ?? [];
      if (live.length === 0) {
        return { byRun: { ...s.byRun, [runId]: recorded } };
      }
      // Merge (§3 rule 1): the recorded trail is complete up to the fetch, so any
      // live frame emitted before then exists in BOTH lists. Multiset-subtract the
      // recorded fingerprints from the live list (never clobbering a live-only
      // frame), then append what remains, in arrival order, behind the prefix.
      const counts = new Map<string, number>();
      for (const e of recorded) {
        const f = fingerprint(e);
        counts.set(f, (counts.get(f) ?? 0) + 1);
      }
      const tail = live.filter((e) => {
        const f = fingerprint(e);
        const n = counts.get(f) ?? 0;
        if (n > 0) {
          counts.set(f, n - 1);
          return false; // the recorded copy (with ts/seq) stands in for it
        }
        return true; // live-only — never lost
      });
      const merged = [...recorded, ...tail];
      if (merged.length > CAP) merged.splice(0, merged.length - CAP);
      return { byRun: { ...s.byRun, [runId]: merged } };
    }),

  clear: (runId) =>
    set((s) => {
      if (!(runId in s.byRun)) return s;
      const byRun = { ...s.byRun };
      delete byRun[runId];
      return { byRun };
    }),
}));
