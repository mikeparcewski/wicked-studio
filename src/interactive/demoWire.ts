// Video mode's wires (DES-MERGE-001 §4.5, §6.4 slice 14): authoring a demo, recording
// one, and commenting on a step.
//
// ADR-0018's split is the constraint everything here is shaped by — the agent authors
// the spec, the MODEL-FREE service executes and records it. So nothing in this module
// decides what to click: it submits an ordered authoring intent, asks the service to
// run it, or asks for one STEP to be re-authored. Deterministic replay is what makes
// "change step 3" mean anything, and it only holds while the spec stays the authority.
//
// Both user-visible actions go through the thread, because a non-text input is a message
// too (§2.3): a recording the user asked for that leaves no trace in the transcript makes
// the transcript stop being the record of why v4 became v5.

import { createDoc, docBinding, requestRecord, type CreateDocBody, type DemoStepDraft } from '../api/interactive.js';
import { nextMsgId, threadKey, useDocThreadStore } from '../store/docThread.js';
import { submitFeedbackBatch, type SubmitBatchResult } from './feedbackBatch.js';

// ── Step anchors ─────────────────────────────────────────────────────────────

/**
 * A storyboard step's stable anchor, in the same shape a document element's `data-wid`
 * carries (INV-1). Same spelling on both sides of the seam means step feedback rides the
 * batch contract unchanged (§7.7) and its thread message deep-links back to the step.
 */
export function stepWid(index: number): string {
  return `step-${index}`;
}

// ── The ordered wizard (§4.5, §4.1) ──────────────────────────────────────────

/** What the wizard collects, in authoring order. */
export interface DemoDraft {
  name: string;
  targetUrl: string;
  steps: { subject: string; action: string }[];
}

/** A step is only authored once it says WHAT and TO WHAT — both halves, or neither. */
export function stepReady(step: { subject: string; action: string }): boolean {
  return step.subject.trim() !== '' && step.action.trim() !== '';
}

/** Submittable: a target to open, and at least one complete step to run against it. */
export function draftReady(draft: DemoDraft): boolean {
  return draft.name.trim() !== ''
    && /^https?:\/\/\S+/i.test(draft.targetUrl.trim())
    && draft.steps.length > 0
    && draft.steps.every(stepReady);
}

/** One step, in the transcript's words. The subject leads because it is what the user
 *  recognizes — the same reason a status line leads with its subject (§3.3). */
export function stepTitle(step: { subject: string; action: string }): string {
  return `${step.subject.trim()} — ${step.action.trim()}`;
}

/**
 * The draft as the thread reads it. This is the message the demo's conversation OPENS
 * with (§2.2 case 1), so it has to be the spec a human can check against the storyboard.
 */
export function demoBrief(draft: DemoDraft): string {
  return [
    `Record a demo of ${draft.targetUrl.trim()}:`,
    ...draft.steps.map((step, i) => `${i + 1}. ${stepTitle(step)}`),
  ].join('\n');
}

/**
 * The draft as the SERVICE reads it. `index` is assigned from the array position rather
 * than carried on the step, so the order the user authored is the order the spec has —
 * the two cannot disagree, which is the property the storyboard's chapter numbers rest on.
 */
export function demoDraftBody(
  projectId: string, draft: DemoDraft, sourceMessageId: string,
): CreateDocBody {
  const steps: DemoStepDraft[] = draft.steps.map((step, index) => ({
    index,
    subject: step.subject.trim(),
    action: step.action.trim(),
  }));
  return {
    name: draft.name.trim(),
    kind: 'demo',
    url: draft.targetUrl.trim(),
    brief: demoBrief(draft),
    demo_steps: steps,
    // §6.2 (slice U): the Unfiled mount creates unbound; real projects bind.
    ...docBinding(projectId),
    source_message_id: sourceMessageId,
  };
}

/**
 * Wizard completion (§2.2 case 1, for the demo path). The demo's conversation opens with
 * the authored spec as its first line, exactly as a document's opens with its brief —
 * one thread per artifact, spanning every version (§2.4).
 */
export async function createDemoFromDraft(
  projectId: string, draft: DemoDraft, msgId: string,
): Promise<{ name: string; text: string }> {
  const text = demoBrief(draft);
  const created = await createDoc(projectId, demoDraftBody(projectId, draft, msgId));
  const key = threadKey(projectId, created.name);
  const store = useDocThreadStore.getState();
  store.addUserMsg(key, msgId, text);
  store.addNarration(
    key,
    `Authored “${created.name}” — ${draft.steps.length} `
    + `${draft.steps.length === 1 ? 'step' : 'steps'} against ${draft.targetUrl.trim()}. `
    + 'Recording runs them in a real browser.',
  );
  return { name: created.name, text };
}

// ── Recording (§4.5, §2.3) ───────────────────────────────────────────────────

/** The line the thread opens a recording with. Informative means it names its subject
 *  AND what is happening to it — the fallback the surface falls back TO (§3.4 rule 3). */
export function recordingSubject(demoId: string, steps?: number, first?: string): string {
  // The composer can ask for a recording without having read the spec, so the count is
  // optional — but the SUBJECT never is: every branch names the demo and what is
  // happening to it, which is the whole of rule 3 (§3.4).
  if (steps === undefined) return `Recording “${demoId}” — running its authored steps in a real browser.`;
  const count = `${steps} ${steps === 1 ? 'step' : 'steps'}`;
  return first === undefined
    ? `Recording “${demoId}” — ${count}, in a real browser.`
    : `Recording “${demoId}” — ${count}, starting at “${first}”.`;
}

export interface RecordArgs {
  projectId: string;
  demoId: string;
  /** The user's ask, as the message it is (§2.3). */
  ask: string;
  /** Named so the opening narration has a subject before the service says anything.
   *  Absent when the caller has not read the spec (the composer's Record action). */
  steps?: number | undefined;
  first?: string | undefined;
}

/**
 * Queue a recording AND put it in the conversation. The order matters: the message and
 * its narration land FIRST so a request the service refuses still shows what was asked —
 * then the working state is retired and the caller renders the failure with its retry
 * (§3.3: an error with no next action is banned, and the button is that action).
 */
export async function recordFromThread(
  { projectId, demoId, ask, steps, first }: RecordArgs,
): Promise<void> {
  const key = threadKey(projectId, demoId);
  const store = useDocThreadStore.getState();
  store.addUserMsg(key, nextMsgId(), ask);
  store.addNarration(key, recordingSubject(demoId, steps, first));
  store.setGenState(key, 'generating');
  try {
    await requestRecord(projectId, demoId);
  } catch (e: unknown) {
    store.setGenState(key, 'terminal');
    throw e;
  }
}

// ── Step-targeted feedback (§4.3's batch, aimed at the spec) ─────────────────

export interface StepComment { index: number; text: string }

/**
 * Comment on N storyboard steps → ONE message, ONE regeneration (§4.3: N submits would
 * be N versions and N runs for what the user experienced as one round of edits), through
 * §7.7's two client-authored writes unchanged. What differs from a document batch is only
 * what the agent is being asked to re-author: `target: "demo_step"` says the diff belongs
 * in the SPEC, which is what makes the re-record deterministic rather than a fresh take.
 */
export function submitStepFeedback(
  projectId: string, demoId: string, version: number, comments: StepComment[],
): Promise<SubmitBatchResult> {
  return submitFeedbackBatch({
    projectId,
    docId: demoId,
    version,
    items: comments.map((c) => ({ wid: stepWid(c.index), text: c.text.trim() })),
    subject: 'this demo',
    target: 'demo_step',
  });
}
