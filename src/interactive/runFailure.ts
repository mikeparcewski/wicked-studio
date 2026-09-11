/**
 * The crew seams' run-failure line, read for a human (acceptance finding F-4R2-014).
 *
 * When the governed run behind a document ask dies, crew's interactive seams (`chat-events`,
 * `draft-events`, `edit-events`, `demo-events`) narrate it as ONE `status.posted
 * {state:"error"}` frame whose message is the operator dump verbatim:
 *
 *   The crew run answering your ask failed (run <uuid>). Reason: [wicked-crew] deliverable
 *   floor: this phase declared 1 artifact(s); … [wicked-crew] EXPECTED: /abs/state/…/revised.html
 *   [wicked-crew] FOUND: (nothing) … DELIVERABLE FLOOR FAILED — … Inspect it via the crew API
 *   (GET /api/v1/runs/<uuid>), then resend the message.
 *
 * The failure is HONEST and stays — the floor did its job — but a document chat is not the
 * place for absolute state-home paths, issue numbers and a raw API URL. This module reads the
 * line into: the run it names (so the thread can LINK the run page instead of quoting a GET),
 * whether it failed or was cancelled, which seam spoke (ask / document / edit / demo), and a
 * one-sentence customer summary derived from the floor's own EXPECTED path (the step that
 * produced no file). The raw text is kept whole for the collapsed "details" block — translation
 * never paraphrases a refusal away, it only moves the dump behind a fold.
 *
 * A line that does not match the seams' spelling is not a run failure and parses to `null`;
 * the thread renders it as the plain error narration it always did.
 */

export type RunFailureSeam = 'ask' | 'document' | 'edit' | 'demo';

export interface RunFailure {
  /** The run the seam named — `null` never happens for a matching line, kept nullable for callers. */
  runId: string;
  cancelled: boolean;
  seam: RunFailureSeam;
  /** The seam's reason text after `Reason:` (or `''`), with the trailing "Inspect it via …" remedy removed. */
  reason: string;
  /** The deliverable the floor expected (the first `EXPECTED:` path), when the floor spoke. */
  expected: string | null;
  /** The named step that produced no file — derived from `expected`'s file name. */
  step: string | null;
  /** The customer sentence. */
  summary: string;
}

// The four seams' spellings (crew `interactive/*-events.ts`), one regex. The uuid is the run.
const HEAD =
  /^The crew run answering (your ask|this document|this edit|this demo) (failed|was cancelled) \(run ([0-9a-fA-F-]{8,})\)\.\s*(.*)$/s;

const SEAM: Record<string, RunFailureSeam> = {
  'your ask': 'ask',
  'this document': 'document',
  'this edit': 'edit',
  'this demo': 'demo',
};

/** What each seam's deliverable is called in the summary — the noun the customer used. */
const NOUN: Record<RunFailureSeam, string> = {
  ask: 'document',
  document: 'document',
  edit: 'document',
  demo: 'demo',
};

/** The crew seams' remedy tail — an API URL and "resend"/"assist loop" prose: dropped from `reason`. */
const REMEDY_TAIL = /\s*Inspect it via the crew API \(GET [^)]*\)[^.]*\.?\s*$/;

/** The floor's first EXPECTED path (absolute, up to the next `[wicked-crew]` marker or whitespace-run). */
const EXPECTED = /EXPECTED:\s*(\S+)/;

/** The step a deliverable path names, by the floor's own file conventions (crew `interactive/*-events.ts`). */
export function stepOf(expectedPath: string | null): string | null {
  if (expectedPath === null) return null;
  const base = expectedPath.split(/[\\/]/).pop() ?? '';
  if (/^revised\.html$/i.test(base)) return 'revise';
  if (/-v1\.html$/i.test(base)) return 'draft';
  if (/\.spec\.(mjs|js|ts)$/i.test(base)) return 'demo spec';
  if (/edited|fragment|handoff/i.test(base) || /interactive-edits/.test(expectedPath)) return 'edit';
  return null;
}

/** True when the reason is the deterministic deliverable floor speaking. */
function isFloor(reason: string): boolean {
  return /deliverable floor/i.test(reason);
}

/** The one customer sentence, from what the line actually says. */
export function summarize(seam: RunFailureSeam, cancelled: boolean, reason: string, step: string | null): string {
  const noun = NOUN[seam];
  if (cancelled) return `The run was cancelled before it produced anything — nothing changed in your ${noun}.`;
  if (isFloor(reason)) {
    return step !== null
      ? `The ${step} step produced no file, so this turn did not land — nothing changed in your ${noun}.`
      : `The run finished without producing the new version, so this turn did not land — nothing changed in your ${noun}.`;
  }
  return `The run failed before it produced the new version — nothing changed in your ${noun}.`;
}

/** Read one crew run-failure narration; `null` for any other line. */
export function parseRunFailure(text: string): RunFailure | null {
  const m = HEAD.exec(text.trim());
  if (m === null) return null;
  const seam = SEAM[m[1] ?? ''] ?? 'ask';
  const cancelled = m[2] === 'was cancelled';
  const runId = m[3] ?? '';
  let reason = (m[4] ?? '').trim();
  reason = reason.replace(/^Reason:\s*/i, '').replace(REMEDY_TAIL, '').trim();
  const expected = EXPECTED.exec(reason)?.[1] ?? null;
  const step = stepOf(expected);
  return { runId, cancelled, seam, reason, expected, step, summary: summarize(seam, cancelled, reason, step) };
}
