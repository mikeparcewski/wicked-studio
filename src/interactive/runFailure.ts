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

/**
 * Whether the SAME ask can be re-sent from the thread for this seam (F-4R2-014, review F3). Only the
 * chat seam listens on the wire the composer speaks (`chat.posted`); an edit batch re-posts on its
 * own wire (`feedback.submitted`, when the thread still holds the items); a draft is launched by
 * `doc.created` and a demo's spec by the demo surface — neither can be re-sent as a message, and
 * re-posting the brief as a chat ask fails again with a path in the message (crew's chat seam
 * refuses: "Crew could not read the document's current version (missing <path>)").
 */
export function seamRetry(seam: RunFailureSeam): 'ask' | 'batch' | 'none' {
  return seam === 'ask' ? 'ask' : seam === 'edit' ? 'batch' : 'none';
}

/** The way back for a seam whose ask cannot be re-sent from here — said instead of a dead Retry. */
export function seamWayBack(seam: RunFailureSeam): string | null {
  switch (seam) {
    case 'document':
      return 'A draft cannot be re-sent from here — start the document again from the launch composer (your brief is above; copy it).';
    case 'demo':
      return 'The demo\'s spec cannot be re-sent from here — start the demo again from the launch composer, or re-record once a spec exists.';
    case 'edit':
      return 'Re-send the feedback from the canvas — click the block and comment again.';
    default:
      return null;
  }
}

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
//   chat  "The crew run answering your ask {failed|was cancelled} (run <id>).…"      (chat-events.ts)
//   draft "The crew run answering this document {failed|was cancelled} (run <id>).…" (draft-events.ts)
//   edit  "The crew run answering this edit {failed|was cancelled} (run <id>).…"     (edit-events.ts)
//   demo  "The crew run authoring this demo's spec {failed|was cancelled} (run <id>).…" (demo-events.ts —
//         a different VERB and object; the studio's own earlier spelling never matched it, F-review)
const HEAD =
  /^The crew run (?:answering (your ask|this document|this edit)|(authoring) this demo's spec) (failed|was cancelled) \(run ([0-9a-fA-F-]{8,})\)\.\s*(.*)$/s;

const SEAM: Record<string, RunFailureSeam> = {
  'your ask': 'ask',
  'this document': 'document',
  'this edit': 'edit',
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
  const seam: RunFailureSeam = m[2] === 'authoring' ? 'demo' : (SEAM[m[1] ?? ''] ?? 'ask');
  const cancelled = m[3] === 'was cancelled';
  const runId = m[4] ?? '';
  let reason = (m[5] ?? '').trim();
  reason = reason.replace(/^Reason:\s*/i, '').replace(REMEDY_TAIL, '').trim();
  const expected = EXPECTED.exec(reason)?.[1] ?? null;
  const step = stepOf(expected);
  return { runId, cancelled, seam, reason, expected, step, summary: summarize(seam, cancelled, reason, step) };
}
