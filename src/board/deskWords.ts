import type { SessionView } from '../api/types.js';
import { deliverUnit, deliveryOf } from '../components/delivery.js';
import { humanTitle, onboardTitle } from '../components/runIdentity.js';

/**
 * THE DESK'S WORDS (DES-STUDIO-REBUILD-001 §3; DESIGN-simple §3), from the live reel take of
 * chapter 01-desk. Pure. The default layer says what is asked in plain words; the engine's own
 * text (rev, unit, band, mode, phase ids) stays underneath — on the gate card, and in the row's
 * technical handle when "Show technical details" is on.
 */

// ── studio#422: a gate's question ───────────────────────────────────────────────────────────

/** A phase id's plain noun ("Approve the review"). An id not listed reads as its words. */
const STEP_NOUN: Readonly<Record<string, string>> = {
  'adversarial-review': 'review', review: 'review', 'code-review': 'review', evaluate: 'review',
  build: 'build', implement: 'build', fix: 'fix',
  design: 'design', 'pa-scope': 'scope', scope: 'scope', clarify: 'questions and answers',
  research: 'research', recon: 'research', plan: 'plan',
  test: 'tests', 'test-plan': 'test plan', test_plan: 'test plan', verify: 'check',
  deliver: 'delivery', demo: 'demo', record: 'recording',
};

/** Engine text a default-layer line never carries — the ` ||| PHASE SCOPE:` scaffold included (studio#464). */
const ENGINE_TEXT = /\b(?:unit|rev|band|ord)\s*\d|\b(?:manual|auto) mode\b|→|\bgate_?kind\b|\|\|\|/i;

/** The engine appends its unit prompt's scaffold after ` ||| ` (` ||| PHASE SCOPE: …`): never words. */
function withoutScaffold(text: string): string {
  const at = text.indexOf('|||');
  return (at === -1 ? text : text.slice(0, at)).trim();
}

/** "Approve the plan (7 steps)", "Approve the review", or the author's own words — never the
 *  engine's prompt. `undefined` prompt (a late join before the prompt is read) → the plain wait. */
export function plainGateQuestion(prompt: string | undefined, gateKind: string | undefined): string {
  const p = (prompt ?? '').trim();
  if (gateKind === 'plan_approval' || /^Approve plan rev \d+/i.test(p)) {
    const list = /\):\s*(.+)$/s.exec(p)?.[1];
    const steps = list === undefined ? 0 : list.split('→').map((s) => s.trim()).filter((s) => s !== '').length;
    return steps > 1 ? `Approve the plan (${steps} steps)` : 'Approve the plan';
  }
  // studio#403: the engine's retry gate after a refused hand-over — the remote's refusal, or the
  // deliver script's own failure; the reason itself leads the row, under this question.
  if (/^The deliver phase refused:/i.test(p)) {
    return /the remote refused the push of /i.test(p) ? 'The remote refused the push — deliver again or stop?' : 'The hand-over failed — deliver again or stop?';
  }
  // A deliver gate (crew's "Approve delivery before unit N runs. <card>"): the hand-over (studio#441).
  if (gateKind === 'deliver' || /^Approve delivery\b/i.test(p)) return 'Approve the hand-over';
  const phase = /^Approve the output of unit \d+\s*\(\s*([A-Za-z0-9_-]+)/i.exec(p)?.[1];
  if (phase !== undefined) {
    const noun = STEP_NOUN[phase.toLowerCase()];
    return noun !== undefined ? `Approve the ${noun}` : `Approve the ${phase.replace(/[_-]+/g, ' ')} step`;
  }
  // The pre-execution form: "Approve unit 2 before it runs: review" (a phase id), ": <its words>",
  // or crew's "<phase> — <the run's goal> ||| PHASE SCOPE: …" (studio#464): the phase id before the
  // ` — ` names the step (the goal is already the row's title) and the scaffold is never shown.
  const raw = /^Approve unit \d+ before it runs:\s*(.+)$/i.exec(p.split('\n')[0]!.trim())?.[1];
  const before = raw === undefined ? undefined : withoutScaffold(raw);
  if (before !== undefined && before !== '') {
    const head = /^([A-Za-z0-9_-]+)\s+—\s/.exec(before)?.[1] ?? before;
    if (/^[A-Za-z0-9_-]+$/.test(head)) {
      const noun = STEP_NOUN[head.toLowerCase()];
      // studio#606 (6): a gate BEFORE a step runs asks to start it — "Approve the scope" is the
      // question about the step's OUTPUT, and the two gates of one step must not read the same.
      return noun !== undefined ? `Start the ${noun}?` : `Start the ${head.replace(/[_-]+/g, ' ')} step?`;
    }
    if (!ENGINE_TEXT.test(before)) return `Approve the next step: ${before}`;
  }
  // studio#570: the engine's pause prompts (a reviewer's FAIL, a failed floor, a denied tool call,
  // a team dispute, a seat that failed) each read as one line of the Desk's words; the engine's own
  // sentence stays underneath, in the row's Details.
  const paused = pausedStepQuestion(p, gateKind);
  if (paused !== null) return paused;
  const first = withoutScaffold(p.split('\n')[0]!);
  if (first === '' || ENGINE_TEXT.test(first)) return 'Waiting on your answer';
  return first;
}

/** The engine's pause prompts in one line each: what happened, and what the row's choices do
 *  (studio#570). `null` for every other prompt — the caller keeps its own fallbacks. */
function pausedStepQuestion(p: string, gateKind: string | undefined): string | null {
  if (/^\s*Unit\s+\d+\s+verdict is NOT PASS\b/i.test(p)) {
    // The reviewer edited the tree instead of judging it (wicked-core#431 / the read-only guard):
    // the edit was discarded and Approve retries on the restored tree — not a FAIL verdict.
    if (/changed the tree under review/i.test(p)) return 'The reviewer changed the work instead of judging it — retry on the restored tree?';
    // The rework cap (wicked-core#761): the review was already sent back as often as it may be.
    if (/^\s*Unit\s+\d+\s+verdict is NOT PASS again\b/i.test(p)) return 'The review hit its rework cap — land it, one more round, or stop?';
    // studio#601: only the REVIEWER'S OWN verdict reads as "said FAIL". Core leads the prompt with
    // it in parentheses when the evaluator's verdict denied (`denialSource: evaluator_verdict`:
    // "NOT PASS (the evaluator's verdict is FAIL…)", or its missing `VERDICT:` line). The arms
    // list ("…request changes to send the review back…") rides EVERY NOT PASS prompt, whoever
    // denied — an agent judge refusing a passing review, a pinned validator — so it is never read.
    if (/NOT PASS\s*\((?:the evaluator's|no `VERDICT:` line in the evaluator's)|verdict is FAIL|evaluator denied/i.test(p)) {
      return 'The reviewer said FAIL — send it back?';
    }
    return 'The step did not pass review — how should it go on?';
  }
  if (/^\s*Unit\s+\d+\s+failed its deterministic floor\b/i.test(p)) return 'The floor failed — how should the step go on?';
  if (/^\s*Unit\s+\d+\s+was DENIED by input governance\b/i.test(p)) {
    const tool = /tool call was refused\s*\(\s*`?([A-Za-z0-9_.:-]+)`?\s*\)/i.exec(p)?.[1];
    return tool !== undefined ? `A ${tool} call was denied — how should the step go on?` : 'A tool call was denied — how should the step go on?';
  }
  // Core's output-governance denial ("Governance DENIED unit N (key): …") judges the WORK, not a tool call.
  if (/^\s*Governance DENIED unit\s+\d+/i.test(p)) return 'Governance denied this step — how should it go on?';
  if (/^\s*Team dispute on unit\s+\d+/i.test(p) || gateKind === 'team_dispute') return 'The team disagreed — send it back, approve or reject?';
  if (gateKind === 'team_transport') return 'The team lost a seat — approve or reject the work?';
  if (/^\s*Unit\s+\d+\s+failed and triage escalated\b/i.test(p)) return 'The step failed — send it back, reassign or stop?';
  if (/^\s*Unit\s+\d+\s+\([^)]*\)\s+refused its environment\b/i.test(p) || /^\s*Unit\s+\d+\s+failed again on attempt\s+\d+/i.test(p)) {
    return 'The step could not start — retry or stop?';
  }
  if (gateKind === 'escalation') return 'The step was escalated — how should it go on?';
  return null;
}

// ── studio#423: a run's title ───────────────────────────────────────────────────────────────

/** A run's title in the default layer. Onboarding runs say which repo ("Set up checkout-demo"):
 *  the title fold cut "Onboard repository: <name>" at its colon, so every one read the same. */
export function plainRunTitle(problem: string): string {
  return onboardTitle(problem) ?? askTitle(problem) ?? humanTitle(problem);
}

// ── studio#540: an ask run's title ──────────────────────────────────────────────────────────

/** Is this run's `problem` crew's chat-scope statement — the run is a chat's ask path? Crew sets an
 *  ask run's `problem` to the statement its seats read (`routes.ts`: `chatScopeStatement(...)`):
 *  the `# Chat scope` heading AND its scratch-root sentence — the heading alone is not it, so an
 *  operator's own question that happens to open with that heading keeps its words (codex r1 #1). */
export function isChatScopeProblem(problem: string): boolean {
  return /^#\s*Chat scope\s*\n\s*This directory is the scratch root of wicked-crew chat\b/i.test(problem.trimStart());
}

/**
 * An ask run's title (studio#540): its `problem` is a seat briefing ("# Chat scope · This directory
 * is the scratch root …"), so the clause cut titled every ask "# Chat scope". The statement never
 * carries the question — that is the chat's first turn, which {@link sessionTitle} takes whenever
 * the transcript is at hand (crew#823 tracks putting the question on the run itself) — so this
 * says what the statement DOES say: what the conversation is about. `null` for any other run.
 */
export function askTitle(problem: string): string | null {
  if (!isChatScopeProblem(problem)) return null;
  const repos = [...problem.matchAll(/^- \*\*([^*\n]+)\*\*/gm)].map((m) => m[1]!.trim()).filter((r) => r !== '');
  if (repos.length > 0) {
    const about = repos.length <= 2 ? repos.join(' and ') : `${repos.slice(0, 2).join(', ')} and ${repos.length - 2} more`;
    return `A conversation about ${about}`;
  }
  if (/^## Scope: system\b/m.test(problem)) return 'A conversation about the wicked platform';
  return 'A conversation';
}

// ── studio#424: finished work kept on this machine ──────────────────────────────────────────

/** A completed run the daemon calls `stranded` that was never asked to deliver (no deliver phase,
 *  and no post-hoc `POST /runs/:id/deliver` tried this session): the work is where the run left it,
 *  as asked. Not a need, and no PR was ever promised. A post-hoc attempt in flight or failed leaves
 *  no deliver unit either, so the caller says whether one was tried (Copilot). */
export function keptLocally(view: SessionView, deliveryAttempted = false): boolean {
  return !deliveryAttempted && view.session.status === 'completed' && deliveryOf(view).state === 'stranded'
    && deliverUnit(view) === null;
}

/** Its line on the Desk and in the rail. */
export const KEPT_LINE = 'Finished · kept on this machine, not pushed';

/** A finished run whose post-hoc delivery landed this session. */
export const DELIVERED_LINE = 'Finished · delivered';

// ── studio#444: what a hand-over sends, in one plain sentence ───────────────────────────────

/**
 * The deliver gate's target in one plain sentence, built from the parts of the engine's card
 * (crew `newPrTargetSentence` / the revise-PR line). Never the card itself: that carries the
 * origin's absolute local path, the run branch (a run UUID) and engine words ("gh resolves", "IS
 * the delivery"). The card stays underneath, behind "Show technical details". `repo` (the run's
 * `repo_ref`) names whose origin; `null` says "the repository".
 */
export function plainDeliverSentence(card: string | null | undefined, repo: string | null): string {
  const c = (card ?? '').trim();
  const whose = repo !== null && repo !== '' ? `${repo}’s origin` : 'the repository’s origin';
  const pr = /onto pull request #(\d+)/.exec(c)?.[1];
  if (pr !== undefined) return `Adds your changes to pull request #${pr}.`;
  if (/has no `?origin`? remote/.test(c)) {
    return `${repo !== null && repo !== '' ? repo : 'This repository'} has no origin to push to, so nothing would be delivered. Add the remote first.`;
  }
  const gh = /^Pushes .+? to ([\w.-]+\/[\w.-]+) on GitHub and opens a pull request there/.exec(c)?.[1];
  if (gh !== undefined) return `Pushes your changes as a new branch to ${gh} on GitHub and opens a pull request there. Merging stays yours.`;
  if (/\) — a local path, so no pull request/.test(c)) {
    return `Pushes your changes as a new branch to ${whose} on this machine. There is no pull request: the branch is the delivery.`;
  }
  const host = /^Pushes .+? to origin \(([^)\s]+)\) and opens a pull request only if/.exec(c)?.[1];
  if (host !== undefined) {
    return `Pushes your changes as a new branch to ${whose} on ${host}. A pull request opens only if that is a GitHub host you’re signed in to; otherwise the branch is the delivery.`;
  }
  if (/^Pushes .+? to origin and opens a pull request/.test(c)) {
    return `Pushes your changes as a new branch to ${whose} and opens a pull request. Merging stays yours.`;
  }
  return `Pushes your changes as a new branch to ${whose}; a pull request opens only if that origin is on GitHub.`;
}

/** A run's repository name as the registry knows it (`repo_ref`), when it is a plain name. */
export function repoNameOf(view: SessionView): string | null {
  const ref = (view.session as { repo_ref?: unknown }).repo_ref;
  return typeof ref === 'string' && /^[\w.-]+$/.test(ref) ? ref : null;
}
