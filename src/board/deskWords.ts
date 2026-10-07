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
      return noun !== undefined ? `Approve the ${noun}` : `Approve the ${head.replace(/[_-]+/g, ' ')} step`;
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
  if (/^\s*Unit\s+\d+\s+verdict is NOT PASS\b/i.test(p)) return 'The reviewer said FAIL — send it back?';
  if (/^\s*Unit\s+\d+\s+failed its deterministic floor\b/i.test(p)) return 'The floor failed — retry, send back or stop?';
  if (/^\s*Unit\s+\d+\s+was DENIED by input governance\b/i.test(p) || /^\s*Governance DENIED unit\s+\d+/i.test(p)) {
    const tool = /tool call was refused\s*\(\s*`?([A-Za-z0-9_.:-]+)`?\s*\)/i.exec(p)?.[1];
    return tool !== undefined ? `A ${tool} call was denied — how should the step go on?` : 'A tool call was denied — how should the step go on?';
  }
  if (/^\s*Team dispute on unit\s+\d+/i.test(p) || gateKind === 'team_dispute') return 'The team disagreed — approve or reject the work?';
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
  return onboardTitle(problem) ?? humanTitle(problem);
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
