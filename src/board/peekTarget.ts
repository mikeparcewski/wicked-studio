import type { SessionView } from '../api/types.js';
import type { OpenGate } from '../store/gates.js';
import { gateOpenPath } from './gateActions.js';
import type { NeedKind, NeedRow } from './needsYou.js';

/**
 * The item a peek shows and a jump goes to (studio wave 2a, behaviour 3): the TOP item of
 * the ONE ranked needs-you queue (wave 2b, `needsYouRows` → `compareNeeds`). No second
 * ranking exists here: whatever the queue puts first, peek shows and jump opens.
 *
 * Pure — the caller hands in the queue's ranked rows. A folded group ("2 approvals") is
 * never a destination on its own, so its top-ranked member stands in for it. A gate row
 * carries its cached gate (prompt + ord) so the peek card can show the evidence behind it.
 */

export interface PeekTarget {
  /** The queue row's identity (`gate:<run>`, `elicit:<run>`, `fail:<run>`, …). */
  key: string;
  kind: NeedKind;
  /** The run the row is about, when it is about one. */
  runId: string | null;
  /** The owning project, when known. */
  projectId: string | null;
  /** What the item is about (run intent, repo, campaign). */
  subject: string;
  /** The queue's own one-line narration for it. */
  text: string;
  /** A gate's question, or null (not a gate, or the daemon restarted and lost it). */
  prompt: string | null;
  /** A gate's unit ord, when the gate record is cached. */
  ord: number | null;
  /** How long it has waited (epoch ms), or null when no wire carries a clock. */
  at: number | null;
  /** Where a jump lands: the row's act-in-place destination (a gate: the thread at `#gate`). */
  path: string;
}

export interface PeekInputs {
  /** The ranked queue rows (`useNeedsRows` — the app-level `needsYouRows` fold — or its grouped fold). */
  rows: readonly NeedRow[];
  gates: Readonly<Record<string, OpenGate>>;
  runs: readonly SessionView[];
  projectIdByRun: Readonly<Record<string, string>>;
  /** Runs whose gate already has a decision (queued, in flight, answered): never peeked — a
   *  second decision there would be refused (wave 2a round 3). */
  decided?: (runId: string) => boolean;
}

/** Row keys spell their run as `<prefix>:<runId>` (needsYou.ts's dedupe identity). */
const RUN_KEYED: ReadonlySet<NeedKind> = new Set([
  'gate', 'elicitation', 'stall-escalated', 'steer-request', 'failed-run', 'stalled-run', 'stranded-run',
]);

function runOf(row: NeedRow): string | null {
  if (!RUN_KEYED.has(row.kind)) return null;
  const i = row.key.indexOf(':');
  return i < 0 ? null : row.key.slice(i + 1);
}

const TERMINAL: ReadonlySet<string> = new Set(['completed', 'failed', 'cancelled']);

/**
 * A gate the live gate store holds but the ranked queue does not show yet (studio#369). The queue
 * builds its gate rows off the run list's `awaiting_human` status, which trails the `/ws`
 * `awaitingHuman` frame by a list refresh (~1 s); in that window a P press read "Nothing needs
 * you" while the gate's toast was on screen. Gates are the queue's top severity class, so such a
 * gate outranks any non-gate top item; among several not-yet-folded gates the oldest wins. A gate
 * row already at the queue top stands: a not-yet-folded gate is at most one refresh old, and the
 * queue's own ranking (age band, then stakes) takes it over on the next fold.
 */
function liveGateNotQueued(
  flat: readonly NeedRow[],
  { gates, runs, projectIdByRun, decided }: PeekInputs,
): PeekTarget | null {
  const queued = new Set(flat.filter((r) => r.kind === 'gate').map(runOf));
  const pending = Object.values(gates)
    .filter((g) => !queued.has(g.runId) && (decided === undefined || !decided(g.runId)))
    .filter((g) => {
      const status = runs.find((v) => v.session.id === g.runId)?.session.status;
      return status === undefined || !TERMINAL.has(status);
    })
    .sort((a, b) => a.receivedAt - b.receivedAt);
  const g = pending[0];
  if (g === undefined) return null;
  const run = runs.find((v) => v.session.id === g.runId);
  const dto = run?.session.project_id;
  const projectId = typeof dto === 'string' ? dto : projectIdByRun[g.runId] ?? null;
  return {
    key: `gate:${g.runId}`,
    kind: 'gate',
    runId: g.runId,
    projectId,
    subject: run?.session.problem ?? g.runId,
    text: 'Gate: waiting on you',
    prompt: g.prompt,
    ord: g.ord,
    at: g.receivedAt,
    path: gateOpenPath('', g.runId),
  };
}

export function peekTarget(inputs: PeekInputs): PeekTarget | null {
  const { rows, gates, runs, projectIdByRun, decided } = inputs;
  // The queue's order, flattened (a group's members in their ranked order), minus every gate that
  // already carries a decision.
  const flat = rows.flatMap((r) => r.members ?? [r]);
  const top = flat.find((r) => {
    const id = r.kind === 'gate' ? runOf(r) : null;
    return id === null || decided === undefined || !decided(id);
  });
  if (top === undefined || top.kind !== 'gate') {
    const live = liveGateNotQueued(flat, inputs);
    if (live !== null) return live;
  }
  if (top === undefined) return null;
  const runId = runOf(top);
  const run = runId === null ? undefined : runs.find((v) => v.session.id === runId);
  const gate = top.kind === 'gate' && runId !== null ? gates[runId] : undefined;
  const dto = run?.session.project_id;
  return {
    key: top.key,
    kind: top.kind,
    runId,
    projectId: typeof dto === 'string' ? dto : runId !== null ? projectIdByRun[runId] ?? null : null,
    subject: top.subject,
    text: top.text,
    prompt: gate?.prompt ?? null,
    ord: gate?.ord ?? null,
    at: top.at,
    path: top.action.kind === 'open' ? top.action.path : top.subjectPath,
  };
}
