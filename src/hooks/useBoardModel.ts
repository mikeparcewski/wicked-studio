import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { listDocs, type DocSummary } from '../api/interactive.js';
import type { Project, ProjectMember, SessionView } from '../api/types.js';
import {
  bandOf,
  compareScored,
  topSignal,
  type Band,
  type Signal,
} from '../board/boardAttention.js';
import { useGateStore, type OpenGate } from '../store/gates.js';
import { useRuntimeStore } from '../store/runtime.js';

/**
 * The orchestrator board's data model (DES-MERGE-001 §1.4; sort + bands per
 * DES-UXFIX-001 §2.1.3–§2.1.4, slice 1).
 *
 * The REST half: `GET /projects`, `GET /runs` (owned by `useRuns`, passed in),
 * each project's members, and the interactive `listDocs` for projects bound to an
 * interactive root. The LIVE half is not here and must not move here — narration
 * and doc status come from the shared runtime store, which the cards subscribe to
 * directly (§3.5: one socket, one store, no polling).
 *
 * Runs are joined to projects through MEMBERSHIP (`crew.run` / `crew.chat` refs) —
 * `AgentSession` carries no project id, so this is the only binding that exists.
 * Memberships are re-read when a run the board has never placed shows up in the
 * run list (slice 6): a run launched from a card's quick action, or by any other
 * client, must land on its project's card without a reload.
 *
 * Ordering is by DECAYED attention score (`boardAttention.ts`), not by a fixed
 * bucket — the F3 fix: a failure from last week no longer outranks a run that is
 * executing now. `deriveAttention`'s bucket survives as a LABELLING concern (the
 * status dot, `data-attention`); it is no longer the sort key.
 */

/** Attention buckets — §1.4's vocabulary, kept for the card's dot + label (D8). */
export type Attention = 'gate' | 'failing' | 'running' | 'drafts' | 'quiet';

/** Statuses that mean the run is moving under its own power. */
const ACTIVE: ReadonlySet<string> = new Set(['planning', 'distributing', 'executing']);

/** Membership kinds that make a run/thread a member of a project. */
const RUN_KINDS: ReadonlySet<string> = new Set(['crew.run', 'crew.chat']);

/** How often decayed scores are re-read (D7). Coarse on purpose: slow enough that
 *  the board never reorders under a cursor, fast enough that a demotion point is
 *  honoured without waiting for unrelated data to arrive. */
const TICK_MS = 60_000;

/** At most this many `runEvents` backfills per board load (D3 step 2 / R2). */
const MAX_BACKFILL = 12;

export interface BoardProject {
  project: Project;
  /** Display name of the bound repo (`crew.repo` member), or `null` when unbound. */
  repo: string | null;
  runs: SessionView[];
  docs: DocSummary[];
  /**
   * When each member run ENTERED this project (`attached_at` off the members
   * wire, run id → epoch ms) — the one honest per-run clock this surface can
   * reach, since `AgentSession` carries no timestamps. Slice E's charts bucket
   * on it (run outcome windows, the 7-day quiet-row sparklines), exactly as the
   * slice-D project dashboard already does.
   */
  attachedAt: Record<string, number>;
  attention: Attention;
  /** Decayed attention (§2.1.3): the max over the project's signals at the last tick. */
  score: number;
  band: Band;
  /** The signal that set the score — `null` when the project has none at all. */
  signal: Signal | null;
}

/**
 * The nullable per-project setting that maps a project onto a wicked-interactive
 * root (§7.1). It rides `Project`'s forward-additive index signature, so it is read
 * defensively: no root, no `listDocs` call, and a card with no doc tiles.
 */
export function interactiveRootOf(p: Project): string | null {
  const v = p.interactiveRoot ?? p.interactive_root;
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

/** §1.4's bucket, demoted from sort key to label (D8): what the dot means. */
export function deriveAttention(runs: SessionView[], docs: DocSummary[]): Attention {
  if (runs.some((v) => v.session.status === 'awaiting_human')) return 'gate';
  if (runs.some((v) => v.session.status === 'failed')) return 'failing';
  if (runs.some((v) => ACTIVE.has(v.session.status))) return 'running';
  if (docs.length > 0) return 'drafts';
  return 'quiet';
}

/**
 * The D3 source ladder: each signal is stamped with the most honest clock the
 * client can already reach, degrading source by source down to the project's
 * own `updated_at`. `AgentSession` carries no timestamps, so the ladder is the
 * whole reason the decay arithmetic has something true to decay FROM.
 *
 *   gate    → the gate store's `receivedAt` (server ISO on reconcile, arrival live)
 *   failing → the run's durable-log tail `ts` (backfilled once per run id, capped)
 *   running → the newest structured frame the runtime store has logged for the run,
 *             or a relayed interactive `status.posted` (a document being edited NOW
 *             is live work — it is what puts the doc-activity line on an ACTIVE
 *             card now that a quiet card renders no activity at all, slice 2)
 *   drafts  → the newest doc's `updated_at`
 *   any     → `project.updated_at`
 */
function signalsOf(
  project: Project,
  runs: SessionView[],
  docs: DocSummary[],
  gates: Record<string, OpenGate>,
  logTail: (runId: string) => number | undefined,
  failedAt: Record<string, number>,
  activityAt: number | undefined,
): Signal[] {
  const fallback = project.updated_at;
  const signals: Signal[] = [];
  if (activityAt !== undefined) signals.push({ kind: 'running', at: activityAt });
  for (const v of runs) {
    const id = v.session.id;
    const status = v.session.status;
    if (status === 'awaiting_human') {
      signals.push({ kind: 'gate', at: gates[id]?.receivedAt ?? fallback, runId: id });
    } else if (status === 'failed') {
      signals.push({ kind: 'failing', at: failedAt[id] ?? fallback, runId: id });
    } else if (ACTIVE.has(status)) {
      signals.push({ kind: 'running', at: logTail(id) ?? fallback, runId: id });
    }
  }
  if (docs.length > 0) {
    const newest = docs.reduce((acc, d) => {
      const t = d.updated_at === null ? NaN : Date.parse(d.updated_at);
      return Number.isNaN(t) ? acc : Math.max(acc, t);
    }, -Infinity);
    signals.push({ kind: 'drafts', at: Number.isFinite(newest) ? newest : fallback });
  }
  return signals;
}

/** Everything about a project that the run list itself cannot answer. */
interface Bindings {
  runIds: ReadonlySet<string>;
  repo: string | null;
  docs: DocSummary[];
  /** Run id → `attached_at` (epoch ms) off the same members read. */
  attachedAt: Record<string, number>;
}

const EMPTY: Bindings = { runIds: new Set(), repo: null, docs: [], attachedAt: {} };

async function loadBindings(p: Project, repoNames: Map<string, string>): Promise<Bindings> {
  const [members, docs] = await Promise.all([
    api.listProjectMembers(p.id).then((r) => r.members).catch((): ProjectMember[] => []),
    // No interactive root ⇒ no bridge to ask. A project WITH one whose bridge cannot be
    // started (§7.12) simply shows no tiles rather than failing the whole board.
    interactiveRootOf(p) ? listDocs(p.id).catch((): DocSummary[] => []) : Promise.resolve([]),
  ]);
  const repoRef = members.find((m) => m.member_kind === 'crew.repo')?.member_ref ?? null;
  const runMembers = members.filter((m) => RUN_KINDS.has(m.member_kind));
  const attachedAt: Record<string, number> = {};
  for (const m of runMembers) attachedAt[m.member_ref] = m.attached_at;
  return {
    runIds: new Set(runMembers.map((m) => m.member_ref)),
    repo: repoRef === null ? null : repoNames.get(repoRef) ?? repoRef,
    docs,
    attachedAt,
  };
}

export interface BoardModel {
  /** Score-ordered board cards. */
  items: BoardProject[];
  /** Runs no non-default project claims — the "Not in a project" shelf (D4). */
  unfiled: SessionView[];
  loading: boolean;
  error: string | null;
}

export function useBoardModel(runs: SessionView[]): BoardModel {
  const [projects, setProjects] = useState<Project[]>([]);
  const [bindings, setBindings] = useState<Record<string, Bindings>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** The decay clock (D7): scores are recomputed on this coarse tick. */
  const [now, setNow] = useState(() => Date.now());
  /** Backfilled durable-log tail per FAILED run id — the one age the client
   *  cannot otherwise know, and the one F3 is about (D3 step 2). */
  const [failedAt, setFailedAt] = useState<Record<string, number>>({});
  const gates = useGateStore((s) => s.gates);
  // Relayed doc statuses (slice 6) — REACTIVE, unlike `logs`: a `status.posted`
  // is rare (one per doc edit, not one per streamed frame) and it must be able
  // to promote its project into NEEDS YOU without waiting for the next tick.
  const docActivity = useRuntimeStore((s) => s.docActivity);
  const repoNames = useRef<Map<string, string>>(new Map());
  /** Run ids the board has already tried to place — one re-read per run, ever. */
  const placed = useRef<Set<string>>(new Set());
  /** Run ids whose event tail has been asked for — once per run id, ever (R2). */
  const backfilled = useRef<Set<string>>(new Set());
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let active: Project[];
      try {
        const [{ projects: all }, repos] = await Promise.all([
          api.listProjects(),
          api.listRepos().then((r) => r.repos).catch(() => []),
        ]);
        // The synthesized "Unfiled" bucket is NOT a project and never renders as a
        // card (F5, D4) — the same exclusion `useLegacyRedirect` applies, for the
        // same reason: a hit there means *no project*. Its runs surface through
        // `unfiled` below, as the last, collapsed shelf.
        active = all.filter((p) => p.status === 'active' && p.id !== 'default');
        repoNames.current = new Map(repos.map((r) => [r.id, r.name]));
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setLoading(false);
        }
        return;
      }
      if (cancelled) return;
      // Cards render as soon as the projects are known; tiles and chips fill in behind
      // them, so a slow bridge never holds the whole board on a spinner (§3.3).
      setProjects(active);
      setLoading(false);
      const entries = await Promise.all(
        active.map(async (p) => [p.id, await loadBindings(p, repoNames.current)] as const),
      );
      if (!cancelled) setBindings(Object.fromEntries(entries));
    })();
    return () => { cancelled = true; };
  }, []);

  // A run the board cannot place yet (launched from a quick action, or by another
  // client) means the membership snapshot is stale — re-read it. Guarded per run id,
  // so the unfiled runs that legitimately belong to no project cost exactly one pass
  // each rather than one per `GET /runs` reconcile.
  useEffect(() => {
    // Nothing is "unplaced" until the first membership read has landed — without this
    // the initial run list would fan out a second, identical read behind the first.
    if (projects.length === 0 || Object.keys(bindings).length === 0) return;
    const known = new Set(Object.values(bindings).flatMap((b) => [...b.runIds]));
    const unplaced = runs.filter((v) => !known.has(v.session.id) && !placed.current.has(v.session.id));
    if (unplaced.length === 0) return;
    for (const v of unplaced) placed.current.add(v.session.id);
    let cancelled = false;
    void (async () => {
      const entries = await Promise.all(
        projects.map(async (p) => [p.id, await loadBindings(p, repoNames.current)] as const),
      );
      if (!cancelled) setBindings(Object.fromEntries(entries));
    })();
    return () => { cancelled = true; };
  }, [runs, projects, bindings]);

  // D3 step 2: a FAILED run's age lives only in its durable event log, so it is
  // fetched — after first paint, once per run id ever, capped per board load, and
  // failure-tolerant (a failed fetch is a miss, never an error: the fallback clock
  // stands). Without this, a recently-touched project with a week-old failure
  // would read as fresh (R3).
  useEffect(() => {
    if (loading) return;
    for (const v of runs) {
      if (v.session.status !== 'failed' || backfilled.current.has(v.session.id)) continue;
      if (backfilled.current.size >= MAX_BACKFILL) break;
      const id = v.session.id;
      backfilled.current.add(id);
      void api.getRunEvents(id)
        .then(({ events }) => {
          const ts = events[events.length - 1]?.ts;
          if (mounted.current && typeof ts === 'number') {
            setFailedAt((m) => ({ ...m, [id]: ts }));
          }
        })
        .catch(() => { /* no durable log — the fallback clock stands */ });
    }
  }, [runs, loading]);

  const items = useMemo(
    () => {
      // Live-frame clocks are read NON-reactively: the tick and every run/binding/
      // gate change already recompute this memo, and subscribing to `logs` would
      // re-render the whole board once per streamed frame.
      const logs = useRuntimeStore.getState().logs;
      const logTail = (id: string): number | undefined => {
        const log = logs[id];
        return log !== undefined && log.length > 0 ? log[log.length - 1]?.ts : undefined;
      };
      return projects
        .map((project): BoardProject => {
          const b = bindings[project.id] ?? EMPTY;
          const mine = runs.filter((v) => b.runIds.has(v.session.id));
          const { score, signal } = topSignal(
            signalsOf(project, mine, b.docs, gates, logTail, failedAt, docActivity[project.id]?.at),
            now,
          );
          return {
            project, repo: b.repo, runs: mine, docs: b.docs, attachedAt: b.attachedAt,
            attention: deriveAttention(mine, b.docs),
            score, band: bandOf(score), signal,
          };
        })
        .sort((a, b) =>
          compareScored(
            { score: a.score, at: a.signal?.at ?? a.project.updated_at, name: a.project.name },
            { score: b.score, at: b.signal?.at ?? b.project.updated_at, name: b.project.name },
          ),
        );
    },
    [projects, bindings, runs, gates, docActivity, failedAt, now],
  );

  // The unfiled set (F5): what the run list holds that no membership claims. Held
  // back until the first membership read lands — before that, EVERY run would look
  // unfiled and the shelf would flash into existence on each load.
  const unfiled = useMemo(() => {
    if (loading || (projects.length > 0 && Object.keys(bindings).length === 0)) return [];
    const known = new Set(Object.values(bindings).flatMap((b) => [...b.runIds]));
    return runs.filter((v) => !known.has(v.session.id));
  }, [runs, projects, bindings, loading]);

  return { items, unfiled, loading, error };
}
