import type { SessionView } from '../api/types.js';
import type { OpenGate } from '../store/gates.js';
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
  /** The ranked queue rows (`needsYouRows` output, or its grouped fold). */
  rows: readonly NeedRow[];
  gates: Readonly<Record<string, OpenGate>>;
  runs: readonly SessionView[];
  projectIdByRun: Readonly<Record<string, string>>;
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

export function peekTarget({ rows, gates, runs, projectIdByRun }: PeekInputs): PeekTarget | null {
  const first = rows[0];
  if (first === undefined) return null;
  const top = first.members?.[0] ?? first;
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
