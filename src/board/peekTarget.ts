import type { SessionView } from '../api/types.js';
import type { OpenGate } from '../store/gates.js';
import { gateOpenPath } from './gateActions.js';

/**
 * The item a peek shows and a jump goes to (studio wave 2a, behaviour 3): the TOP gate
 * that needs you, across every project.
 *
 * Pure in every input, so the choice is pinnable in unit tests. Order matches the home
 * queue's gate rows (`needsYou.ts` today: newest gate first, clockless last, run id as the
 * tie-break). When the ranked queue lands (wave 2b), this should read that ranking's top
 * gate instead of re-deriving it; the seam is this one function.
 */

export interface PeekTarget {
  runId: string;
  /** The owning project, or null when neither the DTO nor the membership mirror places it. */
  projectId: string | null;
  /** The run's intent — what the gate is holding up. */
  subject: string;
  /** The gate's own question, or null when the daemon restarted and the prompt was lost. */
  prompt: string | null;
  /** The gate's unit ord, when the gate record is cached. */
  ord: number | null;
  /** When the gate opened (epoch ms), or null when no clock is held. */
  receivedAt: number | null;
  /** Where a jump lands: the thread, at the gate card (`#gate`). */
  path: string;
}

export interface PeekInputs {
  runs: readonly SessionView[];
  gates: Readonly<Record<string, OpenGate>>;
  /** run id → project id (the membership mirror). */
  projectIdByRun: Readonly<Record<string, string>>;
  /** run id → membership attach clock, the fallback when no gate clock is held. */
  attachedAtByRun?: Readonly<Record<string, number>>;
}

export function peekTarget(inputs: PeekInputs): PeekTarget | null {
  const { runs, gates, projectIdByRun } = inputs;
  const attached = inputs.attachedAtByRun ?? {};
  const waiting = runs.filter(
    (v) => v.session.status === 'awaiting_human' && v.session.archived_at == null,
  );
  if (waiting.length === 0) return null;
  const clock = (v: SessionView): number | null =>
    gates[v.session.id]?.receivedAt ?? attached[v.session.id] ?? null;
  const top = [...waiting].sort(
    (a, b) =>
      (clock(b) ?? -Infinity) - (clock(a) ?? -Infinity)
      || a.session.id.localeCompare(b.session.id),
  )[0]!;
  const id = top.session.id;
  const gate = gates[id];
  const projectId = typeof top.session.project_id === 'string' ? top.session.project_id : projectIdByRun[id] ?? null;
  return {
    runId: id,
    projectId,
    subject: top.session.problem,
    prompt: gate?.prompt ?? null,
    ord: gate?.ord ?? null,
    receivedAt: clock(top),
    path: projectId !== null ? gateOpenPath(projectId, id) : `/runs/${encodeURIComponent(id)}`,
  };
}
