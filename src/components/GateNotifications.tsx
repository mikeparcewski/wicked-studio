import { useEffect, useReducer } from 'react';
import type { SessionView } from '../api/types.js';
import { sessionProjectId } from '../hooks/ambientProject.js';
import { useGateStore } from '../store/gates.js';
import type { OpenGate } from '../store/gates.js';
import { useMembershipStore } from '../store/membership.js';
import { plainGateQuestion, plainRunTitle } from '../board/deskWords.js';

/**
 * §7.1 (DES-UX-001, slice AA): how long an announcement dwells before it
 * self-expires. The GATE isn't going anywhere — it stays in the status bar's
 * gate count, the bottom panel, and the bell; the toast is an announcement,
 * not the record (§9 — the toast lifecycle changes, never the gate).
 */
export const TOAST_DWELL_MS = 20_000;

/** At most this many cards paint; the rest compress into one inert overflow
 *  line — an unbounded stack is exactly the B4 interception surface. */
export const MAX_TOAST_CARDS = 3;

/**
 * The session-local announcement ledger, module-scoped so a route change
 * (this component unmounts on the board and remounts elsewhere) never
 * resurrects a dismissed or expired announcement. Keyed `runId:receivedAt`,
 * so a NEW arrival for the same run announces afresh. `firstSeen` is when
 * THIS page first painted the toast — deliberately not the wire's
 * `receivedAt`, which for a daemon-cached gate can be minutes old and would
 * expire the announcement before it was ever seen.
 */
const firstSeen = new Map<string, number>();
const dismissed = new Set<string>();

const toastKey = (g: OpenGate): string => `${g.runId}:${g.receivedAt}`;

/** Test hook (unit tests only): drop the module-scoped announcement ledger. */
export function resetToastLedger(): void {
  firstSeen.clear();
  dismissed.clear();
}

interface Props {
  onSelect: (runId: string) => void;
  /** When set, only show the gate toast for this run (fixes studio#10). */
  runId?: string | null;
  /** The ambient project shell (`/p/:id/*`), when inside one — B4's context
   *  rule: another project's gate announces in the bottom bar + bell, never
   *  as an overlay card over this project's canvas. */
  projectId?: string | null;
  /** App's one `useRuns()` array — the DTO's own `project_id` claim is the
   *  first word on which project a gate's run belongs to (mirror fallback). */
  runs?: SessionView[];
}

export function GateNotifications({ onSelect, runId, projectId = null, runs = [] }: Props): React.ReactElement {
  const gates = useGateStore((s) => s.gates);
  // studio#441: the toast speaks the Desk's words (the plain question, the work's title), in its
  // palette — no run hash, engine ordinal, raw prompt, violet or mono. The Desk is the one shell (S18d).
  const projectIdByRun = useMembershipStore((s) => s.projectIdByRun);
  // Expiry needs a re-render at the moment a dwell elapses; nothing else here
  // is stateful — the gate record itself lives (and stays) in the gate store.
  const [, bump] = useReducer((n: number) => n + 1, 0);

  const all = Object.values(gates);
  const scoped = runId ? all.filter((g) => g.runId === runId) : all;

  // B4 (§7.1): inside a project shell, keep only THIS project's gates as
  // cards. DTO claim first (CREW-UX-2), membership mirror second; a gate we
  // genuinely cannot place (pre-0.8.0 daemon, no mirror row) still shows —
  // suppression requires KNOWING the gate is foreign, never assuming it.
  const open = projectId === null || runId
    ? scoped
    : scoped.filter((g) => {
        const run = runs.find((r) => r.session.id === g.runId);
        const claimed = run !== undefined ? sessionProjectId(run.session) : undefined;
        const pid = claimed !== undefined ? claimed : projectIdByRun[g.runId];
        return pid === undefined || pid === projectId;
      });

  // First-paint stamping (idempotent — safe under StrictMode double render).
  const now = Date.now();
  for (const g of open) {
    const key = toastKey(g);
    if (!firstSeen.has(key)) firstSeen.set(key, now);
  }

  const visible = open.filter((g) => {
    const key = toastKey(g);
    if (dismissed.has(key)) return false;
    return now - (firstSeen.get(key) ?? now) < TOAST_DWELL_MS;
  });

  // Wake exactly when the soonest-expiring visible toast crosses its dwell;
  // prune ledger entries whose gate left the store (answered/terminal runs).
  useEffect(() => {
    const live = new Set(all.map(toastKey));
    for (const key of firstSeen.keys()) if (!live.has(key)) firstSeen.delete(key);
    for (const key of dismissed) if (!live.has(key)) dismissed.delete(key);
    if (visible.length === 0) return;
    const soonest = Math.min(
      ...visible.map((g) => (firstSeen.get(toastKey(g)) ?? now) + TOAST_DWELL_MS),
    );
    const t = setTimeout(bump, Math.max(soonest - Date.now(), 0) + 50);
    return () => clearTimeout(t);
  });

  if (visible.length === 0) return <></>;

  const workOf = (id: string): string | null => {
    const problem = runs.find((r) => r.session.id === id)?.session.problem ?? '';
    const t = plainRunTitle(problem).trim();
    return t === '' ? null : t;
  };

  const cards = visible.slice(0, MAX_TOAST_CARDS);

  return (
    <div
      className="fixed right-4 flex flex-col items-end gap-2 z-50"
      data-testid="gate-notification-layer"
      // EC38 layout safety: the LAYER reserves no pointer surface — only the
      // visible cards (pointerEvents: auto below) accept clicks. 12 px off the bottom edge:
      // the classic runs bar it once sat above is retired (S18c).
      style={{ bottom: 12, pointerEvents: 'none' }}
    >
      {cards.map((gate) => (
        <div
          key={toastKey(gate)}
          data-testid="gate-notification"
          data-run-id={gate.runId}
          data-variant="desk"
          className="wk-desk-toast"
          // EC38: only the cards accept clicks (inline, so the layer contract holds without the stylesheet).
          style={{ pointerEvents: 'auto' }}
        >
          <button
            type="button"
            data-testid="toast-dismiss"
            aria-label="Dismiss notification"
            title="Dismiss — the question stays on the Desk"
            onClick={() => { dismissed.add(toastKey(gate)); bump(); }}
            className="wk-desk-toast-x"
          >
            ✕
          </button>
          <button
            type="button"
            onClick={() => onSelect(gate.runId)}
            data-testid="gate-toast"
            data-run-id={gate.runId}
            className="wk-desk-toast-body"
          >
            <span className="wk-desk-toast-head">
              <span aria-hidden className="wk-desk-dot wk-desk-dot--waiting" />
              <b data-testid="gate-toast-question">{plainGateQuestion(gate.prompt, gate.gateKind)}</b>
            </span>
            {workOf(gate.runId) !== null && (
              <span data-testid="gate-toast-work" className="wk-desk-toast-work">{workOf(gate.runId)}</span>
            )}
            <span className="wk-desk-toast-open">Open →</span>
          </button>
        </div>
      ))}
      {visible.length > cards.length && (
        <p
          data-testid="gate-toast-overflow"
          className="wk-toast wk-toast-line wk-desk-toast-more"
          // Inert by design: the overflow line is a pointer, not a control —
          // the runs bar's gate count is the actionable record.
          style={{ pointerEvents: 'none', margin: 0 }}
        >
          {`+${visible.length - cards.length} more waiting on the Desk`}
        </p>
      )}
    </div>
  );
}
