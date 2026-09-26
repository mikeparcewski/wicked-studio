import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client.js';
import type { CoreEvent, SessionView } from '../api/types.js';
import { needsYouRows } from '../board/needsYou.js';
import { peekTarget, type PeekTarget } from '../board/peekTarget.js';
import { gateVerdictFor, phaseLabel, type GateVerdictView } from '../components/gateVerdictModel.js';
import { useRunEventStore } from '../store/events.js';
import { useElicitationStore } from '../store/elicitations.js';
import { useFailureClocks } from '../store/failureClocks.js';
import { useGateStore } from '../store/gates.js';
import { useNotificationStore } from '../store/notifications.js';
import { useStallEscalationStore } from '../store/stallEscalations.js';
import { anyModalOpen, useLayerStore } from '../store/layers.js';
import { useMembershipStore } from '../store/membership.js';
import { capturePlace, restorePlace, useReturnPlace } from '../store/place.js';
import { useProjectsStore } from '../store/projects.js';
import { useGlobalShortcuts, type ShortcutEntry } from './useGlobalShortcuts.js';
import type { Navigate } from './useRoute.js';

/**
 * Peek, jump, back (studio wave 2a, behaviour 3) — the behaviour, registered once, app-wide:
 *
 *   P   peek: show the top item that needs you (its gate card, with its evidence) IN PLACE —
 *       the URL does not change. P again or Esc closes it.
 *   G   jump: go to that gate (the thread at `#gate`), remembering exactly where you were.
 *   B   back: return to that place — route, scroll, focus, open panels (`store/place.ts`).
 *
 * All three are entries in the ONE shortcut registry, so the '?' overlay lists them and the
 * shared typing guard keeps them letters inside any input. The skin (`PeekCard`) renders
 * {@link PeekView}; it decides nothing.
 */

export interface PeekEvidence {
  /** The evaluator's verdict this gate is asking about, when the run's log holds one. */
  verdict: GateVerdictView | null;
  /** The phase that verdict judged, in the run's own vocabulary. */
  phase: string | null;
  /** The run's log is still being read. */
  loading: boolean;
}

export interface PeekView {
  open: boolean;
  target: PeekTarget | null;
  /** The owning project's display name, when known. */
  projectName: string | null;
  evidence: PeekEvidence;
  /** A jump has somewhere to come back to. */
  canReturn: boolean;
  close: () => void;
  jump: () => void;
}

const NO_EVIDENCE: PeekEvidence = { verdict: null, phase: null, loading: false };

function hereHref(): string {
  const { pathname, search, hash } = window.location;
  return `${pathname}${search}${hash}`;
}

export function usePeekJump(runs: SessionView[], navigate: Navigate): PeekView {
  const open = useLayerStore((s) => s.peekOpen);
  const gates = useGateStore((s) => s.gates);
  const projectIdByRun = useMembershipStore((s) => s.projectIdByRun);
  const attachedAtByRun = useMembershipStore((s) => s.attachedAtByRun);
  const projects = useProjectsStore((s) => s.projects);
  const canReturn = useReturnPlace((s) => s.place !== null);

  const failedAt = useFailureClocks((s) => s.failedAtByRun);
  const elicitations = useElicitationStore((s) => s.elicitations);
  const notifications = useNotificationStore((s) => s.notifications);
  const stallEscalations = useStallEscalationStore((s) => s.escalations);

  // THE ranked queue (wave 2b's `needsYouRows` → `compareNeeds`), folded from the app-wide
  // stores so peek works on every route. The home page's own wires (chats, campaigns,
  // repo graphs, proposals) are not loaded off-home; those kinds rank below everything
  // folded here, so they only become the peek when nothing else needs you.
  const target = useMemo(() => {
    const steerRequests = notifications
      .filter((n) => n.kind === 'steer_requested' && !n.read)
      .map((n) => ({ id: n.id, runId: n.runId, message: n.message, ts: n.ts }));
    const rows = needsYouRows({
      runs,
      gates,
      failedAt,
      attachedAt: attachedAtByRun,
      projectIds: projectIdByRun,
      chats: [],
      repos: [],
      campaigns: [],
      elicitations,
      steerRequests,
      stallEscalations,
      now: Date.now(),
    });
    return peekTarget({ rows, gates, runs, projectIdByRun });
  }, [runs, gates, failedAt, attachedAtByRun, projectIdByRun, elicitations, notifications, stallEscalations]);

  // The handlers live in a stable entry table; they read the current world through refs.
  const targetRef = useRef(target);
  targetRef.current = target;
  const navRef = useRef(navigate);
  navRef.current = navigate;

  const actions = useMemo(() => {
    const close = (): void => useLayerStore.getState().setPeekOpen(false);
    const jump = (): void => {
      const t = targetRef.current;
      if (t === null) return;
      close();
      // Jumping again from the gate itself must not overwrite where you came from.
      if (hereHref() !== t.path) useReturnPlace.setState({ place: capturePlace() });
      navRef.current(t.path);
    };
    const back = (): void => {
      const place = useReturnPlace.getState().place;
      if (place === null) return;
      close();
      useReturnPlace.setState({ place: null });
      restorePlace(place, (path) => navRef.current(path));
    };
    return { close, jump, back };
  }, []);

  const entries = useMemo<ShortcutEntry[]>(() => [
    {
      id: 'peek-toggle',
      chord: { key: 'p' },
      group: 'navigate',
      description: 'Peek at the top item that needs you (the URL stays put)',
      handler: (e) => {
        e.preventDefault();
        const layers = useLayerStore.getState();
        layers.setPeekOpen(!layers.peekOpen);
      },
    },
    {
      id: 'peek-jump',
      chord: { key: 'g' },
      group: 'navigate',
      description: 'Jump to the top item that needs you',
      guard: () => targetRef.current !== null,
      handler: (e) => {
        e.preventDefault();
        actions.jump();
      },
    },
    {
      id: 'peek-back',
      chord: { key: 'b' },
      group: 'navigate',
      description: 'Back to exactly where you were before the jump',
      guard: () => useReturnPlace.getState().place !== null,
      handler: (e) => {
        e.preventDefault();
        actions.back();
      },
    },
    {
      id: 'peek-close',
      chord: { key: 'escape' },
      group: 'navigate',
      description: 'Close the peek card',
      // The popover rung of the §7.7 chain: the '?' overlay and any modal close first.
      guard: () =>
        useLayerStore.getState().peekOpen &&
        !useLayerStore.getState().shortcutOverlayOpen &&
        !anyModalOpen(),
      handler: () => actions.close(),
    },
  ], [actions]);
  useGlobalShortcuts(entries);

  const evidence = usePeekEvidence(open ? target : null, runs);
  const projectName =
    target?.projectId != null ? projects.find((p) => p.id === target.projectId)?.name ?? target.projectId : null;

  return { open, target, projectName, evidence, canReturn, close: actions.close, jump: actions.jump };
}

/**
 * The peeked gate's evidence: the evaluator verdict it is asking about (`gateVerdictFor`,
 * the thread card's own model), read from the run's log — the hydrated copy when the run
 * page already holds it, else ONE `GET /runs/:id/events` per peeked run.
 */
function usePeekEvidence(target: PeekTarget | null, runs: SessionView[]): PeekEvidence {
  const runId = target?.runId ?? null;
  const hydrated = useRunEventStore((s) => (runId === null ? undefined : s.byRun[runId]));
  const [fetched, setFetched] = useState<{ runId: string; events: CoreEvent[] | null } | null>(null);

  useEffect(() => {
    if (runId === null || (hydrated !== undefined && hydrated.length > 0)) return;
    if (fetched?.runId === runId) return;
    let cancelled = false;
    setFetched({ runId, events: null });
    api
      .getRunEvents(runId)
      .then(({ events }) => { if (!cancelled) setFetched({ runId, events }); })
      .catch(() => { if (!cancelled) setFetched({ runId, events: [] }); });
    return () => { cancelled = true; };
    // `fetched` is read as a once-per-run guard, not a trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, hydrated]);

  if (target === null) return NO_EVIDENCE;
  const events = hydrated !== undefined && hydrated.length > 0
    ? hydrated
    : fetched?.runId === target.runId ? fetched.events : null;
  if (events === null) return { verdict: null, phase: null, loading: true };
  if (target.kind !== 'gate' || target.runId === null) return { verdict: null, phase: null, loading: false };
  const verdict = gateVerdictFor(events, target.ord ?? undefined, target.prompt ?? undefined);
  const units = runs.find((v) => v.session.id === target.runId)?.units ?? [];
  return { verdict, phase: verdict === null ? null : phaseLabel(target.runId, units, verdict.ord), loading: false };
}
