import type { SessionView } from '../api/types.js';
import { deliverUnit, deliveryOf } from '../components/delivery.js';
import { humanTitle } from '../components/runIdentity.js';

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

/** Engine text a default-layer line never carries. */
const ENGINE_TEXT = /\b(?:unit|rev|band|ord)\s*\d|\b(?:manual|auto) mode\b|→|\bgate_?kind\b/i;

/** "Approve the plan (7 steps)", "Approve the review", or the author's own words — never the
 *  engine's prompt. `undefined` prompt (a late join before the prompt is read) → the plain wait. */
export function plainGateQuestion(prompt: string | undefined, gateKind: string | undefined): string {
  const p = (prompt ?? '').trim();
  if (gateKind === 'plan_approval' || /^Approve plan rev \d+/i.test(p)) {
    const list = /\):\s*(.+)$/s.exec(p)?.[1];
    const steps = list === undefined ? 0 : list.split('→').map((s) => s.trim()).filter((s) => s !== '').length;
    return steps > 1 ? `Approve the plan (${steps} steps)` : 'Approve the plan';
  }
  const phase = /^Approve the output of unit \d+\s*\(\s*([A-Za-z0-9_-]+)/i.exec(p)?.[1];
  if (phase !== undefined) {
    const noun = STEP_NOUN[phase.toLowerCase()];
    return noun !== undefined ? `Approve the ${noun}` : `Approve the ${phase.replace(/[_-]+/g, ' ')} step`;
  }
  // The pre-execution form: "Approve unit 2 before it runs: review" (a phase id) or ": <its words>".
  const before = /^Approve unit \d+ before it runs:\s*(.+)$/i.exec(p.split('\n')[0]!.trim())?.[1]?.trim();
  if (before !== undefined && before !== '') {
    if (/^[A-Za-z0-9_-]+$/.test(before)) {
      const noun = STEP_NOUN[before.toLowerCase()];
      return noun !== undefined ? `Approve the ${noun}` : `Approve the ${before.replace(/[_-]+/g, ' ')} step`;
    }
    if (!ENGINE_TEXT.test(before)) return `Approve the next step: ${before}`;
  }
  const first = p.split('\n')[0]!.trim();
  if (first === '' || ENGINE_TEXT.test(first)) return 'Waiting on your answer';
  return first;
}

// ── studio#423: a run's title ───────────────────────────────────────────────────────────────

/** A run's title in the default layer. Onboarding runs say which repo ("Set up checkout-demo"):
 *  the title fold cut "Onboard repository: <name>" at its colon, so every one read the same. */
export function plainRunTitle(problem: string): string {
  const onboard = /^Onboard repository:\s+(\S+)/.exec(problem.trim());
  if (onboard !== null) return `Set up ${onboard[1]}`;
  return humanTitle(problem);
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
