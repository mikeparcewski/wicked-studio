/**
 * SKIP QE ACCEPTANCE IN PLACE (studio#923; J4 0.16.6). Crew takes the operator's skip as a gate answer —
 * `POST /runs/:id/gate {approve: true, action: 'skip_qe', amend: <reason>}` (crew 0.16.6 `GateSchema`, a blank reason is a
 * 400) — at three gates (wicked-core `answer_skip_qe`): the gate before the deliver step (the hand-over QE refused: it
 * delivers, saying so), the escalation of a step only QE denied (it counts), and a failed floor's gate with QE behind it
 * (it re-opens on the floor alone). The relaunch form with Skip QE ticked is only the way to start the job over.
 */

export const SKIP_QE_ACTION = 'skip_qe';
export const SKIP_QE_KEY = 'skip-qe';
export const SKIP_QE_LABEL = 'Skip QE with a reason…';
export const SKIP_QE_SEND = 'Skip QE and deliver';
export const SKIP_QE_CONSEQUENCE = 'Delivers without a QE pass. Every gate and the delivery say “QE acceptance skipped by operator”, with your reason.';
export const SKIP_QE_GATE_TITLE = 'QE acceptance is skipped with your reason, labelled “QE acceptance skipped by operator” on the run, every gate and the delivery. The step’s other checks still decide.';
export const SKIP_QE_PLACEHOLDER = 'Why QE acceptance is skipped (the seats couldn’t run the tests, you checked it yourself)…';

/** Whether the engine offers the skip AT this gate: its prompt names the `skip_qe` action as one of this gate's answers
 *  ("Skip QE acceptance with a reason (action `skip_qe` … and this gate re-opens on the floor alone", "skip QE acceptance
 *  with a written reason (action `skip_qe`: the step counts"), never the deferral "at delivery, where you can skip it". */
export function offersSkipQeHere(prompt: string | undefined): boolean {
  if (prompt === undefined || !/action `skip_qe`/.test(prompt)) return false;
  return /skip QE acceptance with a (?:written )?reason \(action `skip_qe`(?!, labelled "QE acceptance skipped by operator"\))/i.test(prompt)
    || /this gate re-opens on the floor alone/.test(prompt);
}

/** Whether the engine defers the skip to the hand-over ("QE acceptance stays required at delivery, where you can skip it"). */
export function skipQeAtDelivery(prompt: string | undefined): boolean {
  return prompt !== undefined && /QE acceptance stays required at delivery, where you can skip it/.test(prompt);
}
